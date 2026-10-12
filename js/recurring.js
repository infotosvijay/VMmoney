// Recurring entries (rent, EMI, SIP...). Due items are materialised as normal transactions at startup.

import * as db from './db.js';
import { cfg } from './db.js';
import { base, todayStr, localDate } from './models.js';
import * as tx from './transactions.js';

export function nextDate(dateStr, freq) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (freq === 'daily') dt.setDate(dt.getDate() + 1);
  else if (freq === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (freq === 'yearly') dt.setFullYear(dt.getFullYear() + 1);
  else {
    // monthly: keep the day-of-month, clamped to month length
    const target = new Date(y, m, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d, last));
    return localDate(target);
  }
  return localDate(dt);
}

export const list = () => db.live('recurring').filter((r) => r.ownerId === cfg.memberId);

export async function create(template, frequency, firstDate) {
  const rec = { ...base(cfg.memberId), template, frequency, nextDate: firstDate, active: true };
  await db.put('recurring', rec);
  return rec;
}
export const setActive = (id, active) => db.update('recurring', id, { active });
export const remove = (id) => db.update('recurring', id, { deleted: true });

/** Create transactions for every due occurrence. Returns how many were created. */
export async function runDue() {
  const today = todayStr();
  let created = 0;
  for (const r of list().filter((r) => r.active)) {
    let next = r.nextDate;
    let guard = 0;
    while (next <= today && guard++ < 120) {
      await tx.add({ ...r.template, date: next, recurringId: r.id });
      created++;
      next = nextDate(next, r.frequency);
    }
    if (next !== r.nextDate) await db.update('recurring', r.id, { nextDate: next });
  }
  return created;
}
