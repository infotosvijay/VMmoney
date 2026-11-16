// Shared list rows: who-is-viewing helpers, one transaction row, the day-grouped list and the category <select> options.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, otherMember, dayLabel } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import { money } from './components.js';

/** Which entries a phone screen shows: mine, the partner's, or the whole family. The hub always sees everyone. */
export function viewOf(P) {
  if (cfg.mode === 'hub') return { scope: 'all', memberId: '', w: '', seg: false };
  const fam = tx.hasFamilyData();
  const w = fam ? P.get('w') || 'me' : 'me';
  return { scope: w === 'me' ? 'mine' : 'all', memberId: w === 'other' ? otherMember(cfg.memberId).id : '', w, seg: fam };
}

export function whoSeg(w) {
  const o = otherMember(cfg.memberId);
  return `<div class="seg who-seg no-print" role="tablist" aria-label="Whose entries">${[['me', 'Mine'], ['other', o.name], ['all', 'Family']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${w === k}" data-w="${k}" class="${w === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}

/** 💵 for cash, 🌐 for online. Empty for moves between your own accounts (the title already says "Online → Cash"). */
export function payIcon(t) {
  if (t.type === 'transfer' && !t.toMemberId) return '';
  const id = String(t.accountId || '');
  if (!id) return '';
  const cash = id.endsWith('-cash') || db.get('accounts', id)?.type === 'cash';
  return cash
    ? '<span class="pay cash" role="img" aria-label="Cash" title="Cash">💵</span>'
    : '<span class="pay online" role="img" aria-label="Online" title="Online">🌐</span>';
}

export function txRow(t, { showMember = false, as = null } = {}) {
  const c = cats.get(t.categoryId);
  const sub = cats.get(t.subcategoryId);
  const isT = t.type === 'transfer';
  const ico = isT ? (t.toMemberId ? '🤝' : '🔁') : sub ? cats.icon(sub) : c?.icon || '🏷️';
  // For a VJ <-> MM transfer, say who it came from / went to, as seen by `as` (default: the person who recorded it)
  const famX = isT && t.toMemberId;
  const viewer = as || t.ownerId;
  const incoming = famX && ((t.direction === 'out' && t.toMemberId === viewer) || (t.direction === 'in' && t.ownerId === viewer));
  const counterpart = famX ? tx.memberName(viewer === t.ownerId ? t.toMemberId : t.ownerId) : '';
  const wholeFamily = famX && as === 'family';
  const fromId = t.direction === 'out' ? t.ownerId : t.toMemberId;
  const toId = t.direction === 'out' ? t.toMemberId : t.ownerId;
  const title = isT
    ? (famX ? (wholeFamily ? `Transfer ${tx.memberName(fromId)} → ${tx.memberName(toId)}` : `Transfer ${incoming ? 'from' : 'to'} ${counterpart}`) : `${tx.accountName(t.accountId)} → ${tx.accountName(t.toAccountId)}`)
    : sub?.name || c?.name || 'Uncategorized';
  const parts = [];
  if (sub && c) parts.push(c.name);
  if (showMember) parts.push(tx.memberName(t.ownerId));
  if (t.note) parts.push(t.note);
  const sign = famX ? (wholeFamily ? '' : incoming ? '+' : '−') : t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const amountClass = famX ? (wholeFamily ? 'transfer' : incoming ? 'income' : 'expense') : t.type;
  const inner = `<span class="avatar">${ico}${payIcon(t)}</span><span class="main"><span class="title">${esc(title)}${t.recurringId ? ' 🔁' : ''}${t.splitId ? ' <span title="Part of a split entry" aria-label="split">✂</span>' : ''}</span><span class="sub">${esc(parts.join(' · ') || tx.accountName(t.accountId))}</span></span><span class="num ${amountClass}">${sign}${money(t.amount)}</span>`;
  return tx.canEdit(t)
    ? `<a class="list-item" href="#/add?id=${esc(t.id)}">${inner}</a>`
    : `<div class="list-item">${inner}</div>`;
}

export function groupedList(list, opts) {
  // one pass: each day's net (transfers excluded) is added up as the rows go by, instead of re-scanning the list per day
  const net = new Map();
  for (const x of list) if (x.type !== 'transfer') net.set(x.date, (net.get(x.date) || 0) + (x.type === 'income' ? x.amount : -x.amount));
  let html = '';
  let day = '';
  for (const t of list) {
    if (t.date !== day) {
      day = t.date;
      const dayTotal = net.get(day) || 0;
      const total = `<span class="num">${dayTotal >= 0 ? '+' : '−'}${money(Math.abs(dayTotal))}</span>`;
      const add = `<span class="day-add" aria-hidden="true">＋</span>`;
      // with `dayFilter` (the Transactions screen) tapping the date shows only that day; the ＋ always adds an entry on it
      html += `${html ? '</div>' : ''}` + (opts?.dayFilter
        ? `<div class="day-head"><button type="button" class="day-label" data-day="${esc(day)}" title="Show only this day">${esc(dayLabel(day))}</button><span class="row" style="gap:10px">${total}<a class="day-plus" href="#/add?date=${esc(day)}" title="Add an entry on this date" aria-label="Add entry on ${esc(dayLabel(day))}">${add}</a></span></div>`
        : `<a class="day-head" href="#/add?date=${esc(day)}" title="Add an entry on this date"><span>${esc(dayLabel(day))}</span><span class="row" style="gap:10px">${total}<span class="day-add" aria-label="Add entry on this date">＋</span></span></a>`)
        + `<div class="card list" style="padding:0 12px;margin-bottom:6px">`;
    }
    html += txRow(t, opts);
  }
  return html + (html ? '</div>' : '');
}

/** <option>s for a category select: main categories with their subcategories indented. Values are c:<id> / s:<id>. */
export function catFilterOptions(selected) {
  let h = '<option value="">All categories</option>';
  for (const type of ['expense', 'income']) {
    h += `<optgroup label="${type === 'expense' ? 'Expense' : 'Income'}">`;
    for (const { cat, subs } of cats.tree(type, { includeArchived: true })) {
      h += `<option value="c:${esc(cat.id)}" ${selected === `c:${cat.id}` ? 'selected' : ''}>${esc(cat.icon)} ${esc(cat.name)}</option>`;
      for (const s of subs) h += `<option value="s:${esc(s.id)}" ${selected === `s:${s.id}` ? 'selected' : ''}>&nbsp;&nbsp;– ${esc(s.name)}</option>`;
    }
    h += '</optgroup>';
  }
  return h;
}
