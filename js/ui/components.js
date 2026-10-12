// Shared UI helpers: toasts, dialogs, file sharing, charts, small HTML builders.

import { cfg } from '../db.js';
import { esc, fmtMoney } from '../models.js';

export function applyTheme() {
  document.documentElement.dataset.theme = cfg.theme || 'auto';
}
export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const money = (n) => fmtMoney(n, cfg.currency || 'INR');
/** Same as money() but drops ".00" for whole amounts, for tight spaces. */
export const moneyC = (n) => (Number.isInteger(Math.round((n || 0) * 100) / 100) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: cfg.currency || 'INR', maximumFractionDigits: 0 }).format(n || 0) : money(n));
export { esc };

export function toast(msg, { action, onAction, timeout = 3500 } = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  const close = () => el.remove();
  if (action) el.querySelector('button').onclick = () => { close(); onAction?.(); };
  box.append(el);
  if (timeout) setTimeout(close, timeout);
  return close;
}

/** Modal dialog / bottom sheet. Returns { el, close }. */
export function sheet(title, bodyHTML, { onClose, wide = false } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet' + (wide ? ' wide' : '');
  dlg.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div><div class="sheet-body">${bodyHTML}</div>`;
  document.body.append(dlg);
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) close(); });
  dlg.showModal();
  return { el: dlg, close };
}

export function confirmDialog(message, { okText = 'OK', danger = false, title = 'Please confirm' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const s = sheet(title, `<p>${esc(message)}</p><div class="row end"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button></div>`, { onClose: () => resolve(result) });
    s.el.querySelector('[data-ok]').onclick = () => { result = true; s.close(); };
  });
}

export function promptDialog({ title, label, value = '', type = 'text', okText = 'Save', help = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const s = sheet(title, `<form class="stack"><label class="field"><span>${esc(label)}</span><input name="v" type="${type}" value="${esc(value)}" autocomplete="off" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} required></label>${help ? `<p class="muted small">${esc(help)}</p>` : ''}<div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${esc(okText)}</button></div></form>`, { onClose: () => resolve(result) });
    const form = s.el.querySelector('form');
    form.onsubmit = (e) => { e.preventDefault(); result = form.v.value; s.close(); };
    form.v.focus(); form.v.select?.();
  });
}

/** Show `message` and let the user pick one option. options: [[value,label]]. */
export function pickDialog(title, options, { message = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const s = sheet(title, `${message ? `<p class="muted">${esc(message)}</p>` : ''}<div class="list">${options.map(([v, l]) => `<button type="button" class="list-item" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`, { onClose: () => resolve(result) });
    s.el.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { result = b.dataset.v; s.close(); } });
  });
}

export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** Share through the OS share sheet when possible (WhatsApp, Quick Share...), else download. Returns false if cancelled. */
export async function shareOrDownload(filename, text, mime = 'application/json') {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  download(filename, text, mime);
  return true;
}

export function pickFiles({ accept = '.json,application/json', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => resolve([...inp.files]);
    inp.oncancel = () => resolve([]);
    inp.click();
  });
}

/** Downscale a photo to a small JPEG data URL so receipts stay light. */
export function compressImage(file, max = 800, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

// ---- charts (Chart.js is bundled in js/vendor so it works offline) ----

let chartLoad;
function loadChartLib() {
  if (window.Chart) return Promise.resolve();
  chartLoad ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/chart.min.js', import.meta.url).href;
    s.onload = res; s.onerror = () => rej(new Error('chart lib failed to load'));
    document.head.append(s);
  });
  return chartLoad;
}
const live = new Set();
export function destroyCharts() { live.forEach((c) => c.destroy()); live.clear(); }

export async function drawChart(canvas, config) {
  if (!canvas) return;
  try {
    await loadChartLib();
    if (!canvas.isConnected) return;
    const css = getComputedStyle(document.documentElement);
    window.Chart.defaults.color = css.getPropertyValue('--muted').trim() || '#666';
    window.Chart.defaults.borderColor = css.getPropertyValue('--line').trim() || '#ddd';
    config.options = { responsive: true, maintainAspectRatio: false, ...config.options };
    live.add(new window.Chart(canvas, config));
  } catch (e) {
    canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Chart unavailable offline.' }));
  }
}

// ---- small HTML builders ----

export const empty = (msg, sub = '') => `<div class="empty"><div class="empty-icon">🗒️</div><p>${esc(msg)}</p>${sub ? `<p class="muted small">${sub}</p>` : ''}</div>`;

export const progress = (pct, level = 'ok') => `<div class="bar ${level}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, pct)}%"></i></div>`;

export const chip = (text, color) => `<span class="chip" ${color ? `style="--c:${esc(color)}"` : ''}>${esc(text)}</span>`;

export const dot = (color) => `<span class="dot" style="background:${esc(color)}"></span>`;

export function memberOptions(members, selected = '', all = 'All members') {
  return `<option value="">${esc(all)}</option>` + members.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}

export function relTime(iso) {
  if (!iso) return 'never';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}
export const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity);

// ---- banners shown on the phone landing page ----
export function installBanner() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || cfg.installDismissed) return '';
  if (window.__installPrompt) {
    return `<div class="banner info"><b>Install this app</b><p class="small">Add it to your home screen: it opens full-screen, works offline, and your data is better protected.</p><div class="row"><button class="btn primary small" data-action="install">Install</button><button class="btn small" data-action="dismiss-install">Not now</button></div></div>`;
  }
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return `<div class="banner info"><b>Install this app</b><p class="small">Tap the Share button in Safari, then “Add to Home Screen”. Installed apps keep their data safely.</p><div class="row"><button class="btn small" data-action="dismiss-install">Got it</button></div></div>`;
  }
  return '';
}


/** "Send your data to the Hub" nudge when changes are older than a week. */
export function syncReminder(changedSince) {
  if (!changedSince || daysSince(cfg.lastExportAt) < 7) return '';
  return `<div class="banner"><b>Time to sync with the Hub</b><p class="small">Last sent ${esc(relTime(cfg.lastExportAt))}. This also works as a backup.</p><div class="row"><a class="btn primary small" href="#/sync">Sync now</a></div></div>`;
}

// ---- swipe between tabs (touch screens) ----

let pendingSlide = null;
/** Which way the last swipe went, so the next screen can slide in from that side. Read once. */
export const consumeSlide = () => { const d = pendingSlide; pendingSlide = null; return d; };

/**
 * Horizontal swipe on `el`: calls handler('next', startElement) for a swipe left, handler('prev', startElement) for a swipe right.
 * Return false from the handler when there is nothing further in that direction.
 * Ignored when the swipe starts on a field, a table, or anything marked .no-swipe, and when it is mostly vertical.
 */
export function onSwipe(el, handler, { min = 70 } = {}) {
  el.classList.add('swipeable'); // gives short pages enough height to swipe on
  let x0 = 0, y0 = 0, t0 = 0, ok = false, startEl = null;
  el.addEventListener('touchstart', (e) => {
    ok = e.touches.length === 1 && !e.target.closest('input, select, textarea, .table-wrap, .no-swipe');
    if (ok) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); startEl = e.target; }
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!ok) return;
    ok = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (Date.now() - t0 > 700 || Math.abs(dx) < min || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (handler(dx < 0 ? 'next' : 'prev', startEl) !== false) pendingSlide = dx < 0 ? 'left' : 'right';
  }, { passive: true });
}
