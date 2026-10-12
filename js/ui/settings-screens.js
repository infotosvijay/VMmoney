// Screens shared by Member and Hub: categories, budgets, accounts, recurring, settings.

import * as db from '../db.js';
import { cfg } from '../db.js';
import { esc, familyMember, ACCOUNT_TYPES, FREQUENCIES, labelOf, thisMonth, monthLabel } from '../models.js';
import * as cats from '../categories.js';
import * as tx from '../transactions.js';
import * as budgets from '../budgets.js';
import * as recurring from '../recurring.js';
import * as lock from '../lock.js';
import * as csv from '../csvimport.js';
import { onSwipe, $, $$, money, toast, pickFiles, sheet, confirmDialog, promptDialog, pickDialog, empty, progress, applyTheme, relTime } from './components.js';

const VERSION = self.APP_VERSION || 'dev';
const fmem = () => familyMember(cfg.memberId);

// ================================================================ categories

let catType = 'expense';
let showArchived = false;

const catLabel = (c) => (c.parentId ? `${cats.name(c.parentId)} › ${c.name}` : c.name);

export async function categoriesScreen(root, ctx, { hub = false } = {}) {
  const tree = cats.tree(catType, { includeArchived: showArchived });
  const pend = hub ? cats.pending() : [];

  root.innerHTML = `
    ${pend.length ? `<div class="card"><div class="card-head"><h2>Review new categories <span class="badge">${pend.length}</span></h2></div>
      <p class="muted small">Created by family members. Accept, rename or merge each one, then send the cleaned list in the next family package.</p>
      <div class="list">${pend.map((c) => `<div class="list-item"><span class="avatar">${esc(c.icon || '🏷️')}</span><span class="main"><span class="title">${esc(catLabel(c))}</span><span class="sub">${esc(c.type)} · by ${esc(tx.memberName(c.createdBy))} · ${cats.usageCount(c.id)} entries</span></span>
        <span class="row"><button class="btn small primary" data-accept="${esc(c.id)}">Accept</button><button class="btn small" data-act="${esc(c.id)}">…</button></span></div>`).join('')}</div></div>` : ''}
    <div class="row between" style="margin-bottom:12px">
      <div class="seg" style="min-width:200px"><button data-ct="expense" class="${catType === 'expense' ? 'on' : ''}">Expense</button><button data-ct="income" class="${catType === 'income' ? 'on' : ''}">Income</button></div>
      <div class="row"><label class="check small"><input type="checkbox" id="arch" ${showArchived ? 'checked' : ''}> Show archived</label><button class="btn primary small" data-addmain>+ Category</button></div>
    </div>
    ${tree.length ? tree.map(({ cat, subs }) => `
      <div class="card" style="padding:6px 12px">
        <div class="list-item" style="border:0">
          <span class="avatar" style="background:color-mix(in srgb, ${esc(cat.color)} 20%, transparent)">${esc(cat.icon || '🏷️')}</span>
          <span class="main"><span class="title">${esc(cat.name)} ${cat.archived ? '<span class="chip">archived</span>' : ''}${cat.pendingReview ? '<span class="chip">new</span>' : ''}</span><span class="sub">${subs.length} subcategories · ${cats.usageCount(cat.id)} entries</span></span>
          <span class="row" style="flex-wrap:nowrap"><button class="icon-btn" data-up="${esc(cat.id)}" aria-label="Move up">↑</button><button class="icon-btn" data-down="${esc(cat.id)}" aria-label="Move down">↓</button><button class="icon-btn" data-act="${esc(cat.id)}" aria-label="Actions">⋯</button></span>
        </div>
        ${subs.map((s) => `<div class="list-item" style="padding-left:20px"><span class="main"><span class="title">${esc(s.name)} ${s.archived ? '<span class="chip">archived</span>' : ''}${s.pendingReview ? '<span class="chip">new</span>' : ''}</span><span class="sub">${cats.usageCount(s.id)} entries</span></span>
          <span class="row" style="flex-wrap:nowrap"><button class="icon-btn" data-up="${esc(s.id)}" aria-label="Move up">↑</button><button class="icon-btn" data-down="${esc(s.id)}" aria-label="Move down">↓</button><button class="icon-btn" data-act="${esc(s.id)}" aria-label="Actions">⋯</button></span></div>`).join('')}
      </div>`).join('') : empty('No categories.')}`;

  $('#arch', root).onchange = (e) => { showArchived = e.target.checked; ctx.refresh(); };
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.ct) { catType = d.ct; ctx.refresh(); }
    else if ('addmain' in d) {
      const name = await promptDialog({ title: `New ${catType} category`, label: 'Name' });
      if (name?.trim()) { await cats.create({ name, type: catType }); ctx.refresh(); }
    } else if (d.up) { await cats.reorder(d.up, -1); ctx.refresh(); }
    else if (d.down) { await cats.reorder(d.down, 1); ctx.refresh(); }
    else if (d.accept) { await cats.accept(d.accept); toast('Accepted'); ctx.refresh(); }
    else if (d.act) categoryActions(d.act, ctx);
  };
  // swipe left / right to move between Expense and Income categories
  onSwipe(root, (dir) => {
    const order = ['expense', 'income'];
    const n = order.indexOf(catType) + (dir === 'next' ? 1 : -1);
    if (n < 0 || n >= order.length) return false;
    catType = order[n];
    ctx.refresh();
  });
}

async function categoryActions(id, ctx) {
  const c = cats.get(id);
  const used = cats.usageCount(id);
  const opts = [['edit', 'Rename / change icon & colour']];
  if (!c.parentId) opts.push(['addsub', 'Add subcategory']);
  else opts.push(['move', 'Move to another category']);
  opts.push(['merge', 'Merge into another…']);
  opts.push([c.archived ? 'unarchive' : 'archive', c.archived ? 'Unarchive' : 'Archive (keep old entries, hide from new)']);
  if (!used && !db.live('categories').some((x) => x.parentId === id)) opts.push(['delete', 'Delete']);
  const choice = await pickDialog(catLabel(c), opts);
  if (!choice) return;
  try {
    if (choice === 'edit') await editCategory(c);
    else if (choice === 'addsub') {
      const name = await promptDialog({ title: `New subcategory in ${c.name}`, label: 'Name' });
      if (name?.trim()) await cats.create({ name, type: c.type, parentId: id });
    } else if (choice === 'move') {
      const mains = cats.tree(c.type).filter((x) => x.cat.id !== c.parentId).map((x) => [x.cat.id, `${x.cat.icon} ${x.cat.name}`]);
      const to = await pickDialog(`Move “${c.name}” to…`, mains);
      if (to) { await cats.moveSub(id, to); toast('Moved. Its entries moved too.'); }
    } else if (choice === 'merge') {
      const same = db.live('categories').filter((x) => x.id !== id && x.type === c.type && !!x.parentId === !!c.parentId && !x.archived).map((x) => [x.id, catLabel(x)]);
      const into = await pickDialog(`Merge “${catLabel(c)}” into…`, same, { message: 'All entries move to the one you pick, and this category disappears.' });
      if (into && (await confirmDialog(`Merge “${catLabel(c)}” into “${catLabel(cats.get(into))}”? This can't be undone.`, { okText: 'Merge', danger: true }))) {
        await cats.mergeInto(id, into); toast('Merged');
      }
    } else if (choice === 'archive' || choice === 'unarchive') await cats.setArchived(id, choice === 'archive');
    else if (choice === 'delete') await db.update('categories', id, { deleted: true });
  } catch (e) { toast(e.message); }
  ctx.refresh();
}

function editCategory(c) {
  return new Promise((resolve) => {
    const s = sheet('Edit category', `<form class="stack">
      <label class="field"><span>Name</span><input name="name" value="${esc(c.name)}" required maxlength="40"></label>
      ${c.parentId ? '' : `<label class="field"><span>Icon (an emoji)</span><input name="icon" value="${esc(c.icon)}" maxlength="4"></label>
      <label class="field"><span>Colour</span><input name="color" type="color" value="${esc(c.color)}"></label>`}
      <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, { onClose: resolve });
    const f = $('form', s.el);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const patch = { name: f.name.value.trim(), pendingReview: c.pendingReview && cfg.mode !== 'hub' };
      if (!c.parentId) { patch.icon = f.icon.value.trim(); patch.color = f.color.value; }
      await cats.rename(c.id, patch);
      s.close();
    };
  });
}

// ================================================================ budgets

export async function budgetsScreen(root, ctx, { hub = false } = {}) {
  const month = thisMonth();
  const sts = budgets.statuses({ month, memberOnly: !hub });
  const editable = (b) => hub || b.ownerId === cfg.memberId;

  root.innerHTML = `
    <div class="row between" style="margin-bottom:12px"><b>${esc(monthLabel(month))}</b><button class="btn primary small" data-add>+ Budget</button></div>
    ${sts.length ? sts.map((s) => `<div class="card"><div class="row between"><b>${esc(s.label)}</b>
        <span class="muted small">${s.budget.scope === 'family' ? 'Family' : esc(tx.memberName(s.budget.memberId))}${editable(s.budget) ? '' : ' · set by Hub'}</span></div>
        ${progress(s.pct, s.level)}
        <div class="row between small" style="margin-top:6px"><span class="num ${s.level === 'over' ? 'danger-text' : ''}">${money(s.used)} of ${money(s.budget.limit)} (${Math.round(s.pct)}%)</span>
          ${editable(s.budget) ? `<span class="row"><button class="btn small" data-edit="${esc(s.budget.id)}">Edit</button><button class="btn small" data-del="${esc(s.budget.id)}">Delete</button></span>` : ''}</div>
        ${s.partial ? '<p class="muted small">Showing only your own spending. The Hub\'s next family package (with summary) gives the full family figure.</p>' : ''}
      </div>`).join('') : empty('No budgets yet.', hub ? 'Set monthly limits for the family or for each member.' : 'Add a monthly limit for a category you want to watch.')}`;

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('add' in b.dataset) budgetSheet(null, { hub }, ctx);
    else if (b.dataset.edit) budgetSheet(db.get('budgets', b.dataset.edit), { hub }, ctx);
    else if (b.dataset.del && (await confirmDialog('Delete this budget?', { okText: 'Delete', danger: true }))) { await budgets.remove(b.dataset.del); ctx.refresh(); }
  };
}

function budgetSheet(existing, { hub }, ctx) {
  const tree = cats.tree('expense');
  const members = tx.members();
  const cur = existing || { scope: hub ? 'family' : 'member', memberId: cfg.memberId, categoryId: '', subcategoryId: '', limit: '' };
  const s = sheet(existing ? 'Edit budget' : 'New budget', `<form class="stack">
    ${hub ? `<label class="field"><span>Applies to</span><select name="scope"><option value="family" ${cur.scope === 'family' ? 'selected' : ''}>Whole family</option><option value="member" ${cur.scope === 'member' ? 'selected' : ''}>One member</option></select></label>
      <label class="field" id="memwrap"><span>Member</span><select name="member">${members.map((m) => `<option value="${esc(m.id)}" ${m.id === cur.memberId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>` : ''}
    <label class="field"><span>Category</span><select name="cat" required><option value="">Choose…</option>${tree.map((x) => `<option value="${esc(x.cat.id)}" ${x.cat.id === cur.categoryId ? 'selected' : ''}>${esc(x.cat.icon)} ${esc(x.cat.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Subcategory (optional)</span><select name="sub"></select></label>
    <label class="field"><span>Monthly limit (${esc(cfg.currency || 'INR')})</span><input name="limit" type="number" inputmode="decimal" min="1" step="any" value="${esc(cur.limit)}" required></label>
    <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
  const f = $('form', s.el);
  const fillSubs = () => {
    const subs = tree.find((x) => x.cat.id === f.cat.value)?.subs || [];
    f.sub.innerHTML = '<option value="">Whole category</option>' + subs.map((x) => `<option value="${esc(x.id)}" ${x.id === cur.subcategoryId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  };
  fillSubs();
  f.cat.onchange = () => { cur.subcategoryId = ''; fillSubs(); };
  const memwrap = $('#memwrap', s.el);
  const toggleMem = () => { if (memwrap) memwrap.hidden = f.scope.value !== 'member'; };
  if (f.scope) { f.scope.onchange = toggleMem; toggleMem(); }
  f.onsubmit = async (e) => {
    e.preventDefault();
    await budgets.save({
      id: existing?.id, scope: f.scope ? f.scope.value : 'member', memberId: f.member ? f.member.value : cfg.memberId,
      categoryId: f.cat.value, subcategoryId: f.sub.value, limit: f.limit.value,
    });
    s.close(); ctx.refresh();
  };
}

// ================================================================ accounts

export async function accountsScreen(root, ctx) {
  const accs = tx.myAccounts({ includeArchived: true });
  root.innerHTML = `
    <p class="muted small">Every entry is paid from <b>Online</b> (bank, UPI, card) or <b>Cash</b>. Balances come from your entries plus the opening balance you set here.</p>
    <div class="card list" style="padding:0 12px">${accs.map((a) => `<div class="list-item"><span class="avatar">${a.type === 'cash' ? '💵' : '🏦'}</span>
      <span class="main"><span class="title">${esc(a.name)}</span><span class="sub">Opening balance ${money(a.openingBalance || 0)}</span></span>
      <span class="num">${money(tx.accountBalance(a))}</span><button class="btn small" data-edit="${esc(a.id)}">Edit</button></div>`).join('')}</div>`;
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b?.dataset.edit) return;
    const acc = db.get('accounts', b.dataset.edit);
    const v = await promptDialog({ title: `${acc.name}: opening balance`, label: 'Opening balance', type: 'number', value: String(acc.openingBalance || 0), help: 'The amount in this account before your first entry in the app.' });
    if (v == null) return;
    await db.update('accounts', acc.id, { openingBalance: Number(v) || 0 });
    ctx.refresh();
  };
}

// ================================================================ recurring

export async function recurringScreen(root, ctx) {
  const items = recurring.list();
  root.innerHTML = `<p class="muted small">Recurring entries are created when due. Add one from the Add Entry screen using “Repeat”.</p>
    ${items.length ? `<div class="card list" style="padding:0 12px">${items.map((r) => `<div class="list-item"><span class="avatar">🔁</span>
      <span class="main"><span class="title">${esc(cats.pathLabel(r.template))} · ${money(r.template.amount)}</span><span class="sub">${esc(labelOf(FREQUENCIES, r.frequency))} · next ${esc(r.nextDate)}${r.active ? '' : ' · paused'}${r.template.note ? ' · ' + esc(r.template.note) : ''}</span></span>
      <span class="row" style="flex-wrap:nowrap"><button class="btn small" data-toggle="${esc(r.id)}">${r.active ? 'Pause' : 'Resume'}</button><button class="btn small" data-del="${esc(r.id)}">Delete</button></span></div>`).join('')}</div>` : empty('Nothing repeats yet.')}`;
  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toggle) { const r = db.get('recurring', b.dataset.toggle); await recurring.setActive(r.id, !r.active); ctx.refresh(); }
    else if (b.dataset.del && (await confirmDialog('Stop and delete this recurring entry? Past entries stay.', { okText: 'Delete', danger: true }))) { await recurring.remove(b.dataset.del); ctx.refresh(); }
  };
}

// ================================================================ settings

export async function settingsScreen(root, ctx) {
  const est = await db.storageEstimate();
  const mb = (n) => (n / 1048576).toFixed(1);
  root.innerHTML = `
    <div class="card stack"><h2>Profile</h2>
      <p>You are <b>${esc(cfg.memberName)}</b> on this ${cfg.mode === 'hub' ? 'laptop (Family Hub)' : 'phone'}.</p>
      <div class="form-grid">
        <label class="field"><span>Currency</span><select id="cur">${['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'].map((c) => `<option ${cfg.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field"><span>Theme</span><select id="theme">${[['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${(cfg.theme || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="card"><h2>Manage</h2><div class="list">
      <a class="list-item" href="#/accounts"><span class="avatar">🏦</span><span class="main">Accounts</span>›</a>
      <a class="list-item" href="#/categories"><span class="avatar">🗂️</span><span class="main">Categories &amp; subcategories</span>›</a>
      <a class="list-item" href="#/recurring"><span class="avatar">🔁</span><span class="main">Recurring entries</span>›</a>
    </div></div>
    <div class="card stack"><h2>App lock</h2>
      <p class="muted small">${lock.hasPin() ? 'A 4-digit PIN protects this app.' : 'Add a PIN so others using your device can\'t open your money data.'}</p>
      <div class="row"><button class="btn" data-pin>${lock.hasPin() ? 'Change PIN' : 'Set PIN'}</button>
        ${lock.hasPin() ? '<button class="btn" data-rmpin>Remove lock</button>' : ''}
        ${lock.hasPin() && lock.biometricSupported() ? `<button class="btn" data-bio>${lock.hasBiometric() ? 'Turn off fingerprint/face' : 'Use fingerprint / face'}</button>` : ''}</div>
      ${lock.hasPin() ? `<label class="field"><span>Auto-lock after</span><select id="autolock">${[[0, 'Never'], [1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [15, '15 minutes']].map(([v, l]) => `<option value="${v}" ${Number(cfg.autoLockMinutes ?? 2) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="card stack"><h2>Data &amp; storage</h2>
      <p class="small">${cfg.persisted ? '✅ Storage is protected from automatic clean-up.' : '⚠️ The browser may clear this app\'s data if the device runs low on space. Install the app to your home screen to prevent that.'}</p>
      ${est ? `<p class="muted small">Using ${mb(est.usage || 0)} MB of about ${mb(est.quota || 0)} MB available.</p>` : ''}
      <div class="row"><button class="btn" data-csv>Import old entries (CSV)…</button></div>
      <p class="muted small">Columns: Date, Type, Category, Subcategory, Amount, Account (Online or Cash), Note (the same as this app's CSV export). Entries already here are skipped.</p>
      <div class="row"><button class="btn" data-persist>Request protection</button><button class="btn danger" data-wipe>Erase all data on this device</button></div>
    </div>
    <div class="card stack"><h2>This device</h2>
      <p class="small">Mode: <b>${cfg.mode === 'hub' ? 'Family Hub' : 'Member'}</b></p>
      <div class="row"><button class="btn" data-mode>Switch to ${cfg.mode === 'hub' ? 'Member' : 'Family Hub'} mode</button></div>
    </div>
    <div class="card stack"><h2>About</h2>
      <p class="row small"><img src="icons/logo-160.png" alt="" width="36" height="47"> <span><b>VM Money</b> · ${esc(VERSION)}</span></p>
      <p class="muted small">Your data lives only on your devices. Nothing is sent to any server.</p>
      <div class="row"><button class="btn" data-update>Check for updates</button></div>
    </div>`;

  const save = async (k, v) => { await db.setCfg(k, v); };
  $('#cur', root).onchange = (e) => save('currency', e.target.value);
  $('#theme', root).onchange = async (e) => { await save('theme', e.target.value); applyTheme(); };
  $('#autolock', root)?.addEventListener('change', (e) => save('autoLockMinutes', Number(e.target.value)));

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if ('pin' in d) await pinFlow();
    else if ('rmpin' in d) { if (await verifyThen('Enter your current PIN to remove the lock')) { await lock.removeLock(); toast('Lock removed'); } }
    else if ('bio' in d) {
      try {
        if (lock.hasBiometric()) { await db.delCfg('bioCredId'); toast('Fingerprint/face turned off'); }
        else { await lock.enableBiometric(); toast('Fingerprint/face enabled'); }
      } catch (err) { toast('Could not set up biometrics on this device'); }
    } else if ('csv' in d) { await csvFlow();
    } else if ('persist' in d) { toast((await db.requestPersistence()) ? 'Storage protected' : 'Browser declined. Try installing the app.'); }
    else if ('wipe' in d) {
      if (await confirmDialog('Erase ALL data on this device? Make sure you have sent a backup first.', { okText: 'Continue', danger: true })
        && (await confirmDialog('This permanently deletes every entry, category and setting here. Really erase?', { okText: 'Erase everything', danger: true }))) {
        await db.wipeAll();
        location.hash = '';
        location.reload();
        return;
      }
    } else if ('mode' in d) {
      const to = cfg.mode === 'hub' ? 'member' : 'hub';
      if (await confirmDialog(`Switch this device to ${to === 'hub' ? 'Family Hub' : 'Member'} mode? Your data stays, but screens and sync options change. ${to === 'member' ? 'Hub-only tools (import, master file) will be hidden.' : ''}`, { okText: 'Switch' })) {
        await db.setCfg('mode', to);
        await tx.ensureSelfMember();
        location.hash = '';
        location.reload();
      }
    } else if ('update' in d) {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) return toast('Updates are checked automatically when online.');
      toast('Checking for updates…');
      try { await reg.update(); setTimeout(() => { if (!reg.waiting && !reg.installing) toast('You have the latest version'); }, 1500); } catch { toast('Could not check (offline?)'); }
    }
  };

  async function csvFlow() {
    try {
      const [file] = await pickFiles({ accept: '.csv,text/csv' });
      if (!file) return;
      const plan = csv.planImport(await file.text());
      const lines = [`${plan.items.length} entries to add`, plan.duplicates ? `${plan.duplicates} already here (skipped)` : '', plan.skipped.length ? `${plan.skipped.length} unreadable rows (skipped)` : '', plan.newCategories.size ? `New categories: ${[...plan.newCategories].slice(0, 6).join(', ')}${plan.newCategories.size > 6 ? '…' : ''}` : ''].filter(Boolean);
      if (!plan.items.length) return toast(lines.join(' · ') || 'Nothing to import');
      if (await confirmDialog(lines.join('. ') + '. Import now?', { okText: 'Import' })) { const n = await csv.applyImport(plan); toast(`Imported ${n} entries`); }
    } catch (err) { toast(err.message, { timeout: 6000 }); }
  }

  async function verifyThen(title) {
    const pin = await promptDialog({ title, label: 'PIN', type: 'password', okText: 'Continue' });
    if (pin == null) return false;
    if (await lock.verifyPin(pin)) return true;
    toast('Wrong PIN');
    return false;
  }

  async function pinFlow() {
    if (lock.hasPin() && !(await verifyThen('Enter your current PIN'))) return;
    const a = await promptDialog({ title: 'New PIN', label: '4 digits', type: 'password' });
    if (a == null) return;
    if (!/^\d{4}$/.test(a)) return toast('PIN must be exactly 4 digits');
    const b = await promptDialog({ title: 'Confirm PIN', label: 'Enter it again', type: 'password' });
    if (b !== a) return toast('PINs did not match');
    await lock.setPin(a);
    toast('PIN saved');
    ctx.refresh();
  }
}
