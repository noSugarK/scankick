import type { ClientState, JoinInfo } from './client';
import type { RejectReason } from '../game/types';
import { lanSocketUrl } from './lan-session';

export class LanClient {
  state: ClientState = 'connecting';
  onState: (state: ClientState) => void = () => {};
  onJson: (message: any) => void = () => {};
  onBinary: (data: Uint8Array) => void = () => {};
  onReject: (reason: RejectReason) => void = () => {};
  forceRelay = false;
  private socket: WebSocket | null = null;
  private timer = 0;
  private closed = false;
  private rejected = false;
  private lastRecv = 0;

  constructor(readonly room: string, public info: JoinInfo, private baseUrl?: string) {}

  start(): Promise<void> {
    this.closed = this.rejected = false;
    this.connect();
    return Promise.resolve();
  }

  private setState(state: ClientState) { this.state = state; this.onState(state); }
  private connect() {
    if (this.closed || this.rejected) return;
    const ws = new WebSocket(lanSocketUrl(this.room, this.baseUrl));
    this.socket = ws;
    this.setState('connecting');
    ws.binaryType = 'arraybuffer';
    this.lastRecv = performance.now();
    ws.onopen = () => {
      if (this.socket !== ws || this.closed || this.rejected) return;
      this.sendJson({ t: 'hello', ...this.info });
    };
    ws.onmessage = (event) => {
      if (this.socket !== ws || this.closed || this.rejected) return;
      this.lastRecv = performance.now();
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.t === 'reject') {
            this.rejected = true;
            this.setState('rejected');
            this.onReject(message.reason);
            ws.close();
          } else {
            if (message.t === 'welcome') this.setState('lan');
            this.onJson(message);
          }
        } catch { /* Ignore malformed JSON. */ }
      } else this.onBinary(new Uint8Array(event.data));
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.socket !== ws || this.closed || this.rejected) return;
      clearTimeout(this.timer);
      this.setState('lost');
      this.timer = window.setTimeout(() => this.connect(), 1500);
    };
    clearTimeout(this.timer);
    const watch = () => {
      if (this.socket !== ws || this.closed || this.rejected) return;
      if (performance.now() - this.lastRecv > 6000) { ws.close(); return; }
      this.timer = window.setTimeout(watch, 2000);
    };
    this.timer = window.setTimeout(watch, 2000);
  }

  get linked() { return !this.closed && !this.rejected && this.state === 'lan'; }
  sendInput(data: Uint8Array) {
    if (this.linked && this.socket?.readyState === WebSocket.OPEN) this.socket.send(data as Uint8Array<ArrayBuffer>);
  }
  sendJson(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  retryDirect() {
    if (this.closed || this.rejected || this.state !== 'lost') return false;
    clearTimeout(this.timer);
    this.socket?.close();
    this.connect();
    return true;
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.sendJson({ t: 'bye' });
    this.socket?.close();
  }
}
