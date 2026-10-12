// Screens used by both Member and Hub: entry form, transactions list/table, reports.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, otherMember, localDate, todayStr, thisMonth, addMonths, monthRange, monthLabel, dayLabel, FREQUENCIES, stamp } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import * as recurring from '../recurring.js';
import * as reports from '../reports.js';
import { installBanner, syncReminder, $, $$, money, toast, confirmDialog, promptDialog, empty, download, compressImage, drawChart, cssVar, sheet, memberOptions } from './components.js';

// ---------------------------------------------------------------- rows

const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return localDate(d); };

/** Which entries a phone screen shows: mine, the partner's, or the whole family. The hub always sees everyone. */
export function viewOf(P) {
  if (cfg.mode === 'hub') return { scope: 'all', memberId: '', w: '', seg: false };
  const fam = tx.hasFamilyData();
  const w = fam ? P.get('w') || 'me' : 'me';
  return { scope: w === 'me' ? 'mine' : 'all', memberId: w === 'other' ? otherMember(cfg.memberId).id : '', w, seg: fam };
}

export function whoSeg(w) {
  const o = otherMember(cfg.memberId);
  return `<div class="seg who-seg no-print" role="tablist" aria-label="Whose entries">${[['me', 'Mine'], ['other', o.name], ['all', 'Family']].map(([k, l]) => `<button data-w="${k}" class="${w === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
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

export function txRow(t, { showMember = false } = {}) {
  const c = cats.get(t.categoryId);
  const sub = cats.get(t.subcategoryId);
  const isT = t.type === 'transfer';
  const ico = isT ? (t.toMemberId ? '🤝' : '🔁') : c?.icon || '🏷️';
  const title = isT
    ? (t.toMemberId ? cats.pathLabel(t) : `${tx.accountName(t.accountId)} → ${tx.accountName(t.toAccountId)}`)
    : sub?.name || c?.name || 'Uncategorized';
  const parts = [];
  if (sub && c) parts.push(c.name);
  if (showMember) parts.push(tx.memberName(t.ownerId));
  if (t.note) parts.push(t.note);
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const inner = `<span class="avatar">${ico}${payIcon(t)}</span><span class="main"><span class="title">${esc(title)}${t.receiptPhoto ? ' 📎' : ''}${t.recurringId ? ' 🔁' : ''}</span><span class="sub">${esc(parts.join(' · ') || tx.accountName(t.accountId))}</span></span><span class="num ${t.type}">${sign}${money(t.amount)}</span>`;
  return tx.canEdit(t)
    ? `<a class="list-item" href="#/add?id=${esc(t.id)}">${inner}</a>`
    : `<div class="list-item">${inner}</div>`;
}

export function groupedList(list, opts) {
  let html = '';
  let day = '';
  for (const t of list) {
    if (t.date !== day) {
      day = t.date;
      const dayTotal = list.filter((x) => x.date === day && x.type !== 'transfer').reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0);
      html += `${html ? '</div>' : ''}<a class="day-head" href="#/add?date=${esc(day)}" title="Add an entry on this date"><span>${esc(dayLabel(day))}</span><span class="row" style="gap:10px"><span class="num">${dayTotal >= 0 ? '+' : '−'}${money(Math.abs(dayTotal))}</span><span class="day-add" aria-label="Add entry on this date">＋</span></span></a><div class="card list" style="padding:0 12px;margin-bottom:6px">`;
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

// ---------------------------------------------------------------- entry form

export async function entryScreen(root, ctx) {
  const id = ctx.params.get('id');
  const existing = id ? db.get('transactions', id) : null;
  if (id && (!existing || existing.deleted)) { root.innerHTML = empty('That entry no longer exists.'); return; }
  if (existing && !tx.canEdit(existing)) { root.innerHTML = empty('You can only edit your own entries.'); return; }

  const accounts = tx.formAccounts(existing?.accountId);
  const st = existing
    ? { ...existing, amount: String(existing.amount), tagsText: (existing.tags || []).join(' '), repeat: '', xfer: existing.toMemberId ? 'member' : 'own', direction: existing.direction || 'out' }
    : {
        type: ctx.params.get('type') || 'expense', amount: '', date: /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.get('date') || '') ? ctx.params.get('date') : todayStr(), categoryId: null, subcategoryId: null,
        accountId: accounts[0]?.id || null, toAccountId: null,
        note: '', tagsText: '', receiptPhoto: null, repeat: '', xfer: 'own', direction: 'out',
      };

  let focused = false;
  function draw() {
    const isT = st.type === 'transfer';
    if (isT && st.xfer !== 'member' && accounts.length >= 2 && (!st.toAccountId || st.toAccountId === st.accountId)) {
      st.toAccountId = (accounts.find((a) => a.id !== st.accountId) || accounts[1]).id;
    }
    const other = otherMember(cfg.memberId);
    const mT = isT && st.xfer === 'member';
    const tree = isT ? [] : cats.tree(st.type, { includeArchived: false });
    const picked = tree.find((x) => x.cat.id === st.categoryId);
    // an archived category on an old entry should still show as selected
    const archivedPick = existing && st.categoryId && !picked ? cats.get(st.categoryId) : null;
    root.innerHTML = `
      <form id="f" class="stack" novalidate>
        <div class="seg" role="tablist">
          ${['expense', 'income', 'transfer'].map((t) => `<button type="button" data-type="${t}" class="${st.type === t ? 'on' : ''} ${t}-t">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
        ${isT ? `<div class="seg"><button type="button" data-xfer="own" class="${mT ? '' : 'on'}">Between my accounts</button><button type="button" data-xfer="member" class="${mT ? 'on' : ''}">With ${esc(other.name)}</button></div>
        ${mT ? `<div class="seg"><button type="button" data-dir="out" class="${st.direction === 'in' ? '' : 'on'}">I paid ${esc(other.name)}</button><button type="button" data-dir="in" class="${st.direction === 'in' ? 'on' : ''}">${esc(other.name)} paid me</button></div>
        <p class="muted small">You can each record your own side. Two entries for the same amount on the same day (or a day apart) are matched and counted once between you. It never counts as income or expense.</p>` : ''}` : ''}
        <label class="field"><span>Amount (${esc(cfg.currency || 'INR')})</span>
          <input id="amount" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(st.amount)}" ${existing ? '' : 'autofocus'}>
        </label>
        <div>
          <span class="lbl">Date</span>
          <div class="chips date-chips">
            <button type="button" data-date="${esc(todayStr())}" class="${st.date === todayStr() ? 'on' : ''}">Today</button>
            <button type="button" data-date="${esc(yesterday())}" class="${st.date === yesterday() ? 'on' : ''}">Yesterday</button>
            <label class="datebtn ${st.date !== todayStr() && st.date !== yesterday() ? 'on' : ''}">📅 ${st.date === todayStr() || st.date === yesterday() ? 'Pick date' : esc(dayLabel(st.date))}<input id="date" type="date" value="${esc(st.date)}" max="2100-12-31" aria-label="Pick a date"></label>
          </div>
        </div>
        ${isT ? '' : `
        <div>
          <div class="card-head"><b>Category</b>${picked || archivedPick ? '<span class="muted small">Tap it again to change</span>' : '<button type="button" class="btn small ghost" data-newcat>+ New</button>'}</div>
          <div class="cat-grid ${picked || archivedPick ? 'collapsed' : ''}">
            ${archivedPick ? `<button type="button" class="cat-tile on" disabled><span class="e">${esc(archivedPick.icon)}</span>${esc(archivedPick.name)} (archived)</button>` : ''}
            ${tree.filter(({ cat }) => !picked || cat.id === st.categoryId).map(({ cat }) => `<button type="button" class="cat-tile ${cat.id === st.categoryId ? 'on' : ''}" data-cat="${esc(cat.id)}"><span class="e">${esc(cat.icon)}</span>${esc(cat.name)}</button>`).join('')}
          </div>
        </div>
        ${picked ? `<div><div class="card-head"><b>${esc(picked.cat.name)}: subcategory <span class="muted small">(optional)</span></b><button type="button" class="btn small ghost" data-newsub>+ New</button></div>
          <div class="chips">${picked.subs.map((s) => `<button type="button" class="${s.id === st.subcategoryId ? 'on' : ''}" data-sub="${esc(s.id)}">${esc(s.name)}</button>`).join('') || '<span class="muted small">No subcategories yet.</span>'}</div></div>` : ''}`}
        <div>
          <span class="lbl">${mT ? (st.direction === 'in' ? 'Received into' : 'Paid from') : isT ? 'Move money' : st.type === 'income' ? 'Received into' : 'Paid from'}</span>
          ${isT && !mT ? `<div class="seg">${[[accounts[0], accounts[1]], [accounts[1], accounts[0]]].map(([f, to]) => `<button type="button" data-xdir="${esc(f.id)}|${esc(to.id)}" class="${st.accountId === f.id ? 'on' : ''}">${esc(f.name)} → ${esc(to.name)}</button>`).join('')}</div>`
            : `<div class="seg">${accounts.map((a) => `<button type="button" data-acc="${esc(a.id)}" class="${a.id === st.accountId ? 'on' : ''}">${esc(a.name)}</button>`).join('')}</div>`}
        </div>
        ${existing || isT ? '' : `<label class="field"><span>Repeat</span>
          <select id="repeat"><option value="">Does not repeat</option>${FREQUENCIES.map(([v, l]) => `<option value="${v}" ${v === st.repeat ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
        <label class="field"><span>Note</span><input id="note" maxlength="200" value="${esc(st.note)}" placeholder="What was it for?"></label>
        <label class="field"><span>Tags <span class="muted">(space separated)</span></span><input id="tags" value="${esc(st.tagsText)}" placeholder="#trip #diwali"></label>
        <div>
          <span class="muted small">Receipt photo (optional)</span>
          <div class="row">
            <label class="btn small">📷 ${st.receiptPhoto ? 'Replace' : 'Add photo'}<input id="photo" type="file" accept="image/*" hidden></label>
            ${st.receiptPhoto ? '<button type="button" class="btn small" data-rmphoto>Remove</button>' : ''}
          </div>
          ${st.receiptPhoto ? `<img class="receipt-img" alt="Receipt" src="${st.receiptPhoto}" style="margin-top:8px">` : ''}
        </div>
        <p id="err" class="danger-text small" role="alert"></p>
        <div class="row">
          <button class="btn primary grow" data-save>${existing ? 'Save changes' : 'Save'}</button>
          ${existing ? '' : '<button type="button" class="btn grow" data-again>Save &amp; add another</button>'}
        </div>
        ${existing ? '<button type="button" class="btn danger" data-delete style="width:100%">Delete entry</button>' : ''}
      </form>`;
    bind();
    if (!existing && !focused) { focused = true; $('#amount', root)?.focus(); }
  }

  function sync() {
    const g = (s) => $(s, root);
    if (g('#amount')) st.amount = g('#amount').value;
    if (g('#date')) st.date = g('#date').value;
    if (g('#repeat')) st.repeat = g('#repeat').value;
    if (g('#note')) st.note = g('#note').value;
    if (g('#tags')) st.tagsText = g('#tags').value;
  }

  async function save(again) {
    sync();
    const err = $('#err', root);
    const amount = Math.round(parseFloat(String(st.amount).replace(/,/g, '')) * 100) / 100;
    if (!(amount > 0)) { err.textContent = 'Enter an amount greater than zero.'; $('#amount', root).focus(); return; }
    if (!st.date) { err.textContent = 'Pick a date.'; return; }
    if (st.type === 'transfer') {
      if (!st.accountId || (st.xfer !== 'member' && !st.toAccountId)) { err.textContent = st.xfer === 'member' ? 'Choose your account.' : 'Choose both accounts for a transfer.'; return; }
    } else if (!st.categoryId) { err.textContent = 'Choose a category.'; return; }
    const tags = st.tagsText.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
    const data = {
      type: st.type, amount, date: st.date, note: st.note.trim(), tags, paymentMode: db.get('accounts', st.accountId)?.type === 'cash' ? 'cash' : 'online',
      categoryId: st.type === 'transfer' ? null : st.categoryId, subcategoryId: st.type === 'transfer' ? null : st.subcategoryId,
      accountId: st.accountId, toAccountId: st.type === 'transfer' && st.xfer !== 'member' ? st.toAccountId : null, receiptPhoto: st.receiptPhoto || null,
      toMemberId: st.type === 'transfer' && st.xfer === 'member' ? otherMember(cfg.memberId).id : null,
      direction: st.type === 'transfer' && st.xfer === 'member' ? st.direction : null,
    };
    if (existing) await tx.update(existing.id, data);
    else {
      await tx.add(data);
      if (st.repeat) {
        const { receiptPhoto, ...tpl } = data;
        await recurring.create(tpl, st.repeat, recurring.nextDate(st.date, st.repeat));
      }
    }
    toast(existing ? 'Entry updated' : 'Saved');
    if (again) {
      Object.assign(st, { amount: '', note: '', tagsText: '', receiptPhoto: null, repeat: '', subcategoryId: null });
      draw();
      $('#amount', root).focus();
    } else (existing || ctx.params.get('date')) && history.length > 1 ? history.back() : ctx.go('transactions');
  }

  function bind() {
    root.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.type) { sync(); st.type = b.dataset.type; st.categoryId = null; st.subcategoryId = null; draw(); }
      else if (b.dataset.acc) { sync(); st.accountId = b.dataset.acc; draw(); }
      else if (b.dataset.xdir) { sync(); [st.accountId, st.toAccountId] = b.dataset.xdir.split('|'); draw(); }
      else if (b.dataset.date) { sync(); st.date = b.dataset.date; draw(); }
      else if (b.dataset.xfer) { sync(); st.xfer = b.dataset.xfer; draw(); }
      else if (b.dataset.dir) { sync(); st.direction = b.dataset.dir; draw(); }
      else if (b.dataset.cat) { sync(); const same = st.categoryId === b.dataset.cat; st.categoryId = same ? null : b.dataset.cat; st.subcategoryId = null; draw(); }
      else if (b.dataset.sub) { sync(); st.subcategoryId = st.subcategoryId === b.dataset.sub ? null : b.dataset.sub; draw(); }
      else if ('newcat' in b.dataset) {
        sync();
        const name = await promptDialog({ title: `New ${st.type} category`, label: 'Category name' });
        if (name?.trim()) { const c = await cats.create({ name, type: st.type }); st.categoryId = c.id; st.subcategoryId = null; draw(); }
      } else if ('newsub' in b.dataset) {
        sync();
        const name = await promptDialog({ title: `New subcategory in ${cats.name(st.categoryId)}`, label: 'Subcategory name' });
        if (name?.trim()) { const c = await cats.create({ name, type: st.type, parentId: st.categoryId }); st.subcategoryId = c.id; draw(); }
      } else if ('rmphoto' in b.dataset) { sync(); st.receiptPhoto = null; draw(); }
      else if ('again' in b.dataset) save(true);
      else if ('delete' in b.dataset) {
        if (await confirmDialog('Delete this entry? It will also be removed from the Hub at your next sync.', { okText: 'Delete', danger: true })) {
          await tx.remove(existing.id);
          toast('Entry deleted');
          history.length > 1 ? history.back() : ctx.go('transactions');
        }
      }
    };
    $('#f', root).onsubmit = (e) => { e.preventDefault(); save(false); };
    const dateIn = $('#date', root);
    if (dateIn) dateIn.onclick = () => { try { dateIn.showPicker?.(); } catch { /* ignore */ } };
    if (dateIn) dateIn.onchange = () => { sync(); if (st.date) draw(); };
    const photo = $('#photo', root);
    if (photo) photo.onchange = async () => {
      if (!photo.files[0]) return;
      try { sync(); st.receiptPhoto = await compressImage(photo.files[0]); draw(); } catch (err) { toast(err.message); }
    };
  }

  draw();
}

// ---------------------------------------------------------------- transactions

let shown = 200;
const sortState = { key: 'date', dir: -1 };

export async function transactionsScreen(root, ctx) {
  const hub = cfg.mode === 'hub';
  const P = ctx.params;
  const view = viewOf(P);
  const scope = view.scope;
  const f = {
    q: P.get('q') || '', m: P.get('m') || thisMonth(), t: P.get('t') || '', c: P.get('c') || '', a: P.get('a') || '',
    u: P.get('u') || '', min: P.get('min') || '', max: P.get('max') || '', w: view.w === 'me' ? '' : view.w,
  };
  const setF = (patch) => {
    const n = { ...f, ...patch };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(n)) if (v && !(k === 'm' && v === thisMonth())) qs.set(k, v);
    history.replaceState(null, '', '#/transactions' + (qs.toString() ? '?' + qs : ''));
    shown = 200;
    ctx.refresh();
  };

  const filter = { scope, text: f.q, type: f.t, accountId: f.a, memberId: f.u || view.memberId, min: +f.min || 0, max: +f.max || 0 };
  if (f.c.startsWith('s:')) filter.subcategoryId = f.c.slice(2);
  else if (f.c.startsWith('c:')) filter.categoryId = f.c.slice(2);
  if (/^\d{4}-\d{2}$/.test(f.m)) Object.assign(filter, monthRange(f.m));
  else if (/^\d{4}$/.test(f.m)) Object.assign(filter, { from: `${f.m}-01-01`, to: `${f.m}-12-31` });
  let list = tx.query(filter);
  const tot = reports.totals(list);
  const accounts = hub ? db.live('accounts') : tx.myAccounts({ includeArchived: true });
  const isMonth = /^\d{4}-\d{2}$/.test(f.m);
  const activeCount = [f.q, f.t, f.c, f.a, f.u, f.min, f.max].filter(Boolean).length;

  if (hub) {
    const dir = sortState.dir;
    const keyFn = { date: (t) => t.date, amount: (t) => t.amount, member: (t) => tx.memberName(t.ownerId), category: (t) => cats.pathLabel(t) }[sortState.key];
    list = [...list].sort((a, b) => (keyFn(a) > keyFn(b) ? dir : keyFn(a) < keyFn(b) ? -dir : 0));
  }
  const page = list.slice(0, shown);

  const hasChanges = !hub && db.all('transactions').some((t) => t.ownerId === cfg.memberId && (!cfg.lastExportAt || t.updatedAt > cfg.lastExportAt));
  root.innerHTML = `
    ${hub ? '' : installBanner() + syncReminder(hasChanges)}
    ${view.seg ? whoSeg(view.w) : ''}
    <div class="card">
      <div class="row">
        ${isMonth ? '<button class="btn small" data-mnav="-1" aria-label="Previous month">‹</button>' : ''}
        <b class="grow" style="text-align:center">${isMonth ? esc(monthLabel(f.m)) : f.m === 'all' ? 'All time' : esc(f.m)}</b>
        ${isMonth ? '<button class="btn small" data-mnav="1" aria-label="Next month">›</button>' : ''}
        <button class="btn small" data-allmonths>${f.m === 'all' ? 'This month' : 'All time'}</button>
      </div>
      <input id="q" type="search" placeholder="Search notes, tags…" value="${esc(f.q)}" aria-label="Search" style="margin-top:10px">
      <details class="more-filters" ${activeCount ? 'open' : ''}><summary>Filters${activeCount ? ` (${activeCount} on)` : ''}</summary><div class="filters">
        <select id="ftype" aria-label="Type"><option value="">All types</option>${['expense', 'income', 'transfer'].map((t) => `<option value="${t}" ${f.t === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
        <select id="fcat" aria-label="Category">${catFilterOptions(f.c)}</select>
        <select id="facc" aria-label="Account"><option value="">All accounts</option>${accounts.map((a) => `<option value="${esc(a.id)}" ${f.a === a.id ? 'selected' : ''}>${esc(a.name)}${hub ? ` (${esc(tx.memberName(a.ownerId))})` : ''}</option>`).join('')}</select>
        ${hub ? `<select id="fmem" aria-label="Member">${memberOptions(tx.members(), f.u)}</select>` : ''}
        <input id="fmin" type="number" inputmode="decimal" placeholder="Min amount" value="${esc(f.min)}" aria-label="Minimum amount">
        <input id="fmax" type="number" inputmode="decimal" placeholder="Max amount" value="${esc(f.max)}" aria-label="Maximum amount">
      </div></details>
      <div class="row between">
        <span class="muted small">${list.length} entries · <span class="income num">+${money(tot.income)}</span> · <span class="expense num">−${money(tot.expense)}</span></span>
        <span class="row">${activeCount ? '<button class="btn small" data-clear>✕ Clear filters</button>' : ''}<button class="btn small" data-csv>⬇ CSV</button>${hub ? '<button class="btn small" data-bulk disabled>Recategorize</button>' : ''}</span>
      </div>
    </div>
    ${list.length ? (hub ? hubTable(page) : groupedList(page, { showMember: scope === 'all' })) : empty('No entries here.', activeCount ? 'Nothing matches these filters. Tap <b>Clear filters</b> above.' : 'Tap the blue <b>＋</b> below to add one, or try another month.')}
    ${list.length > shown ? `<button class="btn" style="width:100%" data-more-rows>Show ${Math.min(200, list.length - shown)} more (${list.length - shown} left)</button>` : ''}
  `;

  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  $('#q', root).oninput = debounce((e) => setF({ q: e.target.value }));
  $('#ftype', root).onchange = (e) => setF({ t: e.target.value });
  $('#fcat', root).onchange = (e) => setF({ c: e.target.value });
  $('#facc', root).onchange = (e) => setF({ a: e.target.value });
  $('#fmem', root)?.addEventListener('change', (e) => setF({ u: e.target.value }));
  $('#fmin', root).onchange = (e) => setF({ min: e.target.value });
  $('#fmax', root).onchange = (e) => setF({ max: e.target.value });

  const selected = new Set();
  const bulkBtn = $('[data-bulk]', root);
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    const th = e.target.closest('th[data-sort]');
    if (th) {
      sortState.dir = sortState.key === th.dataset.sort ? -sortState.dir : th.dataset.sort === 'date' || th.dataset.sort === 'amount' ? -1 : 1;
      sortState.key = th.dataset.sort;
      return ctx.refresh();
    }
    if (!b) return;
    if ('clear' in b.dataset) setF({ q: '', t: '', c: '', a: '', u: '', min: '', max: '' });
    else if (b.dataset.w) setF({ w: b.dataset.w === 'me' ? '' : b.dataset.w });
    else if (b.dataset.mnav) setF({ m: addMonths(f.m, Number(b.dataset.mnav)) });
    else if ('allmonths' in b.dataset) setF({ m: f.m === 'all' ? thisMonth() : 'all' });
    else if ('moreRows' in b.dataset) { shown += 200; ctx.refresh(); }
    else if ('csv' in b.dataset) { download(`mm-transactions-${stamp()}.csv`, reports.toCSV(list), 'text/csv'); }
    else if ('bulk' in b.dataset) bulkRecategorize([...selected], ctx);
  };
  root.onchange = (e) => {
    if (e.target.matches('[data-sel]')) {
      e.target.checked ? selected.add(e.target.dataset.sel) : selected.delete(e.target.dataset.sel);
    } else if (e.target.matches('[data-selall]')) {
      $$('[data-sel]', root).forEach((c) => { c.checked = e.target.checked; e.target.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); });
    } else return;
    if (bulkBtn) { bulkBtn.disabled = !selected.size; bulkBtn.textContent = selected.size ? `Recategorize (${selected.size})` : 'Recategorize'; }
  };
}

function hubTable(list) {
  const arrow = (k) => (sortState.key === k ? (sortState.dir > 0 ? ' ▲' : ' ▼') : '');
  return `<div class="card" style="padding:0"><div class="table-wrap"><table class="tbl">
    <thead><tr><th><input type="checkbox" data-selall aria-label="Select all"></th>
      <th data-sort="date">Date${arrow('date')}</th><th data-sort="member">Member${arrow('member')}</th><th data-sort="category">Category${arrow('category')}</th>
      <th>Note</th><th>Account</th><th class="r" data-sort="amount">Amount${arrow('amount')}</th><th></th></tr></thead>
    <tbody>${list.map((t) => `<tr>
      <td><input type="checkbox" data-sel="${esc(t.id)}" aria-label="Select"></td>
      <td class="num">${esc(t.date)}</td>
      <td><span class="dot" style="background:${esc(tx.memberColor(t.ownerId))}"></span> ${esc(tx.memberName(t.ownerId))}</td>
      <td>${esc(cats.pathLabel(t))}</td><td>${esc(t.note)}${t.receiptPhoto ? ' 📎' : ''}</td><td>${payIcon(t)} ${esc(tx.accountName(t.accountId))}</td>
      <td class="r num ${t.type}">${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${money(t.amount)}</td>
      <td>${tx.canEdit(t) ? `<a href="#/add?id=${esc(t.id)}" aria-label="Edit">✎</a>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function bulkRecategorize(ids, ctx) {
  const rows = ids.map((id) => db.get('transactions', id)).filter(Boolean);
  const types = new Set(rows.map((t) => t.type));
  if (types.size !== 1 || types.has('transfer')) { toast('Select entries of one type (all expense, or all income).'); return; }
  const type = [...types][0];
  const tree = cats.tree(type);
  const s = sheet(`Recategorize ${rows.length} entries`, `
    <form class="stack">
      <label class="field"><span>Category</span><select name="cat" required><option value="">Choose…</option>${tree.map(({ cat }) => `<option value="${esc(cat.id)}">${esc(cat.icon)} ${esc(cat.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Subcategory (optional)</span><select name="sub"><option value="">None</option></select></label>
      <p class="muted small">This changes the Hub's copy of these entries. Members keep their own category on their phones.</p>
      <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Apply</button></div>
    </form>`);
  const form = $('form', s.el);
  form.cat.onchange = () => {
    const subs = tree.find((x) => x.cat.id === form.cat.value)?.subs || [];
    form.sub.innerHTML = '<option value="">None</option>' + subs.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    for (const t of rows) await tx.update(t.id, { categoryId: form.cat.value, subcategoryId: form.sub.value || null });
    s.close();
    toast(`${rows.length} entries updated`);
    ctx.refresh();
  };
}

// ---------------------------------------------------------------- reports

export async function reportsScreen(root, ctx) {
  const P = ctx.params;
  const view = viewOf(P);
  const scope = view.scope;
  const hub = scope === 'all' && !view.memberId;
  const mode = P.get('p') === 'year' ? 'year' : 'month';
  const d = P.get('d') || (mode === 'year' ? thisMonth().slice(0, 4) : thisMonth());
  const kind = P.get('k') === 'income' ? 'income' : 'expense';
  const go = (patch) => {
    const n = { p: mode, d, k: kind, w: view.w === 'me' ? '' : view.w, ...patch };
    history.replaceState(null, '', `#/reports?p=${n.p}&d=${n.d}&k=${n.k}${n.w ? '&w=' + n.w : ''}`);
    ctx.refresh();
  };
  const rangeOf = (x) => (mode === 'year' ? { from: `${x}-01-01`, to: `${x}-12-31` } : monthRange(x));
  const prevKey = mode === 'year' ? String(Number(d) - 1) : addMonths(d, -1);
  const q = (r) => tx.query({ scope, memberId: view.memberId, ...r });
  const list = q(rangeOf(d));
  const tot = reports.totals(list);
  const rows = reports.byCategory(list, kind);
  const prevRows = new Map(reports.byCategory(q(rangeOf(prevKey)), kind).map((r) => [r.id, r.total]));
  const kindTotal = kind === 'expense' ? tot.expense : tot.income;
  const label = mode === 'year' ? d : monthLabel(d);
  const prevLabel = mode === 'year' ? prevKey : monthLabel(prevKey, false);
  const trendEnd = mode === 'year' ? `${d}-12` : d;
  const trend = reports.monthlyTrend(q({}), mode === 'year' ? 12 : 6, trendEnd);
  const members = hub ? reports.byMember(list) : [];
  const detail = (id) => `#/category?c=${encodeURIComponent(id)}&d=${d}&p=${mode}&t=${kind}${view.w && view.w !== 'me' ? '&w=' + view.w : ''}`;

  const delta = (r) => {
    const before = prevRows.get(r.id);
    if (before == null) return '<span class="muted small">new</span>';
    if (!before) return '';
    const pct = Math.round(((r.total - before) / before) * 100);
    if (!pct) return '<span class="muted small">–</span>';
    const bad = kind === 'expense' ? pct > 0 : pct < 0;
    return `<span class="small ${bad ? 'expense' : 'income'}" title="vs ${esc(prevLabel)}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
  };

  root.innerHTML = `
    ${view.seg ? whoSeg(view.w) : ''}
    <div class="row between no-print" style="margin-bottom:12px">
      <div class="seg" style="min-width:160px"><button data-p="month" class="${mode === 'month' ? 'on' : ''}">Monthly</button><button data-p="year" class="${mode === 'year' ? 'on' : ''}">Yearly</button></div>
      <div class="row"><button class="btn small" data-nav="-1" aria-label="Previous">‹</button><b>${esc(label)}</b><button class="btn small" data-nav="1" aria-label="Next">›</button></div>
      <div class="row"><button class="btn small" data-csv>⬇ CSV</button><button class="btn small" data-print>🖨 PDF</button></div>
    </div>
    <h2 class="muted small" style="display:none" id="print-title">${hub ? 'Family' : esc(cfg.memberName)} report: ${esc(label)}</h2>
    <div class="tabs2" role="tablist">
      <button data-k="income" class="${kind === 'income' ? 'on' : ''}" role="tab">Income <b class="num income">${money(tot.income)}</b></button>
      <button data-k="expense" class="${kind === 'expense' ? 'on' : ''}" role="tab">Expenses <b class="num expense">${money(tot.expense)}</b></button>
    </div>
    <div class="row small muted" style="margin:6px 2px 12px">Saved <b class="num ${tot.net >= 0 ? 'income' : 'expense'}">${money(tot.net)}</b> · Savings rate <b>${tot.income ? Math.round((tot.net / tot.income) * 100) : 0}%</b></div>

    <div class="grid two">
      <div class="card"><h2>${kind === 'expense' ? 'Where the money went' : 'Where it came from'}</h2>${rows.length ? '<div class="chart-box"><canvas id="c-cat" aria-label="By category"></canvas></div>' : `<p class="muted">No ${kind} in this period.</p>`}</div>
      <div class="card"><h2>${mode === 'year' ? '12-month trend' : '6-month trend'}</h2><div class="chart-box"><canvas id="c-trend" aria-label="Trend"></canvas></div></div>
    </div>

    <div class="card" style="padding:6px 12px">
      <div class="card-head" style="padding-top:8px"><h2>${kind === 'expense' ? 'Expenses' : 'Income'} by category</h2><span class="muted small">vs ${esc(prevLabel)}</span></div>
      ${rows.length ? rows.map((r) => `<a class="rank link" href="${detail(r.id)}"><span class="pct" style="background:${esc(r.color)}">${Math.round((r.total / (kindTotal || 1)) * 100)}%</span>
        <span class="grow">${esc(r.icon)} ${esc(r.name)} <span class="muted small">(${r.count})</span></span><span class="num">${money(r.total)}</span><span class="delta">${delta(r)}</span></a>`).join('') : '<p class="muted">Nothing recorded.</p>'}
      <p class="muted small no-print" style="margin:8px 2px">Tap a category for its subcategories, month-by-month history and daily entries.</p>
    </div>
    ${hub ? `<div class="card"><h2>Member comparison</h2>${members.length ? `<div class="chart-box"><canvas id="c-mem" aria-label="Members"></canvas></div>
      <table class="tbl"><thead><tr><th>Member</th><th class="r">Income</th><th class="r">Expense</th></tr></thead><tbody>${members.map((m) => `<tr><td><span class="dot" style="background:${esc(m.color)}"></span> ${esc(m.name)}</td><td class="r num income">${money(m.income)}</td><td class="r num expense">${money(m.expense)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No data.</p>'}</div>` : ''}
  `;

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.p) return go({ p: b.dataset.p, d: b.dataset.p === 'year' ? d.slice(0, 4) : mode === 'year' ? `${d}-${thisMonth().slice(5)}` : d });
    if (b?.dataset.k) return go({ k: b.dataset.k });
    if (b?.dataset.w) return go({ w: b.dataset.w === 'me' ? '' : b.dataset.w });
    if (b?.dataset.nav) return go({ d: mode === 'year' ? String(Number(d) + Number(b.dataset.nav)) : addMonths(d, Number(b.dataset.nav)) });
    if (b && 'csv' in b.dataset) return download(`mm-report-${d}.csv`, reports.toCSV(list), 'text/csv');
    if (b && 'print' in b.dataset) { $('#print-title', root).style.display = 'block'; window.print(); }
  };

  const ink = { income: cssVar('--income'), expense: cssVar('--expense') };
  if (rows.length) {
    const top = rows.slice(0, 10);
    const rest = rows.slice(10).reduce((s, c) => s + c.total, 0);
    drawChart($('#c-cat', root), {
      type: 'doughnut',
      data: { labels: [...top.map((c) => c.name), ...(rest ? ['Other'] : [])], datasets: [{ data: [...top.map((c) => c.total), ...(rest ? [rest] : [])], backgroundColor: [...top.map((c) => c.color), ...(rest ? ['#94a3b8'] : [])], borderWidth: 0 }] },
      options: { plugins: { legend: { position: 'right', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.parsed)}` } } } },
    });
  }
  drawChart($('#c-trend', root), {
    type: 'bar',
    data: { labels: trend.map((t) => monthLabel(t.month, false)), datasets: [{ label: 'Income', data: trend.map((t) => t.income), backgroundColor: ink.income }, { label: 'Expense', data: trend.map((t) => t.expense), backgroundColor: ink.expense }] },
    options: { scales: { y: { beginAtZero: true } }, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } } },
  });
  if (members.length) {
    drawChart($('#c-mem', root), {
      type: 'bar',
      data: { labels: members.map((m) => m.name), datasets: [{ label: 'Income', data: members.map((m) => m.income), backgroundColor: ink.income }, { label: 'Expense', data: members.map((m) => m.expense), backgroundColor: ink.expense }] },
      options: { scales: { y: { beginAtZero: true } } },
    });
  }
}
