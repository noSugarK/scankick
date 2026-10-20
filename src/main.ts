import './style.css';
import { lang, t } from './i18n';
import { mountGuide } from './pages/guide';
import { mountHome } from './pages/home';
import { mountPlay } from './pages/play';
import { mountScreen } from './pages/screen';
import { applyTheme } from './ui/site';
import { normalizeCode } from './ui/util';

const app = document.getElementById('app')!;
document.documentElement.lang = lang;
document.title = lang === 'en' ? 'ScanKick' : `${t('app.name')} · ScanKick`;
applyTheme();

function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page, arg] = path.split('/');
  if (page === 'screen') mountScreen(app);
  else if (page === 'host') mountPlay(app, { kind: 'host' });
  else if (page === 'guide') mountGuide(app);
  else if (page === 'join' && arg) {
    const q = new URLSearchParams(query);
    mountPlay(app, { kind: 'client', room: normalizeCode(arg), forceRelay: q.has('relay'), pin: q.get('pin') ?? '', lock: q.has('lock') });
  } else mountHome(app);
}

// 页面各自持有网络连接与定时器，切换路由时直接整页重载最稳妥
window.addEventListener('hashchange', () => location.reload());
route();
