// Mc Racking — Admin page logic
// Password-gated. All changes write to Firestore and to the audit_log collection.

// ====== CHANGE THE ADMIN PASSWORD HERE ======================================
const ADMIN_PASSWORD = "McCoys1927";
// ============================================================================

const ADMIN_UNLOCK_KEY = "rackingInventoryApp.adminUnlocked";
const ADMIN_USER_KEY   = "rackingInventoryApp.adminUser";

let adminState = {
  parts: [],
  users: [],
  locations: [],
  invoices: [],
  auditLog: [],
  deletions: []
};

// ---------- Helpers --------------------------------------------------------

function qs(id) { return document.getElementById(id); }

function escapeHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function setConnectionStatus(text, cls) {
  const el = qs("connectionStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "connection-status " + (cls || "");
}

function getAdminUser() {
  return (qs("adminUserName").value || "").trim();
}

function requireAdminUser() {
  if (!getAdminUser()) {
    showAdminMessage("Please select your name from the Admin User dropdown before making changes.", true);
    qs("adminUserName").focus();
    return false;
  }
  return true;
}

function showAdminMessage(text, isError) {
  const box = qs("adminMessage");
  if (!box) return;
  box.textContent = text;
  box.className = isError ? "message error" : "message success";
  setTimeout(() => { box.textContent = ""; box.className = "message"; }, 5000);
}

function formatWhen(ts) {
  if (!ts) return "—";
  // Firestore Timestamp object
  if (ts.toDate) return ts.toDate().toLocaleString();
  if (typeof ts === "number") return new Date(ts).toLocaleString();
  return String(ts);
}

// ---------- Audit log ------------------------------------------------------

async function recordAudit(action, target, details) {
  try {
    await db.collection("audit_log").add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      admin: getAdminUser() || "(unknown)",
      action,
      target,
      details: details || {}
    });
  } catch (err) {
    console.error("Audit write failed:", err);
  }
}

// ---------- Password gate --------------------------------------------------

function setupPasswordGate() {
  // Stay unlocked for the session if the user has already entered the password
  if (sessionStorage.getItem(ADMIN_UNLOCK_KEY) === "yes") {
    unlockAdmin();
    return;
  }

  // No saved unlock — show the gate now
  qs("passwordGate").style.display = "";
  qs("passwordInput").focus();

  qs("passwordForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const entered = qs("passwordInput").value;
    if (entered === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_UNLOCK_KEY, "yes");
      unlockAdmin();
    } else {
      qs("passwordError").textContent = "Incorrect password.";
      qs("passwordInput").value = "";
      qs("passwordInput").focus();
    }
  });
}

function unlockAdmin() {
  qs("passwordGate").style.display = "none";
  qs("adminApp").style.display = "";
  startAdmin();
}

// ---------- Firestore listeners --------------------------------------------

function attachAdminListeners() {
  db.collection("parts").onSnapshot(snap => {
    adminState.parts = [];
    snap.forEach(d => adminState.parts.push(d.data()));
    adminState.parts.sort((a, b) => {
      const an = Number((a.id || "").replace("part-", "")) || 0;
      const bn = Number((b.id || "").replace("part-", "")) || 0;
      return an - bn;
    });
    renderPartsTable();
    updateExportCounts();
    setConnectionStatus("Live", "connected");
  }, err => {
    console.error("Parts listener error:", err);
    setConnectionStatus("Connection error", "error");
  });

  db.collection("settings").doc("users").onSnapshot(doc => {
    adminState.users = (doc.exists && Array.isArray(doc.data().list)) ? doc.data().list.slice() : [];
    renderUsersList();
    populateAdminUserSelect();
  });

  db.collection("settings").doc("locations").onSnapshot(doc => {
    const list = (doc.exists && Array.isArray(doc.data().list)) ? doc.data().list.slice() : [];
    // Normalize: strings -> object, missing fields -> ""
    adminState.locations = list
      .map(loc => (typeof loc === "string"
        ? { name: loc, phone: "", address: "", city: "", state: "", zip: "" }
        : Object.assign({ name: "", phone: "", address: "", city: "", state: "", zip: "" }, loc)))
      .filter(loc => loc.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    renderLocationsList();
  });

  db.collection("audit_log").orderBy("timestamp", "desc").limit(500).onSnapshot(snap => {
    adminState.auditLog = [];
    snap.forEach(d => adminState.auditLog.push({ id: d.id, ...d.data() }));
    renderAuditLog();
  });

  db.collection("deletions").orderBy("deletedAt", "desc").limit(10).onSnapshot(snap => {
    adminState.deletions = [];
    snap.forEach(d => adminState.deletions.push({ id: d.id, ...d.data() }));
    renderRecoveryTable();
  });

  db.collection("invoices").orderBy("createdAt", "desc").onSnapshot(snap => {
    adminState.invoices = [];
    snap.forEach(d => adminState.invoices.push(d.data()));
    updateExportCounts();
    renderArchivedMonths();
  });
}

// ---------- Admin user select ----------------------------------------------

function populateAdminUserSelect() {
  const select = qs("adminUserName");
  const previous = select.value;
  const users = adminState.users.slice().sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">— Select your name —</option>` +
    users.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
  // Restore previous or saved selection
  const saved = localStorage.getItem(ADMIN_USER_KEY);
  if (previous && [...select.options].some(o => o.value === previous)) {
    select.value = previous;
  } else if (saved && [...select.options].some(o => o.value === saved)) {
    select.value = saved;
  }
}

// ---------- PARTS tab ------------------------------------------------------

function renderPartsTable() {
  const body = qs("adminPartsBody");
  if (!adminState.parts.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px;">No parts yet. Add one above.</td></tr>`;
    return;
  }
  body.innerHTML = adminState.parts.map(p => `
    <tr data-part-id="${escapeHtml(p.id)}">
      <td><input class="cell-edit" data-field="rackingType" type="text" value="${escapeHtml(p.rackingType || "")}"></td>
      <td><input class="cell-edit" data-field="name" type="text" value="${escapeHtml(p.name || "")}"></td>
      <td><input class="cell-edit" data-field="startingQuantity" type="number" min="0" step="1" value="${Number(p.startingQuantity || 0)}"></td>
      <td><input class="cell-edit" data-field="currentQuantity" type="number" min="0" step="1" value="${Number(p.currentQuantity || 0)}"></td>
      <td><input class="cell-edit" data-field="costEach" type="number" min="0" step="0.01" value="${Number(p.costEach || 0)}"></td>
      <td><input class="cell-edit" data-field="lowStockThreshold" type="number" min="0" step="1" value="${Number(p.lowStockThreshold || 0)}"></td>
      <td>
        <button type="button" class="danger" data-action="delete-part">Delete</button>
      </td>
    </tr>
  `).join("");

  // Wire up listeners on edits
  body.querySelectorAll("tr").forEach(tr => {
    const partId = tr.dataset.partId;
    tr.querySelectorAll("input.cell-edit").forEach(inp => {
      inp.addEventListener("change", () => savePartField(partId, inp.dataset.field, inp));
    });
    const delBtn = tr.querySelector('[data-action="delete-part"]');
    if (delBtn) delBtn.addEventListener("click", () => deletePart(partId));
  });
}

async function savePartField(partId, field, input) {
  if (!requireAdminUser()) {
    // Revert the input
    const part = adminState.parts.find(p => p.id === partId);
    if (part) input.value = part[field] != null ? part[field] : "";
    return;
  }

  const part = adminState.parts.find(p => p.id === partId);
  if (!part) return;
  const oldValue = part[field];
  let newValue = input.value;
  if (["startingQuantity", "currentQuantity", "costEach", "lowStockThreshold"].includes(field)) {
    newValue = Number(newValue);
    if (Number.isNaN(newValue)) { input.value = oldValue; return; }
  } else {
    newValue = String(newValue).trim();
    if (!newValue) {
      showAdminMessage(`${field} cannot be empty.`, true);
      input.value = oldValue;
      return;
    }
  }
  if (String(oldValue) === String(newValue)) return;

  // FIX #4: warn when changing name or cost — old invoices keep their original snapshot
  if (field === "name" || field === "costEach" || field === "rackingType") {
    const labelMap = { name: "name", costEach: "cost", rackingType: "racking type" };
    const proceed = confirm(
      `Heads up: changing this part's ${labelMap[field]} only affects future invoices.\n\n` +
      `Existing invoices will keep showing the original ${labelMap[field]} they were created with.\n\n` +
      `Continue?`
    );
    if (!proceed) { input.value = oldValue; return; }
  }

  try {
    await db.collection("parts").doc(partId).update({ [field]: newValue });
    await recordAudit("EDIT_PART", part.name, {
      partId, field, before: oldValue, after: newValue
    });
    showAdminMessage(`Saved: ${part.name} → ${field}`, false);
  } catch (err) {
    console.error("Save failed:", err);
    showAdminMessage("Save failed: " + err.message, true);
    input.value = oldValue;
  }
}

async function deletePart(partId) {
  if (!requireAdminUser()) return;
  const part = adminState.parts.find(p => p.id === partId);
  if (!part) return;
  if (!confirm(`Delete "${part.name}"?\n\nIt will be recoverable from the Recovery tab for a limited time.\n\nInvoices that reference this part will keep showing the part's name and price.`)) return;

  try {
    const batch = db.batch();
    batch.delete(db.collection("parts").doc(partId));

    // Record the deletion to the recovery log
    const deletionRef = db.collection("deletions").doc();
    batch.set(deletionRef, {
      type: "part",
      identifier: part.name,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deletedBy: getAdminUser() || "(unknown)",
      snapshot: stripUndefined(part)
    });

    await batch.commit();

    await recordAudit("DELETE_PART", part.name, { partId, partData: part });
    showAdminMessage(`Deleted: ${part.name} (recoverable from the Recovery tab)`, false);
  } catch (err) {
    console.error("Delete failed:", err);
    showAdminMessage("Delete failed: " + err.message, true);
  }
}

// Remove `undefined` recursively (Firestore rejects undefined, only null is allowed)
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

async function addNewPart(e) {
  e.preventDefault();
  if (!requireAdminUser()) return;

  const rackingType = qs("newPartRackingType").value.trim();
  const name = qs("newPartName").value.trim();
  const startingQuantity = Number(qs("newPartStartingQty").value || 0);
  const costEach = Number(qs("newPartCost").value || 0);
  const lowStockThreshold = Number(qs("newPartThreshold").value || 5);

  if (!rackingType || !name) { showAdminMessage("Racking Type and Item Name are required.", true); return; }

  // Generate new part id: find max numeric suffix among existing part-NN ids, +1
  let maxN = 0;
  adminState.parts.forEach(p => {
    const n = Number((p.id || "").replace("part-", "")) || 0;
    if (n > maxN) maxN = n;
  });
  const newId = `part-${maxN + 1}`;
  const partData = {
    id: newId,
    rackingType,
    name,
    startingQuantity,
    currentQuantity: startingQuantity,
    costEach,
    lowStockThreshold
  };

  try {
    await db.collection("parts").doc(newId).set(partData);
    await recordAudit("ADD_PART", name, { partId: newId, partData });
    qs("addPartForm").reset();
    qs("newPartStartingQty").value = "0";
    qs("newPartCost").value = "0";
    qs("newPartThreshold").value = "5";
    showAdminMessage(`Added part: ${name}`, false);
  } catch (err) {
    console.error("Add part failed:", err);
    showAdminMessage("Add failed: " + err.message, true);
  }
}

// ---------- USERS tab ------------------------------------------------------

function renderUsersList() {
  const ul = qs("adminUsersList");
  if (!adminState.users.length) {
    ul.innerHTML = `<li class="muted">No users yet. Add one above.</li>`;
    return;
  }
  const sorted = adminState.users.slice().sort((a, b) => a.localeCompare(b));
  ul.innerHTML = sorted.map(u => `
    <li>
      <span>${escapeHtml(u)}</span>
      <button type="button" class="danger" data-user="${escapeHtml(u)}">Remove</button>
    </li>
  `).join("");
  ul.querySelectorAll("button[data-user]").forEach(btn => {
    btn.addEventListener("click", () => removeUser(btn.dataset.user));
  });
}

async function addUser(e) {
  e.preventDefault();
  if (!requireAdminUser()) return;
  const name = qs("newUserName").value.trim();
  if (!name) return;
  if (adminState.users.includes(name)) {
    showAdminMessage("That user is already on the list.", true);
    return;
  }
  const newList = adminState.users.concat([name]);
  try {
    await db.collection("settings").doc("users").set({ list: newList });
    await recordAudit("ADD_USER", name, { user: name });
    qs("newUserName").value = "";
    showAdminMessage(`Added user: ${name}`, false);
  } catch (err) {
    console.error("Add user failed:", err);
    showAdminMessage("Add failed: " + err.message, true);
  }
}

async function removeUser(name) {
  if (!requireAdminUser()) return;
  if (!confirm(`Remove "${name}" from the user list?\n\nExisting invoices created by this user will still show their name.`)) return;
  const previousList = adminState.users.slice();
  const newList = adminState.users.filter(u => u !== name);
  try {
    await db.collection("settings").doc("users").set({ list: newList });
    await recordAudit("REMOVE_USER", name, { user: name, previousList });
    showAdminMessage(`Removed user: ${name}`, false);
  } catch (err) {
    console.error("Remove user failed:", err);
    showAdminMessage("Remove failed: " + err.message, true);
  }
}

// ---------- LOCATIONS tab --------------------------------------------------

function renderLocationsList() {
  const body = qs("adminLocationsBody");
  if (!body) {
    // Fallback for the older list element if HTML didn't update — keep it functional
    const ul = qs("adminLocationsList");
    if (ul) ul.innerHTML = `<li class="muted">Refresh the page to see the new editable locations table.</li>`;
    return;
  }
  if (!adminState.locations.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px;">No locations yet. Add one above, or click "Import Default Stores" to load the McCoy's master list.</td></tr>`;
    return;
  }
  body.innerHTML = adminState.locations.map(loc => `
    <tr data-loc-name="${escapeHtml(loc.name)}">
      <td><strong>${escapeHtml(loc.name)}</strong></td>
      <td><input class="cell-edit loc-field" data-field="address" type="text" value="${escapeHtml(loc.address || "")}"></td>
      <td><input class="cell-edit loc-field" data-field="city"    type="text" value="${escapeHtml(loc.city || "")}"></td>
      <td><input class="cell-edit loc-field" data-field="state"   type="text" value="${escapeHtml(loc.state || "")}" maxlength="2" style="width:48px;text-transform:uppercase;"></td>
      <td><input class="cell-edit loc-field" data-field="zip"     type="text" value="${escapeHtml(loc.zip || "")}" style="width:90px;"></td>
      <td><input class="cell-edit loc-field" data-field="phone"   type="text" value="${escapeHtml(loc.phone || "")}" style="width:120px;"></td>
      <td><button type="button" class="danger" data-loc="${escapeHtml(loc.name)}">Remove</button></td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-loc-name]").forEach(tr => {
    const locName = tr.dataset.locName;
    tr.querySelectorAll("input.loc-field").forEach(inp => {
      inp.addEventListener("change", () => saveLocationField(locName, inp.dataset.field, inp));
    });
    const removeBtn = tr.querySelector("button[data-loc]");
    if (removeBtn) removeBtn.addEventListener("click", () => removeLocation(locName));
  });
}

async function saveLocationField(locName, field, input) {
  if (!requireAdminUser()) {
    const loc = adminState.locations.find(l => l.name === locName);
    if (loc) input.value = loc[field] || "";
    return;
  }
  const loc = adminState.locations.find(l => l.name === locName);
  if (!loc) return;
  const oldValue = loc[field] || "";
  let newValue = String(input.value).trim();
  if (field === "state") newValue = newValue.toUpperCase();
  if (newValue === oldValue) return;

  const newList = adminState.locations.map(l =>
    l.name === locName ? Object.assign({}, l, { [field]: newValue }) : l
  );
  try {
    await db.collection("settings").doc("locations").set({ list: newList });
    await recordAudit("EDIT_LOCATION", locName, { location: locName, field, before: oldValue, after: newValue });
    showAdminMessage(`Saved ${field} for ${locName}`, false);
  } catch (err) {
    console.error("Save location field failed:", err);
    showAdminMessage("Save failed: " + err.message, true);
    input.value = oldValue;
  }
}

async function addLocation(e) {
  e.preventDefault();
  if (!requireAdminUser()) return;
  const name = qs("newLocationName").value.trim();
  if (!name) return;
  if (adminState.locations.some(l => l.name === name)) {
    showAdminMessage("That location is already on the list.", true);
    return;
  }
  const newLoc = {
    name,
    address: (qs("newLocationAddress").value || "").trim(),
    city:    (qs("newLocationCity").value || "").trim(),
    state:   (qs("newLocationState").value || "").trim().toUpperCase(),
    zip:     (qs("newLocationZip").value || "").trim(),
    phone:   (qs("newLocationPhone").value || "").trim()
  };
  const newList = adminState.locations.concat([newLoc]);
  try {
    await db.collection("settings").doc("locations").set({ list: newList });
    await recordAudit("ADD_LOCATION", name, { location: name });
    qs("addLocationForm").reset();
    showAdminMessage(`Added location: ${name}`, false);
  } catch (err) {
    console.error("Add location failed:", err);
    showAdminMessage("Add failed: " + err.message, true);
  }
}

async function removeLocation(name) {
  if (!requireAdminUser()) return;
  if (!confirm(`Remove "${name}" from the location list?\n\nExisting invoices for this location will still show it.`)) return;
  const previousList = adminState.locations.slice();
  const newList = adminState.locations.filter(l => l.name !== name);
  try {
    await db.collection("settings").doc("locations").set({ list: newList });
    await recordAudit("REMOVE_LOCATION", name, { location: name, previousList });
    showAdminMessage(`Removed location: ${name}`, false);
  } catch (err) {
    console.error("Remove location failed:", err);
    showAdminMessage("Remove failed: " + err.message, true);
  }
}

// One-time import of the McCoy's master store list from data.js.
// Merges with the existing list, filling in addresses for any matching names.
async function importDefaultLocations() {
  if (!requireAdminUser()) return;
  if (typeof STARTING_LOCATIONS === "undefined" || !Array.isArray(STARTING_LOCATIONS)) {
    showAdminMessage("Default store list isn't available.", true);
    return;
  }
  if (!confirm(`Import the McCoy's master store list (${STARTING_LOCATIONS.length} stores)?\n\n- Existing locations with matching names will be UPDATED with the master address info.\n- New stores will be ADDED.\n- Locations not in the master list will be KEPT untouched.\n\nProceed?`)) return;

  // Build a map of existing locations by name
  const existingMap = new Map(adminState.locations.map(l => [l.name, l]));
  let updated = 0, added = 0;

  for (const master of STARTING_LOCATIONS) {
    if (existingMap.has(master.name)) {
      // Merge: keep any existing fields the master doesn't have, overwrite the rest
      const before = existingMap.get(master.name);
      existingMap.set(master.name, Object.assign({}, before, master));
      updated++;
    } else {
      existingMap.set(master.name, Object.assign({}, master));
      added++;
    }
  }

  const newList = [...existingMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  try {
    await db.collection("settings").doc("locations").set({ list: newList });
    await recordAudit("IMPORT_LOCATIONS", "default master list", { added, updated });
    showAdminMessage(`Imported defaults: ${added} added, ${updated} updated.`, false);
  } catch (err) {
    console.error("Import locations failed:", err);
    showAdminMessage("Import failed: " + err.message, true);
  }
}

// ---------- RECOVERY tab ---------------------------------------------------

function renderRecoveryTable() {
  const body = qs("recoveryBody");
  if (!body) return;
  if (!adminState.deletions.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px;">No recent deletions. When invoices or parts are deleted, they will appear here for a limited time.</td></tr>`;
    return;
  }
  body.innerHTML = adminState.deletions.map(d => {
    const summary = buildDeletionSummary(d);
    return `
      <tr>
        <td>${escapeHtml(formatWhen(d.deletedAt))}</td>
        <td><strong>${escapeHtml(d.type || "")}</strong></td>
        <td>${escapeHtml(d.identifier || "")}</td>
        <td>${escapeHtml(d.deletedBy || "—")}</td>
        <td>${summary}</td>
        <td>
          <button type="button" data-restore="${escapeHtml(d.id)}">Restore</button>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll("button[data-restore]").forEach(btn => {
    btn.addEventListener("click", () => restoreDeletion(btn.dataset.restore));
  });
}

function buildDeletionSummary(d) {
  const snap = d.snapshot || {};
  if (d.type === "invoice") {
    const lines = Array.isArray(snap.lineItems) ? snap.lineItems.length : 1;
    return `${lines} line item(s), total ${money(snap.total)}<br><span class="muted" style="font-size:12px;">${escapeHtml(snap.location || "")}</span>`;
  }
  if (d.type === "part") {
    return `${escapeHtml(snap.rackingType || "")} · qty ${Number(snap.currentQuantity || 0)} @ ${money(snap.costEach)}`;
  }
  return "";
}

async function restoreDeletion(deletionId) {
  if (!requireAdminUser()) return;
  const d = adminState.deletions.find(x => x.id === deletionId);
  if (!d) return;
  if (d.type === "invoice") return restoreInvoiceDeletion(d);
  if (d.type === "part")    return restorePartDeletion(d);
  showAdminMessage("Unknown deletion type.", true);
}

async function restoreInvoiceDeletion(d) {
  const snap = d.snapshot || {};
  const invoiceNumber = snap.invoiceNumber || d.identifier;

  // Confirm: restoring will RE-DEDUCT inventory
  const lines = Array.isArray(snap.lineItems) ? snap.lineItems : [];
  if (!confirm(`Restore invoice ${invoiceNumber}?\n\nThis will:\n• Re-create the invoice with its original data\n• Re-deduct ${lines.length} line item(s) from inventory\n\nProceed?`)) return;

  // Check inventory availability — if a part isn't in stock anymore, refuse
  const requestedByPart = new Map();
  for (const l of lines) {
    requestedByPart.set(l.partId, (requestedByPart.get(l.partId) || 0) + Number(l.quantityUsed || 0));
  }
  const shortages = [];
  for (const [partId, requested] of requestedByPart.entries()) {
    const part = adminState.parts.find(p => p.id === partId);
    if (!part) {
      shortages.push(`Part "${(lines.find(l=>l.partId===partId)||{}).partName||partId}" no longer exists in inventory.`);
    } else if (Number(part.currentQuantity || 0) < requested) {
      shortages.push(`${part.name}: need ${requested}, only ${part.currentQuantity} on hand.`);
    }
  }
  if (shortages.length) {
    showAdminMessage("Cannot restore — inventory shortage:\n" + shortages.join("\n"), true);
    return;
  }

  // Also refuse if the invoice number is somehow back already
  try {
    const existing = await db.collection("invoices").doc(invoiceNumber).get();
    if (existing.exists) {
      showAdminMessage(`Cannot restore — an invoice with number ${invoiceNumber} already exists.`, true);
      return;
    }
  } catch (err) {
    console.error("Existence check failed:", err);
  }

  try {
    const batch = db.batch();

    // Deduct inventory (atomic, race-safe)
    for (const [partId, requested] of requestedByPart.entries()) {
      batch.update(db.collection("parts").doc(partId), {
        currentQuantity: firebase.firestore.FieldValue.increment(-requested)
      });
    }

    // Re-create the invoice (use server timestamps for the restore moment so it sorts naturally;
    // preserve the original `date` text and add a `restoredAt` for clarity)
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const restored = Object.assign({}, snap, {
      restoredAt: now,
      restoredBy: getAdminUser() || "(unknown)",
      // updatedAt should reflect this restore action
      updatedAt: now
    });
    // Strip any leftover editing lock fields from the snapshot (deleted invoices shouldn't
    // come back locked). We can't use FieldValue.delete() with set() — just don't include them.
    delete restored.editingBy;
    delete restored.editingSince;
    // If createdAt is missing for some reason, set it to now
    if (!restored.createdAt) restored.createdAt = now;

    batch.set(db.collection("invoices").doc(invoiceNumber), restored);

    // Remove from deletions log
    batch.delete(db.collection("deletions").doc(d.id));

    await batch.commit();
    await recordAudit("RESTORE_INVOICE", invoiceNumber, { invoiceNumber, lineItemCount: lines.length });
    showAdminMessage(`Restored invoice ${invoiceNumber}.`, false);
  } catch (err) {
    console.error("Restore invoice failed:", err);
    showAdminMessage("Restore failed: " + err.message, true);
  }
}

async function restorePartDeletion(d) {
  const snap = d.snapshot || {};
  const partId = snap.id;
  const partName = snap.name || d.identifier;

  if (!partId) { showAdminMessage("Cannot restore — part snapshot is missing its id.", true); return; }

  // Check if a part with this id already exists
  try {
    const existing = await db.collection("parts").doc(partId).get();
    if (existing.exists) {
      showAdminMessage(`A part with id ${partId} already exists. Cannot overwrite.`, true);
      return;
    }
  } catch (err) {
    console.error("Existence check failed:", err);
  }

  if (!confirm(`Restore part "${partName}"?\n\nIt will be re-added to inventory with its original quantities.`)) return;

  try {
    const batch = db.batch();
    batch.set(db.collection("parts").doc(partId), snap);
    batch.delete(db.collection("deletions").doc(d.id));
    await batch.commit();
    await recordAudit("RESTORE_PART", partName, { partId, partData: snap });
    showAdminMessage(`Restored part: ${partName}`, false);
  } catch (err) {
    console.error("Restore part failed:", err);
    showAdminMessage("Restore failed: " + err.message, true);
  }
}

// ---------- EXPORT tab -----------------------------------------------------

function updateExportCounts() {
  const partsEl = qs("exportInventoryCount");
  if (partsEl) partsEl.textContent = adminState.parts.length;
  const invEl = qs("exportInvoicesCount");
  if (invEl) invEl.textContent = adminState.invoices.length;
}

function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function exportInventoryToExcel() {
  if (typeof XLSX === "undefined") {
    showAdminMessage("Excel library failed to load. Check your internet connection and try again.", true);
    return;
  }
  if (!adminState.parts.length) {
    showAdminMessage("No parts to export.", true);
    return;
  }

  // Build sorted rows
  const rows = adminState.parts.slice().sort((a, b) => {
    // Sort by Racking Type then Item Name
    const rt = String(a.rackingType || "").localeCompare(String(b.rackingType || ""));
    if (rt !== 0) return rt;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }).map(p => {
    const qty = Number(p.currentQuantity || 0);
    const cost = Number(p.costEach || 0);
    const threshold = Number(p.lowStockThreshold || 0);
    return {
      "Racking Type": p.rackingType || "",
      "Item / Part": p.name || "",
      "Starting Qty": Number(p.startingQuantity || 0),
      "Current Qty": qty,
      "Cost Each": cost,
      "Current Value": qty * cost,
      "Low Stock Threshold": threshold,
      "Status": qty <= threshold ? "LOW STOCK" : "OK",
      "Part ID": p.id || ""
    };
  });

  // Totals row
  const totalQty = rows.reduce((s, r) => s + r["Current Qty"], 0);
  const totalValue = rows.reduce((s, r) => s + r["Current Value"], 0);
  rows.push({});
  rows.push({
    "Racking Type": "TOTAL",
    "Current Qty": totalQty,
    "Current Value": totalValue
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  // Reasonable column widths
  ws["!cols"] = [
    { wch: 18 }, // Racking Type
    { wch: 50 }, // Item / Part
    { wch: 12 }, // Starting Qty
    { wch: 12 }, // Current Qty
    { wch: 11 }, // Cost Each
    { wch: 14 }, // Current Value
    { wch: 18 }, // Low Stock Threshold
    { wch: 11 }, // Status
    { wch: 10 }  // Part ID
  ];

  // Format Cost Each and Current Value as currency where possible
  formatColumnAsCurrency(ws, rows.length, "E"); // Cost Each
  formatColumnAsCurrency(ws, rows.length, "F"); // Current Value

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");

  const filename = `mc-racking-inventory-${todayISO()}.xlsx`;
  XLSX.writeFile(wb, filename);
  showAdminMessage(`Downloaded: ${filename}`, false);
}

function exportInvoicesToExcel() {
  if (typeof XLSX === "undefined") {
    showAdminMessage("Excel library failed to load. Check your internet connection and try again.", true);
    return;
  }
  if (!adminState.invoices.length) {
    showAdminMessage("No invoices to export.", true);
    return;
  }

  // Sheet 1: Summary (one row per invoice)
  const summaryRows = adminState.invoices.map(inv => {
    const lines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
    return {
      "Invoice #": inv.invoiceNumber || "",
      "Date": inv.date || "",
      "Last Edited": inv.lastEditedDate || "",
      "User": inv.user || "",
      "Location": inv.location || "",
      "Line Items": lines.length,
      "Total": Number(inv.total || 0)
    };
  });

  const summaryTotal = summaryRows.reduce((s, r) => s + r["Total"], 0);
  summaryRows.push({});
  summaryRows.push({ "Invoice #": "TOTAL", "Total": summaryTotal });

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 },
    { wch: 22 }, { wch: 10 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsSummary, summaryRows.length, "G"); // Total

  // Sheet 2: Line Items (one row per line item across ALL invoices)
  const lineRows = [];
  for (const inv of adminState.invoices) {
    const lines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
    for (const l of lines) {
      lineRows.push({
        "Invoice #": inv.invoiceNumber || "",
        "Date": inv.date || "",
        "User": inv.user || "",
        "Location": inv.location || "",
        "Racking Type": l.rackingType || "",
        "Item / Part": l.partName || "",
        "Qty Used": Number(l.quantityUsed || 0),
        "Cost Each": Number(l.costEach || 0),
        "Line Total": Number(l.total || 0)
      });
    }
  }

  const lineTotal = lineRows.reduce((s, r) => s + r["Line Total"], 0);
  lineRows.push({});
  lineRows.push({ "Invoice #": "TOTAL", "Line Total": lineTotal });

  const wsLines = XLSX.utils.json_to_sheet(lineRows);
  wsLines["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 22 },
    { wch: 18 }, { wch: 50 }, { wch: 10 }, { wch: 11 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsLines, lineRows.length, "H"); // Cost Each
  formatColumnAsCurrency(wsLines, lineRows.length, "I"); // Line Total

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Invoice Summary");
  XLSX.utils.book_append_sheet(wb, wsLines, "Line Items");

  const filename = `mc-racking-invoices-${todayISO()}.xlsx`;
  XLSX.writeFile(wb, filename);
  showAdminMessage(`Downloaded: ${filename} (${adminState.invoices.length} invoices, ${lineRows.length - 2} line items)`, false);
}

// ---------- ARCHIVED INVOICES tab -----------------------------------------

// "YYYY-MM" for the current local month
function currentMonthKeyAdmin() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function invoiceMonthKeyAdmin(inv) {
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

function monthLabel(monthKey) {
  // "2026-05" -> "May 2026"
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  const months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  const idx = Math.max(0, Math.min(11, Number(m[2]) - 1));
  return `${months[idx]} ${m[1]}`;
}

// Build a Map<monthKey, invoice[]> excluding the current month.
function groupArchivedInvoices() {
  const thisMonth = currentMonthKeyAdmin();
  const groups = new Map();
  for (const inv of adminState.invoices) {
    const key = invoiceMonthKeyAdmin(inv);
    if (!key || key === thisMonth) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(inv);
  }
  return groups;
}

function renderArchivedMonths() {
  const body = qs("archivedMonthsBody");
  if (!body) return;

  const groups = groupArchivedInvoices();
  if (!groups.size) {
    body.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;padding:20px;">No archived months yet. Invoices from previous calendar months will appear here.</td></tr>`;
    return;
  }

  // Sort months newest-first (string sort works on "YYYY-MM")
  const keys = [...groups.keys()].sort().reverse();

  body.innerHTML = keys.map(key => {
    const invs = groups.get(key);
    const total = invs.reduce((s, inv) => s + Number(inv.total || 0), 0);
    return `
      <tr>
        <td><strong>${escapeHtml(monthLabel(key))}</strong></td>
        <td>${invs.length}</td>
        <td><strong>${money(total)}</strong></td>
        <td>
          <button type="button" data-month="${escapeHtml(key)}">Download .xlsx</button>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll("button[data-month]").forEach(btn => {
    btn.addEventListener("click", () => exportArchivedMonth(btn.dataset.month));
  });
}

function exportArchivedMonth(monthKey) {
  if (typeof XLSX === "undefined") {
    showAdminMessage("Excel library failed to load. Check your internet connection and try again.", true);
    return;
  }
  const groups = groupArchivedInvoices();
  const invs = groups.get(monthKey) || [];
  if (!invs.length) {
    showAdminMessage("No invoices for that month.", true);
    return;
  }

  // Sort within the month: oldest first (chronological reading)
  const sorted = invs.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  // Summary sheet: one row per invoice
  const summaryRows = sorted.map(inv => {
    const lines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
    return {
      "Invoice #": inv.invoiceNumber || "",
      "Date": inv.date || "",
      "Last Edited": inv.lastEditedDate || "",
      "User": inv.user || "",
      "Location": inv.location || "",
      "Line Items": lines.length,
      "Total": Number(inv.total || 0)
    };
  });
  const summaryTotal = summaryRows.reduce((s, r) => s + r["Total"], 0);
  summaryRows.push({});
  summaryRows.push({ "Invoice #": "TOTAL", "Total": summaryTotal });
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 },
    { wch: 22 }, { wch: 10 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsSummary, summaryRows.length, "G");

  // Line items sheet: one row per line item across all invoices in the month
  const lineRows = [];
  for (const inv of sorted) {
    const lines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
    for (const l of lines) {
      lineRows.push({
        "Invoice #": inv.invoiceNumber || "",
        "Date": inv.date || "",
        "User": inv.user || "",
        "Location": inv.location || "",
        "Racking Type": l.rackingType || "",
        "Item / Part": l.partName || "",
        "Qty Used": Number(l.quantityUsed || 0),
        "Cost Each": Number(l.costEach || 0),
        "Line Total": Number(l.total || 0)
      });
    }
  }
  const lineTotal = lineRows.reduce((s, r) => s + r["Line Total"], 0);
  lineRows.push({});
  lineRows.push({ "Invoice #": "TOTAL", "Line Total": lineTotal });
  const wsLines = XLSX.utils.json_to_sheet(lineRows);
  wsLines["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 22 },
    { wch: 18 }, { wch: 50 }, { wch: 10 }, { wch: 11 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsLines, lineRows.length, "H");
  formatColumnAsCurrency(wsLines, lineRows.length, "I");

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Invoice Summary");
  XLSX.utils.book_append_sheet(wb, wsLines, "Line Items");

  // Filename: mc-racking-invoices-2026-05-May.xlsx
  const filename = `mc-racking-invoices-${monthKey}-${monthLabel(monthKey).replace(" ", "-")}.xlsx`;
  XLSX.writeFile(wb, filename);
  showAdminMessage(`Downloaded: ${filename} (${sorted.length} invoice${sorted.length === 1 ? "" : "s"}, ${lineRows.length - 2} line items)`, false);
}

// Apply currency number format to every data cell in the given column letter.
// Skips the header row (row 1) and the blank/total separator if any.
function formatColumnAsCurrency(ws, totalRowsIncludingHeader, colLetter) {
  // json_to_sheet adds a header row, so data starts at row 2
  for (let r = 2; r <= totalRowsIncludingHeader + 1; r++) {
    const addr = colLetter + r;
    const cell = ws[addr];
    if (cell && typeof cell.v === "number") {
      cell.z = '"$"#,##0.00';
    }
  }
}

// ---------- AUDIT tab ------------------------------------------------------

function renderAuditLog() {
  const body = qs("auditBody");
  if (!adminState.auditLog.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px;">No admin changes yet.</td></tr>`;
    return;
  }
  body.innerHTML = adminState.auditLog.map(entry => {
    const d = entry.details || {};
    let detailText = "";
    if (entry.action === "EDIT_PART") {
      const beforeVal = d.field === "costEach" ? money(d.before) : escapeHtml(String(d.before));
      const afterVal  = d.field === "costEach" ? money(d.after)  : escapeHtml(String(d.after));
      detailText = `<code>${escapeHtml(d.field)}</code>: ${beforeVal} → ${afterVal}`;
    } else if (entry.action === "ADD_PART") {
      detailText = `Added new part (id ${escapeHtml(d.partId || "")})`;
    } else if (entry.action === "DELETE_PART") {
      detailText = `Deleted part (id ${escapeHtml(d.partId || "")})`;
    } else if (entry.action === "RESTORE_PART") {
      detailText = `Restored part (id ${escapeHtml(d.partId || "")})`;
    } else if (entry.action === "RESTORE_INVOICE") {
      detailText = `Restored invoice with ${Number(d.lineItemCount || 0)} line item(s)`;
    } else if (entry.action === "DELETE_INVOICE") {
      detailText = `Deleted invoice ${escapeHtml(d.invoiceNumber || "")} (${Number(d.lineItemCount || 0)} line item(s), ${money(d.total)})`;
    } else if (entry.action === "ADD_USER" || entry.action === "REMOVE_USER") {
      detailText = `User: ${escapeHtml(d.user || "")}`;
    } else if (entry.action === "ADD_LOCATION" || entry.action === "REMOVE_LOCATION") {
      detailText = `Location: ${escapeHtml(d.location || "")}`;
    } else {
      detailText = escapeHtml(JSON.stringify(d));
    }
    return `
      <tr>
        <td>${escapeHtml(formatWhen(entry.timestamp))}</td>
        <td>${escapeHtml(entry.admin || "")}</td>
        <td><strong>${escapeHtml(entry.action || "")}</strong></td>
        <td>${escapeHtml(entry.target || "")}</td>
        <td>${detailText}</td>
      </tr>
    `;
  }).join("");
}

// ---------- Tab switching --------------------------------------------------

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const id = "tab-" + btn.dataset.tab;
      qs(id).classList.add("active");
    });
  });
}

// ---------- Boot -----------------------------------------------------------

function startAdmin() {
  setConnectionStatus("Connecting...", "");
  setupTabs();

  qs("addPartForm").addEventListener("submit", addNewPart);
  qs("addUserForm").addEventListener("submit", addUser);
  qs("addLocationForm").addEventListener("submit", addLocation);

  qs("exportInventoryBtn").addEventListener("click", exportInventoryToExcel);
  qs("exportInvoicesBtn").addEventListener("click", exportInvoicesToExcel);

  const importBtn = qs("importLocationsBtn");
  if (importBtn) importBtn.addEventListener("click", importDefaultLocations);

  qs("adminUserName").addEventListener("change", () => {
    localStorage.setItem(ADMIN_USER_KEY, getAdminUser());
  });

  attachAdminListeners();
}

document.addEventListener("DOMContentLoaded", () => {
  setupPasswordGate();
});
