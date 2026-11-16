// Savings goals. Kept in the shared `holdings` store (kind 'goal') so both phones and the laptop see the same goals
// and they travel with every backup and sync without any new plumbing. Last edit wins, like other shared items.
//
// How much a goal has saved = `saved` (money typed in by hand: "already saved" + Add money − Take out)
//   + the entries of its linked category / subcategory dated on or after `startDate` (optional link).
// So a goal linked to "Future › Aadhi PPF" fills up by itself every time a PPF payment is entered.

import * as db from './db.js';
import { cfg } from './db.js';
import { base, localDate, todayStr } from './models.js';

export const list = () => db.live('holdings').filter((h) => h.kind === 'goal').sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const link = ({ categoryId = '', subcategoryId = '', startDate = '' } = {}) =>
  categoryId ? { categoryId, subcategoryId: subcategoryId || '', startDate: startDate || todayStr() } : { categoryId: '', subcategoryId: '', startDate: '' };

export const create = ({ name, target, saved = 0, targetDate = '', ...rest }) =>
  db.put('holdings', { ...base(cfg.memberId), kind: 'goal', name: name.trim(), target: Number(target), saved: Number(saved) || 0, targetDate: targetDate || '', ...link(rest) });

export const update = (id, patch) => db.update('holdings', id, 'categoryId' in patch ? { ...patch, ...link(patch) } : patch);
export const remove = (id) => db.update('holdings', id, { deleted: true });
export const restore = (id) => db.update('holdings', id, { deleted: false });

/** The entries that count towards a linked goal (anyone's, as far as this device has them). Newest first. */
export function linkedEntries(g) {
  if (!g.categoryId) return [];
  return db.live('transactions').filter((t) => t.type !== 'transfer' && t.categoryId === g.categoryId
    && (!g.subcategoryId || t.subcategoryId === g.subcategoryId) && (!g.startDate || t.date >= g.startDate))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
export const linkedTotal = (g) => Math.round(linkedEntries(g).reduce((s, t) => s + t.amount, 0) * 100) / 100;

/** Add (or, with a negative number, take out) money by hand. The goal's total never goes below zero. */
export function contribute(id, delta) {
  const g = db.get('holdings', id);
  const floor = -linkedTotal(g);
  return db.update('holdings', id, { saved: Math.max(floor, Math.round(((Number(g.saved) || 0) + Number(delta)) * 100) / 100) + 0 }); // + 0 turns -0 into 0
}

/** How far along a goal is, and what it takes to finish by its date. */
export function progress(g, now = new Date()) {
  const fromEntries = linkedTotal(g);
  const saved = Math.max(0, (Number(g.saved) || 0) + fromEntries);
  const left = Math.max(0, g.target - saved);
  const done = left === 0;
  const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0;
  let monthsLeft = null;
  let perMonth = null;
  let overdue = false;
  if (g.targetDate && !done) {
    const [y, m, d] = g.targetDate.split('-').map(Number);
    overdue = g.targetDate < localDate(now);
    if (!overdue) {
      monthsLeft = Math.max(1, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) - (d < now.getDate() ? 1 : 0));
      perMonth = left / monthsLeft;
    }
  }
  return { saved, fromEntries, byHand: saved - fromEntries, left, done, pct, monthsLeft, perMonth, overdue };
}
