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

function getCurrentUser() {
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
  // Check if the parts collection has any documents; if not, seed it from data.js
  const snapshot = await db.collection("parts").limit(1).get();
  if (!snapshot.empty) return;

  console.log("Seeding parts collection from STARTING_PARTS...");
  const batch = db.batch();
  STARTING_PARTS.forEach((part, index) => {
    const id = `part-${index + 1}`;
    const ref = db.collection("parts").doc(id);
    batch.set(ref, {
      id,
      rackingType: part.rackingType,
      name: part.name.trim(),
      startingQuantity: Number(part.startingQuantity || 0),
      currentQuantity: Number(part.startingQuantity || 0),
      costEach: Number(part.costEach || 0),
      lowStockThreshold: 5
    });
  });
  await batch.commit();
  console.log("Seeded", STARTING_PARTS.length, "parts.");
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
      state.locations = doc.data().list.slice().sort();
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
}

function onDataChanged() {
  if (initialPartsLoaded && initialInvoicesLoaded && initialMetaLoaded
      && initialLocationsLoaded && initialUsersLoaded) {
    setConnectionStatus("Live", "connected");
  }
  // Re-render everything that depends on data
  renderDashboard();
  renderInventoryTable();
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
  const currentValue = location.value;
  location.innerHTML = state.locations.map(loc =>
    `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`
  ).join("");
  if (currentValue) location.value = currentValue;
}

function getRackingTypes() {
  return [...new Set(state.parts.map(p => p.rackingType))];
}

function rackingTypeOptions(selectedValue = "") {
  return getRackingTypes().map(type => (
    `<option value="${escapeHtml(type)}" ${type === selectedValue ? "selected" : ""}>${escapeHtml(type)}</option>`
  )).join("");
}

function partOptionsForType(rackingType, selectedPartId = "") {
  return state.parts
    .filter(p => p.rackingType === rackingType)
    .map(p => `<option value="${p.id}" ${p.id === selectedPartId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
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
  info.innerHTML =
    `<div>In stock: <strong>${Number(selectedPart.currentQuantity || 0)}</strong></div>` +
    `<div>Cost each: <strong>${money(selectedPart.costEach)}</strong></div>`;
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

  qs("dashboard").innerHTML = `
    <div class="card"><span>Part Types</span><strong>${totalItems}</strong></div>
    <div class="card"><span>Current Quantity</span><strong>${totalQty}</strong></div>
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

function renderInvoiceTable() {
  const body = qs("invoiceTableBody");
  if (!state.invoices.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px;">No invoices created yet.</td></tr>`;
    return;
  }

  const rows = [];
  for (const inv of state.invoices) {
    const lines = getInvoiceLineItems(inv);
    const expanded = expandedInvoices.has(inv.invoiceNumber);
    const edited = inv.lastEditedDate && inv.lastEditedDate !== inv.date;
    const safeInvNum = escapeHtml(inv.invoiceNumber);
    rows.push(`
      <tr>
        <td>
          <strong>${safeInvNum}</strong>
          ${edited ? `<br><span class="muted" style="font-size:11px;">edited ${escapeHtml(formatDate(inv.lastEditedDate))}</span>` : ""}
        </td>
        <td>${escapeHtml(formatDate(inv.date))}</td>
        <td>${escapeHtml(inv.user || "—")}</td>
        <td>${escapeHtml(inv.location || "—")}</td>
        <td>${lines.length}</td>
        <td><strong>${money(inv.total)}</strong></td>
        <td>
          <div class="action-buttons">
            <button type="button" class="secondary" data-invnum="${safeInvNum}" data-action="toggle">${expanded ? "Hide" : "View"}</button>
            <button type="button" data-invnum="${safeInvNum}" data-action="pdf">PDF</button>
            <button type="button" class="secondary" data-invnum="${safeInvNum}" data-action="edit">Edit</button>
            <button type="button" class="danger" data-invnum="${safeInvNum}" data-action="delete">Delete</button>
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
          <td colspan="7">
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
    banner.textContent = `You are editing ${invoiceNumber}. Original inventory has been restored — adjust line items and save to apply.`;
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

async function getNextInvoiceNumber() {
  // Transactional increment so two simultaneous creates don't get the same number
  const ref = db.collection("meta").doc("counters");
  let assigned;
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const current = doc.exists ? Number(doc.data().nextInvoiceNumber || 10001) : 10001;
    assigned = current;
    tx.set(ref, { nextInvoiceNumber: current + 1 }, { merge: true });
  });
  return `INV-${assigned}`;
}

// ---------- Create / edit invoice -----------------------------------------

async function useInventory(event) {
  event.preventDefault();
  const requestedLines = getInvoiceLinesFromForm();
  if (!requestedLines.length) return showMessage("Add at least one line item.", true);

  // Require a user to be selected before any invoice can be created or edited
  if (!getCurrentUser()) {
    showMessage("Please select your name from the User dropdown at the top of the page.", true);
    qs("userName").focus();
    return;
  }

  const requestedByPart = new Map();
  for (const line of requestedLines) {
    if (!line.part) return showMessage("Please select a part for every line item.", true);
    if (line.qtyUsed <= 0) return showMessage("Quantity used must be greater than zero on every line.", true);
    requestedByPart.set(line.part.id, (requestedByPart.get(line.part.id) || 0) + line.qtyUsed);
  }

  for (const [partId, totalQtyRequested] of requestedByPart.entries()) {
    const part = state.parts.find(p => p.id === partId);
    if (totalQtyRequested > Number(part.currentQuantity || 0)) {
      return showMessage(`Not Enough Inventory for ${part.name}. Available: ${part.currentQuantity}, Requested: ${totalQtyRequested}`, true);
    }
  }

  const isEditing = !!editingInvoiceNumber;
  const user = getCurrentUser();
  localStorage.setItem(USER_STORAGE_KEY, user);
  const submitBtn = qs("submitButton");
  submitBtn.disabled = true;
  submitBtn.textContent = isEditing ? "Saving..." : "Creating...";

  try {
    const invoiceNumber = isEditing ? editingInvoiceNumber : await getNextInvoiceNumber();

    const invoiceLines = requestedLines.map(line => ({
      rackingType: line.part.rackingType,
      partId: line.part.id,
      partName: line.part.name,
      quantityUsed: line.qtyUsed,
      costEach: Number(line.part.costEach || 0),
      total: line.qtyUsed * Number(line.part.costEach || 0)
    }));

    // Build the new part quantities in a batch
    const batch = db.batch();

    // Deduct from each part using atomic increment (race-safe across simultaneous users)
    for (const [partId, totalQty] of requestedByPart.entries()) {
      batch.update(db.collection("parts").doc(partId), {
        currentQuantity: firebase.firestore.FieldValue.increment(-totalQty)
      });
    }

    // Write the invoice doc
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const invoiceRef = db.collection("invoices").doc(invoiceNumber);

    if (isEditing) {
      const existing = state.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
      // First, fully replace the invoice with the new data (no delete sentinels here)
      batch.set(invoiceRef, {
        invoiceNumber,
        date: existing ? existing.date : todayText(),
        lastEditedDate: todayText(),
        location: qs("location").value,
        user,
        lineItems: invoiceLines,
        total: invoiceLines.reduce((s, l) => s + Number(l.total || 0), 0),
        createdAt: existing && existing.createdAt ? existing.createdAt : now,
        updatedAt: now
      });
      // Then clear the editing lock fields via update (set() forbids FieldValue.delete without merge)
      batch.update(invoiceRef, {
        editingBy: firebase.firestore.FieldValue.delete(),
        editingSince: firebase.firestore.FieldValue.delete()
      });
    } else {
      batch.set(invoiceRef, {
        invoiceNumber,
        date: todayText(),
        location: qs("location").value,
        user,
        lineItems: invoiceLines,
        total: invoiceLines.reduce((s, l) => s + Number(l.total || 0), 0),
        createdAt: now,
        updatedAt: now
      });
    }

    await batch.commit();

    // FIX #6: Build the saved-invoice object locally so we don't need to wait
    // on the Firestore listener before generating the PDF
    const savedInvoice = {
      invoiceNumber,
      date: isEditing
        ? (state.invoices.find(inv => inv.invoiceNumber === invoiceNumber) || {}).date || todayText()
        : todayText(),
      lastEditedDate: isEditing ? todayText() : undefined,
      location: qs("location").value,
      user,
      lineItems: invoiceLines,
      total: invoiceLines.reduce((s, l) => s + Number(l.total || 0), 0)
    };

    if (isEditing) {
      editingInvoiceNumber = null;
      editingOriginalSnapshot = null;
      setEditModeUI(false);
      showMessage(`Invoice ${invoiceNumber} updated successfully.`, false);
    } else {
      showMessage(`Invoice ${invoiceNumber} created with ${invoiceLines.length} line item(s).`, false);
    }

    qs("lineItems").innerHTML = "";
    addLineItem();

    // FIX #3: Only auto-download the PDF on CREATE. On edits the user can re-download
    // via the PDF button if they actually want a new copy.
    if (!isEditing) {
      buildAndDownloadInvoicePdf(savedInvoice);
    }

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

  // Check if someone else is already editing this invoice
  if (invoice.editingBy && invoice.editingBy !== getCurrentUser()) {
    const lockTs = invoice.editingSince && invoice.editingSince.toDate ? invoice.editingSince.toDate() : null;
    // If the server timestamp hasn't resolved yet (lockTs is null), the lock is brand new —
    // treat it as active, not stale. Only locks older than 30 minutes are considered stale.
    const ageMs = lockTs ? (Date.now() - lockTs.getTime()) : 0;
    const stale = lockTs && ageMs > 30 * 60 * 1000;
    if (!stale) {
      const msg = `${invoice.editingBy} is currently editing this invoice. Continue anyway? Doing so may cause incorrect inventory counts.`;
      if (!confirm(msg)) return;
    }
  }

  const lines = getInvoiceLineItems(invoice);

  // Restore inventory in Firestore (add the quantities back), AND mark the invoice as being edited
  try {
    const batch = db.batch();
    const restoredByPart = new Map();
    for (const l of lines) {
      restoredByPart.set(l.partId, (restoredByPart.get(l.partId) || 0) + Number(l.quantityUsed || 0));
    }
    for (const [partId, addBack] of restoredByPart.entries()) {
      batch.update(db.collection("parts").doc(partId), {
        currentQuantity: firebase.firestore.FieldValue.increment(addBack)
      });
    }
    // Mark this invoice as locked for editing by this user
    batch.update(db.collection("invoices").doc(invoiceNumber), {
      editingBy: getCurrentUser() || "(unknown)",
      editingSince: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
  } catch (err) {
    console.error("Failed to restore inventory for edit:", err);
    showMessage("Failed to start edit: " + err.message, true);
    return;
  }

  // FIX #1: Snapshot of the original invoice so cancel can re-deduct correctly
  editingInvoiceNumber = invoiceNumber;
  editingOriginalSnapshot = JSON.parse(JSON.stringify(invoice));

  qs("lineItems").innerHTML = "";
  for (const line of lines) {
    addLineItem({ partId: line.partId, quantityUsed: line.quantityUsed, rackingType: line.rackingType });
  }
  if (qs("lineItems").children.length === 0) addLineItem();

  if (invoice.location) qs("location").value = invoice.location;
  if (invoice.user) {
    const userSelect = qs("userName");
    // If the invoice's user isn't in the dropdown anymore, add it back so it shows correctly
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
  showMessage(`Editing ${invoiceNumber}. Inventory has been temporarily restored.`, false);
}

async function cancelEditInvoice(skipConfirm) {
  if (!editingInvoiceNumber) return;
  if (!skipConfirm && !confirm("Cancel editing? The invoice will be left exactly as it was.")) return;

  const invNum = editingInvoiceNumber;
  const snapshot = editingOriginalSnapshot;

  try {
    // FIX #1: Re-deduct the original quantities so inventory ends up back where it started,
    // AND clear the editing lock. Don't delete anything.
    const batch = db.batch();
    if (snapshot) {
      const lines = getInvoiceLineItems(snapshot);
      const deductByPart = new Map();
      for (const l of lines) {
        deductByPart.set(l.partId, (deductByPart.get(l.partId) || 0) + Number(l.quantityUsed || 0));
      }
      for (const [partId, deduct] of deductByPart.entries()) {
        batch.update(db.collection("parts").doc(partId), {
          currentQuantity: firebase.firestore.FieldValue.increment(-deduct)
        });
      }
    }
    // Clear the edit lock (use delete-field sentinel)
    batch.update(db.collection("invoices").doc(invNum), {
      editingBy: firebase.firestore.FieldValue.delete(),
      editingSince: firebase.firestore.FieldValue.delete()
    });
    await batch.commit();
  } catch (err) {
    console.error("Cancel edit failed:", err);
    showMessage("Cancel failed: " + err.message, true);
    return;
  }

  editingInvoiceNumber = null;
  editingOriginalSnapshot = null;
  qs("lineItems").innerHTML = "";
  addLineItem();
  setEditModeUI(false);
  if (!skipConfirm) showMessage(`Edit canceled. ${invNum} is unchanged.`, false);
}

async function deleteInvoice(invoiceNumber) {
  if (!confirm(`Delete invoice ${invoiceNumber}? Quantities will be returned to inventory.`)) return;

  const invoice = state.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
  if (!invoice) return;

  try {
    const batch = db.batch();
    const lines = getInvoiceLineItems(invoice);
    const restoredByPart = new Map();
    for (const l of lines) {
      restoredByPart.set(l.partId, (restoredByPart.get(l.partId) || 0) + Number(l.quantityUsed || 0));
    }
    for (const [partId, addBack] of restoredByPart.entries()) {
      batch.update(db.collection("parts").doc(partId), {
        currentQuantity: firebase.firestore.FieldValue.increment(addBack)
      });
    }
    batch.delete(db.collection("invoices").doc(invoiceNumber));

    // Record this deletion to the recovery log
    const deletionRef = db.collection("deletions").doc();
    batch.set(deletionRef, {
      type: "invoice",
      identifier: invoiceNumber,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deletedBy: getCurrentUser() || "(unknown)",
      snapshot: stripUndefined(invoice)
    });

    // Also write to the audit log for permanent history
    const auditRef = db.collection("audit_log").doc();
    batch.set(auditRef, {
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      admin: getCurrentUser() || "(unknown)",
      action: "DELETE_INVOICE",
      target: invoiceNumber,
      details: { invoiceNumber, total: Number(invoice.total || 0), lineItemCount: getInvoiceLineItems(invoice).length }
    });

    await batch.commit();

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

  doc.setFontSize(18);
  doc.text("Racking Inventory Invoice", 14, 20);

  doc.setFontSize(11);
  let y = 32;
  doc.text(`Invoice #: ${invoice.invoiceNumber}`, 14, y); y += 8;
  doc.text(`Date: ${formatDate(invoice.date)}`, 14, y); y += 8;
  if (invoice.lastEditedDate && invoice.lastEditedDate !== invoice.date) {
    doc.text(`Last Edited: ${formatDate(invoice.lastEditedDate)}`, 14, y); y += 8;
  }
  doc.text(`Location: ${invoice.location || ""}`, 14, y); y += 8;
  if (invoice.user) { doc.text(`User: ${invoice.user}`, 14, y); y += 8; }

  doc.autoTable({
    startY: y + 4,
    head: [["Racking Type", "Item / Part", "Qty Used", "Cost Each", "Line Total"]],
    body: lineItems.map(line => [
      line.rackingType, line.partName, line.quantityUsed, money(line.costEach), money(line.total)
    ])
  });

  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(14);
  doc.text(`Invoice Total: ${money(invoice.total)}`, 14, finalY);

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

  // FIX #9: clean up the old pre-Firebase localStorage key that's no longer used
  try { localStorage.removeItem("rackingInventoryApp.v1"); } catch (e) {}

  populateUserSelect();

  const savedUser = localStorage.getItem(USER_STORAGE_KEY);
  if (savedUser) {
    const userSelect = qs("userName");
    const hasOption = [...userSelect.options].some(o => o.value === savedUser);
    if (hasOption) userSelect.value = savedUser;
  }
  qs("userName").addEventListener("change", () => {
    localStorage.setItem(USER_STORAGE_KEY, getCurrentUser());
  });

  qs("usageForm").addEventListener("submit", useInventory);
  qs("addLineButton").addEventListener("click", () => addLineItem());
  qs("cancelEditButton").addEventListener("click", () => cancelEditInvoice(false));

  // Render initial empty UI
  renderSelects();
  renderDashboard();
  renderInventoryTable();
  renderInvoiceTable();

  try {
    await seedPartsIfEmpty();
    await seedMetaIfMissing();
    await seedLocationsIfEmpty();
    await seedUsersIfEmpty();
    attachListeners();
  } catch (err) {
    console.error("Firebase setup failed:", err);
    setConnectionStatus("Connection error", "error");
    showMessage("Could not connect to Firebase: " + err.message, true);
  }
});
