import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// 保留真实页面的交互逻辑，只替换绘制、网络和浏览器平台能力。
const mocks = {
  qrcode: 'export default {};',
  '../game/host-game': 'export class HostGame {}',
  '../game/render': 'export class Renderer {} export const TEAM_COLOR = ["red", "blue"], TEAM_NAME = ["A", "B"]; export const goalText = () => "";',
  '../ui/stats-ui': 'export const resultLineHtml = () => "", statsTabHtml = () => "";',
  '../game/sim': 'export const predictMove = () => {}, constrainPlayerBounds = () => false;',
  '../game/types': 'export const BTN_A=1, BTN_B=2, BTN_Y=8, FLAG_STUN=4, FLAG_TACKLE=8; export const Phase={Lobby:0,Ready:1,Playing:2,Goal:3,Ended:4};',
  '../net/client': `const h = globalThis.__playConnectionTest;
    export class ClientNet {
      state = 'signal';
      constructor(room, info) { this.room = room; this.info = info; h.connections.push(this); }
      start() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
      close() { this.closed = true; }
    }`,
  '../net/lan-client': 'export class LanClient {}',
  '../net/lan-host': 'export class LanHost {}',
  '../net/lan-session': 'export const lanSession = () => null;',
  '../ui/lan-room': 'export const bindLanAddress = () => {}, lanInfoHtml = () => "";',
  '../net/interp': `export const separateViewBall = (view) => view, separateViewPlayers = (view) => view;
    export class SnapBuffer {
    constructor() { globalThis.__playConnectionTest.buffer = this; this.frames = []; }
    reset() { this.frames = []; }
    push(frame) { this.frames.push(frame); }
  }`,
  '../net/protocol': 'export const decodeSnapshot = (data) => data, encodeInput = () => new Uint8Array();',
  '../config': 'export const CONFIG = { maxPerTeam: 4 };',
  '../i18n': 'export const t = (key) => key;',
  '../ui/gamepad': 'export class Gamepad { reset() {} }',
  '../ui/qrcard': 'export const saveQrCard = () => {};',
  '../ui/settings-ui': 'export const bindLobby = () => {}, pinLineHtml = () => "", settingsHtml = () => "", settingsSummary = () => "", teamCardHtml = () => "";',
  '../ui/site': 'export const icon = {};',
  '../ui/sound': 'export const unlockAudio = () => {};',
  '../ui/util': `const values = globalThis.__playConnectionTest.values;
    export const store = { get: (key) => values.get(key) || '', set: (key, value) => values.set(key, value) };
    export const brand = String, esc = String, canFullscreen = () => true, isFullscreen = () => false,
      enterFullscreen = async () => true, joinUrl = () => '', keepAwake = () => {},
      randomCode = () => 'TOKEN', roomOpts = () => ({}), vibrate = () => {};`,
};

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/src/pages/play.ts') && specifier in mocks) {
      return { url: `test:play/${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('test:play/')) return { format: 'module', shortCircuit: true, source: mocks[url.slice('test:play/'.length)] };
    if (!url.endsWith('/src/pages/play.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpile(readFileSync(new URL(url), 'utf8'), {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    }) };
  },
});

test('加入失败和密码拒绝恢复可操作表单，重试时旧连接回调不会污染新连接', async () => {
  const globals = ['window', 'document', 'setInterval', 'setTimeout', 'requestAnimationFrame', '__playConnectionTest'];
  const original = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));
  const harness = { connections: [], values: new Map() };
  globalThis.__playConnectionTest = harness;
  globalThis.window = globalThis.document = { addEventListener() {} };
  globalThis.setInterval = globalThis.setTimeout = globalThis.requestAnimationFrame = () => 0;
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        hidden: selector === '.pin', value: selector === '.name' ? 'P' : '',
        classList: {
          add: (name) => classes.add(name), remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
          toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
        },
        setAttribute() {}, focus() { this.focused = true; },
        querySelector: (child) => element(`${selector} ${child}`), querySelectorAll: () => [],
      });
    }
    return elements.get(selector);
  };
  const app = { querySelector: element, querySelectorAll: () => [] };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  try {
    const { mountPlay } = await import('../src/pages/play.ts');
    mountPlay(app, { kind: 'client', room: 'ABCDE', forceRelay: false, pin: '', lock: false, lan: false });
    const form = element('.join');
    const play = element('.play');
    const pin = element('.pin');
    const go = () => element('.go').onclick();

    go();
    const first = harness.connections[0];
    assert.equal(form.hidden, true);
    assert.equal(play.classList.contains('joined'), true);
    first.reject(new Error('offline'));
    await flush();
    assert.equal(first.closed, true);
    assert.equal(form.hidden, false, '信令失败后可再次点击加入');
    assert.equal(play.classList.contains('joined'), false, '竖屏旋转提示不会盖住表单');
    assert.equal(harness.values.get('sfb.joined.ABCDE'), '');

    go();
    const second = harness.connections[1];
    first.onReject('pinWrong');
    assert.equal(form.hidden, true, '上轮的拒绝不能打断本轮加入');
    assert.equal(pin.hidden, true);
    second.onReject('pinWrong');
    assert.equal(second.closed, true);
    assert.equal(form.hidden, false);
    assert.equal(play.classList.contains('joined'), false, '密码错误后竖屏也能修改密码');
    assert.equal(pin.hidden, false);
    assert.equal(pin.focused, true);
    assert.equal(pin.value, '');
    assert.equal(harness.values.get('sfb.joined.ABCDE'), '');

    pin.value = '1234';
    go();
    const current = harness.connections[2];
    assert.equal(current.info.pin, '1234');
    const status = element('.status').className;
    second.onState('relay');
    second.onJson({ t: 'welcome', pid: -1 });
    second.onBinary({ tick: 99 });
    second.onReject('pinNeed');
    second.reject(new Error('late failure'));
    await flush();
    assert.equal(form.hidden, true);
    assert.equal(play.classList.contains('joined'), true);
    assert.equal(play.classList.contains('watching'), false);
    assert.equal(element('.status').className, status);
    assert.equal(pin.value, '1234');
    assert.equal(harness.values.get('sfb.joined.ABCDE'), '1');
    assert.equal(harness.buffer.frames.length, 0, '旧快照不能进入新比赛缓冲');
    assert.equal(current.closed, undefined, '迟到的失败不能关闭新连接');
    current.onBinary({ tick: 1 });
    assert.equal(harness.buffer.frames.length, 1, '当前连接的回调仍正常处理');
    current.resolve();
    await flush();
  } finally { Object.assign(globalThis, original); }
});
