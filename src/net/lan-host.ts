import type { Hello, HostCallbacks } from './host';
import type { HostTransport } from './transport';
import type { RejectReason } from '../game/types';
import type { LanSession } from './lan-session';

export class LanHost implements HostTransport {
  private socket: WebSocket | null = null;
  private peers = new Set<string>();
  private closed = false;

  constructor(private session: LanSession, readonly cb: HostCallbacks) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.session.port}/host?key=${encodeURIComponent(this.session.key)}`);
      this.socket = ws;
      ws.binaryType = 'arraybuffer';
      const timer = window.setTimeout(() => { ws.close(); reject(new Error('LAN host timeout')); }, 5000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('LAN server unavailable')); };
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error('LAN server closed'));
        for (const cid of this.peers) this.cb.onLeave(cid);
        this.peers.clear();
        if (!this.closed) this.cb.onStatus?.(false);
      };
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          if (event.data.byteLength < 4) return;
          const cid = String(new DataView(event.data).getUint32(0, true));
          if (this.peers.has(cid)) this.cb.onBinary(cid, new Uint8Array(event.data, 4));
          return;
        }
        try {
          const { cid: id, data, event: kind } = JSON.parse(event.data);
          if (!Number.isInteger(id) || id <= 0) return;
          const cid = String(id);
          if (kind === 'leave') { this.left(cid); return; }
          if (!data || typeof data !== 'object' || typeof data.t !== 'string') return;
          if (!this.peers.has(cid)) {
            if (data.t !== 'hello' || typeof data.token !== 'string' || !data.token || data.token.length > 128) return;
            const reason = this.cb.onHello(cid, data as Hello);
            if (reason) { this.sendJson(cid, { t: 'reject', reason }); return; }
            this.peers.add(cid);
            this.cb.onPeer(cid);
          } else if (data.t === 'bye') this.drop(cid);
          else if (data.t !== 'hello') this.cb.onJson(cid, data);
        } catch { /* Ignore malformed messages without interrupting the game loop. */ }
      };
    });
  }

  private send(data: string | Uint8Array) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (typeof data === 'string') this.socket.send(data);
    else this.socket.send(data as Uint8Array<ArrayBuffer>);
  }
  sendJson(cid: string, data: object) { this.send(JSON.stringify({ cid: Number(cid), data })); }
  broadcastJson(data: object) {
    // Only authenticated players receive room information.
    for (const cid of this.peers) this.sendJson(cid, data);
  }
  broadcastFast(data: Uint8Array) {
    if (!this.peers.size || (this.socket?.bufferedAmount ?? 0) > 65536) return;
    // Explicit recipients prevent unjoined sockets from receiving match state.
    for (const cid of this.peers) {
      const packet = new Uint8Array(data.length + 4);
      new DataView(packet.buffer).setUint32(0, Number(cid), true);
      packet.set(data, 4);
      this.send(packet);
    }
  }
  linkOf(cid: string) { return this.peers.has(cid) ? 'lan' as const : undefined; }
  private left(cid: string) { if (this.peers.delete(cid)) this.cb.onLeave(cid); }
  drop(cid: string) { this.send(JSON.stringify({ cid: Number(cid), drop: true })); this.left(cid); }
  kick(cid: string, reason: RejectReason) {
    this.sendJson(cid, { t: 'reject', reason });
    this.drop(cid);
  }
  close() {
    this.closed = true;
    this.peers.clear();
    this.socket?.close(); // The Rust service shuts down when its host disconnects.
  }
}
