import { t } from '../i18n';
import { discoverLan, lanJoinHash, type LanRoom } from '../net/lan-session';
import { esc } from './util';

export function lanLobbyHtml() {
  return `<p class="hint">${t('lan.joinHint')}</p>
    <button class="ghost lan-refresh">${t('lan.refresh')}</button>
    <div class="lan-rooms" aria-live="polite"></div>
    <form class="lan-join">
      <label>${t('lan.manual')}<input class="lan-url" type="url" required placeholder="http://192.168.1.2:12345" aria-label="${t('lan.manual')}"></label>
      <input class="lan-code" maxlength="8" autocapitalize="characters" placeholder="${t('join.codeLabel')}" aria-label="${t('join.codeLabel')}">
      <button class="join-btn" type="submit">${t('join.go')}</button>
      <p class="hint lan-error" role="alert" hidden>${t('lan.invalidAddress')}</p>
    </form>`;
}

export function bindLanLobby(root: HTMLElement) {
  const body = root.querySelector<HTMLElement>('.lan-rooms')!;
  const refresh = root.querySelector<HTMLButtonElement>('.lan-refresh')!;
  let closed = false;
  let busy = false;
  let timer = 0;
  const search = async () => {
    if (busy || closed) return;
    busy = refresh.disabled = true;
    try {
      const rooms = await discoverLan();
      if (closed) return;
      body.innerHTML = rooms.length ? rooms.map((room: LanRoom, i) =>
        `<button class="choice" data-room="${i}"><span><b>${esc(room.room)}</b><small>${esc(room.baseUrl)}</small></span></button>`).join('')
        : `<p class="hint">${t('lan.empty')}</p>`;
      body.querySelectorAll<HTMLButtonElement>('[data-room]').forEach((button) => {
        button.onclick = () => { location.hash = lanJoinHash(rooms[Number(button.dataset.room)]); };
      });
    } catch {
      if (!closed) body.innerHTML = `<p class="hint">${t('lan.searchFailed')}</p>`;
    } finally {
      busy = refresh.disabled = false;
      if (!closed) timer = window.setTimeout(search, 5000);
    }
  };
  refresh.onclick = () => { clearTimeout(timer); void search(); };
  root.querySelector<HTMLFormElement>('.lan-join')!.onsubmit = (event) => {
    event.preventDefault();
    const error = root.querySelector<HTMLElement>('.lan-error')!;
    try {
      const url = new URL(root.querySelector<HTMLInputElement>('.lan-url')!.value.trim());
      const match = url.hash.match(/^#\/join\/([A-Z0-9]{4,8})(?:\?(.*))?$/i);
      const room = match?.[1].toUpperCase() || root.querySelector<HTMLInputElement>('.lan-code')!.value.trim().toUpperCase();
      const pin = new URLSearchParams(match?.[2]).get('pin') || '';
      location.hash = lanJoinHash({ room, baseUrl: url.href }, pin);
      error.hidden = true;
    } catch { error.hidden = false; }
  };
  window.addEventListener('pagehide', () => { closed = true; clearTimeout(timer); }, { once: true });
  body.textContent = t('lobby.loading');
  void search();
}
