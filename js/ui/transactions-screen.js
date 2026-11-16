// The Transactions screen: month navigation, filters, the day-grouped list (phone) or sortable table (hub).

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, otherMember, thisMonth, addMonths, monthLabel, stamp } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import * as reports from '../reports.js';
import { BLANK, PRESETS, presetRange, activePreset, dateRange, hasDateRange, filterChips, withSaved, withoutSaved } from '../filters.js';
import { viewOf, whoSeg, payIcon, groupedList, catFilterOptions } from './rows.js';
import { onSwipe, installBanner, syncReminder, moneyC, $, $$, money, toast, confirmDialog, promptDialog, empty, download, monthTitle, pickMonth, sheet, memberOptions } from './components.js';
import { icon } from './icons.js';

let shown = 200;
let savedPick = ''; // the saved filter last chosen, so the Delete button stays available after the list refreshes
const sortState = { key: 'date', dir: -1 };

export async function transactionsScreen(root, ctx) {
  const hub = cfg.mode === 'hub';
  const P = ctx.params;
  const view = viewOf(P);
  const scope = view.scope;
  const f = {
    q: P.get('q') || '', m: P.get('m') || thisMonth(), t: P.get('t') || '', c: P.get('c') || '', a: P.get('a') || '',
    u: P.get('u') || '', min: P.get('min') || '', max: P.get('max') || '', w: view.w === 'me' ? '' : view.w,
    df: P.get('df') || P.get('d') || '', dt: P.get('dt') || P.get('d') || '', // `d` = the old single-date link
  };
  if (hasDateRange(f)) f.m = 'all'; // a date range always means "all time"
  const chipNames = { cat: (id) => cats.name(id) || 'Unknown', account: (id) => tx.accountName(id) || 'Unknown', member: (id) => tx.memberName(id) };
  const writeUrl = (n) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(n)) if (v && !(k === 'm' && v === thisMonth())) qs.set(k, v);
    history.replaceState(null, '', '#/transactions' + (qs.toString() ? '?' + qs : ''));
  };
  const setF = (patch) => {
    writeUrl({ ...f, ...patch });
    shown = 200;
    ctx.refresh();
  };

  const accounts = hub ? db.live('accounts') : tx.myAccounts({ includeArchived: true });
  const isMonth = /^\d{4}-\d{2}$/.test(f.m);
  let list, tot, page, activeCount, chips;
  const compute = () => {
    const filter = { scope, text: f.q, type: f.t, accountId: f.a, memberId: f.u || view.memberId, min: +f.min || 0, max: +f.max || 0 };
    if (f.c.startsWith('s:')) filter.subcategoryId = f.c.slice(2);
    else if (f.c.startsWith('c:')) filter.categoryId = f.c.slice(2);
    Object.assign(filter, dateRange(f));
    list = tx.query(filter);
    tot = reports.totals(list);
    chips = filterChips(f, chipNames, { money: moneyC });
    activeCount = chips.length;
    if (hub) {
      const dir = sortState.dir;
      const keyFn = { date: (t) => t.date, amount: (t) => t.amount, member: (t) => tx.memberName(t.ownerId), category: (t) => cats.pathLabel(t) }[sortState.key];
      list = list.map((t) => ({ t, k: keyFn(t) })).sort((a, b) => (a.k > b.k ? dir : a.k < b.k ? -dir : 0)).map((x) => x.t); // key looked up once per row, not on every comparison
    }
    page = list.slice(0, shown);
  };
  compute();

  const chipsHTML = () => chips.map((c) => `<button type="button" class="chip-x" data-rm="${c.keys.join(',')}" aria-label="Remove filter: ${esc(c.label)}">${esc(c.label)} <span aria-hidden="true">✕</span></button>`).join('');
  const fsumText = () => `${icon('filter')} Filters` + (activeCount ? ` (${activeCount} on)` : '');
  // Balance in hand (Online + Cash) is always shown on your own list, whatever the filters, so it can be checked here.
  const balanceNow = hub || view.w === 'all' ? tx.inHandAll() : tx.inHand(view.w === 'other' ? view.memberId : cfg.memberId).total;
  // On one person's own tab (Mine / MM) the income figure is that person's income AFTER transfers between VJ and MM:
  // own income + money received from the other person - money sent to them. So a salary of 2,57,295 with 15,770
  // sent to MM shows 2,41,525, and MM (no salary, 15,770 received) shows 15,770 instead of 0.
  // The Family tab and the laptop show the plain income and spending (a transfer inside the family nets to zero).
  const ownTab = !hub && view.w !== 'all';
  const incomeAfterTransfers = () => {
    const p = view.w === 'other' ? view.memberId : cfg.memberId;
    let v = tot.income;
    for (const t of list) {
      if (t.type !== 'transfer' || !t.toMemberId) continue;
      const incoming = (t.direction === 'out' && t.toMemberId === p) || (t.direction === 'in' && t.ownerId === p);
      v += incoming ? t.amount : -t.amount;
    }
    return v;
  };
  const totalsHTML = () => {
    const exp = `<span class="expense num" title="Spending">−${moneyC(tot.expense)}</span>`;
    if (!ownTab) return `<span class="income num" title="Income">+${moneyC(tot.income)}</span>` + exp;
    const v = incomeAfterTransfers();
    return `<span class="${v < 0 ? 'expense' : 'income'} num" title="Income after transfers">${v < 0 ? '−' : '+'}${moneyC(Math.abs(v))}</span>` + exp;
  };
  const bottomHTML = () => `
        <span class="sumline small"><span title="Entries">${icon('receipt', { label: 'Entries' })} ${list.length}</span>${totalsHTML()}${balanceNow != null ? `<span class="balchip num ${balanceNow < 0 ? 'expense' : ''}" title="Balance in hand">Bal ${moneyC(balanceNow)}</span>` : ''}</span>
        <span class="row">${activeCount ? `<button class="btn small" data-clear>${icon('close')} Clear filters</button>` : ''}${hub ? `<button class="btn small" data-csv>${icon('download')} CSV</button><button class="btn small" data-bulk disabled>Recategorize</button>` : ''}</span>
`;
  const resultsHTML = () => `
    ${list.length ? (hub ? hubTable(page) : groupedList(page, { dayFilter: true, showMember: scope === 'all', as: view.w === 'me' ? cfg.memberId : view.w === 'other' ? view.memberId : 'family' })) : empty('No entries here.', activeCount ? 'Nothing matches these filters. Tap <b>Clear filters</b> above.' : 'Tap <b>+</b> below to add one.')}
    ${list.length > shown ? `<button class="btn" style="width:100%" data-more-rows>Show ${Math.min(200, list.length - shown)} more (${list.length - shown} left)</button>` : ''}
`;

  const peer = hub ? null : otherMember(cfg.memberId);
  const peerAt = peer && cfg.peerSyncAt?.[peer.id];
  const hasChanges = !hub && db.all('transactions').some((t) => t.ownerId === cfg.memberId && (!peerAt || t.updatedAt > peerAt));
  root.innerHTML = `
    ${hub ? '' : installBanner() + syncReminder(hasChanges, peer)}
    ${view.seg ? whoSeg(view.w) : ''}
    <div class="searchbar"><label class="search-field">${icon('search')}<input id="q" type="search" placeholder="Search entries" title="Words must all match. Operators: >500  <100  cat:food  type:income  acc:cash  member:vj  note:rent" value="${esc(f.q)}" aria-label="Search" style="grid-column:1/-1"></label></div>
    <div class="card">
      <div class="row">
        ${isMonth ? `<button class="btn icon" data-mnav="-1" aria-label="Previous month">${icon('left')}</button>` : ''}
        <span class="grow" style="text-align:center">${monthTitle(isMonth ? monthLabel(f.m, false) : f.m === 'all' ? (hasDateRange(f) ? 'All time · date range' : 'All time') : f.m)}</span>
        ${isMonth ? `<button class="btn icon" data-mnav="1" aria-label="Next month">${icon('right')}</button>` : ''}
        <button class="btn small" data-allmonths>${f.m === 'all' ? 'This month' : 'All time'}</button>
      </div>
      <div class="chips active-chips" id="active-chips">${chipsHTML()}</div>
      <details class="more-filters" ${activeCount ? 'open' : ''}><summary id="fsum">${fsumText()}</summary><div class="filters">
        <select id="ftype" aria-label="Type"><option value="">All types</option>${['expense', 'income', 'transfer'].map((t) => `<option value="${t}" ${f.t === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
        <select id="fcat" aria-label="Category">${catFilterOptions(f.c)}</select>
        <select id="facc" aria-label="Account"><option value="">All accounts</option>${accounts.map((a) => `<option value="${esc(a.id)}" ${f.a === a.id ? 'selected' : ''}>${esc(a.name)}${hub ? ` (${esc(tx.memberName(a.ownerId))})` : ''}</option>`).join('')}</select>
        ${hub ? `<select id="fmem" aria-label="Member">${memberOptions(tx.members(), f.u)}</select>` : ''}
        <div class="chips date-chips date-row" style="grid-column:1/-1" role="group" aria-label="Date">${(() => {
          // a day picked here (or a range from an old link / saved filter): only that date shows, with ✕ to go back to the presets
          const own = (f.df || f.dt) && !activePreset(f);
          const short = (d) => (d ? new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '…');
          const label = !own ? '' : f.df === f.dt ? short(f.df) : `${short(f.df)} – ${short(f.dt)}`;
          const picker = `<label class="datebtn ${own ? 'on' : 'icon-only'}" title="Pick a date">${icon('calendar')}${label ? ` ${label}` : ''}<input id="fday" type="date" value="${esc(f.df === f.dt ? f.df : '')}" max="2100-12-31" aria-label="Pick a date"></label>`;
          if (own) return `${picker}<button type="button" class="icon-only" data-cleardate aria-label="Clear the date">${icon('close')}</button>`;
          return PRESETS.map(([k, l]) => `<button type="button" data-preset="${k}" class="${activePreset(f) === k ? 'on' : ''}" aria-pressed="${activePreset(f) === k}">${l}</button>`).join('') + picker;
        })()}</div>
        <div class="row" style="grid-column:1/-1">
          <select id="fsaved" class="grow" aria-label="Saved filters"><option value="">Saved filters…</option>${(cfg.savedFilters || []).map((s) => `<option value="${esc(s.id)}" ${s.id === savedPick ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          <button type="button" class="btn small" data-savef ${activeCount ? '' : 'disabled'}>Save this</button>
          <button type="button" class="btn small" data-delf ${savedPick ? '' : 'disabled'}>Delete</button>
        </div>
        <input id="fmin" type="text" inputmode="none" data-keypad autocomplete="off" placeholder="Min amount" value="${esc(f.min)}" aria-label="Minimum amount">
        <input id="fmax" type="text" inputmode="none" data-keypad autocomplete="off" placeholder="Max amount" value="${esc(f.max)}" aria-label="Maximum amount">
      </div></details>
      <div class="row between" id="tx-bottom">${bottomHTML()}
      </div>
    </div>
    <div id="tx-results">${resultsHTML()}</div>
  `;

  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  // Searching repaints only the list and totals. The input itself is never rebuilt, so the keyboard stays open.
  $('#q', root).oninput = debounce((e) => {
    f.q = e.target.value;
    writeUrl(f);
    shown = 200;
    compute();
    $('#tx-bottom', root).innerHTML = bottomHTML();
    $('#tx-results', root).innerHTML = resultsHTML();
    $('#fsum', root).innerHTML = fsumText();
    $('#active-chips', root).innerHTML = chipsHTML();
    selected.clear();
  }, 200);
  $('#ftype', root).onchange = (e) => setF({ t: e.target.value });
  $('#fcat', root).onchange = (e) => setF({ c: e.target.value });
  $('#facc', root).onchange = (e) => setF({ a: e.target.value });
  $('#fmem', root)?.addEventListener('change', (e) => setF({ u: e.target.value }));
  // Any date range switches the period to "All time". Emptying both dates goes back to the month.
  const setDates = (df, dt) => setF(df || dt ? { df, dt, m: 'all' } : { df: '', dt: '', m: thisMonth() });
  const day = $('#fday', root);
  day.onclick = () => { try { day.showPicker?.(); } catch { /* ignore */ } };
  day.onchange = (e) => setDates(e.target.value, e.target.value);
  const saved = $('#fsaved', root);
  saved.onchange = () => {
    const s = (cfg.savedFilters || []).find((x) => x.id === saved.value);
    savedPick = s ? s.id : '';
    if (s) setF({ ...BLANK, ...s.f, m: s.f.df || s.f.dt ? 'all' : f.m });
  };
  $('#fmin', root).onchange = (e) => setF({ min: e.target.value });
  $('#fmax', root).onchange = (e) => setF({ max: e.target.value });

  const selected = new Set();
  const bulkBtn = () => $('[data-bulk]', root);
  if (view.seg) {
    // swipe left / right to move between Mine, the other person, and Family
    const order = ['me', 'other', 'all'];
    onSwipe(root, (dir) => {
      const n = order.indexOf(view.w) + (dir === 'next' ? 1 : -1);
      if (n < 0 || n >= order.length) return false;
      setF({ w: order[n] === 'me' ? '' : order[n] });
    });
  }
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    const th = e.target.closest('th[data-sort]');
    if (th) {
      sortState.dir = sortState.key === th.dataset.sort ? -sortState.dir : th.dataset.sort === 'date' || th.dataset.sort === 'amount' ? -1 : 1;
      sortState.key = th.dataset.sort;
      return ctx.refresh();
    }
    if (!b) return;
    if ('clear' in b.dataset) { savedPick = ''; setF(BLANK); }
    else if (b.dataset.rm) setF(Object.fromEntries(b.dataset.rm.split(',').map((k) => [k, ''])));
    else if (b.dataset.preset) setF({ ...presetRange(b.dataset.preset), m: 'all' });
    else if ('cleardate' in b.dataset) setF({ df: '', dt: '', m: thisMonth() });
    else if (b.dataset.day) setF({ df: b.dataset.day, dt: b.dataset.day, m: 'all' });
    else if ('savef' in b.dataset) {
      const name = await promptDialog({ title: 'Save this filter', label: 'Name', help: 'Saved on this device. Pick it later from "Saved filters".' });
      if (name?.trim()) { await db.setCfg('savedFilters', withSaved(cfg.savedFilters, name, f)); toast('Filter saved'); ctx.refresh(); }
    } else if ('delf' in b.dataset) {
      const s = (cfg.savedFilters || []).find((x) => x.id === saved.value);
      if (s && await confirmDialog(`Delete the saved filter "${s.name}"?`, { okText: 'Delete', danger: true })) { await db.setCfg('savedFilters', withoutSaved(cfg.savedFilters, s.id)); savedPick = ''; ctx.refresh(); }
    }
    else if (b.dataset.w) setF({ w: b.dataset.w === 'me' ? '' : b.dataset.w });
    else if (b.dataset.mnav) setF({ m: addMonths(f.m, Number(b.dataset.mnav)), df: '', dt: '' });
    else if ('allmonths' in b.dataset) setF({ m: f.m === 'all' ? thisMonth() : 'all', df: '', dt: '' });
    else if ('mpick' in b.dataset) { const m = await pickMonth(isMonth ? f.m : thisMonth()); if (m) setF({ m, df: '', dt: '' }); }
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
    const bb = bulkBtn();
    if (bb) { bb.disabled = !selected.size; bb.textContent = selected.size ? `Recategorize (${selected.size})` : 'Recategorize'; }
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
      <td>${esc(cats.pathLabel(t))}</td><td>${esc(t.note)}</td><td>${payIcon(t)} ${esc(tx.accountName(t.accountId))}</td>
      <td class="r num ${t.type}">${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${money(t.amount)}</td>
      <td>${tx.canEdit(t) ? `<a href="#/add?id=${esc(t.id)}" aria-label="Edit">${icon('edit')}</a>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
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
    await tx.updateMany(rows.map((t) => t.id), { categoryId: form.cat.value, subcategoryId: form.sub.value || null });
    s.close();
    toast(`${rows.length} entries updated`);
    ctx.refresh();
  };
}
