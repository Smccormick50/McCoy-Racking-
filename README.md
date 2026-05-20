# Mc Racking — Inventory Tracker

A live multi-device racking inventory and invoicing app, branded for Mc Racking.

## Setup steps (one time)

### 1. Update Firestore security rules
1. Firebase Console → Firestore Database → **Rules** tab
2. Paste in the contents of `firestore.rules`, click **Publish**

(Important: the rules now cover 6 collections — make sure to re-publish or Recovery and admin features will not save.)

### 2. Upload to GitHub Pages
Drop ALL files in this folder into your repo:

**Main app**
- `index.html`, `style.css`, `app.js`, `data.js`, `firebase-config.js`

**Admin** (new)
- `admin.html`, `admin.js`

**Branding / PWA**
- `manifest.json`, `mc-logo.png`, `icon-32.png`, `icon-180.png`, `icon-192.png`, `icon-512.png`, `favicon.png`

**Docs**
- `README.md`, `firestore.rules`

## Admin page

Tap the **ADMIN** button in the header (top right) and enter the password.

**Default password: `McCoys1927`** — change it by editing line 5 of `admin.js`:
```js
const ADMIN_PASSWORD = "McCoys1927";
```

The admin page has 5 tabs:

- **Parts / Inventory** — click any cell to edit (name, quantities, cost, threshold); add new parts; delete parts.
- **Users** — add or remove names from the User dropdown.
- **Store Locations** — add or remove stores from the Location dropdown.
- **Recovery** — restore the last 10 deleted invoices or parts. Older deletions are permanently gone. Restoring an invoice re-deducts inventory and refuses if stock isn't available.
- **Audit Log** — every admin change is recorded here, showing who, when, what, before → after. Last 500 entries.

Admins must select their own name from the Admin User dropdown at the top of the admin page before making changes — that's how the audit log knows who did what.

## Install as an app (iPhone / Android)

**iPhone (Safari):** Share button → Add to Home Screen → Add
**Android (Chrome):** ⋮ menu → Install app (or Add to Home Screen) → Add

## What's in the main app

- User dropdown (managed from admin page)
- Store/location dropdown (managed from admin page)
- Up to 24 line items per invoice
- Live invoice list at the bottom, syncs across devices
- Edit / Delete any invoice — quantities restore automatically
- PDF download
- Connection status badge

## Notes

- Site needs internet.
- The admin password is stored in the JavaScript file. Anyone tech-savvy who views the page source can find it. That's fine for keeping the average warehouse user from clicking "delete part" by accident; it's not real security. Ask if you ever want proper login accounts with Firebase Authentication.
- The free Firebase tier is far more than this site will use.

## File reference

| File | Purpose |
|---|---|
| `index.html` | Main page |
| `style.css` | Branded styling for both pages |
| `app.js` | Main page logic |
| `admin.html` | Admin page (password gated) |
| `admin.js` | Admin page logic + audit log writes |
| `data.js` | Initial parts/users/locations seed data (used once) |
| `firebase-config.js` | Firebase project keys |
| `manifest.json` | PWA manifest |
| `mc-logo.png` / `icon-*.png` / `favicon.png` | Branding images |
| `firestore.rules` | Security rules — paste into Firebase console |
