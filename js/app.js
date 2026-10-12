// Startup, mode selection, routing, install + update handling.

import * as db from './db.js';
import { cfg } from './db.js';
import { esc, FAMILY, familyMember } from './models.js';
import * as cats from './categories.js';
import * as tx from './transactions.js';
import * as recurring from './recurring.js';
import * as sync from './sync.js';
import * as hubfile from './hubfile.js';
import * as lock from './lock.js';
import { $, applyTheme, toast, pickFiles, promptDialog, pickDialog, destroyCharts, sheet, shareOrDownload } from './ui/components.js';
import { memberRoutes, memberNav } from './ui/member-screens.js';
import { hubRoutes, hubNav } from './ui/hub-screens.js';

const VERSION = self.APP_VERSION || 'dev';
let current = null; // {routes, nav, home}

// ---------- boot ----------

async function main() {
  try {
    await db.init();
  } catch (e) {
    $('#boot').innerHTML = `<div class="onboard"><h1>Can't open storage</h1><p>${esc(e.message)}</p><p class="muted">Private/incognito windows and some locked-down browsers block local storage. Open the app in a normal window.</p></div>`;
    return;
  }
  applyTheme();
  registerServiceWorker();
  setupInstall();

  try {
    if (!cfg.mode || !cfg.memberId) await onboarding();
    await startApp();
  } catch (e) {
    console.error(e);
    $('#boot').hidden = false;
    $('#boot').innerHTML = `<div class="onboard"><h1>Something went wrong</h1><p>${esc(e.message)}</p></div>`;
  }
}

async function startApp() {
  await cats.seedDefaults();
  await tx.ensureFamilyMembers();
  await tx.ensureSelfMember();
  await tx.ensureDefaultAccount();
  await db.setCfg('schemaVersion', 1);
  db.requestPersistence();

  const created = await recurring.runDue();
  if (created) toast(`${created} recurring ${created === 1 ? 'entry' : 'entries'} added`);

  current = cfg.mode === 'hub'
    ? { routes: hubRoutes, nav: hubNav, home: 'dashboard' }
    : { routes: memberRoutes, nav: memberNav, home: 'transactions' };

  if (cfg.mode === 'hub') {
    await hubfile.restoreHandle();
    hubfile.onStatus((s) => {
      if (s.needsPermission && !startApp.warned) {
        startApp.warned = true;
        toast('Master file needs permission to keep saving', { action: 'Allow', onAction: () => hubfile.save({ ask: true }), timeout: 0 });
      }
    });
  }

  $('#boot').hidden = true;
  $('#app').hidden = false;
  buildNav();
  window.addEventListener('hashchange', render);
  document.addEventListener('click', onGlobalClick);
  lock.initLock();
  await render();
}

// ---------- routing ----------

const ctx = {
  get params() { return parseHash().params; },
  go(path) { location.hash = '#/' + path.replace(/^\/+/, ''); },
  refresh() { return render(); },
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { route: path || current.home, params: new URLSearchParams(qs || '') };
}

async function render() {
  const { route } = parseHash();
  const def = current.routes[route] || current.routes[current.home];
  const id = current.routes[route] ? route : current.home;
  // fresh #view each render: drops listeners the previous screen attached
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  const y = window.scrollY;
  destroyCharts();
  const title = typeof def.title === 'function' ? def.title(ctx) : def.title;
  const logo = !def.back && (id === current.home) ? '<img class="top-logo" src="icons/logo-160.png" alt="" width="24" height="31">' : '';
  $('#topbar').innerHTML = `${logo}${def.back ? `<a class="btn small" href="#/${typeof def.back === 'function' ? def.back(ctx) : def.back}" aria-label="Back">←</a>` : ''}<h1>${esc(title)}</h1>${def.topAction ? def.topAction(ctx) : ''}`;
  document.title = `${title} · VM Money`;
  view.innerHTML = '';
  try {
    await def.render(view, ctx);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
  highlightNav(def.navId || id);
  window.scrollTo(0, route === ctx._lastRoute ? y : 0);
  ctx._lastRoute = route;
}

// ---------- navigation ----------

function navHTML(items, cls) {
  return items.map((n) => `<a class="nav-item ${n.id === 'add' ? 'add' : ''}" data-nav="${n.id}" href="#/${n.id}" ${cls === 'tab' ? '' : ''}><span class="ico">${n.ico}</span><span>${esc(n.label)}</span></a>`).join('');
}

function buildNav() {
  const items = current.nav;
  $('#side').innerHTML = `<div class="brand"><img src="icons/logo-160.png" alt="" width="30" height="39"> VM Money</div>${navHTML(items)}<div class="spacer"></div><div class="muted small" style="padding:8px 12px">${esc(cfg.memberName)} · ${cfg.mode === 'hub' ? 'Hub' : 'Member'} · ${esc(VERSION)}</div>`;
  const tabs = items.filter((n) => n.tab);
  $('#tabbar').innerHTML = navHTML(tabs) + `<button type="button" class="nav-item" data-more><span class="ico">☰</span><span>More</span></button>`;
}

function highlightNav(id) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === id));
  const more = $('[data-more]');
  if (more) more.classList.toggle('active', !current.nav.some((n) => n.tab && n.id === id));
}

async function onGlobalClick(e) {
  if (e.target.closest('[data-more]')) {
    const rest = current.nav.filter((n) => !n.tab);
    sheet('More', `<div class="list">${rest.map((n) => `<a class="list-item" href="#/${n.id}" data-close><span class="avatar">${n.ico}</span><span class="main">${esc(n.label)}</span></a>`).join('')}</div>`);
    return;
  }
  const act = e.target.closest('[data-action]')?.dataset.action;
  if (act === 'install') {
    const p = window.__installPrompt;
    if (p) { p.prompt(); await p.userChoice; window.__installPrompt = null; render(); }
  } else if (act === 'dismiss-install') {
    await db.setCfg('installDismissed', true);
    render();
  }
}

// ---------- onboarding ----------

function onboarding() {
  return new Promise((resolve) => {
    const boot = $('#boot');
    boot.className = '';
    let mode = null;
    let who = null;
    const hubOK = hubfile.supported;
    boot.innerHTML = `
      <div class="onboard">
        <img src="icons/logo-160.png" alt="" width="72" height="94" style="display:block;margin:0 0 10px">
        <h1>VM Money</h1>
        <p class="muted">Income, expenses and balances for VJ and MM. Works offline; your data stays on your devices.</p>
        <form id="ob" class="stack" style="margin-top:14px">
          <div>
            <b>Who are you?</b>
            <div class="row" style="margin-top:8px">${FAMILY.map((f) => `<button type="button" class="mode-card grow" data-who="${f.id}" style="margin-top:0"><b style="font-size:1.3rem;text-align:center">${f.name}</b></button>`).join('')}</div>
          </div>
          <div>
            <b>What is this device?</b>
            <button type="button" class="mode-card" data-mode="member"><b>📱 Phone</b><span class="muted small">Daily entry of income, expenses and balances.</span></button>
            <button type="button" class="mode-card" data-mode="hub"><b>💻 Laptop (Family Hub)</b><span class="muted small">Collects both phones' files, builds family reports, keeps the master backup.${hubOK ? '' : ' (Best in Chrome or Edge.)'}</span></button>
          </div>
          <button class="btn primary" style="width:100%">Get started</button>
          <button type="button" class="btn" id="restore">Restore from a backup file</button>
          <p class="muted small" id="ob-msg" role="alert"></p>
        </form>
      </div>`;
    const form = $('#ob', boot);
    const msg = $('#ob-msg', boot);
    const pick = (attr, cb) => boot.querySelectorAll(`[data-${attr}]`).forEach((b) => b.onclick = () => {
      cb(b.dataset[attr]);
      boot.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
    });
    pick('mode', (v) => { mode = v; });
    pick('who', (v) => { who = v; });

    const finish = async (opts) => {
      const f = familyMember(opts.memberId) || { name: opts.name, color: opts.color };
      await db.setCfg('mode', opts.mode);
      await db.setCfg('memberId', opts.memberId);
      await db.setCfg('memberName', f.name);
      await db.setCfg('memberColor', f.color);
      await db.setCfg('currency', cfg.currency || 'INR');
      await db.setCfg('theme', cfg.theme || 'auto');
      await db.setCfg('createdAt', cfg.createdAt || new Date().toISOString());
      resolve();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!who) { msg.textContent = 'Tell me whether you are VJ or MM.'; return; }
      if (!mode) { msg.textContent = 'Choose Phone or Laptop.'; return; }
      await finish({ mode, memberId: who });
    };
    $('#restore', boot).onclick = async () => {
      if (!mode) { msg.textContent = 'Choose Phone or Laptop first, then restore.'; return; }
      try {
        if (mode === 'hub') {
          await cats.seedDefaults();
          let res;
          if (hubOK) res = await hubfile.openExisting();
          else { const [file] = await pickFiles(); if (!file) return; res = await hubfile.restoreFromText(await file.text()); }
          await finish({ mode, memberId: familyMember(res.hubMemberId) ? res.hubMemberId : who || FAMILY[0].id });
        } else {
          const [file] = await pickFiles();
          if (!file) return;
          const pkg = await sync.readPackageFile(file, (n) => promptDialog({ title: 'Password', label: `Password for ${n}`, type: 'password', okText: 'Open' }));
          if (pkg.packageType !== 'member') throw new Error('Pick a phone backup file (mm-member-….json).');
          await finish({ mode, memberId: familyMember(pkg.fromMemberId) ? pkg.fromMemberId : who || FAMILY[0].id });
          await cats.seedDefaults();
          await sync.applyMemberPackage(sync.previewMemberPackage(pkg));
          toast('Backup restored');
        }
      } catch (err) {
        if (err.name !== 'AbortError') msg.textContent = err.message;
      }
    };
  });
}

// ---------- install prompt + service worker ----------

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; if (current) render(); });
  window.addEventListener('appinstalled', () => { window.__installPrompt = null; toast('Installed'); });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const announce = (worker) => toast('Update available', { action: 'Refresh', timeout: 0, onAction: () => applyUpdate(worker) });
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('SW registration failed', e));

  // Reload only when an UPDATE takes over; the very first install must not interrupt the user.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

async function applyUpdate(worker) {
  const choice = await pickDialog('Update ready', [['backup', 'Back up my data first, then update'], ['go', 'Update now']], {
    message: 'Your data stays on this device. A backup copy is a good habit before updating.',
  });
  if (!choice) return;
  if (choice === 'backup') {
    try {
      if (cfg.mode === 'hub') {
        if (!(await hubfile.save({ ask: true }))) await hubfile.downloadMaster();
      } else {
        const { pkg, count, fileName } = await sync.buildMemberPackage({ full: true });
        const ok = await shareOrDownload(fileName, JSON.stringify(pkg));
        if (!ok) return;
        await sync.commitExport({ fileName, count, createdAt: pkg.createdAt });
      }
    } catch (e) { toast('Backup failed: ' + e.message); return; }
  }
  worker.postMessage('SKIP_WAITING');
}

main();
