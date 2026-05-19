// Racking Inventory App
// Stores all data in the browser with localStorage.
// Works as a static GitHub Pages website.

const STORAGE_KEY = "rackingInventoryApp.v1";
const MAX_LINE_ITEMS = 24;

let state = loadState();
let lineItemCounter = 0;

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
  location.innerHTML = state.locations.map(loc => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`).join("");
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

function addLineItem() {
  const lineItems = qs("lineItems");
  const currentLines = lineItems.querySelectorAll(".line-item").length;

  if (currentLines >= MAX_LINE_ITEMS) {
    showMessage(`You can only add up to ${MAX_LINE_ITEMS} line items.`, true);
    return;
  }

  lineItemCounter += 1;
  const firstType = getRackingTypes()[0] || "";
  const line = document.createElement("div");
  line.className = "line-item";
  line.dataset.lineId = String(lineItemCounter);
  line.innerHTML = `
    <div class="line-number">#${currentLines + 1}</div>
    <label>
      Racking Type
      <select class="line-racking-type" required>${rackingTypeOptions(firstType)}</select>
    </label>
    <label>
      Item / Part
      <select class="line-part" required>${partOptionsForType(firstType)}</select>
    </label>
    <div class="info line-info"></div>
    <label>
      Quantity Used
      <input class="line-qty" type="number" min="1" step="1" required>
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
    return `
      <div class="invoice-row">
        <div>
          <strong>${escapeHtml(inv.invoiceNumber)}</strong>
          <span>${escapeHtml(inv.location)} | ${escapeHtml(inv.date)} | ${lineCount} line item${lineCount === 1 ? "" : "s"}</span>
        </div>
        <div>
          <strong>${money(inv.total)}</strong>
          <button onclick="downloadInvoicePdf('${inv.invoiceNumber}')">PDF</button>
        </div>
      </div>
    `;
  }).join("");
}

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

  const invoiceNumber = makeInvoiceNumber();
  const invoiceLines = requestedLines.map(line => {
    const beforeQty = Number(line.part.currentQuantity || 0);
    const afterQty = beforeQty - line.qtyUsed;
    line.part.currentQuantity = afterQty;

    const lineTotal = line.qtyUsed * Number(line.part.costEach || 0);

    state.movements.unshift({
      date: todayText(),
      type: "USED",
      invoiceNumber,
      partId: line.part.id,
      beforeQty,
      quantityChange: -line.qtyUsed,
      afterQty
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

  const invoice = {
    invoiceNumber,
    date: todayText(),
    location: qs("location").value,
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
    afterQty: selectedPart.currentQuantity
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
  doc.text(`Invoice #: ${invoice.invoiceNumber}`, 14, 32);
  doc.text(`Date: ${invoice.date}`, 14, 40);
  doc.text(`Location: ${invoice.location}`, 14, 48);

  doc.autoTable({
    startY: 60,
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

function resetDemoData() {
  if (!confirm("Reset all inventory and invoices? This cannot be undone.")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  qs("lineItems").innerHTML = "";
  addLineItem();
  renderAll();
  populateAddInventorySelect();
  showMessage("Data reset complete.", false);
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
  qs("usageForm").addEventListener("submit", useInventory);
  qs("addInventoryForm").addEventListener("submit", addInventory);
  qs("resetButton").addEventListener("click", resetDemoData);
  qs("addLineButton").addEventListener("click", addLineItem);

  renderAll();
  addLineItem();
  populateAddInventorySelect();
});
