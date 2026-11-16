import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch, amountOk } from '../js/search.js';
import * as reports from '../js/reports.js';
import * as tx from '../js/transactions.js';
import * as db from '../js/db.js';
import { freshDb } from './helpers.js';

test('parseSearch understands amounts and fields, and keeps plain words', () => {
  const p = parseSearch('milk >500 cat:food type:"expense" cat:"eating out" <=2,000');
  assert.deepEqual(p.words, ['milk']);
  assert.deepEqual(p.cat, ['food', 'eating out']);
  assert.deepEqual(p.type, ['expense']);
  assert.deepEqual(p.min, { value: 500, strict: true });
  assert.deepEqual(p.max, { value: 2000, strict: false });
});

test('a time like 10:30 and an unknown field stay plain words', () => {
  assert.deepEqual(parseSearch('10:30 foo:bar').words, ['10:30', 'foo:bar']);
});

test('= means exactly that amount; the tighter limit wins', () => {
  const eq = parseSearch('=250');
  assert.equal(amountOk(250, eq), true);
  assert.equal(amountOk(251, eq), false);
  const both = parseSearch('>100 >300 <900 <800');
  assert.deepEqual([both.min.value, both.max.value], [300, 800]);
});

test('> excludes the amount, >= includes it', () => {
  assert.equal(amountOk(500, parseSearch('>500')), false);
  assert.equal(amountOk(500, parseSearch('>=500')), true);
  assert.equal(amountOk(100, parseSearch('<100')), false);
  assert.equal(amountOk(100, parseSearch('<=100')), true);
});

async function seed() {
  await freshDb();
  await db.put('categories', { id: 'food', name: 'Food', type: 'expense' }, { silent: true });
  await db.put('categories', { id: 'fuel', name: 'Fuel', type: 'expense' }, { silent: true });
  const online = tx.onlineAccount().id;
  const cash = tx.cashAccount().id;
  await tx.add({ type: 'expense', amount: 800, date: '2026-03-01', categoryId: 'food', accountId: online, note: 'Dinner out' });
  await tx.add({ type: 'expense', amount: 200, date: '2026-03-02', categoryId: 'food', accountId: cash, note: 'Snacks' });
  await tx.add({ type: 'expense', amount: 1500, date: '2026-03-03', categoryId: 'fuel', accountId: online, note: 'Petrol' });
  await tx.add({ type: 'income', amount: 9000, date: '2026-03-04', categoryId: 'food', accountId: online, note: 'Refund' });
}
const notes = (text) => tx.query({ text }).map((t) => t.note).sort();

test('search operators work in the transaction list', async () => {
  await seed();
  assert.deepEqual(notes('>500'), ['Dinner out', 'Petrol', 'Refund']);
  assert.deepEqual(notes('cat:food <1000'), ['Dinner out', 'Snacks']);
  assert.deepEqual(notes('cat:food type:expense'), ['Dinner out', 'Snacks']);
  assert.deepEqual(notes('acc:cash'), ['Snacks']);
  assert.deepEqual(notes('note:petrol'), ['Petrol']);
  assert.deepEqual(notes('member:vj type:inc'), ['Refund']);
  assert.deepEqual(notes('dinner >500'), ['Dinner out']);
  assert.deepEqual(notes('dinner >1000'), []);
});

test('change: percent, with nothing to compare giving null', () => {
  assert.equal(reports.change(150, 100), 50);
  assert.equal(reports.change(50, 100), -50);
  assert.equal(reports.change(5, 0), null);
});

test('top notes add the same note together whatever its capitalisation', () => {
  const list = [
    { type: 'expense', amount: 100, note: 'Rent' }, { type: 'expense', amount: 50, note: ' rent ' },
    { type: 'expense', amount: 120, note: 'Milk' }, { type: 'expense', amount: 999, note: '' },
    { type: 'income', amount: 5000, note: 'Salary' },
  ];
  assert.deepEqual(reports.topNotes(list, 'expense'), [{ note: 'Rent', total: 150, count: 2 }, { note: 'Milk', total: 120, count: 1 }]);
  assert.equal(reports.topNotes(list, 'income')[0].note, 'Salary');
  assert.equal(reports.topNotes(list, 'expense', 1).length, 1);
});

test('the statement is oldest first', () => {
  const rows = reports.statementRows([{ date: '2026-02-02', createdAt: 'b' }, { date: '2026-02-01', createdAt: 'z' }, { date: '2026-02-02', createdAt: 'a' }]);
  assert.deepEqual(rows.map((r) => r.createdAt), ['z', 'a', 'b']);
});

test('periodState: running, past and future periods, with the cut-off for a running one', () => {
  assert.deepEqual(reports.periodState('2026-11', '2026-11-16'), { state: 'running', cut: '16' });
  assert.deepEqual(reports.periodState('2026', '2026-11-16'), { state: 'running', cut: '11-16' });
  assert.equal(reports.periodState('2026-10', '2026-11-16').state, 'past');
  assert.equal(reports.periodState('2025', '2026-11-16').state, 'past');
  assert.equal(reports.periodState('2026-12', '2026-11-16').state, 'future');
});

test('periodRange: a full period, or cut to the same day as the running one (short months clamp)', () => {
  assert.deepEqual(reports.periodRange('2026-10'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(reports.periodRange('2025'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(reports.periodRange('2026-10', '16'), { from: '2026-10-01', to: '2026-10-16' });
  assert.deepEqual(reports.periodRange('2026-02', '30'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(reports.periodRange('2024-02', '31'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(reports.periodRange('2025', '11-16'), { from: '2025-01-01', to: '2025-11-16' });
  assert.deepEqual(reports.periodRange('2023', '02-29'), { from: '2023-01-01', to: '2023-02-28' });
});

test('average: per day for a month, per month for a year, counting only the time so far / since the first entry', () => {
  assert.deepEqual(reports.average(1600, '2026-11', '2026-11-16'), { per: 'day', value: 100 });
  assert.deepEqual(reports.average(3100, '2026-10', '2026-11-16'), { per: 'day', value: 100 });
  assert.deepEqual(reports.average(11000, '2026', '2026-11-16'), { per: 'month', value: 1000 });
  assert.deepEqual(reports.average(12000, '2025', '2026-11-16'), { per: 'month', value: 1000 });
  // data starts in October 2025: three months, not twelve
  assert.deepEqual(reports.average(3000, '2025', '2026-11-16', '2025-10-05'), { per: 'month', value: 1000 });
  assert.deepEqual(reports.average(0, '2026-11', '2026-11-16'), { per: 'day', value: 0 });
});

test('a running month compared up to the same day gives a fair change', async () => {
  await freshDb();
  const online = tx.onlineAccount().id;
  await tx.add({ type: 'expense', amount: 500, date: '2026-10-05', accountId: online });
  await tx.add({ type: 'expense', amount: 4500, date: '2026-10-28', accountId: online });
  await tx.add({ type: 'expense', amount: 600, date: '2026-11-10', accountId: online });
  const { cut } = reports.periodState('2026-11', '2026-11-16');
  const spent = (key, c) => reports.totals(tx.query(reports.periodRange(key, c))).expense;
  assert.equal(reports.change(spent('2026-11', cut), spent('2026-10')), -88); // the misleading full-month figure
  assert.equal(reports.change(spent('2026-11', cut), spent('2026-10', cut)), 20); // Nov 1–16 vs Oct 1–16
});
