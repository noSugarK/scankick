import QRCode from 'qrcode';
import { HostGame, endReasonText, resultTitle } from '../game/host-game';
import { Renderer, TEAM_COLOR } from '../game/render';
import { Phase, type RosterMsg, type Team } from '../game/types';
import { t } from '../i18n';
import { saveQrCard } from '../ui/qrcard';
import { mvpLineHtml, statsTableHtml } from '../ui/stats-ui';
import { bindLobby, pinLineHtml, settingsHtml, teamCardHtml } from '../ui/settings-ui';
import { icon } from '../ui/site';
import { audioReady, unlockAudio } from '../ui/sound';
import { lanSession } from '../net/lan-session';
import { LanHost } from '../net/lan-host';
import { bindLanAddress, lanInfoHtml } from '../ui/lan-room';
import { brand, enterFullscreen, esc, joinUrl, keepAwake, randomCode, roomOpts, store } from '../ui/util';

export function mountScreen(app: HTMLElement) {
  let room = store.get('sfb.room', false);
  if (!room) {
    room = randomCode();
    store.set('sfb.room', room, false);
  }
  const opts = roomOpts();
  const local = opts.mode === 'lan' ? lanSession() : null;
  const qrUrl = joinUrl({ room, pin: opts.pin });

  app.innerHTML = `
  <div class="screen">
    <canvas class="stage"></canvas>
    <div class="corner-qr" hidden>
      <canvas></canvas><div>${t('screen.scanJoin')} · <b>${room}</b>${opts.pin ? ` · ${t('play.pinLine')} ${opts.pin}` : ''}</div>
    </div>
    <img class="game-logo screen-logo" src="${brand('logo-dark-sm.png')}" alt="">
    <div class="net-badge"><i></i><span>${t(local ? 'lan.starting' : 'status.connectingSignal')}</span></div>
    <div class="screen-actions">
      <button class="ghost end-btn" hidden>${t('screen.end')}</button>
      <button class="ghost open-lobby" hidden>${t('screen.openPanel')}</button>
      <button class="ghost leave-room">${t('play.leave')}</button>
    </div>
    <div class="lobby card">
      <button class="ghost lobby-close" title="${t('screen.closePanel')} (Esc)" aria-label="${t('screen.closePanel')}">×</button>
      <div class="lobby-join">
        <canvas class="qr"></canvas>
        <div class="room-code">${room}</div>
        ${pinLineHtml(opts.pin)}
        <div class="muted small">${t('screen.orOpen')}<br><span class="url">${esc(joinUrl({ room }))}</span></div>
        <button class="ghost save-qr">${icon.download}${t('qr.save')}</button>
        ${local ? lanInfoHtml() : ''}
      </div>
      <div class="lobby-side">
        <div class="lobby-head">
          <img class="lobby-logo" src="${brand('wordmark-dark.png')}" alt="${t('app.name')}">
          <span class="muted small"><span class="watchers"></span>${t('play.swipeHint')}</span>
        </div>
        <div class="tcards"></div>
        <div class="cfg-wrap"></div>
        <div class="row lobby-actions">
          <button class="primary start">${t('play.start')}</button>
          <button class="fs">${t('play.fullscreen')}</button>
        </div>
        <p class="muted small">${t('screen.lobbyTip')}</p>
      </div>
    </div>
    <div class="result card" hidden></div>
    <div class="audio-tip" hidden>${t('screen.audio')}</div>
  </div>`;

  const $ = <T extends HTMLElement>(s: string) => app.querySelector(s) as T;
  const lobbyEl = $('.lobby');
  const resultEl = $('.result');
  const cornerEl = $('.corner-qr');
  const endBtn = $('.end-btn');
  const badge = $('.net-badge');
  const cfgEl = $('.cfg-wrap');
  const openBtn = $('.open-lobby');
  const watchersEl = $('.watchers');
  let cfgHtml = '';
  // 大厅面板可以收起，好看清球场上的热身；回到大厅时重新展开
  let lobbyOpen = true;
  let lastPhase: Phase = Phase.Lobby;

  QRCode.toCanvas($('.qr'), qrUrl, { width: 260, margin: 1 });
  QRCode.toCanvas($('.corner-qr canvas'), qrUrl, { width: 110, margin: 1 });

  bindLanAddress(app, () => {
    QRCode.toCanvas($('.qr'), joinUrl({ room, pin: opts.pin }), { width: 260, margin: 1 });
    QRCode.toCanvas($('.corner-qr canvas'), joinUrl({ room, pin: opts.pin }), { width: 110, margin: 1 });
    $('.url').textContent = joinUrl({ room });
  });
  const game = new HostGame(room, opts, local ? (_room, cb) => new LanHost(local, cb) : undefined);
  const renderer = new Renderer($('.stage'));

  game.onStatus = (ok, text) => {
    badge.classList.toggle('ok', ok);
    badge.querySelector('span')!.textContent = ok && local ? t('status.lan') : text;
  };
  game.onRoster = (r) => renderUi(r);
  game.onPhase = () => renderUi(game.rosterMsg());

  const sideEl = $('.lobby-side');
  const cardsEl = $('.tcards');

  function renderUi(r: RosterMsg) {
    // 大屏是管理端：成员都能左滑管理，队伍未满时可添加 AI，空位补满 4 个
    const card = (team: Team) => teamCardHtml(team, r.players, { hostPid: r.hostPid, manage: true, addAi: true, slots: true, joinable: false });
    cardsEl.innerHTML = card(0) + card(1);
    // 设置内容变化时才重绘
    const html = settingsHtml(r.settings);
    if (html !== cfgHtml) {
      cfgHtml = html;
      cfgEl.innerHTML = html;
    }
    bindLobby(sideEl, r.players, {
      settings: (p) => game.setSettings(p),
      addBot: (team) => game.changeBots(team, 1),
      owner: (pid) => game.setOwner(pid),
      kick: (pid) => game.kick(pid),
    });
    watchersEl.textContent = r.watchers ? `${t('play.watchers', { n: r.watchers })} · ` : '';
    const phase = game.sim.phase;
    if (phase !== lastPhase) {
      if (phase === Phase.Lobby) lobbyOpen = true;
      lastPhase = phase;
    }
    const lobby = phase === Phase.Lobby;
    lobbyEl.hidden = !lobby || !lobbyOpen;
    openBtn.hidden = !lobby || lobbyOpen;
    // 面板收起后二维码挪到角落，仍然可以扫码加入
    cornerEl.hidden = lobby && lobbyOpen;
    endBtn.hidden = phase === Phase.Lobby || phase === Phase.Ended;
    if (phase === Phase.Ended && r.end) {
      const [a, b] = r.end.score;
      resultEl.innerHTML = `
        <h2>${resultTitle(r.end)}</h2>
        <p class="muted">${esc(endReasonText(r.end))}</p>
        <div class="final"><span style="color:${TEAM_COLOR[0]}">${a}</span> : <span style="color:${TEAM_COLOR[1]}">${b}</span></div>
        ${mvpLineHtml(r.end)}
        ${r.end.stats.length ? statsTableHtml(r.end) : ''}
        <div class="row"><button class="primary again">${t('play.again')}</button><button class="back">${t('play.toLobby')}</button></div>`;
      resultEl.querySelector<HTMLElement>('.again')!.onclick = () => game.startMatch();
      resultEl.querySelector<HTMLElement>('.back')!.onclick = () => game.toLobby();
      resultEl.hidden = false;
    } else resultEl.hidden = true;
  }

  const setLobbyOpen = (open: boolean) => {
    lobbyOpen = open;
    renderUi(game.rosterMsg());
  };
  $('.lobby-close').onclick = () => setLobbyOpen(false);
  openBtn.onclick = () => setLobbyOpen(true);
  $('.start').onclick = () => game.startMatch();
  $('.save-qr').onclick = () => saveQrCard({ room, pin: opts.pin });
  $('.fs').onclick = () => enterFullscreen();
  $('.leave-room').onclick = () => {
    if (!confirm(t('play.confirmCloseRoom'))) return;
    game.close();
    store.set('sfb.room', '', false);
    location.hash = '#/';
  };
  endBtn.onclick = () => {
    if (confirm(t('screen.confirmEnd'))) game.endMatch();
  };
  cornerEl.onclick = () => cornerEl.classList.toggle('mini');
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && e.target.closest('button, input, select, textarea, a')) return;
    const phase = game.sim.phase;
    if ((e.code === 'Space' || e.code === 'Enter') && (phase === Phase.Lobby || phase === Phase.Ended)) game.startMatch();
    if (e.code === 'KeyF') enterFullscreen();
    if (e.code === 'Escape') {
      if (phase === Phase.Lobby) setLobbyOpen(!lobbyOpen);
      else if (phase === Phase.Ended) game.toLobby();
      else if (confirm(t('play.confirmEnd'))) game.endMatch();
    }
  });

  let lastFrame = performance.now();
  const frame = () => {
    const now = performance.now();
    renderer.draw(game.view(-1), (now - lastFrame) / 1000);
    lastFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  game.start();
  keepAwake();
  // 浏览器要求用户交互后才能播放声音
  const tip = $('.audio-tip');
  unlockAudio();
  setTimeout(() => {
    if (!audioReady()) tip.hidden = false;
  }, 300);
  const unlock = () => {
    unlockAudio();
    tip.hidden = true;
    keepAwake();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
