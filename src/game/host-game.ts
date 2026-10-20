import { CONFIG } from '../config';
import { HostNet, type Hello } from '../net/host';
import { LOBBY_HEARTBEAT_MS, LobbyPublisher } from '../net/lobby';
import { decodeInput, encodeSnapshot } from '../net/protocol';
import { t } from '../i18n';
import { sfxGoal, sfxKick, sfxWhistle } from '../ui/sound';
import type { RoomOpts } from '../ui/util';
import { botInput, forgetBot } from './ai';
import { TEAM_NAME, goalText, type ViewState } from './render';
import { Sim } from './sim';
import {
  BOT_LEVELS,
  DURATIONS,
  Phase,
  type BotLevel,
  type EndInfo,
  type EndReason,
  type HostMsg,
  type Input,
  type PlayerInfo,
  type RejectReason,
  type RosterMsg,
  type Settings,
  type Team,
} from './types';

interface Slot {
  info: PlayerInfo;
  token: string | null;
  cid: string | null;
  offlineAt: number;
}

const DT = 1 / 60;
const MAX_HUMANS = CONFIG.maxPerTeam * 2;
const BOT_NAMES = t('bot.names').split(',');

/**
 * 主机：运行比赛、管理玩家、收发网络消息。
 * 大屏模式和「无大屏模式」（某台手机兼任主机和球员）共用。
 */
export class HostGame {
  readonly sim = new Sim();
  readonly net: HostNet;
  readonly settings: Settings = { duration: 180, autoFill: true, bots: [0, 0], level: 1 };
  goalText = '';
  endInfo: EndInfo | null = null;
  /** 本机球员（无大屏模式），-1 表示没有 */
  localPid = -1;

  onRoster: (msg: RosterMsg) => void = () => {};
  onPhase: (phase: Phase) => void = () => {};
  onStatus: (ok: boolean, text: string) => void = () => {};
  /** 发给本机球员的消息（与发给远程手机的内容一致） */
  onLocal: (msg: HostMsg) => void = () => {};

  private slots = new Map<number, Slot>();
  private byCid = new Map<string, number>();
  private votes: [Set<number>, Set<number>] = [new Set(), new Set()];
  private pendingEnd: Omit<EndInfo, 'score'> | null = null;
  private timers: number[] = [];
  private pinFails: number[] = [];
  /** 被踢玩家的 token：本局房间内不能再加入 */
  private kicked = new Set<string>();
  /** 被转让的房主；他在线时优先，掉线时按默认规则临时顺延 */
  private ownerOverride: number | null = null;
  private readonly lobby: LobbyPublisher;

  constructor(
    readonly room: string,
    readonly opts: RoomOpts = { listed: false },
  ) {
    this.net = new HostNet(room, {
      onHello: (cid, h) => this.onHello(cid, h),
      onPeer: (cid) => {
        const pid = this.byCid.get(cid);
        if (pid === undefined) return;
        const s = this.slots.get(pid)!;
        s.info.link = this.net.linkOf(cid) === 'p2p' ? 'p2p' : 'relay';
        this.net.sendJson(cid, { t: 'welcome', pid });
        this.rosterChanged();
      },
      onJson: (cid, msg) => {
        const pid = this.byCid.get(cid);
        if (pid === undefined) return;
        if (msg.t === 'ping') this.net.sendJson(cid, { t: 'pong', ts: msg.ts });
        else this.command(pid, msg);
      },
      onBinary: (cid, data) => {
        const pid = this.byCid.get(cid);
        const inp = pid !== undefined ? decodeInput(data) : null;
        if (inp) this.sim.setInput(pid!, inp);
      },
      onLink: (cid, mode) => {
        const s = this.slotByCid(cid);
        if (!s) return;
        s.info.link = mode === 'p2p' ? 'p2p' : 'relay';
        this.rosterChanged();
      },
      onLeave: (cid) => {
        const s = this.slotByCid(cid);
        this.byCid.delete(cid);
        if (!s || s.cid !== cid) return;
        s.cid = null;
        s.info.online = false;
        s.offlineAt = performance.now();
        this.sim.setInput(s.info.id, { jx: 0, jy: 0, btn: 0 });
        this.sim.inactive.add(s.info.id);
        this.rosterChanged();
      },
    });
    this.lobby = new LobbyPublisher(this.net.signal, opts.listed);
  }

  async start() {
    this.net.signal.onStatus = (ok) => {
      this.onStatus(ok, t(ok ? 'status.ready' : 'status.reconnecting'));
      if (ok) this.publishInfo(true);
    };
    window.addEventListener('pagehide', () => this.lobby.clear());
    this.startLoops();
    this.rosterChanged();
    try {
      await this.net.start();
      this.onStatus(true, t('status.ready'));
      if (this.opts.listed) this.publishInfo(true);
      else this.lobby.clear();
    } catch {
      this.onStatus(false, t('status.failed'));
    }
  }

  // ---------- 玩家 ----------
  private slotByCid(cid: string) {
    const pid = this.byCid.get(cid);
    return pid !== undefined ? this.slots.get(pid) : undefined;
  }

  private humans(team?: Team) {
    return [...this.slots.values()].filter((s) => !s.info.bot && (team === undefined || s.info.team === team));
  }

  private nextId() {
    for (let i = 1; i < 250; i++) if (!this.slots.has(i)) return i;
    return 250;
  }

  private addSlot(info: Omit<PlayerInfo, 'id' | 'num'>, token: string | null) {
    const id = this.nextId();
    const slot: Slot = { info: { ...info, id, num: 0 }, token, cid: null, offlineAt: 0 };
    this.slots.set(id, slot);
    this.sim.addPlayer(id, info.team);
    return slot;
  }

  private removeSlot(id: number) {
    const s = this.slots.get(id);
    if (!s) return;
    if (s.cid) this.byCid.delete(s.cid);
    this.slots.delete(id);
    this.sim.removePlayer(id);
    this.votes[0].delete(id);
    this.votes[1].delete(id);
    if (this.ownerOverride === id) this.ownerOverride = null;
    forgetBot(id);
  }

  /** 来自网络的 want 不可信：不是 0/1 一律按自动分队处理 */
  private pickTeam(want: Team | 'auto'): Team | null {
    const max = CONFIG.maxPerTeam;
    const c0 = this.humans(0).length;
    const c1 = this.humans(1).length;
    if (want === 0 && c0 < max) return 0;
    if (want === 1 && c1 < max) return 1;
    if (c0 >= max && c1 >= max) return null;
    if (c0 >= max) return 1;
    if (c1 >= max) return 0;
    return c0 <= c1 ? 0 : 1;
  }

  private onHello(cid: string, h: Hello): RejectReason | null {
    if (h.token && this.kicked.has(h.token)) return 'kicked';
    const pin = this.opts.pin;
    if (pin && h.pin !== pin) {
      // 全局限速：10 秒内最多 5 次错误，4 位密码穷举需要数小时
      const now = performance.now();
      this.pinFails = this.pinFails.filter((t) => now - t < 10000);
      if (this.pinFails.length >= 5) return 'pinThrottle';
      this.pinFails.push(now);
      return h.pin ? 'pinWrong' : 'pinNeed';
    }
    const name = String(h.name || t('player.default')).slice(0, 12);
    const existing = [...this.slots.values()].find((s) => s.token && s.token === h.token);
    if (existing) {
      if (existing.cid && existing.cid !== cid) {
        this.byCid.delete(existing.cid);
        this.net.drop(existing.cid);
      }
      existing.cid = cid;
      existing.info.online = true;
      this.sim.inactive.delete(existing.info.id);
      existing.info.name = name;
      this.byCid.set(cid, existing.info.id);
      return null;
    }
    if (this.humans().length >= MAX_HUMANS) return 'full';
    const team = this.pickTeam(h.team);
    if (team === null) return 'full';
    const s = this.addSlot({ name, team, bot: false, online: true, link: 'relay' }, h.token);
    s.cid = cid;
    this.byCid.set(cid, s.info.id);
    return null;
  }

  /** 无大屏模式：把本机作为一名球员加入 */
  addLocal(name: string, team: Team | 'auto') {
    const t = this.pickTeam(team) ?? 0;
    const s = this.addSlot({ name: name.slice(0, 12), team: t, bot: false, online: true, link: 'local' }, null);
    this.localPid = s.info.id;
    this.rosterChanged();
    return s.info.id;
  }

  setLocalInput(inp: Input) {
    if (this.localPid >= 0) this.sim.setInput(this.localPid, inp);
  }

  /** 该队还能再放几个人（真人之外的空位） */
  private roomLeft(team: Team) {
    return Math.max(0, CONFIG.maxPerTeam - this.humans(team).length);
  }

  private botCount(team: Team) {
    return [...this.slots.values()].filter((s) => s.info.bot && s.info.team === team).length;
  }

  /** 每队应有的 AI 数：自动补位按人数差计算，手动模式按设置值；人+AI 不超过每队上限 */
  private wantBots(team: Team) {
    const room = this.roomLeft(team);
    if (this.settings.autoFill) {
      const target = Math.min(CONFIG.maxPerTeam, Math.max(1, this.humans(0).length, this.humans(1).length));
      return Math.min(room, Math.max(0, target - this.humans(team).length));
    }
    return Math.min(room, this.settings.bots[team]);
  }

  private rebalanceBots() {
    for (const team of [0, 1] as Team[]) {
      const bots = [...this.slots.values()].filter((s) => s.info.bot && s.info.team === team);
      const want = this.wantBots(team);
      while (bots.length > want) this.removeSlot(bots.pop()!.info.id);
      for (let i = bots.length; i < want; i++) {
        const used = new Set([...this.slots.values()].map((s) => s.info.name));
        const name = BOT_NAMES.find((n) => !used.has(n + '(AI)')) ?? 'AI';
        this.addSlot({ name: name + '(AI)', team, bot: true, online: true, link: 'bot' }, null);
      }
    }
  }

  /** 手动增减某队 AI；在自动补位模式下点击会切换为手动，并以当前数量为起点 */
  changeBots(team: Team, delta: 1 | -1) {
    if (this.inMatch()) return;
    if (this.settings.autoFill) {
      this.settings.autoFill = false;
      this.settings.bots = [this.botCount(0), this.botCount(1)];
    }
    const room = this.roomLeft(team);
    this.settings.bots[team] = Math.max(0, Math.min(room, this.botCount(team) + delta));
    this.rosterChanged();
  }

  private need(team: Team) {
    // 严格过半：1 人 1 票，2 人需 2 票，3 人需 2 票，4 人需 3 票
    return Math.floor(this.humans(team).filter((s) => s.info.online).length / 2) + 1;
  }

  /** 转让房主：只能给在线真人（大屏直接调用，手机房主经 command 校验后调用） */
  setOwner(pid: number) {
    const s = this.slots.get(pid);
    if (!s || s.info.bot || !s.info.online) return;
    this.ownerOverride = pid;
    this.rosterChanged();
  }

  /** 移出成员（大屏直接调用，手机房主经 command 校验后调用）；本机球员不能移出 */
  kick(pid: number) {
    const s = this.slots.get(pid);
    if (!s || s.info.link === 'local') return;
    if (s.info.bot) {
      // 删掉指定的 AI：转为手动 AI 数量，否则自动补位会马上补回来
      if (this.inMatch()) return;
      const team = s.info.team;
      this.settings.autoFill = false;
      this.settings.bots = [this.botCount(0), this.botCount(1)];
      this.settings.bots[team] = Math.max(0, this.settings.bots[team] - 1);
      this.removeSlot(pid);
      this.rosterChanged();
      return;
    }
    if (s.token) this.kicked.add(s.token);
    const cid = s.cid;
    this.removeSlot(pid);
    if (cid) this.net.kick(cid, 'kicked');
    this.rosterChanged();
  }

  /** 房主：手机开房时是本机；大屏模式下是最早加入且在线的真人，掉线后顺延给下一位 */
  ownerPid(): number {
    const o = this.ownerOverride !== null ? this.slots.get(this.ownerOverride) : undefined;
    if (o?.info.online) return o.info.id;
    if (this.localPid >= 0) return this.localPid;
    for (const s of this.slots.values()) if (!s.info.bot && s.info.online) return s.info.id;
    return -1;
  }

  rosterMsg(): RosterMsg {
    for (const team of [0, 1] as Team[]) {
      this.sim.teamPlayers(team).forEach((p, i) => {
        const s = this.slots.get(p.id);
        if (s) s.info.num = i + 1;
      });
    }
    return {
      t: 'roster',
      players: [...this.slots.values()].map((s) => s.info),
      settings: { ...this.settings, bots: [...this.settings.bots] as [number, number] },
      votes: [[...this.votes[0]], [...this.votes[1]]],
      need: [this.need(0), this.need(1)],
      end: this.endInfo,
      hostPid: this.ownerPid(),
    };
  }

  // ---------- 公开大厅 ----------
  /** 内容变化时发布；force 用于心跳刷新时间戳 */
  private publishInfo(force = false) {
    this.lobby.publish(
      {
        host: this.slots.get(this.localPid)?.info.name ?? '',
        n: this.humans().filter((s) => s.info.online).length,
        max: MAX_HUMANS,
        playing: this.inMatch(),
        lock: !!this.opts.pin,
      },
      force,
    );
  }

  rosterChanged() {
    this.publishInfo();
    this.rebalanceBots();
    const msg = this.rosterMsg();
    this.net.broadcastJson(msg);
    this.onLocal(msg);
    this.onRoster(msg);
  }

  private sendTo(pid: number, msg: HostMsg) {
    const s = this.slots.get(pid);
    if (!s) return;
    if (s.info.link === 'local') this.onLocal(msg);
    else if (s.cid) this.net.sendJson(s.cid, msg);
  }

  private broadcast(msg: HostMsg) {
    this.net.broadcastJson(msg);
    if (this.localPid >= 0) this.onLocal(msg);
  }

  // ---------- 指令 ----------
  /** 处理来自远程手机或本机球员的指令 */
  command(pid: number, msg: any) {
    const s = this.slots.get(pid);
    if (!s) return;
    switch (msg.t) {
      case 'team': {
        const team: Team = msg.team === 1 ? 1 : 0;
        if (team !== s.info.team && this.humans(team).length < CONFIG.maxPerTeam) {
          this.votes[s.info.team].delete(pid);
          s.info.team = team;
          this.sim.setTeam(pid, team);
          this.rosterChanged();
        }
        break;
      }
      case 'name':
        s.info.name = String(msg.name || t('player.default')).slice(0, 12);
        this.rosterChanged();
        break;
      case 'start':
        if (pid === this.ownerPid()) this.startMatch();
        break;
      case 'surrender':
        this.vote(s);
        break;
      case 'settings':
        if (pid === this.ownerPid() && msg.patch && typeof msg.patch === 'object') this.setSettings(msg.patch);
        break;
      case 'owner':
        if (pid === this.ownerPid()) this.setOwner(Number(msg.pid));
        break;
      case 'kick':
        if (pid === this.ownerPid() && Number(msg.pid) !== pid) this.kick(Number(msg.pid));
        break;
      case 'bot':
        if (pid === this.ownerPid()) this.changeBots(msg.team === 1 ? 1 : 0, msg.delta === 1 ? 1 : -1);
        break;
    }
  }

  private inMatch() {
    const p = this.sim.phase;
    return p === Phase.Ready || p === Phase.Playing || p === Phase.Goal;
  }

  /** 投降投票：本队在线真人严格过半同意即判负；再次点击撤回 */
  private vote(s: Slot) {
    if (!this.inMatch()) return;
    const team = s.info.team;
    const set = this.votes[team];
    const cancel = set.has(s.info.id);
    if (cancel) set.delete(s.info.id);
    else set.add(s.info.id);
    const need = this.need(team);
    if (set.size >= need) {
      this.endMatch('surrender', team === 0 ? 1 : 0);
      return;
    }
    this.broadcast({ t: 'ev', k: 'vote', team, name: s.info.name, n: set.size, need, cancel });
    this.rosterChanged();
  }

  /** 比赛进行中不允许改设置；来自手机的值会被校验 */
  setSettings(p: Partial<Settings>) {
    if (this.inMatch()) return;
    const st = this.settings;
    if (p.duration !== undefined && DURATIONS.includes(Number(p.duration))) st.duration = Number(p.duration);
    const level = Number(p.level) as BotLevel;
    if (p.level !== undefined && BOT_LEVELS.includes(level)) st.level = level;
    if (p.autoFill !== undefined) {
      st.autoFill = !!p.autoFill;
      // 关掉自动补位时保留当前的 AI 数量
      if (!st.autoFill) st.bots = [this.botCount(0), this.botCount(1)];
    }
    this.rosterChanged();
  }

  startMatch() {
    if (this.sim.phase !== Phase.Lobby && this.sim.phase !== Phase.Ended) return;
    this.votes = [new Set(), new Set()];
    this.endInfo = null;
    this.goalText = '';
    this.rebalanceBots();
    this.sim.startMatch(this.settings.duration);
    this.rosterChanged();
  }

  /** 主动结束比赛；winner 不传则按比分判定 */
  endMatch(reason: EndReason = 'host', winner?: Team) {
    if (!this.inMatch()) return;
    this.pendingEnd = { reason, winner: winner ?? this.scoreWinner() };
    this.sim.forceEnd();
  }

  toLobby() {
    this.sim.toLobby();
    this.votes = [new Set(), new Set()];
    this.endInfo = null;
    this.rosterChanged();
  }

  private scoreWinner(): Team | -1 {
    const [a, b] = this.sim.score;
    return a === b ? -1 : a > b ? 0 : 1;
  }

  // ---------- 主循环 ----------
  private startLoops() {
    let acc = 0;
    let last = performance.now();
    let lastPhase: Phase = this.sim.phase;
    const sim = this.sim;
    this.timers.push(
      window.setInterval(() => {
        const now = performance.now();
        acc += Math.min(250, now - last) / 1000;
        last = now;
        while (acc >= DT) {
          for (const s of this.slots.values()) {
            if (!s.info.bot) continue;
            const p = sim.players.get(s.info.id);
            if (p) sim.setInput(p.id, botInput(sim, p, DT, this.settings.level));
          }
          sim.step(DT);
          acc -= DT;
          this.handleEvents();
          if (sim.tick % 2 === 0) this.net.broadcastFast(encodeSnapshot(sim.snapshot()));
          if (sim.phase !== lastPhase) {
            lastPhase = sim.phase;
            this.onPhase(sim.phase);
            this.publishInfo();
          }
        }
      }, 4),
    );
    // 掉线超时清理：大厅 15 秒，比赛中 90 秒
    this.timers.push(
      window.setInterval(() => {
        const now = performance.now();
        const limit = sim.phase === Phase.Lobby ? 15000 : 90000;
        let changed = false;
        for (const s of [...this.slots.values()]) {
          if (!s.info.bot && !s.info.online && now - s.offlineAt > limit) {
            this.removeSlot(s.info.id);
            changed = true;
          }
        }
        if (changed) this.rosterChanged();
      }, 1000),
      window.setInterval(() => this.publishInfo(true), LOBBY_HEARTBEAT_MS),
    );
  }

  private handleEvents() {
    const sim = this.sim;
    for (const ev of sim.events) {
      switch (ev.k) {
        case 'kick':
          sfxKick(ev.power);
          this.sendTo(ev.id, { t: 'ev', k: 'kick' });
          break;
        case 'tackled':
          sfxKick(300);
          this.sendTo(ev.id, { t: 'ev', k: 'tackled' });
          break;
        case 'whistle':
          sfxWhistle();
          break;
        case 'goal': {
          sfxGoal();
          const scorer = this.slots.get(ev.scorer)?.info.name ?? '';
          this.goalText = goalText(ev.team, scorer, ev.own);
          this.broadcast({ t: 'ev', k: 'goal', team: ev.team, scorer, own: ev.own });
          break;
        }
        case 'end': {
          sfxWhistle(true);
          const p = this.pendingEnd ?? { reason: 'time' as const, winner: this.scoreWinner() };
          this.pendingEnd = null;
          this.endInfo = { score: [sim.score[0], sim.score[1]], ...p };
          this.broadcast({ t: 'ev', k: 'end', ...this.endInfo });
          this.rosterChanged();
          break;
        }
      }
    }
    sim.events.length = 0;
  }

  view(meId: number): ViewState {
    const r = this.rosterMsg();
    return { ...this.sim.snapshot(), info: new Map(r.players.map((p) => [p.id, p])), meId, goalText: this.goalText };
  }

  close() {
    this.lobby.clear();
    this.timers.forEach(clearInterval);
    this.net.close();
  }
}

export function resultTitle(e: EndInfo) {
  return e.winner === -1 ? t('end.draw') : t('end.win', { team: TEAM_NAME[e.winner] });
}

export function endReasonText(e: EndInfo) {
  // 投降方是输的一方
  return e.reason === 'surrender' ? t('end.surrender', { team: TEAM_NAME[e.winner === 0 ? 1 : 0] }) : t(`end.${e.reason}`);
}
