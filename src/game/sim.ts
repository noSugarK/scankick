import {
  BTN_A,
  BTN_B,
  BTN_X,
  BTN_Y,
  FLAG_CHARGE,
  FLAG_SPRINT,
  FLAG_STUN,
  FLAG_TACKLE,
  Phase,
  type Input,
  type MatchMode,
  type PartyRule,
  type EndReason,
  type Snapshot,
  type Team,
} from './types';

/** 球场尺寸（世界坐标，原点在中圈） */
export const F = {
  HL: 560, // 半场长
  HW: 300, // 半场宽
  GW: 80, // 球门半宽
  GD: 44, // 球门深度
  MARGIN: 46, // 边线外可跑动区域
  PR: 17, // 球员半径
  BR: 10, // 球半径
  POST_R: 6,
  CENTER_R: 80,
  BOX_D: 130, // 禁区深度
  BOX_W: 180, // 禁区半宽
};

const WALK = 205;
const SPRINT_MUL = 1.45;
const ACCEL = 10; // 速度趋近目标的速率（越大越跟手）
const BALL_DAMP = 0.55; // 球每秒保留的速度比例
export const ballRadius = (party: PartyRule) => party === 1 ? F.BR * 2 : F.BR;
const SHOT_MIN = 430;
const SHOT_MAX = 1060;
const CHARGE_TIME = 0.85;

export type SimEvent =
  /** assist：进球前本队最后一个传给射手的人，没有为 -1 */
  | { k: 'goal'; team: Team; scorer: number; own: boolean; assist: number }
  /** shot：用射门键朝对方球门方向踢出 */
  | { k: 'kick'; id: number; power: number; shot: boolean }
  | { k: 'tackled'; id: number; by: number }
  | { k: 'whistle' }
  | { k: 'end' };

export interface SimPlayer {
  id: number;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  input: Input;
  inputQueue: Input[];
  prevBtn: number;
  stamina: number;
  exhausted: boolean;
  charge: number; // <0 表示未蓄力
  kickBuf: number;
  kickPower: number;
  passBuf: number;
  tackleT: number;
  tackleCd: number;
  stunT: number;
  kickCd: number;
  slot: number; // 阵型位置
}

const NO_INPUT: Input = { jx: 0, jy: 0, btn: 0 };

// 阵型：x 为半场长比例（己方半场为负），y 为半场宽比例；第一个最靠后
const FORMATIONS: [number, number][][] = [
  [],
  [[-0.45, 0]],
  [[-0.6, 0], [-0.24, 0]],
  [[-0.86, 0], [-0.45, -0.4], [-0.45, 0.4]],
  [[-0.86, 0], [-0.55, -0.38], [-0.55, 0.38], [-0.24, 0]],
];

export function homeSpot(team: Team, slot: number, count: number): [number, number] {
  const f = FORMATIONS[Math.max(1, Math.min(4, count))];
  const [fx, fy] = f[Math.min(slot, f.length - 1)];
  const s = team === 0 ? 1 : -1;
  return [fx * F.HL * s, fy * F.HW];
}

export class Sim {
  mode: MatchMode = 0;
  party: PartyRule = 0;
  get ballRadius() { return ballRadius(this.party); }
  golden = false;
  endReason: EndReason = 'time';
  tick = 0;
  phase: Phase = Phase.Lobby;
  phaseTime = 0;
  timeLeft = 180;
  duration = 180;
  score: [number, number] = [0, 0];
  // prevTouch：上一个（不同的）触球者，用来算助攻
  ball = { x: 0, y: 0, vx: 0, vy: 0, lastTouch: -1, lastTeam: -1 as Team | -1, prevTouch: -1, prevTeam: -1 as Team | -1 };
  players = new Map<number, SimPlayer>();
  kickoffTeam: Team = 0;
  kickoffPending = false;
  events: SimEvent[] = [];
  /** 掉线等不会操作的球员，AI 安排抢球时会跳过他们 */
  inactive = new Set<number>();

  addPlayer(id: number, team: Team) {
    const p: SimPlayer = {
      id,
      team,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: team === 0 ? 0 : Math.PI,
      input: NO_INPUT,
      inputQueue: [],
      prevBtn: 0,
      stamina: 1,
      exhausted: false,
      charge: -1,
      kickBuf: 0,
      kickPower: 0,
      passBuf: 0,
      tackleT: 0,
      tackleCd: 0,
      stunT: 0,
      kickCd: 0,
      slot: 0,
    };
    this.players.set(id, p);
    this.reslot();
    // 新人从己方半场边线入场
    const [hx] = homeSpot(team, p.slot, this.teamPlayers(team).length);
    p.x = hx;
    p.y = -F.HW - F.MARGIN / 2;
    if (this.phase === Phase.Ready) this.placeAll();
    return p;
  }

  removePlayer(id: number) {
    this.players.delete(id);
    this.inactive.delete(id);
    this.reslot();
  }

  setTeam(id: number, team: Team) {
    const p = this.players.get(id);
    if (!p || p.team === team) return;
    p.team = team;
    this.reslot();
  }

  setInput(id: number, input: Input) {
    const p = this.players.get(id);
    if (!p) return;
    // 保留两次物理帧之间的按下/松开，移动状态仍直接覆盖。
    if (input.btn !== p.input.btn) {
      // 最多缓存约半秒的按键变化，防止异常客户端无限堆积。
      if (p.inputQueue.length >= 32) p.inputQueue[31] = { ...input };
      else p.inputQueue.push({ ...input });
    }
    p.input = { ...input };
  }

  teamPlayers(team: Team) {
    return [...this.players.values()].filter((p) => p.team === team).sort((a, b) => a.slot - b.slot || a.id - b.id);
  }

  private reslot() {
    for (const team of [0, 1] as Team[]) {
      const list = [...this.players.values()].filter((p) => p.team === team).sort((a, b) => a.id - b.id);
      list.forEach((p, i) => (p.slot = i));
    }
  }

  startMatch(duration: number, mode: MatchMode = 0, party: PartyRule = 0) {
    this.mode = mode;
    this.party = party;
    this.golden = false;
    this.endReason = 'time';
    this.duration = duration;
    this.timeLeft = duration;
    this.score = [0, 0];
    for (const p of this.players.values()) {
      p.stamina = 1;
      p.exhausted = false;
    }
    this.kickoffTeam = Math.random() < 0.5 ? 0 : 1;
    this.resetForKickoff();
  }

  /** 主动结束（投降 / 房主结束） */
  forceEnd() {
    if (this.phase === Phase.Lobby || this.phase === Phase.Ended) return;
    this.phase = Phase.Ended;
    this.phaseTime = 0;
    this.events.push({ k: 'end' });
  }

  toLobby() {
    this.golden = false;
    this.phase = Phase.Lobby;
    this.phaseTime = 0;
    this.kickoffPending = false;
    this.score = [0, 0];
    this.timeLeft = this.duration;
  }

  private resetForKickoff() {
    this.placeAll();
    this.phase = Phase.Ready;
    this.phaseTime = 0;
    this.kickoffPending = true;
  }

  private placeAll() {
    Object.assign(this.ball, { x: 0, y: 0, vx: 0, vy: 0, lastTouch: -1, lastTeam: -1, prevTouch: -1, prevTeam: -1 });
    for (const team of [0, 1] as Team[]) {
      const list = this.teamPlayers(team);
      list.forEach((p, i) => {
        let [x, y] = homeSpot(team, i, list.length);
        // 开球方的最后一名（前锋）站在球旁边
        if (team === this.kickoffTeam && i === list.length - 1) {
          x = (team === 0 ? -1 : 1) * (F.PR + this.ballRadius + 4);
          y = 0;
        }
        Object.assign(p, { x, y, vx: 0, vy: 0, angle: team === 0 ? 0 : Math.PI, charge: -1, tackleT: 0, stunT: 0 });
      });
    }
  }

  step(dt: number) {
    this.tick++;
    this.phaseTime += dt;
    const frozen = this.phase === Phase.Ready || this.phase === Phase.Ended;

    for (const p of this.players.values()) this.updatePlayer(p, dt, frozen);

    if (!frozen) {
      for (const p of this.players.values()) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      const b = this.ball;
      const damp = Math.pow(this.party === 3 ? 0.85 : BALL_DAMP, dt);
      b.vx *= damp;
      b.vy *= damp;

      this.collidePlayers();
      // 每次最多移动半个球半径，避免高速球穿过门柱或底线。
      let remaining = dt;
      while (remaining > 0) {
        const part = Math.min(remaining, this.ballRadius / 2 / Math.max(1, Math.hypot(b.vx, b.vy)));
        const prevX = b.x;
        const prevY = b.y;
        b.x += b.vx * part;
        b.y += b.vy * part;
        for (const p of this.players.values()) this.collidePlayerBall(p);
        this.collidePosts();
        this.constrainBall(prevX, prevY);
        remaining -= part;
      }
      for (const p of this.players.values()) this.tryKick(p);
      for (const p of this.players.values()) this.constrainPlayer(p);
    }

    this.updatePhase(dt);
  }

  private updatePlayer(p: SimPlayer, dt: number, frozen: boolean) {
    if (this.party === 2) {
      p.stamina = 1;
      p.exhausted = false;
    }
    const inp = frozen ? NO_INPUT : (p.inputQueue.shift() ?? p.input);
    if (frozen) p.inputQueue.length = 0;
    const pressed = inp.btn & ~p.prevBtn;
    const released = ~inp.btn & p.prevBtn;
    p.prevBtn = inp.btn;

    p.kickCd = Math.max(0, p.kickCd - dt);
    p.tackleCd = Math.max(0, p.tackleCd - dt);
    p.kickBuf = Math.max(0, p.kickBuf - dt);
    p.passBuf = Math.max(0, p.passBuf - dt);

    let jx = inp.jx;
    let jy = inp.jy;
    const mag = Math.hypot(jx, jy);
    if (mag > 1) {
      jx /= mag;
      jy /= mag;
    }

    if (p.stunT > 0) {
      p.stunT -= dt;
      p.charge = -1;
      const k = Math.min(1, 4 * dt);
      p.vx -= p.vx * k;
      p.vy -= p.vy * k;
      return;
    }

    if (p.tackleT > 0) {
      p.tackleT -= dt;
      const k = Math.pow(0.2, dt);
      p.vx *= k;
      p.vy *= k;
      return;
    }

    if (mag > 0.2) p.angle = Math.atan2(jy, jx);

    // 射门：按下开始蓄力，松开出脚（带 0.15s 缓冲，球稍晚到脚下也能踢到）
    if (pressed & BTN_B) p.charge = 0;
    if (p.charge >= 0 && inp.btn & BTN_B) p.charge = Math.min(1, p.charge + dt / CHARGE_TIME);
    if (released & BTN_B && p.charge >= 0) {
      p.kickPower = SHOT_MIN + (SHOT_MAX - SHOT_MIN) * p.charge;
      p.kickBuf = 0.15;
      p.charge = -1;
    }
    if (pressed & BTN_A) p.passBuf = 0.2;

    if (pressed & BTN_Y && p.tackleCd <= 0) {
      p.tackleT = 0.24;
      p.tackleCd = 1.4;
      p.charge = -1;
      p.vx = Math.cos(p.angle) * 540;
      p.vy = Math.sin(p.angle) * 540;
      return;
    }

    const charging = p.charge >= 0;
    if (p.stamina <= 0.02) p.exhausted = true;
    if (p.exhausted && p.stamina > 0.3) p.exhausted = false;
    const sprint = !!(inp.btn & BTN_X) && !p.exhausted && mag > 0.2 && !charging;
    if (sprint && this.party !== 2) p.stamina = Math.max(0, p.stamina - 0.4 * dt);
    else p.stamina = Math.min(1, p.stamina + 0.22 * dt);

    let max = WALK * (sprint ? SPRINT_MUL : 1) * (charging ? 0.7 : 1);
    if (p.tackleCd > 1.0) max *= 0.5; // 铲完短暂硬直
    const k = Math.min(1, ACCEL * dt);
    p.vx += (jx * max - p.vx) * k;
    p.vy += (jy * max - p.vy) * k;
  }

  private collidePlayers() {
    const list = [...this.players.values()];
    const minD = F.PR * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d === 0) continue;
        dx /= d;
        dy /= d;
        const pen = (minD - d) / 2;
        a.x -= dx * pen;
        a.y -= dy * pen;
        b.x += dx * pen;
        b.y += dy * pen;
        const vn = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
        if (vn < 0) {
          const imp = (-(1 + 0.4) * vn) / 2;
          a.vx -= imp * dx;
          a.vy -= imp * dy;
          b.vx += imp * dx;
          b.vy += imp * dy;
        }
        this.tackleHit(a, b);
        this.tackleHit(b, a);
      }
    }
  }

  private tackleHit(a: SimPlayer, b: SimPlayer) {
    if (a.tackleT <= 0 || a.team === b.team || b.stunT > 0) return;
    b.stunT = 0.6;
    b.vx += a.vx * 0.5;
    b.vy += a.vy * 0.5;
    a.tackleT = 0;
    this.events.push({ k: 'tackled', id: b.id, by: a.id });
  }

  private collidePlayerBall(p: SimPlayer) {
    const b = this.ball;
    let dx = b.x - p.x;
    let dy = b.y - p.y;
    const d = Math.hypot(dx, dy);
    const minD = F.PR + this.ballRadius;
    if (d >= minD) return;
    if (d === 0) {
      dx = Math.cos(p.angle);
      dy = Math.sin(p.angle);
    } else {
      dx /= d;
      dy /= d;
    }
    b.x = p.x + dx * minD;
    b.y = p.y + dy * minD;
    this.touch(p);
    if (p.tackleT > 0) {
      // 铲球：把球捅向前方
      const s = 560;
      b.vx = Math.cos(p.angle) * s * 0.8 + dx * s * 0.2;
      b.vy = Math.sin(p.angle) * s * 0.8 + dy * s * 0.2;
      return;
    }
    const vn = (b.vx - p.vx) * dx + (b.vy - p.vy) * dy;
    if (vn < 0) {
      // 球员质量 5，球质量 1，恢复系数 0.5
      const imp = -(1 + 0.5) * vn * (5 / 6);
      b.vx += imp * dx;
      b.vy += imp * dy;
      p.vx -= (imp / 5) * dx;
      p.vy -= (imp / 5) * dy;
    }
  }

  private touch(p: SimPlayer) {
    const b = this.ball;
    if (b.lastTouch !== p.id) {
      b.prevTouch = b.lastTouch;
      b.prevTeam = b.lastTeam;
    }
    this.ball.lastTouch = p.id;
    this.ball.lastTeam = p.team;
    if (this.kickoffPending && this.phase === Phase.Playing) this.kickoffPending = false;
  }

  private tryKick(p: SimPlayer) {
    if ((p.kickBuf <= 0 && p.passBuf <= 0) || p.kickCd > 0 || p.stunT > 0) return;
    const b = this.ball;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > F.PR + this.ballRadius + 9) return;
    const fx = Math.cos(p.angle);
    const fy = Math.sin(p.angle);
    let dirX: number;
    let dirY: number;
    let speed: number;
    const kick = p.kickBuf > 0;
    if (kick) {
      // 主要沿朝向，略带“脚-球”方向，更符合直觉
      dirX = fx * 0.8 + (dx / (d || 1)) * 0.2;
      dirY = fy * 0.8 + (dy / (d || 1)) * 0.2;
      speed = p.kickPower;
    } else {
      const target = this.passTarget(p, fx, fy);
      if (target) {
        dirX = target[0] - b.x;
        dirY = target[1] - b.y;
        const dist = Math.hypot(dirX, dirY);
        speed = Math.max(380, Math.min(860, 240 + dist * 1.7));
      } else {
        dirX = fx;
        dirY = fy;
        speed = 480;
      }
    }
    const n = Math.hypot(dirX, dirY) || 1;
    b.vx = (dirX / n) * speed;
    b.vy = (dirY / n) * speed;
    p.kickBuf = 0;
    p.passBuf = 0;
    p.kickCd = 0.25;
    this.touch(p);
    // 朝对方球门方向（红队向右）的射门才算一次射门
    const shot = kick && (p.team === 0 ? dirX > 0 : dirX < 0);
    this.events.push({ k: 'kick', id: p.id, power: speed, shot });
  }

  /** 在朝向扇区内挑选最合适的队友，带提前量 */
  private passTarget(p: SimPlayer, fx: number, fy: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const t of this.players.values()) {
      if (t === p || t.team !== p.team) continue;
      const tx = t.x + t.vx * 0.3;
      const ty = t.y + t.vy * 0.3;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 40) continue;
      const cos = (dx * fx + dy * fy) / d;
      if (cos < 0.5) continue;
      const score = cos * 2 - d / 900;
      if (score > bestScore) {
        bestScore = score;
        best = [tx, ty];
      }
    }
    return best;
  }

  private collidePosts() {
    const posts = [
      [-F.HL, -F.GW],
      [-F.HL, F.GW],
      [F.HL, -F.GW],
      [F.HL, F.GW],
    ];
    const b = this.ball;
    for (const [px, py] of posts) {
      circleStatic(b, this.ballRadius, px, py, F.POST_R, this.party === 3 ? 0.95 : 0.6);
      for (const p of this.players.values()) circleStatic(p, F.PR, px, py, F.POST_R, 0.2);
    }
  }

  private constrainBall(prevX: number, prevY: number) {
    const b = this.ball;
    const r = this.ballRadius;
    const bounce = this.party === 3 ? 0.95 : 0.7;
    // 先检查进入球门的轨迹，再约束球网内部；不能把底线外的球夹进门。
    if (Math.abs(prevX) <= F.HL && Math.abs(b.x) > F.HL - r) {
      const wallX = Math.sign(b.x) * (F.HL - r);
      const k = Math.max(0, Math.min(1, (wallX - prevX) / (b.x - prevX || 1)));
      const entryY = prevY + (b.y - prevY) * k;
      if (Math.abs(entryY) > F.GW - r) {
        b.x = wallX;
        if (b.vx * Math.sign(wallX) > 0) b.vx *= -bounce;
      }
    }
    const inGoal = Math.abs(b.x) > F.HL;
    if (inGoal) {
      // 球网内部
      const s = Math.sign(b.x);
      const maxY = F.GW - r;
      if (Math.abs(b.y) > maxY) {
        b.y = Math.sign(b.y) * maxY;
        b.vy *= -0.3;
      }
      const maxX = F.HL + F.GD - r;
      if (Math.abs(b.x) > maxX) {
        b.x = s * maxX;
        b.vx *= -0.2;
      }
    } else {
      if (Math.abs(b.y) > F.HW - r) {
        b.y = Math.sign(b.y) * (F.HW - r);
        b.vy *= -bounce;
      }
      if (Math.abs(b.x) > F.HL - r && Math.abs(b.y) > F.GW) {
        b.x = Math.sign(b.x) * (F.HL - r);
        b.vx *= -bounce;
      }
    }
  }

  private constrainPlayer(p: SimPlayer) {
    const mx = F.HL + F.MARGIN - F.PR;
    const my = F.HW + F.MARGIN - F.PR;
    if (Math.abs(p.x) > mx) {
      p.x = Math.sign(p.x) * mx;
      p.vx = 0;
    }
    if (Math.abs(p.y) > my) {
      p.y = Math.sign(p.y) * my;
      p.vy = 0;
    }
    // 球员不能进入球门
    const penX = Math.abs(p.x) - (F.HL - F.PR * 0.2);
    const penY = F.GW + F.PR - Math.abs(p.y);
    if (penX > 0 && penY > 0) {
      if (penX < penY) {
        p.x -= Math.sign(p.x) * penX;
        p.vx = 0;
      } else {
        p.y += Math.sign(p.y || 1) * penY;
        p.vy = 0;
      }
    }
    // 开球前：双方留在本方半场，防守方不得进入中圈
    if (this.kickoffPending && this.phase === Phase.Playing) {
      const s = p.team === 0 ? -1 : 1;
      if (p.x * s < 0) {
        p.x = 0;
        p.vx = 0;
      }
      if (p.team !== this.kickoffTeam) {
        const d = Math.hypot(p.x, p.y);
        const minD = F.CENTER_R + F.PR;
        if (d < minD) {
          const k = minD / (d || 1);
          p.x = d ? p.x * k : s * minD;
          p.y *= d ? k : 0;
        }
      }
    }
  }

  private updatePhase(dt: number) {
    const b = this.ball;
    const crossed = Math.abs(b.x) > F.HL + this.ballRadius && Math.abs(b.y) <= F.GW - this.ballRadius;
    switch (this.phase) {
      case Phase.Lobby:
        // 大厅热身：进球不计分，球回到中圈
        if (crossed) Object.assign(b, { x: 0, y: 0, vx: 0, vy: 0 });
        break;
      case Phase.Ready:
        if (this.phaseTime >= 1.5) {
          this.phase = Phase.Playing;
          this.phaseTime = 0;
          this.events.push({ k: 'whistle' });
        }
        break;
      case Phase.Playing:
        // 开球方 5 秒内没人触球（掉线或挂机），解除开球站位限制，避免卡死
        if (this.kickoffPending && this.phaseTime > 5) this.kickoffPending = false;
        if (this.mode !== 1 && !this.golden) this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (crossed) {
          const team: Team = b.x > 0 ? 0 : 1;
          this.score[team]++;
          if (this.mode === 1 && this.score[team] >= 3) this.endReason = 'target';
          if (this.golden) this.endReason = 'golden';
          const own = b.lastTeam !== -1 && b.lastTeam !== team;
          const assist = !own && b.prevTeam === team ? b.prevTouch : -1;
          this.events.push({ k: 'goal', team, scorer: b.lastTouch, own, assist });
          this.kickoffTeam = team === 0 ? 1 : 0;
          this.phase = Phase.Goal;
          this.phaseTime = 0;
        } else if (this.mode !== 1 && !this.golden && this.timeLeft <= 0) this.finishOrOvertime();
        break;
      case Phase.Goal:
        if (this.phaseTime >= 3) {
          if (this.endReason === 'target' || this.endReason === 'golden') this.forceEnd();
          else if (this.mode !== 1 && this.timeLeft <= 0) this.finishOrOvertime();
          else this.resetForKickoff();
        }
        break;
    }
  }

  private finishOrOvertime() {
    if (this.mode === 2 && this.score[0] === this.score[1]) {
      this.golden = true;
      this.resetForKickoff();
    } else this.forceEnd();
  }

  snapshot(): Snapshot {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      angle: p.angle,
      flags:
        (p.input.btn & BTN_X && p.stamina > 0 && !p.exhausted && Math.hypot(p.vx, p.vy) > WALK * 1.05 ? FLAG_SPRINT : 0) |
        (p.tackleT > 0 ? FLAG_TACKLE : 0) |
        (p.stunT > 0 ? FLAG_STUN : 0) |
        (p.charge >= 0 ? FLAG_CHARGE : 0),
      stamina: p.stamina,
      charge: Math.max(0, p.charge),
    }));
    return {
      mode: this.mode,
      golden: this.golden,
      party: this.party,
      tick: this.tick,
      phase: this.phase,
      score: [this.score[0], this.score[1]],
      timeLeft: this.timeLeft,
      phaseTime: this.phaseTime,
      ball: { x: this.ball.x, y: this.ball.y, vx: this.ball.vx, vy: this.ball.vy },
      players,
    };
  }
}

function circleStatic(o: { x: number; y: number; vx: number; vy: number }, r: number, px: number, py: number, pr: number, e: number) {
  let dx = o.x - px;
  let dy = o.y - py;
  const d = Math.hypot(dx, dy);
  const minD = r + pr;
  if (d >= minD || d === 0) return;
  dx /= d;
  dy /= d;
  o.x = px + dx * minD;
  o.y = py + dy * minD;
  const vn = o.vx * dx + o.vy * dy;
  if (vn < 0) {
    o.vx -= (1 + e) * vn * dx;
    o.vy -= (1 + e) * vn * dy;
  }
}

/** 本地预测用：只模拟自身移动，不含碰撞 */
export function predictMove(
  s: { vx: number; vy: number },
  inp: Input,
  dt: number,
  charging: boolean,
  canSprint: boolean,
) {
  let { jx, jy } = inp;
  const mag = Math.hypot(jx, jy);
  if (mag > 1) {
    jx /= mag;
    jy /= mag;
  }
  const sprint = !!(inp.btn & BTN_X) && canSprint && mag > 0.2 && !charging;
  const max = WALK * (sprint ? SPRINT_MUL : 1) * (charging ? 0.7 : 1);
  const k = Math.min(1, ACCEL * dt);
  s.vx += (jx * max - s.vx) * k;
  s.vy += (jy * max - s.vy) * k;
}
