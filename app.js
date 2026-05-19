// Racking Inventory App
// Stores all data in the browser with localStorage.
// Works as a static GitHub Pages website.

const STORAGE_KEY = "rackingInventoryApp.v1";
const USER_STORAGE_KEY = "rackingInventoryApp.user";
const MAX_LINE_ITEMS = 24;

let state = loadState();
let lineItemCounter = 0;
let editingInvoiceNumber = null; // null = creating new; string = editing existing

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function todayText() {
  return new Date().toLocaleDateString();
}

function makeInvoiceNumber() {
  const next = (state.nextInvoiceNumber || 10001);
  state.nextInvoiceNumber = next + 1;
  return `INV-${next}`;
}

function getCurrentUser() {
  return (qs("userName").value || "").trim();
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);

  return {
    locations: STARTING_LOCATIONS,
    parts: STARTING_PARTS.map((part, index) => ({
      id: `part-${index + 1}`,
      rackingType: part.rackingType,
      name: part.name.trim(),
      startingQuantity: Number(part.startingQuantity || 0),
      currentQuantity: Number(part.startingQuantity || 0),
      costEach: Number(part.costEach || 0),
      lowStockThreshold: 5
    })),
    invoices: [],
    movements: [],
    nextInvoiceNumber: 10001
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function qs(id) {
  return document.getElementById(id);
}

function renderAll() {
  renderSelects();
  renderDashboard();
  renderInventoryTable();
  renderInvoiceHistory();
}

function renderSelects() {
  const location = qs("location");
  const currentValue = location.value;
  location.innerHTML = state.locations.map(loc => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`).join("");
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
  const selectedPart = state.parts.find(p => p.id === line.querySelector(".line-part").value);
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

    return {
      part,
      qtyUsed,
      lineElement: line
    };
  });
}

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

function renderInvoiceHistory() {
  if (!state.invoices.length) {
    qs("invoiceHistory").innerHTML = `<p class="muted">No invoices created yet.</p>`;
    return;
  }

  qs("invoiceHistory").innerHTML = state.invoices.map(inv => {
    const lineCount = getInvoiceLineItems(inv).length;
    const userText = inv.user ? ` | ${escapeHtml(inv.user)}` : "";
    return `
      <div class="invoice-row">
        <div>
          <strong>${escapeHtml(inv.invoiceNumber)}</strong>
          <span>${escapeHtml(inv.location)} | ${escapeHtml(inv.date)}${userText} | ${lineCount} line item${lineCount === 1 ? "" : "s"}</span>
        </div>
        <div class="invoice-actions">
          <strong>${money(inv.total)}</strong>
          <button onclick="downloadInvoicePdf('${inv.invoiceNumber}')">PDF</button>
          <button class="secondary" onclick="startEditInvoice('${inv.invoiceNumber}')">Edit</button>
          <button class="danger" onclick="deleteInvoice('${inv.invoiceNumber}')">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

// --- Edit mode helpers ----------------------------------------------------

function setEditModeUI(isEditing, invoiceNumber) {
  const heading = qs("usageHeading");
  const submitBtn = qs("submitButton");
  const cancelBtn = qs("cancelEditButton");
  const panel = qs("usageForm").closest(".panel");

  // Remove any existing banner
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

function startEditInvoice(invoiceNumber) {
  if (editingInvoiceNumber && editingInvoiceNumber !== invoiceNumber) {
    if (!confirm("You are already editing another invoice. Discard those changes and edit this one instead?")) return;
    cancelEditInvoice(true);
  }

  const invoice = state.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
  if (!invoice) return;

  const lines = getInvoiceLineItems(invoice);

  // Restore inventory: add back the quantities that were used.
  for (const line of lines) {
    const part = state.parts.find(p => p.id === line.partId);
    if (part) part.currentQuantity = Number(part.currentQuantity || 0) + Number(line.quantityUsed || 0);
  }

  // Mark movements from this invoice as reverted (we'll add fresh ones on save)
  state.movements = state.movements.filter(m => m.invoiceNumber !== invoiceNumber);

  saveState();
  editingInvoiceNumber = invoiceNumber;

  // Populate the form with the invoice's data
  qs("lineItems").innerHTML = "";
  for (const line of lines) {
    addLineItem({ partId: line.partId, quantityUsed: line.quantityUsed, rackingType: line.rackingType });
  }
  if (qs("lineItems").children.length === 0) addLineItem();

  // Restore location and user
  if (invoice.location) qs("location").value = invoice.location;
  if (invoice.user) qs("userName").value = invoice.user;

  setEditModeUI(true, invoiceNumber);
  renderAll();
  refreshAllLineInfo();

  // Scroll to the form
  qs("usageForm").scrollIntoView({ behavior: "smooth", block: "start" });
  showMessage(`Editing ${invoiceNumber}. Inventory has been temporarily restored.`, false);
}

function cancelEditInvoice(skipConfirm) {
  if (!editingInvoiceNumber) return;
  if (!skipConfirm && !confirm("Cancel editing? Inventory will be restored to its current state and the original invoice will be deleted because its quantities have already been returned.")) return;

  // When we entered edit mode we returned inventory. If user cancels, the safest move
  // is to delete the original invoice (its line items were already credited back).
  const invNum = editingInvoiceNumber;
  state.invoices = state.invoices.filter(inv => inv.invoiceNumber !== invNum);

  editingInvoiceNumber = null;
  saveState();
  qs("lineItems").innerHTML = "";
  addLineItem();
  setEditModeUI(false);
  renderAll();
  populateAddInventorySelect();
  if (!skipConfirm) showMessage(`Edit canceled. ${invNum} was removed since its inventory had been restored.`, false);
}

function deleteInvoice(invoiceNumber) {
  if (!confirm(`Delete invoice ${invoiceNumber}? The quantities on that invoice will be returned to inventory.`)) return;

  const invoice = state.invoices.find(inv => inv.invoiceNumber === invoiceNumber);
  if (!invoice) return;

  const lines = getInvoiceLineItems(invoice);
  for (const line of lines) {
    const part = state.parts.find(p => p.id === line.partId);
    if (part) part.currentQuantity = Number(part.currentQuantity || 0) + Number(line.quantityUsed || 0);
  }

  state.movements = state.movements.filter(m => m.invoiceNumber !== invoiceNumber);
  state.invoices = state.invoices.filter(inv => inv.invoiceNumber !== invoiceNumber);

  if (editingInvoiceNumber === invoiceNumber) {
    editingInvoiceNumber = null;
    qs("lineItems").innerHTML = "";
    addLineItem();
    setEditModeUI(false);
  }

  saveState();
  renderAll();
  populateAddInventorySelect();
  showMessage(`Invoice ${invoiceNumber} deleted and inventory restored.`, false);
}

// --- Submit (create OR save edits) ----------------------------------------

function useInventory(event) {
  event.preventDefault();

  const requestedLines = getInvoiceLinesFromForm();
  if (!requestedLines.length) return showMessage("Add at least one line item.", true);

  const requestedByPart = new Map();

  for (const line of requestedLines) {
    if (!line.part) return showMessage("Please select a part for every line item.", true);
    if (line.qtyUsed <= 0) return showMessage("Quantity used must be greater than zero on every line.", true);

    const currentRequested = requestedByPart.get(line.part.id) || 0;
    requestedByPart.set(line.part.id, currentRequested + line.qtyUsed);
  }

  for (const [partId, totalQtyRequested] of requestedByPart.entries()) {
    const part = state.parts.find(p => p.id === partId);
    if (totalQtyRequested > Number(part.currentQuantity || 0)) {
      return showMessage(`Not Enough Inventory for ${part.name}. Available: ${part.currentQuantity}, Requested: ${totalQtyRequested}`, true);
    }
  }

  const isEditing = !!editingInvoiceNumber;
  const invoiceNumber = isEditing ? editingInvoiceNumber : makeInvoiceNumber();
  const user = getCurrentUser();
  localStorage.setItem(USER_STORAGE_KEY, user);

  const invoiceLines = requestedLines.map(line => {
    const beforeQty = Number(line.part.currentQuantity || 0);
    const afterQty = beforeQty - line.qtyUsed;
    line.part.currentQuantity = afterQty;

    const lineTotal = line.qtyUsed * Number(line.part.costEach || 0);

    state.movements.unshift({
      date: todayText(),
      type: isEditing ? "EDITED" : "USED",
      invoiceNumber,
      partId: line.part.id,
      beforeQty,
      quantityChange: -line.qtyUsed,
      afterQty,
      user
    });

    return {
      rackingType: line.part.rackingType,
      partId: line.part.id,
      partName: line.part.name,
      quantityUsed: line.qtyUsed,
      costEach: Number(line.part.costEach || 0),
      total: lineTotal
    };
  });

  if (isEditing) {
    // Replace the existing invoice in place (preserve its position)
    const idx = state.invoices.findIndex(inv => inv.invoiceNumber === invoiceNumber);
    const original = idx >= 0 ? state.invoices[idx] : null;
    const updated = {
      invoiceNumber,
      date: original ? original.date : todayText(),
      lastEditedDate: todayText(),
      location: qs("location").value,
      user,
      lineItems: invoiceLines,
      total: invoiceLines.reduce((sum, line) => sum + Number(line.total || 0), 0)
    };
    if (idx >= 0) state.invoices[idx] = updated; else state.invoices.unshift(updated);
    editingInvoiceNumber = null;
    setEditModeUI(false);
    saveState();
    renderAll();
    populateAddInventorySelect();
    qs("lineItems").innerHTML = "";
    addLineItem();
    refreshAllLineInfo();
    showMessage(`Invoice ${invoiceNumber} updated successfully.`, false);
    downloadInvoicePdf(invoiceNumber);
    return;
  }

  const invoice = {
    invoiceNumber,
    date: todayText(),
    location: qs("location").value,
    user,
    lineItems: invoiceLines,
    total: invoiceLines.reduce((sum, line) => sum + Number(line.total || 0), 0)
  };

  state.invoices.unshift(invoice);

  saveState();
  renderAll();
  refreshAllLineInfo();
  qs("lineItems").querySelectorAll(".line-qty").forEach(input => input.value = "");
  showMessage(`Invoice ${invoiceNumber} created with ${invoiceLines.length} line item(s). Inventory updated.`, false);
  downloadInvoicePdf(invoiceNumber);
}

function addInventory(event) {
  event.preventDefault();

  const selectedPart = state.parts.find(p => p.id === qs("addPart").value);
  const qtyAdded = Number(qs("quantityAdded").value || 0);

  if (!selectedPart) return showMessage("Please select a part to add inventory.", true);
  if (qtyAdded <= 0) return showMessage("Quantity added must be greater than zero.", true);

  const beforeQty = Number(selectedPart.currentQuantity || 0);
  selectedPart.currentQuantity = beforeQty + qtyAdded;
  state.movements.unshift({
    date: todayText(),
    type: "ADDED",
    invoiceNumber: "",
    partId: selectedPart.id,
    beforeQty,
    quantityChange: qtyAdded,
    afterQty: selectedPart.currentQuantity,
    user: getCurrentUser()
  });

  saveState();
  renderAll();
  populateAddInventorySelect();
  refreshAllLineInfo();
  qs("quantityAdded").value = "";
  showMessage("Inventory added successfully.", false);
}

function populateAddInventorySelect() {
  qs("addPart").innerHTML = state.parts.map(p => `<option value="${p.id}">${escapeHtml(p.rackingType)} - ${escapeHtml(p.name)}</option>`).join("");
}

function getInvoiceLineItems(invoice) {
  if (Array.isArray(invoice.lineItems)) return invoice.lineItems;

  // Supports old single-line invoices already saved in localStorage.
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
  if (!invoice) return;

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
  doc.text(`Location: ${invoice.location}`, 14, y); y += 8;
  if (invoice.user) {
    doc.text(`User: ${invoice.user}`, 14, y); y += 8;
  }

  doc.autoTable({
    startY: y + 4,
    head: [["Racking Type", "Item / Part", "Qty Used", "Cost Each", "Line Total"]],
    body: lineItems.map(line => [
      line.rackingType,
      line.partName,
      line.quantityUsed,
      money(line.costEach),
      money(line.total)
    ])
  });

  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(14);
  doc.text(`Invoice Total: ${money(invoice.total)}`, 14, finalY);

  doc.save(`${invoice.invoiceNumber}.pdf`);
}

function showMessage(message, isError) {
  const box = qs("message");
  box.textContent = message;
  box.className = isError ? "message error" : "message success";
  setTimeout(() => {
    box.textContent = "";
    box.className = "message";
  }, 5000);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

document.addEventListener("DOMContentLoaded", () => {
  // Restore saved user name from localStorage
  const savedUser = localStorage.getItem(USER_STORAGE_KEY);
  if (savedUser) qs("userName").value = savedUser;
  qs("userName").addEventListener("change", () => {
    localStorage.setItem(USER_STORAGE_KEY, getCurrentUser());
  });

  qs("usageForm").addEventListener("submit", useInventory);
  qs("addInventoryForm").addEventListener("submit", addInventory);
  qs("addLineButton").addEventListener("click", () => addLineItem());
  qs("cancelEditButton").addEventListener("click", () => cancelEditInvoice(false));

  renderAll();
  addLineItem();
  populateAddInventorySelect();
});
