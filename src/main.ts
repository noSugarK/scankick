import './style.css';
import { lang, t } from './i18n';
import { mountGuide } from './pages/guide';
import { mountHome } from './pages/home';
import { mountPlay } from './pages/play';
import { mountScreen } from './pages/screen';
import { applyTheme } from './ui/site';
import { esc, normalizeCode, randomCode, roomOpts, store } from './ui/util';
import { isLanPage, isNativeApp, lanBaseUrl, startLan, stopLan } from './net/lan-session';

const app = document.getElementById('app')!;
document.documentElement.lang = lang;
document.title = lang === 'en' ? 'ScanKick' : `${t('app.name')} · ScanKick`;
document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', t('app.name'));
applyTheme();

async function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page, arg] = path.split('/');
  if ((page === 'screen' || page === 'host') && isLanPage()) {
    location.hash = `#/join/${window.__SCANKICK_LAN__!.room}?lan=1`;
    return;
  }
  if ((page === 'screen' || page === 'host') && roomOpts().mode === 'lan') {
    app.innerHTML = `<div class="site"><main class="site-main"><p>${t('lan.starting')}</p></main></div>`;
    try {
      if (!isNativeApp()) throw new Error(t('lan.appRequired'));
      const key = page === 'screen' ? 'sfb.room' : 'sfb.hostroom';
      const room = store.get(key, false) || randomCode();
      store.set(key, room, false);
      await startLan(room);
      window.addEventListener('pagehide', () => { void stopLan().catch(() => {}); }, { once: true });
    } catch (error) {
      app.innerHTML = `<div class="site"><main class="site-main"><h2>${t('lan.startFailed')}</h2><p>${esc(String(error))}</p><a href="#/">${t('play.home')}</a></main></div>`;
      return;
    }
  }
  if (page === 'screen') mountScreen(app);
  else if (page === 'host') mountPlay(app, { kind: 'host' });
  else if (page === 'guide') mountGuide(app);
  else if (page === 'join' && arg) {
    const q = new URLSearchParams(query);
    let server: string | undefined;
    if (isNativeApp() && q.has('lan') && q.has('server')) {
      try { server = lanBaseUrl(q.get('server')!); }
      catch { location.hash = '#/'; return; }
    }
    mountPlay(app, { kind: 'client', room: normalizeCode(arg), forceRelay: q.has('relay'), pin: q.get('pin') ?? '', lock: q.has('lock'), lan: isLanPage() || !!server, server });
  } else mountHome(app);
}

// 安卓 App 由原生层提供状态栏/刘海的安全区（WebView 的 env(safe-area-inset-*) 不可靠）
const android = (window as { ScanKickAndroid?: { safeArea(): string; setLightBars(top: boolean, bottom: boolean): void } }).ScanKickAndroid;
if (android) {
  const apply = () => {
    const [top, right, bottom, left] = JSON.parse(android.safeArea()) as number[];
    Object.entries({ top, right, bottom, left }).forEach(([k, v]) => document.documentElement.style.setProperty(`--safe-${k}`, `${v}px`));
  };
  apply();
  window.addEventListener('safeareachange', apply);
  // 状态栏/导航栏图标颜色按页面上下边缘的实际底色决定：浅底用深色图标
  const isLight = (y: number) => {
    for (let el = document.elementFromPoint(innerWidth / 2, y); el; el = el.parentElement) {
      const [r, g, b, a = 1] = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      if (a > 0) return 0.299 * r + 0.587 * g + 0.114 * b > 150;
    }
    return false;
  };
  const bars = () => setTimeout(() => android.setLightBars(isLight(1), isLight(innerHeight - 1)));
  new MutationObserver(bars).observe(document.documentElement, { attributeFilter: ['data-theme'] });
  new MutationObserver(bars).observe(app, { childList: true });
  window.addEventListener('safeareachange', bars);
}

// 原生 App 里的外部链接交给系统浏览器打开，不在应用内跳走
if (isNativeApp()) {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !/^https?:$/.test(a.protocol) || a.origin === location.origin) return;
    e.preventDefault();
    void window.__TAURI__!.core.invoke('plugin:opener|open_url', { url: a.href });
  });
}

// 页面各自持有网络连接与定时器，切换路由时直接整页重载最稳妥
window.addEventListener('hashchange', () => location.reload());
route();
