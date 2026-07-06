/* ============================================================
   product-form.js — A4S-ERP Product Form Logic
   ============================================================ */

// ── STATE ──────────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

const state = {
  mode: "new",
  editId: null,
  productType: null,
  category: null,
  categories: [],
  allProducts: [],
  units: [],
  masterUnits: [], // master units list (จาก ตั้งค่า → หน่วยนับ)
  unitRowCount: 0,
  variants: [],
};

// ── SUPABASE ───────────────────────────────────────────────
async function supabaseFetch(table, options = {}) {
  const { url, key } = getSB();
  const { method = "GET", body, query = "" } = options;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return method === "GET" ? res.json() : res.json().catch(() => null);
}

// ── INIT ───────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  const { url, key } = getSB();
  const params = new URLSearchParams(location.search);
  state.mode = params.has("id") ? "edit" : "new";
  state.editId = params.get("id");

  updatePageTitle();
  populateCategoryDropdown();

  if (url && key) {
    await loadInitData();
    if (state.mode === "edit" && state.editId) {
      await loadEditProduct(state.editId);
    }
  }
});

function updatePageTitle() {
  const titleEl = document.getElementById("pageTitle");
  if (titleEl)
    titleEl.textContent =
      state.mode === "edit" ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่";
  document.title =
    (state.mode === "edit" ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่") + " — A4S-ERP";
}

async function loadInitData() {
  showLoading(true);
  try {
    const [cats, prods, uts, masterUts] = await Promise.all([
      supabaseFetch("categories", {
        query: "?select=*&order=sort_order.asc.nullslast",
      }),
      supabaseFetch("products", {
        query: "?select=product_id,product_code,product_name,category_id",
      }),
      supabaseFetch("product_units", { query: "?select=*" }),
      supabaseFetch("units", {
        query:
          "?select=unit_id,unit_name,is_active&is_active=eq.true&order=unit_name.asc",
      }).catch(() => []),
    ]);
    state.categories = cats || [];
    state.allProducts = prods || [];
    state.units = uts || [];
    state.masterUnits = masterUts || [];
    populateCategoryDropdown();
    enableCategoryDrag();
    populateBaseUnitDropdown();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function populateBaseUnitDropdown() {
  const sel = document.getElementById("fBaseUnit");
  if (!sel || sel.tagName !== "SELECT") return;
  const current = sel.value;
  sel.innerHTML = `<option value="">— เลือกหน่วย —</option>`;
  state.masterUnits.forEach((u) => {
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHtmlAttr(u.unit_name)}">${escapeHtmlAttr(u.unit_name)}</option>`,
    );
  });
  if (current) sel.value = current;
}

// set base unit; ถ้าค่าไม่ match master ใส่เป็น option "(เก่า)" กันข้อมูลหาย
function setBaseUnitValue(name) {
  const sel = document.getElementById("fBaseUnit");
  if (!sel) return;
  if (!name) {
    sel.value = "";
    return;
  }
  const exists = Array.from(sel.options).some((o) => o.value === name);
  if (!exists) {
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHtmlAttr(name)}">${escapeHtmlAttr(name)} (เก่า)</option>`,
    );
  }
  sel.value = name;
}

function escapeHtmlAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function updateSidebarProgress(currentStep) {
  document.querySelectorAll(".pf-step").forEach((el, i) => {
    const stepNum = i + 1;
    el.classList.toggle("done", stepNum < currentStep);
    el.classList.toggle("active", stepNum === currentStep);
  });
  document.querySelectorAll(".pf-step-connector").forEach((el, i) => {
    el.classList.toggle("done", i + 1 < currentStep);
  });
}

// ── CATEGORY ──────────────────────────────────────────────
// ── threshold: ≤8 = render all pills · >8 = top 6 + "ดูทั้งหมด" picker
const CAT_PILL_THRESHOLD = 8;
const CAT_PILL_TOP_VISIBLE = 6;

function _catPillHTML(c, selected) {
  const icon = c.icon || "📦";
  return `<button type="button" class="pf-pill${selected ? " selected" : ""}" data-cat-id="${c.category_id}" onclick="selectCategoryCard(${c.category_id})">
    <span class="pf-pill-icon">${icon}</span><span>${c.category_name}</span>
  </button>`;
}

function populateCategoryDropdown() {
  const { url, key } = getSB();
  const grid = document.getElementById("categoryPills");

  if (!url || !key) {
    if (grid)
      grid.innerHTML = `<div style="color:var(--danger,#dc2626);font-size:12px;">
        ⚠️ ยังไม่ได้เชื่อมต่อ Supabase
        <span style="color:var(--text3);">— ไปที่ <b>ตั้งค่า → เชื่อมต่อ Supabase</b></span>
        </div>`;
    return;
  }

  const sel = document.getElementById("fCategory");
  const prevValue = sel ? sel.value : "";
  if (sel) {
    sel.innerHTML = '<option value="">—</option>';
    state.categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.category_id;
      opt.textContent = c.category_name;
      sel.appendChild(opt);
    });
    if (prevValue) sel.value = prevValue;
  }

  if (!grid) return;
  if (state.categories.length === 0) {
    grid.innerHTML = '<div class="pf-pill-empty">ยังไม่มีหมวดหมู่ในระบบ</div>';
    return;
  }

  const cats = state.categories;
  const selectedId = state.category ? state.category.category_id : null;

  if (cats.length <= CAT_PILL_THRESHOLD) {
    grid.innerHTML = cats
      .map((c) => _catPillHTML(c, c.category_id === selectedId))
      .join("");
    return;
  }

  // mode C: top N visible + extra pill if selected is hidden + "ดูทั้งหมด"
  const visible = cats.slice(0, CAT_PILL_TOP_VISIBLE);
  const selectedInVisible = visible.some((c) => c.category_id === selectedId);
  const extraSelected =
    !selectedInVisible && state.category ? state.category : null;

  const visiblePillsHtml = visible
    .map((c) => _catPillHTML(c, c.category_id === selectedId))
    .join("");
  const extraPillHtml = extraSelected ? _catPillHTML(extraSelected, true) : "";

  const pickerItemsHtml = cats
    .map(
      (c) => `<div class="pf-pill-picker-item${c.category_id === selectedId ? " selected" : ""}"
        data-cat-id="${c.category_id}"
        data-search="${(c.category_name || "").toLowerCase()}"
        onclick="selectCategoryFromPicker(${c.category_id})">
        <span class="pf-pill-picker-item-icon">${c.icon || "📦"}</span>
        <span>${c.category_name}</span>
      </div>`,
    )
    .join("");

  grid.innerHTML = `${visiblePillsHtml}${extraPillHtml}
    <button type="button" class="pf-pill pf-pill-more" onclick="toggleCategoryPicker(event)">
      <span>+ ดูทั้งหมด</span><span class="pf-pill-more-caret">▼</span>
    </button>
    <div class="pf-pill-picker" id="categoryPicker" style="display:none">
      <input type="text" class="pf-pill-picker-search" id="categoryPickerSearch"
        placeholder="ค้นหาหมวดหมู่..." oninput="filterCategoryPicker()" />
      <div class="pf-pill-picker-list" id="categoryPickerList">
        ${pickerItemsHtml}
        <div class="pf-pill-picker-empty" id="categoryPickerEmpty" style="display:none">
          ไม่พบหมวดหมู่ที่ตรงกับคำค้น
        </div>
      </div>
    </div>`;
}

function toggleCategoryPicker(e) {
  if (e) e.stopPropagation();
  const picker = document.getElementById("categoryPicker");
  if (!picker) return;
  const willOpen = picker.style.display === "none";
  picker.style.display = willOpen ? "" : "none";
  if (willOpen) {
    const search = document.getElementById("categoryPickerSearch");
    if (search) {
      search.value = "";
      filterCategoryPicker();
      setTimeout(() => search.focus(), 50);
    }
    setTimeout(
      () => document.addEventListener("click", _closeCatPickerOnOutside),
      0,
    );
  } else {
    document.removeEventListener("click", _closeCatPickerOnOutside);
  }
}

function _closeCatPickerOnOutside(e) {
  const picker = document.getElementById("categoryPicker");
  if (!picker) return;
  if (picker.contains(e.target)) return;
  if (e.target.closest && e.target.closest(".pf-pill-more")) return;
  picker.style.display = "none";
  document.removeEventListener("click", _closeCatPickerOnOutside);
}

function filterCategoryPicker() {
  const q = (
    document.getElementById("categoryPickerSearch")?.value || ""
  )
    .toLowerCase()
    .trim();
  const items = document.querySelectorAll(
    "#categoryPickerList .pf-pill-picker-item",
  );
  let shown = 0;
  items.forEach((it) => {
    const txt = it.dataset.search || "";
    const match = !q || txt.includes(q);
    it.style.display = match ? "" : "none";
    if (match) shown++;
  });
  const emptyEl = document.getElementById("categoryPickerEmpty");
  if (emptyEl) emptyEl.style.display = shown === 0 ? "" : "none";
}

function selectCategoryFromPicker(catId) {
  const picker = document.getElementById("categoryPicker");
  if (picker) picker.style.display = "none";
  document.removeEventListener("click", _closeCatPickerOnOutside);
  selectCategoryCard(catId);
  populateCategoryDropdown();
  enableCategoryDrag();
}

function selectCategoryCard(catId) {
  document.querySelectorAll("#categoryPills .pf-pill").forEach((el) => {
    el.classList.toggle("selected", parseInt(el.dataset.catId) === catId);
  });
  const sel = document.getElementById("fCategory");
  if (sel) {
    sel.value = catId;
    onCategoryChange();
  }
}

function onCategoryChange() {
  const sel = document.getElementById("fCategory");
  const catId = parseInt(sel.value);
  state.category =
    state.categories.find((c) => c.category_id === catId) || null;
  updateSummary();
  if (!state.category) return;
  updateSidebarProgress(2);
}

// ── PRODUCT TYPE ───────────────────────────────────────────
function selectProductType(type) {
  state.productType = type;
  const isVariable = type === "variable";

  document.querySelectorAll("#typePills .pf-pill").forEach((el) => {
    el.classList.toggle("selected", el.dataset.type === type);
  });

  showSection(3);

  const varSec = document.getElementById("variantSkuSection");
  if (varSec) varSec.style.display = isVariable ? "" : "none";

  const singlePriceSec = document.getElementById("singlePriceSection");
  if (singlePriceSec) singlePriceSec.style.display = isVariable ? "none" : "";

  state.variants = [];
  if (isVariable) renderVariantSkuRows();

  state.unitRowCount = 0;
  const unitsContainer = document.getElementById("unitsContainer");
  if (unitsContainer) {
    unitsContainer.innerHTML = "";
    addUnitRow({ unit_name: "", conversion_qty: 1, is_base_unit: true });
  }

  const stepSubEl = document.querySelector(
    '.pf-step[data-step="2"] .pf-step-sub',
  );
  if (stepSubEl)
    stepSubEl.textContent = isVariable ? "สินค้าชุด" : "สินค้าเดี่ยว";

  updateSidebarProgress(3);
  goToStep(3);
  updateSummary();
}

function goToStep(step) {
  document.querySelectorAll(".pf-step").forEach((el) => {
    el.classList.toggle("active", parseInt(el.dataset.step) === step);
  });
  document.querySelectorAll(".pf-section[data-step]").forEach((el) => {
    const s = parseInt(el.dataset.step);
    const unlocked = el.dataset.unlocked === "true";
    el.style.display = s <= step || unlocked ? "" : "none";
  });
  updateSidebarProgress(step);
  const target = document.querySelector(`.pf-section[data-step="${step}"]`);
  if (target)
    setTimeout(
      () => target.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
}

// ── PRODUCT CODE GENERATOR ────────────────────────────────
// internal id เท่านั้น ไม่ใช้แสดง user
function generateNextProductCode(usedCodes) {
  const nums = (usedCodes || []).map((code) => {
    const m = String(code || "").match(/^P-(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
  return `P-${String(nextNum).padStart(6, "0")}`;
}

// ── UNIT ROWS ─────────────────────────────────────────────
function _unitOptionsHTML(selectedUnitId, selectedName) {
  // หา unit_id จากชื่อถ้ายังไม่มี (รองรับข้อมูลเก่าที่ยังไม่ได้ backfill)
  let resolvedId = selectedUnitId;
  if (!resolvedId && selectedName) {
    const match = state.masterUnits.find(
      (u) => u.unit_name === selectedName,
    );
    if (match) resolvedId = match.unit_id;
  }
  const opts = state.masterUnits
    .map(
      (u) =>
        `<option value="${u.unit_id}" ${resolvedId === u.unit_id ? "selected" : ""}>${escapeHtmlAttr(u.unit_name)}</option>`,
    )
    .join("");
  // กรณีไม่ match master ใดเลย (ข้อมูลเก่า/หน่วยถูกลบ) → option เพิ่มเป็น text กันข้อมูลหาย
  const orphanOpt =
    !resolvedId && selectedName
      ? `<option value="__legacy__" data-name="${escapeHtmlAttr(selectedName)}" selected>${escapeHtmlAttr(selectedName)} (เก่า)</option>`
      : "";
  return `<option value="">— เลือกหน่วย —</option>${orphanOpt}${opts}`;
}

function addUnitRow(data = {}) {
  state.unitRowCount++;
  const id = state.unitRowCount;
  const isBase = !!data.is_base_unit;
  const div = document.createElement("div");
  div.id = `unit-row-${id}`;
  div.className = `unit-row${isBase ? " unit-row-base" : ""}`;
  div.dataset.isBase = isBase ? "true" : "false";

  const convInput = isBase
    ? `<input class="form-control" type="number" value="1" id="uconv-${id}"
        readonly tabindex="-1"
        style="width:90px;text-align:right;background:var(--surface2);color:var(--text3);cursor:not-allowed;"
        title="หน่วยหลัก ค่าแปลง = 1 เสมอ">`
    : `<input class="form-control" placeholder="= ? หน่วยหลัก" type="number" min="1"
        value="${data.conversion_qty || 1}" id="uconv-${id}" style="width:90px;text-align:right;">`;

  const tail = isBase
    ? '<span class="unit-base-badge">หน่วยหลัก</span>'
    : `<button onclick="removeUnitRow(${id})"
        style="width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;
        color:var(--text3);font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;"
        title="ลบ">✕</button>`;

  div.innerHTML = `
    <select class="form-control" id="uname-${id}" style="flex:2;">
      ${_unitOptionsHTML(data.master_unit_id, data.unit_name)}
    </select>
    ${convInput}
    ${tail}`;
  document.getElementById("unitsContainer").appendChild(div);
}

function removeUnitRow(id) {
  document.getElementById(`unit-row-${id}`)?.remove();
}

// ── VARIANT ROWS ──────────────────────────────────────────
function addVariantSkuRow() {
  state.variants.push({
    enabled: true,
    variantLabel: "",
    cost: 0,
    sale: 0,
  });
  renderVariantSkuRows();
}

function addVariantSkuRows() {
  const input = document.getElementById("variantAddCount");
  let n = parseInt(input?.value, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 10) n = 10;
  for (let i = 0; i < n; i++) {
    state.variants.push({
      enabled: true,
      variantLabel: "",
      cost: 0,
      sale: 0,
    });
  }
  renderVariantSkuRows();
  if (input) input.value = 1;
  const valEl = document.getElementById("variantAddCountVal");
  if (valEl) valEl.textContent = "1";
}

function renderVariantSkuRows() {
  const container = document.getElementById("variantSkuRows");
  if (!container) return;

  if (state.variants.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--text3);
        border:1.5px dashed var(--border);border-radius:8px;font-size:12px;">
        กด "+ เพิ่มตัวเลือก" เพื่อเพิ่มตัวเลือก
      </div>`;
    updateSummary();
    return;
  }

  container.innerHTML = state.variants
    .map(
      (v, vi) => `
    <div style="background:var(--surface2);border:1.5px solid var(--border);
      border-radius:10px;padding:12px 14px;margin-bottom:10px;">
      <div style="display:flex;gap:10px;align-items:flex-end;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:3px;">
            ชื่อตัวเลือก
          </div>
          <input class="form-control" value="${v.variantLabel || ""}"
            placeholder="เช่น สีแดง, Size S"
            style="width:100%;font-size:13px;"
            oninput="updateVariantLabel(${vi}, this.value)">
        </div>
        <div style="width:110px;flex-shrink:0;">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:3px;">
            ราคาทุน (฿)
          </div>
          <input type="number" value="${v.cost}" min="0" step="0.01"
            class="form-control"
            style="width:100%;font-family:monospace;text-align:right;font-size:12px;"
            oninput="state.variants[${vi}].cost=parseFloat(this.value)||0">
        </div>
        <div style="width:110px;flex-shrink:0;">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:3px;">
            ราคาขาย (฿)
          </div>
          <input type="number" value="${v.sale}" min="0" step="0.01"
            class="form-control"
            style="width:100%;font-family:monospace;text-align:right;font-size:12px;color:var(--accent);"
            oninput="state.variants[${vi}].sale=parseFloat(this.value)||0">
        </div>
        <div style="flex-shrink:0;">
          <button onclick="removeVariant(${vi})"
            style="width:34px;height:38px;border:1px solid #fca5a5;background:#fff5f5;
              color:#dc2626;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
        </div>
      </div>
    </div>`,
    )
    .join("");

  updateSummary();
}

function updateVariantLabel(vi, val) {
  state.variants[vi].variantLabel = val;
  updateSummary();
}

function removeVariant(vi) {
  state.variants.splice(vi, 1);
  renderVariantSkuRows();
}

// ── SECTION VISIBILITY ────────────────────────────────────
function showSection(step) {
  const el = document.querySelector(`.pf-section[data-step="${step}"]`);
  if (el) {
    el.style.display = "";
    el.dataset.unlocked = "true";
  }
}

// ── SUMMARY ───────────────────────────────────────────────
function updateSummary() {
  const catEl = document.getElementById("summCat");
  const typeEl = document.getElementById("summType");
  const varEl = document.getElementById("summVars");
  if (catEl)
    catEl.textContent = state.category
      ? (state.category.icon || "") + " " + state.category.category_name
      : "—";
  if (typeEl)
    typeEl.textContent =
      state.productType === "single"
        ? "เดี่ยว"
        : state.productType === "variable"
          ? "ชุด"
          : "—";
  if (varEl)
    varEl.textContent =
      state.productType === "variable"
        ? `${state.variants.filter((v) => v.enabled && v.variantLabel).length} variants`
        : "—";
}

// ── IMAGE UPLOAD ──────────────────────────────────────────
const IMG_SLOTS = 5;
let imgSlotTarget = null;
const imgFiles = new Array(IMG_SLOTS).fill(null);

function initImgUploadGrid() {
  const grid = document.getElementById("imgUploadGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let i = 0; i < IMG_SLOTS; i++) {
    const slot = document.createElement("div");
    slot.className = "img-slot" + (i === 0 ? " img-main-badge" : "");
    slot.dataset.idx = i;
    slot.innerHTML = `<span class="img-plus">＋</span>`;
    slot.onclick = () => openImgPicker(i);
    attachSlotDnD(slot, i);
    grid.appendChild(slot);
  }
}

function openImgPicker(idx) {
  imgSlotTarget = idx;
  document.getElementById("imgFileInput").value = "";
  document.getElementById("imgFileInput").click();
}

function placeImageInSlot(file, idx) {
  if (idx < 0 || idx >= IMG_SLOTS) return;
  imgFiles[idx] = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const slot = document.querySelector(`.img-slot[data-idx="${idx}"]`);
    if (!slot) return;
    slot.innerHTML = `
      <img src="${ev.target.result}" alt="product-img-${idx}" draggable="false" />
      <div class="img-remove" onclick="removeImg(event, ${idx})">✕</div>`;
    if (idx === 0) slot.classList.add("img-main-badge");
  };
  reader.readAsDataURL(file);
}

function attachSlotDnD(slot, idx) {
  const hasFiles = (dt) =>
    !!dt && [...(dt.types || [])].includes("Files");

  slot.addEventListener("dragenter", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    slot.classList.add("drag-over");
  });
  slot.addEventListener("dragover", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  slot.addEventListener("dragleave", (e) => {
    if (!slot.contains(e.relatedTarget)) slot.classList.remove("drag-over");
  });
  slot.addEventListener("drop", (e) => {
    e.preventDefault();
    slot.classList.remove("drag-over");
    const files = [...(e.dataTransfer?.files || [])].filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;

    let target = idx;
    for (const f of files) {
      if (target >= IMG_SLOTS) break;
      placeImageInSlot(f, target);
      do {
        target++;
      } while (target < IMG_SLOTS && imgFiles[target]);
    }
  });
}

function onImgFileSelected(e) {
  const file = e.target.files[0];
  if (!file || imgSlotTarget === null) return;
  placeImageInSlot(file, imgSlotTarget);
}

function removeImg(e, idx) {
  e.stopPropagation();
  // แค่เอาออกจาก UI — ไฟล์ Drive จะถูก trash ตอน save (เฉพาะรูปที่หายจริง เคารพการยกเลิก)
  imgFiles[idx] = null;
  const slot = document.querySelector(`.img-slot[data-idx="${idx}"]`);
  if (!slot) return;
  slot.innerHTML = `<span class="img-plus">＋</span>`;
  slot.onclick = () => openImgPicker(idx);
}

document.addEventListener("DOMContentLoaded", initImgUploadGrid);

async function uploadProductImages(productId) {
  const { url, key } = getSB();
  const filesToUpload = imgFiles
    .map((file, idx) => ({ file, idx }))
    .filter(({ file }) => file !== null);

  // url เดิมใน DB — ใช้หา "รูปที่ถูกลบ" เพื่อ trash ไฟล์ Drive (เฉพาะที่หายจริง)
  const keptUrls = new Set(
    filesToUpload.filter((x) => x.file._existingUrl).map((x) => x.file._existingUrl),
  );
  let oldUrls = [];
  try {
    const rows = await supabaseFetch("product_images", {
      query: `?product_id=eq.${productId}&select=url`,
    });
    oldUrls = (rows || []).map((r) => r.url).filter(Boolean);
  } catch { /* ignore */ }

  // ลบ row เดิมทั้งหมดเสมอ (แม้ลบรูปหมด — กัน row ค้างชี้ไฟล์ที่ถูก trash)
  await supabaseFetch("product_images", {
    method: "DELETE",
    query: `?product_id=eq.${productId}`,
  }).catch(() => {});

  // trash ไฟล์ Drive ของรูปที่ถูกลบออก (ไม่อยู่ในชุดที่เก็บไว้)
  for (const u of oldUrls) {
    if (!keptUrls.has(u)) await window.ImageCompressor?.deleteDriveUrl(u);
  }

  for (const { file, idx } of filesToUpload) {
    if (file._existingUrl) {
      await supabaseFetch("product_images", {
        method: "POST",
        body: {
          product_id: productId,
          url: file._existingUrl,
          sort_order: idx,
        },
      }).catch(() => {});
      continue;
    }
    try {
      const path = `products/${productId}_${idx}_${Date.now()}`;
      // อัปโหลด — routing Supabase/Drive อยู่ใน uploadViaRest (คุมด้วย erp_drive_buckets)
      const publicUrl = await window.ImageCompressor.uploadViaRest(
        url, key, "product-images", path, file,
      );
      if (!publicUrl) throw new Error("Upload failed");
      await supabaseFetch("product_images", {
        method: "POST",
        body: { product_id: productId, url: publicUrl, sort_order: idx },
      });
    } catch (e) {
      showToast(
        `⚠️ อัปโหลดรูป slot ${idx + 1} ไม่สำเร็จ: ${e.message}`,
        "error",
      );
    }
  }
}

async function saveUnitsForProduct(productId) {
  await supabaseFetch("product_units", {
    method: "DELETE",
    query: `?product_id=eq.${productId}`,
  }).catch(() => {});
  for (const div of document.querySelectorAll('[id^="unit-row-"]')) {
    const rowId = div.id.replace("unit-row-", "");
    const sel = document.getElementById(`uname-${rowId}`);
    const val = sel?.value?.trim();
    const uconv =
      parseFloat(document.getElementById(`uconv-${rowId}`)?.value) || 1;
    const ubase = div.dataset.isBase === "true";

    if (!val) continue;

    let masterUnitId = null;
    let unitName = "";
    if (val === "__legacy__") {
      // legacy data — ใช้ชื่อเดิม master_unit_id = null
      unitName = sel.options[sel.selectedIndex]?.dataset?.name || "";
    } else {
      masterUnitId = parseInt(val);
      const u = state.masterUnits.find((x) => x.unit_id === masterUnitId);
      unitName = u?.unit_name || "";
    }
    if (!unitName) continue;

    await supabaseFetch("product_units", {
      method: "POST",
      body: {
        product_id: productId,
        master_unit_id: masterUnitId,
        unit_name: unitName,
        conversion_qty: uconv,
        is_base_unit: ubase,
      },
    });
  }
}

// ── SAVE ──────────────────────────────────────────────────
async function saveProduct() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning");
    return;
  }
  if (!state.category) {
    showToast("กรุณาเลือกหมวดหมู่", "error");
    return;
  }
  if (!state.productType) {
    showToast("กรุณาเลือกประเภทสินค้า", "error");
    return;
  }

  const name = document.getElementById("fName")?.value?.trim();
  const base = document.getElementById("fBaseUnit")?.value?.trim();

  if (!name) {
    showToast("กรุณากรอกชื่อสินค้า", "error");
    return;
  }
  if (!base) {
    showToast("กรุณากรอกหน่วยฐาน", "error");
    return;
  }

  if (state.productType === "variable") {
    const activeVariants = state.variants.filter(
      (v) => v.enabled && v.variantLabel?.trim(),
    );
    if (activeVariants.length === 0) {
      showToast("กรุณาเพิ่มตัวเลือกอย่างน้อย 1 รายการ", "error");
      return;
    }
  }

  showLoading(true);
  try {
    const reorderPoint =
      parseFloat(document.getElementById("fReorder")?.value) || 0;

    // refetch products เพื่อหลีกเลี่ยง product_code ซ้ำ (กรณี state.allProducts stale
    // เช่น save ก่อนหน้าล้มกลางคันแต่ products ถูก insert ไปแล้ว)
    try {
      const fresh = await supabaseFetch("products", {
        query: "?select=product_id,product_code,product_name,category_id",
      });
      if (Array.isArray(fresh)) state.allProducts = fresh;
    } catch {}

    if (state.productType === "variable") {
      const usedCodes = state.allProducts.map((p) => p.product_code);
      const formVariants = state.variants.filter(
        (vt) => vt.enabled && vt.variantLabel?.trim(),
      );

      let parentId;
      if (state.editId) {
        // EDIT MODE: update parent + diff variants (update/insert/delete)
        parentId = parseInt(state.editId);
        await supabaseFetch("products", {
          method: "PATCH",
          body: {
            product_name: name,
            category_id: state.category.category_id,
            base_unit: base,
            reorder_point: reorderPoint,
          },
          query: `?product_id=eq.${parentId}`,
        });

        // load existing children เพื่อ diff
        const existingChildren =
          (await supabaseFetch("products", {
            query: `?parent_product_id=eq.${parentId}&select=product_id`,
          })) || [];
        const existingIds = new Set(
          existingChildren.map((c) => c.product_id),
        );
        const keptIds = new Set();

        for (const v of formVariants) {
          const variantPayload = {
            product_name: `${name} (${v.variantLabel.trim()})`,
            category_id: state.category.category_id,
            base_unit: base,
            cost_price: v.cost || 0,
            sale_price: v.sale || 0,
            reorder_point: reorderPoint,
            parent_product_id: parentId,
          };
          if (v.product_id && existingIds.has(v.product_id)) {
            // UPDATE existing variant
            await supabaseFetch("products", {
              method: "PATCH",
              body: variantPayload,
              query: `?product_id=eq.${v.product_id}`,
            });
            keptIds.add(v.product_id);
          } else {
            // INSERT new variant
            const productCode = generateNextProductCode(usedCodes);
            usedCodes.push(productCode);
            await supabaseFetch("products", {
              method: "POST",
              body: { ...variantPayload, product_code: productCode },
            });
          }
        }

        // DELETE variants ที่ถูกลบออกจาก form
        const toDelete = [...existingIds].filter((cid) => !keptIds.has(cid));
        for (const delId of toDelete) {
          await supabaseFetch("product_units", {
            method: "DELETE",
            query: `?product_id=eq.${delId}`,
          }).catch(() => {});
          await supabaseFetch("product_images", {
            method: "DELETE",
            query: `?product_id=eq.${delId}`,
          }).catch(() => {});
          await supabaseFetch("products", {
            method: "DELETE",
            query: `?product_id=eq.${delId}`,
          });
        }
      } else {
        // CREATE MODE: parent + variants ใหม่ทั้งหมด
        const parentCode = generateNextProductCode(usedCodes);
        usedCodes.push(parentCode);
        const parentRes = await supabaseFetch("products", {
          method: "POST",
          body: {
            product_code: parentCode,
            product_name: name,
            category_id: state.category.category_id,
            base_unit: base,
            cost_price: 0,
            sale_price: 0,
            reorder_point: reorderPoint,
            parent_product_id: null,
          },
        });
        parentId = parentRes[0].product_id;

        for (const v of formVariants) {
          const productCode = generateNextProductCode(usedCodes);
          usedCodes.push(productCode);
          await supabaseFetch("products", {
            method: "POST",
            body: {
              product_code: productCode,
              product_name: `${name} (${v.variantLabel.trim()})`,
              category_id: state.category.category_id,
              base_unit: base,
              cost_price: v.cost || 0,
              sale_price: v.sale || 0,
              reorder_point: reorderPoint,
              parent_product_id: parentId,
            },
          });
        }
      }

      // units + images เก็บที่ parent (variants ใช้ร่วมกัน)
      await saveUnitsForProduct(parentId);
      await uploadProductImages(parentId);
    } else {
      let productId;
      if (state.editId) {
        const payload = {
          product_name: name,
          category_id: state.category.category_id,
          base_unit: base,
          reorder_point: reorderPoint,
          cost_price: parseFloat(document.getElementById("fCost")?.value) || 0,
          sale_price: parseFloat(document.getElementById("fSale")?.value) || 0,
        };
        await supabaseFetch("products", {
          method: "PATCH",
          body: payload,
          query: `?product_id=eq.${state.editId}`,
        });
        productId = parseInt(state.editId);
      } else {
        const productCode = generateNextProductCode(
          state.allProducts.map((p) => p.product_code),
        );
        const payload = {
          product_code: productCode,
          product_name: name,
          category_id: state.category.category_id,
          base_unit: base,
          reorder_point: reorderPoint,
          cost_price: parseFloat(document.getElementById("fCost")?.value) || 0,
          sale_price: parseFloat(document.getElementById("fSale")?.value) || 0,
        };
        const res = await supabaseFetch("products", {
          method: "POST",
          body: payload,
        });
        productId = res[0].product_id;
      }
      await saveUnitsForProduct(productId);
      await uploadProductImages(productId);
    }

    showToast("✅ บันทึกสินค้าสำเร็จ!", "success");
    setTimeout(() => {
      window.location.href = "./products-list.html";
    }, 1500);
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  }
  showLoading(false);
}

// ── EDIT: LOAD PRODUCT ────────────────────────────────────
async function loadEditProduct(id) {
  showLoading(true);
  try {
    const prods = await supabaseFetch("products", {
      query: `?product_id=eq.${id}&select=*`,
    });
    if (!prods || prods.length === 0) {
      showToast("ไม่พบสินค้า", "error");
      return;
    }
    const p = prods[0];

    // โหลด children — ถ้ามี = parent ของ variants
    const children =
      (await supabaseFetch("products", {
        query: `?parent_product_id=eq.${id}&select=*&order=product_id.asc`,
      })) || [];
    const isVariantParent = children.length > 0;

    const catSel = document.getElementById("fCategory");
    if (catSel) {
      catSel.value = p.category_id;
      onCategoryChange();
      populateCategoryDropdown();
      enableCategoryDrag();
    }

    selectProductType(isVariantParent ? "variable" : "single");

    document.getElementById("fName").value = p.product_name || "";
    setBaseUnitValue(p.base_unit || "");
    document.getElementById("fReorder").value = p.reorder_point || "";

    if (isVariantParent) {
      // ดึง variant label จาก "Polo (S)" → "S"
      const baseName = (p.product_name || "").trim();
      state.variants = children.map((c) => {
        const m = (c.product_name || "").match(/\(([^)]+)\)\s*$/);
        let label = m
          ? m[1].trim()
          : (c.product_name || "").replace(baseName, "").trim();
        return {
          enabled: true,
          variantLabel: label,
          cost: parseFloat(c.cost_price) || 0,
          sale: parseFloat(c.sale_price) || 0,
          product_id: c.product_id, // ผูก existing variant ไว้ตอน save
        };
      });
      renderVariantSkuRows();
    } else {
      document.getElementById("fCost").value = p.cost_price || "";
      document.getElementById("fSale").value = p.sale_price || "";
    }

    const unitsContainer = document.getElementById("unitsContainer");
    if (unitsContainer) {
      unitsContainer.innerHTML = "";
      state.unitRowCount = 0;
      const prodUnits = state.units
        .filter((u) => u.product_id === parseInt(id))
        // หน่วยหลักต้องอยู่แถวแรกเสมอ
        .sort((a, b) => (b.is_base_unit ? 1 : 0) - (a.is_base_unit ? 1 : 0));
      // ถ้าไม่มี row ไหนมี is_base_unit=true → ยก row แรกขึ้นเป็นหน่วยหลัก
      if (prodUnits.length > 0 && !prodUnits.some((u) => u.is_base_unit)) {
        prodUnits[0] = { ...prodUnits[0], is_base_unit: true };
      }
      prodUnits.forEach((u) => addUnitRow(u));
      if (state.unitRowCount === 0)
        addUnitRow({
          unit_name: p.base_unit || "",
          conversion_qty: 1,
          is_base_unit: true,
        });
    }

    try {
      const imgs = await supabaseFetch("product_images", {
        query: `?product_id=eq.${id}&order=sort_order.asc`,
      });
      if (imgs && imgs.length > 0) {
        imgs.forEach((img) => {
          const idx = img.sort_order ?? 0;
          if (idx >= IMG_SLOTS) return;
          const slot = document.querySelector(`.img-slot[data-idx="${idx}"]`);
          if (!slot) return;
          slot.innerHTML = `<img src="${img.url}" alt="product-img-${idx}" /><div class="img-remove" onclick="removeImg(event, ${idx})">✕</div>`;
          imgFiles[idx] = { _existingUrl: img.url, _imageId: img.image_id };
          if (idx === 0) slot.classList.add("img-main-badge");
        });
      }
    } catch {}
    updateSummary();
  } catch (e) {
    showToast("โหลดข้อมูลสินค้าไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── CATEGORY DRAG SORT ────────────────────────────────────
// drag-sort ใช้ได้เฉพาะ mode A (≤ threshold) — mode C ใช้จัดการที่หน้า categories
function enableCategoryDrag() {
  const grid = document.getElementById("categoryPills");
  if (!grid) return;
  if (state.categories.length > CAT_PILL_THRESHOLD) return;
  let dragEl = null;
  grid.querySelectorAll(".pf-pill[data-cat-id]").forEach((pill) => {
    pill.draggable = true;
    pill.addEventListener("dragstart", () => {
      dragEl = pill;
      pill.classList.add("dragging");
    });
    pill.addEventListener("dragend", () => {
      pill.classList.remove("dragging");
      saveCategoryOrder();
    });
    pill.addEventListener("dragover", (e) => {
      e.preventDefault();
      const after = getDragAfterElement(grid, e.clientX);
      if (after == null) grid.appendChild(dragEl);
      else grid.insertBefore(dragEl, after);
    });
  });
}

function getDragAfterElement(container, x) {
  const els = [
    ...container.querySelectorAll(".pf-pill[data-cat-id]:not(.dragging)"),
  ];
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      return offset < 0 && offset > closest.offset
        ? { offset, element: child }
        : closest;
    },
    { offset: Number.NEGATIVE_INFINITY },
  ).element;
}

async function saveCategoryOrder() {
  const grid = document.getElementById("categoryPills");
  if (!grid) return;
  const pills = [...grid.querySelectorAll(".pf-pill[data-cat-id]")];
  for (let i = 0; i < pills.length; i++) {
    const id = pills[i].dataset.catId;
    await supabaseFetch("categories", {
      method: "PATCH",
      body: { sort_order: i + 1 },
      query: `?category_id=eq.${id}`,
    });
  }
}

// ── UTILS ─────────────────────────────────────────────────
function goBack() {
  if (history.length > 1) history.back();
  else window.location.href = "./products-list.html";
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3200);
}

function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}
