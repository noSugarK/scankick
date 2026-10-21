import { t } from '../i18n';
import { lanSession, setLanAddress } from '../net/lan-session';
import { esc } from './util';

export function lanInfoHtml() {
  const session = lanSession();
  if (!session) return '';
  return `<div class="lan-info"><p class="muted small">${t('lan.hint')}</p>
    ${session.addresses.length ? `<label class="small">${t('lan.address')}<select class="lan-address" aria-label="${t('lan.address')}">${session.addresses.map((a) =>
      `<option value="${esc(a.url)}" ${a.url === session.baseUrl ? 'selected' : ''}>${esc(a.name)} · ${esc(a.url)}</option>`).join('')}</select></label>` : `<p>${t('lan.noAddress')}</p>`}</div>`;
}

export function bindLanAddress(root: HTMLElement, changed: () => void) {
  const select = root.querySelector<HTMLSelectElement>('.lan-address');
  if (select) select.onchange = () => { setLanAddress(select.value); changed(); };
}
