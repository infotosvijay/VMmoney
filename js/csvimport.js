// Import old entries from a CSV (same columns as this app's CSV export, or a simple bank/Excel sheet).
// Columns recognised by header name: Date, Member, Type, Category, Subcategory, Amount, Account, Payment mode, Note, Tags.

import * as db from './db.js';
import { cfg } from './db.js';
import { FAMILY, localDate } from './models.js';
import * as cats from './categories.js';
import * as tx from './transactions.js';

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');

export function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/); // day first (Indian format)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ,]*(\d{2,4})$/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`;
  return null;
}

const parseAmount = (s) => {
  const n = Number(String(s ?? '').replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : NaN;
};

const HEADS = {
  date: ['date', 'txn date', 'transaction date'], member: ['member', 'person', 'owner'], type: ['type', 'dr/cr'],
  category: ['category'], sub: ['subcategory', 'sub category', 'sub-category'], amount: ['amount', 'amt', 'value'],
  account: ['account', 'bank'], mode: ['payment mode', 'paymentmode', 'mode'], note: ['note', 'notes', 'description', 'narration', 'remarks'], tags: ['tags'],
};

function findCols(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(HEADS)) col[k] = h.findIndex((x) => names.includes(x));
  return col;
}

const typeOf = (s) => {
  s = String(s || '').trim().toLowerCase();
  if (['income', 'credit', 'cr', 'in'].includes(s)) return 'income';
  if (['transfer'].includes(s)) return 'transfer';
  return 'expense';
};

function findCat(name, type, parentId) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return db.live('categories').find((c) => c.type === type && (c.parentId || null) === (parentId || null) && c.name.toLowerCase() === n) || null;
}

/** Dry run: returns what would be imported, skipped and created. Nothing is written. */
export function planImport(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The file has no data rows.');
  const col = findCols(rows[0]);
  if (col.date < 0 || col.amount < 0) throw new Error('Need at least "Date" and "Amount" columns in the first row.');
  const existing = new Set(db.live('transactions').map((t) => keyOf(t.ownerId, t.date, t.type, t.amount, t.note)));
  const plan = { items: [], skipped: [], duplicates: 0, newCategories: new Set(), total: rows.length - 1 };
  const get = (r, k) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const date = parseDate(get(r, 'date'));
    let amount = parseAmount(get(r, 'amount'));
    if (!date) return plan.skipped.push({ line, reason: 'unreadable date' });
    if (!Number.isFinite(amount) || amount === 0) return plan.skipped.push({ line, reason: 'unreadable amount' });
    let type = col.type >= 0 ? typeOf(get(r, 'type')) : amount < 0 ? 'income' : 'expense';
    if (col.type < 0 && amount < 0) amount = -amount; // no Type column: a negative number is money in
    amount = Math.abs(amount);
    let owner = cfg.memberId;
    const who = get(r, 'member').toLowerCase();
    if (who) {
      const f = FAMILY.find((x) => x.name.toLowerCase() === who || x.key === who);
      if (f && f.id !== cfg.memberId) {
        if (cfg.mode !== 'hub') return plan.skipped.push({ line, reason: `belongs to ${f.name}` });
        owner = f.id;
      }
    }
    const note = get(r, 'note');
    if (existing.has(keyOf(owner, date, type, amount, note))) { plan.duplicates++; return; }
    const catName = get(r, 'category'), subName = get(r, 'sub');
    const item = { owner, date, type, amount, note, catName, subName, accountName: get(r, 'account'), mode: get(r, 'mode').toLowerCase(), tags: get(r, 'tags') };
    if (type !== 'transfer' && catName && !findCat(catName, type, null)) plan.newCategories.add(`${type}: ${catName}`);
    plan.items.push(item);
  });
  return plan;
}

const keyOf = (owner, date, type, amount, note) => `${owner}|${date}|${type}|${Number(amount).toFixed(2)}|${String(note || '').trim().toLowerCase()}`;

export async function applyImport(plan) {
  const accounts = tx.myAccounts();
  const fallback = accounts[0]?.id || null;
  const made = new Map();
  let n = 0;
  for (const it of plan.items) {
    let categoryId = null, subcategoryId = null;
    if (it.type !== 'transfer') {
      const ck = `${it.type}|${it.catName.toLowerCase()}`;
      let c = it.catName ? (made.get(ck) || findCat(it.catName, it.type, null)) : null;
      if (it.catName && !c) { c = await cats.create({ name: it.catName, type: it.type }); made.set(ck, c); }
      if (!c) c = cats.get(it.type === 'income' ? 'cat-income-other-income' : 'cat-expense-other');
      categoryId = c?.id || null;
      if (c && it.subName) {
        const sk = `${ck}|${it.subName.toLowerCase()}`;
        let s = made.get(sk) || findCat(it.subName, it.type, c.id);
        if (!s) { s = await cats.create({ name: it.subName, type: it.type, parentId: c.id }); made.set(sk, s); }
        subcategoryId = s.id;
      }
    }
    const acc = accounts.find((a) => a.name.toLowerCase() === it.accountName.toLowerCase());
    await tx.add({
      ownerId: it.owner, type: it.type, amount: it.amount, date: it.date, note: it.note,
      categoryId, subcategoryId, accountId: acc?.id || fallback,
      paymentMode: ['cash', 'upi', 'card', 'netbanking'].includes(it.mode) ? it.mode : 'cash',
      tags: it.tags.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`)),
    }, { silent: true });
    n++;
  }
  await db.setCfg('lastCsvImportAt', localDate());
  return n;
}
