// Balances: banks, cash and credit cards for VJ and MM (ported from Expense.html).

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, FAMILY, otherMember, localDate } from '../models.js';
import * as H from '../holdings.js';
import * as tx from '../transactions.js';
import { onSwipe, $, $$, money, toast, confirmDialog, pickDialog, pickFiles, shareOrDownload, download, empty } from './components.js';

const person = (id) => FAMILY.find((f) => f.id === id) || { id, name: '?', color: '#64748b' };
const pbadge = (id) => { const p = person(id); return `<span class="pbadge" style="--c:${esc(p.color)}">${esc(p.name)}</span>`; };

const plain = (n) => (n == null ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const toNum = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
function sanitize(v) {
  v = v.replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  v = v.replace(/^0+(?=\d)/, '');
  if (v.startsWith('.')) v = '0' + v;
  return v.slice(0, 13);
}
const moneyInput = (field, id, val, label, extra = '') => `<label class="money"><span class="vh">${esc(label)}</span><span class="cur">₹</span>
  <input class="money-in" type="text" inputmode="decimal" autocomplete="off" placeholder="0" data-f="${field}" ${id ? `data-id="${esc(id)}"` : ''} value="${plain(val)}" ${extra}></label>`;

// The balance your entries say (Online + Cash from the transactions), shown in brackets beside what the banks / cash really hold.
const hasEntries = () => db.live('transactions').length > 0;
const byEntries = (n) => (hasEntries() ? ` <span class="by-entries num" title="As per entries">(${money(n)})</span>` : '');
const entriesNote = () => (hasEntries() ? '<p class="muted small" style="margin:0 4px 10px">Amounts in (brackets) are the balance as per your entries, to compare with what is really there.</p>' : '');
const famEntries = (kind) => FAMILY.reduce((t, f) => t + tx.inHand(f.id)[kind], 0);

const ago = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

// ---------------------------------------------------------------- summary card (used on Home / Dashboard)

export function positionCard() {
  const r = H.position();
  if (!H.live().length) {
    return `<a class="card" href="#/position" style="display:block;text-decoration:none;color:inherit"><div class="card-head"><h2>Money position</h2><span class="small">Set up ›</span></div><p class="muted small">Add your banks, cash and credit cards to see what you really have and who needs to pay what.</p></a>`;
  }
  const st = r.shortage == null ? '' : r.shortage === 0 ? '<span class="chip">Balanced ✓</span>' : r.shortage < 0 ? `<span class="chip" style="--c:var(--danger)">Short ${money(-r.shortage)}</span>` : `<span class="chip" style="--c:var(--warn)">Excess ${money(r.shortage)}</span>`;
  return `<a class="card" href="#/position" style="display:block;text-decoration:none;color:inherit">
    <div class="card-head"><h2>Money position</h2>${st}</div>
    <div class="stat" style="padding:0"><div class="label">Actual balance (usable + cash − cards)</div><div class="value">${money(r.actual)}</div></div>
    <div class="row between small" style="margin-top:8px">${r.people.map((p) => `<span>${pbadge(p.id)} <b class="num">${money(p.net)}</b>${p.ccToPay ? ` <span class="muted">· pays ${money(p.ccToPay)}</span>` : ''}</span>`).join('')}</div></a>`;
}

// ---------------------------------------------------------------- main screen

let tab = 'overview';

export async function positionScreen(root, ctx) {
  tab = ctx.params.get('s') || tab;
  const body = { overview, banks, cash, cards }[tab] || overview;
  root.innerHTML = `
    <div class="seg" style="margin-bottom:14px">${[['overview', 'Overview'], ['banks', 'Banks'], ['cash', 'Cash'], ['cards', 'Cards']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pos-body"></div>`;
  const box = $('#pos-body', root);
  body(box, ctx);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    history.replaceState(null, '', `#/position?s=${tab}`);
    ctx.refresh();
  });
  wireMoneyInputs(root);

  // swipe left / right to move between Overview, Banks, Cash and Cards
  const order = ['overview', 'banks', 'cash', 'cards'];
  onSwipe(root, (dir) => {
    const n = order.indexOf(tab) + (dir === 'next' ? 1 : -1);
    if (n < 0 || n >= order.length) return false;
    tab = order[n];
    history.replaceState(null, '', `#/position?s=${tab}`);
    ctx.refresh();
  });
}

// live-updating numbers without re-rendering the inputs (keeps focus while you type)
function refreshBindings(root) {
  const r = H.position();
  const val = (path) => path.split('.').reduce((o, k) => o?.[k], r);
  $$('[data-bind]', root).forEach((el) => {
    const k = el.dataset.bind;
    if (k.startsWith('usable-')) { const b = db.get('holdings', k.slice(7)); el.textContent = money(b ? H.usable(b) : 0); }
    else if (k.startsWith('person-cash-')) el.textContent = money(r.people.find((p) => p.id === k.slice(12))?.cash);
    else el.textContent = money(val(k));
  });
}

function wireMoneyInputs(root) {
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.classList.contains('money-in')) return;
    const caret = el.selectionStart ?? el.value.length;
    const before = sanitize(el.value.slice(0, caret)).length;
    const clean = sanitize(el.value);
    if (clean !== el.value) { el.value = clean; try { el.setSelectionRange(before, before); } catch { /* ignore */ } }
  });
  root.addEventListener('focusin', (e) => { if (e.target.classList?.contains('money-in')) e.target.value = e.target.value.replace(/,/g, ''); });
  root.addEventListener('focusout', (e) => { if (e.target.classList?.contains('money-in')) e.target.value = plain(toNum(e.target.value)); });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.closest('form')) return;
    e.preventDefault();
    const inputs = $$('#pos-body input:not([type=file])', root);
    const next = inputs[inputs.indexOf(e.target) + 1];
    next ? next.focus() : e.target.blur();
  });
}

// persist a field edit: <input data-f="bank.balance" data-id="...">
async function onFieldChange(e, root) {
  const el = e.target;
  const f = el.dataset.f;
  if (!f) return;
  const id = el.dataset.id;
  const num = el.classList.contains('money-in') ? toNum(el.value) : null;
  if (f === 'bank.name') await H.update(id, { name: el.value.trim() });
  else if (f === 'bank.balance') await H.update(id, { balance: num });
  else if (f === 'bank.cc') await H.update(id, { cc: num });
  else if (f === 'bank.payer') await H.update(id, { ccPayer: el.value });
  else if (f === 'cash.amount') await H.update(id, { amount: num });
  else if (f === 'cash.note') await H.update(id, { note: el.value.trim() });
  else if (f === 'expected') await H.setMeta({ expected: num });
  else if (f === 'transfer') await H.setMeta({ transfer: num });
  else if (f === 'transferPerson') await H.setMeta({ transferPerson: el.value });
  else if (f === 'minBalance') { await db.setCfg('minBalance', num ?? 0); }
  else return;
  refreshBindings(root);
  if (f === 'bank.payer' || f === 'minBalance' || f === 'transferPerson') refreshAll(root);
}
const refreshAll = (root) => root.dispatchEvent(new CustomEvent('pos-refresh', { bubbles: true }));

function listen(box, ctx) {
  box.addEventListener('change', (e) => onFieldChange(e, box));
  box.addEventListener('pos-refresh', () => ctx.refresh());
  box.addEventListener('input', () => refreshBindings(box), { passive: true });
}

// ---------------------------------------------------------------- overview

function overview(box, ctx) {
  const r = H.position();
  const net = tx.netVjToMm();
  const st = r.expected == null ? ['none', 'Add your entries to compare', 'The balance in hand comes from your entries']
    : r.shortage === 0 ? ['ok', 'Balanced', 'Actual balance matches your entries']
    : r.shortage < 0 ? ['short', `Short by ${money(-r.shortage)}`, 'Actual balance is less than your entries say']
    : ['excess', `Excess of ${money(r.shortage)}`, 'Actual balance is more than your entries say'];
  const cards = H.banks().filter((b) => b.cc);

  box.innerHTML = `
    <div class="hero"><div class="k">Actual balance</div><div class="v num"><span data-bind="actual">${money(r.actual)}</span>${byEntries(tx.inHandAll())}</div>
      <div class="eq num"><span>Usable <b data-bind="usableTotal">${money(r.usableTotal)}</b></span><span>+ Cash <b data-bind="cash">${money(r.cash)}</b></span><span>− Cards <b data-bind="cc">${money(r.cc)}</b></span></div></div>
    <div class="status ${st[0]}"><b class="num">${st[1]}</b><small>${st[2]}</small></div>
    ${r.expected != null ? `<p class="muted small" style="margin:8px 4px 0">Compared with <b class="num">${money(r.expected)}</b>, the Balance in hand from your entries (see the Summary page).</p>` : ''}

    <h2 class="sec">Who has what</h2>
    <div class="grid two">${r.people.map((p, i) => `
      <div class="card"><div class="card-head">${pbadge(p.id)}</div>
        <div class="stat" style="padding:0"><div class="label">Balance after cards &amp; transfer, plus cash</div><div class="value"><span data-bind="people.${i}.net">${money(p.net)}</span>${byEntries(tx.inHand(p.id).total)}</div></div>
        <div class="list" style="margin-top:8px">
          <div class="row between small" style="padding:6px 0"><span>Banks (usable)</span><span><span class="num" data-bind="people.${i}.usableTotal">${money(p.usableTotal)}</span>${byEntries(tx.inHand(p.id).online)}</span></div>
          <div class="row between small" style="padding:6px 0"><span>Cash</span><span><span class="num" data-bind="people.${i}.cash">${money(p.cash)}</span>${byEntries(tx.inHand(p.id).cash)}</span></div>
          <div class="row between small" style="padding:6px 0"><span>Cards to pay</span><span class="num expense" data-bind="people.${i}.ccToPay">${money(p.ccToPay)}</span></div>
          ${p.transfer ? `<div class="row between small" style="padding:6px 0"><span>Transfer deducted</span><span class="num expense">${money(p.transfer)}</span></div>` : ''}
        </div></div>`).join('')}</div>
    <div class="card"><div class="row between"><b>Total (VJ + MM)</b><span><b class="num" data-bind="total">${money(r.total)}</b>${byEntries(tx.inHandAll())}</span></div></div>
    ${entriesNote()}

    <h2 class="sec">Cards: who needs to pay</h2>
    <div class="card">${cards.length ? `<div class="list">${cards.map((b) => `<div class="list-item"><span class="main"><span class="title">${esc(b.name || 'Bank')} card</span><span class="sub">${pbadge(b.person)} account</span></span>
      <span class="num expense">${money(b.cc)}</span><span>${pbadge(b.ccPayer || b.person)} pays</span></div>`).join('')}</div><p class="muted small"><a href="#/position?s=cards">Edit cards</a></p>` : '<p class="muted">No credit card pending. Add it on the <a href="#/position?s=cards">Cards</a> tab.</p>'}</div>

    <h2 class="sec">Between VJ and MM</h2>
    <div class="card"><p>${net === 0 ? 'No money transferred between you two yet.' : net > 0 ? `<b>VJ</b> has transferred <b class="num">${money(net)}</b> more to <b>MM</b> than received.` : `<b>MM</b> has transferred <b class="num">${money(-net)}</b> more to <b>VJ</b> than received.`}</p>
      <p class="muted small">Based on the transfers recorded on this device${cfg.mode === 'hub' ? '' : ' (the Hub has the complete picture)'}.</p>
      <a class="btn small" href="#/add?type=transfer">＋ Record a transfer</a></div>

    <h2 class="sec">Share</h2>
    <div class="row"><button class="btn primary" data-share="summary">Share summary</button></div>`;

  listen(box, ctx);
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.share === 'summary') {
        const text = H.summaryText(money);
        if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Summary copied'); }
      }
    } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
  });
}

// ---------------------------------------------------------------- banks

function banks(box, ctx) {
  const r = H.position();
  box.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="chip">Balance <b class="num" data-bind="bankTotal">${money(r.bankTotal)}</b>${byEntries(famEntries('online'))}</span><span class="chip">Usable <b class="num" data-bind="usableTotal">${money(r.usableTotal)}</b></span></div>
    ${entriesNote()}
    ${FAMILY.map((f, pi) => `<h2 class="sec">${pbadge(f.id)} ${esc(f.name)}'s banks <span class="muted small num" data-bind="people.${pi}.bankTotal">${money(r.people[pi].bankTotal)}</span>${byEntries(tx.inHand(f.id).online)}</h2>
      ${H.banks(f.id).map((b, i, arr) => `<div class="card">
        <div class="row" style="flex-wrap:nowrap"><input class="name-input" data-f="bank.name" data-id="${esc(b.id)}" value="${esc(b.name)}" placeholder="Bank name" maxlength="24" aria-label="Bank name" autocomplete="off">
          <button class="icon-btn" data-move="-1" data-id="${esc(b.id)}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-move="1" data-id="${esc(b.id)}" aria-label="Move down" ${i === arr.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn" data-del="${esc(b.id)}" aria-label="Remove ${esc(b.name || 'bank')}">✕</button></div>
        ${moneyInput('bank.balance', b.id, b.balance, `${b.name || 'Bank'} balance`)}
        <div class="row between small" style="margin-top:6px"><span class="muted">Usable (after minimum)</span><b class="num" data-bind="usable-${esc(b.id)}">${money(H.usable(b))}</b></div></div>`).join('') || '<p class="muted">No banks yet.</p>'}
      <button class="btn" style="width:100%" data-addbank="${esc(f.id)}" ${H.banks(f.id).length >= H.MAX_ROWS ? 'disabled' : ''}>＋ Add bank for ${esc(f.name)}</button>`).join('')}
    <div class="card" style="margin-top:14px"><span class="lbl">Keep this much in every bank (not counted as usable)</span>${moneyInput('minBalance', null, H.minBalance(), 'Minimum balance')}</div>
    <p class="muted small">Each bank counts toward its owner. Card pending is on the Cards tab.</p>`;
  listen(box, ctx);
  box.addEventListener('click', (e) => rowActions(e, ctx, 'bank'));
}

// ---------------------------------------------------------------- cash

function cash(box, ctx) {
  const r = H.position();
  box.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="chip">Total cash <b class="num" data-bind="cash">${money(r.cash)}</b>${byEntries(famEntries('cash'))}</span></div>
    ${entriesNote()}
    ${FAMILY.map((f, pi) => `<h2 class="sec">${pbadge(f.id)} ${esc(f.name)}'s cash <span class="muted small num" data-bind="person-cash-${esc(f.id)}">${money(r.people[pi].cash)}</span>${byEntries(tx.inHand(f.id).cash)}</h2>
      <form class="row" data-quick="${esc(f.id)}" style="flex-wrap:nowrap;margin-bottom:8px">
        ${moneyInput('quick', null, null, 'New cash amount')}<input name="note" placeholder="Note (optional)" maxlength="30" aria-label="Note" style="max-width:40%">
        <button class="btn primary" ${H.cashEntries(f.id).length >= H.MAX_ROWS ? 'disabled' : ''}>＋</button></form>
      <div class="card list" style="padding:0 12px">${H.cashEntries(f.id).map((c) => `<div class="list-item" style="gap:8px">
        ${moneyInput('cash.amount', c.id, c.amount, 'Cash amount')}<input class="name-input" data-f="cash.note" data-id="${esc(c.id)}" value="${esc(c.note || '')}" placeholder="Note" maxlength="30" aria-label="Note" style="max-width:38%">
        <button class="icon-btn" data-del="${esc(c.id)}" aria-label="Remove">✕</button></div>`).join('') || '<p class="muted small" style="padding:10px 0">No cash entries.</p>'}</div>`).join('')}`;
  listen(box, ctx);
  box.addEventListener('click', (e) => rowActions(e, ctx, 'cash'));
  box.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-quick]');
    if (!f) return;
    e.preventDefault();
    const n = toNum($('.money-in', f).value);
    if (!n) return toast('Enter an amount');
    try { await H.addCash(f.dataset.quick, n, f.note.value.trim()); toast(`Added ${money(n)}`); ctx.refresh(); } catch (err) { toast(err.message); }
  });
}

// ---------------------------------------------------------------- cards

function cards(box, ctx) {
  const r = H.position();
  const all = H.banks();
  box.innerHTML = `
    <div class="row" style="margin-bottom:12px"><span class="chip">Total pending <b class="num" data-bind="cc">${money(r.cc)}</b></span>
      ${r.people.map((p, i) => `<span class="chip">${esc(p.name)} pays <b class="num" data-bind="people.${i}.ccToPay">${money(p.ccToPay)}</b></span>`).join('')}</div>
    ${all.length ? all.map((b) => `<div class="card"><div class="row between"><b>${esc(b.name || 'Bank')} card</b><span class="muted small">${pbadge(b.person)} account</span></div>
      ${moneyInput('bank.cc', b.id, b.cc, `${b.name || 'Bank'} card pending`)}
      <label class="field" style="margin-top:8px"><span>Who needs to pay this card</span><select data-f="bank.payer" data-id="${esc(b.id)}">${FAMILY.map((f) => `<option value="${esc(f.id)}" ${(b.ccPayer || b.person) === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label></div>`).join('')
      : empty('Add a bank first', 'Cards sit on a bank row.')}
    <p class="muted small">A card that isn't linked to a bank? Add it as a bank (Banks tab) with the balance left empty.</p>`;
  listen(box, ctx);
}

// ---------------------------------------------------------------- shared row actions

async function rowActions(e, ctx) {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  try {
    if (d.move) { await H.move(d.id, Number(d.move)); ctx.refresh(); }
    else if (d.addbank) { await H.addBank(d.addbank); ctx.refresh(); setTimeout(() => { const names = $$('.name-input', document); names.filter((n) => !n.value).pop()?.focus(); }, 50); }
    else if (d.del) {
      const h = db.get('holdings', d.del);
      await H.remove(d.del);
      ctx.refresh();
      toast(`Removed ${h.kind === 'bank' ? h.name || 'bank' : money(h.amount)}`, { action: 'Undo', onAction: async () => { await H.restore(d.del); ctx.refresh(); } });
    }
  } catch (err) { toast(err.message); }
}
