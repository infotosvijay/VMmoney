// Shared UI helpers: toasts, dialogs, file sharing, charts, small HTML builders.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, fmtMoney, thisMonth } from '../models.js';
import { icon } from './icons.js';

const THEME_COLOR = { light: '#e6ebf3', dark: '#05070d' };
export function applyTheme() {
  const theme = cfg.theme || 'auto';
  document.documentElement.dataset.theme = theme;
  // status-bar colour: follows the system in "auto", otherwise the chosen theme
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const scheme = m.media.includes('dark') ? 'dark' : 'light';
    m.content = THEME_COLOR[theme === 'auto' ? scheme : theme] || THEME_COLOR.light;
  });
}
/** Chart colours from the palette: a blue ramp for the biggest slices, grey for the rest. */
export const chartColors = (n) => Array.from({ length: n }, (_, i) => cssVar(i < 5 ? `--chart-${i + 1}` : '--chart-rest'));
/** Distinct hues for categories (pie slices and their swatches), in a fixed order; from the 8th on: grey "Other". */
export const CAT_SLOTS = 7;
export const catColor = (i) => cssVar(i < CAT_SLOTS ? `--cat-${i + 1}` : '--cat-other');
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

/** "Deleted" toast with Undo instead of a confirm popup. `restore` puts the item back. */
export function undoToast(msg, restore) {
  return toast(msg, { action: 'Undo', timeout: 6000, onAction: restore });
}

/** Modal dialog / bottom sheet. Returns { el, close }. */
export function sheet(title, bodyHTML, { onClose, wide = false } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet' + (wide ? ' wide' : '');
  dlg.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div><div class="sheet-body">${bodyHTML}</div>`;
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
    const s = sheet(title, `<form class="stack"><label class="field"><span>${esc(label)}</span><input name="v" type="${type === 'number' ? 'text' : type}" value="${esc(value)}" autocomplete="off" ${type === 'number' ? 'inputmode="none" data-keypad' : ''} required></label>${help ? `<p class="muted small">${esc(help)}</p>` : ''}<div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${esc(okText)}</button></div></form>`, { onClose: () => resolve(result) });
    const form = s.el.querySelector('form');
    form.onsubmit = (e) => {
      e.preventDefault();
      if (type === 'number') {
        const n = evalAmount(form.v.value);
        if (Number.isNaN(n)) { toast('Enter a number or a sum like 1200+350'); form.v.focus(); return; }
        result = String(Math.round(n * 100) / 100);
      } else result = form.v.value;
      s.close();
    };
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

/** The month title as a button: tap it to jump to any month with the Year / Month dropdowns (see pickMonth). */
export const monthTitle = (label) => `<button type="button" class="mpick" data-mpick title="Choose a month">${esc(label)} ${icon('down', { cls: 'sm' })}</button>`;

/** Year + Month dropdowns in a sheet. Resolves 'YYYY-MM', or null if closed. `max` caps the choice (e.g. this month). */
export function pickMonth(current, { max = null } = {}) {
  const [cy, cm] = (/^\d{4}-\d{2}$/.test(current) ? current : (max || thisMonth())).split('-').map(Number);
  const firstYear = db.live('transactions').reduce((y, t) => (t.date && +t.date.slice(0, 4) < y ? +t.date.slice(0, 4) : y), cy);
  const lastYear = Math.max(cy, max ? +max.slice(0, 4) : new Date().getFullYear() + 1);
  const years = [];
  for (let y = lastYear; y >= firstYear; y--) years.push(y);
  const names = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('en-IN', { month: 'long' }));
  return new Promise((resolve) => {
    let result = null;
    const s = sheet('Go to month', `<form class="stack">
        <div class="row" style="flex-wrap:nowrap">
          <label class="field grow"><span>Month</span><select name="m">${names.map((n, i) => `<option value="${i + 1}" ${i + 1 === cm ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field grow"><span>Year</span><select name="y">${years.map((y) => `<option value="${y}" ${y === cy ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        </div>
        <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Show</button></div></form>`, { onClose: () => resolve(result) });
    const form = s.el.querySelector('form');
    // months after `max` can't be picked in the last year
    const limit = () => { for (const o of form.m.options) o.disabled = !!max && `${form.y.value}-${String(o.value).padStart(2, '0')}` > max; if (form.m.selectedOptions[0]?.disabled) form.m.value = String(+max.slice(5)); };
    form.y.onchange = limit;
    limit();
    form.onsubmit = (e) => { e.preventDefault(); result = `${form.y.value}-${String(form.m.value).padStart(2, '0')}`; s.close(); };
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

export const empty = (msg, sub = '') => `<div class="empty"><div class="empty-icon">${icon('note')}</div><p>${esc(msg)}</p>${sub ? `<p class="muted small">${sub}</p>` : ''}</div>`;

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
// A closed banner stays away until the app is opened again (kept in memory only, never saved).
const closedBanners = new Set();
export const bannerClosed = (key) => closedBanners.has(key);
export const closeBanner = (key) => closedBanners.add(key);
export const bannerX = (key) => `<button type="button" class="icon-btn banner-x" data-dismiss="${esc(key)}" aria-label="Close">${icon('close')}</button>`;

export function installBanner() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || cfg.installDismissed || bannerClosed('install')) return '';
  if (window.__installPrompt) {
    return `<div class="banner info">${bannerX('install')}<b>${icon('download')} Install this app</b><p class="small">Add it to your home screen: it opens full-screen, works offline, and your data is better protected.</p><div class="row"><button class="btn primary small" data-action="install">Install</button><button class="btn small" data-action="dismiss-install">Not now</button></div></div>`;
  }
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return `<div class="banner info">${bannerX('install')}<b>${icon('download')} Install this app</b><p class="small">Tap the Share button in Safari, then “Add to Home Screen”. Installed apps keep their data safely.</p><div class="row"><button class="btn small" data-action="dismiss-install">Got it</button></div></div>`;
  }
  return '';
}


/** "Sync with the other phone" nudge when there are changes and the last phone-to-phone sync is a week old. */
export function syncReminder(changedSince, other) {
  const last = cfg.peerSyncAt?.[other?.id];
  if (!changedSince || !other || daysSince(last) < 7 || bannerClosed('sync')) return '';
  return `<div class="banner">${bannerX('sync')}<b>${icon('sync')} Time to sync with ${esc(other.name)}'s phone</b><p class="small">Last synced ${esc(relTime(last))}. Keeps both phones up to date.</p><div class="row"><a class="btn primary small" href="#/sync">Sync now</a></div></div>`;
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

// ---------------------------------------------------------------- calculator in amount boxes

/** Evaluates a typed amount like "120+45.5*2" or "(300-20)/4" (+ − × ÷ and brackets). NaN if it is not valid. */
export function evalAmount(input) {
  const s = String(input).replace(/[,\s]/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  let i = 0;
  const num = () => {
    const m = /^\d*\.?\d+|^\d+\./.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = () => {
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    if (s[i] === '(') { i++; const v = expr(); if (s[i++] !== ')') throw 0; return v; }
    return num();
  };
  const term = () => {
    let v = factor();
    while (s[i] === '*' || s[i] === '/') v = s[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const expr = () => {
    let v = term();
    while (s[i] === '+' || s[i] === '-') v = s[i++] === '+' ? v + term() : v - term();
    return v;
  };
  try {
    const v = expr();
    return i === s.length && Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
}
export const hasMath = (s) => /\d\s*[-+*/×xX÷−–]|^\s*\(/.test(String(s));

const roundAmt = (v) => String(Math.round(v * 100) / 100);

// ---------------------------------------------------------------- in-app number pad for amounts

const coarse = () => matchMedia('(pointer: coarse)').matches;
let keypadShow = null;
/** Open the pad for `el` straight away (a focus event alone is not sent while the window is in the background). */
export const openKeypad = (el) => { if (el && keypadShow && coarse() && el.matches('[data-keypad]')) keypadShow(el); };

/**
 * Every amount box (<input data-keypad>) on a touch screen gets the app's own number pad instead of the phone keyboard:
 * digits, . ⌫ ( ) + − × ÷, = (works the sum out) and Done. The running result shows above the keys.
 * Pair it with inputmode="none" so the phone keyboard stays closed. On a laptop it is ignored (type as usual).
 * Call once at start-up; it works for inputs drawn later too.
 */
export function installKeypad() {
  const KEYS = [
    ['(', '(', 'op'], [')', ')', 'op'], ['back', icon('backspace'), 'op', 'Delete'], ['÷', '÷', 'op', 'Divide'],
    ['7'], ['8'], ['9'], ['×', '×', 'op', 'Times'],
    ['4'], ['5'], ['6'], ['−', '−', 'op', 'Minus'],
    ['1'], ['2'], ['3'], ['+', '+', 'op', 'Plus'],
    ['.', '.', '', 'Point'], ['0'], ['=', '=', 'op', 'Work it out'], ['done', 'Done', 'done'],
  ];
  const pad = document.createElement('div');
  pad.className = 'kpad';
  pad.hidden = true;
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Amount keypad');
  pad.innerHTML = `<div class="kpad-out num" aria-live="polite"></div><div class="kpad-grid">${KEYS.map(([k, label = k, cls = '', aria = '']) =>
    `<button type="button" data-kp="${esc(k)}" class="${cls}" ${aria ? `aria-label="${esc(aria)}"` : ''}>${label}</button>`).join('')}</div>`;
  const out = pad.querySelector('.kpad-out');
  let cur = null;

  const preview = () => {
    if (!cur) return;
    const v = evalAmount(cur.value);
    out.textContent = hasMath(cur.value) ? (Number.isNaN(v) ? '= …' : `= ${money(Number(roundAmt(v)))}`) : '';
  };
  const settle = (el) => {
    const v = evalAmount(el.value);
    if (hasMath(el.value) && !Number.isNaN(v)) { el.value = roundAmt(v); el.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  const hide = () => {
    pad.hidden = true;
    document.body.classList.remove('kpad-open');
    cur = null;
  };
  const show = (el) => {
    cur = el;
    (el.closest('dialog') || document.body).appendChild(pad);
    pad.hidden = false;
    document.body.classList.add('kpad-open');
    document.documentElement.style.setProperty('--kpad-h', `${pad.offsetHeight}px`);
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* ignore */ }
    preview();
    requestAnimationFrame(() => {
      if (el.closest('dialog')) { el.scrollIntoView({ block: 'nearest' }); return; }
      const r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight - pad.offsetHeight - 12) el.scrollIntoView({ block: 'center' });
    });
  };

  keypadShow = show;
  // keep the focus (and the caret) in the amount box while tapping keys
  pad.addEventListener('pointerdown', (e) => e.preventDefault());
  pad.addEventListener('mousedown', (e) => e.preventDefault());
  pad.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kp]')?.dataset.kp;
    if (!k || !cur) return;
    if (!cur.isConnected) return hide();
    try { navigator.vibrate?.(8); } catch { /* no vibration: fine */ }
    if (k === 'done') { settle(cur); cur.blur(); return; }
    if (k === '=') settle(cur);
    else {
      const a = cur.selectionStart ?? cur.value.length, b = cur.selectionEnd ?? a;
      if (k === 'back') { if (a !== b) cur.setRangeText('', a, b, 'end'); else if (a > 0) cur.setRangeText('', a - 1, a, 'end'); }
      else cur.setRangeText(k, a, b, 'end');
      cur.dispatchEvent(new Event('input', { bubbles: true }));
    }
    preview();
  });

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.matches?.('input[data-keypad]') && coarse()) show(el);
    else if (cur && !pad.contains(el)) hide();
  });
  document.addEventListener('focusout', (e) => {
    if (!e.target.matches?.('input[data-keypad]')) return;
    settle(e.target); // "1200+980" becomes 2180 when you leave the box
    if (e.target === cur) setTimeout(() => { if (cur && document.activeElement !== cur) hide(); }, 0);
  });
  document.addEventListener('input', (e) => { if (e.target === cur) preview(); });
  // the screen was redrawn or changed: a pad without its box makes no sense
  document.addEventListener('pointerdown', (e) => { if (cur && !pad.contains(e.target) && e.target !== cur) setTimeout(() => { if (cur && (document.activeElement !== cur || !cur.isConnected)) hide(); }, 0); }, true);
  window.addEventListener('hashchange', hide);
}
