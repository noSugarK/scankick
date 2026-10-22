import type { Snapshot, SnapPlayer } from '../game/types';
import { F, ballRadius, constrainPlayerBounds } from '../game/sim';

const TICK_MS = 1000 / 60;

interface Entry {
  t: number; // 主机时间（ms）
  recv: number; // 本地接收时间
  s: Snapshot;
}

/** 快照缓冲：按主机时间轴回放，在两帧之间插值，保证网络抖动下画面平滑 */
export class SnapBuffer {
  private buf: Entry[] = [];
  private offsets: number[] = [];
  private lastTick = -1;
  private wraps = 0;
  delay = 60;

  reset() {
    this.buf = [];
    this.offsets = [];
    this.lastTick = -1;
    this.wraps = 0;
  }

  push(s: Snapshot, recv: number) {
    let tick = s.tick + this.wraps * 65536;
    if (this.lastTick >= 0) {
      if (tick < this.lastTick - 30000) {
        this.wraps++;
        tick += 65536;
      } else if (tick < this.lastTick - 120) {
        // 主机重启（刷新页面）
        this.reset();
        tick = s.tick;
      } else if (tick <= this.lastTick) return; // 乱序旧包
    }
    this.lastTick = tick;
    const t = tick * TICK_MS;
    this.offsets.push(recv - t);
    if (this.offsets.length > 90) this.offsets.shift();
    this.buf.push({ t, recv, s });
    if (this.buf.length > 40) this.buf.shift();
  }

  get latest(): Entry | undefined {
    return this.buf[this.buf.length - 1];
  }

  private offset() {
    let m = Infinity;
    for (const o of this.offsets) if (o < m) m = o;
    return m;
  }

  sample(now: number): Snapshot | null {
    const n = this.buf.length;
    if (!n) return null;
    const rt = now - this.offset() - this.delay;
    const last = this.buf[n - 1];
    if (rt >= last.t || n === 1) return extrapolate(last.s, Math.min(100, Math.max(0, rt - last.t)) / 1000);
    let i = n - 2;
    while (i > 0 && this.buf[i].t > rt) i--;
    const a = this.buf[i];
    const b = this.buf[i + 1];
    const k = Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t || 1)));
    return lerpSnap(a.s, b.s, k);
  }
}

function extrapolate(s: Snapshot, sec: number): Snapshot {
  return {
    ...s,
    ball: { ...s.ball, x: s.ball.x + s.ball.vx * sec, y: s.ball.y + s.ball.vy * sec },
    players: s.players.map((p) => ({ ...p, x: p.x + p.vx * sec, y: p.y + p.vy * sec })),
  };
}

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function lerpSnap(a: Snapshot, b: Snapshot, k: number): Snapshot {
  const prev = new Map<number, SnapPlayer>();
  for (const p of a.players) prev.set(p.id, p);
  // 位置跳变过大（开球重置）时直接使用新位置
  const jump = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) > 120;
  const ballJump = jump(a.ball.x, a.ball.y, b.ball.x, b.ball.y);
  return {
    ...b,
    ball: ballJump
      ? { ...b.ball }
      : {
          x: lerp(a.ball.x, b.ball.x, k),
          y: lerp(a.ball.y, b.ball.y, k),
          vx: lerp(a.ball.vx, b.ball.vx, k),
          vy: lerp(a.ball.vy, b.ball.vy, k),
        },
    players: b.players.map((pb) => {
      const pa = prev.get(pb.id);
      if (!pa || jump(pa.x, pa.y, pb.x, pb.y)) return { ...pb };
      return {
        ...pb,
        x: lerp(pa.x, pb.x, k),
        y: lerp(pa.y, pb.y, k),
        vx: lerp(pa.vx, pb.vx, k),
        vy: lerp(pa.vy, pb.vy, k),
        angle: lerpAngle(pa.angle, pb.angle, k),
        charge: lerp(pa.charge, pb.charge, k),
      };
    }),
  };
}

/** 插值、外推和本地预测后，球员展示圆仍须避开球网及门柱。 */
export function separateViewPlayers<T extends Snapshot>(s: T): T {
  let changed = false;
  const players = s.players.map((p) => {
    const next = { ...p };
    constrainPlayerBounds(next);
    if (next.x !== p.x || next.y !== p.y) changed = true;
    return next;
  });
  return changed ? { ...s, players } : s;
}

/** 在场地和球网内校正展示球的位置，避开球员及门柱，不修改权威快照。 */
export function separateViewBall<T extends Snapshot>(s: T): T {
  const r = ballRadius(s.party);
  const rects = [
    { left: -F.HL + r, right: F.HL - r, top: -F.HW + r, bottom: F.HW - r },
    { left: -F.HL - F.GD + r, right: F.HL + F.GD - r, top: -F.GW + r, bottom: F.GW - r },
  ];
  const circles = s.players.map((p) => ({ x: p.x, y: p.y, angle: p.angle, r: F.PR + r }));
  for (const x of [-F.HL, F.HL]) for (const y of [-F.GW, F.GW]) circles.push({ x, y, angle: 0, r: F.POST_R + r });
  const clear = (x: number, y: number) =>
    rects.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) &&
    circles.every((c) => (x - c.x) ** 2 + (y - c.y) ** 2 >= c.r * c.r);
  if (clear(s.ball.x, s.ball.y)) return s;
  let bestX = s.ball.x;
  let bestY = s.ball.y;
  let bestD2 = Infinity;
  const consider = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const d2 = (x - s.ball.x) ** 2 + (y - s.ball.y) ** 2;
    if (d2 >= bestD2 || !clear(x, y)) return;
    bestX = x; bestY = y; bestD2 = d2;
  };
  // ponytail: 最多8名球员，每人最多覆盖一个间距120的点；扩大人数时再扩大此兜底网格。
  for (const x of [-120, 0, 120]) for (const y of [-120, 0, 120]) consider(x, y);
  for (const b of rects) {
    consider(Math.max(b.left, Math.min(b.right, s.ball.x)), Math.max(b.top, Math.min(b.bottom, s.ball.y)));
    for (const x of [b.left, b.right]) for (const y of [b.top, b.bottom]) consider(x, y);
  }
  for (let i = 0; i < circles.length; i++) {
    const a = circles[i];
    // 极小间隙吸收圆交点计算的浮点误差。
    const radius = a.r + 0.0001;
    const dx = s.ball.x - a.x;
    const dy = s.ball.y - a.y;
    const d = Math.hypot(dx, dy);
    consider(a.x + radius * (d ? dx / d : Math.cos(a.angle)), a.y + radius * (d ? dy / d : Math.sin(a.angle)));
    for (const b of rects) {
      for (const x of [b.left, b.right]) {
        const h2 = radius * radius - (x - a.x) ** 2;
        if (h2 >= 0) { const h = Math.sqrt(h2); consider(x, a.y - h); consider(x, a.y + h); }
      }
      for (const y of [b.top, b.bottom]) {
        const h2 = radius * radius - (y - a.y) ** 2;
        if (h2 >= 0) { const h = Math.sqrt(h2); consider(a.x - h, y); consider(a.x + h, y); }
      }
    }
    for (let j = i + 1; j < circles.length; j++) {
      const b = circles[j];
      const br = b.r + 0.0001;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (!d || d > radius + br || d < Math.abs(radius - br)) continue;
      const along = (radius * radius - br * br + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, radius * radius - along * along));
      const mx = a.x + along * dx / d;
      const my = a.y + along * dy / d;
      consider(mx - h * dy / d, my + h * dx / d);
      consider(mx + h * dy / d, my - h * dx / d);
    }
  }
  return { ...s, ball: { ...s.ball, x: bestX, y: bestY } };
}
