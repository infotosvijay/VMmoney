// Category detail: where the money went inside one category, month by month (history), and the day-wise entries.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, addMonths, monthRange, monthLabel } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import { $, money, drawChart, empty } from './components.js';
import { groupedList } from './shared-screens.js';

export const categoryTitle = (ctx) => {
  const c = ctx.params.get('c');
  return c === 'none' ? 'Uncategorized' : cats.get(c)?.name || 'Category';
};

export function categoryBack(ctx) {
  const p = ctx.params;
  return `reports?p=${p.get('p') || 'month'}&d=${p.get('d') || ''}&k=${p.get('t') || 'expense'}`;
}

/** Entries of this category (and optional subcategory) inside a date range. */
function entriesFor({ scope, c, s, type, from, to }) {
  let list = tx.query({ scope, from, to, type });
  list = c === 'none' ? list.filter((t) => !t.categoryId) : list.filter((t) => t.categoryId === c);
  if (s) list = s === 'none' ? list.filter((t) => !t.subcategoryId) : list.filter((t) => t.subcategoryId === s);
  return list;
}
const sum = (l) => l.reduce((t, x) => t + x.amount, 0);

export async function categoryDetailScreen(root, ctx) {
  const P = ctx.params;
  const scope = cfg.mode === 'hub' ? 'all' : 'mine';
  const c = P.get('c');
  const s = P.get('s') || '';
  const mode = P.get('p') === 'year' ? 'year' : 'month';
  const d = P.get('d') || (mode === 'year' ? new Date().getFullYear().toString() : new Date().toISOString().slice(0, 7));
  const cat = c === 'none' ? null : cats.get(c);
  const type = P.get('t') || cat?.type || 'expense';
  const color = cat?.color || '#94a3b8';
  const go = (patch) => {
    const n = { c, s, p: mode, d, t: type, ...patch };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(n)) if (v) qs.set(k, v);
    history.replaceState(null, '', `#/category?${qs}`);
    ctx.refresh();
  };

  const range = mode === 'year' ? { from: `${d}-01-01`, to: `${d}-12-31` } : monthRange(d);
  const all = entriesFor({ scope, c, type, ...range });
  const total = sum(all);
  const list = s ? entriesFor({ scope, c, s, type, ...range }) : all;

  // subcategory breakdown (the "All / school / tuition" block)
  const subMap = new Map();
  for (const t of all) {
    const k = t.subcategoryId || 'none';
    const e = subMap.get(k) || { id: k, name: k === 'none' ? '(no subcategory)' : cats.name(k), total: 0, count: 0 };
    e.total += t.amount; e.count++; subMap.set(k, e);
  }
  const subs = [...subMap.values()].sort((a, b) => b.total - a.total);

  // history: one point per month, ending at the selected month (or the 12 months of the selected year)
  const endMonth = mode === 'year' ? `${d}-12` : d;
  const n = mode === 'year' ? 12 : 8;
  const months = Array.from({ length: n }, (_, i) => addMonths(endMonth, i - (n - 1)));
  const hist = months.map((m) => ({ month: m, total: sum(entriesFor({ scope, c, s, type, ...monthRange(m) })) }));
  const avg = hist.length ? sum(hist.map((h) => ({ amount: h.total }))) / hist.length : 0;
  const label = mode === 'year' ? d : monthLabel(d);
  const title = c === 'none' ? 'Uncategorized' : cat?.name || 'Category';
  const subName = s ? (s === 'none' ? '(no subcategory)' : cats.name(s)) : '';

  root.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row"><button class="btn small" data-nav="-1" aria-label="Previous">‹</button><b>${esc(label)}</b><button class="btn small" data-nav="1" aria-label="Next">›</button></div>
      <div class="seg" style="min-width:150px"><button data-p="month" class="${mode === 'month' ? 'on' : ''}">Monthly</button><button data-p="year" class="${mode === 'year' ? 'on' : ''}">Yearly</button></div>
    </div>
    <div class="card">
      <div class="muted small">${esc(cat?.icon || '')} ${esc(title)}${subName ? ' › ' + esc(subName) : ''}</div>
      <div class="value num ${type}" style="font-size:2rem;font-weight:750">${money(s ? sum(list) : total)}</div>
      <div class="muted small">${list.length} ${list.length === 1 ? 'entry' : 'entries'} in ${esc(label)}${total && s ? ` · ${Math.round((sum(list) / total) * 100)}% of ${esc(title)}` : ''}</div>
    </div>

    <div class="card" style="padding:6px 12px">
      <div class="rank ${s ? '' : 'sel'}" data-sub=""><span class="pct" style="background:${esc(color)}">100%</span><span class="grow">All</span><span class="num">${money(total)}</span></div>
      ${subs.map((x) => `<div class="rank ${s === x.id ? 'sel' : ''}" data-sub="${esc(x.id)}"><span class="pct" style="background:${esc(color)};opacity:.85">${Math.round((x.total / (total || 1)) * 100)}%</span><span class="grow">${esc(x.name)} <span class="muted small">(${x.count})</span></span><span class="num">${money(x.total)}</span></div>`).join('') || '<p class="muted">Nothing in this period.</p>'}
    </div>

    <div class="grid two">
      <div class="card"><h2>History${subName ? ' · ' + esc(subName) : ''}</h2><div class="chart-box"><canvas id="c-hist" aria-label="Monthly history"></canvas></div></div>
      <div class="card"><h2>Month by month</h2>
        <table class="tbl"><thead><tr><th>Month</th><th class="r">Amount</th><th class="r">vs previous</th></tr></thead><tbody>
          ${hist.slice().reverse().map((h, i, arr) => {
            const prev = arr[i + 1];
            const diff = prev ? h.total - prev.total : null;
            const pct = prev && prev.total ? Math.round((diff / prev.total) * 100) : null;
            const bad = type === 'expense' ? diff > 0 : diff < 0;
            return `<tr class="${h.month === endMonth ? 'sel-row' : ''}"><td>${esc(monthLabel(h.month, false))}</td><td class="r num">${money(h.total)}</td><td class="r small ${diff ? (bad ? 'expense' : 'income') : 'muted'}">${diff == null ? '' : diff === 0 ? '–' : `${diff > 0 ? '▲' : '▼'} ${pct == null ? money(Math.abs(diff)) : Math.abs(pct) + '%'}`}</td></tr>`;
          }).join('')}
          <tr><td><b>Average</b></td><td class="r num"><b>${money(avg)}</b></td><td></td></tr>
        </tbody></table></div>
    </div>

    <h2 class="sec">Entries</h2>
    ${list.length ? groupedList(list, { showMember: scope === 'all' }) : empty('No entries in this period.')}
  `;

  root.onclick = (e) => {
    const b = e.target.closest('button');
    const row = e.target.closest('[data-sub]');
    if (b?.dataset.nav) return go({ d: mode === 'year' ? String(Number(d) + Number(b.dataset.nav)) : addMonths(d, Number(b.dataset.nav)) });
    if (b?.dataset.p) return go({ p: b.dataset.p, d: b.dataset.p === 'year' ? d.slice(0, 4) : mode === 'year' ? `${d}-${new Date().toISOString().slice(5, 7)}` : d });
    if (row) go({ s: row.dataset.sub });
  };

  drawChart($('#c-hist', root), {
    type: 'line',
    data: {
      labels: hist.map((h) => monthLabel(h.month, false).replace(/ \d{4}$/, '')),
      datasets: [{ label: title, data: hist.map((h) => h.total), borderColor: color, backgroundColor: color, pointRadius: 4, tension: 0.25 }],
    },
    options: {
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => ` ${money(x.parsed.y)}` } } },
    },
  });
}
