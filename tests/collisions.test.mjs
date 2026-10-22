import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return {
      format: 'module', shortCircuit: true,
      source: ts.transpile(readFileSync(new URL(url), 'utf8'), {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      }),
    };
  },
});

const { Sim, F, constrainPlayerBounds } = await import('../src/game/sim.ts');
const { Phase } = await import('../src/game/types.ts');
const dt = 1 / 60;

function match(party, positions) {
  const sim = new Sim();
  sim.phase = Phase.Playing;
  sim.party = party;
  positions.forEach(([x, y], i) => Object.assign(sim.addPlayer(i + 1, i % 2), { x, y }));
  return sim;
}

function separated(sim) {
  for (const p of sim.players.values()) {
    const distance = Math.hypot(sim.ball.x - p.x, sim.ball.y - p.y);
    assert.ok(distance >= F.PR + sim.ballRadius - 1e-7,
      `party=${sim.party}, player=${p.id}, distance=${distance}, ball=(${sim.ball.x},${sim.ball.y}), player=(${p.x},${p.y})`);
  }
}

function outsideGoals(p) {
  assert.ok(Math.abs(p.x) <= F.HL + F.MARGIN - F.PR + 1e-7, '球员不能越过场外跑动边界');
  assert.ok(Math.abs(p.y) <= F.HW + F.MARGIN - F.PR + 1e-7, '球员不能越过边线外跑动边界');
  for (const sign of [-1, 1]) {
    const x = p.x * sign;
    const nearestX = Math.max(F.HL - F.FRAME_R, Math.min(F.HL + F.GD + F.FRAME_R, x));
    const nearestY = Math.max(-F.GW - F.FRAME_R, Math.min(F.GW + F.FRAME_R, p.y));
    assert.ok(Math.hypot(x - nearestX, p.y - nearestY) >= F.PR - 1e-7,
      `球员圆不能与门框或球网实体相交：player=(${p.x},${p.y}), goal=${sign}`);
    for (const y of [-F.GW, F.GW]) {
      assert.ok(Math.hypot(p.x - sign * F.HL, p.y - y) >= F.PR + F.POST_R - 1e-7, '球员不能与门柱相交');
    }
  }
}

test('两侧球门按完整球员半径和门框厚度排斥，覆盖门前、门侧、门后和拐角初态', () => {
  for (const sign of [-1, 1]) {
    const positions = [
      [F.HL - 4, 0],
      [F.HL + F.GD / 2, F.GW + 4],
      [F.HL + F.GD / 2, -F.GW - 4],
      [F.HL + F.GD + 4, 0],
      [F.HL + F.GD - 4, F.GW - 4],
      [F.HL - 4, F.GW + 4],
      [F.HL - 4, -F.GW - 4],
      [F.HL, F.GW],
      [F.HL, -F.GW],
    ];
    for (const [x, y] of positions) {
      const p = { x: x * sign, y, vx: sign * 540, vy: -540 };
      assert.equal(constrainPlayerBounds(p), true);
      outsideGoals(p);
      assert.equal(constrainPlayerBounds(p), false, '修正后的点再投影应保持不变');
      const sim = match(0, [[x * sign, y]]);
      sim.step(dt);
      outsideGoals(sim.players.get(1));
    }
  }
});

test('球员与球门恰好相切时保持位置，并可沿门前和门侧滑动', () => {
  for (const sign of [-1, 1]) {
    for (const [x, y, vx, vy] of [
      [F.HL - F.FRAME_R - F.PR, 0, 0, 100],
      [F.HL + F.GD / 2, F.GW + F.FRAME_R + F.PR, 30, 0],
      [F.HL + F.GD / 2, -F.GW - F.FRAME_R - F.PR, -30, 0],
    ]) {
      const p = { x: sign * x, y, vx: sign * vx, vy };
      const before = { ...p };
      assert.equal(constrainPlayerBounds(p), false);
      assert.deepEqual(p, before);
      outsideGoals(p);
    }
    const p = { x: sign * (F.HL - 10), y: 0, vx: sign * 100, vy: 50 };
    constrainPlayerBounds(p);
    assert.equal(p.vx, 0, '移除朝球门内部的速度');
    assert.equal(p.vy, 50, '保留沿门前滑动的速度');
  }
});

test('高速铲球不能从门前、两侧或斜角穿过球门', () => {
  for (const sign of [-1, 1]) {
    for (const [x, y, vx, vy] of [
      [F.HL - 70, 0, 540, 0],
      [F.HL + F.GD / 2, F.GW + 70, 0, -540],
      [F.HL + F.GD / 2, -F.GW - 70, 0, 540],
      [F.HL - 65, F.GW + 65, 382, -382],
      [F.HL - 65, -F.GW - 65, 382, 382],
    ]) {
      const sim = match(0, [[sign * x, y]]);
      const p = sim.players.get(1);
      Object.assign(p, { vx: sign * vx, vy, tackleT: 1, angle: Math.atan2(vy, sign * vx) });
      for (let frame = 0; frame < 4; frame++) {
        sim.step(0.05);
        outsideGoals(p);
      }
    }
  }
});

test('八人持续挤向两侧球门仍与球、球员、门框分离，正常射门继续计分', () => {
  for (const sign of [-1, 1]) {
    for (const party of [0, 1]) {
      const sim = match(party, Array.from({ length: 8 }, (_, i) => [sign * (F.HL - 25 - i * 4), (i - 3.5) * 8]));
      Object.assign(sim.ball, { x: sign * (F.HL - 30), y: 0 });
      for (let frame = 0; frame < 40; frame++) {
        for (const p of sim.players.values()) sim.setInput(p.id, { jx: sign, jy: -Math.sign(p.y) * 0.3, btn: 0 });
        sim.step(dt);
        separated(sim);
        const players = [...sim.players.values()];
        for (let i = 0; i < players.length; i++) {
          outsideGoals(players[i]);
          for (let j = i + 1; j < players.length; j++) {
            assert.ok(Math.hypot(players[i].x - players[j].x, players[i].y - players[j].y) >= F.PR * 2 - 1e-7,
              '挤门时球员之间也不能重叠');
          }
        }
      }
      const goal = match(party, [[sign * (F.HL - 100), 0]]);
      Object.assign(goal.ball, { x: sign * (F.HL - 35), y: 0, vx: sign * 1060 });
      goal.step(0.07);
      assert.equal(goal.score[sign > 0 ? 0 : 1], 1, '球员的实体球门约束不能挡住足球进门');
      assert.equal(goal.phase, Phase.Goal);
      outsideGoals(goal.players.get(1));
    }
  }
});

test('标准球与巨球被多人夹住或同点挤压时，所有球员圆至多与球相切', () => {
  for (const party of [0, 1]) {
    const scenarios = [
      [[0, 0]],
      [[-F.PR, 0], [F.PR, 0]],
      Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * 20, Math.sin(i * Math.PI / 4) * 20]),
      Array.from({ length: 8 }, () => [0, 0]),
    ];
    for (const positions of scenarios) {
      const sim = match(party, positions);
      for (let frame = 0; frame < 10; frame++) {
        sim.step(dt);
        separated(sim);
      }
    }
  }
});

test('边线、底线、角落及门柱约束不会再次把球压进球员体内', () => {
  for (const party of [0, 1]) {
    const r = party === 1 ? 20 : 10;
    const positions = [[0, F.HW - r], [F.HL - r, F.HW - r], [F.HL - F.PR * 0.2, 0], [F.HL - 24, F.GW]];
    for (const [x, y] of positions) {
      const sim = match(party, [[x - 10, y], [x + 10, y], [x, y - 20]]);
      Object.assign(sim.ball, { x, y });
      sim.step(dt);
      separated(sim);
    }
  }
});

test('高速球和高速球员使用共同子步，不能穿过对方且接触后不重叠', () => {
  for (const party of [0, 1]) {
    const ball = match(party, [[0, 0]]);
    Object.assign(ball.ball, { x: -80, vx: 1060 });
    ball.step(0.1);
    assert.equal(ball.ball.lastTouch, 1);
    separated(ball);

    const tackle = match(party, [[-40, 0]]);
    Object.assign(tackle.players.get(1), { vx: 540, tackleT: 1, angle: 0 });
    tackle.step(0.2);
    assert.equal(tackle.ball.lastTouch, 1);
    separated(tackle);
  }
  const opposing = match(0, [[-40, 100], [40, 100]]);
  Object.assign(opposing.players.get(1), { vx: 540, tackleT: 1, angle: 0 });
  Object.assign(opposing.players.get(2), { vx: -540, tackleT: 1, angle: Math.PI });
  opposing.step(0.2);
  assert.ok(opposing.players.get(1).x < opposing.players.get(2).x, '相向铲球不能交换位置穿透');
  assert.ok(Math.hypot(opposing.players.get(1).x - opposing.players.get(2).x,
    opposing.players.get(1).y - opposing.players.get(2).y) >= F.PR * 2 - 1e-7);
});

test('求解碰撞后仍保留开球站位限制，热身进球重置也不与中圈球员重叠', () => {
  const kickoff = match(0, [[50, 150], [-10, 0]]);
  kickoff.kickoffPending = true;
  kickoff.kickoffTeam = 0;
  kickoff.ball.y = 200;
  kickoff.step(dt);
  assert.equal(kickoff.kickoffPending, true);
  assert.ok(kickoff.players.get(1).x <= 0, '进攻方不能提前过半场');
  assert.ok(kickoff.players.get(2).x >= 0, '防守方不能提前过半场');
  assert.ok(Math.hypot(kickoff.players.get(2).x, kickoff.players.get(2).y) >= F.CENTER_R + F.PR);
  for (const party of [0, 1]) {
    const warmup = match(party, [[0, 0]]);
    warmup.phase = Phase.Lobby;
    warmup.ball.x = F.HL + warmup.ballRadius + 1;
    warmup.step(dt);
    separated(warmup);
    assert.deepEqual(warmup.score, [0, 0]);
  }
});

test('持续挤球与靠近边界的八人密集接触保持分离', () => {
  let seed = 517;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const party of [0, 1]) {
    for (const [x, y] of [[0, 0], [0, F.HW - 20], [F.HL - 25, F.HW - 20], [F.HL - 30, F.GW]]) {
      for (let scene = 0; scene < 12; scene++) {
        const sim = match(party, Array.from({ length: 8 }, () => [x + (random() - 0.5) * 80, y + (random() - 0.5) * 80]));
        Object.assign(sim.ball, { x, y });
        for (let frame = 0; frame < 20; frame++) {
          for (const p of sim.players.values()) {
            const distance = Math.hypot(sim.ball.x - p.x, sim.ball.y - p.y) || 1;
            sim.setInput(p.id, { jx: (sim.ball.x - p.x) / distance, jy: (sim.ball.y - p.y) / distance, btn: 0 });
          }
          sim.step(dt);
          separated(sim);
        }
      }
    }
  }
});
