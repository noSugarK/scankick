mod lan;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(lan::LanServer::default())
        .invoke_handler(tauri::generate_handler![lan::start_lan, lan::stop_lan])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                let server = window.state::<lan::LanServer>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    server.shutdown().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
