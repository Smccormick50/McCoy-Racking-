# Mc Racking — Inventory Tracker (Auth Version)

Real Firebase email/password login, per-user audit trail, role-based access.

## Setup (one time)

### 1. Enable Email/Password authentication
1. Firebase Console → **Authentication** → **Sign-in method**
2. Click **Email/Password** → toggle **Enable** → Save

### 2. Publish the Firestore rules
1. Firebase Console → **Firestore Database** → **Rules** tab
2. Paste in the contents of `firestore.rules`, click **Publish**

### 3. Add your GitHub Pages domain to Authorized domains
1. Authentication → **Settings** tab → **Authorized domains**
2. Add `yourusername.github.io` (already added if you did this earlier)

### 4. Create the 10 accounts in Firebase Console
1. Authentication → **Users** tab → **Add user**
2. Enter email + password for each of the 10 accounts (8 admin + 2 warehouse)
3. Copy each user's **UID** (long string under their email)

### 5. Add each user's profile in Firestore
1. Firestore → **Data** tab → **Start collection**
2. Collection ID: `users`
3. Document ID: paste the UID from step 4
4. Add fields:
   - `email` (string): the email you used
   - `displayName` (string): real name (e.g. "Steven McCormick")
   - `role` (string): either `"admin"` or `"warehouse"`
5. Repeat for all 10 accounts

That's it. People can now sign in at your site URL.

## Roles

**Admin** (8 logins)
- Sees the Admin link in the header on the main page
- Full access to admin page: edit parts, manage users, manage locations, recovery, export, audit log
- Their login name auto-fills as the "user" on invoices

**Warehouse** (2 logins)
- Sees only the main page (admin link hidden)
- Cannot delete invoices, edit parts, or change settings
- Picks their actual name (Carlos, Alex, etc.) from the User dropdown for each invoice
- The dropdown list is managed by admins on the admin page

## Upload to GitHub Pages
All 18 files in this folder go to the root of your repo:

- `index.html`, `admin.html`, `login.html`
- `app.js`, `admin.js`, `login.js`, `firebase-config.js`, `data.js`
- `style.css`
- `manifest.json`
- `firestore.rules`, `README.md`
- 6 image files (`mc-logo.png`, `icon-*.png`, `favicon.png`)

## How to add a new account later
Same as setup steps 4 + 5:
1. Firebase Auth → Add user → set their email and a temporary password
2. Firestore → users → Add document with their UID → set email, displayName, role
3. Tell them to sign in and change their password (Firebase Console → user → Reset password)

## How to remove an account
1. Firebase Auth → Users → find the row → ⋮ → Delete user
2. Firestore → users → find that UID → Delete document

## Forgot password?
Firebase Console → Authentication → find the user → ⋮ → Reset password (sends a reset email if their email is real, OR you can just set a new password directly from the same menu).
