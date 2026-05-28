// Racking Inventory App — Firebase/Firestore version
// All data is stored in Firestore and synced live across every device.

const USER_STORAGE_KEY = "rackingInventoryApp.user";
const MAX_LINE_ITEMS = 24;

// In-memory cache, kept in sync with Firestore via real-time listeners
let state = {
  locations: [],
  users: [],
  parts: [],
  invoices: [],
  trucks: [],
  truckInventory: [],
  meta: { nextInvoiceNumber: 10001 }
};

let lineItemCounter = 0;
let editingInvoiceNumber = null;
let editingOriginalSnapshot = null;   // snapshot of the invoice we entered edit mode on, used to undo on cancel
let expandedInvoices = new Set();   // invoice numbers that are expanded in the table
let initialPartsLoaded = false;
let initialInvoicesLoaded = false;
let initialMetaLoaded = false;
let initialLocationsLoaded = false;
let initialUsersLoaded = false;
let initialTrucksLoaded = false;
let initialTruckInventoryLoaded = false;

// ---------- Helpers --------------------------------------------------------

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// ISO date for storage — sortable, locale-independent. Display uses formatDate() instead.
function todayText() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Convert a stored date string (ISO `2026-05-20` or older locale string) to a friendly display
function formatDate(stored) {
  if (!stored) return "";
  // Match ISO YYYY-MM-DD exactly
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(stored));
  if (!m) return String(stored); // pre-existing locale-formatted dates, leave alone
  // Build a date in local time and format for display
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString();
}

function qs(id) {
  return document.getElementById(id);
}

// For admins: the user is always their own login displayName.
// For warehouse: the user is whatever they selected from the dropdown.
function getCurrentUser() {
  if (currentUserProfile && currentUserProfile.isAdmin) {
    return currentUserProfile.displayName || "";
  }
  return (qs("userName").value || "").trim();
}

function populateUserSelect() {
  const select = qs("userName");
  const previousValue = select.value;
  const users = (state.users && state.users.length ? state.users : []).slice();
  users.sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">— Select your name —</option>` +
    users.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
  if (previousValue) select.value = previousValue;
}

// Show the right UI based on the signed-in user's role:
// - admins see "Signed in as <name>" instead of the dropdown
// - warehouse users see the dropdown
function configureHeaderForRole() {
  if (!currentUserProfile) return;
  const select = qs("userName");
  const label = qs("userNameLabel");
  const signedInAs = qs("signedInAs");
  const adminLink = qs("adminLink");

  if (currentUserProfile.isAdmin) {
    // Hide dropdown, show "Signed in as ..."
    select.style.display = "none";
    label.style.display = "none";
    signedInAs.style.display = "";
    signedInAs.innerHTML = `<span class="muted">Signed in as</span> <strong>${escapeHtml(currentUserProfile.displayName)}</strong>`;
    if (adminLink) adminLink.style.display = "";
  } else {
    // Warehouse: show dropdown, hide admin link
    select.style.display = "";
    label.style.display = "";
    signedInAs.style.display = "none";
    if (adminLink) adminLink.style.display = "none";
  }
}

function setConnectionStatus(text, cls) {
  const el = qs("connectionStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "connection-status " + (cls || "");
}

function escapeHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

// ---------- Firestore: initialization & seed -------------------------------

async function seedPartsIfEmpty() {
  // Make sure every default racking type and part from data.js exists.
  // Older Firebase databases may already have some parts, so this now adds only missing defaults.
  if (typeof STARTING_PARTS === "undefined" || !Array.isArray(STARTING_PARTS)) return;

  const existing = await db.collection("parts").get();
  const existingIds = new Set();
  const existingKeys = new Set();
  existing.forEach(doc => {
    const data = doc.data() || {};
    existingIds.add(doc.id);
    existingIds.add(data.id);
    existingKeys.add(`${String(data.rackingType || "").trim().toLowerCase()}||${String(data.name || "").trim().toLowerCase()}`);
  });

  const batch = db.batch();
  let added = 0;
  STARTING_PARTS.forEach((part, index) => {
    const id = `part-${index + 1}`;
    const key = `${String(part.rackingType || "").trim().toLowerCase()}||${String(part.name || "").trim().toLowerCase()}`;
    if (existingIds.has(id) || existingKeys.has(key)) return;

    const ref = db.collection("parts").doc(id);
    batch.set(ref, {
      id,
      rackingType: part.rackingType,
      name: String(part.name || "").trim(),
      startingQuantity: Number(part.startingQuantity || 0),
      currentQuantity: Number(part.startingQuantity || 0),
      costEach: Number(part.costEach || 0),
      lowStockThreshold: 5
    });
    added += 1;
  });

  if (added > 0) {
    await batch.commit();
    console.log("Added missing default parts:", added);
  }
}

async function seedMetaIfMissing() {
  const ref = db.collection("meta").doc("counters");
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ nextInvoiceNumber: 10001 });
  }
}

async function seedLocationsIfEmpty() {
  const ref = db.collection("settings").doc("locations");
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ list: STARTING_LOCATIONS });
    console.log("Seeded", STARTING_LOCATIONS.length, "locations.");
  }
}

async function seedUsersIfEmpty() {
  const ref = db.collection("settings").doc("users");
  const doc = await ref.get();
  if (!doc.exists) {
    const seed = (typeof STARTING_USERS !== "undefined" ? STARTING_USERS : []);
    await ref.set({ list: seed });
    console.log("Seeded", seed.length, "users.");
  }
}

async function seedTrucksIfEmpty() {
  const ref = db.collection("settings").doc("trucks");
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ list: ["Truck 1", "Truck 2", "Truck 3"] });
    console.log("Seeded default trucks.");
  }
}

function attachListeners() {
  // Live listener: parts
  db.collection("parts").onSnapshot(snap => {
    state.parts = [];
    snap.forEach(doc => state.parts.push(doc.data()));
    // Sort by id (part-1, part-2, ...) for stable display
    state.parts.sort((a, b) => {
      const an = Number((a.id || "").replace("part-", "")) || 0;
      const bn = Number((b.id || "").replace("part-", "")) || 0;
      return an - bn;
    });
    initialPartsLoaded = true;
    onDataChanged();
  }, err => {
    console.error("Parts listener error:", err);
    setConnectionStatus("Connection error", "error");
  });

  // Live listener: invoices
  db.collection("invoices").orderBy("createdAt", "desc").onSnapshot(snap => {
    state.invoices = [];
    snap.forEach(doc => state.invoices.push(doc.data()));
    initialInvoicesLoaded = true;
    onDataChanged();
  }, err => {
    console.error("Invoices listener error:", err);
    setConnectionStatus("Connection error", "error");
  });

  // Live listener: meta/counters
  db.collection("meta").doc("counters").onSnapshot(doc => {
    if (doc.exists) state.meta = doc.data();
    initialMetaLoaded = true;
    onDataChanged();
  }, err => {
    console.error("Meta listener error:", err);
  });

  // Live listener: settings/locations
  db.collection("settings").doc("locations").onSnapshot(doc => {
    if (doc.exists && Array.isArray(doc.data().list)) {
      // Normalize: accept strings (old format) or full objects (new format)
      state.locations = doc.data().list
        .map(loc => (typeof loc === "string"
          ? { name: loc, phone: "", address: "", city: "", state: "", zip: "" }
          : Object.assign({ name: "", phone: "", address: "", city: "", state: "", zip: "" }, loc)))
        .filter(loc => loc.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    } else {
      state.locations = [];
    }
    initialLocationsLoaded = true;
    renderSelects();
    onDataChanged();
  }, err => {
    console.error("Locations listener error:", err);
  });

  // Live listener: settings/users
  db.collection("settings").doc("users").onSnapshot(doc => {
    if (doc.exists && Array.isArray(doc.data().list)) {
      state.users = doc.data().list.slice();
    }
    initialUsersLoaded = true;
    populateUserSelect();
    // Restore previously-saved user choice if it's still in the list
    const savedUser = localStorage.getItem(USER_STORAGE_KEY);
    if (savedUser) {
      const userSelect = qs("userName");
      if ([...userSelect.options].some(o => o.value === savedUser)) {
        userSelect.value = savedUser;
      }
    }
    onDataChanged();
  }, err => {
    console.error("Users listener error:", err);
  });

  // Live listener: settings/trucks
  db.collection("settings").doc("trucks").onSnapshot(doc => {
    if (doc.exists && Array.isArray(doc.data().list)) {
      // Normalize: accept strings (old format) or objects (new format with driver/notes)
      state.trucks = doc.data().list
        .map(t => (typeof t === "string"
          ? { name: t, driver: "", notes: "" }
          : Object.assign({ name: "", driver: "", notes: "" }, t)))
        .filter(t => t.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    } else {
      state.trucks = [];
    }
    initialTrucksLoaded = true;
    renderSelects();
    onDataChanged();
  }, err => {
    console.error("Trucks listener error:", err);
  });

  // Live listener: truck inventory
  db.collection("truck_inventory").onSnapshot(snap => {
    state.truckInventory = [];
    snap.forEach(doc => state.truckInventory.push(Object.assign({ id: doc.id }, doc.data())));
    state.truckInventory.sort((a, b) => (a.truck || "").localeCompare(b.truck || "") || (a.partName || "").localeCompare(b.partName || ""));
    initialTruckInventoryLoaded = true;
    onDataChanged();
  }, err => {
    console.error("Truck inventory listener error:", err);
    setConnectionStatus("Connection error", "error");
  });
}

function onDataChanged() {
  if (initialPartsLoaded && initialInvoicesLoaded && initialMetaLoaded
      && initialLocationsLoaded && initialUsersLoaded && initialTrucksLoaded && initialTruckInventoryLoaded) {
    setConnectionStatus("Live", "connected");
  }
  // Re-render everything that depends on data
  renderDashboard();
  renderInventoryTable();
  renderTruckInventoryTable();
  renderInvoiceTable();
  refreshAllLineInfo();
  // If line items haven't been initialized yet, do it once parts are loaded
  if (initialPartsLoaded && qs("lineItems").children.length === 0) {
    addLineItem();
    renderSelects();
  }
}

// ---------- Selects / line-item form ---------------------------------------

function renderSelects() {
  const location = qs("location");
  if (location) {
    const currentValue = location.value;
    location.innerHTML = state.locations.map(loc =>
      `<option value="${escapeHtml(loc.name)}">${escapeHtml(loc.name)}</option>`
    ).join("");
    if (currentValue) location.value = currentValue;
  }

  ["checkoutTruck", "invoiceTruck"].forEach(id => {
    const select = qs(id);
    if (!select) return;
    const current = select.value;
    const blankOption = id === "invoiceTruck"
      ? `<option value="">— Select truck —</option>`
      : `<option value="">— Select truck —</option>`;
    select.innerHTML = blankOption + state.trucks.map(t =>
      `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}${t.driver ? ` (${escapeHtml(t.driver)})` : ""}</option>`
    ).join("");
    if (current) select.value = current;
  });

  const typeSelect = qs("checkoutRackingType");
  if (typeSelect) {
    const currentType = typeSelect.value || getRackingTypes()[0] || "";
    typeSelect.innerHTML = rackingTypeOptions(currentType);
    if (currentType) typeSelect.value = currentType;
    updateCheckoutPartList();
  }
}

// Look up the full location object by name (returns null if not found)
function getLocationByName(name) {
  if (!name) return null;
  return state.locations.find(l => l.name === name) || null;
}

function getAllPartsForDropdowns() {
  const liveParts = Array.isArray(state.parts) ? state.parts : [];
  if (liveParts.length) return liveParts;

  // Fallback while Firestore is still loading so the checkout dropdown is not blank.
  if (typeof STARTING_PARTS !== "undefined" && Array.isArray(STARTING_PARTS)) {
    return STARTING_PARTS.map((part, index) => ({
      id: `part-${index + 1}`,
      rackingType: part.rackingType,
      name: part.name,
      startingQuantity: Number(part.startingQuantity || 0),
      currentQuantity: Number(part.startingQuantity || 0),
      costEach: Number(part.costEach || 0)
    }));
  }
  return [];
}

function getRackingTypes() {
  return [...new Set(getAllPartsForDropdowns().map(p => p.rackingType).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function rackingTypeOptions(selectedValue = "") {
  const types = getRackingTypes();
  if (!types.length) return `<option value="">No racking types found</option>`;
  return types.map(type => (
    `<option value="${escapeHtml(type)}" ${type === selectedValue ? "selected" : ""}>${escapeHtml(type)}</option>`
  )).join("");
}

function partOptionsForType(rackingType, selectedPartId = "") {
  const parts = getAllPartsForDropdowns()
    .filter(p => p.rackingType === rackingType)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (!parts.length) return `<option value="">No parts found for this racking type</option>`;
  return parts
    .map(p => `<option value="${escapeHtml(p.id)}" ${p.id === selectedPartId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
}

function makeTruckInventoryId(truck, partId) {
  return `${String(truck || "").replace(/[^A-Za-z0-9_-]/g, "_")}__${partId}`;
}

function getTruckPartQty(truck, partId) {
  const row = state.truckInventory.find(t => t.truck === truck && t.partId === partId);
  return Number(row && row.quantity || 0);
}

function updateCheckoutPartList() {
  const typeSelect = qs("checkoutRackingType");
  const partSelect = qs("checkoutPart");
  if (!typeSelect || !partSelect) return;
  const currentPart = partSelect.value;
  partSelect.innerHTML = partOptionsForType(typeSelect.value, currentPart);
}

function addLineItem(preset) {
  const lineItems = qs("lineItems");
  const currentLines = lineItems.querySelectorAll(".line-item").length;

  if (currentLines >= MAX_LINE_ITEMS) {
    showMessage(`You can only add up to ${MAX_LINE_ITEMS} line items.`, true);
    return;
  }

  lineItemCounter += 1;
  const presetPart = preset && preset.partId ? state.parts.find(p => p.id === preset.partId) : null;
  const initialType = presetPart ? presetPart.rackingType : (preset && preset.rackingType) || getRackingTypes()[0] || "";
  const initialPartId = presetPart ? presetPart.id : "";
  const initialQty = preset && preset.quantityUsed ? preset.quantityUsed : "";

  const line = document.createElement("div");
  line.className = "line-item";
  line.dataset.lineId = String(lineItemCounter);
  line.innerHTML = `
    <div class="line-number">#${currentLines + 1}</div>
    <label>
      Racking Type
      <select class="line-racking-type" required>${rackingTypeOptions(initialType)}</select>
    </label>
    <label>
      Item / Part
      <select class="line-part" required>${partOptionsForType(initialType, initialPartId)}</select>
    </label>
    <div class="line-info"></div>
    <label>
      Quantity Used
      <input class="line-qty" type="number" min="1" step="1" value="${escapeHtml(String(initialQty))}" required>
    </label>
    <button type="button" class="remove-line secondary">Remove</button>
  `;

  lineItems.appendChild(line);

  line.querySelector(".line-racking-type").addEventListener("change", () => updateLinePartList(line));
  line.querySelector(".line-part").addEventListener("change", () => updateLineInfo(line));
  line.querySelector(".remove-line").addEventListener("click", () => removeLineItem(line));
  updateLineInfo(line);
  updateLineButtons();
}

function removeLineItem(line) {
  const lineItems = qs("lineItems");
  if (lineItems.querySelectorAll(".line-item").length <= 1) {
    showMessage("At least one line item is required.", true);
    return;
  }
  line.remove();
  renumberLineItems();
  updateLineButtons();
}

function renumberLineItems() {
  qs("lineItems").querySelectorAll(".line-item").forEach((line, index) => {
    line.querySelector(".line-number").textContent = `#${index + 1}`;
  });
}

function updateLineButtons() {
  const count = qs("lineItems").querySelectorAll(".line-item").length;
  qs("addLineButton").disabled = count >= MAX_LINE_ITEMS;
}

function updateLinePartList(line) {
  const selectedType = line.querySelector(".line-racking-type").value;
  line.querySelector(".line-part").innerHTML = partOptionsForType(selectedType);
  updateLineInfo(line);
}

function updateLineInfo(line) {
  const partSelect = line.querySelector(".line-part");
  if (!partSelect) return;
  const selectedPart = state.parts.find(p => p.id === partSelect.value);
  const info = line.querySelector(".line-info");
  if (!selectedPart) {
    info.innerHTML = "";
    return;
  }
  const selectedTruck = qs("invoiceTruck") ? qs("invoiceTruck").value : "";
  const truckQty = selectedTruck ? getTruckPartQty(selectedTruck, selectedPart.id) : 0;
  info.innerHTML =
    `<div>On selected truck: <strong>${truckQty}</strong></div>` +
    `<div>Warehouse: <strong>${Number(selectedPart.currentQuantity || 0)}</strong> · Cost: <strong>${money(selectedPart.costEach)}</strong></div>`;
}

function refreshAllLineInfo() {
  qs("lineItems").querySelectorAll(".line-item").forEach(updateLineInfo);
}

function getInvoiceLinesFromForm() {
  return [...qs("lineItems").querySelectorAll(".line-item")].map(line => {
    const part = state.parts.find(p => p.id === line.querySelector(".line-part").value);
    const qtyUsed = Number(line.querySelector(".line-qty").value || 0);
    return { part, qtyUsed, lineElement: line };
  });
}

// ---------- Rendering -----------------------------------------------------

function renderDashboard() {
  const totalItems = state.parts.length;
  const totalQty = state.parts.reduce((sum, p) => sum + Number(p.currentQuantity || 0), 0);
  const totalValue = state.parts.reduce((sum, p) => sum + Number(p.currentQuantity || 0) * Number(p.costEach || 0), 0);
  const lowStock = state.parts.filter(p => Number(p.currentQuantity || 0) <= Number(p.lowStockThreshold || 0)).length;
  const invoiceTotal = state.invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const truckQty = state.truckInventory.reduce((sum, t) => sum + Number(t.quantity || 0), 0);

  qs("dashboard").innerHTML = `
    <div class="card"><span>Part Types</span><strong>${totalItems}</strong></div>
    <div class="card"><span>Warehouse Qty</span><strong>${totalQty}</strong></div>
    <div class="card"><span>Truck Qty</span><strong>${truckQty}</strong></div>
    <div class="card"><span>Inventory Value</span><strong>${money(totalValue)}</strong></div>
    <div class="card alert"><span>Low Stock Items</span><strong>${lowStock}</strong></div>
    <div class="card"><span>Invoice Total</span><strong>${money(invoiceTotal)}</strong></div>
  `;
}

function renderInventoryTable() {
  const rows = state.parts.map(p => {
    const value = Number(p.currentQuantity || 0) * Number(p.costEach || 0);
    const low = Number(p.currentQuantity || 0) <= Number(p.lowStockThreshold || 0);
    return `
      <tr class="${low ? "low-stock" : ""}">
        <td>${escapeHtml(p.rackingType)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.startingQuantity}</td>
        <td>${p.currentQuantity}</td>
        <td>${money(p.costEach)}</td>
        <td>${money(value)}</td>
        <td>${low ? "Low Stock" : "OK"}</td>
      </tr>
    `;
  }).join("");
  qs("inventoryBody").innerHTML = rows;
}

function renderTruckInventoryTable() {
  const container = qs("truckInventoryContainer");
  if (!container) return;

  // Build a map: truckName -> array of inventory rows
  const byTruck = new Map();
  for (const t of state.truckInventory) {
    if (Number(t.quantity || 0) <= 0) continue;
    const name = t.truck || "";
    if (!byTruck.has(name)) byTruck.set(name, []);
    byTruck.get(name).push(t);
  }

  // Build a list of all known trucks (from settings + any unknown ones from inventory)
  const allTruckNames = new Set();
  for (const t of state.trucks) allTruckNames.add(t.name);
  for (const name of byTruck.keys()) allTruckNames.add(name);

  if (!allTruckNames.size) {
    container.innerHTML = `<p class="muted" style="text-align:center;padding:20px;">No trucks set up yet. An admin can add trucks on the Admin page.</p>`;
    return;
  }

  // Sort truck names alphabetically
  const truckNames = [...allTruckNames].sort((a, b) => a.localeCompare(b));

  container.innerHTML = truckNames.map(truckName => {
    const items = (byTruck.get(truckName) || [])
      .slice()
      .sort((a, b) => (a.rackingType || "").localeCompare(b.rackingType || "") || (a.partName || "").localeCompare(b.partName || ""));

    const truckInfo = state.trucks.find(t => t.name === truckName) || { driver: "", notes: "" };
    const totalQty = items.reduce((s, t) => s + Number(t.quantity || 0), 0);
    const totalValue = items.reduce((s, t) => s + Number(t.quantity || 0) * Number(t.costEach || 0), 0);

    const headerLine = truckInfo.driver
      ? `<strong>${escapeHtml(truckName)}</strong> <span class="muted">— ${escapeHtml(truckInfo.driver)}</span>`
      : `<strong>${escapeHtml(truckName)}</strong>`;

    const subtotal = items.length
      ? `<p class="muted" style="margin:0 0 8px;">${totalQty} item${totalQty === 1 ? "" : "s"} on board · <strong>${money(totalValue)}</strong> total value</p>`
      : `<p class="muted" style="margin:0 0 8px;">Empty — no inventory currently loaded.</p>`;

    const rows = items.length
      ? `
        <table class="truck-inv-table">
          <thead>
            <tr>
              <th>Racking Type</th>
              <th>Item / Part</th>
              <th style="text-align:right;">Qty</th>
              <th style="text-align:right;">Cost Each</th>
              <th style="text-align:right;">Line Value</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(t => {
              const qty = Number(t.quantity || 0);
              const cost = Number(t.costEach || 0);
              return `
                <tr>
                  <td>${escapeHtml(t.rackingType || "")}</td>
                  <td>${escapeHtml(t.partName || "")}</td>
                  <td style="text-align:right;">${qty}</td>
                  <td style="text-align:right;">${money(cost)}</td>
                  <td style="text-align:right;">${money(qty * cost)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      `
      : "";

    return `
      <div class="truck-card">
        <h3 style="margin:0 0 4px;">${headerLine}</h3>
        ${subtotal}
        ${rows}
      </div>
    `;
  }).join("");
}

// "YYYY-MM" for the current local month (used to filter invoices on main page)
function currentMonthKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Pull a "YYYY-MM" key out of an invoice's stored date.
// Handles ISO (2026-05-21) and US locale (5/21/2026) formats.
function invoiceMonthKey(inv) {
  const d = inv && inv.date ? String(inv.date) : "";
  const iso = /^(\d{4})-(\d{2})-\d{2}$/.exec(d);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
  if (us) return `${us[3]}-${String(us[1]).padStart(2, "0")}`;
  const parsed = Date.parse(d);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }
  return "";
}

function renderInvoiceTable() {
  const body = qs("invoiceTableBody");
  const totalCount = state.invoices.length;
  const thisMonth = currentMonthKey();
  // Only show this calendar month on the main page.
  // Older invoices live in Admin → Archived Invoices.
  const visible = state.invoices.filter(inv => invoiceMonthKey(inv) === thisMonth);
  const olderCount = totalCount - visible.length;

  // Update the footer note (if present)
  const note = qs("invoiceListFooter");
  if (note) {
    if (olderCount > 0) {
      note.innerHTML = `Showing ${visible.length} invoice${visible.length === 1 ? "" : "s"} from this month. <strong>${olderCount}</strong> older invoice${olderCount === 1 ? "" : "s"} are available in <strong>Admin → Archived Invoices</strong>.`;
      note.style.display = "";
    } else if (totalCount > 0) {
      note.textContent = `Showing all ${totalCount} invoice${totalCount === 1 ? "" : "s"} from this month.`;
      note.style.display = "";
    } else {
      note.style.display = "none";
    }
  }

  if (!visible.length) {
    if (totalCount > 0) {
      body.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:20px;">No invoices created this month yet. ${olderCount} older invoice${olderCount === 1 ? "" : "s"} are in Admin → Archived Invoices.</td></tr>`;
    } else {
      body.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:20px;">No invoices created yet.</td></tr>`;
    }
    return;
  }

  const rows = [];
  for (const inv of visible) {
    const lines = getInvoiceLineItems(inv);
    const expanded = expandedInvoices.has(inv.invoiceNumber);
    const edited = inv.lastEditedDate && inv.lastEditedDate !== inv.date;
    const safeInvNum = escapeHtml(inv.invoiceNumber);
    rows.push(`
      <tr>
        <td>
          <strong>${safeInvNum}</strong>
          ${inv.isDamageWriteOff ? `<br><span class="damage-badge">DAMAGE</span>` : ""}
          ${edited ? `<br><span class="muted" style="font-size:11px;">edited ${escapeHtml(formatDate(inv.lastEditedDate))}</span>` : ""}
        </td>
        <td>${escapeHtml(formatDate(inv.date))}</td>
        <td>${escapeHtml(inv.user || "—")}</td>
        <td>${escapeHtml(inv.location || "—")}</td>
        <td>${escapeHtml(inv.truck || "—")}</td>
        <td>${lines.length}</td>
        <td><strong>${money(inv.total)}</strong></td>
        <td>
          <div class="action-buttons">
            <button type="button" class="secondary" data-invnum="${safeInvNum}" data-action="toggle">${expanded ? "Hide" : "View"}</button>
            <button type="button" data-invnum="${safeInvNum}" data-action="pdf">PDF</button>
            <button type="button" class="secondary" data-invnum="${safeInvNum}" data-action="edit">Edit</button>
            ${currentUserProfile && currentUserProfile.isAdmin
              ? `<button type="button" class="danger" data-invnum="${safeInvNum}" data-action="delete">Delete</button>`
              : ""}
          </div>
        </td>
      </tr>
    `);
    if (expanded) {
      const detailRows = lines.map(l => `
        <tr>
          <td>${escapeHtml(l.rackingType)}</td>
          <td>${escapeHtml(l.partName)}</td>
          <td>${l.quantityUsed}</td>
          <td>${money(l.costEach)}</td>
          <td>${money(l.total)}</td>
        </tr>
      `).join("");
      rows.push(`
        <tr class="invoice-detail-row">
          <td colspan="8">
            <table>
              <thead>
                <tr>
                  <th>Racking Type</th><th>Item / Part</th><th>Qty</th><th>Cost Each</th><th>Line Total</th>
                </tr>
              </thead>
              <tbody>${detailRows}</tbody>
            </table>
          </td>
        </tr>
      `);
    }
  }
  body.innerHTML = rows.join("");

  // Wire up action buttons (no inline onclick handlers — safer against any future
  // change that could put untrusted text into the rendered HTML)
  body.querySelectorAll("button[data-action]").forEach(btn => {
    const invNum = btn.dataset.invnum;
    const action = btn.dataset.action;
    btn.addEventListener("click", () => {
      if (action === "toggle") toggleInvoiceDetails(invNum);
      else if (action === "pdf")    downloadInvoicePdf(invNum);
      else if (action === "edit")   startEditInvoice(invNum);
      else if (action === "delete") deleteInvoice(invNum);
    });
  });
}

function toggleInvoiceDetails(invoiceNumber) {
  if (expandedInvoices.has(invoiceNumber)) expandedInvoices.delete(invoiceNumber);
  else expandedInvoices.add(invoiceNumber);
  renderInvoiceTable();
}

// ---------- Edit mode UI ---------------------------------------------------

function setEditModeUI(isEditing, invoiceNumber) {
  const heading = qs("usageHeading");
  const submitBtn = qs("submitButton");
  const cancelBtn = qs("cancelEditButton");
  const panel = qs("usageForm").closest(".panel");

  const existingBanner = panel.querySelector(".edit-banner");
  if (existingBanner) existingBanner.remove();

  if (isEditing) {
    heading.textContent = `Editing Invoice ${invoiceNumber}`;
    submitBtn.textContent = "Save Changes";
    cancelBtn.style.display = "";
    panel.classList.add("editing");
    const banner = document.createElement("div");
    banner.className = "edit-banner";
    banner.textContent = `You are editing ${invoiceNumber}. Inventory changes will apply only when you save.`;
    panel.insertBefore(banner, panel.querySelector("form"));
  } else {
    heading.textContent = "Use Inventory & Create Invoice";
    submitBtn.textContent = "Create PDF Invoice";
    cancelBtn.style.display = "none";
    panel.classList.remove("editing");
  }
}

// ---------- Firestore writes -----------------------------------------------

async function writePartQuantity(partId, newQuantity) {
  await db.collection("parts").doc(partId).update({ currentQuantity: Number(newQuantity) });
}

function buildInvoiceLinesFromRequested(requestedLines) {
  return requestedLines.map(line => ({
    rackingType: line.part.rackingType,
    partId: line.part.id,
    partName: line.part.name,
    quantityUsed: Number(line.qtyUsed || 0),
    costEach: Number(line.part.costEach || 0),
    total: Number(line.qtyUsed || 0) * Number(line.part.costEach || 0)
  }));
}

function groupQuantitiesByPart(lines) {
  const map = new Map();
  for (const l of lines || []) {
    if (!l.partId) continue;
    map.set(l.partId, (map.get(l.partId) || 0) + Number(l.quantityUsed || 0));
  }
  return map;
}

function getDiffByPart(oldLines, newLines) {
  const oldMap = groupQuantitiesByPart(oldLines);
  const newMap = groupQuantitiesByPart(newLines);
  const ids = new Set([...oldMap.keys(), ...newMap.keys()]);
  const diff = new Map();
  ids.forEach(id => diff.set(id, Number(newMap.get(id) || 0) - Number(oldMap.get(id) || 0)));
  return diff;
}

function makeInvoiceTotal(lines) {
  return (lines || []).reduce((s, l) => s + Number(l.total || 0), 0);
}

function makeMovementRef() {
  return db.collection("inventory_movements").doc();
}

// ---------- Create / edit invoice -----------------------------------------

async function checkoutInventoryToTruck(event) {
  event.preventDefault();
  const truck = qs("checkoutTruck").value;
  const partId = qs("checkoutPart").value;
  const qty = Number(qs("checkoutQty").value || 0);
  const user = getCurrentUser();

  if (!user) return showCheckoutMessage("Please select your name first.", true);
  if (!truck) return showCheckoutMessage("Please select a truck.", true);
  if (!partId) return showCheckoutMessage("Please select a part.", true);
  if (qty <= 0) return showCheckoutMessage("Quantity must be greater than zero.", true);

  const btn = qs("checkoutButton");
  btn.disabled = true;
  btn.textContent = "Moving...";

  try {
    await db.runTransaction(async tx => {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const partRef = db.collection("parts").doc(partId);
      const truckRef = db.collection("truck_inventory").doc(makeTruckInventoryId(truck, partId));
      const partDoc = await tx.get(partRef);
      const truckDoc = await tx.get(truckRef);
      if (!partDoc.exists) throw new Error("Part was not found.");
      const part = partDoc.data();
      const warehouseBefore = Number(part.currentQuantity || 0);
      if (warehouseBefore < qty) throw new Error(`Not enough warehouse inventory. Available: ${warehouseBefore}`);
      const truckBefore = truckDoc.exists ? Number(truckDoc.data().quantity || 0) : 0;

      tx.update(partRef, { currentQuantity: warehouseBefore - qty, updatedAt: now });
      tx.set(truckRef, {
        truck,
        partId,
        partName: part.name || "",
        rackingType: part.rackingType || "",
        costEach: Number(part.costEach || 0),
        quantity: truckBefore + qty,
        updatedAt: now
      }, { merge: true });
      tx.set(makeMovementRef(), {
        timestamp: now,
        type: "WAREHOUSE_TO_TRUCK",
        partId,
        partName: part.name || "",
        rackingType: part.rackingType || "",
        quantityChange: -qty,
        beforeQuantity: warehouseBefore,
        afterQuantity: warehouseBefore - qty,
        truck,
        truckBeforeQuantity: truckBefore,
        truckAfterQuantity: truckBefore + qty,
        user
      });
    });
    qs("checkoutQty").value = "";
    showCheckoutMessage(`Moved ${qty} item(s) to ${truck}.`, false);
  } catch (err) {
    console.error("Checkout failed:", err);
    showCheckoutMessage("Checkout failed: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Move to Truck";
  }
}

function showCheckoutMessage(message, isError) {
  const box = qs("checkoutMessage");
  if (!box) return showMessage(message, isError);
  box.textContent = message;
  box.className = isError ? "message error" : "message success";
  setTimeout(() => { box.textContent = ""; box.className = "message"; }, 5000);
}

async function useInventory(event) {
  event.preventDefault();
  const requestedLines = getInvoiceLinesFromForm();
  if (!requestedLines.length) return showMessage("Add at least one line item.", true);

  if (!getCurrentUser()) {
    showMessage("Please select your name from the User dropdown at the top of the page.", true);
    qs("userName").focus();
    return;
  }

  for (const line of requestedLines) {
    if (!line.part) return showMessage("Please select a part for every line item.", true);
    if (line.qtyUsed <= 0) return showMessage("Quantity used must be greater than zero on every line.", true);
  }

  const invoiceTruck = qs("invoiceTruck") ? qs("invoiceTruck").value : "";
  if (!invoiceTruck) {
    showMessage("Please select the truck used for this store invoice.", true);
    return;
  }

  const isEditing = !!editingInvoiceNumber;
  const user = getCurrentUser();
  localStorage.setItem(USER_STORAGE_KEY, user);
  const submitBtn = qs("submitButton");
  submitBtn.disabled = true;
  submitBtn.textContent = isEditing ? "Saving..." : "Creating...";

  let savedInvoice = null;

  try {
    const result = await db.runTransaction(async tx => {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const invoiceLines = buildInvoiceLinesFromRequested(requestedLines);
      let invoiceNumber = editingInvoiceNumber;
      let existingInvoice = null;
      let oldLines = [];
      let invoiceRef = null;
      let counterRef = null;
      let counterDoc = null;

      // === PHASE 1: ALL READS FIRST ===
      // Firestore rule: a transaction must execute every read before any write.

      // Read 1: the invoice (for edits) OR the counter (for new invoices)
      if (isEditing) {
        invoiceRef = db.collection("invoices").doc(invoiceNumber);
        const invoiceDoc = await tx.get(invoiceRef);
        if (!invoiceDoc.exists) throw new Error("Invoice no longer exists.");
        existingInvoice = invoiceDoc.data();
        oldLines = getInvoiceLineItems(existingInvoice);
      } else {
        counterRef = db.collection("meta").doc("counters");
        counterDoc = await tx.get(counterRef);
        const current = counterDoc.exists ? Number(counterDoc.data().nextInvoiceNumber || 10001) : 10001;
        invoiceNumber = `INV-${current}`;
        invoiceRef = db.collection("invoices").doc(invoiceNumber);
      }

      const diffByPart = isEditing ? getDiffByPart(oldLines, invoiceLines) : groupQuantitiesByPart(invoiceLines);

      // Read 2: every truck inventory doc we're going to touch (so we can validate truck stock)
      const partReads = [];
      const truckForInvoice = invoiceTruck;
      for (const [partId, diffQty] of diffByPart.entries()) {
        if (diffQty === 0) continue;
        const basePart = state.parts.find(p => p.id === partId) || {};
        const truckRef = db.collection("truck_inventory").doc(makeTruckInventoryId(truckForInvoice, partId));
        partReads.push({ partId, diffQty, truckRef, truckDoc: await tx.get(truckRef), partData: basePart });
      }

      // Validate truck stock based on the reads we just did
      for (const r of partReads) {
        const beforeQty = r.truckDoc.exists ? Number(r.truckDoc.data().quantity || 0) : 0;
        const partName = (r.truckDoc.exists && r.truckDoc.data().partName) || r.partData.name || r.partId;
        const afterQty = beforeQty - r.diffQty;
        if (afterQty < 0) {
          throw new Error(`Not enough inventory on ${truckForInvoice} for ${partName}. Available on truck: ${beforeQty}, Requested: ${r.diffQty}`);
        }
        r.beforeQty = beforeQty;
        r.afterQty = afterQty;
        r.partData = r.truckDoc.exists ? Object.assign({}, r.partData, r.truckDoc.data()) : r.partData;
      }

      // === PHASE 2: ALL WRITES ===

      // Bump the counter (if creating a new invoice)
      if (!isEditing) {
        const current = counterDoc.exists ? Number(counterDoc.data().nextInvoiceNumber || 10001) : 10001;
        tx.set(counterRef, { nextInvoiceNumber: current + 1 }, { merge: true });
      }

      // Deduct truck inventory and log movements
      for (const r of partReads) {
        tx.set(r.truckRef, { quantity: r.afterQty, updatedAt: now }, { merge: true });
        tx.set(makeMovementRef(), {
          timestamp: now,
          type: isEditing ? "TRUCK_INVOICE_EDIT" : "TRUCK_TO_STORE_INVOICE",
          invoiceNumber,
          partId: r.partId,
          partName: r.partData.partName || r.partData.name || "",
          rackingType: r.partData.rackingType || "",
          quantityChange: -r.diffQty,
          beforeQuantity: r.beforeQty,
          afterQuantity: r.afterQty,
          truck: truckForInvoice,
          user,
          location: qs("location").value
        });
      }

      const locName = qs("location").value;
      const locFull = getLocationByName(locName);
      const locDetails = locFull
        ? { name: locFull.name, phone: locFull.phone || "", address: locFull.address || "", city: locFull.city || "", state: locFull.state || "", zip: locFull.zip || "" }
        : { name: locName, phone: "", address: "", city: "", state: "", zip: "" };

      const invoicePayload = {
        invoiceNumber,
        date: existingInvoice ? existingInvoice.date : todayText(),
        location: locName,
        truck: invoiceTruck,
        locationDetails: locDetails,
        user,
        workOrderNumber: (qs("workOrderNumber") && qs("workOrderNumber").value || "").trim(),
        poNumber: (qs("poNumber") && qs("poNumber").value || "").trim(),
        notes: (qs("invoiceNotes") && qs("invoiceNotes").value || "").trim(),
        lineItems: invoiceLines,
        total: makeInvoiceTotal(invoiceLines),
        createdAt: existingInvoice && existingInvoice.createdAt ? existingInvoice.createdAt : now,
        updatedAt: now
      };

      if (isEditing) {
        invoicePayload.lastEditedDate = todayText();
        invoicePayload.editingBy = firebase.firestore.FieldValue.delete();
        invoicePayload.editingSince = firebase.firestore.FieldValue.delete();
        tx.set(invoiceRef, invoicePayload, { merge: true });
      } else {
        tx.set(invoiceRef, invoicePayload);
      }

      const auditRef = db.collection("audit_log").doc();
      tx.set(auditRef, {
        timestamp: now,
        admin: user,
        action: isEditing ? "SAVE_INVOICE_EDIT" : "CREATE_INVOICE",
        target: invoiceNumber,
        details: { total: invoicePayload.total, lineItemCount: invoiceLines.length, location: invoicePayload.location }
      });

      return { invoiceNumber, invoicePayload };
    });

    savedInvoice = {
      ...result.invoicePayload,
      invoiceNumber: result.invoiceNumber,
      createdAt: undefined,
      updatedAt: undefined
    };

    if (isEditing) {
      editingInvoiceNumber = null;
      editingOriginalSnapshot = null;
      setEditModeUI(false);
      showMessage(`Invoice ${result.invoiceNumber} updated successfully.`, false);
    } else {
      showMessage(`Invoice ${result.invoiceNumber} created with ${savedInvoice.lineItems.length} line item(s).`, false);
    }

    qs("lineItems").innerHTML = "";
    addLineItem();
    if (qs("workOrderNumber")) qs("workOrderNumber").value = "";
    if (qs("poNumber")) qs("poNumber").value = "";
    if (qs("invoiceNotes")) qs("invoiceNotes").value = "";

    if (!isEditing) buildAndDownloadInvoicePdf(savedInvoice);

  } catch (err) {
    console.error("Failed to save invoice:", err);
    showMessage("Failed to save invoice: " + err.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingInvoiceNumber ? "Save Changes" : "Create PDF Invoice";
  }
}

async function startEditInvoice(invoiceNumber) {
  if (editingInvoiceNumber && editingInvoiceNumber !== invoiceNumber) {
    if (!confirm("You are already editing another invoice. Discard and edit this one instead?")) return;
    await cancelEditInvoice(true);
  }

  const invoice = state.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
  if (!invoice) return;

  if (!getCurrentUser()) {
    showMessage("Please select your name before editing an invoice.", true);
    qs("userName").focus();
    return;
  }

  // Check if someone else is already editing this invoice.
  if (invoice.editingBy && invoice.editingBy !== getCurrentUser()) {
    const lockTs = invoice.editingSince && invoice.editingSince.toDate ? invoice.editingSince.toDate() : null;
    const ageMs = lockTs ? (Date.now() - lockTs.getTime()) : 0;
    const stale = lockTs && ageMs > 30 * 60 * 1000;
    if (!stale) {
      const msg = `${invoice.editingBy} is currently editing this invoice. Continue anyway?`;
      if (!confirm(msg)) return;
    }
  }

  // Do NOT restore inventory at the start of editing. The save transaction calculates
  // the difference between the old invoice and the new invoice and only applies that difference.
  try {
    await db.collection("invoices").doc(invoiceNumber).update({
      editingBy: getCurrentUser(),
      editingSince: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error("Failed to lock invoice for edit:", err);
    showMessage("Failed to start edit: " + err.message, true);
    return;
  }

  const lines = getInvoiceLineItems(invoice);
  editingInvoiceNumber = invoiceNumber;
  editingOriginalSnapshot = JSON.parse(JSON.stringify(invoice));

  qs("lineItems").innerHTML = "";
  for (const line of lines) {
    addLineItem({ partId: line.partId, quantityUsed: line.quantityUsed, rackingType: line.rackingType });
  }
  if (qs("lineItems").children.length === 0) addLineItem();

  if (invoice.location) qs("location").value = invoice.location;
  if (qs("workOrderNumber")) qs("workOrderNumber").value = invoice.workOrderNumber || "";
  if (qs("poNumber")) qs("poNumber").value = invoice.poNumber || "";
  if (qs("invoiceNotes")) qs("invoiceNotes").value = invoice.notes || "";

  if (invoice.user) {
    const userSelect = qs("userName");
    const hasOption = [...userSelect.options].some(o => o.value === invoice.user);
    if (!hasOption) {
      const opt = document.createElement("option");
      opt.value = invoice.user;
      opt.textContent = invoice.user + " (legacy)";
      userSelect.appendChild(opt);
    }
    userSelect.value = invoice.user;
  }

  setEditModeUI(true, invoiceNumber);
  refreshAllLineInfo();
  qs("usageForm").scrollIntoView({ behavior: "smooth", block: "start" });
  showMessage(`Editing ${invoiceNumber}. Inventory will update only after you click Save Changes.`, false);
}

async function cancelEditInvoice(skipConfirm) {
  if (!editingInvoiceNumber) return;
  if (!skipConfirm && !confirm("Cancel editing? The invoice will be left exactly as it was.")) return;

  const invNum = editingInvoiceNumber;

  try {
    await db.collection("invoices").doc(invNum).update({
      editingBy: firebase.firestore.FieldValue.delete(),
      editingSince: firebase.firestore.FieldValue.delete()
    });
  } catch (err) {
    console.error("Cancel edit failed:", err);
    showMessage("Cancel failed: " + err.message, true);
    return;
  }

  editingInvoiceNumber = null;
  editingOriginalSnapshot = null;
  qs("lineItems").innerHTML = "";
  addLineItem();
  if (qs("workOrderNumber")) qs("workOrderNumber").value = "";
  if (qs("poNumber")) qs("poNumber").value = "";
  if (qs("invoiceNotes")) qs("invoiceNotes").value = "";
  setEditModeUI(false);
  if (!skipConfirm) showMessage(`Edit canceled. ${invNum} is unchanged.`, false);
}

async function deleteInvoice(invoiceNumber) {
  if (!confirm(`Delete invoice ${invoiceNumber}? Quantities will be returned to inventory.`)) return;

  const user = getCurrentUser() || "(unknown)";

  try {
    await db.runTransaction(async tx => {
      const invoiceRef = db.collection("invoices").doc(invoiceNumber);

      // === PHASE 1: ALL READS ===
      const invoiceDoc = await tx.get(invoiceRef);
      if (!invoiceDoc.exists) throw new Error("Invoice not found.");
      const invoice = invoiceDoc.data();
      const lines = getInvoiceLineItems(invoice);
      const restoredByPart = groupQuantitiesByPart(lines);
      const now = firebase.firestore.FieldValue.serverTimestamp();

      const partReads = [];
      for (const [partId, addBack] of restoredByPart.entries()) {
        const partRef = db.collection("parts").doc(partId);
        partReads.push({ partId, addBack, partRef, partDoc: await tx.get(partRef) });
      }

      // === PHASE 2: ALL WRITES ===
      for (const r of partReads) {
        if (!r.partDoc.exists) continue;
        const partData = r.partDoc.data();
        const beforeQty = Number(partData.currentQuantity || 0);
        const afterQty = beforeQty + Number(r.addBack || 0);
        tx.update(r.partRef, { currentQuantity: afterQty, updatedAt: now });
        tx.set(makeMovementRef(), {
          timestamp: now,
          type: "INVOICE_DELETE_RESTORE",
          invoiceNumber,
          partId: r.partId,
          partName: partData.name || "",
          rackingType: partData.rackingType || "",
          quantityChange: Number(r.addBack || 0),
          beforeQuantity: beforeQty,
          afterQuantity: afterQty,
          user,
          location: invoice.location || ""
        });
      }

      tx.delete(invoiceRef);
      tx.set(db.collection("deletions").doc(), {
        type: "invoice",
        identifier: invoiceNumber,
        deletedAt: now,
        deletedBy: user,
        snapshot: stripUndefined(invoice)
      });
      tx.set(db.collection("audit_log").doc(), {
        timestamp: now,
        admin: user,
        action: "DELETE_INVOICE",
        target: invoiceNumber,
        details: { invoiceNumber, total: Number(invoice.total || 0), lineItemCount: lines.length }
      });
    });

    if (editingInvoiceNumber === invoiceNumber) {
      editingInvoiceNumber = null;
      editingOriginalSnapshot = null;
      qs("lineItems").innerHTML = "";
      addLineItem();
      setEditModeUI(false);
    }
    showMessage(`Invoice ${invoiceNumber} deleted and inventory restored. (Recoverable from Admin → Recovery for a limited time.)`, false);
  } catch (err) {
    console.error("Delete invoice failed:", err);
    showMessage("Failed to delete invoice: " + err.message, true);
  }
}

// Remove `undefined` recursively (Firestore rejects undefined values, only null is allowed)
function stripUndefined(obj) {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return obj;
}

// ---------- Invoice display helpers ---------------------------------------

function getInvoiceLineItems(invoice) {
  if (Array.isArray(invoice.lineItems)) return invoice.lineItems;
  return [{
    rackingType: invoice.rackingType,
    partId: invoice.partId,
    partName: invoice.partName,
    quantityUsed: invoice.quantityUsed,
    costEach: invoice.costEach,
    total: invoice.total
  }];
}

function downloadInvoicePdf(invoiceNumber) {
  const invoice = state.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
  if (!invoice) {
    showMessage("Invoice not found.", true);
    return;
  }
  buildAndDownloadInvoicePdf(invoice);
}

// Build PDF directly from a given invoice object (no Firestore lookup, no timing dependency)
function buildAndDownloadInvoicePdf(invoice) {
  if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") {
    showMessage("PDF library didn't load. Check your internet connection and refresh the page.", true);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  if (typeof doc.autoTable !== "function") {
    showMessage("PDF table library didn't load. Check your internet connection and refresh the page.", true);
    return;
  }
  const lineItems = getInvoiceLineItems(invoice);

  // Brand colors (RGB)
  const GREEN_DARK = [15, 58, 42];
  const GREEN_MID  = [22, 107, 70];
  const YELLOW     = [245, 209, 22];
  const PAGE_W     = doc.internal.pageSize.getWidth();

  // ===== HEADER BAND =====
  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, PAGE_W, 32, "F");
  doc.setFillColor(...YELLOW);
  doc.rect(0, 32, PAGE_W, 2, "F");

  // "Mc Racking" big in yellow on the left
  doc.setTextColor(...YELLOW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Mc Racking", 14, 16);

  // HQ block right-aligned
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const hq = [
    "McCoy Corporation Headquarters",
    "1350 N I.H. 35",
    "San Marcos, TX 78666"
  ];
  let hqY = 12;
  for (const line of hq) {
    doc.text(line, PAGE_W - 14, hqY, { align: "right" });
    hqY += 5;
  }

  // ===== INVOICE METADATA BLOCK =====
  const isDamage = !!invoice.isDamageWriteOff;
  doc.setTextColor(...GREEN_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(isDamage ? "DAMAGE WRITE-OFF INVOICE" : "RACKING INVENTORY INVOICE", 14, 46);

  // Red "DAMAGE WRITE-OFF" stamp diagonally on damage invoices
  if (isDamage) {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.18 }));
    doc.setTextColor(180, 30, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(56);
    // Rotate text -25° around the page center
    doc.text("DAMAGE WRITE-OFF", PAGE_W / 2, 150, { align: "center", angle: 25 });
    doc.restoreGraphicsState();
    // Reset for the next text draws
    doc.setTextColor(...GREEN_DARK);
  }

  // Left column labels & values
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text("INVOICE #", 14, 56);
  doc.text("DATE", 14, 66);
  let labelY = 76;
  if (invoice.lastEditedDate && invoice.lastEditedDate !== invoice.date) {
    doc.text("LAST EDITED", 14, labelY); labelY += 10;
  }
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.text(invoice.invoiceNumber || "", 50, 56);
  doc.text(formatDate(invoice.date) || "", 50, 66);
  if (invoice.lastEditedDate && invoice.lastEditedDate !== invoice.date) {
    doc.text(formatDate(invoice.lastEditedDate) || "", 50, 76);
  }

  // Right column: Ship To box
  const shipBoxX = 115;
  const shipBoxY = 50;
  const shipBoxW = 81;
  const shipBoxH = 38;
  doc.setDrawColor(...GREEN_MID);
  doc.setLineWidth(0.5);
  doc.rect(shipBoxX, shipBoxY, shipBoxW, shipBoxH, "S");
  doc.setFillColor(...GREEN_DARK);
  doc.rect(shipBoxX, shipBoxY, shipBoxW, 6, "F");
  doc.setTextColor(...YELLOW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("SHIP TO", shipBoxX + 3, shipBoxY + 4.4);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const loc = invoice.locationDetails || {};
  const locName = loc.name || invoice.location || "";
  let by = shipBoxY + 12;
  if (locName) { doc.text(locName, shipBoxX + 3, by); by += 5; }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (loc.address) { doc.text(loc.address, shipBoxX + 3, by); by += 4.5; }
  const cityState = [loc.city, loc.state].filter(Boolean).join(", ");
  const cityStateZip = (cityState + (loc.zip ? " " + loc.zip : "")).trim();
  if (cityStateZip) { doc.text(cityStateZip, shipBoxX + 3, by); by += 4.5; }
  if (loc.phone) { doc.text("Phone: " + loc.phone, shipBoxX + 3, by); by += 4.5; }

  // Below: User / Work Order / PO
  let belowY = Math.max(82, shipBoxY + shipBoxH + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  if (invoice.user) {
    doc.text("CREATED BY", 14, belowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(invoice.user, 50, belowY);
    belowY += 7;
  }
  if (invoice.truck) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text("TRUCK", 14, belowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(invoice.truck, 50, belowY);
    belowY += 7;
  }
  if (invoice.workOrderNumber) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text("WORK ORDER #", 14, belowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(invoice.workOrderNumber, 50, belowY);
    belowY += 7;
  }
  if (invoice.poNumber) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text("PO #", 14, belowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(invoice.poNumber, 50, belowY);
    belowY += 7;
  }

  // ===== LINE ITEMS TABLE =====
  doc.autoTable({
    startY: belowY + 4,
    head: [["Racking Type", "Item / Part", "Qty Used", "Cost Each", "Line Total"]],
    body: lineItems.map(line => [
      line.rackingType,
      line.partName,
      line.quantityUsed,
      money(line.costEach),
      money(line.total)
    ]),
    headStyles: {
      fillColor: GREEN_DARK,
      textColor: YELLOW,
      fontStyle: "bold"
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" }
    },
    margin: { left: 14, right: 14 }
  });

  // ===== TOTAL BAR =====
  let finalY = doc.lastAutoTable.finalY + 6;
  doc.setFillColor(...GREEN_DARK);
  doc.rect(14, finalY, PAGE_W - 28, 12, "F");
  doc.setTextColor(...YELLOW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("INVOICE TOTAL", 18, finalY + 8);
  doc.text(money(invoice.total), PAGE_W - 18, finalY + 8, { align: "right" });

  finalY += 22;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (invoice.notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Notes:", 14, finalY);
    finalY += 6;
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(String(invoice.notes), PAGE_W - 28);
    doc.text(wrapped, 14, finalY);
    finalY += wrapped.length * 5 + 8;
  }
  doc.text("Authorized Signature: ______________________________", 14, finalY);

  // Footer
  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Mc Racking - McCoy Corporation Headquarters - 1350 N I.H. 35, San Marcos, TX 78666",
           PAGE_W / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });

  doc.save(`${invoice.invoiceNumber}.pdf`);
}

// ---------- Messages -------------------------------------------------------

function showMessage(message, isError) {
  const box = qs("message");
  box.textContent = message;
  box.className = isError ? "message error" : "message success";
  setTimeout(() => { box.textContent = ""; box.className = "message"; }, 5000);
}

// ---------- Boot -----------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  setConnectionStatus("Connecting...", "");

  try {
    await ensureUserApproved();
  } catch (err) {
    // ensureUserApproved already redirected or showed an overlay; stop boot
    return;
  }

  // Adapt header to whether this is an admin or warehouse login
  configureHeaderForRole();

  // Sign-out button
  const signOutBtn = qs("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", signOutAndGoToLogin);

  // Clean up old pre-Firebase localStorage key
  try { localStorage.removeItem("rackingInventoryApp.v1"); } catch (e) {}

  populateUserSelect();

  // Only warehouse users actually use the dropdown; remember last pick for them
  if (currentUserProfile && !currentUserProfile.isAdmin) {
    const savedUser = localStorage.getItem(USER_STORAGE_KEY);
    if (savedUser) {
      const userSelect = qs("userName");
      const hasOption = [...userSelect.options].some(o => o.value === savedUser);
      if (hasOption) userSelect.value = savedUser;
    }
    qs("userName").addEventListener("change", () => {
      localStorage.setItem(USER_STORAGE_KEY, getCurrentUser());
    });
  }

  if (qs("checkoutForm")) qs("checkoutForm").addEventListener("submit", checkoutInventoryToTruck);
  if (qs("checkoutRackingType")) qs("checkoutRackingType").addEventListener("change", updateCheckoutPartList);
  if (qs("invoiceTruck")) qs("invoiceTruck").addEventListener("change", refreshAllLineInfo);
  qs("usageForm").addEventListener("submit", useInventory);
  qs("addLineButton").addEventListener("click", () => addLineItem());
  qs("cancelEditButton").addEventListener("click", () => cancelEditInvoice(false));

  // Render initial empty UI
  renderSelects();
  renderDashboard();
  renderInventoryTable();
  renderTruckInventoryTable();
  renderInvoiceTable();

  try {
    if (currentUserProfile && currentUserProfile.isAdmin) {
      // Only admins can write to settings/parts/meta. Seeds only run for them.
      await seedPartsIfEmpty();
      await seedMetaIfMissing();
      await seedLocationsIfEmpty();
      await seedUsersIfEmpty();
      await seedTrucksIfEmpty();
    }
    attachListeners();
  } catch (err) {
    console.error("Firebase setup failed:", err);
    setConnectionStatus("Connection error", "error");
    showMessage("Could not connect to Firebase: " + err.message, true);
  }
});
