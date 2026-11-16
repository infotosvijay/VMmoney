import test from 'node:test';
import assert from 'node:assert/strict';
import * as tx from '../js/transactions.js';
import * as db from '../js/db.js';
import * as reports from '../js/reports.js';
import { freshDb } from './helpers.js';

const entry = (o) => tx.add({ type: 'expense', amount: 10, date: '2026-03-10', accountId: tx.onlineAccount().id, categoryId: 'c1', ...o });

test('query filters by date range, type and amount', async () => {
  await freshDb();
  await entry({ date: '2026-03-01', amount: 5 });
  await entry({ date: '2026-03-10', amount: 50 });
  await entry({ date: '2026-03-10', amount: 70, type: 'income' });
  await entry({ date: '2026-04-02', amount: 20 });
  assert.equal(tx.query({ from: '2026-03-10', to: '2026-03-10' }).length, 2); // the single-date filter
  assert.equal(tx.query({ from: '2026-03-01', to: '2026-03-31', type: 'expense' }).length, 2);
  assert.equal(tx.query({ min: 40, max: 60 }).length, 1);
});

test('search finds words in notes and category names, and sees renames', async () => {
  await freshDb();
  await db.put('categories', { id: 'c1', name: 'Groceries', type: 'expense' }, { silent: true });
  await entry({ note: 'Weekly vegetables' });
  await entry({ note: 'Taxi' });
  assert.equal(tx.query({ text: 'veg' }).length, 1);
  assert.equal(tx.query({ text: 'grocer' }).length, 2);
  await db.put('categories', { id: 'c1', name: 'Food', type: 'expense' }, { silent: true });
  assert.equal(tx.query({ text: 'grocer' }).length, 0); // the cached text is rebuilt after a change
  assert.equal(tx.query({ text: 'food taxi' }).length, 1);
});

test('same-day entries keep a stable order', () => {
  const a = { id: 'a', date: '2026-01-01', createdAt: 'x' };
  const b = { id: 'b', date: '2026-01-01', createdAt: 'x' };
  assert.equal(tx.newestFirst(a, b), -tx.newestFirst(b, a));
  assert.equal(tx.newestFirst(a, a), 0);
});

test('balance counts opening balance, income, expense and own-account transfers', async () => {
  await freshDb();
  const on = tx.onlineAccount();
  const cash = tx.cashAccount();
  await db.put('accounts', { ...on, openingBalance: 1000 }, { silent: true });
  await entry({ amount: 100 });
  await entry({ amount: 300, type: 'income' });
  await tx.add({ type: 'transfer', amount: 200, date: '2026-03-11', accountId: on.id, toAccountId: cash.id });
  assert.equal(tx.accountBalance(db.get('accounts', on.id)), 1000 - 100 + 300 - 200);
  assert.equal(tx.accountBalance(db.get('accounts', cash.id)), 200);
});

test('a family transfer recorded by one person moves both balances; recorded by both counts once', async () => {
  await freshDb('member-vj');
  const vj = tx.onlineAccount();
  await tx.add({ type: 'transfer', amount: 500, date: '2026-03-12', accountId: vj.id, toMemberId: 'member-mm', direction: 'out' });
  assert.equal(tx.inHand('member-vj').online, -500);
  assert.equal(tx.inHand('member-mm').online, 500);
  // MM also records the same payment (same amount, next day)
  const theirs = { ...tx.make({ type: 'transfer', amount: 500, date: '2026-03-13', accountId: 'acc-member-mm-online', toMemberId: 'member-vj', direction: 'in' }), ownerId: 'member-mm' };
  await db.put('transactions', theirs, { silent: true });
  assert.equal(tx.transferEvents().events.length, 1);
  assert.equal(tx.netVjToMm(), 500);
});

test('totals ignore transfers; CSV cells are safe', () => {
  const t = reports.totals([{ type: 'income', amount: 10 }, { type: 'expense', amount: 4 }, { type: 'transfer', amount: 99 }]);
  assert.deepEqual(t, { income: 10, expense: 4, net: 6 });
  assert.equal(reports.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(reports.csvCell('a,b'), '"a,b"');
  assert.equal(reports.csvCell(-5), '-5');
});

test('updateMany patches several entries in one go', async () => {
  await freshDb();
  const a = await entry({});
  const b = await entry({});
  await tx.updateMany([a.id, b.id], { categoryId: 'c9' });
  assert.equal(db.get('transactions', a.id).categoryId, 'c9');
  assert.equal(db.get('transactions', b.id).categoryId, 'c9');
});
