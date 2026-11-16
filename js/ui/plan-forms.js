// Full-screen forms for a budget and a savings goal. Built from the same parts as the Add entry screen
// (big amount card with the number pad, category tiles, button rows, date chips) so they look and work the same.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, todayStr, dayLabel, addMonths, thisMonth } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import * as budgets from '../budgets.js';
import * as goals from '../goals.js';
import { $, moneyC, toast, undoToast, empty, evalAmount, openKeypad } from './components.js';
import { icon } from './icons.js';

/** Category + subcategory tiles, as on Add entry. Tap a tile to pick it; tap the picked tile again to change it. */
export function catTiles({ type, catId, subId, title = 'Category', optional = false, invalid = false }) {
  const tree = cats.tree(type);
  const picked = tree.find((x) => x.cat.id === catId);
  const subPicked = picked?.subs.find((x) => x.id === subId);
  return `<div id="cat-block" class="${invalid ? 'invalid' : ''}">
      <div class="card-head"><b>${esc(title)}${optional ? ' <span class="muted small">(optional)</span>' : ''}</b></div>
      <div class="cat-grid ${picked ? 'collapsed' : ''}">
        ${tree.filter(({ cat }) => !picked || cat.id === catId).map(({ cat }) => `<button type="button" class="cat-tile ${cat.id === catId ? 'on' : ''}" data-pcat="${esc(cat.id)}" aria-pressed="${cat.id === catId}"><span class="e">${esc(cat.icon)}</span>${esc(cat.name)}</button>`).join('')}
      </div>
    </div>
    ${picked && picked.subs.length ? `<div><div class="card-head"><b>${esc(picked.cat.name)}: subcategory <span class="muted small">(optional)</span></b></div>
      <div class="cat-grid ${subPicked ? 'collapsed' : ''}">
        ${picked.subs.filter((s) => !subPicked || s.id === subId).map((s) => `<button type="button" class="cat-tile ${s.id === subId ? 'on' : ''}" data-psub="${esc(s.id)}" aria-pressed="${s.id === subId}"><span class="e">${esc(cats.icon(s))}</span>${esc(s.name)}</button>`).join('')}
      </div></div>` : ''}`;
}

/** Handles a click on a tile from catTiles(). Returns true when it was one. */
function tileClick(b, st) {
  if (b.dataset.pcat) { st.categoryId = st.categoryId === b.dataset.pcat ? '' : b.dataset.pcat; st.subcategoryId = ''; return true; }
  if (b.dataset.psub) { st.subcategoryId = st.subcategoryId === b.dataset.psub ? '' : b.dataset.psub; return true; }
  return false;
}

const amountCard = (id, label, value, invalid) => `<label class="card amount-card ${invalid ? 'invalid' : ''}" style="display:block;margin-bottom:0">
    <span class="lbl">${esc(label)}</span>
    <input id="${id}" class="amount-input" inputmode="none" data-keypad autocomplete="off" placeholder="0" value="${esc(value)}" aria-label="${esc(label)} (${esc(cfg.currency || 'INR')})" ${invalid ? 'aria-invalid="true"' : ''}>
  </label>`;

const toAmount = (v) => Math.round((evalAmount(v || '') || 0) * 100) / 100;
// back to the list: Back in history when we came from it (so it keeps its scroll), otherwise open it
const leave = (ctx, list) => ((history.state?.prev || '').replace(/^#\/?/, '').split('?')[0] === list ? history.back() : ctx.go(list));

// ================================================================ budget

export function budgetFormScreen(root, ctx, { hub = false } = {}) {
  const id = ctx.params.get('id');
  const existing = id ? db.get('budgets', id) : null;
  if (id && (!existing || existing.deleted)) { root.innerHTML = empty('That budget no longer exists.'); return; }
  if (existing && !hub && existing.ownerId !== cfg.memberId) { root.innerHTML = empty('This budget is set by the Hub.'); return; }
  const st = existing
    ? { scope: existing.scope, memberId: existing.memberId || cfg.memberId, categoryId: existing.categoryId, subcategoryId: existing.subcategoryId || '', limit: String(existing.limit) }
    : { scope: hub ? 'family' : 'member', memberId: cfg.memberId, categoryId: '', subcategoryId: '', limit: '' };
  let invalid = '';

  // average monthly spend over the last 3 full months, offered as a starting limit
  const avgSpend = () => {
    if (!st.categoryId) return 0;
    const b = { scope: st.scope, memberId: st.memberId, categoryId: st.categoryId, subcategoryId: st.subcategoryId };
    const months = [1, 2, 3].map((i) => addMonths(thisMonth(), -i));
    return Math.round(months.reduce((s, m) => s + budgets.spent(b, m), 0) / 3);
  };

  function draw() {
    const avg = avgSpend();
    const members = tx.members();
    root.innerHTML = `<form id="f" class="stack" novalidate>
      ${hub ? `<div class="seg"><button type="button" data-scope="family" class="${st.scope === 'family' ? 'on' : ''}">${icon('users')} Whole family</button><button type="button" data-scope="member" class="${st.scope === 'member' ? 'on' : ''}">One member</button></div>
        ${st.scope === 'member' ? `<div class="seg">${members.map((m) => `<button type="button" data-mem="${esc(m.id)}" class="${m.id === st.memberId ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>` : ''}` : ''}
      ${amountCard('limit', 'Monthly limit', st.limit, invalid === 'amount')}
      ${avg ? `<div class="chips"><button type="button" data-avg="${avg}" title="Average of the last 3 months">${icon('trend')} Avg ${moneyC(avg)}/month</button></div>` : ''}
      ${catTiles({ type: 'expense', catId: st.categoryId, subId: st.subcategoryId, invalid: invalid === 'category' })}
      <p id="err" class="danger-text small" role="alert">${invalid === 'amount' ? '<span class="vh">Enter a monthly limit</span>' : invalid === 'category' ? '<span class="vh">Pick a category</span>' : ''}</p>
      <button class="btn primary" style="width:100%">${existing ? 'Save changes' : 'Save budget'}</button>
      ${existing ? `<button type="button" class="btn danger" data-delete style="width:100%">Delete budget</button>` : ''}
    </form>`;
  }
  const sync = () => { const l = $('#limit', root); if (l) st.limit = l.value; };

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (tileClick(b, st)) { sync(); if (invalid === 'category') invalid = ''; draw(); }
    else if (b.dataset.scope) { sync(); st.scope = b.dataset.scope; draw(); }
    else if (b.dataset.mem) { sync(); st.memberId = b.dataset.mem; draw(); }
    else if (b.dataset.avg) { st.limit = b.dataset.avg; invalid = ''; draw(); }
    else if ('delete' in b.dataset) {
      await budgets.remove(existing.id);
      undoToast('Budget deleted', async () => { await budgets.restore(existing.id); window.dispatchEvent(new HashChangeEvent('hashchange')); });
      leave(ctx, 'budgets');
    }
  };
  root.onsubmit = async (e) => {
    e.preventDefault();
    sync();
    const limit = toAmount(st.limit);
    invalid = !(limit > 0) ? 'amount' : !st.categoryId ? 'category' : '';
    if (invalid) { draw(); if (invalid === 'amount') $('#limit', root).focus(); return; }
    await budgets.save({ id: existing?.id, scope: st.scope, memberId: st.memberId, categoryId: st.categoryId, subcategoryId: st.subcategoryId, limit });
    toast(existing ? 'Budget updated' : 'Budget saved');
    leave(ctx, 'budgets');
  };
  draw();
  if (!existing) { const a = $('#limit', root); a?.focus({ preventScroll: true }); openKeypad(a); }
}

// ================================================================ savings goal

export function goalFormScreen(root, ctx) {
  const id = ctx.params.get('id');
  const existing = id ? db.get('holdings', id) : null;
  if (id && (!existing || existing.deleted || existing.kind !== 'goal')) { root.innerHTML = empty('That goal no longer exists.'); return; }
  const st = existing
    ? { name: existing.name, target: String(existing.target), saved: existing.saved ? String(existing.saved) : '', targetDate: existing.targetDate || '', categoryId: existing.categoryId || '', subcategoryId: existing.subcategoryId || '', startDate: existing.startDate || todayStr() }
    : { name: '', target: '', saved: '', targetDate: '', categoryId: '', subcategoryId: '', startDate: todayStr() };
  let invalid = '';

  function draw() {
    const linked = st.categoryId ? goals.linkedTotal({ ...st }) : 0;
    const short = (d) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    root.innerHTML = `<form id="f" class="stack" novalidate>
      <label class="field ${invalid === 'name' ? 'invalid' : ''}"><span>Goal</span><input id="gname" maxlength="60" value="${esc(st.name)}" placeholder="Goa trip, emergency fund…" autocomplete="off" ${invalid === 'name' ? 'aria-invalid="true"' : ''}></label>
      ${amountCard('target', 'Target', st.target, invalid === 'amount')}
      ${catTiles({ type: 'expense', catId: st.categoryId, subId: st.subcategoryId, title: 'Fill from entries in', optional: true })}
      ${st.categoryId ? `<div>
        <span class="lbl">Count entries from</span>
        <div class="chips date-chips">
          <label class="datebtn on">${icon('calendar')} ${esc(dayLabel(st.startDate))}<input id="gstart" type="date" value="${esc(st.startDate)}" max="2100-12-31" aria-label="Count entries from this date"></label>
          <span class="muted small num" style="align-self:center">${moneyC(linked)} so far</span>
        </div></div>` : ''}
      <label class="field"><span>${st.categoryId ? 'Saved outside these entries' : 'Already saved'}</span><input id="gsaved" inputmode="none" data-keypad autocomplete="off" placeholder="0" value="${esc(st.saved)}"></label>
      <div>
        <span class="lbl">Reach it by</span>
        <div class="chips date-chips">
          <button type="button" data-nodate class="${st.targetDate ? '' : 'on'}" aria-pressed="${!st.targetDate}">No date</button>
          <label class="datebtn ${st.targetDate ? 'on' : ''}">${icon('calendar')} ${st.targetDate ? esc(short(st.targetDate)) : 'Pick date'}<input id="gdate" type="date" value="${esc(st.targetDate)}" min="${esc(todayStr())}" max="2100-12-31" aria-label="Target date"></label>
        </div>
      </div>
      <p id="err" class="danger-text small" role="alert">${invalid === 'amount' ? '<span class="vh">Enter a target</span>' : invalid === 'name' ? '<span class="vh">Name the goal</span>' : ''}</p>
      <button class="btn primary" style="width:100%">${existing ? 'Save changes' : 'Save goal'}</button>
      ${existing ? `<button type="button" class="btn danger" data-delete style="width:100%">Delete goal</button>` : ''}
    </form>`;
    for (const [sel, key] of [['#gstart', 'startDate'], ['#gdate', 'targetDate']]) {
      const el = $(sel, root);
      if (!el) continue;
      el.onclick = () => { try { el.showPicker?.(); } catch { /* ignore */ } };
      el.onchange = () => { sync(); st[key] = el.value || (key === 'startDate' ? todayStr() : ''); draw(); };
    }
  }
  const sync = () => {
    const v = (s) => $(s, root)?.value;
    st.name = v('#gname') ?? st.name; st.target = v('#target') ?? st.target; st.saved = v('#gsaved') ?? st.saved;
  };

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (tileClick(b, st)) { sync(); draw(); }
    else if ('nodate' in b.dataset) { sync(); st.targetDate = ''; draw(); }
    else if ('delete' in b.dataset) {
      await goals.remove(existing.id);
      undoToast('Goal deleted', async () => { await goals.restore(existing.id); window.dispatchEvent(new HashChangeEvent('hashchange')); });
      leave(ctx, 'goals');
    }
  };
  root.oninput = (e) => { if (invalid && (e.target.id === 'gname' || e.target.id === 'target')) { invalid = ''; e.target.closest('.invalid')?.classList.remove('invalid'); } };
  root.onsubmit = async (e) => {
    e.preventDefault();
    sync();
    const target = toAmount(st.target);
    invalid = !st.name.trim() ? 'name' : !(target > 0) ? 'amount' : '';
    if (invalid) { draw(); $(invalid === 'name' ? '#gname' : '#target', root).focus(); return; }
    const data = { name: st.name.trim(), target, saved: toAmount(st.saved), targetDate: st.targetDate, categoryId: st.categoryId, subcategoryId: st.subcategoryId, startDate: st.startDate };
    if (existing) await goals.update(existing.id, data);
    else await goals.create(data);
    toast(existing ? 'Goal updated' : 'Goal saved');
    leave(ctx, 'goals');
  };
  draw();
  if (!existing) $('#gname', root)?.focus({ preventScroll: true });
}

