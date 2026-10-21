import { BTN_A, BTN_B, BTN_X, BTN_Y, type Input } from '../game/types';
import { t } from '../i18n';

const BUTTONS = [
  { bit: BTN_Y, key: 'Y', label: t('pad.y'), cls: 'y' },
  { bit: BTN_X, key: 'X', label: t('pad.x'), cls: 'x' },
  { bit: BTN_B, key: 'B', label: t('pad.b'), cls: 'b' },
  { bit: BTN_A, key: 'A', label: t('pad.a'), cls: 'a' },
];

// 桌面调试：WASD/方向键移动，J 传球 K 射门 L/Shift 冲刺 I 铲球
const KEY_BITS: Record<string, number> = {
  KeyJ: BTN_A,
  KeyK: BTN_B,
  Space: BTN_B,
  KeyL: BTN_X,
  ShiftLeft: BTN_X,
  ShiftRight: BTN_X,
  KeyI: BTN_Y,
};
const KEY_DIRS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** 虚拟手柄：左侧浮动摇杆 + 右侧 ABXY 四键 */
export class Gamepad {
  readonly input: Input = { jx: 0, jy: 0, btn: 0 };
  /** 按键按下时回调（用于震动反馈） */
  onPress: (bit: number) => void = () => {};
  /** 按键变化立即发送，避免短按落在两次定时采样之间。 */
  onButtons: () => void = () => {};
  private joyId: number | null = null;
  private origin = { x: 0, y: 0 };
  private base: HTMLElement;
  private knob: HTMLElement;
  private zone: HTMLElement;
  private bEl!: HTMLElement;
  private bDown = 0;
  private touchBtn = 0;
  private keyBtn = 0;
  private keys = new Set<string>();
  private R = 56;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="joy-zone"><div class="joy-base"><div class="joy-knob"></div></div></div>
       <div class="btn-pad">${BUTTONS.map(
         (b) => `<div class="pad-btn ${b.cls}" data-bit="${b.bit}"><b>${b.key}</b><span>${b.label}</span></div>`,
       ).join('')}</div>`,
    );
    this.zone = root.querySelector('.joy-zone')!;
    this.base = root.querySelector('.joy-base')!;
    this.knob = root.querySelector('.joy-knob')!;
    this.bindJoystick();
    root.querySelectorAll<HTMLElement>('.pad-btn').forEach((el) => this.bindButton(el));
    this.bindKeyboard();
    this.restBase();
  }

  private restBase() {
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = '';
  }

  private bindJoystick() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return;
      e.preventDefault();
      this.joyId = e.pointerId;
      z.setPointerCapture(e.pointerId);
      const r = z.getBoundingClientRect();
      const m = this.R + 10;
      const x = Math.max(r.left + m, Math.min(r.right - m, e.clientX));
      const y = Math.max(r.top + m, Math.min(r.bottom - m, e.clientY));
      this.origin = { x, y };
      this.base.classList.add('active');
      this.base.style.left = `${x - r.left}px`;
      this.base.style.top = `${y - r.top}px`;
      this.moveJoy(e.clientX, e.clientY);
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) this.moveJoy(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.input.jx = this.input.jy = 0;
      this.restBase();
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  private moveJoy(cx: number, cy: number) {
    let dx = cx - this.origin.x;
    let dy = cy - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > this.R) {
      dx = (dx / d) * this.R;
      dy = (dy / d) * this.R;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const len = Math.min(d, this.R);
    const m = len / this.R;
    const dead = 0.12;
    if (m < dead) {
      this.input.jx = this.input.jy = 0;
      return;
    }
    const mag = (m - dead) / (1 - dead);
    this.input.jx = (dx / len) * mag;
    this.input.jy = (dy / len) * mag;
  }

  private bindButton(el: HTMLElement) {
    const bit = Number(el.dataset.bit);
    if (bit === BTN_B) this.bEl = el;
    const ids = new Set<number>();
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      ids.add(e.pointerId);
      if (!(this.touchBtn & bit)) {
        this.touchBtn |= bit;
        this.press(bit);
      }
      el.classList.add('down');
      this.sync();
    });
    const up = (e: PointerEvent) => {
      if (!ids.delete(e.pointerId) || ids.size) return;
      this.touchBtn &= ~bit;
      el.classList.remove('down');
      this.sync();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private press(bit: number) {
    if (bit === BTN_B) this.bDown = performance.now();
    this.onPress(bit);
  }

  private bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (KEY_BITS[e.code] || KEY_DIRS[e.code]) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const bit = KEY_BITS[e.code];
      if (bit && !(this.keyBtn & bit)) {
        this.keyBtn |= bit;
        this.press(bit);
      }
      this.syncKeys();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const bit = KEY_BITS[e.code];
      if (bit && ![...this.keys].some((k) => KEY_BITS[k] === bit)) this.keyBtn &= ~bit;
      this.syncKeys();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.keyBtn = 0;
      this.syncKeys();
    });
  }

  private syncKeys() {
    if (this.joyId === null) {
      let x = 0;
      let y = 0;
      for (const k of this.keys) {
        const d = KEY_DIRS[k];
        if (d) {
          x += d[0];
          y += d[1];
        }
      }
      const m = Math.hypot(x, y) || 1;
      this.input.jx = x / m;
      this.input.jy = y / m;
    }
    this.sync();
  }

  private sync() {
    const btn = this.touchBtn | this.keyBtn;
    if (btn === this.input.btn) return;
    this.input.btn = btn;
    this.onButtons();
  }

  /** 每帧调用：更新射门蓄力环 */
  update() {
    const charge = this.input.btn & BTN_B ? Math.min(1, (performance.now() - this.bDown) / 850) : 0;
    this.bEl.style.setProperty('--charge', String(charge));
  }
}
