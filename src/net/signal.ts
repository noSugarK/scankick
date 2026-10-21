import mqtt, { type MqttClient } from 'mqtt';
import { CONFIG } from '../config';

export type SignalHandler = (topic: string, payload: Uint8Array) => void;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function isJson(p: Uint8Array): boolean {
  return p.length > 0 && p[0] === 0x7b; // '{'
}
export function parseJson<T = any>(p: Uint8Array): T | null {
  try {
    return JSON.parse(dec.decode(p)) as T;
  } catch {
    return null;
  }
}

/** MQTT 信令通道：只负责建立连接时交换 SDP/ICE，以及 P2P 失败时的中继 */
export class Signal {
  private client: MqttClient | null = null;
  private handler: SignalHandler = () => {};
  readonly prefix: string;
  onStatus: (connected: boolean) => void = () => {};
  /** 设置后作为遗嘱：本端异常掉线时 broker 清空该 topic（房间前缀之后的部分）的保留消息 */
  willClearTopic: string | null = null;

  constructor(room: string) {
    this.prefix = `${CONFIG.topicPrefix}/${room}`;
  }

  async connect(): Promise<void> {
    let lastErr: unknown = new Error('无可用信令服务器');
    for (const url of CONFIG.brokers) {
      try {
        this.client = await connectOne(url, this.willClearTopic && `${this.prefix}/${this.willClearTopic}`);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!this.client) throw lastErr;
    this.client.on('message', (topic, payload) => this.handler(topic, payload));
    this.client.on('connect', () => this.onStatus(true));
    this.client.on('offline', () => this.onStatus(false));
  }

  onMessage(fn: SignalHandler) {
    this.handler = fn;
  }

  sub(topic: string, qos: 0 | 1 = 0) {
    this.client?.subscribe(`${this.prefix}/${topic}`, { qos });
  }
  unsub(topic: string) {
    this.client?.unsubscribe(`${this.prefix}/${topic}`);
  }

  /** 返回去掉房间前缀后的 topic */
  local(topic: string): string {
    return topic.startsWith(this.prefix + '/') ? topic.slice(this.prefix.length + 1) : topic;
  }

  pub(topic: string, data: Uint8Array | object, retain = false, qos: 0 | 1 = 0) {
    if (!this.client?.connected) return;
    const payload = data instanceof Uint8Array ? data : enc.encode(JSON.stringify(data));
    this.client.publish(`${this.prefix}/${topic}`, payload as any, { qos, retain });
  }

  close() {
    this.client?.end(true);
    this.client = null;
  }
}

function connectOne(url: string, willTopic: string | null): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(url, {
      connectTimeout: 5000,
      reconnectPeriod: 2000,
      keepalive: 30,
      clean: true,
      clientId: 'sfb_' + Math.random().toString(36).slice(2, 12),
      will: willTopic ? { topic: willTopic, payload: new Uint8Array(0) as any, qos: 0, retain: true } : undefined,
    });
    const timer = setTimeout(() => {
      c.end(true);
      reject(new Error('连接超时: ' + url));
    }, 6000);
    c.once('connect', () => {
      clearTimeout(timer);
      resolve(c);
    });
  });
}
