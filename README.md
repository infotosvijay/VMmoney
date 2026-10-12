# VM Money

Offline app (PWA) for VJ and MM: income and expenses, balances (banks, cash, credit cards), budgets and reports.
Plain HTML, CSS and JavaScript: no build step, no server, no monthly cost. Your data stays on your own devices.

- **Phones** (VJ and MM) record entries and balances, fully offline.
- **Laptop (Family Hub)** merges both phones' data, builds family reports and keeps the master backup `family.json`.
- Phones and laptop sync by **live sync** (6-digit code) or by **sending files**.

---

## 1. Publish on GitHub Pages (one time)

Phones can only install the app and use it offline when it is served over `https://`, so host it on GitHub Pages.
The repo holds only the app code, never your money data.

### 1.1 Create the repo
1. Sign in at github.com and click **New repository**.
2. Name it, for example `vm-money`. Choose **Public** (free Pages needs a public repo on a free account;
   a private repo needs a paid GitHub plan). Do not add a README or other files.
3. Click **Create repository**.

### 1.2 Upload the app
The files in this folder (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `icons/` ...) must sit at the
**top level of the repo**, not inside a sub-folder.

With git (from this folder):

    git init
    git add .
    git commit -m "VM Money"
    git branch -M main
    git remote add origin https://github.com/<your-user>/vm-money.git
    git push -u origin main

No git? On the empty repo page choose **uploading an existing file**, drag in everything from this folder
(including the `css`, `js` and `icons` folders) and commit.

### 1.3 Turn on Pages
1. In the repo open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Choose branch **main** and folder **/ (root)**, then **Save**.
4. Wait 1 to 2 minutes and refresh. The page shows your address:

        https://<your-user>.github.io/vm-money/

5. Open that address once in a browser to check the VM Money welcome screen loads.

All paths in the app are relative, so it works under that `/vm-money/` sub-path with no changes.

### 1.4 Rules that protect your data
- **Never change the address.** Browser storage belongs to that exact URL. Renaming the repo or changing your GitHub
  username makes every device look empty. If you ever must move, make a full backup on each phone first.
- **Everyone uses the same address**, installed once per device and opened from the home-screen icon.
- You can unpublish Pages later without losing anything on installed devices, but new phones can't install and
  nothing updates until you publish again at the same address. Keep the repo; don't delete or rename it.

---

## 2. First use

### Laptop (Family Hub)
1. Open the address in **Chrome or Edge**.
2. Choose **VJ** or **MM** (whoever's laptop it is), then **Laptop (Family Hub)**, then **Get started**.
3. Go to **Master file → Create / choose family.json…** and pick a folder such as `D:\Money`.
   The hub then saves there automatically after every change. Copy that file to Google Drive or a pen drive monthly.

### Each phone
1. Open the address in **Chrome (Android)** or **Safari (iPhone)**.
2. Install it:
   - Android: tap **Install** in the banner, or browser menu → *Install app*.
   - iPhone: **Share → Add to Home Screen**.
3. Open the installed app, choose **VJ** or **MM**, then **Phone**.
4. Set up **Balances** (banks, cash, credit cards, and who pays each card). You can also use
   *Balances → Overview → Import old sheet* for an export from the old Expense.html.
5. Optional: **More → Settings → App lock** to add a PIN or fingerprint.

---

## 3. Everyday use

| Where | What |
|---|---|
| **Entries** (opens first) | This month's entries. The big **＋** adds one: pick the amount, **Today / Yesterday / Pick date**, category, then Save. |
| **Summary** | Month totals, top categories, budget alerts, money position. |
| **Balances** | Banks, cash and cards for VJ and MM, who pays each card, shortage check. |
| **More** | Reports, Budgets, Family view, Sync, Categories, Settings. |
| **Transfer** | In the add form, *Transfer → With VJ/MM* records money moved between the two of you (not income or expense). Record it on one phone only. |

Categories and subcategories are the ones VJ and MM already use. Add more any time with **＋ New** in the add form
or in **More → Categories**.

---

## 4. Syncing phones and laptop

### Live sync (same wifi)
1. Laptop: open **Live sync** and tap **Start waiting for a phone**. A 6-digit code appears.
2. Phone: **More → Sync → Live sync**, enter the code, tap **Sync now**.
3. Laptop: tap **Allow**. The phone sends its changes and receives the family update.

Needs the wifi to have internet (only a small handshake goes through the free PeerJS service; the data travels
device to device). If the router blocks devices from reaching each other (guest wifi, client isolation), use files.

### File sync (works anywhere)
- **Phone → laptop:** phone **Sync → Send changes**, share the file to the laptop (WhatsApp, Nearby Share, email, USB),
  then laptop **Import center → drop the file → Merge**.
- **Laptop → phone:** laptop **Send to members → Create family package**, send it to each phone, then phone
  **Sync → Import a file**.

### Seeing each other's spending and balances
Every sync also brings back the **other person's entries** (read-only) and the shared **Balances** (banks, cash, cards).
On a phone, Entries and Reports then show **Mine / <other person> / Family**, and Summary shows *Family spending*.
Data is only as fresh as the last sync: VJ sees MM's latest after MM has synced with the laptop, then VJ syncs.
When creating a family package by file, keep "Include everyone's entries" ticked.

Both methods use the same merge rules, so mix them freely. Importing the same file twice changes nothing.

---

## 5. Backup and restore
- **Phone backup:** *Sync → Full backup (everything)*. Keep a copy somewhere safe.
- **New or reset phone:** open the app, choose VJ/MM and Phone, then **Restore from a backup file**.
  If the phone is lost with no backup, the laptop can recreate it: **Members → Export data** for that person.
- **Laptop:** the app auto-saves `family.json`. To restore on a fresh browser choose **Restore from a backup file**
  at first launch (Chrome/Edge reopen the file directly; other browsers pick a copy).
- **Bring old history to a phone:** import the CSV on the laptop (*Settings → Import old entries (CSV)*; a `Member` column
  of VJ or MM decides whose entries they are), then run **Live sync** from that person's phone: their entries come back to the phone.
  Without live sync, use *Members → Export data* on the laptop and *Sync → Import a file* on the phone.
  Keep personal CSV/Excel files out of the GitHub repo.
- **Old entries from a spreadsheet:** *Settings → Import old entries (CSV)* with columns
  Date, Time (optional), Member (optional), Type, Category, Subcategory, Amount, Account (Online or Cash), To account (transfers), Note.

---

## 6. Updating the app
1. Change the code.
2. Bump `APP_VERSION` in `js/version.js` (e.g. `v1.5.0` to `v1.5.1`). This is what makes devices notice the update.
3. If you add a new file, add it to `ASSETS` in `sw.js` so it works offline.
4. Database changes: raise `DB_VERSION` in `js/db.js` and add an `if (old < N)` block that only **adds**
   stores or fields. Never delete user data.
5. Commit and push. GitHub Pages republishes in a minute or two.
6. Each device shows **Update available → Refresh** the next time the app opens online. It offers a backup first.
   If it doesn't appear: *Settings → Check for updates*, then close and reopen the app.
   Do not use "Clear site data": that erases the entries.

---

## 7. Troubleshooting
| Problem | Fix |
|---|---|
| Page 404 after enabling Pages | Wait a couple of minutes. Check `index.html` is at the repo root, branch `main`, folder `/ (root)`. |
| App looks blank or old after an update | Open it online, tap **Refresh** on the update prompt, or *Settings → Check for updates*. |
| Can't install on iPhone | Use **Safari**, then Share → Add to Home Screen. |
| Live sync says "No laptop is waiting" | Check the 6-digit code and that the laptop shows *Waiting*. Codes expire after 10 minutes. |
| Live sync says "Could not connect directly" | The wifi blocks device-to-device traffic. Use file sync. |
| Hub can't auto-save `family.json` | Use Chrome or Edge on the laptop, and click **Allow** if the master-file banner asks for permission. |
| Everything is empty | The address changed or browser data was cleared. Restore from a backup file. |

---

## 8. Run locally (for testing)
Service workers need `https` or `localhost`:

    cd money-manager
    python -m http.server 8123      # then open http://localhost:8123

## 9. Project layout
- `index.html`, `manifest.json`, `sw.js` (offline cache), `css/styles.css`
- `js/db.js` IndexedDB, `js/models.js` helpers, `js/categories.js` default categories,
  `js/transactions.js`, `js/holdings.js` (Balances), `js/budgets.js`, `js/recurring.js`, `js/reports.js`
- `js/sync.js` file packages and merge rules, `js/livesync.js` live sync, `js/hubfile.js` family.json auto-save,
  `js/csvimport.js`, `js/lock.js`
- `js/ui/*` screens: member, hub, shared, settings, position (Balances), components
- `js/vendor/` Chart.js and PeerJS (bundled so everything works offline)
