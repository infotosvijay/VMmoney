// Live sync: phone <-> laptop hub over a direct WebRTC connection (PeerJS), paired with a 6-digit code.
//
// Only the tiny connection handshake goes through PeerJS's public broker; the data itself travels
// device-to-device (encrypted by WebRTC) and never touches a server. Needs the router to be online.
// Same package format and merge rules as file sync, so the two methods can be mixed freely.

import { cfg } from './db.js';
import * as sync from './sync.js';

const PREFIX = 'fmm-vm-';
const HOST_TTL_MS = 10 * 60 * 1000;
const STEP_TIMEOUT_MS = 90 * 1000;

let libLoad;
function loadPeerLib() {
  if (window.Peer) return Promise.resolve();
  libLoad ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/peerjs.min.js', import.meta.url).href;
    s.onload = res;
    s.onerror = () => { libLoad = null; rej(new Error('Could not load the sync library')); };
    document.head.append(s);
  });
  return libLoad;
}

const newCode = () => String(Math.floor(100000 + Math.random() * 900000));

function friendly(err) {
  const t = err?.type || '';
  if (t === 'peer-unavailable') return 'No laptop is waiting with that code. Check the code and that the laptop shows "Waiting".';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the connection service. Check that the wifi has internet, or use file sync.';
  if (t === 'webrtc') return 'Could not connect directly. Some wifi networks block devices from reaching each other; use file sync instead.';
  return err?.message || 'Live sync failed';
}

// ---------------------------------------------------------------- hub (laptop): wait for a phone

/**
 * Starts waiting for one phone. `ui` callbacks: status(text, kind), confirm(name) -> Promise<bool>.
 * Returns { stop() }.
 */
export async function hostSession(ui) {
  await loadPeerLib();
  let peer;
  let stopped = false;
  let busy = false;
  let timer;

  const stop = (text) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try { peer?.destroy(); } catch { /* ignore */ }
    if (text) ui.status(text, 'idle');
  };

  async function open(attempt = 0) {
    const code = newCode();
    peer = new window.Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => {
      ui.code(code);
      ui.status('Waiting for a phone…', 'wait');
      timer = setTimeout(() => stop('Timed out after 10 minutes. Start again when ready.'), HOST_TTL_MS);
    });
    peer.on('error', (err) => {
      if (stopped) return;
      if (err.type === 'unavailable-id' && attempt < 5) { try { peer.destroy(); } catch { /* ignore */ } return open(attempt + 1); }
      stop(friendly(err));
      ui.status(friendly(err), 'error');
    });
    peer.on('connection', (conn) => {
      if (busy) { conn.on('open', () => conn.close()); return; }
      busy = true;
      handle(conn).catch((e) => { ui.status(e.message, 'error'); }).finally(() => { busy = false; });
    });
  }

  async function handle(conn) {
    const inbox = makeInbox(conn);
    const hello = await inbox.next('hello', STEP_TIMEOUT_MS);
    ui.status(`${hello.name || 'A phone'} is asking to sync…`, 'work');
    if (!(await ui.confirm(hello.name || 'A phone'))) {
      conn.send({ t: 'denied' });
      ui.status('You declined that request. Still waiting…', 'wait');
      setTimeout(() => conn.close(), 300);
      return;
    }
    conn.send({ t: 'ready' });
    ui.status('Receiving data…', 'work');

    let msg = await inbox.next('member', STEP_TIMEOUT_MS);
    let pkg = await sync.validatePackage(msg.pkg, 'Phone data');
    if (pkg.packageType !== 'member') throw new Error('Unexpected data from the phone');
    let preview = sync.previewMemberPackage(pkg);
    if (preview.gap && !pkg.full) {
      // changes since a send this laptop never received: ask for everything instead
      conn.send({ t: 'need-full' });
      ui.status('Asking the phone for a full copy…', 'work');
      msg = await inbox.next('member', STEP_TIMEOUT_MS);
      pkg = await sync.validatePackage(msg.pkg, 'Phone data');
      preview = sync.previewMemberPackage(pkg);
    }
    pkg.fileName = 'live sync';
    const applied = await sync.applyMemberPackage(preview);
    const fam = await sync.buildFamilyPackage({ includeSummary: true, ownFor: pkg.fromMemberId, since: pkg.full ? null : pkg.since, entries: true, entriesExcept: pkg.fromMemberId,
      justReceived: Object.fromEntries(['transactions', 'accounts', 'recurring'].map((k) => [k, new Set((pkg.records[k] || []).map((r) => `${r.id}|${r.updatedAt}`))])),
    });
    conn.send({ t: 'family', pkg: fam.pkg, applied });
    await inbox.next('done', STEP_TIMEOUT_MS).catch(() => {});
    ui.status(`Synced with ${preview.name}: ${applied} records received, family update sent.`, 'done');
    ui.done?.(preview.name, applied);
    stop();
  }

  await open();
  return { stop: () => stop('Stopped.') };
}

// ---------------------------------------------------------------- phone: connect to the laptop

/** Connect with the laptop's code, send my changes, apply the family update. Resolves with a summary. */
export async function syncWithHub(code, onStatus = () => {}) {
  if (!/^\d{6}$/.test(code)) throw new Error('The code is 6 digits.');
  await loadPeerLib();
  return new Promise((resolve, reject) => {
    let peer;
    let finished = false;
    let succeeded = false;
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(overall);
      try { peer?.destroy(); } catch { /* ignore */ }
      err ? reject(err instanceof Error ? err : new Error(friendly(err))) : resolve(val);
    };
    const overall = setTimeout(() => finish(new Error('Timed out. Is the laptop still showing "Waiting"?')), 3 * 60 * 1000);

    onStatus('Connecting…');
    peer = new window.Peer({ debug: 0 });
    peer.on('error', (e) => finish(new Error(friendly(e))));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('error', (e) => finish(new Error(friendly(e))));
      conn.on('close', () => { if (!succeeded) finish(new Error('The laptop closed the connection.')); });
      conn.on('open', async () => {
        try {
          const inbox = makeInbox(conn);
          onStatus('Waiting for the laptop to accept…');
          conn.send({ t: 'hello', memberId: cfg.memberId, name: cfg.memberName });
          const reply = await inbox.next(['ready', 'denied'], STEP_TIMEOUT_MS);
          if (reply.t === 'denied') throw new Error('The laptop declined the request.');
          onStatus('Sending my changes…');
          let built = await sync.buildMemberPackage({ full: false });
          conn.send({ t: 'member', pkg: built.pkg });
          // the hub either answers with the family update, or first asks for a full copy
          const answer = await inbox.next(['family', 'need-full'], STEP_TIMEOUT_MS);
          let famMsg = answer;
          if (answer.t === 'need-full') {
            onStatus('Sending a full copy…');
            built = await sync.buildMemberPackage({ full: true });
            conn.send({ t: 'member', pkg: built.pkg });
            famMsg = await inbox.next('family', STEP_TIMEOUT_MS);
          }
          onStatus('Applying the family update…');
          const fam = await sync.validatePackage(famMsg.pkg, 'Family update');
          fam.fileName = 'live sync';
          await sync.applyFamilyPackage(sync.previewFamilyPackage(fam));
          await sync.commitExport({ fileName: 'live sync', count: built.count, createdAt: built.pkg.createdAt });
          succeeded = true;
          conn.send({ t: 'done' });
          const restored = (fam.records.own?.transactions || []).filter((t) => !t.deleted).length;
          setTimeout(() => finish(null, { sent: built.count, restored }), 300);
        } catch (e) { finish(e); }
      });
    });
  });
}

// ---------------------------------------------------------------- helpers

/** Tiny async message queue: await inbox.next('type'). Messages arriving early are kept. */
function makeInbox(conn) {
  const queue = [];
  const waiters = [];
  conn.on('data', (msg) => {
    const i = waiters.findIndex((w) => w.ts.includes(msg?.t));
    if (i >= 0) { const [w] = waiters.splice(i, 1); clearTimeout(w.timer); w.res(msg); } else queue.push(msg);
  });
  conn.on('close', () => waiters.splice(0).forEach((w) => { clearTimeout(w.timer); w.rej(new Error('Connection closed')); }));
  return {
    next(t, ms) {
      const ts = [].concat(t);
      const i = queue.findIndex((m) => ts.includes(m?.t));
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const w = { ts, res, rej, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error('The other device stopped responding.')); }, ms) };
        waiters.push(w);
      });
    },
  };
}
