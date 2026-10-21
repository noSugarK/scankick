import type { Input, Phase, Snapshot, SnapPlayer } from '../game/types';

export const MSG_INPUT = 1;
export const MSG_SNAP = 2;

const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));

export function encodeInput(seq: number, inp: Input): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  b[0] = MSG_INPUT;
  dv.setUint32(1, seq >>> 0, true);
  dv.setInt8(5, q(inp.jx));
  dv.setInt8(6, q(inp.jy));
  b[7] = inp.btn;
  return b;
}

export function decodeInput(b: Uint8Array): (Input & { seq: number }) | null {
  if (b.length !== 8 || b[0] !== MSG_INPUT) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { seq: dv.getUint32(1, true), jx: dv.getInt8(5) / 127, jy: dv.getInt8(6) / 127, btn: b[7] & 15 };
}

/** 32 位序号回绕后仍可比较；重复包和迟到的旧链路包都忽略。 */
export function newerInput(seq: number, prev: number | undefined): boolean {
  const delta = (seq - (prev ?? seq)) >>> 0;
  return prev === undefined || (delta > 0 && delta < 0x80000000);
}

// 位置 x10 精度 0.1，速度单位 u/s 取整
const HEAD = 19;
const PER = 13;
const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const b = new Uint8Array(HEAD + PER * s.players.length);
  const dv = new DataView(b.buffer);
  b[0] = MSG_SNAP;
  b[1] = s.phase;
  dv.setUint16(2, s.tick & 0xffff, true);
  b[4] = s.score[0];
  b[5] = s.score[1];
  dv.setUint16(6, Math.max(0, Math.min(65535, Math.round(s.timeLeft * 10))), true);
  dv.setUint16(8, Math.min(65535, Math.round(s.phaseTime * 10)), true);
  dv.setInt16(10, clamp16(s.ball.x * 10), true);
  dv.setInt16(12, clamp16(s.ball.y * 10), true);
  dv.setInt16(14, clamp16(s.ball.vx), true);
  dv.setInt16(16, clamp16(s.ball.vy), true);
  b[18] = s.players.length;
  let o = HEAD;
  for (const p of s.players) {
    b[o] = p.id;
    dv.setInt16(o + 1, clamp16(p.x * 10), true);
    dv.setInt16(o + 3, clamp16(p.y * 10), true);
    dv.setInt16(o + 5, clamp16(p.vx), true);
    dv.setInt16(o + 7, clamp16(p.vy), true);
    b[o + 9] = Math.round((((p.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 255);
    b[o + 10] = p.flags;
    b[o + 11] = u8(p.stamina);
    b[o + 12] = u8(p.charge);
    o += PER;
  }
  return b;
}

export function decodeSnapshot(b: Uint8Array): Snapshot | null {
  if (b.length < HEAD || b[0] !== MSG_SNAP) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = b[18];
  if (b.length < HEAD + n * PER) return null;
  const players: SnapPlayer[] = [];
  let o = HEAD;
  for (let i = 0; i < n; i++) {
    players.push({
      id: b[o],
      x: dv.getInt16(o + 1, true) / 10,
      y: dv.getInt16(o + 3, true) / 10,
      vx: dv.getInt16(o + 5, true),
      vy: dv.getInt16(o + 7, true),
      angle: (b[o + 9] / 255) * 2 * Math.PI,
      flags: b[o + 10],
      stamina: b[o + 11] / 255,
      charge: b[o + 12] / 255,
    });
    o += PER;
  }
  return {
    phase: b[1] as Phase,
    tick: dv.getUint16(2, true),
    score: [b[4], b[5]],
    timeLeft: dv.getUint16(6, true) / 10,
    phaseTime: dv.getUint16(8, true) / 10,
    ball: {
      x: dv.getInt16(10, true) / 10,
      y: dv.getInt16(12, true) / 10,
      vx: dv.getInt16(14, true),
      vy: dv.getInt16(16, true),
    },
    players,
  };
}
