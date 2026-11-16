// IndexedDB wrapper. All data is mirrored in memory so screens can read synchronously.
// Upgrades must only ADD stores/fields; they must never delete user data.

import { nowISO } from './models.js';

const DB_NAME = 'family-money-manager';
const DB_VERSION = 2;
export const DATA_STORES = ['members', 'accounts', 'categories', 'transactions', 'budgets', 'recurring', 'holdings', 'syncLog'];

let idb; // undefined in memory mode (tests)
const mem = {};
let dataVersion = 0; // bumps on every write, so derived data can be cached until something changes
export const version = () => dataVersion;
export const cfg = {}; // settings, mirrored in memory
const listeners = new Set();

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = (store) => listeners.forEach((f) => { try { f(store); } catch (e) { console.error(e); } });

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const d = r.result;
      const old = e.oldVersion;
      if (old < 1) {
        DATA_STORES.forEach((s) => d.createObjectStore(s, { keyPath: 'id' }));
        d.createObjectStore('settings', { keyPath: 'key' });
      } else if (old < 2) {
        d.createObjectStore('holdings', { keyPath: 'id' }); // v2: Balances (banks, cash, cards)
      }
      // Future versions: `if (old < 3) { add stores / backfill defaults only }`
      // Keep a record of every upgrade that ran on this device (visible in cfg.dbMigrations).
      const st = r.transaction.objectStore('settings');
      const prev = st.get('dbMigrations');
      prev.onsuccess = () => st.put({ key: 'dbMigrations', value: [...(prev.result?.value || []), { from: old, to: DB_VERSION, at: nowISO() }] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database blocked by another tab'));
  });
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
const store = (name, mode = 'readonly') => idb.transaction(name, mode).objectStore(name);

export async function init() {
  idb = await open();
  for (const s of DATA_STORES) {
    mem[s] = new Map();
    (await req(store(s).getAll())).forEach((r) => mem[s].set(r.id, r));
  }
  (await req(store('settings').getAll())).forEach((r) => { cfg[r.key] = r.value; });
}

/** Memory-only database with no IndexedDB, for tests. */
export function initMemory() {
  idb = undefined;
  for (const s of DATA_STORES) mem[s] = new Map();
  Object.keys(cfg).forEach((k) => delete cfg[k]);
  dataVersion++;
}

export const all = (s) => [...mem[s].values()];
export const live = (s) => all(s).filter((r) => !r.deleted);
export const get = (s, id) => mem[s].get(id);

// Storage first, memory second: if the write fails (quota, blocked) the screen never shows data that isn't saved.
export async function put(s, rec, { silent = false } = {}) {
  if (idb) await req(store(s, 'readwrite').put(rec));
  mem[s].set(rec.id, rec);
  dataVersion++;
  if (!silent) notify(s);
  return rec;
}

export async function putMany(s, recs, { silent = false } = {}) {
  if (!recs.length) return;
  if (idb) {
    const t = idb.transaction(s, 'readwrite');
    recs.forEach((r) => t.objectStore(s).put(r));
    await done(t);
  }
  recs.forEach((r) => mem[s].set(r.id, r));
  dataVersion++;
  if (!silent) notify(s);
}

/** Apply one patch to many records in a single write and a single screen refresh. */
export async function updateMany(s, ids, patch) {
  const at = nowISO();
  const recs = ids.map((id) => mem[s].get(id)).filter(Boolean).map((cur) => ({ ...cur, ...patch, updatedAt: at }));
  await putMany(s, recs);
  return recs;
}

/** Merge a patch into a record and bump updatedAt (so the change syncs). */
export async function update(s, id, patch) {
  const cur = mem[s].get(id);
  if (!cur) throw new Error(`${s}/${id} not found`);
  return put(s, { ...cur, ...patch, updatedAt: nowISO() });
}

export async function clearStore(s) {
  if (idb) await req(store(s, 'readwrite').clear());
  mem[s].clear();
  dataVersion++;
  notify(s);
}

export async function setCfg(key, value) {
  cfg[key] = value;
  await req(store('settings', 'readwrite').put({ key, value }));
  notify('settings');
}

export async function delCfg(key) {
  delete cfg[key];
  await req(store('settings', 'readwrite').delete(key));
  notify('settings');
}

/** Erase everything on this device (used by Settings > Erase all data). */
export async function wipeAll() {
  for (const s of [...DATA_STORES, 'settings']) await req(store(s, 'readwrite').clear());
  DATA_STORES.forEach((s) => mem[s].clear());
  dataVersion++;
  Object.keys(cfg).forEach((k) => delete cfg[k]);
}

/** Ask the browser not to evict our data. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      const ok = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
      await setCfg('persisted', !!ok);
      return ok;
    }
  } catch { /* ignore */ }
  return false;
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export { nowISO };
