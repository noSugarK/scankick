import { t, type Key } from '../i18n';
import { MATCH_MODES, PARTY_RULES } from '../game/types';
import { bindSiteTools, icon, siteFooter, siteTools } from '../ui/site';

const section = (n: number, title: Key, body: string) =>
  `<section class="guide-sec"><h2><span class="num">${n}</span>${t(title)}</h2>${body}</section>`;
const paras = (...keys: Key[]) => keys.map((k) => `<p>${t(k)}</p>`).join('');

export function mountGuide(app: HTMLElement) {
  const btn = (k: string, label: Key) => `<li><b class="pad-key ${k}">${k.toUpperCase()}</b>${t(label)}</li>`;
  app.innerHTML = `
  <div class="site guide">
    <header class="guide-bar">
      <a class="icon-btn" href="#/" aria-label="${t('guide.back')}">${icon.back}</a>
      <h1>${t('guide.title')}</h1>
      ${siteTools()}
    </header>
    <main class="site-main guide-main">
      ${section(1, 'guide.s1', `
        <div class="flow"><span>${icon.tv}${t('host.screen')}</span>${icon.right}<span>${icon.scan}${t('join.scan')}</span></div>
        ${paras('guide.s1a', 'guide.s1b', 'guide.s1c')}`)}
      ${section(2, 'guide.s2', `
        <div class="pad-demo" aria-hidden="true">
          <div class="stick"><i></i></div>
          <div class="abxy"><b class="pad-key y">Y</b><b class="pad-key x">X</b><b class="pad-key b">B</b><b class="pad-key a">A</b></div>
        </div>
        <ul class="keys">
          <li><b class="pad-key stick-key">${icon.stick}</b>${t('guide.stick')}</li>
          ${btn('a', 'guide.a')}${btn('b', 'guide.b')}${btn('x', 'guide.x')}${btn('y', 'guide.y')}
        </ul>
        <p class="hint">${t('guide.keys')}</p>`)}
      ${section(3, 'guide.s3', paras('guide.s3a', 'guide.s3b', 'guide.s3c'))}
      ${section(4, 'guide.s4', paras('guide.s4a', 'guide.s4b'))}
      ${section(5, 'cfg.mode', `
        ${MATCH_MODES.map((mode) => `<p><b>${t(`mode.${mode}`)}</b>：${t(`mode.hint.${mode}`)}</p>`).join('')}
        <h3>${t('cfg.party')}</h3>
        <p>${t('party.hint.0')}</p>
        ${PARTY_RULES.filter((rule) => rule !== 0).map((rule) => `<p><b>${t(`party.${rule}`)}</b>：${t(`party.hint.${rule}`)}</p>`).join('')}`)}
    </main>
    ${siteFooter()}
  </div>`;
  bindSiteTools(app);
}
