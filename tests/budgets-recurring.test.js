import test from 'node:test';
import assert from 'node:assert/strict';
import * as budgets from '../js/budgets.js';
import * as recurring from '../js/recurring.js';
import * as tx from '../js/transactions.js';
import * as db from '../js/db.js';
import { thisMonth, localDate } from '../js/models.js';
import { freshDb } from './helpers.js';

const spend = (amount) => tx.add({ type: 'expense', amount, date: `${thisMonth()}-01`, accountId: tx.onlineAccount().id, categoryId: 'food' });

async function withBudget(limit) {
  await freshDb();
  await db.put('categories', { id: 'food', name: 'Food', type: 'expense', icon: '' }, { silent: true });
  await budgets.save({ scope: 'member', memberId: 'member-vj', categoryId: 'food', limit });
}

test('an entry that takes a budget past 80% or 100% gives one message each time', async () => {
  await withBudget(1000);
  const before1 = budgets.snapshot();
  await spend(500);
  assert.deepEqual(budgets.crossings(before1), []); // 50%: nothing to say
  const before2 = budgets.snapshot();
  await spend(350); // 85%
  assert.deepEqual(budgets.crossings(before2), ['Food: 85% of budget used']);
  const before3 = budgets.snapshot();
  await spend(10); // 86%: already warned, so quiet
  assert.deepEqual(budgets.crossings(before3), []);
  const before4 = budgets.snapshot();
  await spend(200); // 106%
  assert.match(budgets.crossings(before4)[0], /^Food: over budget by .*60/);
});

test('pace: what is left and what that allows per day', async () => {
  await withBudget(3100);
  await spend(1000);
  const st = budgets.statuses()[0];
  const p = budgets.pace(st, new Date(2026, 0, 16)); // 31-day month, 16 days left including today
  assert.equal(p.left, 2100);
  assert.equal(p.daysLeft, 16);
  assert.equal(Math.round(p.perDay), 131);
  await spend(3000);
  assert.equal(budgets.pace(budgets.statuses()[0], new Date(2026, 0, 16)).perDay, 0);
});

const iso = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return localDate(d); };
const makeRec = async (extra = {}) => {
  await freshDb();
  const rec = await recurring.create({ type: 'expense', amount: 100, date: iso(5), categoryId: 'c', accountId: tx.onlineAccount().id, note: 'x' }, 'daily', iso(5));
  if (Object.keys(extra).length) await db.update('recurring', rec.id, extra);
  return rec.id;
};

test('a recurring entry stops at its end date and switches itself off', async () => {
  const id = await makeRec({ endDate: iso(3) });
  assert.equal(await recurring.runDue(), 3); // 5, 4, 3 days ago
  const r = db.get('recurring', id);
  assert.equal(r.active, false);
  assert.equal(recurring.hasEnded(r), true);
  assert.equal(await recurring.runDue(), 0);
});

test('skip next moves the schedule on without creating an entry', async () => {
  const id = await makeRec();
  await recurring.skipNext(id);
  assert.equal(db.get('recurring', id).nextDate, iso(4));
  assert.equal(await recurring.runDue(), 5); // 4 days ago .. today, the skipped day is not created
  assert.equal(db.live('transactions').some((t) => t.date === iso(5)), false);
});

test('editing changes future entries only, and the day of month follows the new next date', async () => {
  const id = await makeRec();
  await recurring.edit(id, { amount: 250, note: 'new', frequency: 'monthly', nextDate: '2030-03-31', endDate: '2030-12-31' });
  const r = db.get('recurring', id);
  assert.equal(r.template.amount, 250);
  assert.equal(r.template.note, 'new');
  assert.equal(r.anchorDay, 31);
  assert.equal(r.endDate, '2030-12-31');
  assert.equal(r.active, true);
  await recurring.edit(id, { endDate: '' });
  assert.equal(db.get('recurring', id).endDate, null);
});

test('moving the end date later brings an ended entry back', async () => {
  const id = await makeRec({ endDate: iso(3) });
  await recurring.runDue();
  assert.equal(db.get('recurring', id).active, false);
  await recurring.edit(id, { endDate: '2099-01-01' });
  assert.equal(db.get('recurring', id).active, true);
});
