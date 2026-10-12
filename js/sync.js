// Export/import packages and merge rules.
//
// Merge rules (see plan section 10):
//  1. Match by id.  2. New id -> add.  3. Existing id -> later updatedAt wins.
//  4. Tombstones (deleted:true) are never resurrected.
//  5. A member package may only change that member's own records (categories excepted).
//  6. Checksum + schemaVersion verified before anything is merged.
//  7. Importing the same file twice changes nothing.

import * as db from './db.js';
import { cfg } from './db.js';
import { SCHEMA_VERSION, PACKAGE_APP, nowISO, sha256Hex, stamp, uid } from './models.js';
import * as cats from './categories.js';
import * as reports from './reports.js';

const OWNED = ['transactions', 'accounts', 'recurring'];
const MASTER_STORES = ['members', 'accounts', 'categories', 'transactions', 'budgets', 'recurring', 'holdings'];

// ---------- envelope, checksum, optional encryption ----------

async function envelope(packageType, records, extra = {}) {
  const pkg = {
    app: PACKAGE_APP, packageType, schemaVersion: SCHEMA_VERSION,
    fromMemberId: cfg.memberId, fromMemberName: cfg.memberName,
    createdAt: nowISO(), ...extra, records,
  };
  pkg.checksum = await sha256Hex(JSON.stringify(records));
  return pkg;
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({ app: PACKAGE_APP, encrypted: true, schemaVersion: SCHEMA_VERSION, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

async function decryptWrapper(w, password) {
  try {
    const key = await deriveKey(password, unb64(w.salt));
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, key, unb64(w.data));
    return new TextDecoder().decode(buf);
  } catch {
    throw new Error('Wrong password or damaged file');
  }
}

/** Read + validate a package file. `askPassword` is called for encrypted files. */
export async function readPackageFile(file, askPassword) {
  let text = await file.text();
  let pkg;
  try { pkg = JSON.parse(text); } catch { throw new Error(`${file.name}: not a valid package file`); }
  if (pkg?.encrypted) {
    const pw = await askPassword?.(file.name);
    if (!pw) throw new Error(`${file.name}: password required`);
    text = await decryptWrapper(pkg, pw);
    pkg = JSON.parse(text);
  }
  await validatePackage(pkg, file.name);
  pkg.fileName = file.name;
  return migratePackage(pkg);
}

/** Shared by file import and live sync: shape, version and checksum checks. */
export async function validatePackage(pkg, label = 'File') {
  if (pkg?.app !== PACKAGE_APP || !pkg.records) throw new Error(`${label}: this is not a VM Money file`);
  if (typeof pkg.schemaVersion !== 'number' || pkg.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`${label}: made by a newer app version. Update the app first.`);
  }
  if ((await sha256Hex(JSON.stringify(pkg.records))) !== pkg.checksum) throw new Error(`${label}: damaged (checksum mismatch)`);
  return migratePackage(pkg);
}

function migratePackage(pkg) {
  // Older schemaVersions get upgraded here (nothing yet: v1 is current).
  return pkg;
}

// ---------- merge planning ----------

function planMerge(store, incoming, accept) {
  const plan = { store, add: [], update: [], same: 0, rejected: 0, deleted: 0 };
  for (const rec of incoming || []) {
    if (!rec?.id) { plan.rejected++; continue; }
    if (accept && !accept(rec)) { plan.rejected++; continue; }
    const cur = db.get(store, rec.id);
    if (!cur) { plan.add.push(rec); if (rec.deleted) plan.deleted++; continue; }
    if (cur.deleted) { plan.same++; continue; } // tombstone stays
    if ((rec.updatedAt || '') > (cur.updatedAt || '')) { plan.update.push(rec); if (rec.deleted) plan.deleted++; } else plan.same++;
  }
  return plan;
}

const writePlan = (plan) => db.putMany(plan.store, [...plan.add, ...plan.update], { silent: false });

function memberAccept(pkg) {
  return {
    transactions: (r) => r.ownerId === pkg.fromMemberId,
    accounts: (r) => r.ownerId === pkg.fromMemberId,
    recurring: (r) => r.ownerId === pkg.fromMemberId,
    categories: () => true,
    holdings: () => true, // shared family documents: either member may edit any item
  };
}

// ---------- member package (phone -> hub) ----------

export async function buildMemberPackage({ full = false, forMemberId = cfg.memberId } = {}) {
  const self = forMemberId === cfg.memberId;
  const since = full || !self ? null : cfg.lastExportAt || null;
  const changed = (r) => !since || r.updatedAt > since;
  const mineRecs = (s) => db.all(s).filter((r) => r.ownerId === forMemberId && changed(r));
  const who = db.get('members', forMemberId) || { id: forMemberId, name: cfg.memberName, color: cfg.memberColor };
  const records = {
    transactions: mineRecs('transactions'),
    accounts: mineRecs('accounts'),
    recurring: mineRecs('recurring'),
    categories: db.all('categories').filter(changed),
    holdings: db.all('holdings').filter(changed),
    member: who,
  };
  const pkg = await envelope('member', records, { since, full: full || !self, fromMemberId: forMemberId, fromMemberName: who.name });
  const count = records.transactions.length + records.accounts.length + records.recurring.length + records.categories.length + records.holdings.length;
  const safeName = (who.name || 'member').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { pkg, count, fileName: `mm-member-${safeName}-${stamp()}.json` };
}

export async function commitExport({ fileName, count, createdAt }) {
  await db.setCfg('lastExportAt', createdAt);
  await db.put('syncLog', { id: uid(), direction: 'export', memberId: cfg.memberId, fileName, recordCount: count, at: nowISO() }, { silent: true });
}

// ---------- hub: preview + apply member package ----------

export function previewMemberPackage(pkg) {
  if (pkg.packageType !== 'member') throw new Error(`${pkg.fileName || 'File'}: expected a member package`);
  const acc = memberAccept(pkg);
  const plans = ['categories', 'accounts', 'transactions', 'recurring', 'holdings'].map((s) => planMerge(s, pkg.records[s], acc[s]));
  const lastSeen = lastSyncAt(pkg.fromMemberId);
  const known = !!db.get('members', pkg.fromMemberId);
  // Incremental file whose "since" is later than what the hub last received => changes may be missing.
  const gap = !!pkg.since && (!lastSeen ? true : pkg.since > lastSeen.createdAt);
  return { pkg, plans, known, gap, name: pkg.fromMemberName || pkg.records.member?.name || 'Member' };
}

export async function applyMemberPackage(preview) {
  const { pkg, plans } = preview;
  const byStore = Object.fromEntries(plans.map((p) => [p.store, p]));
  // Categories first so entries always find them. New member-made categories wait for review.
  byStore.categories.add.forEach((c) => { if (!c.isDefault && cfg.mode === 'hub') c.pendingReview = c.pendingReview !== false; });
  await writePlan(byStore.categories);
  for (const s of ['accounts', 'transactions', 'recurring', 'holdings']) await writePlan(byStore[s]);
  const m = pkg.records.member;
  if (m?.id === pkg.fromMemberId) {
    const cur = db.get('members', m.id);
    if (!cur) await db.put('members', { ...m, role: 'member', archived: false }, { silent: true });
    else if (cur.name !== m.name || cur.color !== m.color) await db.put('members', { ...cur, name: m.name, color: m.color, updatedAt: nowISO() }, { silent: true });
  }
  await cats.remapMerged();
  const count = plans.reduce((n, p) => n + p.add.length + p.update.length, 0);
  await db.put('syncLog', {
    id: uid(), direction: 'import', memberId: pkg.fromMemberId, fileName: pkg.fileName || '', recordCount: count,
    at: nowISO(), createdAt: pkg.createdAt,
  }, { silent: true });
  await db.setCfg('lastImportAt', nowISO());
  return count;
}

export function lastSyncAt(memberId) {
  return db.all('syncLog').filter((l) => l.direction === 'import' && l.memberId === memberId)
    .sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
}

// ---------- hub -> phones: family package ----------

/**
 * `ownFor` (live sync): also return that member's own records changed after `since`, so entries imported or
 * recategorised on the hub reach their phone. null `since` means everything.
 */
export async function buildFamilyPackage({ includeSummary = true, ownFor = null, since = null, entries = true, entriesExcept = null, justReceived = null } = {}) {
  const records = {
    categories: db.all('categories'),
    budgets: db.all('budgets'),
    members: db.all('members'),
    holdings: db.all('holdings'),
  };
  if (includeSummary) records.summary = reports.buildFamilySummary();
  if (ownFor) {
    // don't echo back what the phone has only just sent us
    const echo = (s, r) => justReceived?.[s]?.has(`${r.id}|${r.updatedAt}`);
    const mine = (s) => db.all(s).filter((r) => r.ownerId === ownFor && (!since || r.updatedAt > since) && !echo(s, r));
    records.own = { transactions: mine('transactions'), accounts: mine('accounts'), recurring: mine('recurring') };
  }
  if (entries) {
    // Everyone's entries (minus receipt photos) so each phone can see the family's spending. A phone ignores its own.
    const others = (r) => !entriesExcept || r.ownerId !== entriesExcept;
    records.family = {
      transactions: db.all('transactions').filter(others).map((t) => (t.receiptPhoto ? { ...t, receiptPhoto: null } : t)),
      accounts: db.all('accounts').filter(others),
    };
  }
  const pkg = await envelope('family', records);
  return { pkg, fileName: `mm-family-${stamp()}.json`, count: records.categories.length + records.budgets.length + records.holdings.length };
}

export function previewFamilyPackage(pkg) {
  if (pkg.packageType !== 'family') throw new Error(`${pkg.fileName || 'File'}: expected a family package`);
  const r = pkg.records;
  const own = (s) => planMerge(s, r.own?.[s], (rec) => rec.ownerId === cfg.memberId);
  const others = (s) => planMerge(s, r.family?.[s], (rec) => rec.ownerId !== cfg.memberId);
  return {
    pkg, hasSummary: !!r.summary,
    plans: [planMerge('categories', r.categories), planMerge('budgets', r.budgets), planMerge('members', r.members), planMerge('holdings', r.holdings),
      own('accounts'), own('transactions'), own('recurring'), others('accounts'), others('transactions')],
  };
}

export async function applyFamilyPackage(preview) {
  const { pkg, plans } = preview;
  for (const p of plans) await writePlan(p);
  if (pkg.records.summary) await db.setCfg('familySummary', pkg.records.summary);
  if (pkg.records.family) { await db.setCfg('hasFamilyEntries', true); await db.setCfg('familyEntriesAt', nowISO()); }
  await cats.remapMerged();
  await db.setCfg('lastImportAt', nowISO());
  await db.put('syncLog', { id: uid(), direction: 'import', memberId: pkg.fromMemberId, fileName: pkg.fileName || '', recordCount: plans.reduce((n, p) => n + p.add.length + p.update.length, 0), at: nowISO() }, { silent: true });
}

// ---------- master file (hub family.json) ----------

export async function buildMasterText() {
  const records = Object.fromEntries(MASTER_STORES.map((s) => [s, db.all(s)]));
  records.syncLog = db.all('syncLog');
  const pkg = await envelope('master', records, { hubMemberId: cfg.memberId });
  return JSON.stringify(pkg);
}

/** Restore/merge everything from a master file (no ownership filter: it is the hub's own data). */
export async function applyMasterText(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { throw new Error('family.json is not valid'); }
  if (pkg?.app !== PACKAGE_APP || pkg.packageType !== 'master') throw new Error('That is not a Family Hub master file');
  if (pkg.schemaVersion > SCHEMA_VERSION) throw new Error('Master file is from a newer app version. Update first.');
  if ((await sha256Hex(JSON.stringify(pkg.records))) !== pkg.checksum) throw new Error('Master file is damaged (checksum mismatch)');
  let count = 0;
  for (const s of MASTER_STORES) {
    const plan = planMerge(s, pkg.records[s]);
    await writePlan(plan);
    count += plan.add.length + plan.update.length;
  }
  await db.putMany('syncLog', (pkg.records.syncLog || []).filter((l) => !db.get('syncLog', l.id)), { silent: true });
  await cats.remapMerged();
  return { count, hubMemberId: pkg.hubMemberId };
}
