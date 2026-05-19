// Racking Inventory App — Firebase/Firestore version
// All data is stored in Firestore and synced live across every device.

const USER_STORAGE_KEY = "rackingInventoryApp.user";
const MAX_LINE_ITEMS = 24;

// In-memory cache, kept in sync with Firestore via real-time listeners
let state = {
  locations: STARTING_LOCATIONS,
  parts: [],
  invoices: [],
  meta: { nextInvoiceNumber: 10001 }
};

let lineItemCounter = 0;
let editingInvoiceNumber = null;
let expandedInvoices = new Set();   // invoice numbers that are expanded in the table
let initialPartsLoaded = false;
let initialInvoicesLoaded = false;
let initialMetaLoaded = false;

// ---------- Helpers --------------------------------------------------------

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function todayText() {
  return new Date().toLocaleDateString();
}

function qs(id) {
  return document.getElementById(id);
}

function getCurrentUser() {
  return (qs("userName").value || "").trim();
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
}

function onDataChanged() {
  if (initialPartsLoaded && initialInvoicesLoaded && initialMetaLoaded) {
    setConnectionStatus("Live", "connected");
  }
  // Re-render everything that depends on data
  renderDashboard();
  renderInventoryTable();
  renderInvoiceTable();
  populateAddInventorySelect();
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
    <div class="info line-info"></div>
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
    info.textContent = "";
    return;
  }
  info.textContent = `Current Qty: ${selectedPart.currentQuantity} | Cost Each: ${money(selectedPart.costEach)}`;
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
    rows.push(`
      <tr>
        <td>
          <strong>${escapeHtml(inv.invoiceNumber)}</strong>
          ${edited ? `<br><span class="muted" style="font-size:11px;">edited ${escapeHtml(inv.lastEditedDate)}</span>` : ""}
        </td>
        <td>${escapeHtml(inv.date)}</td>
        <td>${escapeHtml(inv.user || "—")}</td>
        <td>${escapeHtml(inv.location || "—")}</td>
        <td>${lines.length}</td>
        <td><strong>${money(inv.total)}</strong></td>
        <td>
          <div class="action-buttons">
            <button class="secondary" onclick="toggleInvoiceDetails('${escapeJs(inv.invoiceNumber)}')">${expanded ? "Hide" : "View"}</button>
            <button onclick="downloadInvoicePdf('${escapeJs(inv.invoiceNumber)}')">PDF</button>
            <button class="secondary" onclick="startEditInvoice('${escapeJs(inv.invoiceNumber)}')">Edit</button>
            <button class="danger" onclick="deleteInvoice('${escapeJs(inv.invoiceNumber)}')">Delete</button>
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
}

function escapeJs(text) {
  return String(text).replace(/['\\]/g, m => "\\" + m);
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

    // Deduct from each part
    for (const [partId, totalQty] of requestedByPart.entries()) {
      const part = state.parts.find(p => p.id === partId);
      const newQty = Number(part.currentQuantity || 0) - totalQty;
      batch.update(db.collection("parts").doc(partId), { currentQuantity: newQty });
    }

    // Write the invoice doc
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const invoiceRef = db.collection("invoices").doc(invoiceNumber);

    if (isEditing) {
      const existing = state.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
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

    if (isEditing) {
      editingInvoiceNumber = null;
      setEditModeUI(false);
      showMessage(`Invoice ${invoiceNumber} updated successfully.`, false);
    } else {
      showMessage(`Invoice ${invoiceNumber} created with ${invoiceLines.length} line item(s).`, false);
    }

    qs("lineItems").innerHTML = "";
    addLineItem();
    // Trigger PDF after a beat so Firestore listener has refreshed local state
    setTimeout(() => downloadInvoicePdf(invoiceNumber), 400);

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

  const lines = getInvoiceLineItems(invoice);

  // Restore inventory in Firestore (add the quantities back)
  try {
    const batch = db.batch();
    const restoredByPart = new Map();
    for (const l of lines) {
      restoredByPart.set(l.partId, (restoredByPart.get(l.partId) || 0) + Number(l.quantityUsed || 0));
    }
    for (const [partId, addBack] of restoredByPart.entries()) {
      const part = state.parts.find(p => p.id === partId);
      if (part) {
        batch.update(db.collection("parts").doc(partId), {
          currentQuantity: Number(part.currentQuantity || 0) + addBack
        });
      }
    }
    await batch.commit();
  } catch (err) {
    console.error("Failed to restore inventory for edit:", err);
    showMessage("Failed to start edit: " + err.message, true);
    return;
  }

  editingInvoiceNumber = invoiceNumber;

  qs("lineItems").innerHTML = "";
  for (const line of lines) {
    addLineItem({ partId: line.partId, quantityUsed: line.quantityUsed, rackingType: line.rackingType });
  }
  if (qs("lineItems").children.length === 0) addLineItem();

  if (invoice.location) qs("location").value = invoice.location;
  if (invoice.user) qs("userName").value = invoice.user;

  setEditModeUI(true, invoiceNumber);
  refreshAllLineInfo();
  qs("usageForm").scrollIntoView({ behavior: "smooth", block: "start" });
  showMessage(`Editing ${invoiceNumber}. Inventory has been temporarily restored.`, false);
}

async function cancelEditInvoice(skipConfirm) {
  if (!editingInvoiceNumber) return;
  if (!skipConfirm && !confirm("Cancel editing? The original invoice will be deleted because its inventory has already been returned.")) return;

  const invNum = editingInvoiceNumber;
  try {
    await db.collection("invoices").doc(invNum).delete();
  } catch (err) {
    console.error("Cancel edit delete failed:", err);
  }

  editingInvoiceNumber = null;
  qs("lineItems").innerHTML = "";
  addLineItem();
  setEditModeUI(false);
  if (!skipConfirm) showMessage(`Edit canceled. ${invNum} was removed since its inventory had been restored.`, false);
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
      const part = state.parts.find(p => p.id === partId);
      if (part) {
        batch.update(db.collection("parts").doc(partId), {
          currentQuantity: Number(part.currentQuantity || 0) + addBack
        });
      }
    }
    batch.delete(db.collection("invoices").doc(invoiceNumber));
    await batch.commit();

    if (editingInvoiceNumber === invoiceNumber) {
      editingInvoiceNumber = null;
      qs("lineItems").innerHTML = "";
      addLineItem();
      setEditModeUI(false);
    }
    showMessage(`Invoice ${invoiceNumber} deleted and inventory restored.`, false);
  } catch (err) {
    console.error("Delete invoice failed:", err);
    showMessage("Failed to delete invoice: " + err.message, true);
  }
}

// ---------- Add inventory --------------------------------------------------

async function addInventory(event) {
  event.preventDefault();
  const selectedPart = state.parts.find(p => p.id === qs("addPart").value);
  const qtyAdded = Number(qs("quantityAdded").value || 0);
  if (!selectedPart) return showMessage("Please select a part to add inventory.", true);
  if (qtyAdded <= 0) return showMessage("Quantity added must be greater than zero.", true);

  try {
    await db.collection("parts").doc(selectedPart.id).update({
      currentQuantity: Number(selectedPart.currentQuantity || 0) + qtyAdded
    });
    qs("quantityAdded").value = "";
    showMessage("Inventory added successfully.", false);
  } catch (err) {
    console.error("Add inventory failed:", err);
    showMessage("Failed to add inventory: " + err.message, true);
  }
}

function populateAddInventorySelect() {
  const select = qs("addPart");
  const previousValue = select.value;
  select.innerHTML = state.parts.map(p =>
    `<option value="${p.id}">${escapeHtml(p.rackingType)} - ${escapeHtml(p.name)}</option>`
  ).join("");
  if (previousValue) select.value = previousValue;
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
    showMessage("Invoice not found yet — please try the PDF button again in a moment.", true);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const lineItems = getInvoiceLineItems(invoice);

  doc.setFontSize(18);
  doc.text("Racking Inventory Invoice", 14, 20);

  doc.setFontSize(11);
  let y = 32;
  doc.text(`Invoice #: ${invoice.invoiceNumber}`, 14, y); y += 8;
  doc.text(`Date: ${invoice.date}`, 14, y); y += 8;
  if (invoice.lastEditedDate && invoice.lastEditedDate !== invoice.date) {
    doc.text(`Last Edited: ${invoice.lastEditedDate}`, 14, y); y += 8;
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

  const savedUser = localStorage.getItem(USER_STORAGE_KEY);
  if (savedUser) qs("userName").value = savedUser;
  qs("userName").addEventListener("change", () => {
    localStorage.setItem(USER_STORAGE_KEY, getCurrentUser());
  });

  qs("usageForm").addEventListener("submit", useInventory);
  qs("addInventoryForm").addEventListener("submit", addInventory);
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
    attachListeners();
  } catch (err) {
    console.error("Firebase setup failed:", err);
    setConnectionStatus("Connection error", "error");
    showMessage("Could not connect to Firebase: " + err.message, true);
  }
});
