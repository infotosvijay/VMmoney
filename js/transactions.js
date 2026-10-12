// Transactions, accounts and members.

import * as db from './db.js';
import { cfg } from './db.js';
import { base, todayStr, FAMILY, familyMember, nowISO } from './models.js';

export const mine = (r) => r.ownerId === cfg.memberId;
export const canEdit = (t) => t.ownerId === cfg.memberId;

export async function add(data) {
  const t = {
    ...base(cfg.memberId),
    type: 'expense', amount: 0, date: todayStr(),
    categoryId: null, subcategoryId: null, accountId: null, toAccountId: null,
    paymentMode: 'cash', note: '', toMemberId: null, direction: null, tags: [], receiptPhoto: null, recurringId: null,
    ...data,
  };
  return db.put('transactions', t);
}
export const update = (id, patch) => db.update('transactions', id, patch);
export const remove = (id) => db.update('transactions', id, { deleted: true });

/** Filter transactions. scope: 'mine' | 'all'. Returns newest first. */
export function query(f = {}) {
  const text = f.text?.trim().toLowerCase();
  let list = db.live('transactions');
  if (f.scope === 'mine') list = list.filter(mine);
  if (f.memberId) list = list.filter((t) => t.ownerId === f.memberId);
  if (f.from) list = list.filter((t) => t.date >= f.from);
  if (f.to) list = list.filter((t) => t.date <= f.to);
  if (f.type) list = list.filter((t) => t.type === f.type);
  if (f.categoryId) list = list.filter((t) => t.categoryId === f.categoryId);
  if (f.subcategoryId) list = list.filter((t) => t.subcategoryId === f.subcategoryId);
  if (f.accountId) list = list.filter((t) => t.accountId === f.accountId || t.toAccountId === f.accountId);
  if (f.min) list = list.filter((t) => t.amount >= f.min);
  if (f.max) list = list.filter((t) => t.amount <= f.max);
  if (text) list = list.filter((t) => `${t.note} ${(t.tags || []).join(' ')}`.toLowerCase().includes(text));
  return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
}

// ---- accounts ----

export const myAccounts = ({ includeArchived = false } = {}) =>
  db.live('accounts').filter((a) => a.ownerId === cfg.memberId && (includeArchived || !a.archived));

export async function ensureDefaultAccount() {
  if (myAccounts({ includeArchived: true }).length) return;
  const a = { ...base(cfg.memberId), name: 'Cash', type: 'cash', openingBalance: 0, archived: false };
  a.id = `acc-${cfg.memberId}-cash`;
  await db.put('accounts', a, { silent: true });
}

export function accountBalance(acc) {
  let bal = Number(acc.openingBalance) || 0;
  for (const t of db.live('transactions')) {
    if (t.accountId === acc.id) {
      const gain = t.type === 'income' || (t.type === 'transfer' && t.toMemberId && t.direction === 'in');
      bal += gain ? t.amount : -t.amount; // expense, own-account transfer out, family transfer out
    }
    if (t.type === 'transfer' && t.toAccountId === acc.id) bal += t.amount;
  }
  return bal;
}

export async function addAccount({ name, type, openingBalance }) {
  return db.put('accounts', { ...base(cfg.memberId), name: name.trim(), type, openingBalance: Number(openingBalance) || 0, archived: false });
}

export const accountName = (id) => db.get('accounts', id)?.name || '';

// ---- members ----

export const members = () => db.live('members').filter((m) => !m.archived);
export const memberName = (id) => db.get('members', id)?.name || 'Unknown';
export const memberColor = (id) => db.get('members', id)?.color || '#64748b';

/** Both family members always exist on every device (so names show before any sync). */
export async function ensureFamilyMembers() {
  for (const f of FAMILY) {
    if (db.get('members', f.id)) continue;
    const t = '2026-01-01T00:00:00.000Z';
    await db.put('members', { id: f.id, ownerId: f.id, createdAt: t, updatedAt: t, deleted: false, name: f.name, color: f.color, role: 'member', joinedAt: t, archived: false }, { silent: true });
  }
}

export async function ensureSelfMember() {
  const f = familyMember(cfg.memberId);
  const cur = db.get('members', cfg.memberId);
  const role = cfg.mode === 'hub' ? 'hub' : 'member';
  if (!cur) {
    await db.put('members', { ...base(cfg.memberId), id: cfg.memberId, name: f?.name || cfg.memberName, color: f?.color || cfg.memberColor, role, joinedAt: nowISO(), archived: false }, { silent: true });
  } else if (cur.role !== role) {
    await db.put('members', { ...cur, role, updatedAt: nowISO() }, { silent: true });
  }
}

/** Family transfers (VJ <-> MM) recorded as type 'transfer' with toMemberId. direction is from the recorder's side. */
export function memberTransfers() {
  return db.live('transactions').filter((t) => t.type === 'transfer' && t.toMemberId);
}
/** Net money moved from VJ to MM (negative = MM has given VJ more). */
export function netVjToMm() {
  let net = 0;
  for (const t of memberTransfers()) {
    const fromVj = (t.ownerId === FAMILY[0].id) === (t.direction === 'out');
    net += fromVj ? t.amount : -t.amount;
  }
  return net;
}
