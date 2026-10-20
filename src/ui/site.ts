// 首页与教程页共用：主题、语言切换、页脚、图标
import { LANGS, lang, setLang, t } from '../i18n';
import { store } from './util';

const svg = (body: string) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icon = {
  tv: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  scan: svg('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  home: svg('<path d="M4 11.5 12 4.5l8 7"/><path d="M6.5 10v9.5h11V10"/><path d="M10.5 19.5v-5h3v5"/>'),
  stick: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>'),
  book: svg('<path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h14"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  github:
    '<svg class="ico" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
};

export const REPO_URL = 'https://github.com/noSugarK/scankick';

type Theme = 'light' | 'dark';
const theme = (): Theme =>
  (document.documentElement.dataset.theme as Theme) ||
  (store.get('sfb.theme') as Theme) ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** 启动时调用一次：没手动选过就跟随系统 */
export function applyTheme() {
  document.documentElement.dataset.theme = theme();
}

/** 右上角：主题切换 + 语言下拉 */
export function siteTools() {
  const dark = theme() === 'dark';
  return `<div class="site-tools">
    <button class="icon-btn theme-btn" aria-label="${t(dark ? 'theme.toLight' : 'theme.toDark')}" title="${t(dark ? 'theme.toLight' : 'theme.toDark')}">${dark ? icon.sun : icon.moon}</button>
    <select class="lang-select" aria-label="${t('lang.label')}">${LANGS.map(
      ([v, name]) => `<option value="${v}" ${v === lang ? 'selected' : ''}>${name}</option>`,
    ).join('')}</select>
  </div>`;
}

export function bindSiteTools(root: HTMLElement) {
  const btn = root.querySelector<HTMLButtonElement>('.theme-btn')!;
  btn.onclick = () => {
    const next: Theme = theme() === 'dark' ? 'light' : 'dark';
    store.set('sfb.theme', next);
    document.documentElement.dataset.theme = next;
    btn.innerHTML = next === 'dark' ? icon.sun : icon.moon;
    const label = t(next === 'dark' ? 'theme.toLight' : 'theme.toDark');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  const sel = root.querySelector<HTMLSelectElement>('.lang-select')!;
  sel.onchange = () => setLang(sel.value as (typeof LANGS)[number][0]);
}

export function siteFooter() {
  return `<footer class="site-footer">© 2026 noSugarK · <a href="${REPO_URL}" target="_blank" rel="noopener">${icon.github} ${t('footer.github')}</a></footer>`;
}
