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
const { Phase, BTN_A, BTN_B, BTN_Y } = await import('../src/game/types.ts');
const { encodeInput, decodeInput, newerInput } = await import('../src/net/protocol.ts');
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
