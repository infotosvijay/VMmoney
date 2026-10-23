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
import { qrSvg, scanQR } from './qr.js';
import { onSwipe, installBanner, syncReminder, $, money, toast, confirmDialog, promptDialog, pickFiles, shareOrDownload, empty, progress, relTime, daysSince, sheet, monthTitle, pickMonth } from './components.js';
import { txRow, entryScreen, transactionsScreen, reportsScreen } from './shared-screens.js';
import { positionScreen, positionCard } from './position-screens.js';
import { categoryDetailScreen, categoryTitle, categoryBack } from './stats-screens.js';
import { categoriesScreen, budgetsScreen, accountsScreen, recurringScreen, settingsScreen } from './settings-screens.js';

// ---------------------------------------------------------------- shared bits

export const planSummary = (plans) => plans
  .filter((p) => p.add.length || p.update.length || p.deleted)
  .map((p) => `${p.label || p.store}: ${p.add.length} new, ${p.update.length} updated${p.deleted ? `, ${p.deleted} deleted` : ''}`)
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
  const rows = FAMILY.map((f) => ({ f, v: spent(f.id), h: tx.inHand(f.id).total }));
  const total = rows.reduce((s, r) => s + r.v, 0);
  const other = otherMember(cfg.memberId);
  return `<a class="card" href="#/reports?w=all" style="display:block;text-decoration:none;color:inherit">
    <div class="card-head"><h2>Family spending · ${esc(monthLabel(month, false))}</h2><span class="small">Details ›</span></div>
    <div class="stat" style="padding:0"><div class="label">Together</div><div class="value expense">${money(total)}</div></div>
    ${rows.map((r) => `<div class="row between small" style="margin-top:8px"><span class="pbadge" style="--c:${esc(r.f.color)}">${esc(r.f.name)}</span><span>Spent <b class="num">${money(r.v)}</b> · In hand <b class="num ${r.h < 0 ? 'expense' : ''}">${money(r.h)}</b></span></div>`).join('')}
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
      ${monthTitle(monthLabel(month))}
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

  const showMonth = (next) => {
    history.replaceState(null, '', next === cur ? '#/home' : `#/home?m=${next}`);
    ctx.refresh();
  };
  root.onclick = async (e) => {
    if (e.target.closest('[data-mpick]')) { const m = await pickMonth(month, { max: cur }); if (m) showMonth(m); return; }
    const b = e.target.closest('[data-mnav]');
    if (!b || b.disabled) return;
    showMonth(addMonths(month, Number(b.dataset.mnav)));
  };
  // swipe left for the next month, right for the previous one (never past the current month)
  onSwipe(root, (dir) => {
    const next = addMonths(month, dir === 'next' ? 1 : -1);
    if (next > cur) return false;
    showMonth(next);
  });
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
  const other = otherMember(cfg.memberId);
  const stale = daysSince(cfg.peerSyncAt?.[other.id]) >= 7;
  const pending = sync.relayPending();
  root.innerHTML = `
    <div class="card"><h2>Status</h2>
      <p>Last sent to Hub: <b>${esc(relTime(cfg.lastExportAt))}</b></p>
      <p>Last family update received: <b>${esc(relTime(cfg.lastImportAt))}</b></p>
      <p>Last synced with ${esc(other.name)}'s phone: <b>${esc(relTime(cfg.peerSyncAt?.[other.id]))}</b> ${stale ? '<span class="badge">overdue</span>' : ''}</p>
      ${pending ? `<p class="muted small">${pending} change${pending === 1 ? '' : 's'} from ${esc(other.name)}'s phone will go to the laptop with your next sync.</p>` : ''}
    </div>
    <div class="card stack"><h2>Live sync (same wifi)</h2>
      <p class="muted small">Sync with the laptop or with ${esc(other.name)}'s phone. One device shows a QR code, the other scans it.
        With the laptop: open <b>Live sync</b> there and scan its code. With ${esc(other.name)}: one of you taps <b>Show my QR</b>, the other taps <b>Scan QR</b>.</p>
      <div class="row"><button class="btn primary" data-scan>📷 Scan QR</button><button class="btn" data-host>Show my QR</button></div>
      <details class="more-filters"><summary>No camera? Type the 6-digit code</summary>
        <div class="row" style="margin-top:8px"><input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="7" placeholder="6-digit code" autocomplete="off" aria-label="Pairing code" style="max-width:11rem"><button class="btn" data-live>Sync now</button></div>
      </details>
      <p id="live-msg" class="small muted" role="status" aria-live="polite"></p>
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
    if ('live' in b.dataset) return liveSync(b, live.parsePairing($('#code', root).value));
    if ('scan' in b.dataset) return scanAndSync(b);
    if ('host' in b.dataset) return hostPhone();
    try {
      if (b.dataset.send) await sendData(b.dataset.send === 'full', $('#pw', root).value.trim());
      else if ('import' in b.dataset) await importFile();
    } catch (err) { if (err.name !== 'AbortError') toast(err.message, { timeout: 6000 }); }
  };

  const syncedToast = (r) => toast(r.peer === 'member'
    ? `Synced with ${r.name}'s phone: ${r.sent} sent, ${r.got} received`
    : `Synced: ${r.sent} sent${r.restored ? `, ${r.restored} entries brought back from the laptop` : ''}, family update received`);

  async function liveSync(btn, pairing) {
    const msg = $('#live-msg', root);
    if (!pairing) { msg.textContent = 'The code is 6 digits.'; msg.className = 'small danger-text'; return; }
    msg.className = 'small muted';
    root.querySelectorAll('[data-live],[data-scan],[data-host]').forEach((x) => { x.disabled = true; });
    try {
      syncedToast(await live.join(pairing, (t) => { msg.textContent = t; }));
      ctx.refresh();
    } catch (err) {
      msg.textContent = err.message; msg.className = 'small danger-text';
      root.querySelectorAll('[data-live],[data-scan],[data-host]').forEach((x) => { x.disabled = false; });
    }
  }

  async function scanAndSync(btn) {
    let text;
    try {
      text = await scanQR({ title: 'Scan to sync', hint: `Point at the QR code on the laptop or on ${other.name}'s phone.`, accept: (t) => !!live.parsePairing(t) });
    } catch (err) { toast(err.message, { timeout: 6000 }); return; }
    if (text) liveSync(btn, live.parsePairing(text));
  }

  /** This phone hosts: show a QR for the other phone to scan. */
  async function hostPhone() {
    let session = null;
    let ended = false;
    let synced = false;
    const s = sheet('Sync with a phone', `<div class="stack center">
        <p class="muted small">On ${esc(other.name)}'s phone open <b>Sync</b>, tap <b>Scan QR</b> and point it here.</p>
        <div id="host-qr" class="qr" hidden></div>
        <div class="muted small" id="host-codebox" hidden>or type the code <b id="host-code" class="num" style="letter-spacing:.15em"></b></div>
        <p id="host-status" role="status" aria-live="polite">Starting…</p>
        <div class="row end"><button type="button" class="btn" data-close>Close</button></div></div>`, {
      onClose: () => { ended = true; session?.stop(); if (synced) ctx.refresh(); },
    });
    const el = (id) => s.el.querySelector(`#${id}`);
    try {
      session = await live.hostSession({
        code: async (code, text) => {
          el('host-code').textContent = code.replace(/(\d{3})(\d{3})/, '$1 $2');
          el('host-qr').innerHTML = await qrSvg(text);
          el('host-qr').hidden = false;
          el('host-codebox').hidden = false;
        },
        status: (t, kind) => {
          el('host-status').textContent = t;
          el('host-status').className = kind === 'error' ? 'danger-text' : kind === 'done' ? 'income' : '';
          const showQr = kind === 'wait' && !!el('host-qr').innerHTML;
          el('host-qr').hidden = !showQr;
          el('host-codebox').hidden = !showQr;
        },
        confirm: (name) => confirmDialog(`${name} wants to sync with your phone. Allow?`, { okText: 'Allow', title: 'Sync request' }),
        done: (r) => { synced = true; syncedToast(r); setTimeout(() => s.close(), 1200); },
      });
      if (ended) session.stop();
    } catch (err) { el('host-status').textContent = err.message; el('host-status').className = 'danger-text'; }
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
  sync: { title: 'Sync', render: syncScreen },
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
  { id: 'sync', ico: '🔄', label: 'Sync' },
  { id: 'categories', ico: '🗂️', label: 'Categories' },
  { id: 'settings', ico: '⚙️', label: 'Settings' },
];
