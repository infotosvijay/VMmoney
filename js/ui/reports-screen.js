// The Reports screen: income / expense by category, trend, member comparison.

import { cfg } from '../db.js';
import { esc, thisMonth, addMonths, monthRange, monthLabel } from '../models.js';
import * as tx from '../transactions.js';
import * as reports from '../reports.js';
import { viewOf, whoSeg } from './rows.js';
import * as cats from '../categories.js';
import { onSwipe, $, money, download, drawChart, cssVar } from './components.js';

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
  // compare with the period before, and (for a month) the same month last year
  const prevTot = reports.totals(q(rangeOf(prevKey)));
  const yearAgoKey = mode === 'month' ? `${Number(d.slice(0, 4)) - 1}-${d.slice(5)}` : null;
  const yearAgoTot = yearAgoKey ? reports.totals(q(rangeOf(yearAgoKey))) : null;
  const notes = reports.topNotes(list, kind, 5);
  const statement = reports.statementRows(list);
  const label = mode === 'year' ? d : monthLabel(d);
  const prevLabel = mode === 'year' ? prevKey : monthLabel(prevKey, false);
  const trendEnd = mode === 'year' ? `${d}-12` : d;
  const upTo = (mode === 'year' ? d < thisMonth().slice(0, 4) : d < thisMonth()) ? rangeOf(d).to : null; // "In hand" at the end of a past period
  const trend = reports.monthlyTrend(q({}), mode === 'year' ? 12 : 6, trendEnd);
  const members = hub ? reports.byMember(list) : [];
  const detail = (id) => `#/category?c=${encodeURIComponent(id)}&d=${d}&p=${mode}&t=${kind}${view.w && view.w !== 'me' ? '&w=' + view.w : ''}`;

  // one cell of the comparison table: the amount and how this period differs. Spending up is bad; income and savings up is good.
  const vs = (now, before, goodWhenUp) => {
    const pct = reports.change(now, before);
    const note = pct === null ? '<span class="muted small">no data</span>' : !pct ? '<span class="muted small">same</span>' : `<span class="small ${(pct > 0) === goodWhenUp ? 'income' : 'expense'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
    return `<td class="r num">${money(before)}<br>${note}</td>`;
  };
  const cmpRows = [['Income', 'income', true], ['Expenses', 'expense', false], ['Saved', 'net', true]];

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
      <div class="row"><button class="btn small" data-csv>⬇ CSV</button><button class="btn small" data-print>🖨 PDF statement</button></div>
    </div>
    <h2 class="muted small print-title" id="print-title">${hub ? 'Family' : esc(cfg.memberName)} report: ${esc(label)}</h2>
    <div class="tabs2" role="tablist" data-swipe="kind">
      <button data-k="income" class="${kind === 'income' ? 'on' : ''}" role="tab" aria-selected="${kind === 'income'}">Income <b class="num income">${money(tot.income)}</b></button>
      <button data-k="expense" class="${kind === 'expense' ? 'on' : ''}" role="tab" aria-selected="${kind === 'expense'}">Expenses <b class="num expense">${money(tot.expense)}</b></button>
    </div>
    <div class="row small muted" style="margin:6px 2px 12px">Saved <b class="num ${tot.net >= 0 ? 'income' : 'expense'}">${money(tot.net)}</b> · Savings rate <b>${tot.income ? Math.round((tot.net / tot.income) * 100) : 0}%</b></div>

    <div class="grid two">
      <div class="card" data-swipe="kind"><h2>${kind === 'expense' ? 'Where the money went' : 'Where it came from'}</h2>${rows.length ? '<div class="chart-box"><canvas id="c-cat" aria-label="By category"></canvas></div>' : `<p class="muted">No ${kind} in this period.</p>`}</div>
      <div class="card"><h2>${mode === 'year' ? '12-month trend' : '6-month trend'}</h2><div class="chart-box"><canvas id="c-trend" aria-label="Trend"></canvas></div></div>
    </div>

    <div class="card" style="padding:6px 12px" data-swipe="kind">
      <div class="card-head" style="padding-top:8px"><h2>${kind === 'expense' ? 'Expenses' : 'Income'} by category</h2><span class="muted small">vs ${esc(prevLabel)}</span></div>
      ${rows.length ? rows.map((r) => `<a class="rank link" href="${detail(r.id)}"><span class="pct" style="background:${esc(r.color)}">${Math.round((r.total / (kindTotal || 1)) * 100)}%</span>
        <span class="grow">${esc(r.icon)} ${esc(r.name)} <span class="muted small">(${r.count})</span></span><span class="num">${money(r.total)}</span><span class="delta">${delta(r)}</span></a>`).join('') : '<p class="muted">Nothing recorded.</p>'}
      <p class="muted small no-print" style="margin:8px 2px">Tap a category for its subcategories, month-by-month history and daily entries.</p>
    </div>
    <div class="card"><h2>Compared with</h2>
      <table class="tbl"><thead><tr><th></th><th class="r">${esc(label)}</th><th class="r">${esc(prevLabel)}</th>${yearAgoTot ? `<th class="r">${esc(monthLabel(yearAgoKey, false))}</th>` : ''}</tr></thead>
        <tbody>${cmpRows.map(([name, k, good]) => `<tr><td>${name}</td><td class="r num">${money(tot[k])}</td>${vs(tot[k], prevTot[k], good)}${yearAgoTot ? vs(tot[k], yearAgoTot[k], good) : ''}</tr>`).join('')}</tbody></table>
    </div>
    ${notes.length ? `<div class="card" style="padding:6px 12px"><div class="card-head" style="padding-top:8px"><h2>Top ${kind === 'expense' ? 'spending' : 'income'} notes</h2><span class="muted small">same note added together</span></div>
      ${notes.map((n, i) => `<div class="rank"><span class="pct" style="background:var(--brand);color:var(--brand-ink)">${i + 1}</span><span class="grow">${esc(n.note)} <span class="muted small">(${n.count})</span></span><span class="num">${money(n.total)}</span></div>`).join('')}</div>` : ''}
    ${hub ? `<div class="card"><h2>Member comparison</h2>${members.length ? `<div class="chart-box"><canvas id="c-mem" aria-label="Members"></canvas></div>
      <table class="tbl"><thead><tr><th>Member</th><th class="r">Income</th><th class="r">Expense</th><th class="r">In hand</th></tr></thead><tbody>${members.map((m) => `<tr><td><span class="dot" style="background:${esc(m.color)}"></span> ${esc(m.name)}</td><td class="r num income">${money(m.income)}</td><td class="r num expense">${money(m.expense)}</td><td class="r num">${money(tx.inHand(m.id, upTo).total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No data.</p>'}</div>` : ''}
    <div class="print-only" aria-hidden="true">
      <h2>Statement: ${esc(label)}</h2>
      <p>Income ${money(tot.income)} · Expenses ${money(tot.expense)} · Saved ${money(tot.net)} · ${statement.length} entries</p>
      <table class="tbl"><thead><tr><th>Date</th>${hub ? '<th>Member</th>' : ''}<th>Category</th><th>Note</th><th>Account</th><th class="r">Amount</th></tr></thead>
        <tbody>${statement.map((t) => `<tr><td class="num">${esc(t.date)}</td>${hub ? `<td>${esc(tx.memberName(t.ownerId))}</td>` : ''}<td>${esc(t.type === 'transfer' ? 'Transfer' : cats.pathLabel(t))}</td><td>${esc(t.note)}</td><td>${esc(tx.accountName(t.accountId))}</td><td class="r num">${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${money(t.amount)}</td></tr>`).join('')}</tbody></table>
    </div>
  `;

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.p) return go({ p: b.dataset.p, d: b.dataset.p === 'year' ? d.slice(0, 4) : mode === 'year' ? `${d}-${thisMonth().slice(5)}` : d });
    if (b?.dataset.k) return go({ k: b.dataset.k });
    if (b?.dataset.w) return go({ w: b.dataset.w === 'me' ? '' : b.dataset.w });
    if (b?.dataset.nav) return go({ d: mode === 'year' ? String(Number(d) + Number(b.dataset.nav)) : addMonths(d, Number(b.dataset.nav)) });
    if (b && 'csv' in b.dataset) return download(`mm-report-${d}.csv`, reports.toCSV(list), 'text/csv');
    if (b && 'print' in b.dataset) window.print();
  };

  // Swipe on the Income / Expenses tabs, the pie or the category list: Income <-> Expenses.
  // Swipe anywhere else on the page: Mine <-> the other person <-> Family.
  onSwipe(root, (dir, start) => {
    const step = dir === 'next' ? 1 : -1;
    if (start?.closest('[data-swipe="kind"]')) {
      const order = ['income', 'expense']; // same order as the tabs on screen
      const n = order.indexOf(kind) + step;
      if (n < 0 || n >= order.length) return false;
      return void go({ k: order[n] });
    }
    if (!view.seg) return false;
    const order = ['me', 'other', 'all'];
    const n = order.indexOf(view.w) + step;
    if (n < 0 || n >= order.length) return false;
    go({ w: order[n] === 'me' ? '' : order[n] });
  });

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
