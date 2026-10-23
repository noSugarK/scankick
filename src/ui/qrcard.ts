// 保存房间二维码：生成带 logo 的分享卡片（PNG），手机走系统分享（可存相册），电脑直接下载
import QRCode from 'qrcode';
import { t } from '../i18n';
import { brand, joinUrl, type RoomRef } from './util';

const W = 720;
const PAD = 56;
const QR = W - PAD * 2;
const FG = '#17251c';
const MUTED = '#61705f';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function renderQrCard(ref: RoomRef): Promise<HTMLCanvasElement> {
  const { room, pin } = ref;
  const [logo, mark] = await Promise.all([loadImage(brand('logo.png')), loadImage(brand('icon.png'))]);
  // 中心要盖图标，用最高纠错等级 H（可容忍约 30% 遮挡）
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, joinUrl(ref), { errorCorrectionLevel: 'H', width: QR, margin: 1, color: { dark: FG, light: '#ffffff' } });

  const logoW = 380;
  const logoH = Math.round((logo.height / logo.width) * logoW);
  const H = PAD + logoH + 36 + QR + 40 + 64 + (pin ? 44 : 0) + 36 + PAD;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);

  let y = PAD;
  g.drawImage(logo, (W - logoW) / 2, y, logoW, logoH);
  y += logoH + 36;

  g.drawImage(qr, PAD, y);
  // 中心图标：白色圆角底 + 图标，约占二维码边长 22%
  const box = Math.round(QR * 0.22);
  const bx = PAD + (QR - box) / 2;
  const by = y + (QR - box) / 2;
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(bx, by, box, box, box * 0.22);
  g.fill();
  const m = box * 0.12;
  g.drawImage(mark, bx + m, by + m, box - 2 * m, box - 2 * m);
  y += QR + 40;

  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillStyle = FG;
  g.font = '700 56px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  g.letterSpacing = '12px';
  g.fillText(room, W / 2 + 6, y); // letterSpacing 会在末尾多留一格，向右补半格居中
  g.letterSpacing = '0px';
  y += 64;
  if (pin) {
    g.font = '500 30px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(`${t('play.pinLine')}  ${pin}`, W / 2, y);
    y += 44;
  }
  g.fillStyle = MUTED;
  g.font = '400 26px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText(t('qr.caption'), W / 2, y);
  return c;
}

export async function saveQrCard(ref: RoomRef) {
  const canvas = await renderQrCard(ref);
  const { room } = ref;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], `scankick-${room}.png`, { type: 'image/png' });
  // 触屏设备优先系统分享：iOS / Android 可以直接存到相册或发给朋友
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t('app.name') });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
