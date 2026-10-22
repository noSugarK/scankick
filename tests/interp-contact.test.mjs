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
    return { format: 'module', shortCircuit: true, source: ts.transpile(readFileSync(new URL(url), 'utf8'), {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    }) };
  },
});

const { SnapBuffer, separateViewBall, separateViewPlayers } = await import('../src/net/interp.ts');
const { F, ballRadius } = await import('../src/game/sim.ts');
const player = (id, x, y) => ({ id, x, y, vx: 0, vy: 0, angle: 0, flags: 0, stamina: 1, charge: 0 });
const snapshot = (players, ball = {}, party = 0) => ({
  tick: 60, phase: 2, mode: 0, golden: false, party, score: [0, 0], timeLeft: 60, phaseTime: 1,
  ball: { x: 0, y: 0, vx: 0, vy: 0, ...ball }, players,
});
function assertClear(s) {
  for (const p of s.players) assert.ok(Math.hypot(s.ball.x - p.x, s.ball.y - p.y) >= F.PR + ballRadius(s.party), '展示实体圆不能重叠');
  assert.ok(Number.isFinite(s.ball.x) && Number.isFinite(s.ball.y));
}
function assertInPitch(s) {
  const r = ballRadius(s.party);
  const x = Math.abs(s.ball.x);
  const y = Math.abs(s.ball.y);
  assert.ok((x <= F.HL - r && y <= F.HW - r) || (x <= F.HL + F.GD - r && y <= F.GW - r), '展示球必须留在场内或球网内');
  for (const px of [-F.HL, F.HL]) for (const py of [-F.GW, F.GW]) {
    assert.ok(Math.hypot(s.ball.x - px, s.ball.y - py) >= r + F.POST_R, '展示球不能穿过门柱');
  }
}
function assertPlayersOutsideGoals(s) {
  for (const p of s.players) {
    assert.ok(Math.abs(p.x) <= F.HL + F.MARGIN - F.PR + 1e-7);
    assert.ok(Math.abs(p.y) <= F.HW + F.MARGIN - F.PR + 1e-7);
    for (const sign of [-1, 1]) {
      const x = p.x * sign;
      const nearestX = Math.max(F.HL - F.FRAME_R, Math.min(F.HL + F.GD + F.FRAME_R, x));
      const nearestY = Math.max(-F.GW - F.FRAME_R, Math.min(F.GW + F.FRAME_R, p.y));
      assert.ok(Math.hypot(x - nearestX, p.y - nearestY) >= F.PR - 1e-7, '展示球员完整圆不能进入球网或门框');
      for (const y of [-F.GW, F.GW]) {
        assert.ok(Math.hypot(p.x - sign * F.HL, p.y - y) >= F.PR + F.POST_R - 1e-7, '展示球员不能穿过门柱');
      }
    }
  }
}

test('零外推和跳变插值均返回独立的球、球员数组及球员对象，预测不能回写权威快照', () => {
  const a = snapshot([player(1, -200, 0)], { x: -150 });
  const b = snapshot([player(1, 200, 0), player(2, 0, 50)], { x: 150 });
  b.tick = 62;
  const buffer = new SnapBuffer();
  buffer.push(a, 1000);
  const single = buffer.sample(1000);
  buffer.push(b, 1000 + 1000 / 30);
  buffer.delay = 0;
  const interpolated = buffer.sample(1000 + 1000 / 60);
  for (const [view, source] of [[single, a], [interpolated, b]]) {
    assert.notEqual(view.ball, source.ball);
    assert.notEqual(view.players, source.players);
    for (let i = 0; i < view.players.length; i++) assert.notEqual(view.players[i], source.players[i]);
    const saved = structuredClone(source);
    view.ball.x = 999;
    view.players[0].x = 999;
    view.players[0] = player(99, 999, 999);
    assert.deepEqual(source, saved);
  }
});

test('外推、圆周插值和本地预测产生的展示穿透被校正，权威坐标与速度不改变', () => {
  for (const party of [0, 1]) {
    const radius = F.PR + ballRadius(party);
    const source = snapshot([player(1, 0, 0)], { x: radius + 10, vx: -200 }, party);
    const buffer = new SnapBuffer();
    buffer.delay = 0;
    buffer.push(source, 1000);
    const extrapolated = buffer.sample(1100);
    assert.ok(Math.hypot(extrapolated.ball.x, extrapolated.ball.y) < radius, '确认旧外推能独立重现穿透');
    const a = snapshot([player(1, 0, 0)], { x: radius }, party);
    const b = snapshot([player(1, 0, 0)], { x: radius * Math.cos(Math.PI / 6), y: radius / 2 }, party);
    b.tick = 62;
    const arc = new SnapBuffer();
    arc.delay = 0;
    arc.push(a, 1000); arc.push(b, 1000 + 1000 / 30);
    const interpolated = arc.sample(1000 + 1000 / 60);
    assert.ok(Math.hypot(interpolated.ball.x, interpolated.ball.y) < radius);
    const predicted = snapshot([player(1, -radius + 20, 0)], {}, party);
    for (const view of [extrapolated, interpolated, predicted]) {
      const saved = structuredClone(view);
      const corrected = separateViewBall(view);
      assertClear(corrected);
      assert.deepEqual(view, saved, '校正不写入来源快照');
      assert.equal(corrected.players, view.players, '校正不移动球员');
      assert.equal(corrected.ball.vx, view.ball.vx);
      assert.equal(corrected.ball.vy, view.ball.vy);
      assert.equal(separateViewBall(corrected), corrected, '反复绘制不继续位移或震荡');
    }
    assert.equal(source.ball.x, radius + 10);
  }
});

test('两人夹球选择最近圆交点，同点、近同点、多玩家包围和相切退化保持有限且无穿透', () => {
  for (const party of [0, 1]) {
    const radius = F.PR + ballRadius(party);
    const sandwich = snapshot([player(1, -17, 0), player(2, 17, 0)], {}, party);
    const corrected = separateViewBall(sandwich);
    assertClear(corrected);
    assert.ok(Math.abs(corrected.ball.x) < 0.001);
    assert.ok(Math.abs(Math.abs(corrected.ball.y) - Math.sqrt(radius * radius - 17 * 17)) < 0.001, '夹球时选择近处间隙，不把球推到人群远端');
    for (const points of [
      [[0, 0]], [[0, 0], [0, 0]], [[0, 0], [1e-12, 0]],
      [[0, 0], [2 * radius, 0]],
      [[-17, 0], [17, 0], [0, 30]],
      Array.from({ length: 8 }, (_, i) => [25 * Math.cos(i * Math.PI / 4), 25 * Math.sin(i * Math.PI / 4)]),
    ]) {
      const view = snapshot(points.map(([x, y], i) => player(i + 1, x, y)), {}, party);
      assertClear(separateViewBall(view));
    }
    const tangent = snapshot([player(1, 0, 0)], { x: radius }, party);
    assert.equal(separateViewBall(tangent), tangent, '无重叠时不创建新对象或移动球');
  }
});

test('边线、底线、底角和球门附近的展示校正同时满足接触与场地边界，不靠clamp重新夹球', () => {
  for (const party of [0, 1]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const r = ballRadius(party);
    const end = sx * (F.HL - r);
    const side = sy * (F.HW - r);
    const back = sx * (F.HL + F.GD - r);
    const net = sy * (F.GW - r);
    const scenarios = [
      snapshot([player(1, 0, side - sy * 11)], { x: 0, y: side }, party),
      snapshot([player(1, end - sx * 11, sy * 160)], { x: end, y: sy * 160 }, party),
      snapshot([player(1, end - sx * 11, side - sy * 11)], { x: end, y: side }, party),
      snapshot([player(1, back - sx * 11, 0)], { x: back, y: 0 }, party),
      snapshot([player(1, back - sx * 11, net - sy * 11)], { x: back, y: net }, party),
      snapshot([player(1, sx * (F.HL - 30), sy * (F.GW - 20))], { x: sx * (F.HL - 8), y: sy * (F.GW - 8) }, party),
    ];
    for (const source of scenarios) {
      const saved = structuredClone(source);
      const corrected = separateViewBall(source);
      assertClear(corrected);
      assertInPitch(corrected);
      assert.deepEqual(source, saved);
      assert.ok(Math.hypot(corrected.ball.x - source.ball.x, corrected.ball.y - source.ball.y) < 80, '有近处间隙时不能把球传送到场中央兜底点');
      assert.equal(separateViewBall(corrected), corrected, '边界校正没有来回抖动');
    }
    const goal = separateViewBall(scenarios[3]);
    assert.ok(goal.ball.x * sx > F.HL, '球网内的夹球继续留在球网，不被简单场内矩形裁回球场');
    const legalGoal = snapshot([], { x: sx * (F.HL + 20), y: 0 }, party);
    assert.equal(separateViewBall(legalGoal), legalGoal, '合法球门位置保持不变');
  }
});

test('门前、侧网、门后和门柱的球员展示校正不污染快照，先移人再分球保持分离', () => {
  for (const party of [0, 1]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const positions = [
      [sx * (F.HL - 8), 0],
      [sx * (F.HL + 15), sy * (F.GW + 5)],
      [sx * (F.HL + F.GD + 8), 0],
      [sx * (F.HL - 12), sy * (F.GW - 12)],
    ];
    for (const [x, y] of positions) {
      const source = snapshot([player(1, x, y)], { x: sx * (F.HL - 35) }, party);
      const saved = structuredClone(source);
      const moved = separateViewPlayers(source);
      assertPlayersOutsideGoals(moved);
      assert.deepEqual(source, saved, '展示校正不能回写权威快照的球员坐标或速度');
      assert.notEqual(moved, source);
      assert.notEqual(moved.players, source.players);
      assert.notEqual(moved.players[0], source.players[0]);
      assert.equal(moved.ball, source.ball, '移人阶段不提前移动球');
      const corrected = separateViewBall(moved);
      assertClear(corrected);
      assertInPitch(corrected);
      assertPlayersOutsideGoals(corrected);
      assert.equal(separateViewPlayers(corrected), corrected, '再次绘制时球员保持稳定');
      assert.deepEqual(source, saved);
    }
  }
  const clear = snapshot([player(1, 0, 0)]);
  assert.equal(separateViewPlayers(clear), clear, '合法位置复用原快照');
});

test('合法快照之间绕柱插值和向门内外推产生的球员穿透均被校正', () => {
  for (const sign of [-1, 1]) {
    const a = snapshot([player(1, sign * (F.HL - 25), F.GW)]);
    const b = snapshot([player(1, sign * F.HL, F.GW + 25)]);
    b.tick = 62;
    assertPlayersOutsideGoals(a);
    assertPlayersOutsideGoals(b);
    const buffer = new SnapBuffer();
    buffer.delay = 0;
    buffer.push(a, 1000);
    buffer.push(b, 1000 + 1000 / 30);
    const arc = buffer.sample(1000 + 1000 / 60);
    assert.ok(Math.hypot(arc.players[0].x - sign * F.HL, arc.players[0].y - F.GW) < F.PR + F.POST_R, '确认插值弦线会切进门柱');
    const moving = snapshot([{ ...player(1, sign * (F.HL - F.FRAME_R - F.PR - 1), 0), vx: sign * 205 }]);
    const ahead = new SnapBuffer();
    ahead.delay = 0;
    ahead.push(moving, 1000);
    const extrapolated = ahead.sample(1100);
    assert.ok(extrapolated.players[0].x * sign > F.HL - F.FRAME_R - F.PR, '确认外推会走进门内');
    for (const source of [arc, extrapolated]) {
      const saved = structuredClone(source);
      const corrected = separateViewBall(separateViewPlayers(source));
      assertPlayersOutsideGoals(corrected);
      assertClear(corrected);
      assert.deepEqual(source, saved);
    }
    assertPlayersOutsideGoals(a);
    assertPlayersOutsideGoals(b);
    assertPlayersOutsideGoals(moving);
  }
});
