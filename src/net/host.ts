import { CONFIG } from '../config';
import type { RejectReason, Team } from '../game/types';
import { Signal, isJson, parseJson } from './signal';

export type LinkMode = 'connecting' | 'p2p' | 'relay';

export interface Hello {
  t: 'hello';
  cid: string;
  token: string;
  name: string;
  team: Team | 'auto';
  pin?: string;
  /** 只观战，不占球员名额 */
  watch?: boolean;
}

export interface HostCallbacks {
  /** 新客户端请求加入，返回 null 允许，或返回拒绝原因 */
  onHello(cid: string, hello: Hello): RejectReason | null;
  /** 对端已创建（此时可以 sendJson，消息会先走 MQTT） */
  onPeer(cid: string): void;
  onJson(cid: string, msg: any): void;
  onBinary(cid: string, data: Uint8Array): void;
  onLink(cid: string, mode: LinkMode): void;
  onLeave(cid: string): void;
}

class RemotePeer {
  pc!: RTCPeerConnection;
  ctl!: RTCDataChannel;
  fast!: RTCDataChannel;
  mode: LinkMode = 'connecting';
  lastSeen = performance.now();
  private relayTimer: number;
  private retryTimer = 0;

  constructor(
    readonly cid: string,
    private host: HostNet,
  ) {
    this.setupPc();
    this.relayTimer = window.setTimeout(() => {
      if (this.mode === 'connecting') this.setMode('relay');
    }, CONFIG.p2pTimeoutMs);
  }

  private setupPc() {
    const pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers });
    this.pc = pc;
    this.ctl = pc.createDataChannel('ctl', { ordered: true });
    // 状态快照走不可靠、无序通道：丢包不重传，避免卡顿堆积
    this.fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
    for (const ch of [this.ctl, this.fast]) {
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => pc === this.pc && this.checkOpen();
      ch.onmessage = (e) => this.host.receive(this.cid, e.data);
      ch.onclose = () => pc === this.pc && this.onP2PDown();
    }
    pc.onicecandidate = (e) => {
      if (pc === this.pc) this.host.signal.pub(`c/${this.cid}`, { t: 'ice', c: e.candidate ? e.candidate.toJSON() : null });
    };
    pc.onconnectionstatechange = () => {
      if (pc === this.pc && pc.connectionState === 'failed') this.onP2PDown();
    };
  }

  async start() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    // 公共 MQTT 偶尔丢消息：未收到 answer 时每 2.5 秒重发同一 offer
    const pc = this.pc;
    const send = () => {
      if (pc !== this.pc || pc.signalingState !== 'have-local-offer') return;
      this.host.signal.pub(`c/${this.cid}`, { t: 'offer', sdp: offer.sdp });
      setTimeout(send, 2500);
    };
    send();
  }

  private lastRetry = 0;

  /** 手机端点状态标签请求重试直连：立即重建，并重置定时重试；3 秒内重复请求忽略 */
  retryNow() {
    const now = performance.now();
    if (this.mode !== 'relay' || now - this.lastRetry < 3000) return;
    clearInterval(this.retryTimer);
    this.retryTimer = window.setInterval(() => this.retryP2P(), 15000);
    this.retryP2P();
  }

  /** 中继期间定期重建 P2P（例如手机从后台恢复、网络切换后） */
  private retryP2P() {
    if (this.mode !== 'relay') return;
    this.lastRetry = performance.now();
    this.pc.close();
    this.setupPc();
    this.start().catch(() => {});
  }

  async onAnswer(sdp: string) {
    if (this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async onIce(c: RTCIceCandidateInit | null) {
    try {
      await this.pc.addIceCandidate(c ?? undefined);
    } catch {
      /* 忽略过期候选 */
    }
  }

  private checkOpen() {
    if (this.ctl.readyState === 'open' && this.fast.readyState === 'open') this.setMode('p2p');
  }

  private onP2PDown() {
    if (this.mode === 'p2p') this.setMode('relay');
  }

  setMode(m: LinkMode) {
    if (this.mode === m) return;
    this.mode = m;
    this.lastSeen = performance.now(); // 切换链路时给对端一个完整的超时窗口
    clearTimeout(this.relayTimer);
    clearInterval(this.retryTimer);
    if (m === 'relay') this.retryTimer = window.setInterval(() => this.retryP2P(), 15000);
    this.host.signal.pub(`c/${this.cid}`, { t: 'link', mode: m });
    this.host.cb.onLink(this.cid, m);
  }

  sendJson(obj: object) {
    if (this.mode === 'p2p' && this.ctl.readyState === 'open') this.ctl.send(JSON.stringify(obj));
    else this.host.signal.pub(`c/${this.cid}`, obj);
  }

  sendFast(bin: Uint8Array) {
    if (this.mode === 'p2p' && this.fast.readyState === 'open' && this.fast.bufferedAmount < 64 * 1024) {
      this.fast.send(bin as Uint8Array<ArrayBuffer>);
    }
    // relay 模式的快照由 HostNet 统一广播，见 broadcastFast
  }

  close() {
    clearTimeout(this.relayTimer);
    clearInterval(this.retryTimer);
    this.pc.close();
  }
}

/** 大屏端网络：接受手机连接，WebRTC 优先，失败回退 MQTT 中继 */
export class HostNet {
  readonly signal: Signal;
  private peers = new Map<string, RemotePeer>();
  private relaySnapCounter = 0;
  private watchdog = 0;

  constructor(
    readonly room: string,
    readonly cb: HostCallbacks,
  ) {
    this.signal = new Signal(room);
  }

  async start() {
    await this.signal.connect();
    this.signal.onMessage((topic, payload) => {
      const t = this.signal.local(topic);
      if (!t.startsWith('h/')) return;
      const cid = t.slice(2);
      if (isJson(payload)) this.onSignalJson(cid, parseJson(payload));
      else this.receive(cid, payload);
    });
    this.signal.sub('h/+', 1);
    this.watchdog = window.setInterval(() => this.checkTimeouts(), 1000);
  }

  private async onSignalJson(cid: string, msg: any) {
    if (!msg) return;
    const peer = this.peers.get(cid);
    switch (msg.t) {
      case 'hello': {
        if (peer) return; // 已在协商中
        const reject = this.cb.onHello(cid, msg as Hello);
        if (reject) {
          this.signal.pub(`c/${cid}`, { t: 'reject', reason: reject });
          return;
        }
        const p = new RemotePeer(cid, this);
        this.peers.set(cid, p);
        this.cb.onPeer(cid);
        p.start().catch(() => p.setMode('relay'));
        return;
      }
      case 'answer':
        peer?.onAnswer(msg.sdp);
        return;
      case 'ice':
        peer?.onIce(msg.c);
        return;
      case 'p2p':
        peer?.retryNow();
        return;
      case 'bye':
        this.drop(cid);
        return;
      default:
        if (peer) this.receive(cid, msg);
    }
  }

  /** 来自 DataChannel 或 MQTT 中继的业务消息 */
  receive(cid: string, data: ArrayBuffer | Uint8Array | string | object) {
    const peer = this.peers.get(cid);
    if (!peer) return;
    peer.lastSeen = performance.now();
    if (typeof data === 'string') {
      try {
        this.cb.onJson(cid, JSON.parse(data));
      } catch {
        /* ignore */
      }
    } else if (data instanceof ArrayBuffer) {
      this.cb.onBinary(cid, new Uint8Array(data));
    } else if (data instanceof Uint8Array) {
      this.cb.onBinary(cid, data);
    } else {
      this.cb.onJson(cid, data);
    }
  }

  sendJson(cid: string, obj: object) {
    this.peers.get(cid)?.sendJson(obj);
  }

  broadcastJson(obj: object) {
    for (const p of this.peers.values()) p.sendJson(obj);
  }

  /** 每次快照调用；中继客户端降频到 15Hz 并只发布一次广播 */
  broadcastFast(bin: Uint8Array) {
    let anyRelay = false;
    for (const p of this.peers.values()) {
      if (p.mode === 'p2p') p.sendFast(bin);
      else if (p.mode === 'relay') anyRelay = true;
    }
    if (anyRelay && this.relaySnapCounter++ % 2 === 0) this.signal.pub('bc', bin);
  }

  linkOf(cid: string): LinkMode | undefined {
    return this.peers.get(cid)?.mode;
  }

  private checkTimeouts() {
    const now = performance.now();
    for (const p of this.peers.values()) {
      const limit = p.mode === 'connecting' ? CONFIG.p2pTimeoutMs + 8000 : 6000;
      if (now - p.lastSeen > limit) this.drop(p.cid);
    }
  }

  /** 踢出：拒绝消息走 MQTT（DataChannel 马上要关，可能来不及送达），再断开 */
  kick(cid: string, reason: RejectReason) {
    this.signal.pub(`c/${cid}`, { t: 'reject', reason });
    this.drop(cid);
  }

  drop(cid: string) {
    const p = this.peers.get(cid);
    if (!p) return;
    p.close();
    this.peers.delete(cid);
    this.cb.onLeave(cid);
  }

  close() {
    clearInterval(this.watchdog);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.signal.close();
  }
}
