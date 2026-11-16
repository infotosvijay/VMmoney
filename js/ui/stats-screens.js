// Category detail: where the money went inside one category, month by month (history), and the day-wise entries.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, addMonths, monthRange, monthLabel, thisMonth, todayStr } from '../models.js';
import * as reports from '../reports.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import { $, money, drawChart, empty, monthTitle, pickMonth } from './components.js';
import { icon } from './icons.js';
import { groupedList, viewOf, whoSeg } from './rows.js';

export const categoryTitle = (ctx) => {
  const c = ctx.params.get('c');
  return c === 'none' ? 'Uncategorized' : cats.get(c)?.name || 'Category';
};

export function categoryBack(ctx) {
  const p = ctx.params;
  return `reports?p=${p.get('p') || 'month'}&d=${p.get('d') || ''}&k=${p.get('t') || 'expense'}${p.get('w') ? '&w=' + p.get('w') : ''}`;
}

/** Entries of this category (and optional subcategory) inside a date range. */
function entriesFor({ scope, memberId, c, s, type, from, to }) {
  let list = tx.query({ scope, memberId, from, to, type });
  list = c === 'none' ? list.filter((t) => !t.categoryId) : list.filter((t) => t.categoryId === c);
  if (s) list = s === 'none' ? list.filter((t) => !t.subcategoryId) : list.filter((t) => t.subcategoryId === s);
  return list;
}
const sum = (l) => l.reduce((t, x) => t + x.amount, 0);

export async function categoryDetailScreen(root, ctx) {
  const P = ctx.params;
  const view = viewOf(P);
  const { scope, memberId } = view;
  const c = P.get('c');
  const s = P.get('s') || '';
  const mode = P.get('p') === 'year' ? 'year' : 'month';
  // local dates (not UTC), never a future period, and a malformed ?d= falls back to now
  const today = todayStr();
  const latest = mode === 'year' ? thisMonth().slice(0, 4) : thisMonth();
  const asked = P.get('d') || '';
  const d = (mode === 'year' ? /^\d{4}$/ : /^\d{4}-\d{2}$/).test(asked) && asked <= latest ? asked : latest;
  const cat = c === 'none' ? null : cats.get(c);
  const type = P.get('t') || cat?.type || 'expense';
  const color = cat?.color || '#94a3b8';
  const go = (patch) => {
    const n = { c, s, p: mode, d, t: type, w: view.w === 'me' ? '' : view.w, ...patch };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(n)) if (v) qs.set(k, v);
    history.replaceState(history.state, '', `#/category?${qs}`);
    ctx.refresh();
  };

  const range = reports.periodRange(d);
  const all = entriesFor({ scope, memberId, c, type, ...range });
  const total = sum(all);
  const list = s ? entriesFor({ scope, memberId, c, s, type, ...range }) : all;

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
  const hist = months.filter((m) => m <= thisMonth()).map((m) => ({ month: m, total: sum(entriesFor({ scope, memberId, c, s, type, ...monthRange(m) })) }));
  // the running month is compared with the month before up to the same day (Nov 1–16 vs Oct 1–16),
  // and left out of the average until it is over
  const { cut } = reports.periodState(thisMonth(), today);
  const sameDays = (m) => sum(entriesFor({ scope, memberId, c, s, type, ...reports.periodRange(m, cut) }));
  const done = hist.filter((h) => h.month < thisMonth());
  const avgOf = done.length ? done : hist;
  const avg = avgOf.length ? sum(avgOf.map((h) => ({ amount: h.total }))) / avgOf.length : 0;
  const label = mode === 'year' ? d : monthLabel(d);
  const title = c === 'none' ? 'Uncategorized' : cat?.name || 'Category';
  const subName = s ? (s === 'none' ? '(no subcategory)' : cats.name(s)) : '';

  root.innerHTML = `
    ${view.seg ? whoSeg(view.w) : ''}
    <div class="row between" style="margin-bottom:12px">
      <div class="row" style="flex-wrap:nowrap"><button class="btn icon" data-nav="-1" aria-label="Previous ${mode}">${icon('left')}</button>${monthTitle(label)}<button class="btn icon" data-nav="1" aria-label="Next ${mode}" ${d >= latest ? 'disabled' : ''}>${icon('right')}</button></div>
      <div class="seg" style="min-width:150px"><button data-p="month" class="${mode === 'month' ? 'on' : ''}">Monthly</button><button data-p="year" class="${mode === 'year' ? 'on' : ''}">Yearly</button></div>
    </div>
    <div class="card">
      <div class="muted small">${esc(cat?.icon || '')} ${esc(title)}${subName ? ' › ' + esc(subName) : ''}</div>
      <div class="value num ${type}" style="font-size:2rem;font-weight:750">${money(s ? sum(list) : total)}</div>
      <div class="muted small">${list.length} ${list.length === 1 ? 'entry' : 'entries'} in ${esc(label)}${total && s ? ` · ${Math.round((sum(list) / total) * 100)}% of ${esc(title)}` : ''}</div>
    </div>

    <div class="card" style="padding:6px 12px">
      <div class="rank ${s ? '' : 'sel'}" data-sub=""><span class="pct" style="--c:${esc(color)}">100%</span><span class="grow">All</span><span class="num">${money(total)}</span></div>
      ${subs.map((x) => `<div class="rank ${s === x.id ? 'sel' : ''}" data-sub="${esc(x.id)}"><span class="pct" style="--c:${esc(color)}">${Math.round((x.total / (total || 1)) * 100)}%</span><span class="grow">${esc(x.name)} <span class="muted small">(${x.count})</span></span><span class="num">${money(x.total)}</span></div>`).join('') || '<p class="muted">Nothing in this period.</p>'}
    </div>

    <h2 class="sec" id="entries">${subName ? esc(subName) : 'Entries'}</h2>
    ${list.length ? groupedList(list, { showMember: scope === 'all' }) : empty('No entries in this period.')}

    <div class="grid two">
      <div class="card"><h2>History${subName ? ' · ' + esc(subName) : ''}</h2><div class="chart-box"><canvas id="c-hist" aria-label="Monthly history"></canvas></div></div>
      <div class="card"><h2>Month by month</h2>
        <table class="tbl"><thead><tr><th>Month</th><th class="r">Amount</th><th class="r">vs previous</th></tr></thead><tbody>
          ${hist.slice().reverse().map((h, i, arr) => {
            const prev = arr[i + 1];
            const running = prev && h.month === thisMonth();
            const now = running ? sameDays(h.month) : h.total;
            const before = running ? sameDays(prev.month) : prev?.total;
            const diff = prev ? now - before : null;
            const pct = prev && before ? Math.round((diff / before) * 100) : null;
            const bad = type === 'expense' ? diff > 0 : diff < 0;
            return `<tr class="${h.month === endMonth ? 'sel-row' : ''}"><td>${esc(monthLabel(h.month, false))}</td><td class="r num">${money(h.total)}</td><td class="r small num ${diff ? (bad ? 'expense' : 'income') : 'muted'}"${running ? ` title="1–${+cut} of each month"` : ''}>${diff == null ? '' : diff === 0 ? '–' : `${icon(diff > 0 ? 'arrowUp' : 'arrowDown', { cls: 'delta-i', label: diff > 0 ? 'up' : 'down' })}${pct == null ? money(Math.abs(diff)) : Math.abs(pct) + '%'}`}${running ? `<span class="vh"> (1–${+cut} of each month)</span>` : ''}</td></tr>`;
          }).join('')}
          <tr><td><b>Average</b>${done.length && done.length < hist.length ? '<span class="vh"> of the finished months</span>' : ''}</td><td class="r num"><b>${money(avg)}</b></td><td></td></tr>
        </tbody></table></div>
    </div>

  `;

  root.onclick = async (e) => {
    if (e.target.closest('[data-mpick]')) {
      const picked = await pickMonth(mode === 'year' ? `${d}-01` : d, { max: thisMonth(), yearOnly: mode === 'year' });
      if (picked) go({ d: picked });
      return;
    }
    const b = e.target.closest('button');
    if (b?.disabled) return;
    const row = e.target.closest('[data-sub]');
    if (b?.dataset.nav) return go({ d: mode === 'year' ? String(Number(d) + Number(b.dataset.nav)) : addMonths(d, Number(b.dataset.nav)) });
    if (b?.dataset.p) return go({ p: b.dataset.p, d: b.dataset.p === 'year' ? d.slice(0, 4) : mode === 'year' ? `${d}-${thisMonth().slice(5)}` : d });
    if (b?.dataset.w) return go({ w: b.dataset.w === 'me' ? '' : b.dataset.w, s: '' });
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
