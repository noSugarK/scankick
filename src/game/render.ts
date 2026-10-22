import { t } from '../i18n';
import { F, ballRadius } from './sim';
import { FLAG_CHARGE, FLAG_STUN, FLAG_TACKLE, Phase, type PlayerInfo, type SnapPlayer, type Snapshot } from './types';

export const TEAM_COLOR = ['#e5484d', '#3e7bfa'];
export const TEAM_DARK = ['#8c1d22', '#173f99'];
export const TEAM_NAME = [t('team.red'), t('team.blue')];
const ME = '#ffd60a';

/** 进球横幅上的文案（主机与客户端共用） */
export function goalText(team: number, scorer: string, own: boolean) {
  return own ? t('play.ownGoal', { name: scorer }) : `${TEAM_NAME[team]} · ${scorer}`;
}

export interface ViewState extends Snapshot {
  info: Map<number, PlayerInfo>;
  meId: number;
  goalText?: string;
}

const WORLD_W = 2 * (F.HL + F.MARGIN) + 8;
const WORLD_H = 2 * (F.HW + F.MARGIN) + 8;

export function fmtTime(sec: number) {
  const s = Math.ceil(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private cam = { x: 0, y: 0, z: 1 };
  private trail: { x: number; y: number }[] = [];
  private ballSpin = 0;
  follow = false;
  /** 画面顶部/底部预留给 HUD 或按键的像素 */
  padTop = 0;
  showHud = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
  }

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  private fitScale() {
    return Math.min(this.w / WORLD_W, (this.h - this.padTop) / WORLD_H);
  }

  draw(s: ViewState, dt: number) {
    const { ctx } = this;
    const fit = this.fitScale();
    const me = s.players.find((p) => p.id === s.meId);
    let tz = fit;
    let tx = 0;
    let ty = 0;
    if (this.follow && me) {
      tz = fit * 1.8;
      const vw = this.w / tz / 2;
      const vh = (this.h - this.padTop) / tz / 2;
      tx = clampAbs(me.x, Math.max(0, WORLD_W / 2 - vw));
      ty = clampAbs(me.y, Math.max(0, WORLD_H / 2 - vh));
    }
    const k = Math.min(1, dt * 6);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    this.cam.z += (tz - this.cam.z) * k;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#17532c';
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(this.w / 2, this.padTop + (this.h - this.padTop) / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawPitch();
    this.drawBall(s, dt);
    const sorted = [...s.players].sort((a, b) => a.y - b.y);
    for (const p of sorted) this.drawPlayer(p, s.info.get(p.id), p.id === s.meId);
    this.drawGoalsTop();
    ctx.restore();

    if (this.showHud) this.drawHud(s);
    this.drawBanner(s);
  }

  private drawPitch() {
    const { ctx } = this;
    const L = F.HL;
    const W = F.HW;
    // 草皮条纹
    const total = 2 * (L + F.MARGIN);
    const n = 14;
    const sw = total / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? '#2d8a4a' : '#319552';
      ctx.fillRect(-L - F.MARGIN + i * sw, -W - F.MARGIN, sw + 0.5, 2 * (W + F.MARGIN));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-L, -W, 2 * L, 2 * W);
    line(ctx, 0, -W, 0, W);
    ctx.beginPath();
    ctx.arc(0, 0, F.CENTER_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.strokeRect(s === -1 ? -L : L - F.BOX_D, -F.BOX_W, F.BOX_D, 2 * F.BOX_W);
      ctx.strokeRect(s === -1 ? -L : L - 50, -F.GW - 30, 50, 2 * (F.GW + 30));
      ctx.beginPath();
      ctx.arc(s * (L - 95), 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // 禁区弧
      ctx.beginPath();
      const cx = s * (L - 95);
      const a = Math.acos((F.BOX_D - 95) / 70);
      if (s === -1) ctx.arc(cx, 0, 70, -a, a);
      else ctx.arc(cx, 0, 70, Math.PI - a, Math.PI + a);
      ctx.stroke();
    }
    // 球网
    for (const s of [-1, 1]) {
      const x0 = s === -1 ? -L - F.GD : L;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x0, -F.GW, F.GD, 2 * F.GW);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      for (let y = -F.GW; y <= F.GW; y += 10) line(ctx, x0, y, x0 + F.GD, y);
      for (let x = 0; x <= F.GD; x += 10) line(ctx, x0 + x, -F.GW, x0 + x, F.GW);
    }
  }

  private drawGoalsTop() {
    const { ctx } = this;
    for (const s of [-1, 1]) {
      const x = s * F.HL;
      const back = s * (F.HL + F.GD);
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = F.FRAME_R * 2;
      ctx.beginPath();
      ctx.moveTo(x, -F.GW);
      ctx.lineTo(back, -F.GW);
      ctx.lineTo(back, F.GW);
      ctx.lineTo(x, F.GW);
      ctx.stroke();
      for (const y of [-F.GW, F.GW]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, F.POST_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, F.POST_R - ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawBall(s: ViewState, dt: number) {
    const { ctx } = this;
    const b = s.ball;
    const r = ballRadius(s.party);
    const speed = Math.hypot(b.vx, b.vy);
    this.ballSpin += (speed * dt) / r;
    this.trail.push({ x: b.x, y: b.y });
    if (this.trail.length > 10) this.trail.shift();
    if (speed > 480) {
      for (let i = 0; i < this.trail.length - 1; i++) {
        const t = this.trail[i];
        ctx.fillStyle = `rgba(255,255,255,${(i / this.trail.length) * 0.35})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r * (0.5 + (i / this.trail.length) * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(b.x + 3, b.y + 4, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    for (let i = 0; i < 3; i++) {
      const a = this.ballSpin + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(a) * r * 0.5, b.y + Math.sin(a) * r * 0.5, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawPlayer(p: SnapPlayer, info: PlayerInfo | undefined, isMe: boolean) {
    const { ctx } = this;
    const team = info?.team ?? 0;
    const r = F.PR;
    const stun = p.flags & FLAG_STUN;
    ctx.globalAlpha = info && !info.online ? 0.4 : 1;

    if (p.flags & FLAG_TACKLE) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = r;
      ctx.lineCap = 'round';
      line(ctx, p.x - p.vx * 0.06, p.y - p.vy * 0.06, p.x, p.y);
      ctx.lineCap = 'butt';
    }

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(p.x + 3, p.y + 5, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (isMe) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = ME;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = stun ? '#888' : TEAM_COLOR[team];
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = TEAM_DARK[team];
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();

    // 朝向指示
    const a = p.angle;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a) * (r + 7), p.y + Math.sin(a) * (r + 7));
    ctx.lineTo(p.x + Math.cos(a + 0.45) * (r + 1), p.y + Math.sin(a + 0.45) * (r + 1));
    ctx.lineTo(p.x + Math.cos(a - 0.45) * (r + 1), p.y + Math.sin(a - 0.45) * (r + 1));
    ctx.closePath();
    ctx.fill();

    if (p.flags & FLAG_CHARGE) {
      ctx.strokeStyle = p.charge >= 0.99 ? '#ff3b30' : '#ff9f0a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.05, p.charge));
      ctx.stroke();
    }

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stun ? '✶' : String(info?.num ?? ''), p.x, p.y + 1);

    if (info) {
      const label = info.online ? info.name : `${info.name}(${t('status.offline')})`;
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 10;
      const ly = p.y - r - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, p.x - tw / 2, ly - 9, tw, 17, 8);
      ctx.fill();
      ctx.fillStyle = isMe ? ME : '#fff';
      ctx.fillText(label, p.x, ly);
      if (isMe) {
        ctx.fillStyle = ME;
        ctx.beginPath();
        ctx.moveTo(p.x - 6, ly - 20);
        ctx.lineTo(p.x + 6, ly - 20);
        ctx.lineTo(p.x, ly - 12);
        ctx.fill();
      }
    }

    if (isMe && p.stamina < 0.99) {
      const bw = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(p.x - bw / 2, p.y + r + 6, bw, 5);
      ctx.fillStyle = p.stamina < 0.3 ? '#e5484d' : '#2fbf71';
      ctx.fillRect(p.x - bw / 2, p.y + r + 6, bw * p.stamina, 5);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(s: ViewState) {
    const { ctx } = this;
    const cx = this.w / 2;
    const y = 10;
    const scale = Math.max(0.75, Math.min(1.4, this.w / 1100));
    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(scale, scale);
    const W = 300;
    const H = 44;
    // 比分牌半透明，少挡球场；文字保持不透明
    ctx.fillStyle = 'rgba(13,31,22,0.45)';
    roundRect(ctx, -W / 2, 0, W, H, 12);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = TEAM_COLOR[0];
    roundRect(ctx, -W / 2 + 6, 6, 72, H - 12, 8);
    ctx.fill();
    ctx.fillStyle = TEAM_COLOR[1];
    roundRect(ctx, W / 2 - 78, 6, 72, H - 12, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(String(s.score[0]), -W / 2 + 42, H / 2 + 1);
    ctx.fillText(String(s.score[1]), W / 2 - 42, H / 2 + 1);
    ctx.font = 'bold 22px ui-monospace, Menlo, monospace';
    const clock = s.phase === Phase.Lobby ? t('hud.warmup') : s.golden ? t('hud.golden') : s.mode === 1 ? t('mode.1') : fmtTime(s.timeLeft);
    ctx.fillStyle = s.golden ? '#ffd60a' : s.mode !== 1 && s.phase === Phase.Playing && s.timeLeft < 10 ? '#ff453a' : '#fff';
    ctx.font = s.golden || s.mode === 1 ? 'bold 16px system-ui, sans-serif' : s.phase === Phase.Lobby ? 'bold 20px system-ui, sans-serif' : 'bold 22px ui-monospace, Menlo, monospace';
    ctx.fillText(clock, 0, H / 2 + 1);
    const rules = [s.mode === 2 && !s.golden ? t('mode.2') : '', s.party ? t(`party.${s.party}`) : ''].filter(Boolean).join(' · ');
    if (rules) {
      ctx.font = '600 13px system-ui, sans-serif';
      const width = ctx.measureText(rules).width + 20;
      ctx.fillStyle = 'rgba(13,31,22,0.8)';
      roundRect(ctx, -width / 2, H + 4, width, 24, 8);
      ctx.fill();
      ctx.fillStyle = '#ffd60a';
      ctx.fillText(rules, 0, H + 16);
    }
    ctx.restore();
  }

  private drawBanner(s: ViewState) {
    const { ctx } = this;
    let text = '';
    let sub = '';
    let color = '#fff';
    if (s.phase === Phase.Ready) {
      text = s.phaseTime < 1 ? t('hud.ready') : t('hud.kickoff');
      if (s.golden) sub = t('hud.golden');
    } else if (s.phase === Phase.Goal && s.goalText) {
      text = 'GOAL!';
      sub = s.goalText;
      color = s.score[0] + s.score[1] > 0 ? '#ffd60a' : '#fff';
    }
    if (!text) return;
    const size = Math.min(this.w / 6, 120);
    const k = s.phase === Phase.Goal ? Math.min(1, s.phaseTime * 3) : 1;
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2 - size * 0.2);
    ctx.scale(0.6 + 0.4 * easeOutBack(k), 0.6 + 0.4 * easeOutBack(k));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    ctx.lineWidth = size / 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    if (sub) {
      ctx.font = `700 ${size / 3}px system-ui, sans-serif`;
      ctx.lineWidth = size / 25;
      ctx.strokeText(sub, 0, size * 0.75);
      ctx.fillStyle = '#fff';
      ctx.fillText(sub, 0, size * 0.75);
    }
    ctx.restore();
  }
}

function clampAbs(v: number, m: number) {
  return Math.max(-m, Math.min(m, v));
}
function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function easeOutBack(t: number) {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}
