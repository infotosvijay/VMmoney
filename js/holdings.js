// "Balances": where the money is right now (banks, cash) and what is owed on credit cards.
// Ported from Expense.html. Every item says WHOSE it is (person) and, for cards, WHO PAYS (ccPayer).
//
// Holdings are shared family documents: either member may edit any item (last edit wins on sync).

import * as db from './db.js';
import { cfg } from './db.js';
import { base, FAMILY, nowISO, localDate } from './models.js';

export const MAX_ROWS = 16;
export const minBalance = () => (Number(cfg.minBalance) >= 0 && cfg.minBalance != null ? Number(cfg.minBalance) : 2000);
const META_ID = 'meta-family';

export const live = () => db.live('holdings');
const byOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt);
export const banks = (person) => live().filter((h) => h.kind === 'bank' && (!person || h.person === person)).sort(byOrder);
export const cashEntries = (person) => live().filter((h) => h.kind === 'cash' && (!person || h.person === person)).sort(byOrder);

/** Usable = balance minus the minimum to keep (blank/zero balance counts as nothing). */
export const usable = (b) => (!b.balance ? 0 : b.balance - minBalance());

export function meta() {
  return db.get('holdings', META_ID) || { expected: null, transfer: null, transferPerson: FAMILY[0].id };
}

export async function setMeta(patch) {
  const cur = db.get('holdings', META_ID);
  if (cur) return db.update('holdings', META_ID, patch);
  return db.put('holdings', { ...base(cfg.memberId), id: META_ID, kind: 'meta', expected: null, transfer: null, transferPerson: FAMILY[0].id, ...patch });
}

function nextOrder(kind, person) {
  return live().filter((h) => h.kind === kind && h.person === person).reduce((m, h) => Math.max(m, (h.sortOrder ?? 0) + 1), 0);
}

export async function addBank(person, data = {}) {
  if (banks(person).length >= MAX_ROWS) throw new Error(`Max ${MAX_ROWS} banks per person`);
  return db.put('holdings', {
    ...base(cfg.memberId), kind: 'bank', person, name: '', balance: null, cc: null, ccPayer: person,
    sortOrder: nextOrder('bank', person), ...data,
  });
}

export async function addCash(person, amount, note = '') {
  if (cashEntries(person).length >= MAX_ROWS) throw new Error(`Max ${MAX_ROWS} cash entries per person`);
  return db.put('holdings', { ...base(cfg.memberId), kind: 'cash', person, amount, note, sortOrder: nextOrder('cash', person) });
}

export const update = (id, patch) => db.update('holdings', id, patch);
export const remove = (id) => db.update('holdings', id, { deleted: true });
export const restore = (id) => db.update('holdings', id, { deleted: false });

export async function move(id, dir) {
  const h = db.get('holdings', id);
  const list = live().filter((x) => x.kind === h.kind && x.person === h.person).sort(byOrder);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) if (list[k].sortOrder !== k) await db.update('holdings', list[k].id, { sortOrder: k });
}

const sum = (a) => a.reduce((t, x) => t + (Number(x) || 0), 0);

/** Everything the Balances screens show. */
export function position() {
  const m = meta();
  const transfer = Number(m.transfer) || 0;
  const people = FAMILY.map((f) => {
    const bs = banks(f.id);
    const cash = sum(cashEntries(f.id).map((c) => c.amount));
    const usableTotal = sum(bs.map(usable));
    const bankTotal = sum(bs.map((b) => b.balance));
    // cards this person has to pay, whichever bank they sit on
    const ccToPay = sum(banks().filter((b) => (b.ccPayer || b.person) === f.id).map((b) => b.cc));
    const xfer = m.transferPerson === f.id ? transfer : 0;
    const bankNet = usableTotal - ccToPay - xfer;
    return { ...f, banks: bs, cash, bankTotal, usableTotal, ccToPay, transfer: xfer, bankNet, net: bankNet + cash };
  });
  const usableTotal = sum(people.map((p) => p.usableTotal));
  const cash = sum(people.map((p) => p.cash));
  const cc = sum(people.map((p) => p.ccToPay));
  const actual = usableTotal + cash - cc;
  const expected = m.expected == null ? null : Number(m.expected);
  return {
    people, usableTotal, cash, cc, transfer, actual, expected,
    bankTotal: sum(people.map((p) => p.bankTotal)),
    shortage: expected == null ? null : actual - expected,
    total: sum(people.map((p) => p.net)),
  };
}

// ---------------- export (same shape as Expense.html so the Excel script keeps working) ----------------

const fmtSheetDate = (iso) => new Date(iso + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function exportData(date = localDate()) {
  const m = meta();
  const bs = FAMILY.flatMap((f) => banks(f.id));
  const rows = bs.filter((b) => (b.name || '').trim() || b.balance != null || b.cc != null);
  const cc = rows.map((b) => b.cc ?? null);
  while (cc.length && cc[cc.length - 1] == null) cc.pop();
  return {
    format: 'expense-sheet', version: 2, exportedAt: nowISO(), sheetName: fmtSheetDate(date), date,
    banks: rows.map((b) => ({ name: b.name, balance: b.balance, person: b.person, ccPayer: b.ccPayer || b.person })),
    cash: FAMILY.flatMap((f) => cashEntries(f.id)).map((c) => c.amount).filter((v) => v != null),
    cashDetail: FAMILY.flatMap((f) => cashEntries(f.id)).map((c) => ({ person: c.person, amount: c.amount, note: c.note })),
    creditCardPending: cc, balanceAsPerExpenses: m.expected, transfer: m.transfer,
  };
}

export function toTSV() {
  const d = exportData(), r = position();
  const g = Array.from({ length: 18 }, () => Array(19).fill(''));
  const set = (cell, v) => { g[+cell.slice(1) - 1][cell.charCodeAt(0) - 65] = v ?? ''; };
  set('A1', 'Bank Accounts'); set('D1', 'Cash'); set('E1', 'Credit Card Pending'); set('H1', 'Balance as per expenses');
  d.banks.forEach((b, i) => { set('A' + (i + 2), `${b.name} (${b.person === FAMILY[0].id ? 'VJ' : 'MM'})`); set('B' + (i + 2), b.balance); set('C' + (i + 2), b.balance ? b.balance - minBalance() : ''); });
  d.cash.forEach((v, i) => set('D' + (i + 2), v));
  d.creditCardPending.forEach((v, i) => set('E' + (i + 2), v));
  set('H2', d.balanceAsPerExpenses); set('H6', 'Actual Balance'); set('H8', r.actual);
  set('H14', 'Shortage'); set('H15', r.shortage); set('H18', 'Transfer'); set('J18', d.transfer);
  set('B18', r.bankTotal); set('C18', r.usableTotal); set('D18', r.cash); set('E18', r.cc);
  set('O2', 'VJ Balance'); set('Q2', r.people[0].bankNet); set('O7', 'MM Balance'); set('Q7', r.people[1].bankNet);
  set('O12', 'Cash'); set('Q12', r.cash); set('O17', 'Total'); set('Q17', r.total);
  return g.map((row) => row.join('\t').replace(/\t+$/, '')).join('\r\n');
}

export function summaryText(money) {
  const r = position();
  const lines = [`*Money position: ${fmtSheetDate(localDate())}*`, `Actual balance: ${money(r.actual)}`];
  if (r.shortage != null) lines.push(`Shortage: ${money(r.shortage)}`);
  for (const p of r.people) lines.push(`${p.name}: ${money(p.bankNet)} after cards${p.ccToPay ? ` (to pay ${money(p.ccToPay)})` : ''}, cash ${money(p.cash)}`);
  lines.push(`Total: ${money(r.total)}`);
  return lines.join('\n');
}

// ---------------- import an old Expense.html export ----------------

/**
 * `cashPerson` says whose cash the old single cash list is. Old rule: banks 1-5 are VJ's, the 6th is MM's,
 * and all card pending was deducted from VJ.
 */
export async function importOldSheet(d, cashPerson) {
  if (d?.format !== 'expense-sheet' || !Array.isArray(d.banks)) throw new Error('Not an Expense sheet export');
  const [vj, mm] = FAMILY.map((f) => f.id);
  let n = 0;
  const cc = d.creditCardPending || [];
  for (let i = 0; i < d.banks.length; i++) {
    const b = d.banks[i];
    const person = b.person || (i < 5 ? vj : mm);
    await addBank(person, { name: b.name || '', balance: b.balance ?? null, cc: cc[i] ?? null, ccPayer: b.ccPayer || vj });
    n++;
  }
  const detail = d.cashDetail || (d.cash || []).map((amount) => ({ person: cashPerson, amount }));
  for (const c of detail) { await addCash(c.person || cashPerson, c.amount, c.note || ''); n++; }
  await setMeta({ expected: d.balanceAsPerExpenses ?? null, transfer: d.transfer ?? null });
  return n;
}
