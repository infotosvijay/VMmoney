// Family Hub (laptop) screens and routes.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, thisMonth, monthLabel, monthRange } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import * as reports from '../reports.js';
import * as budgets from '../budgets.js';
import * as sync from '../sync.js';
import * as hubfile from '../hubfile.js';
import * as live from '../livesync.js';
import { $, $$, money, toast, confirmDialog, promptDialog, pickFiles, shareOrDownload, empty, progress, relTime, daysSince, drawChart, cssVar, sheet } from './components.js';
import { entryScreen, transactionsScreen, reportsScreen } from './shared-screens.js';
import { positionScreen, positionCard } from './position-screens.js';
import { categoryDetailScreen, categoryTitle, categoryBack } from './stats-screens.js';
import { categoriesScreen, budgetsScreen, accountsScreen, recurringScreen, settingsScreen } from './settings-screens.js';

const askPw = (n) => promptDialog({ title: 'Password needed', label: `Password for ${n}`, type: 'password', okText: 'Open' });

// ---------------------------------------------------------------- dashboard

function transferNote() {
  const net = tx.netVjToMm();
  if (!tx.memberTransfers().length) return '';
  return `<div class="banner info small">🤝 ${net === 0 ? 'VJ and MM are even on transfers.' : net > 0 ? `VJ has transferred ${money(net)} more to MM than received.` : `MM has transferred ${money(-net)} more to VJ than received.`} <a href="#/transactions?t=transfer&m=all">See transfers</a></div>`;
}

async function dashboardScreen(root, ctx) {
  const month = thisMonth();
  const list = tx.query({ scope: 'all', ...monthRange(month) });
  const tot = reports.totals(list);
  const top = reports.byCategory(list).slice(0, 6);
  const members = reports.byMember(list);
  const sts = budgets.statuses({ month }).slice(0, 6);
  const pend = cats.pending().length;
  const trend = reports.monthlyTrend(tx.query({ scope: 'all' }), 6);
  const others = tx.members().filter((m) => m.id !== cfg.memberId);

  root.innerHTML = `
    ${hubfile.supported && !hubfile.status.linked ? `<div class="banner"><b>Link your master file</b><p class="small">Save everything to a family.json on this computer so nothing is ever lost.</p><div class="row"><a class="btn primary small" href="#/masterfile">Set up</a></div></div>` : ''}
    ${pend ? `<div class="banner info"><b>${pend} new ${pend === 1 ? 'category' : 'categories'} to review</b><div class="row"><a class="btn small primary" href="#/categories">Review</a></div></div>` : ''}
    <div class="grid stats">
      <div class="card stat"><div class="label">Family income · ${esc(monthLabel(month, false))}</div><div class="value income">${money(tot.income)}</div></div>
      <div class="card stat"><div class="label">Family expense</div><div class="value expense">${money(tot.expense)}</div></div>
      <div class="card stat"><div class="label">Saved</div><div class="value ${tot.net >= 0 ? 'income' : 'expense'}">${money(tot.net)}</div></div>
      <div class="card stat"><div class="label">Entries this month</div><div class="value">${list.length}</div></div>
    </div>
    ${positionCard()}
    ${transferNote()}
    <div class="grid two">
      <div class="card"><h2>Per member</h2>${members.length ? `<table class="tbl"><thead><tr><th>Member</th><th class="r">Income</th><th class="r">Expense</th></tr></thead><tbody>${members.map((m) => `<tr><td><span class="dot" style="background:${esc(m.color)}"></span> ${esc(m.name)}</td><td class="r num income">${money(m.income)}</td><td class="r num expense">${money(m.expense)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No entries this month.</p>'}</div>
      <div class="card"><h2>6-month trend</h2><div class="chart-box"><canvas id="c-trend"></canvas></div></div>
    </div>
    <div class="grid two">
      <div class="card"><div class="card-head"><h2>Top categories</h2><a class="small" href="#/reports">Reports</a></div>
        ${top.length ? top.map((c) => `<div style="margin-bottom:10px"><div class="row between small"><span>${esc(c.icon)} ${esc(c.name)}</span><span class="num">${money(c.total)}</span></div>${progress((c.total / tot.expense) * 100)}</div>`).join('') : '<p class="muted">Nothing yet.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Budget status</h2><a class="small" href="#/budgets">Manage</a></div>
        ${sts.length ? sts.map((s) => `<div style="margin-bottom:10px"><div class="row between small"><b>${esc(s.label)} <span class="muted">${s.budget.scope === 'family' ? '' : '· ' + esc(tx.memberName(s.budget.memberId))}</span></b><span class="${s.level === 'over' ? 'danger-text' : ''}">${money(s.used)} / ${money(s.budget.limit)}</span></div>${progress(s.pct, s.level)}</div>`).join('') : '<p class="muted">No budgets set.</p>'}</div>
    </div>
    ${others.length ? `<div class="card"><h2>Sync status</h2><div class="list">${others.map((m) => {
      const l = sync.lastSyncAt(m.id);
      const late = daysSince(l?.at) >= 10;
      return `<div class="list-item"><span class="dot" style="background:${esc(m.color)}"></span><span class="main">${esc(m.name)}</span><span class="${late ? 'danger-text' : 'muted'} small">${l ? 'last file ' + esc(relTime(l.at)) : 'no file received yet'}</span></div>`;
    }).join('')}</div></div>` : `<div class="card"><h2>Get started</h2><p>Ask each family member to open the app on their phone, choose <b>Member</b>, then use <b>Sync → Send changes</b> and share the file to this computer. Drop it in the <a href="#/import">Import Center</a>.</p></div>`}`;

  drawChart($('#c-trend', root), {
    type: 'bar',
    data: { labels: trend.map((t) => monthLabel(t.month, false)), datasets: [{ label: 'Income', data: trend.map((t) => t.income), backgroundColor: cssVar('--income') }, { label: 'Expense', data: trend.map((t) => t.expense), backgroundColor: cssVar('--expense') }] },
    options: { scales: { y: { beginAtZero: true } } },
  });
}

// ---------------------------------------------------------------- import center

let staged = []; // [{file, preview} | {file, error}]

async function importScreen(root, ctx) {
  const rows = (pv) => pv.plans.map((p) => `<tr><td>${esc(p.store)}</td><td class="r num">${p.add.length}</td><td class="r num">${p.update.length}</td><td class="r num">${p.same}</td><td class="r num">${p.deleted}</td><td class="r num ${p.rejected ? 'danger-text' : ''}">${p.rejected}</td></tr>`).join('');
  root.innerHTML = `
    <div class="drop" id="drop"><p><b>Drop member files here</b></p><p class="small">or</p><button class="btn primary" data-pick>Choose files…</button><p class="small">Files look like <code>mm-member-name-20261012-2030.json</code>. Importing a file twice changes nothing.</p></div>
    ${staged.map((s, i) => s.error ? `<div class="card"><b>${esc(s.file.name)}</b><p class="danger-text">${esc(s.error)}</p><button class="btn small" data-drop="${i}">Remove</button></div>` : `
      <div class="card"><div class="card-head"><h2>${esc(s.preview.name)} <span class="muted small">${esc(s.file.name)}</span></h2><label class="check"><input type="checkbox" data-inc="${i}" ${s.include === false ? '' : 'checked'}> Include</label></div>
        ${!s.preview.known ? '<p class="small">🆕 New member: they will be added to the family.</p>' : ''}
        ${s.preview.gap ? '<p class="banner small">This file only has changes since an earlier send that this Hub has not received. Some older entries may be missing. Ask them to send a <b>Full backup</b> too.</p>' : ''}
        <table class="tbl"><thead><tr><th>Records</th><th class="r">New</th><th class="r">Updated</th><th class="r">Unchanged</th><th class="r">Deleted</th><th class="r">Rejected</th></tr></thead><tbody>${rows(s.preview)}</tbody></table>
        <p class="muted small">Rejected = records that don't belong to this member. Created ${esc(new Date(s.preview.pkg.createdAt).toLocaleString())}.</p>
        <button class="btn small" data-drop="${i}">Remove</button></div>`).join('')}
    ${staged.some((s) => !s.error) ? '<button class="btn primary" data-merge style="width:100%">Merge selected files</button>' : ''}`;

  async function stage(files) {
    for (const file of files) {
      try {
        const pkg = await sync.readPackageFile(file, askPw);
        if (pkg.packageType === 'master') throw new Error('This is a master file. Use Master File → Open existing instead.');
        staged.push({ file, preview: sync.previewMemberPackage(pkg) });
      } catch (e) { staged.push({ file, error: e.message }); }
    }
    ctx.refresh();
  }

  const drop = $('#drop', root);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); stage([...e.dataTransfer.files]); };

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('pick' in b.dataset) { const f = await pickFiles({ multiple: true }); if (f.length) stage(f); }
    else if (b.dataset.drop) { staged.splice(Number(b.dataset.drop), 1); ctx.refresh(); }
    else if ('merge' in b.dataset) {
      let total = 0;
      for (const s of staged.filter((x) => !x.error && x.include !== false)) {
        // re-plan right before applying, in case an earlier file changed the same records
        total += await sync.applyMemberPackage(sync.previewMemberPackage(s.preview.pkg));
      }
      staged = [];
      toast(`Merged ${total} records`);
      ctx.refresh();
    }
  };
  root.onchange = (e) => { if (e.target.dataset.inc) staged[Number(e.target.dataset.inc)].include = e.target.checked; };
}

// ---------------------------------------------------------------- members

async function membersScreen(root, ctx) {
  const all = db.live('members').sort((a, b) => (a.role === 'hub' ? -1 : b.role === 'hub' ? 1 : a.name.localeCompare(b.name)));
  root.innerHTML = `
    <p class="muted small">VJ and MM. <b>Export data</b> makes a full backup file for that person: use it to put their history back on a new or reset phone (Restore from a backup file).</p>
    <div class="card list" style="padding:0 12px">${all.map((m) => {
      const l = sync.lastSyncAt(m.id);
      const n = db.live('transactions').filter((t) => t.ownerId === m.id).length;
      return `<div class="list-item"><span class="avatar" style="background:color-mix(in srgb, ${esc(m.color)} 25%, transparent)">${esc(m.name[0] || '?')}</span>
        <span class="main"><span class="title">${esc(m.name)} ${m.role === 'hub' ? '<span class="chip">Hub</span>' : ''}${m.archived ? '<span class="chip">removed</span>' : ''}</span>
        <span class="sub">${n} entries · ${m.id === cfg.memberId ? 'this computer' : l ? 'last file ' + esc(relTime(l.at)) : 'no file received yet'}</span></span>
        <button class="btn small" data-export="${esc(m.id)}">Export data</button></div>`;
    }).join('')}</div>`;
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.export) {
      try {
        const { pkg, fileName, count } = await sync.buildMemberPackage({ full: true, forMemberId: b.dataset.export });
        if (await shareOrDownload(fileName, JSON.stringify(pkg))) toast(`${count} records exported. Use “Restore from a backup file” on the phone.`, { timeout: 6000 });
      } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
    }
  };
}

// ---------------------------------------------------------------- send to members

async function sendScreen(root, ctx) {
  const pend = cats.pending().length;
  root.innerHTML = `
    ${pend ? `<div class="banner">${pend} category ${pend === 1 ? 'is' : 'are'} still waiting for review. <a href="#/categories">Review first</a> so members get the cleaned list.</div>` : ''}
    <div class="card stack"><h2>Create family package</h2>
      <p class="muted small">Contains the master categories, budgets and member list. Members import it in <b>Sync → Import</b>. The same file works for everyone.</p>
      <label class="check"><input type="checkbox" id="ents" checked> Include everyone's entries, so VJ and MM can each see the family's spending</label>
      <label class="check"><input type="checkbox" id="summ" checked> Include the read-only family summary (monthly totals, top categories)</label>
      <label class="field"><span>Password (optional)</span><input id="pw" type="password" autocomplete="new-password" placeholder="Leave empty for no encryption"></label>
      <div class="row"><button class="btn primary" data-make>Create &amp; share / download</button></div>
      <p class="muted small">Last imported by members: see <a href="#/members">Members</a>.</p>
    </div>`;
  root.onclick = async (e) => {
    if (!e.target.closest('[data-make]')) return;
    try {
      const { pkg, fileName, count } = await sync.buildFamilyPackage({ includeSummary: $('#summ', root).checked, entries: $('#ents', root).checked });
      let text = JSON.stringify(pkg);
      const pw = $('#pw', root).value.trim();
      if (pw) text = await sync.encryptText(text, pw);
      if (await shareOrDownload(fileName, text)) {
        await db.put('syncLog', { id: crypto.randomUUID(), direction: 'export', memberId: cfg.memberId, fileName, recordCount: count, at: new Date().toISOString() }, { silent: true });
        toast('Family package ready');
      }
    } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
  };
}

// ---------------------------------------------------------------- master file

async function masterFileScreen(root, ctx) {
  const st = hubfile.status;
  const counts = ['transactions', 'categories', 'members'].map((s) => `${db.live(s).length} ${s}`).join(' · ');
  root.innerHTML = `
    <div class="card stack"><h2>Master file</h2>
      ${hubfile.supported ? `
        <p>${st.linked ? `✅ Linked to <b>${esc(st.name)}</b>. It is saved automatically after every change.` : 'Not linked yet. Choose where family.json should live, for example <code>D:\\Money\\family.json</code>.'}</p>
        ${st.linked ? `<p class="small muted">Last saved: ${st.lastSaved ? esc(new Date(st.lastSaved).toLocaleString()) : 'not yet'}${st.needsPermission ? ' · <b class="danger-text">permission needed</b>' : ''}${st.error ? ' · ' + esc(st.error) : ''}</p>` : ''}
        <div class="row">
          <button class="btn primary" data-link>${st.linked ? 'Choose a different file…' : 'Create / choose family.json…'}</button>
          <button class="btn" data-open>Open existing family.json…</button>
          ${st.linked ? '<button class="btn" data-save>Save now</button><button class="btn" data-unlink>Unlink</button>' : ''}
        </div>`
        : `<div class="banner">This browser can't save to a file automatically. Use Chrome or Edge on the laptop for auto-save. Meanwhile you can download a copy manually.</div>`}
      <div class="row"><button class="btn" data-dl>⬇ Download a copy now</button><button class="btn" data-restorefile>Restore from a family.json file…</button></div>
      <p class="muted small">Holds ${esc(counts)}. Copy it to Google Drive or a pen drive monthly. To restore on a fresh browser, choose <b>Open existing family.json</b>.</p>
    </div>`;
  hubfile.onStatus(() => { if (location.hash.startsWith('#/masterfile')) ctx.refresh(); });
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if ('link' in b.dataset) { toast('Linked ' + (await hubfile.link())); ctx.refresh(); }
      else if ('open' in b.dataset) {
        const res = await hubfile.openExisting();
        await tx.ensureSelfMember();
        toast(`Loaded ${res.count} records`); ctx.refresh();
      } else if ('save' in b.dataset) { toast((await hubfile.save({ ask: true })) ? 'Saved' : 'Could not save'); ctx.refresh(); }
      else if ('unlink' in b.dataset) { await hubfile.unlink(); ctx.refresh(); }
      else if ('dl' in b.dataset) await hubfile.downloadMaster();
      else if ('restorefile' in b.dataset) {
        const [file] = await pickFiles();
        if (file && (await confirmDialog('Merge this family.json into this computer? Newer records win; nothing is deleted.', { okText: 'Restore' }))) {
          const res = await hubfile.restoreFromText(await file.text());
          toast(`Restored ${res.count} records`); ctx.refresh();
        }
      }
    } catch (err) { if (err.name !== 'AbortError') toast(err.message, { timeout: 6000 }); }
  };
}

// ---------------------------------------------------------------- live sync

let host = null;
const liveState = { code: '', text: '', kind: 'idle' };

function paintLive() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('live-code', liveState.code ? liveState.code.replace(/(\d{3})(\d{3})/, '$1 $2') : '');
  set('live-status', liveState.text);
  const stopBtn = document.getElementById('live-stop');
  const startBtn = document.getElementById('live-start');
  const active = !!host;
  if (stopBtn) stopBtn.hidden = !active;
  if (startBtn) startBtn.hidden = active;
  document.getElementById('live-codebox')?.toggleAttribute('hidden', !(active && liveState.code));
}

async function liveScreen(root, ctx) {
  root.innerHTML = `
    <div class="card stack"><h2>Live sync with a phone</h2>
      <p class="muted small">VJ's and MM's phones can sync directly with this laptop when you are on the same wifi. No files to send. Both devices need the internet connection to be on (only the handshake uses it; your data goes device to device).</p>
      <div id="live-codebox" class="center" hidden><div class="muted small">On the phone, open <b>Sync → Live sync</b> and enter</div><div id="live-code" class="amount-input num" style="letter-spacing:.2em"></div></div>
      <p id="live-status" role="status"></p>
      <div class="row"><button class="btn primary" id="live-start">Start waiting for a phone</button><button class="btn" id="live-stop" hidden>Stop</button></div>
      <p class="muted small">If a phone can't connect (some routers stop devices talking to each other), use <a href="#/import">file import</a> instead. Both ways merge the same data.</p>
    </div>`;
  paintLive();
  $('#live-start', root).onclick = async () => {
    liveState.text = 'Starting…'; liveState.code = ''; liveState.kind = 'wait';
    try {
      host = await live.hostSession({
        code: (c) => { liveState.code = c; paintLive(); },
        status: (t, kind) => { liveState.text = t; liveState.kind = kind; if (kind === 'idle' || kind === 'error') host = null; paintLive(); },
        confirm: (name) => confirmDialog(`${name} wants to sync with this laptop. Allow?`, { okText: 'Allow', title: 'Sync request' }),
        done: () => { host = null; liveState.code = ''; paintLive(); },
      });
    } catch (e) { liveState.text = e.message; host = null; }
    paintLive();
  };
  $('#live-stop', root).onclick = () => { host?.stop(); host = null; liveState.code = ''; paintLive(); };
}

// ---------------------------------------------------------------- routes

export const hubRoutes = {
  dashboard: { title: 'Family dashboard', render: dashboardScreen },
  add: { title: (c) => (c.params.get('id') ? 'Edit entry' : 'Add entry'), render: entryScreen },
  transactions: { title: 'All transactions', render: transactionsScreen },
  position: { title: 'Balances', render: positionScreen },
  reports: { title: 'Family reports', render: reportsScreen },
  live: { title: 'Live sync', render: liveScreen },
  category: { title: categoryTitle, render: categoryDetailScreen, back: categoryBack, navId: 'reports' },
  import: { title: 'Import center', render: importScreen },
  categories: { title: 'Master categories', render: (r, c) => categoriesScreen(r, c, { hub: true }) },
  budgets: { title: 'Budgets', render: (r, c) => budgetsScreen(r, c, { hub: true }) },
  members: { title: 'Members', render: membersScreen },
  send: { title: 'Send to members', render: sendScreen },
  masterfile: { title: 'Master file', render: masterFileScreen },
  settings: { title: 'Settings', render: settingsScreen },
  accounts: { title: 'My accounts', render: accountsScreen, back: 'settings', navId: 'settings' },
  recurring: { title: 'Recurring', render: recurringScreen, back: 'settings', navId: 'settings' },
};

export const hubNav = [
  { id: 'dashboard', ico: '📊', label: 'Dashboard', tab: true },
  { id: 'transactions', ico: '🧾', label: 'Transactions', tab: true },
  { id: 'add', ico: '＋', label: 'Add entry', tab: true },
  { id: 'import', ico: '📥', label: 'Import center', tab: true },
  { id: 'live', ico: '📡', label: 'Live sync' },
  { id: 'position', ico: '🏦', label: 'Balances' },
  { id: 'reports', ico: '📈', label: 'Reports' },
  { id: 'categories', ico: '🗂️', label: 'Categories' },
  { id: 'budgets', ico: '🎯', label: 'Budgets' },
  { id: 'members', ico: '👪', label: 'Members' },
  { id: 'send', ico: '📤', label: 'Send to members' },
  { id: 'masterfile', ico: '💾', label: 'Master file' },
  { id: 'settings', ico: '⚙️', label: 'Settings' },
];
