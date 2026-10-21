// 房间大厅 UI（大屏与手机面板共用）：队伍卡片、成员左滑操作、比赛设置
import { CONFIG } from '../config';
import { LEVEL_NAME } from '../game/ai';
import { TEAM_NAME } from '../game/render';
import { t } from '../i18n';
import { DURATIONS, MATCH_MODES, PARTY_RULES, type PlayerInfo, type Settings, type Team } from '../game/types';
import { icon } from './site';
import { esc } from './util';

export interface LobbyActions {
  settings(patch: Partial<Settings>): void;
  addBot(team: Team): void;
  owner(pid: number): void;
  kick(pid: number): void;
  /** 手机端换队；大屏不传 */
  join?(team: Team): void;
}

/** 球员状态标签：AI / 掉线 / 直连 / 中继（本机球员不显示） */
export function playerTag(p: PlayerInfo): string {
  if (p.bot) return 'AI';
  if (!p.online) return t('status.offline');
  if (p.link === 'local') return '';
  return t(p.link === 'p2p' ? 'status.p2p' : 'status.relay');
}

/** 房间密码一行；没有密码时为空 */
export function pinLineHtml(pin?: string): string {
  return pin ? `<div class="pin-line">${t('play.pinLine')} <b>${pin}</b></div>` : '';
}

/**
 * 名单里的一行。manage 为真时可以左滑露出操作：真人有「转让房主」和「移出」，AI 只有「移出」；
 * 平时不显示按钮，避免误触。本机球员不能被移出。
 */
function memberRowHtml(p: PlayerInfo, inner: string, manage: boolean): string {
  const off = p.online ? '' : 'off';
  if (!manage || p.link === 'local') return `<li class="${off}"><div class="row-main">${inner}</div></li>`;
  const host =
    !p.bot && p.online
      ? `<button class="act-host" data-pid="${p.id}" title="${t('play.makeOwner')}" aria-label="${t('play.makeOwner')}">${icon.home}</button>`
      : '';
  const kick = `<button class="act-kick" data-pid="${p.id}" title="${t('play.kick')}" aria-label="${t('play.kick')}">${icon.x}</button>`;
  return `<li class="${off} swipe"><div class="row-main">${inner}</div><div class="row-actions">${host}${kick}</div></li>`;
}

export interface TeamCardOpts {
  hostPid: number;
  /** 本机球员（手机端），用于标出「你」并且不能管理自己 */
  meId?: number;
  /** 房主 / 大屏：成员可左滑管理 */
  manage: boolean;
  /** 显示「+ 添加 AI」（队伍未满时） */
  addAi: boolean;
  /** 大屏：显示号码，并用「空位」补满 4 个位置 */
  slots: boolean;
  /** 手机端：显示「换到这队」 */
  joinable: boolean;
  /** 换队按钮文字，默认「换到这队」（观战者是「加入这队」） */
  joinLabel?: string;
}

export function teamCardHtml(team: Team, players: PlayerInfo[], o: TeamCardOpts): string {
  const list = players.filter((p) => p.team === team).sort((a, b) => a.num - b.num);
  const max = CONFIG.maxPerTeam;
  const rows = list.map((p) => {
    const num = o.slots ? `<b class="num">${p.num}</b>` : '';
    const you = p.id === o.meId ? ` <small>(${t('play.you')})</small>` : '';
    const owner = p.id === o.hostPid ? `<i class="owner">${t('role.owner')}</i>` : '';
    return memberRowHtml(p, `${num}<span class="nm">${esc(p.name)}${you}</span>${owner}<em>${playerTag(p)}</em>`, o.manage && p.id !== o.meId);
  });
  const free = max - list.length;
  if (o.addAi && free > 0) rows.push(`<li class="add-ai"><button data-team="${team}">+ ${t('cfg.addAi')}</button></li>`);
  if (o.slots) for (let i = rows.length; i < max; i++) rows.push(`<li class="slot">${t('lobby.emptySlot')}</li>`);
  const join = o.joinable ? `<button class="tc-join" data-team="${team}">${o.joinLabel ?? t('play.switchTeam')}</button>` : '';
  return `<div class="tcard t${team}">
    <div class="tc-head"><span>${TEAM_NAME[team]}</span><span class="tc-count">${list.length}/${max}</span>${join}</div>
    <ul>${rows.join('')}</ul>
  </div>`;
}

/** 比赛设置：时长、AI 难度点选，自动补位开关 */
export function settingsHtml(st: Settings): string {
  const chip = (k: string, v: number, label: string, on: boolean) =>
    `<button class="chip ${on ? 'on' : ''}" data-k="${k}" data-v="${v}">${label}</button>`;
  return `<div class="cfg">
    <div class="cfg-row"><span class="cfg-label">${t('cfg.mode')}</span><div class="chips">${MATCH_MODES.map((v) =>
      chip('mode', v, t(`mode.${v}`), v === st.mode),
    ).join('')}</div></div>
    <p class="cfg-hint muted small">${t(`mode.hint.${st.mode}`)}</p>
    <div class="cfg-row"><span class="cfg-label">${t('cfg.party')}</span><div class="chips">${PARTY_RULES.map((v) =>
      chip('party', v, t(`party.${v}`), v === st.party),
    ).join('')}</div></div>
    <p class="cfg-hint muted small">${t(`party.hint.${st.party}`)}</p>
    ${st.mode === 1 ? '' : `<div class="cfg-row"><span class="cfg-label">${t('cfg.duration')}</span><div class="chips">${DURATIONS.map((v) =>
      chip('duration', v, t('play.minutes', { n: v / 60 }), v === st.duration),
    ).join('')}</div></div>`}
    <div class="cfg-row"><span class="cfg-label">${t('cfg.level')}</span><div class="chips">${LEVEL_NAME.map((n, i) =>
      chip('level', i, n, i === st.level),
    ).join('')}</div></div>
    <label class="cfg-row"><span class="cfg-label">${t('cfg.autoFill')}</span><input type="checkbox" class="switch" data-k="autoFill" ${st.autoFill ? 'checked' : ''}></label>
  </div>`;
}

/** 非房主看到的设置摘要 */
export function settingsSummary(st: Settings): string {
  return `${t(`mode.${st.mode}`)}${st.mode === 1 ? '' : ` · ${t('play.minutes', { n: st.duration / 60 })}`}${st.party ? ` · ${t(`party.${st.party}`)}` : ''} · AI ${LEVEL_NAME[st.level]}${st.autoFill ? ` · ${t('cfg.autoFill')}` : ''}`;
}

/** 绑定设置、添加 AI、换队，以及成员左滑与二次确认 */
export function bindLobby(root: HTMLElement, players: PlayerInfo[], act: LobbyActions) {
  root.querySelectorAll<HTMLButtonElement>('.cfg .chip').forEach((b) => {
    b.onclick = () => act.settings({ [b.dataset.k!]: Number(b.dataset.v) });
  });
  const fill = root.querySelector<HTMLInputElement>('.cfg [data-k="autoFill"]');
  if (fill) fill.onchange = () => act.settings({ autoFill: fill.checked });
  root.querySelectorAll<HTMLButtonElement>('.add-ai button').forEach((b) => {
    b.onclick = () => act.addBot(Number(b.dataset.team) as Team);
  });
  root.querySelectorAll<HTMLButtonElement>('.tc-join').forEach((b) => {
    b.onclick = () => act.join?.(Number(b.dataset.team) as Team);
  });
  bindSwipe(root);
  const find = (b: HTMLElement) => players.find((p) => p.id === Number(b.dataset.pid));
  root.querySelectorAll<HTMLButtonElement>('.act-host').forEach((b) => {
    b.onclick = () => {
      const p = find(b);
      if (p && confirm(t('play.confirmOwner', { name: p.name }))) act.owner(p.id);
    };
  });
  root.querySelectorAll<HTMLButtonElement>('.act-kick').forEach((b) => {
    b.onclick = () => {
      const p = find(b);
      // 删 AI 随时能加回来，不用确认；移出真人要确认
      if (p && (p.bot || confirm(t('play.confirmKick', { name: p.name })))) act.kick(p.id);
    };
  });
}

/** 左滑手势（触屏与鼠标拖动都行）；同时只展开一行 */
function bindSwipe(root: HTMLElement) {
  const rows = [...root.querySelectorAll<HTMLElement>('li.swipe')];
  const shift = (li: HTMLElement, dx: number, animate: boolean) => {
    const main = li.querySelector<HTMLElement>('.row-main')!;
    main.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
    main.style.transform = dx ? `translateX(${dx}px)` : '';
    li.classList.toggle('open', dx < 0);
    li.dataset.dx = String(dx);
  };
  for (const li of rows) {
    const width = () => li.querySelector<HTMLElement>('.row-actions')!.offsetWidth;
    let x0 = 0;
    let base = 0;
    let dragging = false;
    li.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.row-actions')) return;
      for (const other of rows) if (other !== li) shift(other, 0, true);
      dragging = true;
      x0 = e.clientX;
      base = Number(li.dataset.dx || 0);
      li.setPointerCapture(e.pointerId);
    });
    li.addEventListener('pointermove', (e) => {
      if (dragging) shift(li, Math.max(-width(), Math.min(0, base + e.clientX - x0)), false);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      // 超过一半就停在展开位置，否则收回
      shift(li, Number(li.dataset.dx) < -width() / 2 ? -width() : 0, true);
    };
    li.addEventListener('pointerup', end);
    li.addEventListener('pointercancel', end);
  }
}
