// 扫码加入：摄像头或相册图片 + jsQR（按需加载，iOS Safari 没有 BarcodeDetector，统一用 jsQR）
import { t } from '../i18n';
import { icon } from './site';
import { isPin, normalizeCode } from './util';

/** 只接受本游戏的加入链接或纯房间码，返回要跳转的 hash；其它内容一律不跟随 */
export function joinHashFromQr(text: string): string | null {
  const m = text.match(/#\/join\/([A-Za-z0-9]{4,8})(?:\?([^#\s]*))?/);
  if (m) {
    const query = new URLSearchParams(m[2] ?? '');
    // Local QR codes must open the host's origin, not this site's online room.
    if (query.get('lan') === '1') return null;
    const pin = query.get('pin');
    return `#/join/${normalizeCode(m[1])}${isPin(pin) ? `?pin=${pin}` : ''}`;
  }
  const code = text.trim();
  return /^[A-Za-z0-9]{5}$/.test(code) ? `#/join/${normalizeCode(code)}` : null;
}

export async function openScanner(root: HTMLElement): Promise<void> {
  if (root.querySelector('.scan-overlay')) return;
  const el = document.createElement('div');
  el.className = 'scan-overlay';
  el.innerHTML = `
    <video playsinline muted></video>
    <div class="scan-frame"></div>
    <div class="scan-bottom">
      <p class="scan-msg">${t('scan.loading')}</p>
      <label class="scan-upload">${icon.image}<span>${t('scan.upload')}</span><input type="file" accept="image/*" hidden></label>
    </div>
    <button class="icon-btn scan-close" aria-label="${t('scan.close')}">${icon.x}</button>`;
  root.appendChild(el);
  const video = el.querySelector('video')!;
  const msg = el.querySelector<HTMLElement>('.scan-msg')!;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let stream: MediaStream | null = null;
  let raf = 0;
  let lastBad = '';
  let closed = false;

  const stopCamera = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    video.srcObject = null;
  };
  const close = () => {
    closed = true;
    stopCamera();
    el.remove();
  };
  el.querySelector<HTMLElement>('.scan-close')!.onclick = close;

  /** 识别一帧；是本游戏的码就跳转并返回 true */
  const decode = async (src: CanvasImageSource, w: number, h: number, fromPhoto = false) => {
    // 缩小后再识别：摄像头最长边 640 足够快，照片给 1200 保留细节
    const k = Math.min(1, (fromPhoto ? 1200 : 640) / Math.max(w, h));
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const jsqr = (await import('jsqr')).default;
    if (closed || !el.isConnected) return true;
    const code = jsqr(img.data, img.width, img.height, { inversionAttempts: fromPhoto ? 'attemptBoth' : 'dontInvert' });
    if (!code?.data) return false;
    const hash = joinHashFromQr(code.data);
    if (hash) {
      close();
      location.hash = hash;
      return true;
    }
    if (code.data !== lastBad) {
      lastBad = code.data;
      msg.textContent = t('scan.notOurs');
    }
    return true;
  };

  // 相册图片
  const file = el.querySelector<HTMLInputElement>('input[type=file]')!;
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    let bmp: ImageBitmap | undefined;
    try {
      bmp = await createImageBitmap(f);
      if (closed) return;
      lastBad = '';
      if (!(await decode(bmp, bmp.width, bmp.height, true))) msg.textContent = t('scan.noCode');
    } catch {
      msg.textContent = t('scan.noCode');
    } finally {
      bmp?.close();
    }
  };

  // 摄像头
  if (!navigator.mediaDevices?.getUserMedia) {
    msg.textContent = t('scan.unsupported');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (!el.isConnected) return close(); // 打开期间已关闭
    video.srcObject = stream;
    await video.play();
    if (closed) return;
    msg.textContent = t('scan.hint');
    const tick = async () => {
      if (closed || !el.isConnected) return close();
      try {
        if (video.videoWidth) await decode(video, video.videoWidth, video.videoHeight);
        if (!closed) raf = requestAnimationFrame(tick);
      } catch {
        stopCamera();
        msg.textContent = t('scan.unsupported');
      }
    };
    tick();
  } catch (e) {
    stopCamera();
    const name = (e as Error)?.name;
    msg.textContent = t(name === 'NotAllowedError' || name === 'SecurityError' ? 'scan.denied' : 'scan.unsupported');
  }
}
