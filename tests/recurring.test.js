import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDate } from '../js/recurring.js';
import * as recurring from '../js/recurring.js';
import * as db from '../js/db.js';
import * as tx from '../js/transactions.js';
import { localDate } from '../js/models.js';
import { freshDb } from './helpers.js';

test('monthly entry on the 31st does not drift to the 28th', () => {
  let d = '2026-01-31';
  const seen = [];
  for (let i = 0; i < 4; i++) { d = nextDate(d, 'monthly', 31); seen.push(d); }
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('monthly without an anchor keeps working', () => {
  assert.equal(nextDate('2026-01-15', 'monthly'), '2026-02-15');
  assert.equal(nextDate('2026-12-15', 'monthly'), '2027-01-15');
});

test('yearly handles 29 February', () => {
  assert.equal(nextDate('2028-02-29', 'yearly', 29), '2029-02-28');
  assert.equal(nextDate('2029-02-28', 'yearly', 29), '2030-02-28');
  assert.equal(nextDate('2031-03-05', 'yearly'), '2032-03-05');
});

test('daily and weekly', () => {
  assert.equal(nextDate('2026-02-28', 'daily'), '2026-03-01');
  assert.equal(nextDate('2026-12-28', 'weekly'), '2027-01-04');
});

test('runDue creates each occurrence once, even when run twice', async () => {
  await freshDb();
  const start = new Date();
  start.setDate(start.getDate() - 3);
  const first = localDate(start);
  const acc = tx.onlineAccount();
  await recurring.create({ type: 'expense', amount: 100, date: first, categoryId: 'c', accountId: acc.id, note: 'x' }, 'daily', first);
  const n1 = await recurring.runDue();
  assert.equal(n1, 4); // 3 days ago .. today
  const after = db.live('transactions').length;
  // simulate a crash that lost the nextDate update: put it back and run again
  const r = recurring.list()[0];
  await db.update('recurring', r.id, { nextDate: first });
  const n2 = await recurring.runDue();
  assert.equal(n2, 0);
  assert.equal(db.live('transactions').length, after);
});
