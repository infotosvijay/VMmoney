// Savings goals screen.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc } from '../models.js';
import * as goals from '../goals.js';
import { $, money, toast, sheet, confirmDialog, promptDialog, empty, progress, evalAmount } from './components.js';

export async function goalsScreen(root, ctx) {
  const items = goals.list();
  root.innerHTML = `
    <div class="row between" style="margin-bottom:12px"><span class="muted small">Money you are putting aside for something. Shared with the family.</span><button class="btn primary small" data-add>+ Goal</button></div>
    ${items.length ? items.map((g) => {
      const p = goals.progress(g);
      const hint = p.done ? '🎉 Reached!' : p.overdue ? `Target date passed. ${money(p.left)} still to go.` : p.perMonth != null ? `${money(p.left)} to go · about ${money(Math.ceil(p.perMonth))} a month for ${p.monthsLeft} month${p.monthsLeft === 1 ? '' : 's'}` : `${money(p.left)} to go`;
      return `<div class="card"><div class="row between"><b>${esc(g.name)}</b><span class="muted small">${g.targetDate ? 'by ' + esc(g.targetDate) : ''}</span></div>
        ${progress(p.pct)}
        <div class="row between small" style="margin-top:6px"><span class="num">${money(p.saved)} of ${money(g.target)} (${Math.round(p.pct)}%)</span></div>
        <p class="muted small" style="margin:4px 0 8px">${hint}</p>
        <div class="row" style="flex-wrap:wrap"><button class="btn small primary" data-add-money="${esc(g.id)}">Add money</button><button class="btn small" data-take="${esc(g.id)}">Take out</button><button class="btn small" data-edit="${esc(g.id)}">Edit</button><button class="btn small" data-del="${esc(g.id)}">Delete</button></div>
      </div>`;
    }).join('') : empty('No goals yet.', 'Add one, like a trip, a gadget or an emergency fund.')}`;

  const ask = (title) => promptDialog({ title, label: 'Amount', type: 'text', okText: 'OK' });
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('add' in b.dataset) goalSheet(null, ctx);
    else if (b.dataset.edit) goalSheet(db.get('holdings', b.dataset.edit), ctx);
    else if (b.dataset.addMoney || b.dataset.take) {
      const id = b.dataset.addMoney || b.dataset.take;
      const v = await ask(b.dataset.addMoney ? 'Add money to this goal' : 'Take money out of this goal');
      const n = Math.round((evalAmount(v || '') || 0) * 100) / 100;
      if (v == null) return;
      if (!(n > 0)) { toast('Enter an amount greater than zero.'); return; }
      await goals.contribute(id, b.dataset.addMoney ? n : -n);
      ctx.refresh();
    } else if (b.dataset.del && (await confirmDialog('Delete this goal?', { okText: 'Delete', danger: true }))) { await goals.remove(b.dataset.del); ctx.refresh(); }
  };
}

function goalSheet(existing, ctx) {
  const cur = existing || { name: '', target: '', saved: '', targetDate: '' };
  const s = sheet(existing ? 'Edit goal' : 'New goal', `<form class="stack">
    <label class="field"><span>Name</span><input name="name" maxlength="60" value="${esc(cur.name)}" placeholder="Goa trip" required></label>
    <label class="field"><span>Target (${esc(cfg.currency || 'INR')})</span><input name="target" inputmode="none" data-keypad autocomplete="off" value="${esc(cur.target)}" required></label>
    <label class="field"><span>Saved so far</span><input name="saved" inputmode="none" data-keypad autocomplete="off" value="${esc(cur.saved)}" placeholder="0"></label>
    <label class="field"><span>Target date (optional)</span><input name="date" type="date" value="${esc(cur.targetDate)}"></label>
    <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
  const f = $('form', s.el);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const target = Math.round(evalAmount(f.target.value) * 100) / 100;
    const saved = Math.round((evalAmount(f.saved.value) || 0) * 100) / 100;
    if (!f.name.value.trim()) { toast('Give the goal a name.'); return; }
    if (!(target > 0)) { toast('Enter a target greater than zero.'); f.target.focus(); return; }
    if (existing) await goals.update(existing.id, { name: f.name.value.trim(), target, saved, targetDate: f.date.value });
    else await goals.create({ name: f.name.value, target, saved, targetDate: f.date.value });
    s.close(); ctx.refresh();
  };
}
