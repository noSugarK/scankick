import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'jsqr') return { url: 'test:jsqr', shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:jsqr') return { format: 'module', shortCircuit: true, source: 'export default () => ({ data: "#/join/ABCDE" });' };
    if (!url.endsWith('.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpile(readFileSync(new URL(url), 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }) };
  },
});

const { Gamepad } = await import('../src/ui/gamepad.ts');
const { HostGame } = await import('../src/game/host-game.ts');
const { Sim } = await import('../src/game/sim.ts');
const { Phase, BTN_A, BTN_B, BTN_Y } = await import('../src/game/types.ts');
const { encodeInput } = await import('../src/net/protocol.ts');
const { openScanner } = await import('../src/ui/scan.ts');

class Element extends EventTarget {
  captures = new Set();
  dataset = {};
  style = { setProperty() {} };
  classList = { add() {}, remove() {} };
  setPointerCapture(id) { this.captures.add(id); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 300 }; }
}

const fire = (target, type, props = {}) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props));

test('放开触屏摇杆会恢复仍按住的键盘方向，表单控件上的按键不操作球员', () => {
  const original = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  try {
    const els = new Map(['.joy-zone', '.joy-base', '.joy-knob'].map((key) => [key, new Element()]));
    const buttons = [1, 2, 4, 8].map((bit) => Object.assign(new Element(), { dataset: { bit: String(bit) } }));
    const pad = new Gamepad({ insertAdjacentHTML() {}, querySelector: (key) => els.get(key), querySelectorAll: () => buttons });
    fire(window, 'keydown', { code: 'KeyD' });
    const zone = els.get('.joy-zone');
    fire(zone, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 150 });
    fire(zone, 'pointermove', { pointerId: 1, clientX: 80, clientY: 150 });
    assert.equal(pad.input.jx, -1);
    fire(zone, 'pointerup', { pointerId: 1 });
    assert.equal(pad.input.jx, 1);
    const key = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space' });
    Object.defineProperty(key, 'target', { value: { closest: () => ({}) } });
    window.dispatchEvent(key);
    assert.equal(pad.input.btn, 0);
    assert.equal(key.defaultPrevented, false, '空格保留按钮原生激活行为');
    const memberKey = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyK' });
    Object.defineProperty(memberKey, 'target', { value: { closest: (selector) => selector.includes('[role="button"]') ? {} : null } });
    window.dispatchEvent(memberKey);
    assert.equal(pad.input.btn, 0, '成员管理行获得焦点时不触发射门');
  } finally { Object.assign(globalThis, original); }
});

test('离场者保留最新昵称和独立战绩，新人复用球员 ID 不继承旧统计或触球归属', () => {
  const host = new HostGame('STATS', { listed: false }, (_room, cb) => ({
    cb, broadcastJson() {}, sendJson() {}, linkOf: () => 'relay', drop() {}, close() {},
  }));
  const join = (cid) => {
    assert.equal(host.net.cb.onHello(cid, { name: cid, token: cid, team: 0 }), null);
    return host.rosterMsg().players.find((p) => p.name === cid).id;
  };
  try {
    const old = join('old');
    host.startMatch();
    host.sim.phase = Phase.Playing;
    host.stats.get(old).g = 2;
    host.command(old, { t: 'name', name: 'renamed' });
    Object.assign(host.sim.ball, { lastTouch: old, prevTouch: old, lastTeam: 0, prevTeam: 0 });
    host.removeSlot(old);
    assert.equal(host.sim.ball.lastTouch, -1);
    assert.equal(host.sim.ball.prevTouch, -1);
    const newcomer = join('new');
    assert.equal(newcomer, old, '覆盖球员 ID 复用');
    assert.equal(host.stats.get(newcomer).g, 0);
    host.endMatch();
    host.handleEvents();
    const previous = host.endInfo.stats.find((p) => p.name === 'renamed');
    const current = host.endInfo.stats.find((p) => p.name === 'new');
    assert.equal(previous.g, 2);
    assert.equal(current.g, 0);
    assert.notEqual(previous.id, current.id);
    assert.equal(host.endInfo.mvp, previous.id);
    host.startMatch();
    assert.equal(host.departedStats.length, 0, '下一场清空离场归档');
  } finally { host.close(); }
});

test('断线和同 token 连接替换会取消旧按键队列及蓄力，重连后仅执行新操作', () => {
  for (const replacement of [false, true]) {
    const host = new HostGame('RESET', { listed: false }, (_room, cb) => ({
      cb, broadcastJson() {}, sendJson() {}, linkOf: () => 'relay', drop: (cid) => cb.onLeave(cid), close() {},
    }));
    try {
      host.settings.autoFill = false;
      const hello = { name: 'P', token: 'same-player', team: 0 };
      assert.equal(host.net.cb.onHello('old', hello), null);
      const p = [...host.sim.players.values()][0];
      host.startMatch();
      host.sim.phase = Phase.Playing;
      host.sim.kickoffPending = false;
      Object.assign(p, { x: -30, y: 0, angle: 0 });
      host.sim.setInput(p.id, { jx: 0, jy: 0, btn: BTN_B });
      host.sim.step(1 / 60);
      assert.ok(p.charge >= 0);
      for (const btn of [0, BTN_A, BTN_Y, BTN_B]) host.sim.setInput(p.id, { jx: 1, jy: 0, btn });
      Object.assign(p, { kickBuf: 0.15, passBuf: 0.2, tackleBuf: 0.15, kickPower: 900 });
      if (replacement) host.net.cb.onHello('new', hello);
      else host.net.cb.onLeave('old');
      assert.deepEqual(p.input, { jx: 0, jy: 0, btn: 0 });
      assert.equal(p.inputQueue.length, 0);
      assert.equal(p.prevBtn, 0);
      assert.equal(p.charge, -1);
      assert.equal(p.kickBuf, 0);
      assert.equal(p.passBuf, 0);
      assert.equal(p.tackleBuf, 0);
      host.sim.events.length = 0;
      host.sim.step(1 / 60);
      assert.equal(host.sim.events.length, 0, '离线清理不会出脚或铲球');
      assert.equal(p.tackleT, 0);
      if (!replacement) assert.equal(host.net.cb.onHello('new', hello), null);
      host.net.cb.onBinary('old', encodeInput(20, { jx: 1, jy: 0, btn: BTN_Y }));
      assert.equal(p.input.btn, 0, '旧连接不能继续输入');
      host.net.cb.onBinary('new', encodeInput(0, { jx: 0, jy: 0, btn: BTN_A }));
      host.sim.step(1 / 60);
      assert.ok(host.sim.events.some((event) => event.k === 'kick'), '新连接可正常传球');
    } finally { host.close(); }
  }
});

test('触屏短按经过编码和主机接收后，传射连点保留至出脚冷却结束，铲球接受冷却末段输入', () => {
  const original = { window: globalThis.window, document: globalThis.document };
  try {
    for (const [bit, clicks] of [BTN_A, BTN_B, BTN_Y].flatMap((bit) => [1, 3].map((clicks) => [bit, clicks]))) {
      globalThis.window = new EventTarget();
      globalThis.document = new EventTarget();
      const els = new Map(['.joy-zone', '.joy-base', '.joy-knob'].map((key) => [key, new Element()]));
      const buttons = [1, 2, 4, 8].map((value) => Object.assign(new Element(), { dataset: { bit: String(value) } }));
      const pad = new Gamepad({ insertAdjacentHTML() {}, querySelector: (key) => els.get(key), querySelectorAll: () => buttons });
      const host = new HostGame('TAPS', { listed: false }, (_room, cb) => ({
        cb, broadcastJson() {}, sendJson() {}, linkOf: () => 'relay', close() {},
      }));
      try {
        host.settings.autoFill = false;
        assert.equal(host.net.cb.onHello('player', { name: 'P', token: 'p', team: 0 }), null);
        const p = [...host.sim.players.values()][0];
        host.startMatch();
        host.sim.phase = Phase.Playing;
        host.sim.kickoffPending = false;
        Object.assign(p, { x: -30, y: 0, angle: 0, kickCd: bit === BTN_Y ? 0 : 0.25, tackleCd: bit === BTN_Y ? 0.1 : 0 });
        let seq = 0;
        pad.onButtons = () => host.net.cb.onBinary('player', encodeInput(seq++, pad.input));
        const button = buttons.find((el) => Number(el.dataset.bit) === bit);
        for (let click = 0; click < clicks; click++) {
          fire(button, 'pointerdown', { pointerId: click + 1 });
          fire(button, 'pointerup', { pointerId: click + 1 });
        }
        assert.equal(seq, clicks * 2, '每次按下和松开立即发送');
        let started = -1;
        for (let frame = 1; frame <= 35; frame++) {
          host.sim.step(1 / 60);
          if (started < 0 && (bit === BTN_Y ? p.tackleT > 0 : host.sim.events.some((event) => event.k === 'kick'))) started = frame / 60;
        }
        assert.ok(started >= (bit === BTN_Y ? 0.1 : 0.25) - 1e-9, `按键 ${bit} 不跳过冷却`);
        assert.ok(started <= (bit === BTN_Y ? 0.14 : 0.29), `按键 ${bit} 的冷却结束后执行最近一次输入（实际 ${started}s）`);
        if (bit !== BTN_Y) assert.equal(host.sim.events.filter((event) => event.k === 'kick').length, 1, '连点不会积攒多次自动出脚');
        else {
          host.sim.resetInput(p.id);
          Object.assign(p, { tackleT: 0, tackleCd: 1.4, vx: 0, vy: 0 });
          fire(button, 'pointerdown', { pointerId: 10 });
          fire(button, 'pointerup', { pointerId: 10 });
          for (let frame = 0; frame < 100; frame++) {
            host.sim.step(1 / 60);
            assert.equal(p.tackleT, 0, '冷却初期输入不会在一秒后自动铲球');
          }
        }
      } finally { host.close(); }
    }
  } finally { Object.assign(globalThis, original); }
});

test('传射互切只保留最近一次待执行动作，开球准备会取消铲球缓冲', () => {
  for (const order of [[BTN_A, BTN_B], [BTN_B, BTN_A]]) {
    const sim = new Sim();
    sim.phase = Phase.Playing;
    const p = sim.addPlayer(1, 0);
    Object.assign(p, { x: -30, y: 0, angle: 0, kickCd: 0.25 });
    for (const bit of order) {
      sim.setInput(1, { jx: 0, jy: 0, btn: bit });
      sim.setInput(1, { jx: 0, jy: 0, btn: 0 });
    }
    for (let frame = 0; frame < 35; frame++) sim.step(1 / 60);
    const kicks = sim.events.filter((event) => event.k === 'kick');
    assert.equal(kicks.length, 1);
    assert.equal(kicks[0].shot, order.at(-1) === BTN_B);
    sim.phase = Phase.Ready;
    p.tackleBuf = 0.15;
    sim.step(1 / 60);
    assert.equal(p.tackleBuf, 0);
    sim.phase = Phase.Playing;
    p.tackleCd = 0;
    sim.step(1 / 60);
    assert.equal(p.tackleT, 0);
  }
});

test('再次按住射门蓄力会取消旧传射缓冲，跨过冷却后松开才出脚', () => {
  for (const previous of [BTN_A, BTN_B]) {
    const sim = new Sim();
    sim.phase = Phase.Playing;
    const p = sim.addPlayer(1, 0);
    Object.assign(p, { x: -30, y: 0, angle: 0, kickCd: 0.25 });
    for (const btn of [previous, 0, BTN_B]) {
      sim.setInput(1, { jx: 0, jy: 0, btn });
      sim.step(1 / 60);
    }
    for (let frame = 0; frame < 17; frame++) sim.step(1 / 60);
    assert.equal(p.kickCd, 0, '蓄力已跨过旧出脚冷却');
    assert.ok(p.charge > 0.3);
    assert.equal(sim.events.filter((event) => event.k === 'kick').length, 0, '仍按住B时不会执行旧操作');
    sim.setInput(1, { jx: 0, jy: 0, btn: 0 });
    sim.step(1 / 60);
    const kicks = sim.events.filter((event) => event.k === 'kick');
    assert.equal(kicks.length, 1);
    assert.equal(kicks[0].shot, true);
    assert.ok(kicks[0].power > 600, '执行新一轮蓄力射门');
  }
});

async function withScanner(run) {
  const names = ['document', 'navigator', 'location', 'createImageBitmap', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const original = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const video = { videoWidth: 10, videoHeight: 10, play: async () => {} };
  const msg = {};
  const close = {};
  const file = {};
  const overlay = { isConnected: false, querySelector: (key) => ({ video, '.scan-msg': msg, '.scan-close': close, 'input[type=file]': file })[key], remove() { this.isConnected = false; } };
  let stopped = 0;
  let frames = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const ctx = { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) };
  const values = {
    document: { createElement: (tag) => tag === 'canvas' ? { getContext: () => ctx } : overlay },
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    location: { hash: '' },
    requestAnimationFrame() { return ++frames; }, cancelAnimationFrame() {},
  };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const root = { querySelector: () => overlay.isConnected ? overlay : null, appendChild() { overlay.isConnected = true; } };
  try { await run({ root, video, msg, close, file, ctx, stopped: () => stopped, frames: () => frames }); }
  finally {
    for (const name of names) {
      if (original[name]) Object.defineProperty(globalThis, name, original[name]);
      else delete globalThis[name];
    }
  }
}

test('相机播放失败会释放摄像头；关闭后完成的二维码解码不会跳转', async () => {
  await withScanner(async ({ root, video, stopped }) => {
    video.play = async () => { throw new Error('play failed'); };
    await openScanner(root);
    assert.equal(stopped(), 1);
    assert.equal(video.srcObject, null);
  });
  await withScanner(async ({ root, close, ctx, stopped, frames }) => {
    ctx.drawImage = () => close.onclick();
    await openScanner(root);
    await new Promise(setImmediate);
    assert.equal(location.hash, '');
    assert.equal(stopped(), 1);
    assert.equal(frames(), 0);
  });
});

test('关闭扫码后完成的图片加载不会跳转，且释放图片；重复打开只创建一个扫码层', async () => {
  await withScanner(async ({ root, video, file, close, stopped }) => {
    video.videoWidth = 0;
    await openScanner(root);
    await openScanner(root);
    let resolve;
    let bitmapClosed = false;
    globalThis.createImageBitmap = () => new Promise((done) => { resolve = done; });
    file.files = [{}];
    const pending = file.onchange();
    close.onclick();
    resolve({ width: 10, height: 10, close() { bitmapClosed = true; } });
    await pending;
    assert.equal(bitmapClosed, true);
    assert.equal(location.hash, '');
    assert.equal(stopped(), 1, '重复打开未再申请摄像头');
  });
});
