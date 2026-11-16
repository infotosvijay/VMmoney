// The Reports screen: income / expense by category, trend, member comparison.

import { cfg } from '../db.js';
import { esc, thisMonth, addMonths, monthRange, monthLabel } from '../models.js';
import * as tx from '../transactions.js';
import * as reports from '../reports.js';
import { viewOf, whoSeg } from './rows.js';
import * as cats from '../categories.js';
import { onSwipe, $, money, moneyC, download, drawChart, cssVar, catColor, CAT_SLOTS } from './components.js';
import { icon } from './icons.js';

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
    history.replaceState(history.state, '', `#/reports?p=${n.p}&d=${n.d}&k=${n.k}${n.w ? '&w=' + n.w : ''}`);
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
  // Every amount on this screen opens the entries behind it (the Entries screen with the matching filters).
  const entries = (o = {}) => {
    const qs = new URLSearchParams();
    if (view.w && view.w !== 'me') qs.set('w', view.w);
    qs.set('m', o.m || d);
    for (const k of ['t', 'c', 'q', 'u']) if (o[k]) qs.set(k, o[k]);
    return '#/transactions?' + qs;
  };
  const noteQuery = (note) => (note.includes('"') ? note : `note:"${note}"`);
  const short = (x) => (mode === 'year' ? x : new Date(+x.slice(0, 4), +x.slice(5) - 1, 1).toLocaleString('en-IN', { month: 'short' }) + (x.slice(0, 4) === d.slice(0, 4) ? '' : ` '${x.slice(2, 4)}`));
  const go2 = icon('right');
  const detail = (id) => `#/category?c=${encodeURIComponent(id)}&d=${d}&p=${mode}&t=${kind}${view.w && view.w !== 'me' ? '&w=' + view.w : ''}`;

  // "Compared with": one row per figure, one column per period. Every cell has the same two lines
  // (amount, then the change) so the rows line up; each cell opens that period's entries.
  const cmpRows = [['Income', 'income', true, 'income'], ['Spent', 'expense', false, 'expense'], ['Saved', 'net', true, '']];
  const periods = [[d, tot, false], [prevKey, prevTot, true], ...(yearAgoTot ? [[yearAgoKey, yearAgoTot, true]] : [])];
  const cmpCell = (key, totals, isPast, k, good, t, last) => {
    const pct = isPast ? reports.change(tot[k], totals[k]) : undefined;
    // the arrow says how THIS period compares with that one
    const d2 = pct === undefined ? '' : pct === null ? '<span class="muted">–</span>' : !pct ? '<span class="muted">same</span>'
      : `<span class="${(pct > 0) === good ? 'income' : 'expense'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
    const cls = k === 'net' && totals[k] < 0 ? 'expense' : '';
    return `<a class="cmp-cell${last ? ' l' : ''}" href="${entries({ m: key, t })}" aria-label="${esc(short(key))}: ${t || 'all'} entries"><span class="v num ${cls}">${moneyC(totals[k])}</span><span class="d">${d2}</span></a>`;
  };
  const cmpHTML = `<div class="cmp" style="--cols:${periods.length}">
    <span class="h"></span>${periods.map(([key], i) => `<span class="h"${i ? ` title="${esc(mode === 'year' ? key : monthLabel(key))}"` : ''}>${i ? 'vs ' : ''}${esc(short(key))}</span>`).join('')}
    ${cmpRows.map(([name, k, good, t], ri) => { const last = ri === cmpRows.length - 1; return `<span class="n${last ? ' l' : ''}">${name}</span>${periods.map(([key, totals, past]) => cmpCell(key, totals, past, k, good, t, last)).join('')}`; }).join('')}
  </div>`;

  const delta = (r) => {
    const before = prevRows.get(r.id);
    if (before == null) return '<span class="muted small">new</span>';
    if (!before) return '';
    const pct = Math.round(((r.total - before) / before) * 100);
    if (!pct) return '<span class="muted small">same</span>';
    const bad = kind === 'expense' ? pct > 0 : pct < 0;
    return `<span class="small ${bad ? 'expense' : 'income'}" title="vs ${esc(prevLabel)}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
  };

  root.innerHTML = `
    ${view.seg ? whoSeg(view.w) : ''}
    <div class="row between no-print" style="margin-bottom:12px;flex-wrap:nowrap">
      <div class="seg"><button data-p="month" class="${mode === 'month' ? 'on' : ''}">Month</button><button data-p="year" class="${mode === 'year' ? 'on' : ''}">Year</button></div>
      <div class="row"><button class="btn icon" data-nav="-1" aria-label="Previous">${icon('left')}</button><b>${esc(label)}</b><button class="btn icon" data-nav="1" aria-label="Next">${icon('right')}</button></div>
    </div>
    <h2 class="muted small print-title" id="print-title">${hub ? 'Family' : esc(cfg.memberName)} report: ${esc(label)}</h2>
    <div class="tabs2" role="tablist" data-swipe="kind">
      <button data-k="income" class="${kind === 'income' ? 'on' : ''}" role="tab" aria-selected="${kind === 'income'}">Income <b class="num income">${money(tot.income)}</b></button>
      <button data-k="expense" class="${kind === 'expense' ? 'on' : ''}" role="tab" aria-selected="${kind === 'expense'}">Expenses <b class="num expense">${money(tot.expense)}</b></button>
    </div>
    <div class="row small muted" style="margin:6px 2px 12px">Saved <b class="num ${tot.net >= 0 ? 'income' : 'expense'}">${money(tot.net)}</b> · Savings rate <b>${tot.income ? Math.round((tot.net / tot.income) * 100) : 0}%</b></div>

    <div class="card" style="padding-bottom:6px" data-swipe="kind">
      <div class="card-head"><h2>${kind === 'expense' ? 'Where the money went' : 'Where it came from'}</h2><span class="muted small">vs ${esc(short(prevKey))}</span></div>
      ${rows.length ? `<div class="donut"><canvas id="c-cat"></canvas><div class="donut-center" aria-hidden="true"><span class="muted small">${kind === 'expense' ? 'Spent' : 'Earned'}</span><b class="num">${moneyC(kindTotal)}</b></div></div>
      ${rows.map((r, i) => `<a class="rank link" href="${detail(r.id)}"><span class="sw" style="--c:var(${i < CAT_SLOTS ? `--cat-${i + 1}` : '--cat-other'})"></span>
        <span class="two grow"><span class="t">${esc(r.icon)} ${esc(r.name)}</span><span class="muted small"><b>${Math.round((r.total / (kindTotal || 1)) * 100)}%</b> · ${r.count} ${r.count === 1 ? 'entry' : 'entries'}</span></span>
        <span class="two r"><span class="num">${moneyC(r.total)}</span>${delta(r)}</span><span class="go">${go2}</span></a>`).join('')}
      <a class="rank link" href="${entries({ t: kind })}"><span class="grow">All ${kind === 'expense' ? 'expenses' : 'income'} <span class="muted small">(${rows.reduce((n, r) => n + r.count, 0)})</span></span><span class="num">${moneyC(kindTotal)}</span><span class="go">${go2}</span></a>` : `<p class="muted">No ${kind} in this period.</p>`}
    </div>
    <div class="card"><h2>${mode === 'year' ? '12-month trend' : '6-month trend'}</h2><div class="chart-box"><canvas id="c-trend" aria-label="Trend"></canvas></div></div>
    <div class="card"><h2>Compared with</h2>${cmpHTML}</div>
    ${notes.length ? `<div class="card" style="padding:6px 12px"><div class="card-head" style="padding-top:8px"><h2>Top ${kind === 'expense' ? 'spending' : 'income'} notes</h2></div>
      ${notes.map((n) => `<a class="rank link" href="${entries({ t: kind, q: noteQuery(n.note) })}"><span class="grow">${esc(n.note)} <span class="muted small">(${n.count})</span></span><span class="num">${moneyC(n.total)}</span><span class="go">${go2}</span></a>`).join('')}</div>` : ''}
    ${hub ? `<div class="card"><h2>Member comparison</h2>${members.length ? `<div class="chart-box"><canvas id="c-mem" aria-label="Members"></canvas></div>
      <table class="tbl"><thead><tr><th>Member</th><th class="r">Income</th><th class="r">Expense</th><th class="r">In hand</th></tr></thead><tbody>${members.map((m) => `<tr><td><a href="${entries({ u: m.id })}"><span class="dot" style="background:${esc(m.color)}"></span> ${esc(m.name)}</a></td><td class="r num income"><a class="income" href="${entries({ u: m.id, t: 'income' })}">${money(m.income)}</a></td><td class="r num expense"><a class="expense" href="${entries({ u: m.id, t: 'expense' })}">${money(m.expense)}</a></td><td class="r num">${money(tx.inHand(m.id, upTo).total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No data.</p>'}</div>` : ''}
    <div class="print-only" aria-hidden="true">
      <h2>Statement: ${esc(label)}</h2>
      <p>Income ${money(tot.income)} · Expenses ${money(tot.expense)} · Saved ${money(tot.net)} · ${statement.length} entries</p>
      <table class="tbl"><thead><tr><th>Date</th>${hub ? '<th>Member</th>' : ''}<th>Category</th><th>Note</th><th>Account</th><th class="r">Amount</th></tr></thead>
        <tbody>${statement.map((t) => `<tr><td class="num">${esc(t.date)}</td>${hub ? `<td>${esc(tx.memberName(t.ownerId))}</td>` : ''}<td>${esc(t.type === 'transfer' ? 'Transfer' : cats.pathLabel(t))}</td><td>${esc(t.note)}</td><td>${esc(tx.accountName(t.accountId))}</td><td class="r num">${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${money(t.amount)}</td></tr>`).join('')}</tbody></table>
    </div>
  `;

  $('#topbar').insertAdjacentHTML('beforeend', `<button type="button" class="btn icon no-print" data-csv aria-label="Download CSV" title="Download CSV">${icon('download')}</button><button type="button" class="btn icon no-print" data-print aria-label="PDF statement" title="PDF statement">${icon('printer')}</button>`);
  $('#topbar').onclick = (e) => root.onclick(e);
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
    // the top 7 categories get their own hue (the same as their swatch in the list); the rest share one grey "Other" slice
    const top = rows.slice(0, CAT_SLOTS);
    const rest = rows.slice(CAT_SLOTS).reduce((sum, c) => sum + c.total, 0);
    const links = [...top.map((c) => detail(c.id)), ...(rest ? [entries({ t: kind })] : [])];
    const pie = $('#c-cat', root);
    pie?.setAttribute('role', 'img');
    pie?.setAttribute('aria-label', `${kind === 'expense' ? 'Spending' : 'Income'} by category: ` + rows.map((c) => `${c.name} ${Math.round((c.total / (kindTotal || 1)) * 100)}%`).join(', '));
    drawChart(pie, {
      type: 'doughnut',
      data: { labels: [...top.map((c) => c.name), ...(rest ? ['Other'] : [])], datasets: [{ data: [...top.map((c) => c.total), ...(rest ? [rest] : [])], backgroundColor: [...top.map((_, i) => catColor(i)), ...(rest ? [catColor(CAT_SLOTS)] : [])], borderColor: cssVar('--card'), borderWidth: 2, hoverOffset: 6 }] },
      options: {
        cutout: '64%',
        onClick: (_, els) => { if (els[0]) location.hash = links[els[0].index]; },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${moneyC(c.parsed)} (${Math.round((c.parsed / (kindTotal || 1)) * 100)}%)` } } },
      },
    });
  }
  drawChart($('#c-trend', root), {
    type: 'bar',
    data: { labels: trend.map((t) => monthLabel(t.month, false)), datasets: [{ label: 'Income', data: trend.map((t) => t.income), backgroundColor: ink.income }, { label: 'Expense', data: trend.map((t) => t.expense), backgroundColor: ink.expense }] },
    options: {
      scales: { y: { beginAtZero: true } },
      // tap a bar: that month's income or expense entries
      onClick: (_, els) => { if (els[0]) location.hash = entries({ m: trend[els[0].index].month, t: els[0].datasetIndex ? 'expense' : 'income' }); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${moneyC(c.parsed.y)}` } } },
    },
  });
  if (members.length) {
    drawChart($('#c-mem', root), {
      type: 'bar',
      data: { labels: members.map((m) => m.name), datasets: [{ label: 'Income', data: members.map((m) => m.income), backgroundColor: ink.income }, { label: 'Expense', data: members.map((m) => m.expense), backgroundColor: ink.expense }] },
      options: { scales: { y: { beginAtZero: true } } },
    });
  }
}
