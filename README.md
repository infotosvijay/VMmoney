# VM Money

Offline PWA for family income/expense tracking. See `../family-money-manager-plan.md` for the design.
Plain HTML/CSS/JS: no build step.

## Run locally
Service workers need http(s) or localhost:

    cd money-manager
    python -m http.server 8123      # then open http://localhost:8123

## Deploy (GitHub Pages)
Push this folder's contents to a public repo and enable Pages. All paths are relative, so it works under
`https://<user>.github.io/<repo>/`. **Never change the URL afterwards: browser data is tied to it.**

## Releasing an update
1. Edit code.
2. Bump `APP_VERSION` in `js/version.js` (this renames the cache and triggers "Update available").
3. If you add a file, add it to `ASSETS` in `sw.js`.
4. DB changes: bump `DB_VERSION` in `js/db.js` and add an `if (old < N)` block that only adds stores/fields.

## Layout
- `js/db.js` IndexedDB + in-memory mirror, `js/sync.js` packages and merge rules, `js/hubfile.js` family.json auto-save
- `js/ui/*` screens (member, hub, shared, settings), `css/styles.css` responsive layout

## Live sync (optional)
Laptop: Live sync → Start (shows a 6-digit code). Phone: Sync → Live sync → enter the code. Uses WebRTC via PeerJS
(`js/vendor/peerjs.min.js`, broker `0.peerjs.com` for the handshake only; data goes device to device).
File sync still works and merges the same data.
