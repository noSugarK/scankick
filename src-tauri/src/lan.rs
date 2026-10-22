use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    serve::ListenerExt,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
};
use tokio::{
    net::TcpListener,
    sync::{mpsc, watch, Mutex},
    time::{timeout, Duration},
};

include!(concat!(env!("OUT_DIR"), "/lan-assets.rs"));

#[derive(Clone, Default)]
pub struct LanServer(Arc<Mutex<Option<Running>>>);
impl LanServer {
    pub async fn shutdown(&self) {
        if let Some(server) = self.0.lock().await.take() {
            let _ = server.stop.send(true);
        }
    }
}
struct Running {
    key: String,
    stop: watch::Sender<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    port: u16,
    key: String,
    addresses: Vec<Address>,
}
#[derive(Serialize)]
struct Address {
    name: String,
    url: String,
}

struct Hub {
    room: String,
    key: String,
    host: Mutex<Option<mpsc::Sender<Message>>>,
    peers: Mutex<HashMap<u32, Peer>>,
    next: AtomicU32,
    stop: watch::Sender<bool>,
}

struct Peer {
    control: mpsc::Sender<Message>,
    snapshot: watch::Sender<Option<Message>>,
}

async fn wait_for_stop(stop: &mut watch::Receiver<bool>) {
    let _ = stop.wait_for(|v| *v).await;
}

#[tauri::command]
pub async fn start_lan(
    room: String,
    state: tauri::State<'_, LanServer>,
) -> Result<ServerInfo, String> {
    start_server(room, &state).await
}

async fn start_server(room: String, state: &LanServer) -> Result<ServerInfo, String> {
    let mut current = state.0.lock().await;
    if !(4..=8).contains(&room.len())
        || !room
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    {
        return Err("Invalid room code".into());
    }
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut addresses: Vec<_> = if_addrs::get_if_addrs()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|iface| match iface.ip() {
            std::net::IpAddr::V4(ip)
                if !ip.is_loopback() && !ip.is_unspecified() && !ip.is_link_local() =>
            {
                Some(Address {
                    name: iface.name,
                    url: format!("http://{ip}:{port}"),
                })
            }
            _ => None,
        })
        .collect();
    addresses.sort_by_key(|a| {
        let n = a.name.to_lowercase();
        (
            n.contains("virtual")
                || n.contains("vmware")
                || n.contains("vethernet")
                || n.contains("docker")
                || n.contains("vpn"),
            a.url.clone(),
        )
    });
    addresses.dedup_by(|a, b| a.url == b.url);
    let key = uuid::Uuid::new_v4().to_string();
    let (stop, _) = watch::channel(false);
    let hub = Arc::new(Hub {
        room,
        key: key.clone(),
        host: Mutex::new(None),
        peers: Mutex::new(HashMap::new()),
        next: AtomicU32::new(1),
        stop: stop.clone(),
    });
    let app = Router::new()
        .route("/host", get(host_upgrade))
        .route("/ws", get(player_upgrade))
        .fallback(get(asset))
        .with_state(hub.clone());
    if let Some(previous) = current.take() {
        let _ = previous.stop.send(true);
    }
    *current = Some(Running {
        key: key.clone(),
        stop: stop.clone(),
    });
    let mut shutdown = stop.subscribe();
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(
            listener.tap_io(|stream| {
                // Inputs and snapshots are tiny packets; do not wait for another packet/ACK.
                if let Err(error) = stream.set_nodelay(true) {
                    eprintln!("Could not enable TCP_NODELAY for LAN connection: {error}");
                }
            }),
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown.wait_for(|v| *v).await;
        })
        .await;
    });
    Ok(ServerInfo {
        port,
        key,
        addresses,
    })
}

#[tauri::command]
pub async fn stop_lan(key: String, state: tauri::State<'_, LanServer>) -> Result<(), String> {
    let mut current = state.0.lock().await;
    if current.as_ref().is_some_and(|s| s.key == key) {
        if let Some(server) = current.take() {
            let _ = server.stop.send(true);
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct HostQuery {
    key: String,
}
async fn host_upgrade(
    State(hub): State<Arc<Hub>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(q): Query<HostQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if !addr.ip().is_loopback() || q.key != hub.key {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut host = hub.host.lock().await;
    if host.is_some() {
        return StatusCode::CONFLICT.into_response();
    }
    let (tx, rx) = mpsc::channel(256);
    *host = Some(tx);
    drop(host);
    ws.max_message_size(65536)
        .max_frame_size(65536)
        .on_upgrade(move |socket| host_socket(socket, hub, rx))
}

#[derive(Deserialize)]
struct PlayerQuery {
    room: String,
}
async fn player_upgrade(
    State(hub): State<Arc<Hub>>,
    Query(q): Query<PlayerQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if q.room != hub.room || hub.host.lock().await.is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Browsers may only connect from this server's page, not arbitrary websites.
    if let Some(origin) = headers.get(header::ORIGIN) {
        let expected = format!(
            "http://{}",
            headers
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .unwrap_or("")
        );
        if origin.as_bytes() != expected.as_bytes() {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    let mut peers = hub.peers.lock().await;
    if peers.len() >= 32 {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let cid = hub.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel(8);
    let (snapshot, snapshots) = watch::channel(None);
    peers.insert(cid, Peer { control: tx, snapshot });
    drop(peers);
    ws.max_message_size(16384)
        .max_frame_size(16384)
        .on_upgrade(move |socket| player_socket(socket, hub, cid, rx, snapshots))
}

async fn host_event(hub: &Hub, message: Message) -> bool {
    let host = hub.host.lock().await;
    host.as_ref().is_some_and(|tx| tx.try_send(message).is_ok())
}

async fn player_socket(
    mut socket: WebSocket,
    hub: Arc<Hub>,
    cid: u32,
    mut rx: mpsc::Receiver<Message>,
    mut snapshots: watch::Receiver<Option<Message>>,
) {
    let mut stop = hub.stop.subscribe();
    let mut last = tokio::time::Instant::now();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(2));
    loop {
        tokio::select! {
            biased;
            _ = wait_for_stop(&mut stop) => break,
            message = rx.recv() => match message {
                Some(message) => if !matches!(timeout(Duration::from_secs(2), socket.send(message)).await, Ok(Ok(()))) { break; },
                None => break,
            },
            incoming = socket.recv() => {
                last = tokio::time::Instant::now();
                let message = match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(data) = serde_json::from_str::<Value>(&text) else { break; };
                        if !data.is_object() { break; }
                        Message::Text(json!({"cid":cid, "data":data}).to_string().into())
                    },
                    Some(Ok(Message::Binary(bytes))) if bytes.len() <= 64 => {
                        let mut data = cid.to_le_bytes().to_vec(); data.extend_from_slice(&bytes);
                        Message::Binary(data.into())
                    },
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    _ => break,
                };
                if !host_event(&hub, message).await { break; }
            },
            _ = heartbeat.tick() => {
                if last.elapsed() > Duration::from_secs(10) { break; }
            },
            changed = snapshots.changed() => {
                if changed.is_err() { break; }
                let message = snapshots.borrow_and_update().clone();
                if let Some(message) = message {
                    if !matches!(timeout(Duration::from_secs(2), socket.send(message)).await, Ok(Ok(()))) { break; }
                }
            }
        }
    }
    hub.peers.lock().await.remove(&cid);
    let _ = host_event(
        &hub,
        Message::Text(json!({"cid":cid,"event":"leave"}).to_string().into()),
    )
    .await;
    let _ = timeout(Duration::from_secs(1), socket.send(Message::Close(None))).await;
}

#[derive(Deserialize)]
struct HostPacket {
    cid: Option<u32>,
    data: Option<Value>,
    #[serde(default)]
    drop: bool,
}
async fn host_socket(mut socket: WebSocket, hub: Arc<Hub>, mut rx: mpsc::Receiver<Message>) {
    let mut stop = hub.stop.subscribe();
    loop {
        tokio::select! {
            _ = wait_for_stop(&mut stop) => break,
            message = rx.recv() => match message {
                Some(message) => if !matches!(timeout(Duration::from_secs(2), socket.send(message)).await, Ok(Ok(()))) { break; },
                None => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    let Ok(packet) = serde_json::from_str::<HostPacket>(&text) else { break; };
                    if packet.drop {
                        if let Some(cid) = packet.cid { hub.peers.lock().await.remove(&cid); }
                    } else if let Some(data) = packet.data {
                        deliver(&hub, packet.cid, Message::Text(data.to_string().into()), false).await;
                    }
                },
                Some(Ok(Message::Binary(bytes))) if bytes.len() >= 4 => {
                    let cid = u32::from_le_bytes(bytes[..4].try_into().unwrap());
                    deliver(&hub, if cid == 0 { None } else { Some(cid) }, Message::Binary(bytes.slice(4..)), true).await;
                },
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {},
                _ => break,
            }
        }
    }
    *hub.host.lock().await = None;
    let _ = hub.stop.send(true);
    hub.peers.lock().await.clear();
    let _ = timeout(Duration::from_secs(1), socket.send(Message::Close(None))).await;
}

async fn deliver(hub: &Hub, cid: Option<u32>, message: Message, snapshot: bool) {
    let mut peers = hub.peers.lock().await;
    peers.retain(|id, peer| {
        if cid.is_some_and(|cid| cid != *id) {
            return true;
        }
        if snapshot {
            // Keep only the newest unsent state; a slow phone must not replay old frames.
            peer.snapshot.send(Some(message.clone())).is_ok()
        } else {
            // Room events and ping replies are reliable and take priority over snapshots.
            peer.control.try_send(message.clone()).is_ok()
        }
    });
}

async fn asset(State(hub): State<Arc<Hub>>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let Some((_, bytes)) = ASSETS.iter().find(|(name, _)| *name == path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "json" => "application/json",
        _ => "application/octet-stream",
    };
    let body = if path == "index.html" {
        String::from_utf8_lossy(bytes)
            .replace(
                "<head>",
                &format!(
                    "<head><script>window.__SCANKICK_LAN__={};</script>",
                    json!({"room":hub.room})
                ),
            )
            .into_bytes()
    } else {
        bytes.to_vec()
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::{
        connect_async, connect_async_with_config,
        tungstenite::{client::IntoClientRequest, Message as Wire},
    };

    async fn http(port: u16, path: &str) -> String {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        stream
            .write_all(
                format!(
                    "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut bytes = Vec::new();
        timeout(Duration::from_secs(3), stream.read_to_end(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Run explicitly with `cargo test --lib browser_smoke -- --ignored --nocapture`.
    /// The temporary page substitutes only native IPC; game and sockets are real.
    #[tokio::test]
    #[ignore]
    async fn browser_smoke() {
        let state = LanServer::default();
        let info = start_server("ABCDE".into(), &state).await.unwrap();
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
        let json = serde_json::to_string(&info).unwrap();
        std::fs::write(target.join("lan-smoke.json"), &json).unwrap();
        std::fs::write(target.join("lan-smoke.html"), format!(r#"<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script>sessionStorage.setItem('sfb.room','ABCDE');sessionStorage.setItem('sfb.hostroom','ABCDE');window.__TAURI__={{core:{{invoke:async(command)=>command==='start_lan'?{json}:undefined}}}};</script><script type="module" src="/src/main.ts"></script></body></html>"#)).unwrap();
        println!("Host fixture: http://127.0.0.1:1420/src-tauri/target/lan-smoke.html");
        println!("Player: http://127.0.0.1:{}/#/join/ABCDE?lan=1", info.port);
        let mut stop = state.0.lock().await.as_ref().unwrap().stop.subscribe();
        timeout(Duration::from_secs(600), wait_for_stop(&mut stop))
            .await
            .expect("Close the host room to finish the smoke test");
    }

    #[tokio::test]
    async fn serves_offline_assets_routes_messages_and_stops_with_host() {
        let state = LanServer::default();
        assert!(start_server("../../bad".into(), &state).await.is_err());
        let info = start_server("ABCDE".into(), &state).await.unwrap();
        let page = http(info.port, "/").await;
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("window.__SCANKICK_LAN__={\"room\":\"ABCDE\"}"));
        assert!(
            !page.contains(&info.key),
            "Host key must never be served to players"
        );
        let asset_path = ASSETS
            .iter()
            .find(|(name, _)| name.ends_with(".js"))
            .unwrap()
            .0;
        assert!(http(info.port, &format!("/{asset_path}"))
            .await
            .starts_with("HTTP/1.1 200"));
        assert!(http(info.port, "/missing")
            .await
            .starts_with("HTTP/1.1 404"));

        let host_url = format!("ws://127.0.0.1:{}/host?key={}", info.port, info.key);
        assert!(
            connect_async(format!("ws://127.0.0.1:{}/host?key=wrong", info.port))
                .await
                .is_err()
        );
        let player_url = format!("ws://127.0.0.1:{}/ws?room=ABCDE", info.port);
        assert!(
            connect_async(&player_url).await.is_err(),
            "Cannot join before the host attaches"
        );
        let (mut host, _) = connect_async(&host_url).await.unwrap();
        assert!(
            connect_async(&host_url).await.is_err(),
            "Only one host may control the room"
        );
        assert!(
            connect_async(format!("ws://127.0.0.1:{}/ws?room=WRONG", info.port))
                .await
                .is_err()
        );
        let mut foreign = player_url.clone().into_client_request().unwrap();
        foreign
            .headers_mut()
            .insert("origin", "https://untrusted.example".parse().unwrap());
        assert!(connect_async(foreign).await.is_err());

        let mut request = player_url.into_client_request().unwrap();
        request.headers_mut().insert(
            "origin",
            format!("http://127.0.0.1:{}", info.port).parse().unwrap(),
        );
        let (mut player, _) = connect_async(request).await.unwrap();
        player
            .send(Wire::Text(
                r#"{"t":"hello","token":"player","name":"P","team":"auto"}"#.into(),
            ))
            .await
            .unwrap();
        let envelope: Value = serde_json::from_str(
            timeout(Duration::from_secs(3), host.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap()
                .to_text()
                .unwrap(),
        )
        .unwrap();
        let cid = envelope["cid"].as_u64().unwrap() as u32;
        assert_eq!(envelope["data"]["t"], "hello");
        host.send(Wire::Text(
            json!({"cid":cid,"data":{"t":"welcome","pid":1}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        assert!(timeout(Duration::from_secs(3), player.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .to_text()
            .unwrap()
            .contains("welcome"));
        let mut packet = cid.to_le_bytes().to_vec();
        packet.extend_from_slice(&[9, 8, 7]);
        host.send(Wire::Binary(packet.into())).await.unwrap();
        assert_eq!(
            timeout(Duration::from_secs(3), player.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap()
                .into_data()
                .as_ref(),
            &[9, 8, 7]
        );
        player
            .send(Wire::Binary(vec![1, 2, 3].into()))
            .await
            .unwrap();
        let input = timeout(Duration::from_secs(3), host.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .into_data();
        assert_eq!(&input[..4], cid.to_le_bytes());
        assert_eq!(&input[4..], &[1, 2, 3]);

        // A kicked socket drains its rejection before closing.
        host.send(Wire::Text(
            json!({"cid":cid,"data":{"t":"reject","reason":"kicked"}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        host.send(Wire::Text(
            json!({"cid":cid,"drop":true}).to_string().into(),
        ))
        .await
        .unwrap();
        assert!(timeout(Duration::from_secs(3), player.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .to_text()
            .unwrap()
            .contains("kicked"));
        let leave: Value = serde_json::from_str(
            timeout(Duration::from_secs(3), host.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap()
                .to_text()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(leave["event"], "leave");
        host.close(None).await.unwrap();
        timeout(Duration::from_secs(3), async {
            loop {
                if tokio::net::TcpStream::connect(("127.0.0.1", info.port))
                    .await
                    .is_err()
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("HTTP listener must stop when host exits");
    }

    #[tokio::test]
    async fn local_round_trip_with_snapshots() {
        let state = LanServer::default();
        let info = start_server("ABCDE".into(), &state).await.unwrap();
        let host_url = format!("ws://127.0.0.1:{}/host?key={}", info.port, info.key);
        let player_url = format!("ws://127.0.0.1:{}/ws?room=ABCDE", info.port);
        let (mut host, _) = connect_async_with_config(host_url, None, true).await.unwrap();
        let (mut player, _) = connect_async_with_config(player_url, None, true).await.unwrap();
        let mut samples = Vec::new();
        for seq in 0..12_u8 {
            let start = tokio::time::Instant::now();
            player.send(Wire::Text(json!({"t":"ping","ts":seq}).to_string().into())).await.unwrap();
            let envelope: Value = serde_json::from_str(timeout(Duration::from_secs(3), host.next())
                .await.unwrap().unwrap().unwrap().to_text().unwrap()).unwrap();
            let cid = envelope["cid"].as_u64().unwrap() as u32;
            let mut packet = cid.to_le_bytes().to_vec();
            packet.extend_from_slice(&[2, seq]);
            host.send(Wire::Binary(packet.into())).await.unwrap();
            tokio::task::yield_now().await;
            host.send(Wire::Text(json!({"cid":cid,"data":{"t":"pong","ts":seq}}).to_string().into())).await.unwrap();
            loop {
                let message = timeout(Duration::from_secs(3), player.next()).await.unwrap().unwrap().unwrap();
                if let Wire::Text(text) = message {
                    let pong: Value = serde_json::from_str(&text).unwrap();
                    assert_eq!(pong["ts"], seq);
                    samples.push(start.elapsed().as_secs_f64() * 1000.0);
                    break;
                }
            }
        }
        samples.sort_by(f64::total_cmp);
        println!("Local WebSocket round trip with snapshots: median={:.2}ms, max={:.2}ms", samples[6], samples[11]);
        host.close(None).await.unwrap();
        state.shutdown().await;
    }

    #[tokio::test]
    async fn slow_player_keeps_latest_snapshot_without_delaying_control_messages() {
        let (control, mut events) = mpsc::channel(2);
        let (snapshot, mut latest) = watch::channel(None);
        let (stop, _) = watch::channel(false);
        let hub = Hub {
            room: "ABCDE".into(), key: "test".into(), host: Mutex::new(None),
            peers: Mutex::new(HashMap::from([(1, Peer { control, snapshot })])),
            next: AtomicU32::new(2), stop,
        };
        for tick in 0..120_u8 {
            deliver(&hub, Some(1), Message::Binary(vec![tick].into()), true).await;
        }
        assert_eq!(latest.borrow_and_update().as_ref().unwrap(), &Message::Binary(vec![119].into()));
        assert!(events.try_recv().is_err(), "Snapshot congestion cannot fill the control queue");
        let pong = Message::Text(r#"{"t":"pong"}"#.into());
        deliver(&hub, Some(1), pong.clone(), false).await;
        assert_eq!(events.recv().await.unwrap(), pong);
        deliver(&hub, Some(1), Message::Binary(vec![120].into()), true).await;
        latest.changed().await.unwrap();
        assert_eq!(latest.borrow_and_update().as_ref().unwrap(), &Message::Binary(vec![120].into()));
        assert_eq!(hub.peers.lock().await.len(), 1, "A stalled snapshot receiver stays connected");
    }
}
