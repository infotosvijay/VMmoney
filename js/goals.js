// Savings goals. Kept in the shared `holdings` store (kind 'goal') so both phones and the laptop see the same goals
// and they travel with every backup and sync without any new plumbing. Last edit wins, like other shared items.

import * as db from './db.js';
import { cfg } from './db.js';
import { base, localDate } from './models.js';

export const list = () => db.live('holdings').filter((h) => h.kind === 'goal').sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export const create = ({ name, target, saved = 0, targetDate = '' }) =>
  db.put('holdings', { ...base(cfg.memberId), kind: 'goal', name: name.trim(), target: Number(target), saved: Number(saved) || 0, targetDate: targetDate || '' });

export const update = (id, patch) => db.update('holdings', id, patch);
export const remove = (id) => db.update('holdings', id, { deleted: true });

/** Add (or, with a negative number, take out) money. Never goes below zero. */
export function contribute(id, delta) {
  const g = db.get('holdings', id);
  return db.update('holdings', id, { saved: Math.max(0, Math.round(((Number(g.saved) || 0) + Number(delta)) * 100) / 100) });
}

/** How far along a goal is, and what it takes to finish by its date. */
export function progress(g, now = new Date()) {
  const saved = Number(g.saved) || 0;
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
  return { saved, left, done, pct, monthsLeft, perMonth, overdue };
}
