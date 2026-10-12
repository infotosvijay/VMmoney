// Totals, breakdowns, chart data, CSV and the family summary.

import * as db from './db.js';
import { cfg } from './db.js';
import { addMonths, thisMonth, nowISO } from './models.js';
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

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(list) {
  const head = ['Date', 'Member', 'Type', 'Category', 'Subcategory', 'Amount', 'Account', 'Payment mode', 'Note', 'Tags'];
  const rows = list.map((t) => [
    t.date, tx.memberName(t.ownerId), t.type,
    t.type === 'transfer' ? '' : cats.name(t.categoryId), t.subcategoryId ? cats.name(t.subcategoryId) : '',
    t.amount, tx.accountName(t.accountId), t.paymentMode, t.note, (t.tags || []).join(' '),
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
