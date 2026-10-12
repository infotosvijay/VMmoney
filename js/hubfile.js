// Hub: keep a master `family.json` on disk via the File System Access API (Chrome/Edge desktop).

import * as db from './db.js';
import { cfg } from './db.js';
import { buildMasterText, applyMasterText } from './sync.js';
import { nowISO } from './models.js';

export const supported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

let handle = null;
let timer = null;
let listener = () => {};
export const status = { linked: false, name: '', needsPermission: false, lastSaved: null, error: '' };
export const onStatus = (fn) => { listener = fn; };
const emit = () => listener({ ...status });

const FILE_TYPES = [{ description: 'VM Money data', accept: { 'application/json': ['.json'] } }];

async function hasPermission(ask) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return ask && (await handle.requestPermission(opts)) === 'granted';
}

export async function restoreHandle() {
  if (!supported || !cfg.hubFileHandle) return;
  handle = cfg.hubFileHandle;
  status.linked = true;
  status.name = handle.name;
  status.lastSaved = cfg.hubFileSavedAt || null;
  try { status.needsPermission = !(await hasPermission(false)); } catch { status.needsPermission = true; }
  emit();
  watch();
}

/** Create/choose the file to save to, then write the current data into it. */
export async function link() {
  const h = await window.showSaveFilePicker({ suggestedName: 'family.json', types: FILE_TYPES });
  handle = h;
  await db.setCfg('hubFileHandle', h);
  status.linked = true; status.name = h.name; status.needsPermission = false;
  await save();
  watch();
  return h.name;
}

/** Open an existing family.json, merge it into this browser, and keep saving to it. */
export async function openExisting() {
  const [h] = await window.showOpenFilePicker({ types: FILE_TYPES });
  const file = await h.getFile();
  const res = await applyMasterText(await file.text());
  handle = h;
  await db.setCfg('hubFileHandle', h);
  status.linked = true; status.name = h.name;
  try { status.needsPermission = !(await hasPermission(true)); } catch { status.needsPermission = true; }
  if (!cfg.memberId && res.hubMemberId) await db.setCfg('memberId', res.hubMemberId);
  await save().catch(() => {});
  watch();
  return res;
}

export async function unlink() {
  handle = null;
  await db.delCfg('hubFileHandle');
  status.linked = false; status.name = ''; emit();
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  db.onChange((store) => { if (store !== 'settings') scheduleSave(); });
}

function scheduleSave() {
  if (!handle) return;
  clearTimeout(timer);
  timer = setTimeout(() => save().catch(() => {}), 1500);
}

export async function save({ ask = false } = {}) {
  if (!handle) return false;
  try {
    if (!(await hasPermission(ask))) { status.needsPermission = true; emit(); return false; }
    const w = await handle.createWritable();
    await w.write(await buildMasterText());
    await w.close();
    status.needsPermission = false; status.error = '';
    status.lastSaved = nowISO();
    await db.setCfg('hubFileSavedAt', status.lastSaved);
  } catch (e) {
    status.error = e.message || String(e);
    emit();
    return false;
  }
  emit();
  return true;
}

/** Restore from a family.json the user picked (browsers without the File System Access API). */
export async function restoreFromText(text) {
  const res = await applyMasterText(text);
  if (!cfg.memberId && res.hubMemberId) await db.setCfg('memberId', res.hubMemberId);
  return res;
}

/** Fallback for browsers without the File System Access API: download the master file. */
export async function downloadMaster() {
  const blob = new Blob([await buildMasterText()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'family.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
