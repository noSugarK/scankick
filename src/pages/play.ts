import QRCode from 'qrcode';
import { HostGame } from '../game/host-game';
import { Renderer, TEAM_COLOR, TEAM_NAME, goalText as goalLabel, type ViewState } from '../game/render';
import { resultLineHtml, statsTabHtml } from '../ui/stats-ui';
import { constrainPlayerBounds, predictMove } from '../game/sim';
import {
  BTN_A,
  BTN_B,
  BTN_Y,
  FLAG_STUN,
  FLAG_TACKLE,
  Phase,
  type ClientMsg,
  type EndInfo,
  type PlayerInfo,
  type RosterMsg,
  type Snapshot,
} from '../game/types';
import { ClientNet, type ClientState } from '../net/client';
import { LanClient } from '../net/lan-client';
import { LanHost } from '../net/lan-host';
import { lanSession } from '../net/lan-session';
import { bindLanAddress, lanInfoHtml } from '../ui/lan-room';
import { SnapBuffer, separateViewBall, separateViewPlayers } from '../net/interp';
import { decodeSnapshot, encodeInput } from '../net/protocol';
import { CONFIG } from '../config';
import { t, type Key } from '../i18n';
import { Gamepad } from '../ui/gamepad';
import { saveQrCard } from '../ui/qrcard';
import { bindLobby, pinLineHtml, settingsHtml, settingsSummary, teamCardHtml } from '../ui/settings-ui';
import { icon } from '../ui/site';
import { unlockAudio } from '../ui/sound';
import type { Team } from '../game/types';
import { brand, canFullscreen, enterFullscreen, esc, isFullscreen, joinUrl, keepAwake, randomCode, roomOpts, store, vibrate } from '../ui/util';

const STATE_TEXT: Record<ClientState, Key> = {
  signal: 'status.signal',
  waiting: 'status.waiting',
  connecting: 'status.connecting',
  p2p: 'status.p2p',
  lan: 'status.lan',
  relay: 'status.relay',
  lost: 'status.lost',
  rejected: 'status.rejected',
};

/** client：扫码加入的手机；host：无大屏模式，本机既是主机又是球员 */
export type PlayMode = { kind: 'client'; room: string; forceRelay: boolean; pin: string; lock: boolean; lan: boolean } | { kind: 'host' };

export function mountPlay(app: HTMLElement, mode: PlayMode) {
  // 只在手机比赛页拦截双指缩放：两个拇指同时按摇杆和按键时 iOS 会当成捏合。
  // 其它页面不拦，否则 Mac Safari 智能缩放放大后就缩不回来了
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  const isHost = mode.kind === 'host';
  const forceRelay = mode.kind === 'client' && mode.forceRelay;
  let room: string;
  if (mode.kind === 'client') room = mode.room;
  else {
    room = store.get('sfb.hostroom', false) || randomCode();
    store.set('sfb.hostroom', room, false);
  }
  const joinedKey = isHost ? 'sfb.hosting' : `sfb.joined.${room}`;
  const savedName = store.get('sfb.name') || `${t('player.default')}${Math.floor(Math.random() * 90 + 10)}`;
  // '1' 已作为球员加入，'w' 正在观战：刷新后按原身份自动重连
  const joined = store.get(joinedKey, false);
  const autoJoin = joined === '1' || joined === 'w';
  const opts = isHost ? roomOpts() : null;
  const local = opts?.mode === 'lan' ? lanSession() : null;
  // 客户端密码：二维码自带 > 本标签页上次输入的
  const urlPin = mode.kind === 'client' ? mode.pin : '';
  const pinKey = `sfb.pin.${room}`;
  const askPin = mode.kind === 'client' && !urlPin && (mode.lock || !!store.get(pinKey, false));
  let qrUrl = '';
  if (opts) QRCode.toDataURL(joinUrl({ room, pin: opts.pin }), { width: 220, margin: 1 }).then((u) => {
      qrUrl = u;
      renderPanel();
    });

  app.innerHTML = `
  <div class="play">
    <canvas class="stage"></canvas>
    <div class="topbar">
      <div class="topbar-left"><img class="game-logo" src="${brand('logo-dark-sm.png')}" alt=""><div class="status"><i></i><span></span></div></div>
      <div class="top-actions">
        <button class="ghost fs-btn" hidden>${t('play.fullscreen')}</button>
        <button class="ghost cam">${t('play.follow')}</button>
        <button class="ghost menu">${t('play.menu')}</button>
        <button class="ghost leave-room">${t('play.leave')}</button>
      </div>
    </div>
    <div class="pad"></div>
    <div class="panel card" hidden></div>
    <div class="join card">
      <img class="join-logo" src="${brand('logo-dark.png')}" alt="${t('app.name')}">
      ${isHost ? `<h1>${t('play.noScreen')}</h1>` : ''}
      <p class="muted">${isHost ? t('play.noScreenDesc') : t('play.room', { room: `<b>${esc(room)}</b>` })}</p>
      <input class="name" maxlength="12" value="${esc(savedName)}" placeholder="${t('play.name')}" aria-label="${t('play.name')}">
      <input class="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="${t('play.pin')}" aria-label="${t('play.pin')}"
        value="${esc(store.get(pinKey, false) ?? '')}" ${askPin ? '' : 'hidden'}>
      <div class="seg">
        <button data-team="0" style="--c:${TEAM_COLOR[0]}">${TEAM_NAME[0]}</button>
        <button data-team="auto" class="on">${t('team.auto')}</button>
        <button data-team="1" style="--c:${TEAM_COLOR[1]}">${TEAM_NAME[1]}</button>
      </div>
      <button class="primary go">${t(isHost ? 'play.create' : 'play.enter')}</button>
      ${isHost ? '' : `<button class="ghost watch-go">${t('play.watch')}</button>`}
      <button class="ghost return-home">${t('play.home')}</button>
      <p class="muted small">${t('play.tip')}</p>
    </div>
    <div class="toast" hidden></div>
    <div class="rotate"><span>${t('play.rotate')}</span><button class="ghost leave-room">${t('play.leave')}</button></div>
  </div>`;

  const $ = <T extends HTMLElement>(s: string) => app.querySelector(s) as T;
  const joinEl = $('.join');
  const panel = $('.panel');
  const statusEl = $('.status');
  const toastEl = $('.toast');
  const renderer = new Renderer($('.stage'));
  renderer.padTop = 0;
  const pad = new Gamepad($('.pad'));
  const buf = new SnapBuffer();

  let team: Team | 'auto' = 'auto';
  joinEl.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
    b.onclick = () => {
      team = b.dataset.team === 'auto' ? 'auto' : (Number(b.dataset.team) as Team);
      joinEl.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });

  let net: ClientNet | LanClient | null = null;
  let game: HostGame | null = null;
  let meId = -1;
  /** 观战中：不占球员名额，没有手柄 */
  let watching = false;
  let players: PlayerInfo[] = [];
  let roster: RosterMsg | null = null;
  let rtt = 0;
  let goalText = '';
  let panelOpen = false;
  let panelTab: 'teams' | 'settings' | 'stats' = 'teams';
  /** 本房间最近的比赛（新的在前） */
  let history: EndInfo[] = [];
  /** 结算条被手动关掉；下一场结束时重新显示 */
  let resultClosed = false;
  // 本机是主机时：还没人加入就展开二维码方便扫码，有人加入后默认收起；手动切换过就按手动的来
  let qrOpen: boolean | null = null;
  let lastPhase: Phase | -1 = -1;

  const leave = () => {
    if ((game || net) && !confirm(t(game ? 'play.confirmCloseRoom' : 'play.confirmLeave'))) return;
    autoFs = false;
    game?.close();
    net?.close();
    store.set(joinedKey, '', false);
    location.hash = '#/';
  };
  app.querySelectorAll<HTMLButtonElement>('.leave-room, .return-home').forEach((button) => {
    button.onclick = leave;
  });

  const toast = (text: string, ms = 2000) => {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout((toast as any).t);
    (toast as any).t = setTimeout(() => (toastEl.hidden = true), ms);
  };

  function setStatus(s: ClientState) {
    // 中继或失联时状态标签可点：手动重试直连
    const retry = joinEl.hidden && (s === 'relay' || s === 'lost');
    statusEl.className = `status ${s}${retry ? ' retry' : ''}`;
    const ping = (s === 'p2p' || s === 'relay' || s === 'lan') && rtt ? ` ${Math.round(rtt)}ms` : '';
    const role = watching ? `${t('play.watching')} · ` : '';
    statusEl.querySelector('span')!.textContent = role + t(STATE_TEXT[s]) + ping + (retry ? ' ↻' : '');
    statusEl.title = retry ? t('status.tapRetry') : '';
    statusEl.setAttribute('role', retry ? 'button' : 'status');
    statusEl.tabIndex = retry ? 0 : -1;
  }
  const retryDirect = () => {
    if (net?.retryDirect()) toast(t('play.retryP2P'), 2000);
  };
  statusEl.onclick = retryDirect;
  statusEl.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && retryDirect();

  const send = (msg: ClientMsg) => {
    if (game) game.command(meId, msg);
    else net?.sendJson(msg);
  };
  /** 当前阶段与比分：主机直接读模拟器，客户端读最新快照 */
  const current = (): Pick<Snapshot, 'phase' | 'score'> =>
    game ? game.sim : (buf.latest?.s ?? { phase: Phase.Lobby, score: [0, 0] });

  function setWatching(w: boolean) {
    watching = w;
    $('.play').classList.toggle('watching', w);
    $('.cam').hidden = w;
    if (w) renderer.follow = false;
    if (net) {
      net.info.watch = w;
      setStatus(net.state);
    }
    if (!isHost) store.set(joinedKey, w ? 'w' : '1', false);
  }

  async function join(watch = false) {
    const name = ($<HTMLInputElement>('.name').value.trim() || savedName).slice(0, 12);
    store.set('sfb.name', name);
    store.set(joinedKey, watch ? 'w' : '1', false);
    if (isHost) return startHost(name);
    let token = store.get(`sfb.token.${room}`);
    if (!token) {
      token = randomCode(12);
      store.set(`sfb.token.${room}`, token);
    }
    joinEl.hidden = true;
    $('.play').classList.add('joined');
    keepAwake();
    const pinEl = $<HTMLInputElement>('.pin');
    // 输入框显示时以输入为准（例如二维码里的旧密码被拒后重新输入）
    const pin = (pinEl.hidden ? urlPin : pinEl.value.replace(/\D/g, '')) || undefined;
    if (!pinEl.hidden) store.set(pinKey, pin ?? '', false);
    net?.close();
    pad.reset();
    buf.reset();
    pred.ok = false;
    rtt = 0;
    meId = -1;
    lastPhase = -1;
    roster = null;
    players = [];
    history = [];
    panelOpen = false;
    panel.hidden = true;
    const Connection = mode.kind === 'client' && mode.lan ? LanClient : ClientNet;
    const connection = new Connection(room, { token, name, team, pin, watch });
    net = connection;
    setWatching(watch);
    connection.forceRelay = forceRelay;
    buf.delay = mode.kind === 'client' && mode.lan ? 35 : 60;
    const showJoin = () => {
      connection.close();
      pad.reset();
      buf.reset();
      pred.ok = false;
      joinEl.hidden = false;
      panel.hidden = true;
      $('.play').classList.remove('joined');
      store.set(joinedKey, '', false);
    };
    connection.onState = (s) => {
      if (net !== connection) return;
      setStatus(s);
      buf.delay = s === 'relay' ? 140 : s === 'lan' ? 35 : 60;
      if (s === 'lost' || s === 'rejected') {
        pad.reset();
        buf.reset();
        pred.ok = false;
      }
    };
    connection.onReject = (r) => {
      if (net !== connection) return;
      showJoin();
      toast(t(`reject.${r}`, { n: CONFIG.maxPerTeam * 2 }), 5000);
      if (r.startsWith('pin')) {
        pinEl.hidden = false;
        pinEl.value = '';
        pinEl.focus();
      }
    };
    connection.onBinary = (d) => {
      if (net !== connection) return;
      const s = decodeSnapshot(d);
      if (s) buf.push(s, performance.now());
    };
    connection.onJson = (m) => { if (net === connection) onMsg(m); };
    setStatus(mode.kind === 'client' && mode.lan ? 'connecting' : 'signal');
    try {
      await connection.start();
    } catch {
      if (net !== connection) return;
      showJoin();
      setStatus('lost');
      toast(t('play.signalFail'), 6000);
    }
  }

  async function startHost(name: string) {
    joinEl.hidden = true;
    $('.play').classList.add('joined');
    keepAwake();
    unlockAudio();
    game = new HostGame(room, opts!, local ? (_room, cb) => new LanHost(local, cb) : undefined);
    game.onLocal = onMsg;
    game.onStatus = (ok, text) => {
      statusEl.className = `status ${ok ? 'p2p' : 'lost'}`;
      statusEl.querySelector('span')!.textContent = ok ? `${local ? t('status.lan') + ' · ' : ''}${t('status.host', { room })}` : text;
    };
    meId = game.addLocal(name, team);
    await game.start();
  }

  function onMsg(m: any) {
    switch (m.t) {
      case 'welcome':
        meId = m.pid;
        setWatching(m.pid < 0);
        renderPanel();
        break;
      case 'roster':
        roster = m;
        players = m.players;
        renderPanel();
        break;
      case 'history':
        history = m.list;
        renderPanel();
        break;
      case 'pong':
        rtt = rtt ? rtt * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts;
        if (net) setStatus(net.state);
        break;
      case 'ev':
        if (m.k === 'kick') vibrate(25);
        else if (m.k === 'tackled') {
          vibrate([60, 40, 60]);
          toast(t('play.tackled'), 1000);
        } else if (m.k === 'goal') {
          goalText = goalLabel(m.team, m.scorer, m.own);
          const me = players.find((p) => p.id === meId);
          vibrate(me && me.team === m.team ? [120, 60, 120, 60, 200] : 200);
        } else if (m.k === 'end') {
          vibrate([300, 100, 300]);
          // 结束后先看本场战绩；结算缩成一行，队伍和设置仍然一点就到
          panelTab = 'stats';
          resultClosed = false;
        } else if (m.k === 'full') {
          toast(t('play.joinFull'), 2500);
        } else if (m.k === 'vote') {
          const me = players.find((p) => p.id === meId);
          if (me?.team === m.team) toast(t(m.cancel ? 'play.unvote' : 'play.vote', { name: m.name, n: m.n, need: m.need }), 2500);
          else if (!m.cancel) toast(t('play.enemyVote'), 2000);
        }
        break;
    }
  }

  // ---------- 面板（大厅/结算/菜单） ----------
  function renderPanel() {
    const { phase } = current();
    const lobby = phase === Phase.Lobby;
    const ended = phase === Phase.Ended;
    const inMatch = !lobby && !ended;
    panel.hidden = !panelOpen || !joinEl.hidden;
    if (panel.hidden || !roster) return;
    const r = roster;
    const me = players.find((p) => p.id === meId);
    const isOwner = meId >= 0 && meId === r.hostPid;
    const st = r.settings;
    // 结算时默认收起二维码，把位置留给战绩
    const showQr = qrOpen ?? (!ended && !players.some((p) => !p.bot && p.id !== meId));

    // 头部：房间信息、二维码开关（本机是主机时）、关闭
    const watchers = r.watchers ? ` · ${t('play.watchers', { n: r.watchers })}` : '';
    let html = `<div class="panel-head"><span>${t('play.room', { room: `<b>${esc(room)}</b>` })} · ${t('play.online', { n: players.filter((p) => !p.bot).length })}${watchers}</span>`;
    if (isHost) html += `<button class="ghost qr-toggle">${t('play.qr')} ${showQr ? '▴' : '▾'}</button>`;
    html += `<button class="ghost close" aria-label="close">×</button></div>`;
    if (isHost && showQr) {
      html += `<div class="host-qr">${qrUrl ? `<img src="${qrUrl}" alt="">` : ''}<div>
        <div class="room-code sm">${esc(room)}</div>${pinLineHtml(opts?.pin)}
        <div class="muted small">${t('play.scanToJoin')}${opts?.listed ? t('play.listed') : ''}</div>
        <button class="ghost save-qr">${icon.download}${t('qr.save')}</button></div></div>${local ? lanInfoHtml() : ''}`;
    }
    if (ended && r.end && !resultClosed) {
      html += `<div class="result-strip">${resultLineHtml(r.end)}<button class="ghost result-x" aria-label="${t('screen.closePanel')}">×</button></div>`;
    }

    // 大厅 / 结算有「队伍 / 设置 / 战绩」三个标签；比赛中只看队伍
    const tab = inMatch ? 'teams' : panelTab;
    if (!inMatch) {
      const label = { teams: t('play.tabTeams'), settings: t('play.tabSettings'), stats: t('stats.tab') };
      html += `<div class="ptabs">${(['teams', 'settings', 'stats'] as const)
        .map((k) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${label[k]}</button>`)
        .join('')}</div>`;
    }
    html += '<div class="pbody">';
    // 观战者：哪队还有真人空位就能直接加入那队
    const hasRoom = (team: Team) => players.filter((p) => !p.bot && p.team === team).length < CONFIG.maxPerTeam;
    if (tab === 'teams') {
      const card = (team: Team) =>
        teamCardHtml(team, players, {
          hostPid: r.hostPid,
          meId,
          manage: isOwner,
          addAi: isOwner && !inMatch,
          slots: false,
          joinable: watching ? hasRoom(team) : !inMatch && !!me && me.team !== team,
          joinLabel: watching ? t('play.joinTeam') : undefined,
        });
      html += `<div class="tcards">${card(0)}${card(1)}</div>`;
      if (isOwner && players.some((p) => p.id !== meId && p.link !== 'local')) html += `<p class="muted small swipe-hint">${t('play.swipeHint')}</p>`;
    } else if (tab === 'stats') {
      html += statsTabHtml(history, meId, me?.name ?? '');
    } else {
      html += isOwner ? settingsHtml(st) : `<p class="cfg-summary">${settingsSummary(st)}</p>`;
    }
    html += '</div><div class="pfoot">';
    if (watching) {
      if (hasRoom(0) || hasRoom(1)) html += `<button class="primary play-in">${t('play.joinGame')}</button>`;
      if (!inMatch && r.hostPid >= 0) html += `<p class="wait-owner">${t('play.waitOwner', { name: esc(players.find((p) => p.id === r.hostPid)?.name ?? '') })}</p>`;
    } else if (!inMatch) {
      // 主按钮和次要按钮放一行，省出高度给名单 / 设置 / 战绩
      html += '<div class="pfoot-row">';
      if (isOwner) html += `<button class="primary start">${t(ended ? 'play.again' : 'play.start')} · ${st.mode === 1 ? t('mode.1') : t('play.minutes', { n: st.duration / 60 })}</button>`;
      else html += `<p class="wait-owner">${t('play.waitOwner', { name: esc(players.find((p) => p.id === r.hostPid)?.name ?? '') })}</p>`;
      if (isHost && ended) html += `<button class="back">${t('play.toLobby')}</button>`;
      if (!isHost && me) html += `<button class="ghost to-watch">${t('play.toWatch')}</button>`;
      html += '</div>';
    } else if (me) {
      const votes = r.votes[me.team];
      const voted = votes.includes(meId);
      html += `<button class="surrender ${voted ? '' : 'danger'}">${t(voted ? 'play.unsurrender' : 'play.surrender')} (${votes.length}/${r.need[me.team]})</button>`;
      if (isHost) html += `<button class="end">${t('play.end')}</button>`;
    }
    // 教程在新标签页打开，不打断当前连接
    const tip = watching ? t('play.watchTip') : lobby ? t(isHost ? 'play.hostTip' : 'play.warmup') : '';
    html += `<div class="pmeta">${tip ? `<span>${tip}</span>` : ''}<a class="panel-guide" href="#/guide" target="_blank" rel="noopener">${t('play.guide')}</a></div></div>`;
    panel.innerHTML = html;
    if (local) bindLanAddress(panel, () => {
      QRCode.toDataURL(joinUrl({ room, pin: opts?.pin }), { width: 220, margin: 1 }).then((url) => {
        qrUrl = url;
        renderPanel();
      });
    });

    const on = (sel: string, fn: () => void) => {
      const el = panel.querySelector<HTMLElement>(sel);
      if (el) el.onclick = fn;
    };
    panel.querySelectorAll<HTMLButtonElement>('.ptabs button').forEach((b) => {
      b.onclick = () => {
        panelTab = b.dataset.tab as typeof panelTab;
        renderPanel();
      };
    });
    on('.qr-toggle', () => {
      qrOpen = !showQr;
      renderPanel();
    });
    on('.result-x', () => {
      resultClosed = true;
      renderPanel();
    });
    on('.start', () => send({ t: 'start' }));
    on('.play-in', () => send({ t: 'play', team: 'auto' }));
    on('.to-watch', () => send({ t: 'watch' }));
    on('.save-qr', () => saveQrCard({ room, pin: opts?.pin }));
    on('.surrender', () => send({ t: 'surrender' }));
    on('.end', () => confirm(t('play.confirmEnd')) && game?.endMatch());
    on('.back', () => game?.toLobby());
    on('.close', () => {
      panelOpen = false;
      renderPanel();
    });
    bindLobby(panel, players, {
      settings: (patch) => send({ t: 'settings', patch }),
      addBot: (team) => send({ t: 'bot', team, delta: 1 }),
      owner: (pid) => send({ t: 'owner', pid }),
      kick: (pid) => send({ t: 'kick', pid }),
      join: (team) => send(watching ? { t: 'play', team } : { t: 'team', team }),
    });
  }

  $('.menu').onclick = () => {
    panelOpen = !panelOpen;
    renderPanel();
  };
  const camBtn = $('.cam');
  camBtn.onclick = () => {
    renderer.follow = !renderer.follow;
    camBtn.textContent = t(renderer.follow ? 'play.overview' : 'play.follow');
  };
  // ---------- 全屏 ----------
  const fsBtn = $('.fs-btn');
  const iosTip = !canFullscreen() && !isFullscreen();
  const syncFs = () => (fsBtn.hidden = !canFullscreen() || isFullscreen());
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);
  syncFs();
  fsBtn.onclick = () => enterFullscreen(true);
  // 浏览器只在 touchend/click 等手势里允许全屏；自动重连后在下次抬手时补一次，成功前持续尝试
  let autoFs = canFullscreen();
  const tryFs = () => {
    if (!autoFs || !joinEl.hidden) return;
    enterFullscreen(true).then((ok) => ok && (autoFs = false));
  };
  window.addEventListener('touchend', tryFs);
  window.addEventListener('click', tryFs);

  const go = (watch: boolean) => {
    enterFullscreen(true).then((ok) => ok && (autoFs = false));
    join(watch);
    if (iosTip && !store.get('sfb.iosTip')) {
      store.set('sfb.iosTip', '1');
      toast(t('play.iosTip'), 7000);
    }
  };
  $('.go').onclick = () => go(false);
  app.querySelectorAll<HTMLInputElement>('.join input').forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        go(false);
      }
    };
  });
  const watchGo = app.querySelector<HTMLElement>('.watch-go');
  if (watchGo) watchGo.onclick = () => go(true);

  pad.onPress = (bit) => {
    if (bit === BTN_A || bit === BTN_B || bit === BTN_Y) vibrate(8);
  };

  // ---------- 输入发送 ----------
  let seq = 0;
  let lastSent = '';
  let lastSentAt = 0;
  const sendInput = (buttons = false) => {
    if (game) {
      if (buttons) game.setLocalInput({ ...pad.input });
      return;
    }
    if (!net?.linked || watching) return;
    const key = `${pad.input.jx.toFixed(2)},${pad.input.jy.toFixed(2)},${pad.input.btn}`;
    const now = performance.now();
    const relay = net.state === 'relay';
    const heartbeat = relay ? 200 : 100;
    if (buttons || key !== lastSent || now - lastSentAt > heartbeat) {
      if (!buttons && relay && key !== lastSent && now - lastSentAt < 60) return; // 只对移动限速
      net.sendInput(encodeInput(seq++, pad.input));
      lastSent = key;
      lastSentAt = now;
    }
  };
  pad.onButtons = () => sendInput(true);
  setInterval(sendInput, 33);
  setInterval(() => net?.linked && net.sendJson({ t: 'ping', ts: performance.now() }), 2000);

  // ---------- 渲染与本地预测 ----------
  const pred = { x: 0, y: 0, vx: 0, vy: 0, ok: false };
  let lastFrame = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    pad.update();
    if (game) game.setLocalInput({ ...pad.input });
    const snap = game ? game.view(meId) : buf.sample(now);
    if (snap) {
      const view: ViewState = game ? (snap as ViewState) : { ...snap, info: new Map(players.map((p) => [p.id, p])), meId, goalText };
      if (!game) applyPrediction(view, dt, now);
      renderer.draw(game ? view : separateViewBall(separateViewPlayers(view)), dt);
      if (snap.phase !== lastPhase) {
        lastPhase = snap.phase;
        // 进入大厅/结算时自动弹出菜单，开赛时自动收起；玩家随时可以手动关闭或打开
        panelOpen = snap.phase === Phase.Lobby || snap.phase === Phase.Ended;
        renderPanel();
      }
    }
    requestAnimationFrame(frame);
  };

  /** 自己的球员：本地立即响应输入，再平滑校正到主机位置 */
  function applyPrediction(view: Snapshot & { meId: number }, dt: number, now: number) {
    const latest = buf.latest;
    const i = view.players.findIndex((p) => p.id === meId);
    if (!latest || i < 0) return;
    const server = latest.s.players.find((p) => p.id === meId);
    if (!server) return;
    const ahead = Math.min(0.25, (now - latest.recv + rtt / 2) / 1000);
    const sx = server.x + server.vx * ahead;
    const sy = server.y + server.vy * ahead;
    const frozen = view.phase === Phase.Ready || view.phase === Phase.Ended || server.flags & (FLAG_STUN | FLAG_TACKLE);
    if (!pred.ok || frozen) {
      Object.assign(pred, { x: frozen ? view.players[i].x : sx, y: frozen ? view.players[i].y : sy, vx: server.vx, vy: server.vy, ok: true });
    } else {
      predictMove(pred, pad.input, dt, !!(pad.input.btn & BTN_B), view.party === 2 || server.stamina > 0.05);
      pred.x += pred.vx * dt;
      pred.y += pred.vy * dt;
      const ex = sx - pred.x;
      const ey = sy - pred.y;
      if (Math.hypot(ex, ey) > 70) {
        pred.x = sx;
        pred.y = sy;
      } else {
        const k = Math.min(1, dt * 6);
        pred.x += ex * k;
        pred.y += ey * k;
      }
    }
    constrainPlayerBounds(pred);
    const mag = Math.hypot(pad.input.jx, pad.input.jy);
    view.players[i] = {
      ...view.players[i],
      x: pred.x,
      y: pred.y,
      angle: mag > 0.2 && !frozen ? Math.atan2(pad.input.jy, pad.input.jx) : view.players[i].angle,
    };
  }
  requestAnimationFrame(frame);

  if (autoJoin) join(joined === 'w');
}
