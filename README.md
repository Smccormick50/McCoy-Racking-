# Racking Inventory Tracker

A simple static website for tracking racking inventory quantities and creating PDF invoices.

## What it does

- Enter the user/name at the top of the page (remembered between visits)
- Select store/location
- Select racking type
- Select part/item
- Enter quantity used
- Checks available inventory
- Deducts inventory
- Creates invoice record (tagged with the user)
- Downloads a PDF invoice
- Tracks low stock and inventory value
- Allows adding inventory back in
- **Edit** an existing invoice if a mistake was made — inventory is restored automatically while editing and re-applied on save
- **Delete** an invoice and automatically return the quantities to inventory

## Files

- `index.html` - main website page
- `style.css` - website design
- `data.js` - starting locations and parts from the Excel workbook
- `app.js` - inventory, invoice, dashboard, and PDF logic

## How to put it on GitHub Pages

1. Create a new GitHub repository.
2. Upload these files into the repository.
3. Go to **Settings**.
4. Go to **Pages**.
5. Under **Build and deployment**, select:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
6. Click **Save**.
7. GitHub will give you a public website link.

## Important note

This version stores data in the browser using `localStorage`.

That means:
- It works well for a simple first version.
- The data is saved only on the device/browser being used.
- Multiple users will not share the same inventory automatically.

For a multi-user company version, the next step is to add a database such as Firebase, Supabase, or a custom backend.
