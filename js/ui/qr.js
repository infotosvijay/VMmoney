// QR codes for live-sync pairing: draw one (qrcode-generator) and scan one with the camera.
// Scanning uses the browser's BarcodeDetector where it has one (Android Chrome), jsQR otherwise (iPhone).
// Both libraries are bundled in js/vendor so pairing works offline from the cache.

import { sheet, esc } from './components.js';

const loads = {};
function loadVendor(file) {
  loads[file] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL(`../vendor/${file}`, import.meta.url).href;
    s.onload = res;
    s.onerror = () => { delete loads[file]; rej(new Error('Could not load the QR library')); };
    document.head.append(s);
  });
  return loads[file];
}

/** SVG markup for `text`, black on white (wrap it in .qr so it stays scannable in dark mode). */
export async function qrSvg(text) {
  await loadVendor('qrcode.min.js');
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'Pairing QR code' });
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const d = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await d.detect(video))[0]?.rawValue;
      }
    } catch { /* fall back to jsQR */ }
  }
  await loadVendor('jsqr.min.js');
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  return (video) => {
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data;
  };
}

function cameraError(e) {
  if (e?.name === 'NotAllowedError') return 'Camera permission was refused. Allow the camera for this app, or type the 6-digit code.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No camera found. Type the 6-digit code instead.';
  return 'Could not open the camera. Type the 6-digit code instead.';
}

/**
 * Opens the camera in a sheet and resolves with the first QR text that `accept` likes,
 * or null if the user closes the sheet.
 */
export async function scanQR({ title = 'Scan the QR code', hint = '', accept = () => true } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera here. Type the 6-digit code instead.');
  const detect = await makeDetector();
  return new Promise((resolve, reject) => {
    let stream = null;
    let timer = 0;
    let result = null;
    const cleanup = () => { clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    const s = sheet(title, `<div class="scan"><video playsinline muted autoplay></video><div class="scan-frame"></div></div>
      ${hint ? `<p class="muted small center">${esc(hint)}</p>` : ''}`, { onClose: () => { cleanup(); resolve(result); } });
    const video = s.el.querySelector('video');

    const tick = async () => {
      if (!stream) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          const text = await detect(video);
          if (text && accept(text)) { result = text; navigator.vibrate?.(60); s.close(); return; }
        }
      } catch { /* a bad frame: try the next one */ }
      timer = setTimeout(tick, 200);
    };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((st) => {
        if (!s.el.open) { st.getTracks().forEach((t) => t.stop()); return; }
        stream = st;
        video.srcObject = st;
        video.play().catch(() => {});
        tick();
      })
      .catch((e) => { reject(new Error(cameraError(e))); s.close(); });
  });
}
