// The add / edit entry form.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, otherMember, localDate, todayStr, dayLabel, FREQUENCIES, uid } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import * as recurring from '../recurring.js';
import * as budgets from '../budgets.js';
import { $, $$, toast, undoToast, promptDialog, sheet, empty, evalAmount, money, openKeypad } from './components.js';
import { icon } from './icons.js';

const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return localDate(d); };

export async function entryScreen(root, ctx) {
  const id = ctx.params.get('id');
  const existing = id ? db.get('transactions', id) : null;
  if (id && (!existing || existing.deleted)) { root.innerHTML = empty('That entry no longer exists.'); return; }
  if (existing && !tx.canEdit(existing)) { root.innerHTML = empty('You can only edit your own entries.'); return; }

  const accounts = tx.formAccounts(existing?.accountId);
  const st = existing
    ? { ...existing, amount: String(existing.amount), repeat: '', xfer: existing.toMemberId ? 'member' : 'own', direction: existing.direction || 'out' }
    : {
        type: ctx.params.get('type') || 'expense', amount: '', date: /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.get('date') || '') ? ctx.params.get('date') : todayStr(), categoryId: null, subcategoryId: null,
        accountId: accounts[0]?.id || null, toAccountId: null,
        note: '', repeat: '', xfer: 'own', direction: 'out', split: null, // split: [{ cat: 'c:id' | 's:id' | '', amount }] when one bill is divided across categories
      };
  const last = existing ? null : tx.lastEntry();
  const lastLabel = () => last && `${(last.subcategoryId && cats.name(last.subcategoryId)) || cats.name(last.categoryId) || 'Entry'} · ${money(last.amount)}`;

  // earlier notes for the browser's autofill on the Note field, most used first
  const noteCounts = new Map();
  for (const t of db.live('transactions')) {
    const n = (t.note || '').trim();
    if (!n) continue;
    const k = n.toLowerCase();
    const cur = noteCounts.get(k);
    noteCounts.set(k, { text: cur?.text || n, count: (cur?.count || 0) + 1 });
  }
  const noteOptions = [...noteCounts.values()].sort((a, b) => b.count - a.count).slice(0, 500)
    .map((x) => `<option value="${esc(x.text)}"></option>`).join('');

  // ---- split one bill across categories: each line becomes its own entry, tied together by a shared splitId
  const splitOptions = (selected) => `<option value="">Category…</option>` + cats.tree(st.type, { includeArchived: false }).map(({ cat, subs }) =>
    `<option value="c:${esc(cat.id)}" ${selected === `c:${cat.id}` ? 'selected' : ''}>${esc(cat.icon)} ${esc(cat.name)}</option>` +
    subs.map((s) => `<option value="s:${esc(s.id)}" ${selected === `s:${s.id}` ? 'selected' : ''}>&nbsp;&nbsp;– ${esc(s.name)}</option>`).join('')).join('');
  const splitTotal = () => st.split.reduce((s, l) => s + (evalAmount(l.amount) || 0), 0);
  const splitHTML = () => `<div class="stack" id="split-lines">
      <div class="card-head"><b>Split across categories</b></div>
      ${st.split.map((l, i) => `<div class="row" style="flex-wrap:nowrap">
        <select data-sl-cat="${i}" class="grow" aria-label="Category for line ${i + 1}">${splitOptions(l.cat)}</select>
        <input data-sl-amt="${i}" data-keypad inputmode="none" autocomplete="off" placeholder="0" value="${esc(l.amount)}" aria-label="Amount for line ${i + 1}" style="max-width:120px">
        ${st.split.length > 2 ? `<button type="button" class="btn small" data-sl-del="${i}" aria-label="Remove line ${i + 1}">${icon('close')}</button>` : ''}
      </div>`).join('')}
      <div class="row between"><button type="button" class="btn small" data-sl-add>${icon('plus')} Add line</button><b>Total <span class="num" id="split-total">${money(splitTotal())}</span></b></div>
    </div>`;
  const lineCategory = (v) => (v?.startsWith('s:') ? { categoryId: db.get('categories', v.slice(2))?.parentId || null, subcategoryId: v.slice(2) } : v?.startsWith('c:') ? { categoryId: v.slice(2), subcategoryId: null } : { categoryId: null, subcategoryId: null });

  let invalid = ''; // 'amount' | 'category': outlined in red until fixed (no extra text on screen)
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
    const subPicked = picked?.subs.find((x) => x.id === st.subcategoryId);
    const archivedSub = existing && picked && st.subcategoryId && !subPicked ? cats.get(st.subcategoryId) : null;
    root.innerHTML = `
      <form id="f" class="stack" novalidate>
        <div class="seg" role="tablist">
          ${['expense', 'income', 'transfer'].map((t) => `<button type="button" role="tab" aria-selected="${st.type === t}" data-type="${t}" class="${st.type === t ? 'on' : ''} ${t}-t">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
        ${isT ? `<div class="row" style="flex-wrap:nowrap;gap:6px"><div class="seg grow"><button type="button" data-xfer="own" class="${mT ? '' : 'on'}">My accounts</button><button type="button" data-xfer="member" class="${mT ? 'on' : ''}">With ${esc(other.name)}</button></div>
          <button type="button" class="icon-btn" data-xinfo aria-label="How transfers with ${esc(other.name)} work" style="color:var(--muted)">${icon('info')}</button></div>
        ${mT ? `<div class="seg"><button type="button" data-dir="out" class="${st.direction === 'in' ? '' : 'on'}">${icon('arrowUp')} I paid ${esc(other.name)}</button><button type="button" data-dir="in" class="${st.direction === 'in' ? 'on' : ''}">${icon('arrowDown')} ${esc(other.name)} paid me</button></div>` : ''}` : ''}
        ${st.split && !isT ? '' : `<label class="card amount-card ${st.type}-t ${invalid === 'amount' ? 'invalid' : ''}" style="display:block;margin-bottom:0">
          <span class="lbl">Amount</span>
          <input id="amount" class="amount-input" inputmode="none" data-keypad autocomplete="off" placeholder="0" value="${esc(st.amount)}" aria-label="Amount (${esc(cfg.currency || 'INR')})" ${invalid === 'amount' ? 'aria-invalid="true"' : ''}>
        </label>`}
        ${isT ? '' : st.split ? splitHTML() : `
        <div id="cat-block" class="${invalid === 'category' ? 'invalid' : ''}">
          <div class="card-head"><b>Category</b>${picked || archivedPick ? '' : `<button type="button" class="btn small ghost" data-newcat>${icon('plus')} New</button>`}</div>
          <div class="cat-grid ${picked || archivedPick ? 'collapsed' : ''}">
            ${archivedPick ? `<button type="button" class="cat-tile on" disabled><span class="e">${esc(archivedPick.icon)}</span>${esc(archivedPick.name)} (archived)</button>` : ''}
            ${tree.filter(({ cat }) => !picked || cat.id === st.categoryId).map(({ cat }) => `<button type="button" class="cat-tile ${cat.id === st.categoryId ? 'on' : ''}" data-cat="${esc(cat.id)}" ${cat.id === st.categoryId ? 'aria-pressed="true"' : ''}><span class="e">${esc(cat.icon)}</span>${esc(cat.name)}</button>`).join('')}
          </div>
        </div>
        ${picked ? `<div><div class="card-head"><b>${esc(picked.cat.name)}: subcategory <span class="muted small">(optional)</span></b>${subPicked || archivedSub ? '' : `<button type="button" class="btn small ghost" data-newsub>${icon('plus')} New</button>`}</div>
          ${picked.subs.length || archivedSub ? `<div class="cat-grid ${subPicked || archivedSub ? 'collapsed' : ''}">
            ${archivedSub ? `<button type="button" class="cat-tile on" disabled><span class="e">${esc(cats.icon(archivedSub))}</span>${esc(archivedSub.name)} (archived)</button>` : ''}
            ${picked.subs.filter((s) => !subPicked || s.id === st.subcategoryId).map((s) => `<button type="button" class="cat-tile ${s.id === st.subcategoryId ? 'on' : ''}" data-sub="${esc(s.id)}" ${s.id === st.subcategoryId ? 'aria-pressed="true"' : ''}><span class="e">${esc(cats.icon(s))}</span>${esc(s.name)}</button>`).join('')}
          </div>` : '<span class="muted small">No subcategories yet.</span>'}</div>` : ''}`}
        <div>
          <span class="lbl">${mT ? (st.direction === 'in' ? 'Received into' : 'Paid from') : isT ? 'Move money' : st.type === 'income' ? 'Received into' : 'Paid from'}</span>
          ${isT && !mT ? `<div class="seg">${[[accounts[0], accounts[1]], [accounts[1], accounts[0]]].map(([f, to]) => `<button type="button" data-xdir="${esc(f.id)}|${esc(to.id)}" class="${st.accountId === f.id ? 'on' : ''}">${esc(f.name)} → ${esc(to.name)}</button>`).join('')}</div>`
            : `<div class="seg">${accounts.map((a) => `<button type="button" data-acc="${esc(a.id)}" class="${a.id === st.accountId ? 'on' : ''}">${esc(a.name)}</button>`).join('')}</div>`}
        </div>
        <div>
          <span class="lbl">Date</span>
          <div class="chips date-chips">
            <button type="button" data-date="${esc(todayStr())}" class="${st.date === todayStr() ? 'on' : ''}">Today</button>
            <button type="button" data-date="${esc(yesterday())}" class="${st.date === yesterday() ? 'on' : ''}">Yesterday</button>
            <label class="datebtn ${st.date !== todayStr() && st.date !== yesterday() ? 'on' : ''}">${icon('calendar')} ${st.date === todayStr() || st.date === yesterday() ? 'Pick date' : esc(dayLabel(st.date))}<input id="date" type="date" value="${esc(st.date)}" max="2100-12-31" aria-label="Pick a date"></label>
          </div>
        </div>
        <label class="field"><span>Note</span><input id="note" maxlength="200" value="${esc(st.note)}" list="note-list" autocomplete="off"></label>
        <datalist id="note-list">${noteOptions}</datalist>
        ${existing || isT || st.split ? '' : `<label class="field"><span>Repeat</span>
          <select id="repeat"><option value="">Does not repeat</option>${FREQUENCIES.map(([v, l]) => `<option value="${v}" ${v === st.repeat ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
        ${(last && !isT && !st.split && !st.amount) || !(isT || existing) ? `<div class="row">
          ${last && !isT && !st.split && !st.amount ? `<button type="button" class="btn small ghost" data-repeat title="Fill this form like your last entry: ${esc(lastLabel())}">${icon('repeat')} Repeat last</button>` : ''}
          ${isT || existing ? '' : `<button type="button" class="btn small ghost" data-split>${st.split ? `${icon('back')} One category` : `${icon('scissors')} Split`}</button>`}
        </div>` : ''}
        <p id="err" class="danger-text small" role="alert">${invalid === 'amount' ? '<span class="vh">Enter an amount</span>' : invalid === 'category' ? '<span class="vh">Pick a category</span>' : ''}</p>
        <div class="row">
          ${existing ? '' : '<button type="button" class="btn grow" data-again>Save &amp; add another</button>'}
          <button class="btn primary grow" data-save>${existing ? 'Save changes' : 'Save'}</button>
        </div>
        ${existing?.splitId ? '<p class="muted small">This entry is one part of a split bill. Edit or delete each part on its own.</p>' : ''}
        ${existing ? '<button type="button" class="btn danger" data-delete style="width:100%">Delete entry</button>' : ''}
      </form>`;
    bind();
  }

  function sync() {
    const g = (s) => $(s, root);
    if (g('#amount')) st.amount = g('#amount').value;
    if (g('#date')) st.date = g('#date').value;
    if (g('#repeat')) st.repeat = g('#repeat').value;
    if (g('#note')) st.note = g('#note').value;
    if (st.split) {
      $$('[data-sl-cat]', root).forEach((el) => { st.split[+el.dataset.slCat].cat = el.value; });
      $$('[data-sl-amt]', root).forEach((el) => { st.split[+el.dataset.slAmt].amount = el.value; });
    }
  }

  async function saveSplit(again) {
    const err = $('#err', root);
    const lines = st.split.map((l) => ({ ...lineCategory(l.cat), amount: Math.round((evalAmount(l.amount) || 0) * 100) / 100 }));
    if (lines.some((l) => !l.categoryId)) { err.textContent = 'Choose a category for every line.'; return; }
    if (lines.some((l) => !(l.amount > 0))) { err.textContent = 'Every line needs an amount greater than zero.'; return; }
    if (!st.date) { err.textContent = 'Pick a date.'; return; }
    const before = st.type === 'expense' ? budgets.snapshot() : null;
    const splitId = uid();
    const common = { type: st.type, date: st.date, note: st.note.trim(), accountId: st.accountId, paymentMode: db.get('accounts', st.accountId)?.type === 'cash' ? 'cash' : 'online', splitId };
    await db.putMany('transactions', lines.map((l) => tx.make({ ...common, ...l }))); // all the parts in one write: never half a split
    afterSave(again, `Saved in ${lines.length} parts`, before);
  }

  function afterSave(again, msg, before) {
    const warn = before ? budgets.crossings(before)[0] : '';
    toast(msg + (warn ? `. ${warn}` : ''), warn ? { timeout: 6000 } : {});
    if (again) {
      Object.assign(st, { amount: '', note: '', repeat: '', subcategoryId: null, split: st.split ? st.split.map(() => ({ cat: '', amount: '' })) : null });
      draw();
      window.scrollTo({ top: 0, behavior: 'smooth' }); // ready for the next category
      { const a = $('#amount', root); a?.focus({ preventScroll: true }); openKeypad(a); }
    } else (existing || ctx.params.get('date')) && history.length > 1 ? history.back() : ctx.go('transactions');
  }

  async function save(again) {
    sync();
    if (st.split && st.type !== 'transfer') return saveSplit(again);
    const err = $('#err', root);
    invalid = '';
    const amount = Math.round(evalAmount(st.amount) * 100) / 100;
    if (!(amount > 0)) { invalid = 'amount'; draw(); $('#amount', root).focus(); return; }
    if (!st.date) { err.textContent = 'Pick a date.'; return; }
    if (st.type === 'transfer') {
      if (!st.accountId || (st.xfer !== 'member' && !st.toAccountId)) { err.textContent = st.xfer === 'member' ? 'Choose your account.' : 'Choose both accounts for a transfer.'; return; }
    } else if (!st.categoryId) {
      invalid = 'category'; draw();
      $('#cat-block', root)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    const data = {
      type: st.type, amount, date: st.date, note: st.note.trim(), paymentMode: db.get('accounts', st.accountId)?.type === 'cash' ? 'cash' : 'online',
      categoryId: st.type === 'transfer' ? null : st.categoryId, subcategoryId: st.type === 'transfer' ? null : st.subcategoryId,
      accountId: st.accountId, toAccountId: st.type === 'transfer' && st.xfer !== 'member' ? st.toAccountId : null,
      toMemberId: st.type === 'transfer' && st.xfer === 'member' ? otherMember(cfg.memberId).id : null,
      direction: st.type === 'transfer' && st.xfer === 'member' ? st.direction : null,
    };
    const before = data.type === 'expense' ? budgets.snapshot() : null;
    if (existing) await tx.update(existing.id, data);
    else {
      await tx.add(data);
      if (st.repeat) {
        await recurring.create(data, st.repeat, recurring.nextDate(st.date, st.repeat));
      }
    }
    afterSave(again, existing ? 'Entry updated' : 'Saved', before);
  }

  function bind() {
    root.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.type) { sync(); st.type = b.dataset.type; st.categoryId = null; st.subcategoryId = null; if (st.split) st.split.forEach((l) => { l.cat = ''; }); draw(); }
      else if ('repeat' in b.dataset) {
        sync();
        const acc = accounts.some((a) => a.id === last.accountId) ? last.accountId : st.accountId;
        Object.assign(st, { type: last.type, categoryId: last.categoryId, subcategoryId: last.subcategoryId, accountId: acc, amount: String(last.amount), note: last.note || '' });
        draw();
        $('#amount', root)?.focus();
      } else if ('split' in b.dataset) {
        sync();
        st.split = st.split ? null : [{ cat: st.subcategoryId ? `s:${st.subcategoryId}` : st.categoryId ? `c:${st.categoryId}` : '', amount: st.amount }, { cat: '', amount: '' }];
        draw();
      } else if ('slAdd' in b.dataset) { sync(); st.split.push({ cat: '', amount: '' }); draw(); }
      else if (b.dataset.slDel) { sync(); st.split.splice(+b.dataset.slDel, 1); draw(); }
      else if (b.dataset.acc) { sync(); st.accountId = b.dataset.acc; draw(); }
      else if (b.dataset.xdir) { sync(); [st.accountId, st.toAccountId] = b.dataset.xdir.split('|'); draw(); }
      else if (b.dataset.date) { sync(); st.date = b.dataset.date; draw(); }
      else if (b.dataset.xfer) { sync(); st.xfer = b.dataset.xfer; draw(); }
      else if (b.dataset.dir) { sync(); st.direction = b.dataset.dir; draw(); }
      else if ('xinfo' in b.dataset) {
        const o = esc(otherMember(cfg.memberId).name);
        sheet(`Transfers with ${otherMember(cfg.memberId).name}`, `<ul style="margin:0 0 8px;padding-left:20px;line-height:1.6">
          <li>Record it once: ${o}'s balance updates automatically.</li>
          <li>If you both record it (same amount, same or next day), it counts once.</li>
          <li>Moves between your own accounts don't change your total.</li>
          <li>Never counts as income or spending.</li></ul>`);
      }
      else if (b.dataset.cat) { sync(); if (invalid === 'category') invalid = ''; const same = st.categoryId === b.dataset.cat; st.categoryId = same ? null : b.dataset.cat; st.subcategoryId = null; draw(); }
      else if (b.dataset.sub) { sync(); st.subcategoryId = st.subcategoryId === b.dataset.sub ? null : b.dataset.sub; draw(); }
      else if ('newcat' in b.dataset) {
        sync();
        const name = await promptDialog({ title: `New ${st.type} category`, label: 'Category name' });
        if (name?.trim()) { const c = await cats.create({ name, type: st.type }); st.categoryId = c.id; st.subcategoryId = null; draw(); }
      } else if ('newsub' in b.dataset) {
        sync();
        const name = await promptDialog({ title: `New subcategory in ${cats.name(st.categoryId)}`, label: 'Subcategory name' });
        if (name?.trim()) { const c = await cats.create({ name, type: st.type, parentId: st.categoryId }); st.subcategoryId = c.id; draw(); }
      } else if ('again' in b.dataset) save(true);
      else if ('delete' in b.dataset) {
        await tx.remove(existing.id);
        undoToast('Entry deleted', async () => { await tx.restore(existing.id); window.dispatchEvent(new HashChangeEvent('hashchange')); });
        history.length > 1 ? history.back() : ctx.go('transactions');
      }
    };
    $('#f', root).onsubmit = (e) => { e.preventDefault(); save(false); };
    root.oninput = (e) => {
      if (invalid === 'amount' && e.target.id === 'amount') { invalid = ''; e.target.closest('.amount-card')?.classList.remove('invalid'); e.target.removeAttribute('aria-invalid'); }
      if (!st.split || !e.target.matches('[data-sl-amt]')) return;
      st.split[+e.target.dataset.slAmt].amount = e.target.value;
      $('#split-total', root).textContent = money(splitTotal());
    };
    const dateIn = $('#date', root);
    if (dateIn) dateIn.onclick = () => { try { dateIn.showPicker?.(); } catch { /* ignore */ } };
    if (dateIn) dateIn.onchange = () => { sync(); if (st.date) draw(); };
  }

  draw();
  // a new entry starts with the amount: the number pad opens straight away
  if (!existing) { const a = $('#amount', root); a?.focus({ preventScroll: true }); openKeypad(a); }
}
