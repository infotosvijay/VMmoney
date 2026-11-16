// Totals, breakdowns, chart data, CSV and the family summary.

import * as db from './db.js';
import { cfg } from './db.js';
import { addMonths, thisMonth, nowISO, monthRange } from './models.js';
import * as cats from './categories.js';
import * as tx from './transactions.js';

export function totals(list) {
  let income = 0, expense = 0;
  for (const t of list) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

/** Category -> subcategory breakdown for one type. Sorted by total, biggest first. */
export function byCategory(list, type = 'expense') {
  const map = new Map();
  for (const t of list) {
    if (t.type !== type) continue;
    const cid = t.categoryId || 'none';
    let e = map.get(cid);
    if (!e) map.set(cid, (e = { id: cid, name: cid === 'none' ? 'Uncategorized' : cats.name(cid), color: cats.get(cid)?.color || '#94a3b8', icon: cats.get(cid)?.icon || '', total: 0, count: 0, subs: new Map() }));
    e.total += t.amount; e.count++;
    const sid = t.subcategoryId || 'none';
    let s = e.subs.get(sid);
    if (!s) e.subs.set(sid, (s = { id: sid, name: sid === 'none' ? '(no subcategory)' : cats.name(sid), total: 0, count: 0 }));
    s.total += t.amount; s.count++;
  }
  return [...map.values()]
    .map((e) => ({ ...e, subs: [...e.subs.values()].sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);
}

/** Last n months (oldest first) of income/expense. */
export function monthlyTrend(list, n = 6, endMonth = thisMonth()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(endMonth, -i);
    out.push({ month: m, ...totals(list.filter((t) => t.date.startsWith(m))) });
  }
  return out;
}

export function byMember(list) {
  const map = new Map();
  for (const t of list) {
    if (t.type === 'transfer') continue;
    let e = map.get(t.ownerId);
    if (!e) map.set(t.ownerId, (e = { id: t.ownerId, name: tx.memberName(t.ownerId), color: tx.memberColor(t.ownerId), income: 0, expense: 0 }));
    e[t.type] += t.amount;
  }
  return [...map.values()].sort((a, b) => b.expense - a.expense);
}

/** A 'YYYY-MM-DD' date moved back to the last day of its month when that month is shorter (Feb 30 -> Feb 28/29). */
const clampDay = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return d > last ? `${date.slice(0, 8)}${String(last).padStart(2, '0')}` : date;
};

/**
 * The dates of a period: 'YYYY' (a year) or 'YYYY-MM' (a month).
 * With `cut` it stops at the same point a running period has reached, so a half-gone month is compared with the same
 * days of another month: `cut` is the day ('16') for a month, or the month and day ('11-16') for a year.
 */
export function periodRange(key, cut = null) {
  if (key.length === 4) return { from: `${key}-01-01`, to: cut ? clampDay(`${key}-${cut}`) : `${key}-12-31` };
  const r = monthRange(key);
  return cut ? { from: r.from, to: clampDay(`${key}-${cut}`) } : r;
}

/**
 * Where a period stands on `today`: running (today falls inside it), future (it has not started) or past.
 * `cut` is what periodRange needs to compare other periods with the running one up to the same point.
 */
export function periodState(key, today) {
  const now = key.length === 4 ? today.slice(0, 4) : today.slice(0, 7);
  if (key > now) return { state: 'future', cut: null };
  if (key < now) return { state: 'past', cut: null };
  return { state: 'running', cut: key.length === 4 ? today.slice(5) : today.slice(8) };
}

/**
 * The average per month (year view) or per day (month view) of `total`.
 * A running period only counts the months / days so far; a year that started part-way through (the first entry came
 * later than January) only counts from that month.
 */
export function average(total, key, today, firstDate = null) {
  const { state } = periodState(key, today);
  if (key.length === 4) {
    const last = state === 'running' ? Number(today.slice(5, 7)) : 12;
    const first = firstDate && firstDate.slice(0, 4) === key ? Number(firstDate.slice(5, 7)) : 1;
    return { per: 'month', value: total / Math.max(1, last - first + 1) };
  }
  const [y, m] = key.split('-').map(Number);
  const days = state === 'running' ? Number(today.slice(8)) : new Date(y, m, 0).getDate();
  return { per: 'day', value: total / Math.max(1, days) };
}

/** Percent change from `before` to `now`, or null when there is nothing to compare with. */
export const change = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);

/** The most spent-on (or earned-from) notes. The same words in any capitalisation count together. */
export function topNotes(list, type = 'expense', n = 5) {
  const map = new Map();
  for (const t of list) {
    const text = (t.note || '').trim();
    if (t.type !== type || !text) continue;
    const key = text.toLowerCase();
    const e = map.get(key) || { note: text, total: 0, count: 0 };
    e.total += t.amount; e.count++;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, n);
}

/** Entries oldest first, for the printed statement. */
export const statementRows = (list) => [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

/** Text starting with = + - @ would run as a formula when the CSV is opened in Excel, so it is made plain text. */
export const csvCell = (v) => {
  let s = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(list) {
  const head = ['Date', 'Member', 'Type', 'Category', 'Subcategory', 'Amount', 'Account', 'To account', 'Note', 'Tags'];
  const rows = list.map((t) => [
    t.date, tx.memberName(t.ownerId), t.type,
    t.type === 'transfer' ? '' : cats.name(t.categoryId), t.subcategoryId ? cats.name(t.subcategoryId) : '',
    t.amount, tx.accountName(t.accountId), t.type === 'transfer' && !t.toMemberId ? tx.accountName(t.toAccountId) : '', t.note, (t.tags || []).join(' '),
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads UTF-8
}

/** Compact family summary shipped to phones (last 6 months). */
export function buildFamilySummary() {
  const live = db.live('transactions').filter((t) => t.type !== 'transfer');
  const months = {};
  const monthCategory = {};
  for (let i = 0; i < 6; i++) {
    const m = addMonths(thisMonth(), -i);
    const list = live.filter((t) => t.date.startsWith(m));
    const members = byMember(list).map((e) => ({ id: e.id, name: e.name, income: e.income, expense: e.expense }));
    months[m] = { ...totals(list), members };
    const mc = {};
    for (const t of list) {
      if (t.type !== 'expense') continue;
      if (t.categoryId) mc[t.categoryId] = (mc[t.categoryId] || 0) + t.amount;
      if (t.subcategoryId) mc[t.subcategoryId] = (mc[t.subcategoryId] || 0) + t.amount;
    }
    monthCategory[m] = mc;
  }
  const cur = live.filter((t) => t.date.startsWith(thisMonth()));
  const topCategories = byCategory(cur).slice(0, 8).map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, total: c.total }));
  return { generatedAt: nowISO(), currency: cfg.currency || 'INR', months, monthCategory, topCategories };
}
