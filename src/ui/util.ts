import { isLanPage, isNativeApp, lanSession } from '../net/lan-session';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(n = 5) {
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (const v of r) s += ALPHABET[v % ALPHABET.length];
  return s;
}

export function normalizeCode(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export const store = {
  get(k: string, local = true): string | null {
    try {
      return (local ? localStorage : sessionStorage).getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string, local = true) {
    try {
      (local ? localStorage : sessionStorage).setItem(k, v);
    } catch {
      /* 隐私模式等情况下忽略 */
    }
  },
  /** 删除以 prefix 开头的所有键 */
  clear(prefix: string, local = true) {
    try {
      const s = local ? localStorage : sessionStorage;
      for (const k of Object.keys(s)) if (k.startsWith(prefix)) s.removeItem(k);
    } catch {
      /* 忽略 */
    }
  },
};

/** 房间战绩存在本标签页（sessionStorage）：刷新还在，关掉标签页或回到首页即删除 */
export const HISTORY_KEY = 'sfb.hist.';

let wakeLock: { release(): Promise<void> } | null = null;
export async function keepAwake() {
  const nav = navigator as any;
  if (!nav.wakeLock) return;
  try {
    wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* 不支持或被拒绝 */
  }
  if (!(keepAwake as any).bound) {
    (keepAwake as any).bound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wakeLock) keepAwake();
    });
  }
}

export function canFullscreen() {
  const el = document.documentElement as any;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen() {
  const d = document as any;
  // 从主屏幕图标启动（standalone）或安卓原生 App（自身沉浸式）也视为全屏
  return (isNativeApp() && /Android/.test(navigator.userAgent)) || !!(d.fullscreenElement || d.webkitFullscreenElement) || matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

/** 必须在 click/touchend/keydown 等用户手势内调用（触屏的 pointerdown 不算手势） */
export async function enterFullscreen(landscape = false): Promise<boolean> {
  if (isFullscreen()) return true;
  const el = document.documentElement as any;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
  } catch {
    return false;
  }
  if (landscape) {
    try {
      await (screen.orientation as any)?.lock?.('landscape');
    } catch {
      /* 部分浏览器不支持锁定方向 */
    }
  }
  return true;
}

export function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* ignore */
  }
}

/** 二维码使用的页面地址：开发时用 localhost 打开会替换为局域网 IP */
export function publicBase() {
  if (roomOpts().mode === 'lan') {
    const session = lanSession();
    if (session) return session.baseUrl + '/';
  }
  const { protocol, hostname, port, pathname } = location;
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && __DEV_LAN_IP__) {
    return `${protocol}//${__DEV_LAN_IP__}${port ? ':' + port : ''}${pathname}`;
  }
  return `${location.origin}${pathname}`;
}

/** 创建房间时在首页选的选项，存在本标签页里，刷新后仍有效 */
export interface RoomOpts {
  listed: boolean;
  mode?: 'lan';
  pin?: string; // 没有则不设密码
}

/** 加入一个房间所需的信息 */
export interface RoomRef {
  room: string;
  pin?: string;
}

export const isPin = (s: unknown): s is string => typeof s === 'string' && /^\d{4,6}$/.test(s);

export function roomOpts(): RoomOpts {
  try {
    const o = JSON.parse(store.get('sfb.roomopts', false) || '{}');
    return { listed: o.mode === 'lan' ? false : !!o.listed, mode: o.mode === 'lan' ? 'lan' : undefined, pin: isPin(o.pin) ? o.pin : undefined };
  } catch {
    return { listed: false };
  }
}

/** 二维码地址：带上密码，扫码的人无需再输入（hash 部分不会发给任何服务器） */
export function joinUrl({ room, pin }: RoomRef) {
  const query = new URLSearchParams();
  if (roomOpts().mode === 'lan' || isLanPage()) query.set('lan', '1');
  if (pin) query.set('pin', pin);
  return `${publicBase()}#/join/${room}${query.size ? `?${query}` : ''}`;
}

/** public/brand 下的品牌素材地址（兼容 GitHub Pages 子路径） */
export const brand = (file: string) => `${import.meta.env.BASE_URL}brand/${file}`;

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
