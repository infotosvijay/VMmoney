import test from 'node:test';
import assert from 'node:assert/strict';
import { presetRange, activePreset, dateRange, hasDateRange, filterChips, withSaved, withoutSaved, BLANK } from '../js/filters.js';

const wed = new Date(2026, 10, 18); // Wednesday 18 Nov 2026

test('presets', () => {
  assert.deepEqual(presetRange('today', wed), { df: '2026-11-18', dt: '2026-11-18' });
  assert.deepEqual(presetRange('yesterday', wed), { df: '2026-11-17', dt: '2026-11-17' });
  assert.deepEqual(presetRange('week', wed), { df: '2026-11-16', dt: '2026-11-18' }); // Monday to today
  assert.deepEqual(presetRange('last30', wed), { df: '2026-10-20', dt: '2026-11-18' });
  assert.deepEqual(presetRange('week', new Date(2026, 10, 15)), { df: '2026-11-09', dt: '2026-11-15' }); // a Sunday
});

test('the active preset is highlighted only when it matches', () => {
  assert.equal(activePreset({ df: '2026-11-18', dt: '2026-11-18' }, wed), 'today');
  assert.equal(activePreset({ df: '2026-11-01', dt: '2026-11-02' }, wed), '');
  assert.equal(activePreset({ df: '', dt: '' }, wed), '');
});

test('a date range wins over the month; one end is enough; wrong order is fixed', () => {
  assert.deepEqual(dateRange({ m: '2026-03' }), { from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(dateRange({ m: '2026' }), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(dateRange({ m: 'all' }), {});
  assert.deepEqual(dateRange({ m: '2026-03', df: '2026-02-10', dt: '2026-02-12' }), { from: '2026-02-10', to: '2026-02-12' });
  assert.deepEqual(dateRange({ m: 'all', df: '2026-02-10', dt: '' }), { from: '2026-02-10', to: '' });
  assert.deepEqual(dateRange({ m: 'all', df: '', dt: '2026-02-10' }), { from: '', to: '2026-02-10' });
  assert.deepEqual(dateRange({ m: 'all', df: '2026-02-12', dt: '2026-02-10' }), { from: '2026-02-10', to: '2026-02-12' });
  assert.equal(hasDateRange({ df: 'nonsense', dt: '' }), false);
});

const names = { cat: (id) => `cat ${id}`, account: (id) => `acc ${id}`, member: (id) => `mem ${id}` };

test('one chip per active filter, and removing it clears the right keys', () => {
  assert.deepEqual(filterChips({ ...BLANK, m: '2026-03' }, names), []);
  const chips = filterChips({ ...BLANK, t: 'expense', c: 'c:food', a: 'a1', min: '100', max: '500', df: '2026-03-01', dt: '2026-03-01' }, names);
  assert.deepEqual(chips.map((c) => c.keys), [['t'], ['c'], ['a'], ['min', 'max'], ['df', 'dt']]);
  assert.equal(chips[0].label, 'Type: Expense');
  assert.equal(chips[1].label, 'Category: cat food');
  assert.match(chips[3].label, /100 – 500/);
  assert.match(chips[4].label, /^Date: 1 Mar 2026$/);
  assert.match(filterChips({ ...BLANK, df: '2026-03-01', dt: '2026-03-05' }, names)[0].label, /1 Mar 2026 – 5 Mar 2026/);
  assert.equal(filterChips({ ...BLANK, min: '50' }, names)[0].label, 'Amount: at least 50');
});

test('saved filters replace by name and can be deleted', () => {
  let list = withSaved([], 'Food this week', { ...BLANK, c: 'c:food', df: '2026-11-16', dt: '2026-11-18', m: '2026-11', w: 'all' });
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0].f).sort(), ['a', 'c', 'df', 'dt', 'max', 'min', 'q', 't', 'u']); // month and tab are not saved
  list = withSaved(list, '  food this WEEK ', { ...BLANK, t: 'income' });
  assert.equal(list.length, 1);
  assert.equal(list[0].f.t, 'income');
  list = withSaved(list, 'Big spends', { ...BLANK, min: '5000' });
  assert.deepEqual(list.map((s) => s.name), ['Big spends', 'food this WEEK']);
  assert.equal(withoutSaved(list, list[0].id).length, 1);
});
