import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as goals from '../js/goals.js';
import * as tx from '../js/transactions.js';
import * as db from '../js/db.js';
import { freshDb } from './helpers.js';

test('a goal tracks progress, and what it takes per month to finish by its date', async () => {
  await freshDb();
  const g = await goals.create({ name: 'Trip', target: 12000, saved: 2000, targetDate: '2026-12-20' });
  const p = goals.progress(g, new Date(2026, 5, 10)); // 10 June 2026: 6 months to 20 December
  assert.equal(p.left, 10000);
  assert.equal(Math.round(p.pct), 17);
  assert.equal(p.monthsLeft, 6);
  assert.equal(Math.round(p.perMonth), 1667);
  assert.equal(p.done, false);
  assert.equal(goals.progress(g, new Date(2027, 0, 5)).overdue, true);
});

test('adding money, taking it out (never below zero) and reaching the target', async () => {
  await freshDb();
  const g = await goals.create({ name: 'Fund', target: 1000 });
  await goals.contribute(g.id, 400);
  await goals.contribute(g.id, -900);
  assert.equal(db.get('holdings', g.id).saved, 0);
  await goals.contribute(g.id, 1000);
  assert.equal(goals.progress(db.get('holdings', g.id)).done, true);
});

test('goals are shared holdings, and other holdings never show up as goals', async () => {
  await freshDb();
  await db.put('holdings', { id: 'h1', kind: 'bank', name: 'HDFC', createdAt: 'x', updatedAt: 'x', deleted: false }, { silent: true });
  const g = await goals.create({ name: 'A', target: 5 });
  assert.deepEqual(goals.list().map((x) => x.id), [g.id]);
  await goals.remove(g.id);
  assert.equal(goals.list().length, 0);
});

test('repeat last uses the entry you added most recently, not the newest date', async () => {
  await freshDb();
  const acc = tx.onlineAccount().id;
  await tx.add({ type: 'expense', amount: 10, date: '2026-05-01', accountId: acc, categoryId: 'a', createdAt: '2026-05-01T10:00:00.000Z' });
  await tx.add({ type: 'expense', amount: 20, date: '2026-01-01', accountId: acc, categoryId: 'b', createdAt: '2026-05-02T10:00:00.000Z' }); // back-dated, entered later
  await tx.add({ type: 'transfer', amount: 99, date: '2026-05-03', accountId: acc, createdAt: '2026-05-03T10:00:00.000Z' });
  assert.equal(tx.lastEntry().categoryId, 'b');
});

test('split parts share a splitId and add up through the normal totals', async () => {
  await freshDb();
  const acc = tx.onlineAccount().id;
  const parts = [{ categoryId: 'food', amount: 300 }, { categoryId: 'home', amount: 200 }];
  await db.putMany('transactions', parts.map((p) => tx.make({ type: 'expense', date: '2026-04-01', accountId: acc, splitId: 'S1', ...p })));
  const all = tx.query({});
  assert.equal(all.length, 2);
  assert.ok(all.every((t) => t.splitId === 'S1'));
  assert.equal(tx.accountBalance(db.get('accounts', acc)), -500);
});

// ---- every named import must be something the other file really exports (catches typos and moved code)
const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  return names;
}

test('every named import exists in the file it comes from', () => {
  for (const file of walk(join(root, 'js')).filter((f) => f.endsWith('.js') && !f.includes('vendor'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
      const target = join(file, '..', m[2]);
      const have = exportsOf(target);
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name) assert.ok(have.has(name), `${relative(root, file)} imports { ${name} } but ${m[2]} does not export it`);
      }
    }
  }
});
