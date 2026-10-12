// Budget rules and alerts. A budget is a monthly limit for a category (or subcategory),
// for the whole family or for one member.

import * as db from './db.js';
import { cfg } from './db.js';
import { base, thisMonth } from './models.js';
import * as cats from './categories.js';

export const list = () => db.live('budgets');

export async function save({ id, scope, memberId, categoryId, subcategoryId, limit }) {
  const rec = id
    ? { ...db.get('budgets', id), scope, memberId: scope === 'member' ? memberId : null, categoryId, subcategoryId: subcategoryId || null, limit: Number(limit) }
    : { ...base(cfg.memberId), scope, memberId: scope === 'member' ? memberId : null, categoryId, subcategoryId: subcategoryId || null, period: 'monthly', limit: Number(limit) };
  return id ? db.update('budgets', id, rec) : db.put('budgets', rec);
}
export const remove = (id) => db.update('budgets', id, { deleted: true });

/** Spend in a month matching a budget, from the records present on this device. */
export function spent(b, month = thisMonth()) {
  return db.live('transactions')
    .filter((t) => t.type === 'expense' && t.date.startsWith(month))
    .filter((t) => (b.scope === 'member' ? t.ownerId === b.memberId : true))
    .filter((t) => (b.subcategoryId ? t.subcategoryId === b.subcategoryId : t.categoryId === b.categoryId))
    .reduce((s, t) => s + t.amount, 0);
}

/** Status of each budget visible to the current device. */
export function statuses({ month = thisMonth(), memberOnly = false } = {}) {
  const summary = cfg.familySummary?.monthCategory?.[month];
  return list()
    .filter((b) => !memberOnly || b.scope === 'family' || b.memberId === cfg.memberId)
    .map((b) => {
      let used;
      let partial = false;
      if (b.scope === 'family' && cfg.mode !== 'hub' && !cfg.hasFamilyEntries) {
        // A phone only holds its own records; use the family summary when the hub sent one.
        if (summary) used = summary[b.subcategoryId || b.categoryId] || 0;
        else { used = spent({ ...b, scope: 'member', memberId: cfg.memberId }, month); partial = true; }
      } else used = spent(b, month);
      const pct = b.limit > 0 ? (used / b.limit) * 100 : 0;
      return { budget: b, used, pct, partial, level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok', label: budgetLabel(b) };
    })
    .sort((a, b) => b.pct - a.pct);
}

export function budgetLabel(b) {
  const c = b.subcategoryId ? `${cats.name(b.categoryId)} › ${cats.name(b.subcategoryId)}` : cats.name(b.categoryId);
  return c;
}

export const alerts = (opts) => statuses(opts).filter((s) => s.level !== 'ok');
