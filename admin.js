// Mc Racking — Admin page logic
// Gated by Firebase Authentication: only users with role="admin" can reach this page.

let adminState = {
  parts: [],
  users: [],
  locations: [],
  trucks: [],
  truckInventory: [],
  invoices: [],
  auditLog: [],
  deletions: [],
  meta: null
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

// Returns the signed-in admin's display name (from Firestore profile).
// All audit log entries and edit timestamps are stamped with this.
function getAdminUser() {
  return (currentUserProfile && currentUserProfile.displayName) || "";
}

function requireAdminUser() {
  // Always true on the admin page — the gate already enforced auth + role.
  // Kept as a function so calls still work and gain explicit error context.
  if (!getAdminUser()) {
    showAdminMessage("Could not identify the signed-in admin. Please sign out and back in.", true);
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
  });

  db.collection("settings").doc("locations").onSnapshot(doc => {
    const list = (doc.exists && Array.isArray(doc.data().list)) ? doc.data().list.slice() : [];
    adminState.locations = list
      .map(loc => (typeof loc === "string"
        ? { name: loc, phone: "", address: "", city: "", state: "", zip: "" }
        : Object.assign({ name: "", phone: "", address: "", city: "", state: "", zip: "" }, loc)))
      .filter(loc => loc.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    renderLocationsList();
  });

  db.collection("settings").doc("trucks").onSnapshot(doc => {
    const list = (doc.exists && Array.isArray(doc.data().list)) ? doc.data().list.slice() : [];
    adminState.trucks = list
      .map(t => (typeof t === "string"
        ? { name: t, driver: "", notes: "" }
        : Object.assign({ name: "", driver: "", notes: "" }, t)))
      .filter(t => t.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    renderTrucksList();
    renderAdminTruckInventory();
  });

  // Live listener: truck_inventory (for the Truck Inventory admin tab)
  db.collection("truck_inventory").onSnapshot(snap => {
    adminState.truckInventory = [];
    snap.forEach(d => adminState.truckInventory.push(Object.assign({ id: d.id }, d.data())));
    adminState.truckInventory.sort((a, b) =>
      (a.truck || "").localeCompare(b.truck || "") ||
      (a.rackingType || "").localeCompare(b.rackingType || "") ||
      (a.partName || "").localeCompare(b.partName || ""));
    renderAdminTruckInventory();
  }, err => {
    console.error("Truck inventory admin listener error:", err);
  });

  // Live listener: meta (invoice counter, for damage invoice numbering)
  db.collection("meta").doc("counters").onSnapshot(doc => {
    adminState.meta = doc.exists ? doc.data() : null;
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
    // Old element fallback
    const ul = qs("adminLocationsList");
    if (ul) ul.innerHTML = `<li class="muted">Refresh the page to see the new editable locations table.</li>`;
    return;
  }
  if (!adminState.locations.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px;">No locations yet. Add one above, or click "Import Default McCoy's Store List" to load the master list.</td></tr>`;
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
    address: (qs("newLocationAddress") && qs("newLocationAddress").value || "").trim(),
    city:    (qs("newLocationCity") && qs("newLocationCity").value || "").trim(),
    state:   (qs("newLocationState") && qs("newLocationState").value || "").trim().toUpperCase(),
    zip:     (qs("newLocationZip") && qs("newLocationZip").value || "").trim(),
    phone:   (qs("newLocationPhone") && qs("newLocationPhone").value || "").trim()
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

// Import the McCoy's master store list from data.js into Firestore.
// Existing matches get their address fields updated; new entries get added.
async function importDefaultLocations() {
  if (!requireAdminUser()) return;
  if (typeof STARTING_LOCATIONS === "undefined" || !Array.isArray(STARTING_LOCATIONS)) {
    showAdminMessage("Default store list isn't available.", true);
    return;
  }
  if (!confirm(`Import the McCoy's master store list (${STARTING_LOCATIONS.length} stores)?\n\n- Existing locations with matching names will be UPDATED with the master address info.\n- New stores will be ADDED.\n- Locations not in the master list will be KEPT untouched.\n\nProceed?`)) return;

  const existingMap = new Map(adminState.locations.map(l => [l.name, l]));
  let updated = 0, added = 0;

  for (const master of STARTING_LOCATIONS) {
    if (existingMap.has(master.name)) {
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


// ---------- TRUCKS tab -----------------------------------------------------

function renderTrucksList() {
  const body = qs("adminTrucksBody");
  if (!body) {
    // Old element fallback
    const ul = qs("adminTrucksList");
    if (ul) ul.innerHTML = `<li class="muted">Refresh the page to see the new editable trucks table.</li>`;
    return;
  }
  if (!adminState.trucks.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;padding:20px;">No trucks yet. Add one above.</td></tr>`;
    return;
  }
  body.innerHTML = adminState.trucks.map(t => `
    <tr data-truck-name="${escapeHtml(t.name)}">
      <td><strong>${escapeHtml(t.name)}</strong></td>
      <td><input class="cell-edit truck-field" data-field="driver" type="text" value="${escapeHtml(t.driver || "")}" placeholder="—"></td>
      <td><input class="cell-edit truck-field" data-field="notes"  type="text" value="${escapeHtml(t.notes || "")}"  placeholder="—"></td>
      <td><button type="button" class="danger" data-truck="${escapeHtml(t.name)}">Remove</button></td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-truck-name]").forEach(tr => {
    const truckName = tr.dataset.truckName;
    tr.querySelectorAll("input.truck-field").forEach(inp => {
      inp.addEventListener("change", () => saveTruckField(truckName, inp.dataset.field, inp));
    });
    const removeBtn = tr.querySelector("button[data-truck]");
    if (removeBtn) removeBtn.addEventListener("click", () => removeTruck(truckName));
  });
}

async function saveTruckField(truckName, field, input) {
  if (!requireAdminUser()) {
    const truck = adminState.trucks.find(t => t.name === truckName);
    if (truck) input.value = truck[field] || "";
    return;
  }
  const truck = adminState.trucks.find(t => t.name === truckName);
  if (!truck) return;
  const oldValue = truck[field] || "";
  const newValue = String(input.value).trim();
  if (newValue === oldValue) return;

  const newList = adminState.trucks.map(t =>
    t.name === truckName ? Object.assign({}, t, { [field]: newValue }) : t
  );
  try {
    await db.collection("settings").doc("trucks").set({ list: newList });
    await recordAudit("EDIT_TRUCK", truckName, { truck: truckName, field, before: oldValue, after: newValue });
    showAdminMessage(`Saved ${field} for ${truckName}`, false);
  } catch (err) {
    console.error("Save truck field failed:", err);
    showAdminMessage("Save failed: " + err.message, true);
    input.value = oldValue;
  }
}

async function addTruck(e) {
  e.preventDefault();
  if (!requireAdminUser()) return;
  const name = qs("newTruckName").value.trim();
  if (!name) return;
  if (adminState.trucks.some(t => t.name === name)) {
    showAdminMessage("That truck is already on the list.", true);
    return;
  }
  const newTruck = {
    name,
    driver: (qs("newTruckDriver") && qs("newTruckDriver").value || "").trim(),
    notes:  (qs("newTruckNotes")  && qs("newTruckNotes").value  || "").trim()
  };
  const newList = adminState.trucks.concat([newTruck]).sort((a, b) => a.name.localeCompare(b.name));
  try {
    await db.collection("settings").doc("trucks").set({ list: newList });
    await recordAudit("ADD_TRUCK", name, { truck: name });
    qs("addTruckForm").reset();
    showAdminMessage(`Added truck: ${name}`, false);
  } catch (err) {
    console.error("Add truck failed:", err);
    showAdminMessage("Add failed: " + err.message, true);
  }
}

async function removeTruck(name) {
  if (!requireAdminUser()) return;
  if (!confirm(`Remove "${name}" from the truck dropdown?\n\nExisting truck inventory and invoices will still keep this truck name. If this truck still has inventory, move or use that inventory before removing it from the active list.`)) return;
  const previousList = adminState.trucks.slice();
  const newList = adminState.trucks.filter(t => t.name !== name);
  try {
    await db.collection("settings").doc("trucks").set({ list: newList });
    await recordAudit("REMOVE_TRUCK", name, { truck: name, previousList });
    showAdminMessage(`Removed truck: ${name}`, false);
  } catch (err) {
    console.error("Remove truck failed:", err);
    showAdminMessage("Remove failed: " + err.message, true);
  }
}

// ---------- TRUCK INVENTORY tab (admin) ------------------------------------

const DAMAGE_LOCATION_NAME = "730 Store Development";

function renderAdminTruckInventory() {
  const container = qs("adminTruckInvContainer");
  if (!container) return;

  // Build map: truckName -> rows[]
  const byTruck = new Map();
  for (const row of adminState.truckInventory) {
    if (Number(row.quantity || 0) <= 0) continue;
    const name = row.truck || "";
    if (!byTruck.has(name)) byTruck.set(name, []);
    byTruck.get(name).push(row);
  }

  // All known trucks (settings + any unknown ones from inventory)
  const allTruckNames = new Set();
  for (const t of adminState.trucks) allTruckNames.add(t.name);
  for (const name of byTruck.keys()) allTruckNames.add(name);

  if (!allTruckNames.size) {
    container.innerHTML = `<p class="muted">No trucks set up yet. Add trucks in the Trucks tab first.</p>`;
    return;
  }

  const truckNames = [...allTruckNames].sort((a, b) => a.localeCompare(b));

  container.innerHTML = truckNames.map(truckName => {
    const items = (byTruck.get(truckName) || []).slice().sort((a, b) =>
      (a.rackingType || "").localeCompare(b.rackingType || "") ||
      (a.partName || "").localeCompare(b.partName || ""));

    const truckInfo = adminState.trucks.find(t => t.name === truckName) || { driver: "", notes: "" };
    const totalQty = items.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const totalValue = items.reduce((s, r) => s + Number(r.quantity || 0) * Number(r.costEach || 0), 0);

    const header = truckInfo.driver
      ? `<strong>${escapeHtml(truckName)}</strong> <span class="muted">— ${escapeHtml(truckInfo.driver)}</span>`
      : `<strong>${escapeHtml(truckName)}</strong>`;

    if (!items.length) {
      return `
        <div class="truck-card">
          <h3 style="margin:0 0 4px;">${header}</h3>
          <p class="muted" style="margin:0;">Empty — no inventory currently loaded.</p>
        </div>
      `;
    }

    return `
      <div class="truck-card">
        <h3 style="margin:0 0 4px;">${header}</h3>
        <p class="muted" style="margin:0 0 8px;">${totalQty} item${totalQty === 1 ? "" : "s"} on board · <strong>${money(totalValue)}</strong> total value</p>
        <div class="table-wrap">
          <table class="truck-inv-table">
            <thead>
              <tr>
                <th>Racking Type</th>
                <th>Item / Part</th>
                <th style="text-align:right;">Qty</th>
                <th style="text-align:right;">Cost</th>
                <th style="text-align:right;">Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(r => {
                const qty = Number(r.quantity || 0);
                const cost = Number(r.costEach || 0);
                const safeTruck = escapeHtml(truckName);
                const safePartId = escapeHtml(r.partId || "");
                return `
                  <tr data-truck="${safeTruck}" data-part="${safePartId}">
                    <td>${escapeHtml(r.rackingType || "")}</td>
                    <td>${escapeHtml(r.partName || "")}</td>
                    <td style="text-align:right;">
                      <input class="cell-edit truck-qty-edit" type="number" min="0" step="1" value="${qty}" style="width:70px;text-align:right;">
                    </td>
                    <td style="text-align:right;">${money(cost)}</td>
                    <td style="text-align:right;">${money(qty * cost)}</td>
                    <td>
                      <div class="action-buttons">
                        <button type="button" class="secondary" data-action="return">Return to Warehouse</button>
                        ${currentUserProfile && currentUserProfile.isAdmin
                          ? `<button type="button" class="danger" data-action="damage">Invoice Damage</button>`
                          : ""}
                      </div>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");

  // Wire up edit + action buttons
  container.querySelectorAll("tr[data-truck]").forEach(tr => {
    const truckName = tr.dataset.truck;
    const partId = tr.dataset.part;
    const qtyInput = tr.querySelector("input.truck-qty-edit");
    if (qtyInput) {
      qtyInput.addEventListener("change", () => saveTruckInventoryQty(truckName, partId, qtyInput));
    }
    const returnBtn = tr.querySelector("button[data-action='return']");
    if (returnBtn) returnBtn.addEventListener("click", () => returnTruckItemToWarehouse(truckName, partId));
    const damageBtn = tr.querySelector("button[data-action='damage']");
    if (damageBtn) damageBtn.addEventListener("click", () => invoiceTruckDamage(truckName, partId));
  });
}

// Manually adjust the quantity on a truck. Logs an adjustment movement.
async function saveTruckInventoryQty(truckName, partId, input) {
  if (!requireAdminUser()) {
    input.value = getTruckRow(truckName, partId)?.quantity ?? 0;
    return;
  }
  const row = getTruckRow(truckName, partId);
  if (!row) return;
  const oldQty = Number(row.quantity || 0);
  const newQty = Math.max(0, Math.floor(Number(input.value || 0)));
  if (newQty === oldQty) return;
  if (!confirm(`Adjust ${row.partName} on ${truckName}?\n\nFrom ${oldQty} to ${newQty}\n\nThis is a manual adjustment — warehouse inventory will NOT change. Use "Return to Warehouse" if you want to move stock back instead.`)) {
    input.value = oldQty;
    return;
  }
  const user = getAdminUser();
  try {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const truckRef = db.collection("truck_inventory").doc(row.id);
    await truckRef.set({ quantity: newQty, updatedAt: now }, { merge: true });
    await db.collection("inventory_movements").add({
      timestamp: now,
      type: "TRUCK_ADJUSTMENT",
      truck: truckName,
      partId,
      partName: row.partName || "",
      rackingType: row.rackingType || "",
      quantityChange: newQty - oldQty,
      truckBeforeQuantity: oldQty,
      truckAfterQuantity: newQty,
      user
    });
    await recordAudit("ADJUST_TRUCK_QTY", `${truckName} / ${row.partName}`, {
      truck: truckName, partId, before: oldQty, after: newQty
    });
    showAdminMessage(`Adjusted ${row.partName} on ${truckName}: ${oldQty} → ${newQty}`, false);
  } catch (err) {
    console.error("Adjust truck qty failed:", err);
    showAdminMessage("Adjustment failed: " + err.message, true);
    input.value = oldQty;
  }
}

function getTruckRow(truckName, partId) {
  return adminState.truckInventory.find(r => r.truck === truckName && r.partId === partId);
}

// Move qty from a truck back to warehouse stock (warehouse currentQuantity goes up).
async function returnTruckItemToWarehouse(truckName, partId) {
  const row = getTruckRow(truckName, partId);
  if (!row) return;
  const currentQty = Number(row.quantity || 0);
  if (currentQty <= 0) {
    showAdminMessage("Nothing on the truck to return.", true);
    return;
  }
  const answer = prompt(
    `Return ${row.partName} from ${truckName} to warehouse.\n\nCurrently on truck: ${currentQty}\n\nHow many to return? (Enter a number from 1 to ${currentQty}, or 0 / cancel to abort.)`,
    String(currentQty)
  );
  if (answer === null) return;
  const qtyReturn = Math.floor(Number(answer));
  if (!qtyReturn || qtyReturn <= 0) return;
  if (qtyReturn > currentQty) {
    showAdminMessage(`Can't return more than what's on the truck (${currentQty}).`, true);
    return;
  }
  const user = getAdminUser();
  try {
    await db.runTransaction(async tx => {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const partRef = db.collection("parts").doc(partId);
      const truckRef = db.collection("truck_inventory").doc(row.id);

      // === reads
      const partDoc = await tx.get(partRef);
      const truckDoc = await tx.get(truckRef);
      if (!partDoc.exists) throw new Error("Part no longer exists.");
      if (!truckDoc.exists) throw new Error("Truck inventory entry no longer exists.");
      const part = partDoc.data();
      const warehouseBefore = Number(part.currentQuantity || 0);
      const truckBefore = Number(truckDoc.data().quantity || 0);
      if (truckBefore < qtyReturn) throw new Error(`Truck only has ${truckBefore} now (someone else may have changed it). Try again.`);

      // === writes
      tx.update(partRef, { currentQuantity: warehouseBefore + qtyReturn, updatedAt: now });
      tx.set(truckRef, { quantity: truckBefore - qtyReturn, updatedAt: now }, { merge: true });
      tx.set(db.collection("inventory_movements").doc(), {
        timestamp: now,
        type: "TRUCK_TO_WAREHOUSE",
        truck: truckName,
        partId,
        partName: part.name || "",
        rackingType: part.rackingType || "",
        quantityChange: qtyReturn,
        beforeQuantity: warehouseBefore,
        afterQuantity: warehouseBefore + qtyReturn,
        truckBeforeQuantity: truckBefore,
        truckAfterQuantity: truckBefore - qtyReturn,
        user
      });
      tx.set(db.collection("audit_log").doc(), {
        timestamp: now,
        admin: user,
        action: "RETURN_TO_WAREHOUSE",
        target: `${truckName} / ${part.name || partId}`,
        details: { truck: truckName, partId, qtyReturned: qtyReturn }
      });
    });
    showAdminMessage(`Returned ${qtyReturn} × ${row.partName} from ${truckName} to warehouse.`, false);
  } catch (err) {
    console.error("Return to warehouse failed:", err);
    showAdminMessage("Return failed: " + err.message, true);
  }
}

// Write off damaged items from a truck. Creates a real invoice billed to
// "730 Store Development", deducts from truck inventory, and flags it as a damage invoice.
async function invoiceTruckDamage(truckName, partId) {
  if (!requireAdminUser()) return;
  const row = getTruckRow(truckName, partId);
  if (!row) return;
  const currentQty = Number(row.quantity || 0);
  if (currentQty <= 0) {
    showAdminMessage("Nothing on the truck to write off.", true);
    return;
  }
  const answer = prompt(
    `Write off damaged ${row.partName} from ${truckName}.\n\nCurrently on truck: ${currentQty}\n\nHow many are damaged? (Enter a number from 1 to ${currentQty}.)\n\nThis creates a DAMAGE WRITE-OFF invoice billed to "${DAMAGE_LOCATION_NAME}".`,
    "1"
  );
  if (answer === null) return;
  const qtyDamaged = Math.floor(Number(answer));
  if (!qtyDamaged || qtyDamaged <= 0) return;
  if (qtyDamaged > currentQty) {
    showAdminMessage(`Can't write off more than what's on the truck (${currentQty}).`, true);
    return;
  }
  const reason = prompt(`(Optional) Brief reason for the damage write-off:`, "Damaged in transit");
  if (reason === null) return; // user cancelled
  if (!confirm(`Confirm DAMAGE WRITE-OFF\n\nTruck: ${truckName}\nPart: ${row.partName}\nQuantity: ${qtyDamaged}\nValue: ${money(qtyDamaged * Number(row.costEach || 0))}\nBilled to: ${DAMAGE_LOCATION_NAME}\nReason: ${reason || "(none)"}\n\nProceed?`)) return;

  const user = getAdminUser();
  const damageLocation = adminState.locations.find(l => l.name === DAMAGE_LOCATION_NAME);
  const locationDetails = damageLocation
    ? { name: damageLocation.name, phone: damageLocation.phone || "", address: damageLocation.address || "", city: damageLocation.city || "", state: damageLocation.state || "", zip: damageLocation.zip || "" }
    : { name: DAMAGE_LOCATION_NAME, phone: "", address: "", city: "", state: "", zip: "" };

  try {
    const result = await db.runTransaction(async tx => {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const counterRef = db.collection("meta").doc("counters");
      const truckRef = db.collection("truck_inventory").doc(row.id);

      // === reads
      const counterDoc = await tx.get(counterRef);
      const truckDoc = await tx.get(truckRef);
      const current = counterDoc.exists ? Number(counterDoc.data().nextInvoiceNumber || 10001) : 10001;
      if (!truckDoc.exists) throw new Error("Truck inventory entry no longer exists.");
      const truckBefore = Number(truckDoc.data().quantity || 0);
      if (truckBefore < qtyDamaged) throw new Error(`Truck only has ${truckBefore} now (someone else may have changed it).`);
      const cost = Number(truckDoc.data().costEach || 0);

      const invoiceNumber = `INV-${current}`;
      const invoiceRef = db.collection("invoices").doc(invoiceNumber);

      const lineItem = {
        rackingType: row.rackingType || "",
        partId,
        partName: row.partName || "",
        quantityUsed: qtyDamaged,
        costEach: cost,
        total: qtyDamaged * cost
      };
      const total = lineItem.total;
      const isoDate = new Date().toISOString().slice(0, 10);

      // === writes
      tx.set(counterRef, { nextInvoiceNumber: current + 1 }, { merge: true });
      tx.set(truckRef, { quantity: truckBefore - qtyDamaged, updatedAt: now }, { merge: true });
      tx.set(invoiceRef, {
        invoiceNumber,
        date: isoDate,
        location: DAMAGE_LOCATION_NAME,
        locationDetails,
        truck: truckName,
        user,
        isDamageWriteOff: true,
        damageReason: reason || "",
        notes: reason ? `DAMAGE WRITE-OFF: ${reason}` : "DAMAGE WRITE-OFF",
        lineItems: [lineItem],
        total,
        createdAt: now,
        updatedAt: now
      });
      tx.set(db.collection("inventory_movements").doc(), {
        timestamp: now,
        type: "TRUCK_DAMAGE_WRITEOFF",
        invoiceNumber,
        truck: truckName,
        partId,
        partName: row.partName || "",
        rackingType: row.rackingType || "",
        quantityChange: -qtyDamaged,
        truckBeforeQuantity: truckBefore,
        truckAfterQuantity: truckBefore - qtyDamaged,
        user,
        location: DAMAGE_LOCATION_NAME,
        reason
      });
      tx.set(db.collection("audit_log").doc(), {
        timestamp: now,
        admin: user,
        action: "DAMAGE_WRITEOFF",
        target: invoiceNumber,
        details: { truck: truckName, partId, partName: row.partName, qty: qtyDamaged, value: total, reason }
      });

      return { invoiceNumber, total };
    });
    showAdminMessage(`Damage invoice ${result.invoiceNumber} created (${money(result.total)}).`, false);
  } catch (err) {
    console.error("Damage write-off failed:", err);
    showAdminMessage("Damage write-off failed: " + err.message, true);
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
      "Truck": inv.truck || "",
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
    { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsSummary, summaryRows.length, "H"); // Total

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
        "Truck": inv.truck || "",
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
    { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 14 },
    { wch: 18 }, { wch: 50 }, { wch: 10 }, { wch: 11 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsLines, lineRows.length, "I"); // Cost Each
  formatColumnAsCurrency(wsLines, lineRows.length, "J"); // Line Total

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Invoice Summary");
  XLSX.utils.book_append_sheet(wb, wsLines, "Line Items");

  const filename = `mc-racking-invoices-${todayISO()}.xlsx`;
  XLSX.writeFile(wb, filename);
  showAdminMessage(`Downloaded: ${filename} (${adminState.invoices.length} invoices, ${lineRows.length - 2} line items)`, false);
}

// ---------- ARCHIVED INVOICES tab -----------------------------------------

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
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  const months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}

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

  const sorted = invs.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  const summaryRows = sorted.map(inv => {
    const lines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
    return {
      "Invoice #": inv.invoiceNumber || "",
      "Date": inv.date || "",
      "Last Edited": inv.lastEditedDate || "",
      "User": inv.user || "",
      "Location": inv.location || "",
      "Truck": inv.truck || "",
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
    { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsSummary, summaryRows.length, "H");

  const lineRows = [];
  for (const inv of sorted) {
    const lines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
    for (const l of lines) {
      lineRows.push({
        "Invoice #": inv.invoiceNumber || "",
        "Date": inv.date || "",
        "User": inv.user || "",
        "Location": inv.location || "",
        "Truck": inv.truck || "",
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
    { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 14 },
    { wch: 18 }, { wch: 50 }, { wch: 10 }, { wch: 11 }, { wch: 12 }
  ];
  formatColumnAsCurrency(wsLines, lineRows.length, "I");
  formatColumnAsCurrency(wsLines, lineRows.length, "J");

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Invoice Summary");
  XLSX.utils.book_append_sheet(wb, wsLines, "Line Items");

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
    } else if (entry.action === "ADD_TRUCK" || entry.action === "REMOVE_TRUCK") {
      detailText = `Truck: ${escapeHtml(d.truck || "")}`;
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

async function startAdmin() {
  setConnectionStatus("Connecting...", "");

  try {
    await ensureUserApproved({ adminOnly: true });
  } catch (err) {
    // ensureUserApproved already redirected or showed an overlay
    return;
  }

  // Show "Signed in as <name>" on the admin page header
  const signedInAs = qs("signedInAs");
  if (signedInAs && currentUserProfile) {
    signedInAs.innerHTML = `<span class="muted">Signed in as</span> <strong>${escapeHtml(currentUserProfile.displayName)}</strong>`;
    signedInAs.style.display = "";
  }

  const signOutBtn = qs("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", signOutAndGoToLogin);

  setupTabs();

  qs("addPartForm").addEventListener("submit", addNewPart);
  qs("addUserForm").addEventListener("submit", addUser);
  qs("addLocationForm").addEventListener("submit", addLocation);
  const addTruckForm = qs("addTruckForm");
  if (addTruckForm) addTruckForm.addEventListener("submit", addTruck);

  qs("exportInventoryBtn").addEventListener("click", exportInventoryToExcel);
  qs("exportInvoicesBtn").addEventListener("click", exportInvoicesToExcel);

  const importBtn = qs("importLocationsBtn");
  if (importBtn) importBtn.addEventListener("click", importDefaultLocations);

  attachAdminListeners();
}

document.addEventListener("DOMContentLoaded", () => {
  startAdmin();
});
