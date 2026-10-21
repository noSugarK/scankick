import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// 用项目已有的 TypeScript 编译器加载源码，无需额外测试依赖。
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

const { Sim, F } = await import('../src/game/sim.ts');
const { Phase, BTN_A, BTN_B, BTN_X, BTN_Y } = await import('../src/game/types.ts');
const { encodeInput, decodeInput, newerInput, encodeSnapshot, decodeSnapshot } = await import('../src/net/protocol.ts');
const { ClientNet } = await import('../src/net/client.ts');
const { HostGame } = await import('../src/game/host-game.ts');
const { Gamepad } = await import('../src/ui/gamepad.ts');

const dt = 1 / 60;
function match() {
  const sim = new Sim();
  sim.phase = Phase.Playing;
  return sim;
}

test('高速球从两侧球门外越过底线时反弹，不夹入球网或计分', () => {
  for (const side of [-1, 1]) for (const y of [-200, -100, 100, 200]) {
    const sim = match();
    Object.assign(sim.ball, { x: side * (F.HL - 5), y, vx: side * 1060, vy: 0 });
    sim.step(dt);
    assert.deepEqual(sim.score, [0, 0]);
    assert.equal(sim.phase, Phase.Playing);
    assert.ok(Math.abs(sim.ball.y) > F.GW);
    assert.ok(sim.ball.vx * side < 0);
  }
});

test('正常射门穿过左右球门后各计一球，随后不重复计分', () => {
  for (const side of [-1, 1]) {
    const sim = match();
    Object.assign(sim.ball, { x: side * (F.HL - 5), y: 0, vx: side * 1060, vy: 0 });
    sim.step(dt);
    assert.deepEqual(sim.score, side === 1 ? [1, 0] : [0, 1]);
    assert.equal(sim.phase, Phase.Goal);
    for (let i = 0; i < 60; i++) sim.step(dt);
    assert.equal(sim.score[0] + sim.score[1], 1);
  }
});

test('球未整体过线不算进球；高速正中门柱不穿透', () => {
  const partial = match();
  Object.assign(partial.ball, { x: F.HL + F.BR - 1, y: 0 });
  partial.step(dt);
  assert.deepEqual(partial.score, [0, 0]);
  for (const side of [-1, 1]) for (const y of [-F.GW, F.GW]) {
    const sim = match();
    Object.assign(sim.ball, { x: side * (F.HL - 40), y, vx: side * 5000, vy: 0 });
    sim.step(dt);
    assert.deepEqual(sim.score, [0, 0]);
    assert.ok(sim.ball.vx * side < 0);
  }
});

test('斜射先碰到底线外侧时，不能因终点在门口内而计分', () => {
  for (const side of [-1, 1]) {
    const sim = match();
    Object.assign(sim.ball, { x: side * (F.HL - 12), y: 100, vx: side * 3000, vy: -2400 });
    sim.step(dt);
    assert.deepEqual(sim.score, [0, 0]);
    assert.ok(sim.ball.vx * side < 0);
  }
});

test('输入序号覆盖完整 32 位、回绕，并拒绝重复、乱序和旧格式', () => {
  for (const seq of [0, 255, 256, 65536, 0xffffffff]) {
    const packet = decodeInput(encodeInput(seq, { jx: 1, jy: -1, btn: BTN_B }));
    assert.deepEqual(packet, { seq, jx: 1, jy: -1, btn: BTN_B });
  }
  assert.equal(newerInput(0, undefined), true);
  assert.equal(newerInput(0, 0xffffffff), true);
  assert.equal(newerInput(12, 12), false);
  assert.equal(newerInput(11, 12), false);
  assert.equal(newerInput(0xffffffff, 0), false);
  assert.equal(decodeInput(new Uint8Array(5)), null);
});

test('主机忽略旧包和重复包，新连接可以从零重新编号', () => {
  const host = new HostGame('TEST');
  host.net.cb.onHello('one', { name: 'P', token: 'token', team: 0 });
  const player = [...host.sim.players.values()][0];
  const deliver = (cid, seq, btn) => host.net.cb.onBinary(cid, encodeInput(seq, { jx: 0, jy: 0, btn }));
  deliver('one', 10, BTN_A);
  deliver('one', 9, 0);
  deliver('one', 10, 0);
  assert.equal(player.input.btn, BTN_A);
  assert.equal(player.inputQueue.length, 1);
  host.net.cb.onLeave('one');
  host.net.cb.onHello('two', { name: 'P', token: 'token', team: 0 });
  deliver('two', 0, BTN_B);
  assert.equal(player.input.btn, BTN_B);
});

test('直连输入走可靠有序通道，中继输入请求 QoS 1', () => {
  const client = new ClientNet('TEST', { token: 't', name: 'P', team: 0 });
  const bin = encodeInput(0, { jx: 0, jy: 0, btn: BTN_A });
  let sent;
  client.ctl = { readyState: 'open', send: (value) => { sent = value; } };
  client.fast = { readyState: 'open', send: () => assert.fail('输入不应走 fast') };
  client.sendInput(bin);
  assert.equal(sent, bin);
  client.ctl = null;
  client.relay = true;
  client.signal.pub = (...args) => { sent = args; };
  client.sendInput(bin);
  assert.equal(sent[1], bin);
  assert.equal(sent[3], 1);
});

class Element extends EventTarget {
  constructor(bit = 0) {
    super();
    this.dataset = { bit: String(bit) };
    this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {} };
  }
  setPointerCapture() {}
}

test('触屏和键盘短按在两次采样之间仍立即发出，并在模拟中执行', () => {
  const originalWindow = globalThis.window;
  const originalInput = globalThis.HTMLInputElement;
  globalThis.window = new EventTarget();
  globalThis.HTMLInputElement = class {};
  try {
    for (const [bit, code] of [[BTN_A, 'KeyJ'], [BTN_B, 'KeyK'], [BTN_Y, 'KeyI']]) {
      for (const keyboard of [false, true]) {
        const els = new Map(['.joy-zone', '.joy-base', '.joy-knob'].map((key) => [key, new Element()]));
        const buttons = [1, 2, 4, 8].map((value) => new Element(value));
        const pad = new Gamepad({ insertAdjacentHTML() {}, querySelector: (key) => els.get(key), querySelectorAll: () => buttons });
        const sim = match();
        const p = sim.addPlayer(1, 0);
        Object.assign(p, { x: -30, y: 0, angle: 0 });
        const sent = [];
        pad.onButtons = () => {
          sent.push({ ...pad.input });
          sim.setInput(1, pad.input);
        };
        const target = keyboard ? window : buttons.find((button) => Number(button.dataset.bit) === bit);
        for (const type of keyboard ? ['keydown', 'keyup'] : ['pointerdown', 'pointerup']) {
          const event = new Event(type, { cancelable: true });
          Object.assign(event, { code, pointerId: 1 });
          target.dispatchEvent(event);
        }
        assert.deepEqual(sent.map((input) => input.btn), [bit, 0]);
        sim.step(dt);
        if (bit === BTN_Y) assert.ok(p.tackleT > 0);
        sim.step(dt);
        if (bit !== BTN_Y) assert.ok(sim.events.some((event) => event.k === 'kick'));
        assert.equal(p.inputQueue.length, 0);
        // 每轮使用独立的 window，避免上轮键盘监听器参与测试。
        globalThis.window = new EventTarget();
      }
    }
  } finally {
    globalThis.window = originalWindow;
    globalThis.HTMLInputElement = originalInput;
  }
});

test('准备阶段不会把排队的短按带进开球，异常输入队列有上限', () => {
  const sim = match();
  const p = sim.addPlayer(1, 0);
  for (let i = 0; i < 100; i++) sim.setInput(1, { jx: 0, jy: 0, btn: i % 2 ? 0 : BTN_A });
  assert.ok(p.inputQueue.length <= 32);
  sim.phase = Phase.Ready;
  sim.step(dt);
  assert.equal(p.inputQueue.length, 0);
  sim.phase = Phase.Playing;
  sim.step(dt);
  assert.equal(p.passBuf, 0);
});

function scoreGoal(sim, side = 1) {
  Object.assign(sim.ball, { x: side * (F.HL - 5), y: 0, vx: side * 1060, vy: 0 });
  sim.step(dt);
  assert.equal(sim.phase, Phase.Goal);
  sim.step(3);
}

test('抢三球不限时，前两球继续，第三球庆祝后结算且只结算一次', () => {
  const sim = match();
  sim.mode = 1;
  sim.timeLeft = 0;
  sim.step(dt);
  assert.equal(sim.phase, Phase.Playing);
  for (let i = 1; i <= 3; i++) {
    scoreGoal(sim);
    assert.equal(sim.score[0], i);
    assert.equal(sim.phase, i === 3 ? Phase.Ended : Phase.Ready);
    if (i < 3) sim.step(1.5);
  }
  sim.step(dt);
  assert.equal(sim.endReason, 'target');
  assert.equal(sim.events.filter((event) => event.k === 'end').length, 1);
});

test('金球制平分进入加时、保留比分，下一球决胜；再开一局会重置', () => {
  const sim = match();
  sim.mode = 2;
  sim.score = [1, 1];
  sim.timeLeft = dt / 2;
  sim.step(dt);
  assert.equal(sim.golden, true);
  assert.equal(sim.phase, Phase.Ready);
  assert.deepEqual(sim.score, [1, 1]);
  sim.step(1.5);
  sim.step(dt);
  assert.equal(sim.phase, Phase.Playing);
  scoreGoal(sim, -1);
  assert.equal(sim.phase, Phase.Ended);
  assert.equal(sim.endReason, 'golden');
  assert.deepEqual(sim.score, [1, 2]);
  sim.startMatch(60, 0);
  assert.equal(sim.golden, false);
  assert.equal(sim.endReason, 'time');
  assert.deepEqual(sim.score, [0, 0]);
});

test('经典赛允许平局；金球制到时领先直接胜出，压哨追平仍进入金球', () => {
  for (const mode of [0, 2]) {
    const sim = match();
    sim.mode = mode;
    sim.score = mode === 2 ? [1, 0] : [0, 0];
    sim.timeLeft = dt / 2;
    sim.step(dt);
    assert.equal(sim.phase, Phase.Ended);
    assert.equal(sim.golden, false);
  }
  const tied = match();
  tied.mode = 2;
  tied.score = [0, 1];
  tied.timeLeft = dt / 2;
  scoreGoal(tied);
  assert.equal(tied.golden, true);
  assert.equal(tied.phase, Phase.Ready);
  assert.deepEqual(tied.score, [1, 1]);
});

test('模式设置仅接受有效值、比赛中不可更改，快照传输金球状态', () => {
  const host = new HostGame('MODE');
  host.setSettings({ mode: 1 });
  host.setSettings({ mode: 99 });
  assert.equal(host.settings.mode, 1);
  host.startMatch();
  host.setSettings({ mode: 0 });
  assert.equal(host.sim.mode, 1);
  assert.equal(host.settings.mode, 1);
  const sim = match();
  sim.mode = 2;
  sim.golden = true;
  const decoded = decodeSnapshot(encodeSnapshot(sim.snapshot()));
  assert.equal(decoded.mode, 2);
  assert.equal(decoded.golden, true);
});

test('巨型足球的碰撞、出脚距离和整球过线判定使用相同半径', () => {
  const sim = match();
  sim.party = 1;
  assert.equal(sim.ballRadius, 20);
  const p = sim.addPlayer(1, 0);
  Object.assign(p, { x: -40, y: 0, angle: 0 });
  sim.setInput(1, { jx: 0, jy: 0, btn: BTN_A });
  sim.step(dt);
  assert.ok(sim.events.some((event) => event.k === 'kick'));
  const collision = match();
  collision.party = 1;
  const player = collision.addPlayer(1, 0);
  Object.assign(player, { x: -30, y: 0 });
  collision.step(dt);
  assert.ok(Math.hypot(collision.ball.x - player.x, collision.ball.y - player.y) >= F.PR + 20 - 0.001);
  for (const side of [-1, 1]) {
    const goal = match();
    goal.party = 1;
    Object.assign(goal.ball, { x: side * (F.HL + 15), y: 0, vx: 0, vy: 0 });
    goal.step(dt);
    assert.deepEqual(goal.score, [0, 0]);
    goal.ball.vx = side * 1060;
    goal.step(dt);
    assert.equal(goal.score[0] + goal.score[1], 1);
    const wide = match();
    wide.party = 1;
    Object.assign(wide.ball, { x: side * (F.HL - 5), y: 200, vx: side * 1060, vy: 0 });
    wide.step(dt);
    assert.deepEqual(wide.score, [0, 0]);
  }
});

test('无限体力可持续冲刺，切回标准后正常消耗体力且球恢复原尺寸', () => {
  const sim = match();
  sim.party = 2;
  const p = sim.addPlayer(1, 0);
  p.stamina = 0;
  p.exhausted = true;
  sim.setInput(1, { jx: 1, jy: 0, btn: BTN_X });
  for (let i = 0; i < 600; i++) sim.step(dt);
  assert.equal(p.stamina, 1);
  assert.equal(p.exhausted, false);
  sim.startMatch(60, 1, 0);
  assert.equal(sim.party, 0);
  assert.equal(sim.ballRadius, 10);
  sim.step(1.5);
  sim.step(dt);
  assert.ok(p.stamina < 1);
});

test('强反弹提高边线、底线和门柱反弹速度，不增幅球速', () => {
  for (const kind of ['sideline', 'endline', 'post']) {
    const speeds = [];
    for (const party of [0, 3]) {
      const sim = match();
      sim.party = party;
      Object.assign(sim.ball, kind === 'sideline'
        ? { x: 0, y: F.HW - 11, vx: 0, vy: 500 }
        : { x: F.HL - 20, y: kind === 'post' ? F.GW : 200, vx: 500, vy: 0 });
      for (let i = 0; i < 5; i++) sim.step(dt);
      const speed = Math.hypot(sim.ball.vx, sim.ball.vy);
      assert.ok(speed <= 500);
      if (kind === 'sideline') assert.ok(sim.ball.vy < 0);
      else assert.ok(sim.ball.vx < 0);
      assert.deepEqual(sim.score, [0, 0]);
      speeds.push(speed);
    }
    assert.ok(speeds[1] > speeds[0]);
  }
});

test('所有模式与派对组合均可传输，畸形快照被拒绝；规则开赛后锁定', () => {
  for (const mode of [0, 1, 2]) for (const party of [0, 1, 2, 3]) {
    const sim = match();
    sim.mode = mode;
    sim.party = party;
    sim.golden = mode === 2;
    const packet = encodeSnapshot(sim.snapshot());
    const decoded = decodeSnapshot(packet);
    assert.equal(decoded.mode, mode);
    assert.equal(decoded.party, party);
    assert.equal(decoded.golden, mode === 2);
    packet[19] = 255;
    assert.equal(decodeSnapshot(packet), null);
  }
  const host = new HostGame('PARTY');
  host.setSettings({ party: 1, mode: 1 });
  host.setSettings({ party: '2' });
  assert.equal(host.settings.party, 1);
  host.startMatch();
  host.setSettings({ party: 3 });
  assert.equal(host.sim.party, 1);
  assert.equal(host.settings.party, 1);
  host.endMatch();
  host.handleEvents();
  assert.equal(host.endInfo.reason, 'host');
});

test('金球获胜原因和比分进入主机结算、名单与历史记录', () => {
  const host = new HostGame('RESULT');
  host.setSettings({ mode: 2 });
  host.startMatch();
  host.sim.step(1.5);
  host.sim.timeLeft = 0;
  host.sim.step(dt);
  host.sim.step(1.5);
  scoreGoal(host.sim);
  host.handleEvents();
  assert.equal(host.endInfo.reason, 'golden');
  assert.equal(host.endInfo.winner, 0);
  assert.deepEqual(host.endInfo.score, [1, 0]);
  assert.equal(host.rosterMsg().end, host.endInfo);
  assert.equal(host.history[0], host.endInfo);
});
