// Categories (two levels: main category -> subcategory), defaults, merge/move/archive.

import * as db from './db.js';
import { cfg } from './db.js';
import { uid, nowISO } from './models.js';

const EPOCH = '2026-01-01T00:00:00.000Z'; // seeded defaults are "oldest", so any edit wins a merge

const COLORS = ['#0f766e', '#2563eb', '#c026d3', '#ea580c', '#65a30d', '#dc2626', '#7c3aed', '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#059669', '#d97706', '#0d9488', '#64748b'];

// [name, icon, [subcategories]]. VJ & MM's own list (from their current expense app), in their order.
const EXPENSE = [
  ['Groceries', '🛒', ['Mukku Kadai', 'New Store', 'Mahalakshmi', 'Super market', 'D Mart', 'Oil', 'Ration', 'Rice 🌾', 'Other']],
  ['Transportation', '🚗', ['VJ 🏍️ petrol ⛽', 'MM Petrol ⛽', 'Car 🚗 petrol ⛽', 'Chennai', 'Toll', 'Bike service', 'Scooty Service', 'Car service', 'Chennai to Kovilpatti', 'Kovilpatti to Chennai', 'Other', 'Parking']],
  ['Vegetables Fruits', '🥬', ['MMM', '🥚 Egg', '🍌 Banana', '🥥 Coconut', 'Fruits', 'Elaneer', 'Other']],
  ['Chennai', '🏙️', ['Hotel', 'Snacks', 'Room Items', 'CHN TO KVP', 'KVP to CHN', 'Transport', 'Rent', 'Other']],
  ['Snacks', '🍿', ['Chennai', 'Dhanlakshmi', 'Ganesh', 'Arun', 'Vadai', 'Chips kadai', 'Waffle', 'Other', 'Bombay sweets', 'Hatusun']],
  ['Beauty', '💄', ['Poo', 'Haircut', 'Dress', 'Zumba', 'Makeup', 'Slippers', 'Shoe', 'Other', 'Ironing']],
  ['Household', '🏠', ['Gas', 'Utensils', 'Furniture', 'Kitchen', 'Toiletries', 'Electric', 'Service', 'Other']],
  ['Medical', '💊', ['Aadhi', 'Hashu', 'VJ', 'MM', 'Other', 'VJ Amma']],
  ['Rent', '🏘️', ['Chennai Room', 'Other']],
  ['Kids', '🧒', ['School', 'Tuition', 'Toys', 'Dress', 'Beauty', 'Games', 'Other', 'Printout']],
  ['Other', '📦', ['Shortage', 'Unknown', 'Other', 'Temple', 'Amma VJ', 'Entertainment']],
  ['Internet', '🌐', ['Home']],
  ['Recharge', '📱', ['VJ BSNL', 'VJ AIRTEL', 'MM BSNL', 'MM JIO', 'VJ Amma', 'Other']],
  ['Hotel', '🏨', ['Chennai', 'Kovilpatti', 'Other']],
  ['Milk', '🥛', []],
  ['Future', '📈', ['Savings', 'Gold', 'Insurance', 'Aadhi PPF', 'Hashu SSY', 'Other']],
  ['Interest', '🏦', ['Housing Loan', 'Bank charges', 'Other', 'Car Loan']],
  ['EB', '💡', []],
  ['School', '🎓', ['AV', 'HV']],
  ['Non-Veg', '🍗', ['Fish', 'Chicken', 'Mutton', 'Egg', 'Other']],
];
const INCOME = [
  ['Salary', '💼', ['Monthly Salary', 'Bonus', 'Allowances']],
  ['Business', '🧾', ['Sales', 'Services']],
  ['Investments', '💹', ['Interest', 'Dividends', 'Maturity']],
  ['Rental', '🏘️', ['House Rent Received']],
  ['Gifts', '🎉', ['Cash Gifts']],
  ['Other Income', '💰', ['Refunds', 'Cashback', 'Miscellaneous']],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const SEED_VERSION = 2; // 2 = VJ & MM's own expense categories

/** Seed the default categories. IDs are deterministic so every device ends up with the same ones. */
export async function seedDefaults() {
  if ((cfg.categorySeed || 0) >= SEED_VERSION) return;
  const recs = [];
  const mk = (o) => ({ ownerId: null, createdAt: EPOCH, updatedAt: EPOCH, deleted: false, archived: false, isDefault: true, createdBy: null, pendingReview: false, ...o });
  const add = (type, list) => list.forEach(([name, icon, subs], i) => {
    const pid = `cat-${type}-${slug(name)}`;
    const color = COLORS[i % COLORS.length];
    recs.push(mk({ id: pid, name, type, parentId: null, icon, color, sortOrder: i }));
    subs.forEach((s, j) => recs.push(mk({ id: `sub-${type}-${slug(name)}-${slug(s)}`, name: s, type, parentId: pid, icon: '', color, sortOrder: j })));
  });
  add('expense', EXPENSE);
  add('income', INCOME);

  // Older versions seeded a generic list. Remove those defaults if untouched and unused; archive if used.
  const keep = new Set(recs.map((r) => r.id));
  const now = nowISO();
  for (const c of db.all('categories')) {
    if (!c.isDefault || c.deleted || keep.has(c.id) || c.updatedAt !== EPOCH) continue;
    const key = c.parentId ? 'subcategoryId' : 'categoryId';
    const used = db.live('transactions').some((t) => t[key] === c.id);
    await db.put('categories', used ? { ...c, archived: true, updatedAt: now } : { ...c, deleted: true, updatedAt: now }, { silent: true });
  }
  const existing = new Set(db.all('categories').map((c) => c.id));
  await db.putMany('categories', recs.filter((r) => !existing.has(r.id)), { silent: true });
  await db.setCfg('categorySeed', SEED_VERSION);
  await db.setCfg('categoriesSeeded', true);
}

export const get = (id) => (id ? db.get('categories', id) : null);
export const name = (id) => get(id)?.name || '(none)';

/** Short label for a transaction's category path. */
export function pathLabel(t) {
  if (t.type === 'transfer') {
    if (!t.toMemberId) return 'Transfer';
    const o = db.get('members', t.toMemberId)?.name || '';
    return t.direction === 'in' ? `Transfer from ${o}` : `Transfer to ${o}`;
  }
  const c = get(t.categoryId);
  const s = get(t.subcategoryId);
  if (!c) return 'Uncategorized';
  return s ? `${c.name} › ${s.name}` : c.name;
}

const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);

/** [{cat, subs:[...]}] for one type. */
export function tree(type, { includeArchived = false } = {}) {
  const ok = (c) => !c.deleted && (includeArchived || !c.archived);
  const cats = db.all('categories').filter((c) => c.type === type && ok(c));
  const mains = cats.filter((c) => !c.parentId).sort(bySort);
  return mains.map((cat) => ({ cat, subs: cats.filter((c) => c.parentId === cat.id).sort(bySort) }));
}

export function pending() {
  return db.live('categories').filter((c) => c.pendingReview);
}

export async function create({ name, type, parentId = null, icon = '', color }) {
  const parent = parentId ? get(parentId) : null;
  const siblings = db.live('categories').filter((c) => c.type === type && (c.parentId || null) === (parentId || null));
  const t = nowISO();
  const isHub = cfg.mode === 'hub';
  const rec = {
    id: uid(), ownerId: cfg.memberId, createdAt: t, updatedAt: t, deleted: false,
    name: name.trim(), type: parent ? parent.type : type, parentId: parentId || null,
    icon: icon || (parent ? '' : '🏷️'), color: color || parent?.color || COLORS[siblings.length % COLORS.length],
    sortOrder: siblings.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), -1) + 1,
    archived: false, isDefault: false, createdBy: cfg.memberId, pendingReview: !isHub,
  };
  await db.put('categories', rec);
  return rec;
}

export const rename = (id, patch) => db.update('categories', id, patch);
export const setArchived = (id, archived) => db.update('categories', id, { archived });
export const accept = (id) => db.update('categories', id, { pendingReview: false });

export async function reorder(id, dir) {
  const c = get(id);
  const sibs = db.live('categories').filter((x) => x.type === c.type && (x.parentId || null) === (c.parentId || null)).sort(bySort);
  const i = sibs.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  for (let k = 0; k < sibs.length; k++) {
    if (sibs[k].sortOrder !== k) await db.update('categories', sibs[k].id, { sortOrder: k });
  }
}

export function usageCount(id) {
  const c = get(id);
  const key = c.parentId ? 'subcategoryId' : 'categoryId';
  return db.live('transactions').filter((t) => t[key] === id).length;
}

/** Move a subcategory under another main category of the same type; its entries follow. */
export async function moveSub(subId, newParentId) {
  const sub = get(subId);
  const parent = get(newParentId);
  if (!sub?.parentId || !parent || parent.parentId || parent.type !== sub.type) throw new Error('Pick a main category of the same type');
  await db.update('categories', subId, { parentId: newParentId, color: parent.color });
  for (const t of db.live('transactions').filter((t) => t.subcategoryId === subId)) {
    await db.update('transactions', t.id, { categoryId: newParentId });
  }
  for (const b of db.live('budgets').filter((b) => b.subcategoryId === subId)) {
    await db.update('budgets', b.id, { categoryId: newParentId });
  }
}

/** Merge src into target (same level, same type). Entries, budgets and children move over. */
export async function mergeInto(srcId, targetId) {
  const src = get(srcId);
  const tgt = get(targetId);
  if (!src || !tgt || srcId === targetId) throw new Error('Pick two different categories');
  if (src.type !== tgt.type || !!src.parentId !== !!tgt.parentId) throw new Error('Merge works between two categories of the same level and type');
  if (!src.parentId) {
    for (const c of db.live('categories').filter((c) => c.parentId === srcId)) await db.update('categories', c.id, { parentId: targetId });
    for (const t of db.live('transactions').filter((t) => t.categoryId === srcId)) await db.update('transactions', t.id, { categoryId: targetId });
    for (const b of db.live('budgets').filter((b) => b.categoryId === srcId)) await db.update('budgets', b.id, { categoryId: targetId });
  } else {
    for (const t of db.live('transactions').filter((t) => t.subcategoryId === srcId)) await db.update('transactions', t.id, { categoryId: tgt.parentId, subcategoryId: targetId });
    for (const b of db.live('budgets').filter((b) => b.subcategoryId === srcId)) await db.update('budgets', b.id, { categoryId: tgt.parentId, subcategoryId: targetId });
  }
  await db.update('categories', srcId, { deleted: true, mergedInto: targetId, pendingReview: false });
}

/** Follow `mergedInto` chains so records pointing at merged categories get fixed (also after a sync). */
export function resolveId(id) {
  let c = get(id);
  let guard = 0;
  while (c?.deleted && c.mergedInto && guard++ < 20) c = get(c.mergedInto);
  return c && !c.deleted ? c.id : id;
}

export async function remapMerged() {
  for (const c of db.live('categories').filter((c) => c.parentId)) {
    const p = resolveId(c.parentId);
    if (p !== c.parentId) await db.update('categories', c.id, { parentId: p });
  }
  const fix = async (store, rec) => {
    const patch = {};
    const cid = rec.categoryId && resolveId(rec.categoryId);
    const sid = rec.subcategoryId && resolveId(rec.subcategoryId);
    if (cid && cid !== rec.categoryId) patch.categoryId = cid;
    if (sid && sid !== rec.subcategoryId) {
      patch.subcategoryId = sid;
      const s = get(sid);
      if (s?.parentId) patch.categoryId = s.parentId;
    }
    if (Object.keys(patch).length) await db.update(store, rec.id, patch);
  };
  for (const t of db.live('transactions')) await fix('transactions', t);
  for (const b of db.live('budgets')) await fix('budgets', b);
}
