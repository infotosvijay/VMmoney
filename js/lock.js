// App lock: PIN (salted PBKDF2 hash) plus optional device biometrics via WebAuthn.
// This is a privacy gate for shared phones, not protection against someone with devtools access.

import * as db from './db.js';
import { cfg } from './db.js';
import { esc } from './models.js';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPin(pin, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, k, 256));
}

export const hasPin = () => !!cfg.pinHash;
export const hasBiometric = () => !!cfg.bioCredId;
export const biometricSupported = () => !!(window.PublicKeyCredential && navigator.credentials);

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await db.setCfg('pinSalt', b64(salt));
  await db.setCfg('pinHash', await hashPin(pin, salt));
  await db.setCfg('lockType', 'pin');
}
export async function verifyPin(pin) {
  return cfg.pinHash && (await hashPin(pin, unb64(cfg.pinSalt))) === cfg.pinHash;
}
export async function removeLock() {
  for (const k of ['pinHash', 'pinSalt', 'bioCredId']) await db.delCfg(k);
  await db.setCfg('lockType', 'none');
}

export async function enableBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'VM Money' },
      user: { id: enc.encode(cfg.memberId || 'user'), name: cfg.memberName || 'user', displayName: cfg.memberName || 'user' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });
  await db.setCfg('bioCredId', b64(cred.rawId));
}

async function biometricUnlock() {
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(cfg.bioCredId) }],
      userVerification: 'required', timeout: 60000,
    },
  });
}

// ---- lock screen ----

let locked = false;
let idleTimer = null;
let hiddenAt = 0;
const root = () => document.getElementById('lock');
export const isLocked = () => locked;

export function lock() {
  if (!hasPin() || locked) return;
  locked = true;
  const el = root();
  let entered = '';
  el.hidden = false;
  el.innerHTML = `
    <div class="lock-box">
      <img src="icons/logo-160.png" alt="" width="60" height="78" style="margin-bottom:8px"><div class="lock-title">Enter PIN</div>
      <div class="lock-dots" aria-hidden="true">${'<i></i>'.repeat(4)}</div>
      <div class="lock-msg" role="alert"></div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="bio" ${hasBiometric() ? '' : 'disabled'} aria-label="Use fingerprint or face">${hasBiometric() ? '🔓' : ''}</button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="Delete">⌫</button>
      </div>
    </div>`;
  const dots = [...el.querySelectorAll('.lock-dots i')];
  const msg = el.querySelector('.lock-msg');
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < entered.length));
  const unlock = () => { locked = false; el.hidden = true; el.innerHTML = ''; armIdle(); };
  const tryBio = async () => {
    if (!hasBiometric()) return;
    try { await biometricUnlock(); unlock(); } catch { msg.textContent = 'Biometric failed. Use your PIN.'; }
  };
  el.onclick = async (e) => {
    const k = e.target.closest('button')?.dataset.k;
    if (!k) return;
    msg.textContent = '';
    if (k === 'del') entered = entered.slice(0, -1);
    else if (k === 'bio') return tryBio();
    else if (entered.length < 4) entered += k;
    paint();
    if (entered.length === 4) {
      if (await verifyPin(entered)) unlock();
      else { msg.textContent = 'Wrong PIN'; entered = ''; setTimeout(paint, 250); }
    }
  };
  if (hasBiometric()) tryBio();
}

function armIdle() {
  clearTimeout(idleTimer);
  if (!hasPin() || locked) return;
  const mins = Number(cfg.autoLockMinutes ?? 2);
  if (mins > 0) idleTimer = setTimeout(lock, mins * 60000);
}

export function initLock() {
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => window.addEventListener(ev, armIdle, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hasPin() && hiddenAt && Date.now() - hiddenAt > 30000) lock();
  });
  if (hasPin()) lock();
}

/** Used by Settings to build the "set PIN" prompt body. */
export const pinInputHTML = (id, label) =>
  `<label class="field"><span>${esc(label)}</span><input id="${id}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4 digits"></label>`;
