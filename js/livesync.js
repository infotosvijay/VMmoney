// Live sync over a direct WebRTC connection (PeerJS), paired by QR code or a 6-digit code.
//  - phone <-> laptop hub: the phone sends its changes (and the other phone's, if it has newer ones), gets the family update.
//  - phone <-> phone: the two phones swap only what the other is missing, no laptop needed.
// One device hosts (shows the QR / code), the other joins. The QR also carries a one-time key, so a scanned
// pairing needs no "Allow" tap; a typed code still asks the host to allow it.
//
// Only the tiny connection handshake goes through PeerJS's public broker; the data itself travels
// device-to-device (encrypted by WebRTC) and never touches a server. Needs the router to be online.
// Same package format and merge rules as file sync, so the methods can be mixed freely.

import { cfg } from './db.js';
import * as sync from './sync.js';

const PREFIX = 'fmm-vm-';
const QR_TAG = 'VMM1';
const PROTO = 2; // 2: QR key, roles, phone <-> phone
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
const newKey = () => [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(36).padStart(2, '0')).join('');

/** Pairing text in the QR code. */
const qrText = (code, key) => `${QR_TAG}:${code}:${key}`;

/** Reads a scanned QR or a typed code. Returns { code, key } or null. */
export function parsePairing(text) {
  const t = String(text || '').trim();
  const m = t.match(new RegExp(`^${QR_TAG}:(\\d{6}):([a-z0-9]+)$`, 'i'));
  if (m) return { code: m[1], key: m[2] };
  const digits = t.replace(/\D/g, '');
  return /^\d{6}$/.test(digits) && !/[a-z]/i.test(t) ? { code: digits, key: '' } : null;
}

function friendly(err) {
  const t = err?.type || '';
  if (t === 'peer-unavailable') return 'Nobody is waiting with that code. Check the code and that the other device shows "Waiting".';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the connection service. Check that the wifi has internet, or use file sync.';
  if (t === 'webrtc') return 'Could not connect directly. Some wifi networks block devices from reaching each other; use file sync instead.';
  return err?.message || 'Live sync failed';
}

const DENY_TEXT = {
  update: 'The other device has a different app version. Update both devices, then try again.',
  same: 'Both phones belong to the same person. Phone sync is between VJ\'s and MM\'s phones.',
  user: 'The other device declined the request.',
};

// ---------------------------------------------------------------- host: laptop or phone waits for a phone

/**
 * Starts waiting for one phone. `ui` callbacks: code(code, qrText), status(text, kind),
 * confirm(name) -> Promise<bool>, done(result). Returns { stop() }.
 */
export async function hostSession(ui) {
  await loadPeerLib();
  const isHub = cfg.mode === 'hub';
  let peer;
  let stopped = false;
  let busy = false;
  let timer;
  let key = '';

  const stop = (text) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try { peer?.destroy(); } catch { /* ignore */ }
    if (text) ui.status(text, 'idle');
  };

  async function open(attempt = 0) {
    const code = newCode();
    key = newKey();
    peer = new window.Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => {
      ui.code(code, qrText(code, key));
      ui.status(isHub ? 'Waiting for a phone…' : 'Waiting for the other phone…', 'wait');
      timer = setTimeout(() => stop('Timed out after 10 minutes. Start again when ready.'), HOST_TTL_MS);
    });
    peer.on('error', (err) => {
      if (stopped) return;
      if (err.type === 'unavailable-id' && attempt < 5) { try { peer.destroy(); } catch { /* ignore */ } return open(attempt + 1); }
      stop();
      ui.status(friendly(err), 'error');
    });
    peer.on('connection', (conn) => {
      if (busy) { conn.on('open', () => conn.close()); return; }
      busy = true;
      handle(conn).catch((e) => { ui.status(e.message, 'error'); }).finally(() => { busy = false; });
    });
  }

  const deny = (conn, reason) => { conn.send({ t: 'denied', reason }); setTimeout(() => conn.close(), 300); };

  async function handle(conn) {
    const inbox = makeInbox(conn);
    const hello = await inbox.next('hello', STEP_TIMEOUT_MS);
    const name = hello.name || 'A phone';
    if (!isHub && (hello.proto || 0) < PROTO) return deny(conn, 'update');
    if (!isHub && hello.memberId === cfg.memberId) return deny(conn, 'same');
    // a scanned QR carries the key; a typed code needs a tap on "Allow"
    if (!(key && hello.key === key)) {
      ui.status(`${name} is asking to sync…`, 'work');
      if (!(await ui.confirm(name))) {
        deny(conn, 'user');
        ui.status('You declined that request. Still waiting…', 'wait');
        return;
      }
    }
    if (isHub) return hubHandle(conn, inbox, name);
    conn.send({ t: 'ready', role: 'member', memberId: cfg.memberId, name: cfg.memberName, proto: PROTO });
    const r = await peerExchange(conn, inbox, { memberId: hello.memberId, name }, (t) => ui.status(t, 'work'));
    ui.status(`Synced with ${name}'s phone: ${r.sent} sent, ${r.got} received.`, 'done');
    ui.done?.({ ...r, peer: 'member' });
    stop();
  }

  async function hubHandle(conn, inbox, name) {
    conn.send({ t: 'ready', role: 'hub', proto: PROTO });
    ui.status(`Receiving data from ${name}…`, 'work');

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
    // don't echo back what the phone has only just sent us
    const sentKeys = (k) => new Set([...(pkg.records[k] || []), ...(pkg.records.relay?.[k] || [])].map((r) => `${r.id}|${r.updatedAt}`));
    const fam = await sync.buildFamilyPackage({ includeSummary: true, ownFor: pkg.fromMemberId, since: pkg.full ? null : pkg.since, entries: true, entriesExcept: pkg.fromMemberId,
      justReceived: Object.fromEntries(['transactions', 'accounts', 'recurring'].map((k) => [k, sentKeys(k)])),
    });
    conn.send({ t: 'family', pkg: fam.pkg, applied });
    await inbox.next('done', STEP_TIMEOUT_MS).catch(() => {});
    ui.status(`Synced with ${preview.name}: ${applied} records received, family update sent.`, 'done');
    ui.done?.({ peer: 'hub', name: preview.name, got: applied });
    stop();
  }

  await open();
  return { stop: () => stop('Stopped.') };
}

// ---------------------------------------------------------------- phone: join a laptop or the other phone

/**
 * Joins whoever hosts `pairing` ({ code, key } from parsePairing). Resolves with
 * { peer: 'hub', sent, restored } or { peer: 'member', name, sent, got }.
 */
export async function join(pairing, onStatus = () => {}) {
  if (!pairing || !/^\d{6}$/.test(pairing.code)) throw new Error('The code is 6 digits.');
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
    const overall = setTimeout(() => finish(new Error('Timed out. Is the other device still showing "Waiting"?')), 3 * 60 * 1000);

    onStatus('Connecting…');
    peer = new window.Peer({ debug: 0 });
    peer.on('error', (e) => finish(new Error(friendly(e))));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + pairing.code, { reliable: true });
      conn.on('error', (e) => finish(new Error(friendly(e))));
      conn.on('close', () => { if (!succeeded) finish(new Error('The other device closed the connection.')); });
      conn.on('open', async () => {
        try {
          const inbox = makeInbox(conn);
          onStatus(pairing.key ? 'Connected…' : 'Waiting for the other device to allow…');
          conn.send({ t: 'hello', memberId: cfg.memberId, name: cfg.memberName, key: pairing.key || '', proto: PROTO });
          const reply = await inbox.next(['ready', 'denied'], STEP_TIMEOUT_MS);
          if (reply.t === 'denied') throw new Error(DENY_TEXT[reply.reason] || DENY_TEXT.user);
          let result;
          if (reply.role === 'member') {
            if (reply.memberId === cfg.memberId) throw new Error(DENY_TEXT.same);
            const r = await peerExchange(conn, inbox, { memberId: reply.memberId, name: reply.name || 'Phone' }, onStatus, () => { succeeded = true; });
            result = { peer: 'member', ...r };
          } else {
            result = await hubExchange(conn, inbox, onStatus);
            succeeded = true;
          }
          setTimeout(() => finish(null, result), 300);
        } catch (e) { finish(e); }
      });
    });
  });
}

/** Phone side of a laptop sync: send my changes, apply the family update. */
async function hubExchange(conn, inbox, onStatus) {
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
  conn.send({ t: 'done' });
  const restored = (fam.records.own?.transactions || []).filter((t) => !t.deleted).length;
  return { peer: 'hub', sent: built.count, restored };
}

/** Both phones run this: swap version lists, send what the other lacks, apply what arrives. */
async function peerExchange(conn, inbox, other, onStatus, onApplied = () => {}) {
  onStatus(`Comparing with ${other.name}'s phone…`);
  conn.send({ t: 'have', have: sync.peerManifest() });
  const theirs = await inbox.next('have', STEP_TIMEOUT_MS);
  const out = await sync.buildPeerPackage(other.memberId, theirs.have);
  onStatus('Swapping changes…');
  conn.send({ t: 'peer', pkg: out.pkg });
  const msg = await inbox.next('peer', STEP_TIMEOUT_MS);
  const pkg = await sync.validatePackage(msg.pkg, 'Phone data');
  if (pkg.packageType !== 'peer' || pkg.fromMemberId !== other.memberId) throw new Error('Unexpected data from the other phone');
  pkg.fileName = `phone sync with ${other.name}`;
  const got = await sync.applyPeerPackage(sync.previewPeerPackage(pkg));
  onApplied();
  conn.send({ t: 'done' });
  await inbox.next('done', STEP_TIMEOUT_MS).catch(() => {});
  return { name: other.name, sent: out.count, got };
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
