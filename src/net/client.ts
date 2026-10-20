import { CONFIG } from '../config';
import type { RejectReason, Team } from '../game/types';
import { Signal, isJson, parseJson } from './signal';

export type ClientState = 'signal' | 'waiting' | 'connecting' | 'p2p' | 'relay' | 'lost' | 'rejected';

export interface JoinInfo {
  token: string;
  name: string;
  team: Team | 'auto';
  pin?: string;
}

const rid = () => Math.random().toString(36).slice(2, 10);

/** 手机端网络：通过 MQTT 找到大屏并建立 WebRTC，失败则使用 MQTT 中继 */
export class ClientNet {
  private signal: Signal;
  private cid = rid();
  private pc: RTCPeerConnection | null = null;
  private ctl: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private helloTimer = 0;
  private watchTimer = 0;
  /** 主机是否回应过；首次加入一直没回应说明房间不存在或主机已离线 */
  private answered = false;
  private lastRecv = 0;
  private relay = false;
  private lastOffer = '';
  private lastAnswer = '';
  state: ClientState = 'signal';
  /** 调试：忽略 offer，强制走 MQTT 中继 */
  forceRelay = false;
  private lastRetry = 0;

  onState: (s: ClientState) => void = () => {};
  onJson: (msg: any) => void = () => {};
  onBinary: (data: Uint8Array) => void = () => {};
  onReject: (reason: RejectReason) => void = () => {};

  constructor(
    readonly room: string,
    public info: JoinInfo,
  ) {
    this.signal = new Signal(room);
  }

  async start() {
    this.setState('signal');
    await this.signal.connect();
    this.signal.onMessage((topic, payload) => this.onSignal(this.signal.local(topic), payload));
    this.signal.onStatus = (ok) => {
      // 断网恢复后 mqtt.js 会自动重订阅；若已失联则重新握手
      if (ok && this.state === 'lost') this.restart();
    };
    this.join();
    this.watchTimer = window.setInterval(() => this.watch(), 1000);
    window.addEventListener('pagehide', () => this.signal.pub(`h/${this.cid}`, { t: 'bye' }));
  }

  private join() {
    this.signal.sub(`c/${this.cid}`);
    this.setState('waiting');
    const hello = () =>
      this.signal.pub(`h/${this.cid}`, {
        t: 'hello',
        cid: this.cid,
        token: this.info.token,
        name: this.info.name,
        team: this.info.team,
        pin: this.info.pin,
      });
    hello();
    clearInterval(this.helloTimer);
    this.helloTimer = window.setInterval(hello, 1500);
    this.lastRecv = performance.now();
  }

  /** 失联后用新的 cid 重新握手；token 不变，主机会恢复原来的球员 */
  restart() {
    this.teardownPeer();
    this.signal.unsub(`c/${this.cid}`);
    this.signal.unsub('bc');
    this.relay = false;
    this.cid = rid();
    this.join();
  }

  private watch() {
    const idle = performance.now() - this.lastRecv;
    if ((this.state === 'p2p' || this.state === 'relay') && idle > 5000) {
      this.setState('lost');
      this.restart();
    } else if (this.state === 'waiting' && !this.answered && idle > 10000) {
      clearInterval(this.helloTimer);
      this.setState('rejected');
      this.onReject('notFound');
    } else if (this.state === 'lost' || (this.state === 'connecting' && idle > CONFIG.p2pTimeoutMs + 6000)) {
      this.restart();
    }
  }

  private async onSignal(topic: string, payload: Uint8Array) {
    if (topic === 'bc') {
      if (this.relay && !this.p2pOpen()) {
        this.lastRecv = performance.now();
        this.onBinary(payload);
      }
      return;
    }
    if (topic !== `c/${this.cid}` || !isJson(payload)) return;
    const msg = parseJson(payload);
    if (!msg) return;
    this.lastRecv = performance.now();
    this.answered = true;
    switch (msg.t) {
      case 'offer':
        clearInterval(this.helloTimer);
        if (this.forceRelay) this.setState('connecting');
        else await this.onOffer(msg.sdp);
        return;
      case 'ice':
        try {
          await this.pc?.addIceCandidate(msg.c ?? undefined);
        } catch {
          /* ignore */
        }
        return;
      case 'link':
        if (msg.mode === 'relay') {
          this.relay = true;
          this.signal.sub('bc');
          if (!this.p2pOpen()) this.setState('relay');
        } else if (msg.mode === 'p2p') {
          this.relay = false;
          this.signal.unsub('bc');
        }
        return;
      case 'reject':
        clearInterval(this.helloTimer);
        this.setState('rejected');
        this.onReject(msg.reason);
        return;
      case 'welcome':
        clearInterval(this.helloTimer);
        this.onJson(msg);
        return;
      default:
        this.onJson(msg);
    }
  }

  private async onOffer(sdp: string) {
    if (sdp === this.lastOffer) {
      // 主机重发同一 offer，说明 answer 可能丢了：补发即可
      if (this.lastAnswer) this.signal.pub(`h/${this.cid}`, { t: 'answer', sdp: this.lastAnswer });
      return;
    }
    this.lastOffer = sdp;
    this.lastAnswer = '';
    this.teardownPeer();
    // 中继中收到新 offer 是主机在尝试恢复直连：保持中继可用，不打断操作
    if (!this.relay) this.setState('connecting');
    const pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers });
    this.pc = pc;
    pc.onicecandidate = (e) =>
      this.signal.pub(`h/${this.cid}`, { t: 'ice', c: e.candidate ? e.candidate.toJSON() : null });
    pc.ondatachannel = (e) => {
      const ch = e.channel;
      ch.binaryType = 'arraybuffer';
      if (ch.label === 'ctl') this.ctl = ch;
      else this.fast = ch;
      ch.onopen = () => {
        if (this.p2pOpen()) this.setState('p2p');
      };
      ch.onclose = () => {
        if (this.state === 'p2p') this.setState(this.relay ? 'relay' : 'lost');
      };
      ch.onmessage = (ev) => {
        this.lastRecv = performance.now();
        if (typeof ev.data === 'string') {
          try {
            this.onJson(JSON.parse(ev.data));
          } catch {
            /* ignore */
          }
        } else {
          this.onBinary(new Uint8Array(ev.data));
        }
      };
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.lastAnswer = answer.sdp ?? '';
    this.signal.pub(`h/${this.cid}`, { t: 'answer', sdp: answer.sdp });
  }

  /**
   * 用户手动请求直连：中继时请主机立即重新协商（中继保持可用，不打断比赛）；
   * 失联时直接重新握手。4 秒内重复点击忽略，返回是否真的发起了重试
   */
  retryDirect(): boolean {
    const now = performance.now();
    if (now - this.lastRetry < 4000) return false;
    if (this.state === 'relay') this.signal.pub(`h/${this.cid}`, { t: 'p2p' });
    else if (this.state === 'lost') this.restart();
    else return false;
    this.lastRetry = now;
    return true;
  }

  private p2pOpen() {
    return this.ctl?.readyState === 'open' && this.fast?.readyState === 'open';
  }

  get linked() {
    return this.state === 'p2p' || this.state === 'relay';
  }

  sendInput(bin: Uint8Array) {
    if (this.p2pOpen()) this.fast!.send(bin as Uint8Array<ArrayBuffer>);
    else if (this.relay) this.signal.pub(`h/${this.cid}`, bin);
  }

  sendJson(obj: object) {
    if (this.p2pOpen()) this.ctl!.send(JSON.stringify(obj));
    else this.signal.pub(`h/${this.cid}`, obj);
  }

  private teardownPeer() {
    this.pc?.close();
    this.pc = this.ctl = this.fast = null;
  }

  private setState(s: ClientState) {
    if (this.state === s) return;
    this.state = s;
    this.onState(s);
  }

  close() {
    clearInterval(this.helloTimer);
    clearInterval(this.watchTimer);
    this.signal.pub(`h/${this.cid}`, { t: 'bye' });
    this.teardownPeer();
    this.signal.close();
  }
}
