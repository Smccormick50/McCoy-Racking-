# Racking Inventory Tracker — Firebase Version

A multi-device inventory tracker. All data is stored in **Firebase Firestore** and synced in real time across every browser that opens the site.

## Setup steps (one time)

### 1. Set Firestore security rules
1. Go to https://console.firebase.google.com/ → your `racking-inventory-tracker` project
2. Build → Firestore Database → **Rules** tab
3. Replace what's there with the contents of `firestore.rules` (in this folder)
4. Click **Publish**

### 2. Upload the site to GitHub Pages
Drop all the files from this folder into your GitHub repo, exactly like before:
- `index.html`
- `style.css`
- `app.js`
- `data.js`
- `firebase-config.js`  ← new
- `README.md`

That's it. Open the site, type your name in the User field at the top, and start using it. The first time it loads, it'll seed the parts list into Firestore automatically. Every later visit just connects to the live data.

## What's different from the localStorage version

- A green **"Live"** badge in the header shows when you're connected to Firebase.
- The **All Invoices** section at the bottom is a full table that updates in real time across every device — open it on your phone, create an invoice on your laptop, you'll see it appear on the phone within a second.
- Click **View** on any invoice row to expand its full line-item detail right in the table.
- Each invoice still has **PDF**, **Edit**, and **Delete** buttons.
- Inventory data is shared — if two people are using the site at once, they see the same numbers.

## Important notes

- **Internet required.** The site won't work offline.
- **Security.** The current rules let anyone with the link read and write everything. If you share the URL publicly, anyone who finds it can use the system. For a small private team that's usually fine, but tell me if you want password protection added.
- **Cost.** Firebase free tier covers up to 50,000 reads and 20,000 writes per day, which is far more than this site will ever use. You won't hit a bill unless something goes wrong.
- **Backups.** Firebase keeps your data but doesn't auto-backup. If you want regular exports, ask and I'll add an "Export all to Excel" button.

## File reference

- `index.html` — main page
- `style.css` — design
- `data.js` — initial part list (only used the very first time, to seed Firestore)
- `firebase-config.js` — your Firebase project's API keys
- `app.js` — all the inventory + invoice logic
- `firestore.rules` — security rules to paste into Firebase
