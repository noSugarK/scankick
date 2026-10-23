import { store } from '../ui/util';

declare global {
  interface Window {
    __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } };
    __SCANKICK_LAN__?: { room: string };
  }
}

export interface LanSession {
  room: string;
  port: number;
  key: string;
  addresses: { name: string; url: string }[];
  baseUrl: string;
}

export const isNativeApp = () => !!window.__TAURI__?.core;
export const isLanPage = () => !!window.__SCANKICK_LAN__;

export function lanSession(): LanSession | null {
  if (!isNativeApp()) return null;
  try { return JSON.parse(store.get('sfb.lan', false) || 'null'); }
  catch { return null; }
}

export async function startLan(room: string) {
  if (!window.__TAURI__) throw new Error('LAN hosting requires the ScanKick app');
  const info = await window.__TAURI__.core.invoke<Omit<LanSession, 'room' | 'baseUrl'>>('start_lan', { room });
  const session: LanSession = { ...info, room, baseUrl: info.addresses[0]?.url || `http://127.0.0.1:${info.port}` };
  store.set('sfb.lan', JSON.stringify(session), false);
  return session;
}

export async function stopLan() {
  const session = lanSession();
  store.set('sfb.lan', '', false);
  if (session) await window.__TAURI__!.core.invoke('stop_lan', { key: session.key });
}

export function setLanAddress(baseUrl: string) {
  const session = lanSession();
  if (session?.addresses.some((a) => a.url === baseUrl)) {
    store.set('sfb.lan', JSON.stringify({ ...session, baseUrl }), false);
  }
}

export interface LanRoom { room: string; baseUrl: string }

export function discoverLan(): Promise<LanRoom[]> {
  return window.__TAURI__!.core.invoke('discover_lan');
}

/** Accept only HTTP LAN endpoints, never credentials or executable URL schemes. */
export function lanBaseUrl(address: string) {
  const url = new URL(address);
  if (url.protocol !== 'http:' || url.username || url.password || !url.port ||
      !/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) throw new Error('Invalid LAN address');
  return url.origin;
}

export function lanJoinHash({ room, baseUrl }: LanRoom, pin = '') {
  if (!/^[A-Z0-9]{4,8}$/.test(room)) throw new Error('Invalid room code');
  const query = new URLSearchParams({ lan: '1', server: lanBaseUrl(baseUrl) });
  if (pin) query.set('pin', pin);
  return `#/join/${room}?${query}`;
}

export function lanSocketUrl(room: string, baseUrl?: string) {
  return `${(baseUrl ? lanBaseUrl(baseUrl) : location.origin).replace(/^http/, 'ws')}/ws?room=${encodeURIComponent(room)}`;
}
