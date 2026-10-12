// Member (phone) screens and routes: Home, Family View, Sync.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, thisMonth, monthLabel, monthRange, addMonths, FAMILY, otherMember } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import * as reports from '../reports.js';
import * as budgets from '../budgets.js';
import * as sync from '../sync.js';
import * as live from '../livesync.js';
import { installBanner, syncReminder, $, money, toast, confirmDialog, promptDialog, pickFiles, shareOrDownload, empty, progress, relTime, daysSince, sheet } from './components.js';
import { txRow, entryScreen, transactionsScreen, reportsScreen } from './shared-screens.js';
import { positionScreen, positionCard } from './position-screens.js';
import { categoryDetailScreen, categoryTitle, categoryBack } from './stats-screens.js';
import { categoriesScreen, budgetsScreen, accountsScreen, recurringScreen, settingsScreen } from './settings-screens.js';

// ---------------------------------------------------------------- shared bits

export const planSummary = (plans) => plans
  .filter((p) => p.add.length || p.update.length || p.deleted)
  .map((p) => `${p.store}: ${p.add.length} new, ${p.update.length} updated${p.deleted ? `, ${p.deleted} deleted` : ''}`)
  .join(' · ') || 'nothing new';

// ---------------------------------------------------------------- home

/** "Family this month": what each of you spent, from the entries the hub sent back. */
function inHandCard(month) {
  const past = month < thisMonth();
  const upTo = past ? monthRange(month).to : null;
  const h = tx.inHand(cfg.memberId, upTo);
  const on = tx.onlineAccount();
  const cash = tx.cashAccount();
  // The opening-balance link only shows on a completely empty account (no entries, no transfers, no opening balance).
  const unset = !db.live('transactions').some((t) => t.ownerId === cfg.memberId) && !tx.memberTransfers().length
    && !(on?.openingBalance) && !(cash?.openingBalance);
  return `<div class="card">
    <div class="card-head"><h2>Balance in hand</h2>${unset ? '<a class="small" href="#/accounts">Set opening balance ›</a>' : ''}</div>
    <div class="stat" style="padding:0"><div class="value ${h.total >= 0 ? 'income' : 'expense'}" style="font-size:1.9rem">${money(h.total)}</div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <div class="inhand"><span class="muted small">🏦 Online</span><b class="num ${h.online < 0 ? 'expense' : ''}">${money(h.online)}</b></div>
      <div class="inhand"><span class="muted small">💵 Cash</span><b class="num ${h.cash < 0 ? 'expense' : ''}">${money(h.cash)}</b></div>
    </div>
    ${past ? `<p class="muted small" style="margin:8px 0 0">As it stood at the end of ${esc(monthLabel(month, false))}.</p>` : ''}</div>`;
}

function familyCard(month) {
  if (!tx.hasFamilyData()) return '';
  const spent = (id) => reports.totals(tx.query({ scope: 'all', memberId: id, from: `${month}-01`, to: `${month}-31` })).expense;
  const rows = FAMILY.map((f) => ({ f, v: spent(f.id) }));
  const total = rows.reduce((s, r) => s + r.v, 0);
  const other = otherMember(cfg.memberId);
  return `<a class="card" href="#/reports?w=all" style="display:block;text-decoration:none;color:inherit">
    <div class="card-head"><h2>Family spending · ${esc(monthLabel(month, false))}</h2><span class="small">Details ›</span></div>
    <div class="stat" style="padding:0"><div class="label">Together</div><div class="value expense">${money(total)}</div></div>
    <div class="row between small" style="margin-top:8px">${rows.map((r) => `<span><span class="pbadge" style="--c:${esc(r.f.color)}">${esc(r.f.name)}</span> <b class="num">${money(r.v)}</b></span>`).join('')}</div>
    <p class="muted small" style="margin:8px 0 0">${esc(other.name)}'s entries as of the last sync ${esc(relTime(cfg.familyEntriesAt))}.</p></a>`;
}

async function homeScreen(root, ctx) {
  const cur = thisMonth();
  const asked = ctx.params.get('m') || '';
  const month = /^\d{4}-\d{2}$/.test(asked) && asked <= cur ? asked : cur;
  const mine = tx.query({ scope: 'mine', ...monthRange(month) });
  const tot = reports.totals(mine);
  const top = reports.byCategory(mine).slice(0, 5);
  const recent = mine.slice(0, 6);
  const alerts = budgets.alerts({ month, memberOnly: true });

  root.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <button class="btn small" data-mnav="-1" aria-label="Previous month">‹</button>
      <b>${esc(monthLabel(month))}</b>
      <button class="btn small" data-mnav="1" aria-label="Next month" ${month >= cur ? 'disabled' : ''}>›</button>
    </div>
    ${inHandCard(month)}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
      <div class="card stat"><div class="label">Income</div><div class="value income">${money(tot.income)}</div></div>
      <div class="card stat"><div class="label">Spending</div><div class="value expense">${money(tot.expense)}</div></div>
    </div>
    ${alerts.length ? `<div class="card"><div class="card-head"><h2>Budget alerts</h2><a href="#/budgets" class="small">All budgets</a></div>
      ${alerts.map((a) => `<div style="margin-bottom:10px"><div class="row between small"><b>${esc(a.label)}</b><span class="${a.level === 'over' ? 'danger-text' : ''}">${Math.round(a.pct)}% of ${money(a.budget.limit)}</span></div>${progress(a.pct, a.level)}</div>`).join('')}</div>` : ''}
    ${familyCard(month)}
    <div class="grid two">
      <div class="card"><div class="card-head"><h2>Top categories</h2><a href="#/reports?d=${month}" class="small">Reports</a></div>
        ${top.length ? top.map((c) => `<div style="margin-bottom:10px"><div class="row between small"><span>${esc(c.icon)} ${esc(c.name)}</span><span class="num">${money(c.total)}</span></div>${progress((c.total / tot.expense) * 100)}</div>`).join('') : '<p class="muted">No spending in this month.</p>'}
      </div>
      <div class="card"><div class="card-head"><h2>Recent</h2><a href="#/transactions?m=${month}" class="small">See all</a></div>
        ${recent.length ? `<div class="list">${recent.map((t) => txRow(t)).join('')}</div>` : empty('No entries in this month.', 'Tap <b>＋</b> to add one.')}
      </div>
    </div>
    <p style="text-align:center"><a class="btn primary" href="#/add">＋ Add entry</a></p>`;

  root.onclick = (e) => {
    const b = e.target.closest('[data-mnav]');
    if (!b || b.disabled) return;
    const next = addMonths(month, Number(b.dataset.mnav));
    history.replaceState(null, '', next === cur ? '#/home' : `#/home?m=${next}`);
    ctx.refresh();
  };
}

// ---------------------------------------------------------------- family view

async function familyScreen(root) {
  const s = cfg.familySummary;
  if (!s) {
    root.innerHTML = `<div class="card">${empty('No family summary yet.', 'When the Hub sends a family package that includes the summary, it shows up here.')}<p class="center"><a class="btn" href="#/sync">Import family update</a></p></div>`;
    return;
  }
  const months = Object.keys(s.months).sort().reverse();
  const m = months[0];
  const cur = s.months[m];
  root.innerHTML = `
    <p class="muted small">From the Hub's family package created ${esc(relTime(s.generatedAt))}. Read-only.</p>
    <div class="grid stats">
      <div class="card stat"><div class="label">Family spent · ${esc(monthLabel(m, false))}</div><div class="value expense">${money(cur.expense)}</div></div>
      <div class="card stat"><div class="label">Family income</div><div class="value income">${money(cur.income)}</div></div>
      <div class="card stat"><div class="label">Saved</div><div class="value ${cur.net >= 0 ? 'income' : 'expense'}">${money(cur.net)}</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>By member</h2><table class="tbl"><thead><tr><th>Member</th><th class="r">Income</th><th class="r">Expense</th></tr></thead><tbody>
        ${(cur.members || []).map((x) => `<tr><td>${esc(x.name)}</td><td class="r num income">${money(x.income)}</td><td class="r num expense">${money(x.expense)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No data</td></tr>'}</tbody></table></div>
      <div class="card"><h2>Top family categories</h2>${(s.topCategories || []).map((c) => `<div class="row between" style="padding:6px 0"><span>${esc(c.icon || '')} ${esc(c.name)}</span><span class="num">${money(c.total)}</span></div>`).join('') || '<p class="muted">No data</p>'}</div>
    </div>
    <div class="card"><h2>Last months</h2><table class="tbl"><thead><tr><th>Month</th><th class="r">Income</th><th class="r">Expense</th></tr></thead><tbody>
      ${months.map((k) => `<tr><td>${esc(monthLabel(k))}</td><td class="r num income">${money(s.months[k].income)}</td><td class="r num expense">${money(s.months[k].expense)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- sync

async function syncScreen(root, ctx) {
  const log = db.all('syncLog').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
  const stale = daysSince(cfg.lastExportAt) >= 7;
  root.innerHTML = `
    <div class="card"><h2>Status</h2>
      <p>Last sent to Hub: <b>${esc(relTime(cfg.lastExportAt))}</b> ${stale ? '<span class="badge">overdue</span>' : ''}</p>
      <p>Last family update received: <b>${esc(relTime(cfg.lastImportAt))}</b></p>
    </div>
    <div class="card stack"><h2>Live sync (same wifi)</h2>
      <p class="muted small">On the laptop open <b>Live sync</b> and tap Start, then type the 6-digit code here. Sends your changes and brings back the family update in one go.</p>
      <div class="row"><input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="7" placeholder="6-digit code" autocomplete="off" aria-label="Pairing code" style="max-width:11rem"><button class="btn primary" data-live>Sync now</button></div>
      <p id="live-msg" class="small muted" role="status"></p>
    </div>
    <div class="card stack"><h2>Send my data to the Hub (file)</h2>
      <p class="muted small">Creates a file with your new and changed entries. Send it to the laptop through WhatsApp, Nearby Share, email or USB. Sending the same file twice is harmless.</p>
      <label class="field"><span>Password (optional, encrypts the file)</span><input id="pw" type="password" autocomplete="new-password" placeholder="Leave empty for no encryption"></label>
      <div class="row"><button class="btn primary" data-send="changes">Send changes</button><button class="btn" data-send="full">Full backup (everything)</button></div>
    </div>
    <div class="card stack"><h2>Import</h2>
      <p class="muted small">Pick the family package the Hub sent (<code>mm-family-….json</code>). To restore your own data after a reinstall, pick your full backup file.</p>
      <div class="row"><button class="btn" data-import>Import a file</button></div>
    </div>
    <div class="card"><h2>History</h2>${log.length ? `<div class="list">${log.map((l) => `<div class="list-item"><span class="avatar">${l.direction === 'export' ? '📤' : '📥'}</span><span class="main"><span class="title">${esc(l.fileName || (l.direction === 'export' ? 'Export' : 'Import'))}</span><span class="sub">${esc(new Date(l.at).toLocaleString())} · ${l.recordCount} records</span></span></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}</div>`;

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('live' in b.dataset) return liveSync(b);
    try {
      if (b.dataset.send) await sendData(b.dataset.send === 'full', $('#pw', root).value.trim());
      else if ('import' in b.dataset) await importFile();
    } catch (err) { if (err.name !== 'AbortError') toast(err.message, { timeout: 6000 }); }
  };

  async function liveSync(btn) {
    const msg = $('#live-msg', root);
    btn.disabled = true;
    try {
      const r = await live.syncWithHub($('#code', root).value.replace(/\D/g, ''), (t) => { msg.textContent = t; });
      toast(`Synced: ${r.sent} sent${r.restored ? `, ${r.restored} entries brought back from the laptop` : ''}, family update received`);
      ctx.refresh();
    } catch (err) { msg.textContent = err.message; msg.className = 'small danger-text'; btn.disabled = false; }
  }

  async function sendData(full, pw) {
    const { pkg, count, fileName } = await sync.buildMemberPackage({ full });
    if (!count && !full) return toast('Nothing new since your last send.');
    let text = JSON.stringify(pkg);
    if (pw) text = await sync.encryptText(text, pw);
    if (await shareOrDownload(fileName, text)) {
      await sync.commitExport({ fileName, count, createdAt: pkg.createdAt });
      toast(`${count} records packaged`);
      ctx.refresh();
    }
  }

  async function importFile() {
    const [file] = await pickFiles();
    if (!file) return;
    const pkg = await sync.readPackageFile(file, (n) => promptDialog({ title: 'Password needed', label: `Password for ${n}`, type: 'password', okText: 'Open' }));
    if (pkg.packageType === 'family') {
      const pv = sync.previewFamilyPackage(pkg);
      if (await confirmDialog(`Family update from ${pkg.fromMemberName || 'Hub'}: ${planSummary(pv.plans)}${pv.hasSummary ? ' · includes family summary' : ''}. Apply it?`, { okText: 'Apply' })) {
        await sync.applyFamilyPackage(pv);
        toast('Family update applied');
        ctx.refresh();
      }
    } else if (pkg.packageType === 'member' && pkg.fromMemberId === cfg.memberId) {
      const pv = sync.previewMemberPackage(pkg);
      if (await confirmDialog(`Restore your own backup: ${planSummary(pv.plans)}. Apply it?`, { okText: 'Restore' })) {
        await sync.applyMemberPackage(pv);
        toast('Backup restored');
        ctx.refresh();
      }
    } else if (pkg.packageType === 'member') {
      throw new Error('That file belongs to another member. Send it to the Hub instead.');
    } else throw new Error('Unsupported file type for a phone.');
  }
}

// ---------------------------------------------------------------- routes

export const memberRoutes = {
  home: { title: 'Summary', render: homeScreen },
  transactions: { title: () => `Hi, ${cfg.memberName}`, render: transactionsScreen },
  add: { title: (c) => (c.params.get('id') ? 'Edit entry' : 'Add entry'), render: entryScreen },
  position: { title: 'Balances', render: positionScreen },
  reports: { title: 'Reports', render: reportsScreen },
  category: { title: categoryTitle, render: categoryDetailScreen, back: categoryBack, navId: 'reports' },
  budgets: { title: 'Budgets', render: (r, c) => budgetsScreen(r, c, { hub: false }) },
  family: { title: 'Family view', render: familyScreen },
  sync: { title: 'Sync with Hub', render: syncScreen },
  categories: { title: 'Categories', render: (r, c) => categoriesScreen(r, c, { hub: false }) },
  settings: { title: 'Settings', render: settingsScreen },
  accounts: { title: 'Accounts', render: accountsScreen, back: 'settings', navId: 'settings' },
  recurring: { title: 'Recurring', render: recurringScreen, back: 'settings', navId: 'settings' },
};

export const memberNav = [
  { id: 'transactions', ico: '🧾', label: 'Entries', tab: true },
  { id: 'home', ico: '🏠', label: 'Summary', tab: true },
  { id: 'add', ico: '＋', label: 'Add', tab: true },
  { id: 'position', ico: '🏦', label: 'Balances', tab: true },
  { id: 'reports', ico: '📊', label: 'Reports' },
  { id: 'budgets', ico: '🎯', label: 'Budgets' },
  { id: 'family', ico: '👪', label: 'Family view' },
  { id: 'sync', ico: '🔄', label: 'Sync with Hub' },
  { id: 'categories', ico: '🗂️', label: 'Categories' },
  { id: 'settings', ico: '⚙️', label: 'Settings' },
];
