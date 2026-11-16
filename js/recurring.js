// Recurring entries (rent, EMI, SIP...). Due items are materialised as normal transactions at startup.

import * as db from './db.js';
import { cfg } from './db.js';
import { base, todayStr, localDate } from './models.js';
import * as tx from './transactions.js';

/**
 * The occurrence after `dateStr`. For monthly and yearly, `anchorDay` is the day of the month the entry was set up
 * for, so a 31st stays on the 31st (clamped to 30 or 28 in short months) instead of drifting to the 28th for good.
 */
export function nextDate(dateStr, freq, anchorDay) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (freq === 'daily' || freq === 'weekly') {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + (freq === 'daily' ? 1 : 7));
    return localDate(dt);
  }
  const want = anchorDay || d;
  const target = new Date(y + (freq === 'yearly' ? 1 : 0), m - 1 + (freq === 'yearly' ? 0 : 1), 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(want, last));
  return localDate(target);
}

export const list = () => db.live('recurring').filter((r) => r.ownerId === cfg.memberId);

export async function create(template, frequency, firstDate) {
  const anchorDay = Number((template.date || firstDate).slice(8, 10)) || undefined;
  const rec = { ...base(cfg.memberId), template, frequency, nextDate: firstDate, anchorDay, active: true };
  await db.put('recurring', rec);
  return rec;
}
export const setActive = (id, active) => db.update('recurring', id, { active });

/** True when the entry has run past its end date (nothing more will be created). */
export const hasEnded = (r) => !!r.endDate && r.nextDate > r.endDate;

const anchorOf = (r) => r.anchorDay || Number(r.template?.date?.slice(8, 10)) || undefined;

/** Skip the next occurrence: no entry is created for it, and the schedule moves on. */
export async function skipNext(id) {
  const r = db.get('recurring', id);
  const next = nextDate(r.nextDate, r.frequency, anchorOf(r));
  return db.update('recurring', id, { nextDate: next, ...(r.endDate && next > r.endDate ? { active: false } : {}) });
}

/**
 * Change a recurring entry. patch may hold: amount, note, categoryId, subcategoryId, frequency, nextDate, endDate ('' = none).
 * Entries already created are not touched. The day of the month follows the new next date.
 */
export async function edit(id, patch) {
  const r = db.get('recurring', id);
  const template = { ...r.template };
  for (const k of ['amount', 'note', 'categoryId', 'subcategoryId']) if (k in patch) template[k] = patch[k];
  const frequency = patch.frequency || r.frequency;
  const next = patch.nextDate || r.nextDate;
  const endDate = 'endDate' in patch ? patch.endDate || null : r.endDate || null;
  return db.update('recurring', id, { template, frequency, nextDate: next, endDate, anchorDay: Number(next.slice(8, 10)) || undefined, active: endDate && next > endDate ? false : hasEnded(r) ? true : r.active });
}
export const remove = (id) => db.update('recurring', id, { deleted: true });

/**
 * Create transactions for every due occurrence. Returns how many were created.
 * Each occurrence has a fixed id (recurring id + date), so if the app is closed half-way and this runs again,
 * the same entry is never added twice. All of one item's entries go in one write.
 */
export async function runDue() {
  const today = todayStr();
  let created = 0;
  for (const r of list().filter((r) => r.active)) {
    const anchor = anchorOf(r);
    const end = r.endDate || '';
    const fresh = [];
    let next = r.nextDate;
    let guard = 0;
    while (next <= today && (!end || next <= end) && guard++ < 120) {
      const id = `rec-${r.id}-${next}`;
      if (!db.get('transactions', id)) fresh.push(tx.make({ ...r.template, id, date: next, recurringId: r.id }));
      next = nextDate(next, r.frequency, anchor);
    }
    await db.putMany('transactions', fresh);
    created += fresh.length;
    if (next !== r.nextDate) await db.update('recurring', r.id, { nextDate: next, ...(end && next > end ? { active: false } : {}) }); // past its end date: stop
  }
  return created;
}
