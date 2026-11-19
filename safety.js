// McCoy's Risk and Safety — damage repair estimates + quote history.
//
// This is a standalone page, separate from the Mc Racking admin tabs.
// It reuses firebase-config.js for auth, uses jsPDF for the branded estimate PDF,
// and pdf-lib to merge contractor quote PDFs onto the end of the estimate.

// ---------- Shared state ---------------------------------------------------

let adminState = {
  parts: [],
  locations: [],
  quotes: [],
  laborRates: { greenTeamRate: 201, silverTeamRate: 134 }
};

// ---------- Helpers --------------------------------------------------------

function qs(id) { return document.getElementById(id); }

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function money(value) {
  return "$" + Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(stored) {
  if (!stored) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(stored));
  if (!m) return String(stored);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString();
}

function setConnectionStatus(text, cls) {
  const el = qs("connectionStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "connection-status " + (cls || "");
}

function getAdminUser() {
  return (currentUserProfile && currentUserProfile.displayName) || "";
}

function requireAdminUser() {
  if (!currentUserProfile || !currentUserProfile.isAdmin) {
    showAdminMessage("Admin access required.", true);
    return false;
  }
  return true;
}

function showAdminMessage(text, isError) {
  const el = qs("adminMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "message " + (isError ? "error" : "success");
  setTimeout(() => { el.textContent = ""; el.className = "message"; }, 5000);
}

async function recordAudit(action, target, details) {
  try {
    await db.collection("audit_log").add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      admin: getAdminUser(),
      action,
      target: target || "",
      details: details || {}
    });
  } catch (err) {
    console.error("Audit write failed:", err);
  }
}

// ---------- Listeners ------------------------------------------------------

function attachSafetyListeners() {
  // Parts — needed for inventory dropdowns + cost lookup
  db.collection("parts").onSnapshot(snap => {
    adminState.parts = [];
    snap.forEach(d => adminState.parts.push(d.data()));
    adminState.parts.sort((a, b) => {
      const an = Number((a.id || "").replace("part-", "")) || 0;
      const bn = Number((b.id || "").replace("part-", "")) || 0;
      return an - bn;
    });
    renderEstInventoryLines();
    setConnectionStatus("Live", "connected");
  }, err => {
    console.error("Parts listener error:", err);
    setConnectionStatus("Connection error", "error");
  });

  // Locations — needed for Store dropdown + Ship To box on PDF
  db.collection("settings").doc("locations").onSnapshot(doc => {
    const list = (doc.exists && Array.isArray(doc.data().list)) ? doc.data().list.slice() : [];
    adminState.locations = list
      .map(loc => (typeof loc === "string"
        ? { name: loc, phone: "", address: "", city: "", state: "", zip: "" }
        : Object.assign({ name: "", phone: "", address: "", city: "", state: "", zip: "" }, loc)))
      .filter(loc => loc.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    populateEstimateStoreDropdown();
    populateQuoteSearchFilters();
  });

  // Labor rates (editable in Firestore: settings/labor_rates)
  db.collection("settings").doc("labor_rates").onSnapshot(doc => {
    if (doc.exists) {
      const d = doc.data();
      adminState.laborRates = {
        greenTeamRate: Number(d.greenTeamRate) || 201,
        silverTeamRate: Number(d.silverTeamRate) || 134
      };
    } else {
      adminState.laborRates = { greenTeamRate: 201, silverTeamRate: 134 };
      db.collection("settings").doc("labor_rates").set(adminState.laborRates).catch(err => {
        console.warn("Could not seed default labor rates:", err.message);
      });
    }
    refreshEstimateLaborRates();
  }, err => {
    console.error("Labor rates listener error:", err);
  });

  // Saved quotes
  db.collection("quotes").orderBy("createdAt", "desc").onSnapshot(snap => {
    adminState.quotes = [];
    snap.forEach(d => adminState.quotes.push({ id: d.id, ...d.data() }));
    renderQuoteHistory();
    populateQuoteSearchFilters();
  }, err => {
    console.error("Quotes listener error:", err);
  });
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

// ---------- DAMAGE ESTIMATE tab --------------------------------------------

// Working state for the in-progress estimate
let estInvLines = [];      // [{rackingType, partId, qty}]
let estCustomLines = [];   // [{description, qty, cost}]
let estPhotos = [];        // [{name, dataUrl, width, height, sizeKB}]
let estOtherPdf = null;    // {name, dataUrl, sizeKB} — contractor quote PDF
let estEditingQuoteId = null;  // when set, Save overwrites this quote instead of creating a new one
let estEditingOriginal = null; // snapshot of the quote being edited (for the audit log)
let expandedQuotes = new Set();

const MAX_CONTRACTOR_PDF_BYTES = 400 * 1024; // 400 KB — keeps the overall quote doc under Firestore's 1MB limit

const MAX_PHOTOS = 3;
const MAX_PHOTO_WIDTH = 1200;   // px - shrink anything wider
const JPEG_QUALITY = 0.75;      // 75% quality
const MAX_PHOTO_BYTES = 700 * 1024; // 700KB per photo after shrink — warn if still over

function newEstInvLine() { return { rackingType: "", partId: "", qty: "" }; }
function newEstCustomLine() { return { description: "", qty: "", cost: "" }; }

// Read a File object, resize it to fit MAX_PHOTO_WIDTH, re-encode as JPEG.
// Returns a Promise resolving to {name, dataUrl, width, height, sizeKB}.
function processPhotoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith("image/")) {
      return reject(new Error(`${file.name}: not an image`));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name}: failed to read`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`${file.name}: failed to decode`));
      img.onload = () => {
        try {
          // Resize keeping aspect ratio
          let w = img.width, h = img.height;
          if (w > MAX_PHOTO_WIDTH) {
            h = Math.round(h * (MAX_PHOTO_WIDTH / w));
            w = MAX_PHOTO_WIDTH;
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff"; // white background for any transparency
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          // base64 length in chars ≈ bytes * 4/3; actual size estimate:
          const base64 = dataUrl.split(",")[1] || "";
          const sizeBytes = Math.ceil(base64.length * 3 / 4);
          resolve({
            name: file.name,
            dataUrl,
            width: w,
            height: h,
            sizeKB: Math.round(sizeBytes / 1024)
          });
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleEstPhotoSelect(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const slotsLeft = MAX_PHOTOS - estPhotos.length;
  if (slotsLeft <= 0) {
    showAdminMessage(`Already at ${MAX_PHOTOS}-photo limit. Remove one first.`, true);
    e.target.value = "";
    return;
  }
  const toProcess = files.slice(0, slotsLeft);
  if (files.length > slotsLeft) {
    showAdminMessage(`Only adding the first ${slotsLeft} photo${slotsLeft === 1 ? "" : "s"} (max ${MAX_PHOTOS} total).`, true);
  }
  for (const f of toProcess) {
    try {
      const photo = await processPhotoFile(f);
      if (photo.sizeKB * 1024 > MAX_PHOTO_BYTES) {
        showAdminMessage(`"${f.name}" is still ${photo.sizeKB}KB after shrinking — may fail to save. Try a less detailed photo.`, true);
      }
      estPhotos.push(photo);
    } catch (err) {
      showAdminMessage(err.message, true);
    }
  }
  e.target.value = ""; // allow re-selecting the same file
  renderEstPhotoPreview();
}

function renderEstPhotoPreview() {
  const container = qs("estPhotoPreview");
  if (!container) return;
  if (!estPhotos.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = estPhotos.map((p, i) => `
    <div class="photo-thumb">
      <img src="${p.dataUrl}" alt="${escapeHtml(p.name)}" data-full-src="${p.dataUrl}">
      <button type="button" class="photo-thumb-remove" data-remove-photo="${i}" title="Remove">×</button>
      <div class="photo-thumb-size">${p.sizeKB} KB</div>
    </div>
  `).join("");
  container.querySelectorAll("button[data-remove-photo]").forEach(btn => {
    btn.addEventListener("click", () => {
      estPhotos.splice(Number(btn.dataset.removePhoto), 1);
      renderEstPhotoPreview();
    });
  });
  container.querySelectorAll("img[data-full-src]").forEach(img => {
    img.addEventListener("click", () => window.open(img.dataset.fullSrc, "_blank"));
  });
}

// Handler for picking a contractor quote PDF for the "Other Damage" section.
// Reads the file as a base64 data URL, enforces the size cap, stores on estOtherPdf.
async function handleEstOtherPdfSelect(e) {
  const file = e.target.files && e.target.files[0];
  const status = qs("estOtherPdfStatus");
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showAdminMessage("Please pick a PDF file.", true);
    e.target.value = "";
    return;
  }
  if (file.size > MAX_CONTRACTOR_PDF_BYTES) {
    showAdminMessage(`PDF is ${Math.round(file.size/1024)}KB — over the ${Math.round(MAX_CONTRACTOR_PDF_BYTES/1024)}KB limit. Ask the contractor for a smaller PDF (usually "save as reduced size" in Acrobat).`, true);
    e.target.value = "";
    return;
  }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("Could not read PDF."));
      fr.readAsDataURL(file);
    });
    estOtherPdf = {
      name: file.name,
      dataUrl,
      sizeKB: Math.round(file.size / 1024)
    };
    if (status) status.textContent = `Attached: ${file.name} (${estOtherPdf.sizeKB} KB) — click again to replace, or Clear Form to drop.`;
  } catch (err) {
    showAdminMessage(err.message, true);
    estOtherPdf = null;
  }
}

function refreshEstimateLaborRates() {
  const g = qs("estLaborGreenRate");
  const s = qs("estLaborSilverRate");
  if (g) g.textContent = money(adminState.laborRates.greenTeamRate);
  if (s) s.textContent = money(adminState.laborRates.silverTeamRate);
  updateEstimateTotals();
}

function populateEstimateStoreDropdown() {
  const sel = qs("estStore");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">— Select store —</option>` +
    adminState.locations.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join("");
  if (prev) sel.value = prev;
}

function estRackingTypeOptions(selected) {
  const types = [...new Set(adminState.parts.map(p => p.rackingType).filter(Boolean))].sort();
  return `<option value="">— Select —</option>` +
    types.map(t => `<option value="${escapeHtml(t)}"${t === selected ? " selected" : ""}>${escapeHtml(t)}</option>`).join("");
}

function estPartOptionsForType(rackingType, selected) {
  const parts = adminState.parts
    .filter(p => !rackingType || p.rackingType === rackingType)
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return `<option value="">— Select —</option>` +
    parts.map(p => `<option value="${escapeHtml(p.id)}"${p.id === selected ? " selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
}

function renderEstInventoryLines() {
  const container = qs("estInventoryLines");
  if (!container) return;
  if (estInvLines.length === 0) estInvLines.push(newEstInvLine());

  container.innerHTML = estInvLines.map((line, i) => {
    const part = line.partId ? adminState.parts.find(p => p.id === line.partId) : null;
    const cost = part ? Number(part.costEach || 0) : 0;
    const qty = Math.floor(Number(line.qty || 0));
    const lineTotal = qty * cost;
    const canRemove = estInvLines.length > 1;
    return `
      <div class="estimate-line-row" data-est-inv-index="${i}">
        <div class="estimate-inv-grid">
          <label>
            <span>Racking Type</span>
            <select class="est-inv-type">${estRackingTypeOptions(line.rackingType)}</select>
          </label>
          <label>
            <span>Item / Part</span>
            <select class="est-inv-part">${estPartOptionsForType(line.rackingType, line.partId)}</select>
          </label>
          <label>
            <span>Qty</span>
            <input class="est-inv-qty" type="number" min="1" step="1" value="${escapeHtml(String(line.qty))}" placeholder="0">
          </label>
          <label>
            <span>Cost Each</span>
            <div class="estimate-line-total">${money(cost)}</div>
          </label>
          <label>
            <span>Line Total</span>
            <div class="estimate-line-total">${money(lineTotal)}</div>
          </label>
          <button type="button" class="estimate-line-remove danger" ${canRemove ? "" : "disabled style='visibility:hidden;'"}>×</button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".estimate-line-row").forEach(row => {
    const i = Number(row.dataset.estInvIndex);
    const typeSel = row.querySelector(".est-inv-type");
    const partSel = row.querySelector(".est-inv-part");
    const qtyInp = row.querySelector(".est-inv-qty");
    const removeBtn = row.querySelector(".estimate-line-remove");
    typeSel.addEventListener("change", () => {
      estInvLines[i].rackingType = typeSel.value;
      estInvLines[i].partId = "";
      renderEstInventoryLines();
      updateEstimateTotals();
    });
    partSel.addEventListener("change", () => {
      estInvLines[i].partId = partSel.value;
      renderEstInventoryLines();
      updateEstimateTotals();
    });
    qtyInp.addEventListener("input", () => {
      estInvLines[i].qty = qtyInp.value;
      renderEstInventoryLines();
      updateEstimateTotals();
    });
    removeBtn.addEventListener("click", () => {
      estInvLines.splice(i, 1);
      renderEstInventoryLines();
      updateEstimateTotals();
    });
  });
}

function renderEstCustomLines() {
  const container = qs("estCustomLines");
  if (!container) return;
  if (estCustomLines.length === 0) estCustomLines.push(newEstCustomLine());

  container.innerHTML = estCustomLines.map((line, i) => {
    const qty = Math.floor(Number(line.qty || 0));
    const cost = Number(line.cost || 0);
    const lineTotal = qty * cost;
    const canRemove = estCustomLines.length > 1;
    return `
      <div class="estimate-line-row" data-est-cust-index="${i}">
        <div class="estimate-custom-grid">
          <label>
            <span>Description</span>
            <input class="est-cust-desc" type="text" value="${escapeHtml(String(line.description))}" placeholder="e.g. 10' x 4\" wire deck">
          </label>
          <label>
            <span>Qty</span>
            <input class="est-cust-qty" type="number" min="1" step="1" value="${escapeHtml(String(line.qty))}" placeholder="0">
          </label>
          <label>
            <span>Cost Each ($)</span>
            <input class="est-cust-cost" type="number" min="0" step="0.01" value="${escapeHtml(String(line.cost))}" placeholder="0.00">
          </label>
          <label>
            <span>Line Total</span>
            <div class="estimate-line-total">${money(lineTotal)}</div>
          </label>
          <button type="button" class="estimate-line-remove danger" ${canRemove ? "" : "disabled style='visibility:hidden;'"}>×</button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".estimate-line-row").forEach(row => {
    const i = Number(row.dataset.estCustIndex);
    const descInp = row.querySelector(".est-cust-desc");
    const qtyInp = row.querySelector(".est-cust-qty");
    const costInp = row.querySelector(".est-cust-cost");
    const removeBtn = row.querySelector(".estimate-line-remove");
    descInp.addEventListener("input", () => { estCustomLines[i].description = descInp.value; });
    qtyInp.addEventListener("input", () => {
      estCustomLines[i].qty = qtyInp.value;
      renderEstCustomLines();
      updateEstimateTotals();
    });
    costInp.addEventListener("input", () => {
      estCustomLines[i].cost = costInp.value;
      renderEstCustomLines();
      updateEstimateTotals();
    });
    removeBtn.addEventListener("click", () => {
      estCustomLines.splice(i, 1);
      renderEstCustomLines();
      updateEstimateTotals();
    });
  });
}

function collectEstimate() {
  // Gather all parts lines (inventory + custom)
  const inventoryItems = [];
  for (const line of estInvLines) {
    const qty = Math.floor(Number(line.qty || 0));
    if (!line.partId || qty <= 0) continue;
    const part = adminState.parts.find(p => p.id === line.partId);
    if (!part) continue;
    const cost = Number(part.costEach || 0);
    inventoryItems.push({
      source: "inventory",
      partId: part.id,
      rackingType: part.rackingType || "",
      description: part.name || "",
      qty,
      costEach: cost,
      lineTotal: qty * cost
    });
  }
  const customItems = [];
  for (const line of estCustomLines) {
    const qty = Math.floor(Number(line.qty || 0));
    const cost = Number(line.cost || 0);
    const desc = String(line.description || "").trim();
    if (!desc || qty <= 0 || cost <= 0) continue;
    customItems.push({
      source: "custom",
      partId: "",
      rackingType: "",
      description: desc,
      qty,
      costEach: cost,
      lineTotal: qty * cost
    });
  }
  const allItems = inventoryItems.concat(customItems);
  const partsTotal = allItems.reduce((s, it) => s + it.lineTotal, 0);

  // Labor
  const useGreen = qs("estLaborGreen").checked;
  const useSilver = qs("estLaborSilver").checked;
  const greenHours = useGreen ? Number(qs("estLaborGreenHours").value || 0) : 0;
  const silverHours = useSilver ? Number(qs("estLaborSilverHours").value || 0) : 0;
  const greenRate = Number(adminState.laborRates.greenTeamRate || 0);
  const silverRate = Number(adminState.laborRates.silverTeamRate || 0);
  const greenTotal = greenHours * greenRate;
  const silverTotal = silverHours * silverRate;
  const laborTotal = greenTotal + silverTotal;
  const laborLines = [];
  if (useGreen && greenHours > 0) laborLines.push({ crew: "Green Team", hours: greenHours, rate: greenRate, total: greenTotal });
  if (useSilver && silverHours > 0) laborLines.push({ crew: "Silver Team", hours: silverHours, rate: silverRate, total: silverTotal });

  // Other damage (non-racking)
  const otherDesc = (qs("estOtherDesc") && qs("estOtherDesc").value || "").trim();
  const otherContractor = (qs("estOtherContractor") && qs("estOtherContractor").value || "").trim();
  const otherCost = Number(qs("estOtherCost") && qs("estOtherCost").value || 0);
  const otherDamage = (otherDesc || otherContractor || otherCost > 0 || estOtherPdf)
    ? {
        description: otherDesc,
        contractorName: otherContractor,
        cost: otherCost,
        contractorPdf: estOtherPdf ? Object.assign({}, estOtherPdf) : null
      }
    : null;
  const otherDamageCost = otherDamage ? Number(otherDamage.cost || 0) : 0;

  return {
    date: qs("estDate").value,
    store: qs("estStore").value,
    storeDetails: (adminState.locations.find(l => l.name === qs("estStore").value) || null),
    incident: qs("estIncident").value.trim(),
    causedBy: qs("estCausedBy") ? qs("estCausedBy").value : "",
    notes: qs("estNotes").value.trim(),
    items: allItems,
    laborLines,
    otherDamage,
    partsTotal,
    laborTotal,
    otherDamageCost,
    grandTotal: partsTotal + laborTotal + otherDamageCost,
    photos: estPhotos.slice()
  };
}

function updateEstimateTotals() {
  const est = collectEstimate();
  qs("estTotalParts").textContent = money(est.partsTotal);
  qs("estTotalLabor").textContent = money(est.laborTotal);
  const otherEl = qs("estTotalOther");
  if (otherEl) otherEl.textContent = money(est.otherDamageCost || 0);
  qs("estTotalGrand").textContent = money(est.grandTotal);
}

function setEstimateEditMode(quoteId, originalQuote) {
  estEditingQuoteId = quoteId || null;
  estEditingOriginal = originalQuote || null;
  const banner = qs("estEditingBanner");
  const bannerId = qs("estEditingBannerId");
  const saveBtn = qs("estSaveAndDownloadBtn");
  if (quoteId) {
    if (banner) banner.style.display = "";
    if (bannerId) bannerId.textContent = `#${String(quoteId).substring(0, 12)}`;
    if (saveBtn) saveBtn.textContent = "Update Quote & Download PDF";
  } else {
    if (banner) banner.style.display = "none";
    if (bannerId) bannerId.textContent = "";
    if (saveBtn) saveBtn.textContent = "Save Quote & Download PDF";
  }
}

// Load an existing quote into the form so the admin can edit and re-save it
function loadQuoteIntoForm(q) {
  if (!q) return;
  // Switch tab
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const btn = document.querySelector('.tab-btn[data-tab="estimate"]');
  const panel = qs("tab-estimate");
  if (btn) btn.classList.add("active");
  if (panel) panel.classList.add("active");

  // Header fields
  qs("estDate").value = q.date || new Date().toISOString().slice(0, 10);
  qs("estStore").value = q.store || "";
  qs("estIncident").value = q.incident || "";
  if (qs("estCausedBy")) qs("estCausedBy").value = q.causedBy || "";
  qs("estNotes").value = q.notes || "";

  // Other damage fields
  const od = q.otherDamage || null;
  if (qs("estOtherDesc")) qs("estOtherDesc").value = od ? (od.description || "") : "";
  if (qs("estOtherContractor")) qs("estOtherContractor").value = od ? (od.contractorName || "") : "";
  if (qs("estOtherCost")) qs("estOtherCost").value = od && od.cost ? String(od.cost) : "";
  estOtherPdf = od && od.contractorPdf ? Object.assign({}, od.contractorPdf) : null;
  const pdfInput = qs("estOtherPdfInput");
  if (pdfInput) pdfInput.value = "";
  const pdfStatus = qs("estOtherPdfStatus");
  if (pdfStatus) {
    pdfStatus.textContent = estOtherPdf
      ? `Attached: ${estOtherPdf.name} (${estOtherPdf.sizeKB || "?"} KB) — click Choose File to replace, or Clear Form to drop.`
      : "";
  }

  // Split items back into inventory lines vs. custom lines
  estInvLines = [];
  estCustomLines = [];
  for (const it of (q.items || [])) {
    if (it.source === "custom") {
      estCustomLines.push({
        description: it.description || "",
        qty: String(it.qty || ""),
        cost: String(it.costEach || "")
      });
    } else {
      estInvLines.push({
        rackingType: it.rackingType || "",
        partId: it.partId || "",
        qty: String(it.qty || "")
      });
    }
  }
  if (!estInvLines.length) estInvLines.push(newEstInvLine());
  if (!estCustomLines.length) estCustomLines.push(newEstCustomLine());

  // Photos
  estPhotos = (q.photos || []).map(p => ({
    name: p.name || "",
    dataUrl: p.dataUrl || "",
    width: Number(p.width) || 0,
    height: Number(p.height) || 0,
    sizeKB: Number(p.sizeKB) || 0
  }));

  // Labor
  const greenLine = (q.laborLines || []).find(l => (l.crew || "").toLowerCase().includes("green"));
  const silverLine = (q.laborLines || []).find(l => (l.crew || "").toLowerCase().includes("silver"));
  qs("estLaborGreen").checked = !!greenLine;
  qs("estLaborGreenHours").disabled = !greenLine;
  qs("estLaborGreenHours").value = greenLine ? String(greenLine.hours) : "0";
  qs("estLaborSilver").checked = !!silverLine;
  qs("estLaborSilverHours").disabled = !silverLine;
  qs("estLaborSilverHours").value = silverLine ? String(silverLine.hours) : "0";

  renderEstInventoryLines();
  renderEstCustomLines();
  renderEstPhotoPreview();
  updateEstimateTotals();

  setEstimateEditMode(q.id || q.quoteId || null, q);

  // Scroll to top of the panel so the banner is visible
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearEstimateForm() {
  estInvLines = [newEstInvLine()];
  estCustomLines = [newEstCustomLine()];
  estPhotos = [];
  estOtherPdf = null;
  renderEstInventoryLines();
  renderEstCustomLines();
  renderEstPhotoPreview();
  qs("estDate").value = new Date().toISOString().slice(0, 10);
  qs("estStore").value = "";
  qs("estIncident").value = "";
  if (qs("estCausedBy")) qs("estCausedBy").value = "";
  qs("estNotes").value = "";
  if (qs("estOtherDesc")) qs("estOtherDesc").value = "";
  if (qs("estOtherContractor")) qs("estOtherContractor").value = "";
  if (qs("estOtherCost")) qs("estOtherCost").value = "";
  const pdfInput = qs("estOtherPdfInput");
  if (pdfInput) pdfInput.value = "";
  const pdfStatus = qs("estOtherPdfStatus");
  if (pdfStatus) pdfStatus.textContent = "";
  qs("estLaborGreen").checked = false;
  qs("estLaborSilver").checked = false;
  qs("estLaborGreenHours").value = "0";
  qs("estLaborSilverHours").value = "0";
  qs("estLaborGreenHours").disabled = true;
  qs("estLaborSilverHours").disabled = true;
  setEstimateEditMode(null, null);
  updateEstimateTotals();
}

function validateEstimate(est) {
  if (!est.date) return "Please enter the estimate date.";
  if (!est.store) return "Please select a store.";
  const hasOther = est.otherDamage && (est.otherDamage.description || (est.otherDamage.cost || 0) > 0 || est.otherDamage.contractorPdf);
  if (!est.items.length && !est.laborLines.length && !hasOther) {
    return "Add at least one part, labor line, or other damage before saving.";
  }
  return null;
}

async function handleEstimateSaveAndDownload() {
  if (!requireAdminUser()) return;
  const est = collectEstimate();
  const err = validateEstimate(est);
  if (err) return showAdminMessage(err, true);

  const isEdit = !!estEditingQuoteId;
  const verb = isEdit ? "Update" : "Save";
  const summary = `${verb} estimate:\n\nStore: ${est.store}\nParts: ${est.items.length} line${est.items.length === 1 ? "" : "s"} = ${money(est.partsTotal)}\nLabor: ${est.laborLines.length} crew${est.laborLines.length === 1 ? "" : "s"} = ${money(est.laborTotal)}\nGrand Total: ${money(est.grandTotal)}\n\n${isEdit ? "Overwrite the existing quote" : "Save to Quote History"} and download PDF?`;
  if (!confirm(summary)) return;

  const btn = qs("estSaveAndDownloadBtn");
  btn.disabled = true;
  btn.textContent = isEdit ? "Updating..." : "Saving...";
  const user = getAdminUser();
  const now = firebase.firestore.FieldValue.serverTimestamp();

  try {
    const ref = isEdit
      ? db.collection("quotes").doc(estEditingQuoteId)
      : db.collection("quotes").doc();
    const quoteId = ref.id;
    const payload = {
      quoteId,
      date: est.date,
      store: est.store,
      storeDetails: est.storeDetails
        ? { name: est.storeDetails.name, phone: est.storeDetails.phone || "", address: est.storeDetails.address || "", city: est.storeDetails.city || "", state: est.storeDetails.state || "", zip: est.storeDetails.zip || "" }
        : { name: est.store, phone: "", address: "", city: "", state: "", zip: "" },
      incident: est.incident,
      causedBy: est.causedBy || "",
      notes: est.notes,
      items: est.items,
      laborLines: est.laborLines,
      otherDamage: est.otherDamage || null,
      partsTotal: est.partsTotal,
      laborTotal: est.laborTotal,
      otherDamageCost: est.otherDamageCost || 0,
      grandTotal: est.grandTotal,
      photos: est.photos
    };

    if (isEdit) {
      // Preserve original createdBy/createdAt; add lastEditedBy/lastEditedAt
      payload.createdBy = (estEditingOriginal && estEditingOriginal.createdBy) || user;
      payload.createdAt = (estEditingOriginal && estEditingOriginal.createdAt) || now;
      payload.lastEditedBy = user;
      payload.lastEditedAt = now;
    } else {
      payload.createdBy = user;
      payload.createdAt = now;
    }

    // Check total payload size — Firestore limit is ~1MB per doc
    const estSize = JSON.stringify(payload).length;
    if (estSize > 950 * 1024) {
      throw new Error(`Quote too large (~${Math.round(estSize/1024)}KB). Firestore caps documents at 1MB. Remove a photo or use smaller ones and try again.`);
    }
    await ref.set(payload);
    await recordAudit(
      isEdit ? "EDIT_DAMAGE_ESTIMATE" : "CREATE_DAMAGE_ESTIMATE",
      est.store,
      {
        quoteId,
        grandTotal: est.grandTotal,
        previousGrandTotal: isEdit && estEditingOriginal ? estEditingOriginal.grandTotal : undefined
      }
    );

    // Build and download PDF right away
    buildAndDownloadEstimatePdf(Object.assign({}, payload, { quoteId }));
    showAdminMessage(isEdit ? `Quote updated. PDF downloaded.` : `Quote saved. PDF downloaded.`, false);
    clearEstimateForm();
  } catch (err) {
    console.error("Save quote failed:", err);
    showAdminMessage("Save failed: " + err.message, true);
  } finally {
    btn.disabled = false;
    // If still in edit mode (e.g. save failed), restore edit label; otherwise default
    btn.textContent = estEditingQuoteId ? "Update Quote & Download PDF" : "Save Quote & Download PDF";
  }
}

function handleEstimateDownloadOnly() {
  if (!requireAdminUser()) return;
  const est = collectEstimate();
  const err = validateEstimate(est);
  if (err) return showAdminMessage(err, true);
  // Build a pseudo-quote (no ID, not saved)
  const payload = Object.assign({}, est, {
    quoteId: "DRAFT",
    storeDetails: est.storeDetails || { name: est.store, phone: "", address: "", city: "", state: "", zip: "" }
  });
  buildAndDownloadEstimatePdf(payload);
}

// Build a branded PDF for a damage estimate
function buildAndDownloadEstimatePdf(quote) {
  if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") {
    showAdminMessage("PDF library didn't load. Check your connection and try again.", true);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  if (typeof doc.autoTable !== "function") {
    showAdminMessage("PDF table library didn't load.", true);
    return;
  }
  const GREEN_DARK = [15, 58, 42];
  const GREEN_MID  = [22, 107, 70];
  const YELLOW     = [245, 209, 22];
  const PAGE_W     = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, PAGE_W, 32, "F");
  doc.setFillColor(...YELLOW);
  doc.rect(0, 32, PAGE_W, 2, "F");
  doc.setTextColor(...YELLOW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("McCoy's Risk and Safety", 14, 18);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const hq = ["McCoy Corporation Headquarters", "1350 N I.H. 35", "San Marcos, TX 78666"];
  let hqY = 12;
  for (const line of hq) { doc.text(line, PAGE_W - 14, hqY, { align: "right" }); hqY += 5; }

  // Title
  doc.setTextColor(...GREEN_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("DAMAGE REPAIR ESTIMATE", 14, 46);

  // Left metadata
  doc.setFont("helvetica", "bold");
  // Left metadata: ESTIMATE #, DATE, INCIDENT (if any), CAUSED BY (if any).
  let metaY = 56;
  const metaRow = (label, value) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(label, 14, metaY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text(value, 50, metaY);
    metaY += 10;
  };
  metaRow("ESTIMATE #", quote.quoteId === "DRAFT" ? "DRAFT (not saved)" : String(quote.quoteId).substring(0, 12));
  metaRow("DATE", formatDate(quote.date) || quote.date || "");
  if (quote.incident) metaRow("INCIDENT", String(quote.incident));
  if (quote.causedBy) metaRow("CAUSED BY", String(quote.causedBy));

  // Store box (right)
  const boxX = 115, boxY = 50, boxW = 81, boxH = 38;
  doc.setDrawColor(...GREEN_MID);
  doc.setLineWidth(0.5);
  doc.rect(boxX, boxY, boxW, boxH, "S");
  doc.setFillColor(...GREEN_DARK);
  doc.rect(boxX, boxY, boxW, 6, "F");
  doc.setTextColor(...YELLOW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("STORE", boxX + 3, boxY + 4.4);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const loc = quote.storeDetails || {};
  const locName = loc.name || quote.store || "";
  let by = boxY + 12;
  if (locName) { doc.text(locName, boxX + 3, by); by += 5; }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (loc.address) { doc.text(loc.address, boxX + 3, by); by += 4.5; }
  const cityState = [loc.city, loc.state].filter(Boolean).join(", ");
  const cityStateZip = (cityState + (loc.zip ? " " + loc.zip : "")).trim();
  if (cityStateZip) { doc.text(cityStateZip, boxX + 3, by); by += 4.5; }
  if (loc.phone) { doc.text("Phone: " + loc.phone, boxX + 3, by); by += 4.5; }

  let y = Math.max(86, boxY + boxH + 6);

  // Parts table
  if (quote.items && quote.items.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...GREEN_DARK);
    doc.text("Replacement Parts", 14, y);
    y += 2;
    doc.autoTable({
      startY: y + 2,
      head: [["Racking Type", "Item / Part", "Qty", "Cost Each", "Line Total"]],
      body: quote.items.map(it => [
        it.rackingType || (it.source === "custom" ? "(Custom)" : ""),
        it.description,
        it.qty,
        money(it.costEach),
        money(it.lineTotal)
      ]),
      headStyles: { fillColor: GREEN_DARK, textColor: YELLOW, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: 14, right: 14 },
      foot: [["", "", "", "PARTS SUBTOTAL", money(quote.partsTotal)]],
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 58, 42], fontStyle: "bold" }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Labor table
  if (quote.laborLines && quote.laborLines.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...GREEN_DARK);
    doc.text("Labor", 14, y);
    y += 2;
    doc.autoTable({
      startY: y + 2,
      head: [["Crew", "Hours", "Rate", "Total"]],
      body: quote.laborLines.map(l => [l.crew, l.hours, money(l.rate) + "/hr", money(l.total)]),
      headStyles: { fillColor: GREEN_DARK, textColor: YELLOW, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      margin: { left: 14, right: 14 },
      foot: [["", "", "LABOR SUBTOTAL", money(quote.laborTotal)]],
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 58, 42], fontStyle: "bold" }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Other damage (non-racking) table
  if (quote.otherDamage && (quote.otherDamage.description || quote.otherDamage.contractorName || quote.otherDamage.cost > 0 || quote.otherDamage.contractorPdf)) {
    const od = quote.otherDamage;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...GREEN_DARK);
    doc.text("Other Damage (Non-Racking)", 14, y);
    y += 2;
    const rows = [];
    if (od.description) rows.push(["Description", od.description]);
    if (od.contractorName) rows.push(["Contractor", od.contractorName]);
    rows.push(["Estimated Cost", money(od.cost || 0)]);
    if (od.contractorPdf && od.contractorPdf.name) {
      rows.push(["Contractor Quote", `${od.contractorPdf.name} (attached, see following pages)`]);
    }
    doc.autoTable({
      startY: y + 2,
      body: rows,
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 40, fillColor: [248, 250, 252] }, 1: {} },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Grand total bar
  doc.setFillColor(...GREEN_DARK);
  doc.rect(14, y, PAGE_W - 28, 14, "F");
  doc.setTextColor(...YELLOW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("ESTIMATE TOTAL", 18, y + 9);
  doc.text(money(quote.grandTotal), PAGE_W - 18, y + 9, { align: "right" });
  y += 24;

  // Damage photos (if any). 2 per row, start a new page if we'd run off this one.
  if (quote.photos && quote.photos.length) {
    const PAGE_H = doc.internal.pageSize.getHeight();
    const photoColW = (PAGE_W - 28 - 10) / 2; // 10px gutter
    const photoH = 70; // fixed PDF height per photo, aspect-fit inside
    const headerSpace = 10;
    const neededBlockH = headerSpace + Math.ceil(quote.photos.length / 2) * (photoH + 8);
    if (y + neededBlockH > PAGE_H - 24) {
      doc.addPage();
      y = 18;
    }
    doc.setTextColor(...GREEN_DARK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Damage Photos", 14, y);
    y += 6;
    for (let i = 0; i < quote.photos.length; i++) {
      const col = i % 2;
      const px = 14 + col * (photoColW + 10);
      const py = y;
      const p = quote.photos[i];
      try {
        // Compute fitted dimensions preserving aspect ratio
        const srcW = p.width || photoColW;
        const srcH = p.height || photoH;
        const scale = Math.min(photoColW / srcW, photoH / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        // Center inside the cell
        const offsetX = (photoColW - drawW) / 2;
        const offsetY = (photoH - drawH) / 2;
        doc.addImage(p.dataUrl, "JPEG", px + offsetX, py + offsetY, drawW, drawH);
        // Light border
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.rect(px, py, photoColW, photoH);
      } catch (err) {
        // If an image fails to decode (corrupt data URL), skip it
        console.warn("PDF photo failed:", err);
      }
      if (col === 1 || i === quote.photos.length - 1) {
        y += photoH + 8;
      }
    }
    y += 4;
  }

  // Notes
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (quote.notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Notes:", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(String(quote.notes), PAGE_W - 28);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 5 + 6;
  }
  if (quote.createdBy) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const prep = `Prepared by ${quote.createdBy}` + (quote.lastEditedBy ? ` · Last edited by ${quote.lastEditedBy}` : "");
    doc.text(prep, 14, y);
    y += 6;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  y += 4;
  doc.text("Estimate is for planning purposes. Actual costs may vary based on site conditions and final material selection.", 14, y, { maxWidth: PAGE_W - 28 });
  y += 12;
  doc.text("Approved by: ______________________________    Date: __________", 14, y);

  // Footer
  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("McCoy's Risk and Safety - McCoy Corporation Headquarters - 1350 N I.H. 35, San Marcos, TX 78666",
    PAGE_W / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });

  // Filename: Estimate-YYYY-MM-DD-Store-QuoteIDFragment.pdf
  const safe = s => String(s || "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  const fragId = quote.quoteId === "DRAFT" ? "DRAFT" : String(quote.quoteId).substring(0, 8);
  const parts = ["Estimate", quote.date, safe(quote.store), fragId].filter(Boolean);
  const filename = parts.join("-") + ".pdf";

  // If a contractor PDF is attached, merge its pages onto the end using pdf-lib.
  // Fallback: if the merge fails or pdf-lib isn't available, just save the Mc Racking PDF alone
  // and tell the admin to find the contractor PDF in Quote History.
  const contractorPdf = quote.otherDamage && quote.otherDamage.contractorPdf && quote.otherDamage.contractorPdf.dataUrl;
  if (contractorPdf && typeof PDFLib !== "undefined") {
    mergeAndDownload(doc, contractorPdf, filename).catch(err => {
      console.error("PDF merge failed:", err);
      showAdminMessage("Couldn't merge contractor PDF — saving the estimate on its own. The contractor PDF is still in Quote History.", true);
      doc.save(filename);
    });
  } else {
    doc.save(filename);
  }
}

// Take the Mc Racking jsPDF document, append every page of the contractor's PDF,
// then prompt the user to download the merged file.
async function mergeAndDownload(jsPdfDoc, contractorDataUrl, filename) {
  const mcBytes = jsPdfDoc.output("arraybuffer");
  const { PDFDocument } = PDFLib;
  const outPdf = await PDFDocument.load(mcBytes);
  // Extract raw bytes from the contractor data URL
  const b64 = String(contractorDataUrl).split(",")[1] || "";
  const binStr = atob(b64);
  const bin = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bin[i] = binStr.charCodeAt(i);
  const contractorPdf = await PDFDocument.load(bin);
  const pages = await outPdf.copyPages(contractorPdf, contractorPdf.getPageIndices());
  pages.forEach(p => outPdf.addPage(p));
  const merged = await outPdf.save();
  const blob = new Blob([merged], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ---------- QUOTE HISTORY tab ----------------------------------------------

function renderQuoteHistory() {
  const container = qs("quoteHistoryContainer");
  if (!container) return;
  if (!adminState.quotes.length) {
    container.innerHTML = `<p class="muted" style="text-align:center;padding:20px;">No quotes saved yet. Create one in the Damage Estimate tab and click "Save Quote & Download PDF".</p>`;
    return;
  }

  const sorted = adminState.quotes.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  container.innerHTML = sorted.map(q => {
    const isOpen = expandedQuotes.has(q.id);
    const arrow = isOpen ? "▼" : "▶";
    const header = `${escapeHtml(q.date || "")} — ${escapeHtml(q.store || "")}${q.incident ? ` — ${escapeHtml(q.incident)}` : ""}${q.causedBy ? ` <span class="muted">(${escapeHtml(q.causedBy)})</span>` : ""}`;
    const itemCount = (q.items || []).length;
    const laborCount = (q.laborLines || []).length;

    let body = "";
    if (isOpen) {
      const itemsRows = (q.items || []).map(it => `
        <tr>
          <td>${escapeHtml(it.rackingType || (it.source === "custom" ? "(Custom)" : ""))}</td>
          <td>${escapeHtml(it.description || "")}</td>
          <td style="text-align:right;">${it.qty}</td>
          <td style="text-align:right;">${money(it.costEach)}</td>
          <td style="text-align:right;">${money(it.lineTotal)}</td>
        </tr>
      `).join("");
      const laborRows = (q.laborLines || []).map(l => `
        <tr>
          <td>${escapeHtml(l.crew || "")}</td>
          <td style="text-align:right;">${l.hours}</td>
          <td style="text-align:right;">${money(l.rate)}/hr</td>
          <td style="text-align:right;">${money(l.total)}</td>
        </tr>
      `).join("");
      body = `
        <div class="quote-card-body">
          ${q.causedBy ? `<p style="margin:0 0 6px;"><strong>Caused By:</strong> ${escapeHtml(q.causedBy)}</p>` : ""}
          ${q.notes ? `<p style="margin:0 0 10px;"><strong>Notes:</strong> ${escapeHtml(q.notes)}</p>` : ""}
          ${itemsRows ? `
            <h4 style="margin:4px 0 6px;">Parts</h4>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Racking Type</th><th>Part</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Cost Each</th><th style="text-align:right;">Line Total</th></tr></thead>
                <tbody>${itemsRows}</tbody>
              </table>
            </div>
          ` : ""}
          ${laborRows ? `
            <h4 style="margin:10px 0 6px;">Labor</h4>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Crew</th><th style="text-align:right;">Hours</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Total</th></tr></thead>
                <tbody>${laborRows}</tbody>
              </table>
            </div>
          ` : ""}
          ${q.otherDamage && (q.otherDamage.description || q.otherDamage.cost || q.otherDamage.contractorPdf) ? `
            <h4 style="margin:10px 0 6px;">Other Damage (Non-Racking)</h4>
            <p style="margin:0 0 4px;">${escapeHtml(q.otherDamage.description || "—")}</p>
            ${q.otherDamage.contractorName ? `<p style="margin:0 0 4px;" class="muted">Contractor: ${escapeHtml(q.otherDamage.contractorName)}</p>` : ""}
            <p style="margin:0 0 4px;">Cost: <strong>${money(q.otherDamage.cost || 0)}</strong></p>
            ${q.otherDamage.contractorPdf && q.otherDamage.contractorPdf.dataUrl ? `<p style="margin:0 0 4px;"><a href="${q.otherDamage.contractorPdf.dataUrl}" target="_blank" rel="noopener">View contractor PDF (${escapeHtml(q.otherDamage.contractorPdf.name || "")})</a></p>` : ""}
          ` : ""}
          ${(q.photos && q.photos.length) ? `
            <h4 style="margin:10px 0 6px;">Damage Photos (${q.photos.length})</h4>
            <div class="quote-photo-gallery">
              ${q.photos.map(p => `<img src="${p.dataUrl}" alt="${escapeHtml(p.name || 'damage photo')}" title="${escapeHtml(p.name || '')} (${p.sizeKB || '?'}KB)" data-full-src="${p.dataUrl}">`).join("")}
            </div>
          ` : ""}
          <p style="margin:12px 0 0;">
            Parts: <strong>${money(q.partsTotal || 0)}</strong> ·
            Labor: <strong>${money(q.laborTotal || 0)}</strong> ·
            Other: <strong>${money(q.otherDamageCost || 0)}</strong> ·
            <strong style="color:#166b46;">Grand Total: ${money(q.grandTotal || 0)}</strong>
          </p>
          <p class="muted" style="margin:8px 0 0;font-size:12px;">Prepared by ${escapeHtml(q.createdBy || "—")}${q.lastEditedBy ? ` · Last edited by ${escapeHtml(q.lastEditedBy)}` : ""}</p>
        </div>
      `;
    }

    return `
      <div class="quote-card">
        <div class="quote-card-header-row">
          <button type="button" class="quote-card-header" data-toggle-quote="${escapeHtml(q.id)}">
            <span style="font-size:18px;margin-right:8px;">${arrow}</span>
            <strong style="font-size:15px;">${header}</strong>
            <span class="muted" style="margin-left:auto;">${itemCount} part${itemCount === 1 ? "" : "s"}, ${laborCount} crew${laborCount === 1 ? "" : "s"} · ${money(q.grandTotal || 0)}</span>
          </button>
          <button type="button" class="quote-card-edit" data-quote-edit="${escapeHtml(q.id)}" title="Edit this quote">Edit</button>
          <button type="button" class="quote-card-pdf" data-quote-pdf="${escapeHtml(q.id)}">PDF</button>
        </div>
        ${body}
      </div>
    `;
  }).join("");

  container.querySelectorAll("button[data-toggle-quote]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleQuote;
      if (expandedQuotes.has(id)) expandedQuotes.delete(id);
      else expandedQuotes.add(id);
      renderQuoteHistory();
    });
  });
  container.querySelectorAll("button[data-quote-pdf]").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = adminState.quotes.find(x => x.id === btn.dataset.quotePdf);
      if (q) buildAndDownloadEstimatePdf(q);
    });
  });
  container.querySelectorAll("button[data-quote-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = adminState.quotes.find(x => x.id === btn.dataset.quoteEdit);
      if (q) loadQuoteIntoForm(q);
    });
  });
  container.querySelectorAll(".quote-photo-gallery img[data-full-src]").forEach(img => {
    img.addEventListener("click", () => window.open(img.dataset.fullSrc, "_blank"));
  });
}


// ---------- QUOTE SEARCH tab -----------------------------------------------

let quoteSearchResults = [];

function populateQuoteSearchFilters() {
  // Stores
  const st = qs("qsStore");
  if (st) {
    const prev = st.value;
    st.innerHTML = `<option value="">All stores</option>` +
      adminState.locations.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join("");
    st.value = prev;
  }
  // Users seen on quotes
  const users = [...new Set(adminState.quotes.flatMap(q => [q.createdBy, q.lastEditedBy]).filter(Boolean))].sort();
  const u = qs("qsUser");
  if (u) {
    const prev = u.value;
    u.innerHTML = `<option value="">All users</option>` +
      users.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    u.value = prev;
  }
  // Racking Types seen on quotes (from every quote's items)
  const types = [...new Set(adminState.quotes.flatMap(q =>
    (q.items || []).map(it => it.rackingType).filter(Boolean)
  ))].sort();
  const rt = qs("qsRackingType");
  if (rt) {
    const prev = rt.value;
    rt.innerHTML = `<option value="">All racking types</option>` +
      types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    rt.value = prev;
  }
}

function quoteDateIso(q) {
  const d = q && q.date ? String(q.date) : "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (iso) return d;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
  if (us) return `${us[3]}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  return "";
}

function runQuoteSearch() {
  const filters = {
    store: qs("qsStore").value,
    causedBy: qs("qsCausedBy").value,
    rackingType: qs("qsRackingType") ? qs("qsRackingType").value : "",
    user: qs("qsUser").value,
    from: qs("qsFrom").value,
    to: qs("qsTo").value,
    minTotal: Number(qs("qsMinTotal").value || 0),
    keyword: qs("qsKeyword").value.trim().toLowerCase()
  };

  const results = [];
  for (const q of adminState.quotes) {
    if (filters.store && q.store !== filters.store) continue;
    if (filters.causedBy && q.causedBy !== filters.causedBy) continue;
    if (filters.user && q.createdBy !== filters.user && q.lastEditedBy !== filters.user) continue;
    // Racking Type: match quotes where ANY line item uses that racking type
    if (filters.rackingType) {
      const hasType = (q.items || []).some(it => it.rackingType === filters.rackingType);
      if (!hasType) continue;
    }
    const iso = quoteDateIso(q);
    if (filters.from && iso && iso < filters.from) continue;
    if (filters.to && iso && iso > filters.to) continue;
    if (filters.minTotal > 0 && Number(q.grandTotal || 0) < filters.minTotal) continue;
    if (filters.keyword) {
      const hay = [
        q.incident, q.notes, q.causedBy,
        q.otherDamage && q.otherDamage.description,
        q.otherDamage && q.otherDamage.contractorName
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(filters.keyword)) continue;
    }
    results.push(q);
  }

  // Newest first
  results.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  quoteSearchResults = results;
  renderQuoteSearchResults();
}

function renderQuoteSearchResults() {
  const body = qs("qsResultsBody");
  if (!body) return;

  // Totals
  let parts = 0, labor = 0, grand = 0;
  for (const q of quoteSearchResults) {
    parts += Number(q.partsTotal || 0);
    labor += Number(q.laborTotal || 0);
    grand += Number(q.grandTotal || 0);
  }
  qs("qsTotalQuotes").textContent = quoteSearchResults.length;
  qs("qsTotalParts").textContent = money(parts);
  qs("qsTotalLabor").textContent = money(labor);
  qs("qsTotalGrand").textContent = money(grand);

  // Breakdown: damage by racking type (across all line items on matching quotes)
  const byType = new Map(); // type -> {pieces, value}
  for (const q of quoteSearchResults) {
    for (const it of (q.items || [])) {
      const t = it.rackingType || (it.source === "custom" ? "(Custom)" : "(No Type)");
      const cur = byType.get(t) || { pieces: 0, value: 0 };
      cur.pieces += Number(it.qty || 0);
      cur.value += Number(it.lineTotal || 0);
      byType.set(t, cur);
    }
  }
  const typeRows = [...byType.entries()].sort((a, b) => b[1].value - a[1].value);
  const rackBody = qs("qsRackingBreakdown");
  if (rackBody) {
    rackBody.innerHTML = typeRows.length
      ? typeRows.map(([t, v]) => `
          <tr>
            <td>${escapeHtml(t)}</td>
            <td style="text-align:right;">${v.pieces}</td>
            <td style="text-align:right;">${money(v.value)}</td>
          </tr>`).join("")
      : `<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>`;
  }

  // Breakdown: damage by cause
  const byCause = new Map();
  for (const q of quoteSearchResults) {
    const c = q.causedBy || "(Not recorded)";
    const cur = byCause.get(c) || { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(q.grandTotal || 0);
    byCause.set(c, cur);
  }
  const causeRows = [...byCause.entries()].sort((a, b) => b[1].value - a[1].value);
  const causeBody = qs("qsCauseBreakdown");
  if (causeBody) {
    causeBody.innerHTML = causeRows.length
      ? causeRows.map(([c, v]) => `
          <tr>
            <td>${escapeHtml(c)}</td>
            <td style="text-align:right;">${v.count}</td>
            <td style="text-align:right;">${money(v.value)}</td>
          </tr>`).join("")
      : `<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>`;
  }

  if (!quoteSearchResults.length) {
    body.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center;padding:20px;">No results. Set filters above and click Search.</td></tr>`;
    return;
  }

  body.innerHTML = quoteSearchResults.map(q => `
    <tr>
      <td>${escapeHtml(quoteDateIso(q) || q.date || "")}</td>
      <td>${escapeHtml(q.store || "—")}</td>
      <td>${escapeHtml(q.incident || "—")}</td>
      <td>${escapeHtml(q.causedBy || "—")}</td>
      <td>${money(q.partsTotal || 0)}</td>
      <td>${money(q.laborTotal || 0)}</td>
      <td>${money(q.otherDamageCost || 0)}</td>
      <td><strong>${money(q.grandTotal || 0)}</strong></td>
      <td>${escapeHtml(q.createdBy || "—")}</td>
      <td>
        <button type="button" data-qs-pdf="${escapeHtml(q.id)}">PDF</button>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-qs-pdf]").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = adminState.quotes.find(x => x.id === btn.dataset.qsPdf);
      if (q) buildAndDownloadEstimatePdf(q);
    });
  });
}

function clearQuoteSearch() {
  ["qsStore", "qsCausedBy", "qsRackingType", "qsUser"].forEach(id => { const el = qs(id); if (el) el.value = ""; });
  ["qsFrom", "qsTo", "qsMinTotal", "qsKeyword"].forEach(id => { const el = qs(id); if (el) el.value = ""; });
  quoteSearchResults = [];
  renderQuoteSearchResults();
}

function exportQuoteSearchToExcel() {
  if (typeof XLSX === "undefined") {
    showAdminMessage("Excel library didn't load. Check your connection and try again.", true);
    return;
  }
  if (!quoteSearchResults.length) {
    showAdminMessage("No results to export. Run a search first.", true);
    return;
  }

  // Sheet 1: Quote Summary (one row per quote)
  const summaryRows = quoteSearchResults.map(q => ({
    "Date": quoteDateIso(q) || q.date || "",
    "Store": q.store || "",
    "Incident": q.incident || "",
    "Caused By": q.causedBy || "",
    "Parts Total": Number(q.partsTotal || 0),
    "Labor Total": Number(q.laborTotal || 0),
    "Other Damage": Number(q.otherDamageCost || 0),
    "Grand Total": Number(q.grandTotal || 0),
    "Prepared By": q.createdBy || "",
    "Last Edited By": q.lastEditedBy || "",
    "Contractor": (q.otherDamage && q.otherDamage.contractorName) || "",
    "Other Damage Description": (q.otherDamage && q.otherDamage.description) || "",
    "Notes": q.notes || ""
  }));
  // Totals row
  summaryRows.push({});
  summaryRows.push({
    "Date": "TOTAL",
    "Parts Total": quoteSearchResults.reduce((s, q) => s + Number(q.partsTotal || 0), 0),
    "Labor Total": quoteSearchResults.reduce((s, q) => s + Number(q.laborTotal || 0), 0),
    "Other Damage": quoteSearchResults.reduce((s, q) => s + Number(q.otherDamageCost || 0), 0),
    "Grand Total": quoteSearchResults.reduce((s, q) => s + Number(q.grandTotal || 0), 0)
  });

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary["!cols"] = [
    { wch: 12 }, { wch: 22 }, { wch: 28 }, { wch: 18 },
    { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 12 },
    { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 40 }, { wch: 40 }
  ];

  // Sheet 2: Line Items (one row per line item across all matching quotes)
  const lineRows = [];
  for (const q of quoteSearchResults) {
    const items = Array.isArray(q.items) ? q.items : [];
    for (const it of items) {
      lineRows.push({
        "Date": quoteDateIso(q) || q.date || "",
        "Store": q.store || "",
        "Caused By": q.causedBy || "",
        "Source": it.source === "custom" ? "Custom" : "Inventory",
        "Racking Type": it.rackingType || "",
        "Item / Part": it.description || "",
        "Qty": Number(it.qty || 0),
        "Cost Each": Number(it.costEach || 0),
        "Line Total": Number(it.lineTotal || 0)
      });
    }
    // Also a labor row so labor is captured in the line sheet
    const labors = Array.isArray(q.laborLines) ? q.laborLines : [];
    for (const l of labors) {
      lineRows.push({
        "Date": quoteDateIso(q) || q.date || "",
        "Store": q.store || "",
        "Caused By": q.causedBy || "",
        "Source": "Labor",
        "Racking Type": "",
        "Item / Part": l.crew || "",
        "Qty": Number(l.hours || 0),
        "Cost Each": Number(l.rate || 0),
        "Line Total": Number(l.total || 0)
      });
    }
  }
  const wsLines = XLSX.utils.json_to_sheet(lineRows);
  wsLines["!cols"] = [
    { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 10 },
    { wch: 18 }, { wch: 50 }, { wch: 10 }, { wch: 11 }, { wch: 12 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Quote Summary");
  XLSX.utils.book_append_sheet(wb, wsLines, "Line Items");

  const filename = `mccoys-risk-safety-quote-search-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
  showAdminMessage(`Downloaded: ${filename}`, false);
}

function exportQuoteSearchToPdf() {
  if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") {
    showAdminMessage("PDF library didn't load. Check your connection and try again.", true);
    return;
  }
  if (!quoteSearchResults.length) {
    showAdminMessage("No results to export. Run a search first.", true);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  if (typeof doc.autoTable !== "function") {
    showAdminMessage("PDF table library didn't load.", true);
    return;
  }
  const GREEN_DARK = [15, 58, 42];
  const YELLOW = [245, 209, 22];
  const PAGE_W = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, PAGE_W, 24, "F");
  doc.setFillColor(...YELLOW);
  doc.rect(0, 24, PAGE_W, 2, "F");
  doc.setTextColor(...YELLOW);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("McCoy's Risk and Safety — Quote Search Report", 14, 15);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(new Date().toLocaleString(), PAGE_W - 14, 15, { align: "right" });

  // Summary totals
  let parts = 0, labor = 0, grand = 0;
  for (const q of quoteSearchResults) {
    parts += Number(q.partsTotal || 0);
    labor += Number(q.laborTotal || 0);
    grand += Number(q.grandTotal || 0);
  }
  doc.setTextColor(...GREEN_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Quotes: ${quoteSearchResults.length}    Parts: ${money(parts)}    Labor: ${money(labor)}    Grand Total: ${money(grand)}`, 14, 34);

  doc.autoTable({
    startY: 40,
    head: [["Date", "Store", "Incident", "Caused By", "Parts", "Labor", "Other", "Grand Total", "Prepared By"]],
    body: quoteSearchResults.map(q => [
      quoteDateIso(q) || q.date || "",
      q.store || "",
      q.incident || "",
      q.causedBy || "",
      money(q.partsTotal || 0),
      money(q.laborTotal || 0),
      money(q.otherDamageCost || 0),
      money(q.grandTotal || 0),
      q.createdBy || ""
    ]),
    headStyles: { fillColor: GREEN_DARK, textColor: YELLOW, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
    margin: { left: 10, right: 10 }
  });

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(7);
  doc.text("McCoy's Risk and Safety — McCoy Corporation Headquarters — 1350 N I.H. 35, San Marcos, TX 78666",
    PAGE_W / 2, doc.internal.pageSize.getHeight() - 6, { align: "center" });

  doc.save(`mccoys-risk-safety-quote-search-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ---------- Boot -----------------------------------------------------------

async function startSafety() {
  setConnectionStatus("Connecting...", "");

  try {
    await ensureUserApproved({ adminOnly: true });
  } catch (err) {
    // ensureUserApproved already redirected or showed an overlay
    return;
  }

  // Show "Signed in as <name>" in the header
  const signedInAs = qs("signedInAs");
  if (signedInAs && currentUserProfile) {
    signedInAs.innerHTML = `<span class="muted">Signed in as</span> <strong>${escapeHtml(currentUserProfile.displayName)}</strong>`;
    signedInAs.style.display = "";
  }

  const signOutBtn = qs("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", signOutAndGoToLogin);

  setupTabs();

  // Initial form state
  if (qs("estDate")) {
    qs("estDate").value = new Date().toISOString().slice(0, 10);
    estInvLines = [newEstInvLine()];
    estCustomLines = [newEstCustomLine()];
    estPhotos = [];
    estOtherPdf = null;
    setEstimateEditMode(null, null);
    renderEstInventoryLines();
    renderEstCustomLines();
    renderEstPhotoPreview();
    refreshEstimateLaborRates();

    const photoInput = qs("estPhotoInput");
    if (photoInput) photoInput.addEventListener("change", handleEstPhotoSelect);

    const otherPdfInput = qs("estOtherPdfInput");
    if (otherPdfInput) otherPdfInput.addEventListener("change", handleEstOtherPdfSelect);

    ["estOtherDesc", "estOtherContractor", "estOtherCost"].forEach(id => {
      const el = qs(id);
      if (el) el.addEventListener("input", updateEstimateTotals);
    });

    qs("estAddInvLineBtn").addEventListener("click", () => { estInvLines.push(newEstInvLine()); renderEstInventoryLines(); updateEstimateTotals(); });
    qs("estAddCustomLineBtn").addEventListener("click", () => { estCustomLines.push(newEstCustomLine()); renderEstCustomLines(); updateEstimateTotals(); });
    qs("estSaveAndDownloadBtn").addEventListener("click", handleEstimateSaveAndDownload);
    qs("estDownloadOnlyBtn").addEventListener("click", handleEstimateDownloadOnly);
    qs("estClearBtn").addEventListener("click", clearEstimateForm);
    const cancelEditBtn = qs("estEditingCancelBtn");
    if (cancelEditBtn) cancelEditBtn.addEventListener("click", clearEstimateForm);

    const greenCb = qs("estLaborGreen");
    const silverCb = qs("estLaborSilver");
    const greenHrs = qs("estLaborGreenHours");
    const silverHrs = qs("estLaborSilverHours");
    greenCb.addEventListener("change", () => {
      greenHrs.disabled = !greenCb.checked;
      if (!greenCb.checked) greenHrs.value = "0";
      updateEstimateTotals();
    });
    silverCb.addEventListener("change", () => {
      silverHrs.disabled = !silverCb.checked;
      if (!silverCb.checked) silverHrs.value = "0";
      updateEstimateTotals();
    });
    greenHrs.addEventListener("input", updateEstimateTotals);
    silverHrs.addEventListener("input", updateEstimateTotals);
  }

  // Quote Search wiring
  const qsRunBtn = qs("qsRunBtn");
  if (qsRunBtn) qsRunBtn.addEventListener("click", runQuoteSearch);
  const qsClearBtn = qs("qsClearBtn");
  if (qsClearBtn) qsClearBtn.addEventListener("click", clearQuoteSearch);
  const qsXlsx = qs("qsExportXlsx");
  if (qsXlsx) qsXlsx.addEventListener("click", exportQuoteSearchToExcel);
  const qsPdf = qs("qsExportPdf");
  if (qsPdf) qsPdf.addEventListener("click", exportQuoteSearchToPdf);

  attachSafetyListeners();
}

document.addEventListener("DOMContentLoaded", startSafety);
