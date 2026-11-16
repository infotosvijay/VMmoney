// Savings goals screen. Adding / editing a goal is the full-screen form in plan-forms.js.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc } from '../models.js';
import * as cats from '../categories.js';
import * as goals from '../goals.js';
import { $, moneyC, sheet, pickDialog, undoToast, empty, progress, evalAmount, openKeypad } from './components.js';
import { icon } from './icons.js';

export async function goalsScreen(root, ctx) {
  const items = goals.list();
  const srcLabel = (g) => (g.subcategoryId ? `${cats.name(g.categoryId)} › ${cats.name(g.subcategoryId)}` : cats.name(g.categoryId));
  // the linked entries open in the Entries screen (all time, that category, from the goal's start date)
  const entriesHref = (g) => `#/transactions?w=all&m=all&c=${g.subcategoryId ? 's:' + encodeURIComponent(g.subcategoryId) : 'c:' + encodeURIComponent(g.categoryId)}${g.startDate ? '&df=' + g.startDate : ''}`;
  root.innerHTML = `
    <div class="row end" style="margin-bottom:12px"><a class="btn primary small" href="#/goal">${icon('plus')} Goal</a></div>
    ${items.length ? items.map((g) => {
      const p = goals.progress(g);
      const hint = p.done ? `${icon('check')} Reached` : p.overdue ? `Date passed · ${moneyC(p.left)} to go` : p.perMonth != null ? `${moneyC(p.left)} to go · ${moneyC(Math.ceil(p.perMonth))}/month for ${p.monthsLeft} month${p.monthsLeft === 1 ? '' : 's'}` : `${moneyC(p.left)} to go`;
      const c = g.categoryId ? cats.get(g.subcategoryId) || cats.get(g.categoryId) : null;
      return `<div class="card"><div class="row between" style="flex-wrap:nowrap"><b class="grow">${esc(g.name)}</b><span class="muted small">${g.targetDate ? 'by ' + esc(new Date(g.targetDate + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</span>
          <button type="button" class="icon-btn" data-menu="${esc(g.id)}" aria-label="Options for ${esc(g.name)}" style="margin:-8px -10px -8px 0">${icon('dots')}</button></div>
        ${progress(p.pct)}
        <div class="row between small" style="margin-top:6px"><span class="num"><b>${moneyC(p.saved)}</b> of ${moneyC(g.target)}</span><span class="num muted">${Math.round(p.pct)}%</span></div>
        <p class="muted small" style="margin:4px 0 0">${hint}</p>
        ${g.categoryId ? `<a class="rank link small goal-src" href="${entriesHref(g)}" style="margin-top:6px"><span class="grow">${esc(cats.icon(c))} ${esc(srcLabel(g))} <span class="num">${moneyC(p.fromEntries)}</span>${p.byHand ? ` <span class="muted">+ ${moneyC(p.byHand)} by hand</span>` : ''}</span><span class="go">${icon('right')}</span></a>` : ''}
        <div class="row" style="margin-top:8px"><button class="btn small primary grow" data-add-money="${esc(g.id)}">${icon('plus')} Add money</button><button class="btn small grow" data-take="${esc(g.id)}">Take out</button></div>
      </div>`;
    }).join('') : empty('No goals yet.', 'A trip, a gadget, an emergency fund…')}`;

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.menu) {
      const id = b.dataset.menu;
      const choice = await pickDialog(db.get('holdings', id)?.name || 'Goal', [['edit', 'Edit'], ['delete', 'Delete']]);
      if (choice === 'edit') ctx.go(`goal?id=${encodeURIComponent(id)}`);
      else if (choice === 'delete') {
        await goals.remove(id);
        ctx.refresh();
        undoToast('Goal deleted', async () => { await goals.restore(id); ctx.refresh(); });
      }
    } else if (b.dataset.addMoney || b.dataset.take) {
      const id = b.dataset.addMoney || b.dataset.take;
      const n = await amountDialog(b.dataset.addMoney ? 'Add money' : 'Take money out', db.get('holdings', id)?.name);
      if (n == null) return;
      await goals.contribute(id, b.dataset.addMoney ? n : -n);
      ctx.refresh();
    }
  };
}

/** A sheet with the same big amount box (and number pad) as Add entry. Resolves to the amount, or null. */
function amountDialog(title, sub) {
  return new Promise((resolve) => {
    let result = null;
    const s = sheet(title, `<form class="stack">
      <label class="card amount-card" style="display:block;margin-bottom:0"><span class="lbl">${esc(sub || 'Amount')}</span>
        <input name="v" class="amount-input" inputmode="none" data-keypad autocomplete="off" placeholder="0" aria-label="Amount (${esc(cfg.currency || 'INR')})"></label>
      <button class="btn primary" style="width:100%">Done</button></form>`, { onClose: () => resolve(result) });
    const f = $('form', s.el);
    f.onsubmit = (e) => {
      e.preventDefault();
      const n = Math.round((evalAmount(f.v.value) || 0) * 100) / 100;
      if (!(n > 0)) { f.v.closest('.amount-card').classList.add('invalid'); f.v.focus(); return; }
      result = n;
      s.close();
    };
    f.v.focus({ preventScroll: true });
    openKeypad(f.v);
  });
}

