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
  unitRowCount: 0,
  variantMode: "list",
  attributes: [],
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
    const [cats, prods, uts] = await Promise.all([
      supabaseFetch("categories", {
        query: "?select=*&order=sort_order.asc.nullslast",
      }),
      supabaseFetch("products", {
        query:
          "?select=product_id,product_code,product_name,category_id&order=product_code",
      }),
      supabaseFetch("product_units", { query: "?select=*" }),
    ]);
    state.categories = cats || [];
    state.allProducts = prods || [];
    state.units = uts || [];
    populateCategoryDropdown();
    enableCategoryDrag();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
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

function getCurrentStep() {
  const active = document.querySelector(".pf-step.active");
  return active ? parseInt(active.dataset.step) : 1;
}

// ── CATEGORY ──────────────────────────────────────────────
function populateCategoryDropdown() {
  const { url, key } = getSB();
  const grid = document.getElementById("categoryCardGrid");

  if (!url || !key) {
    if (grid)
      grid.innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger,#dc2626);">
        ⚠️ ยังไม่ได้เชื่อมต่อ Supabase<br>
        <span style="font-size:12px;color:var(--text3);">กรุณาไปที่ <b>ตั้งค่า → เชื่อมต่อ Supabase</b> ก่อน</span>
        </div>`;
    return;
  }

  const sel = document.getElementById("fCategory");
  if (sel) {
    sel.innerHTML = '<option value="">—</option>';
    state.categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.category_id;
      opt.textContent = c.category_name;
      sel.appendChild(opt);
    });
  }

  if (!grid) return;
  if (state.categories.length === 0) {
    grid.innerHTML = '<div class="cat-card-empty">ยังไม่มีหมวดหมู่ในระบบ</div>';
    return;
  }
  grid.innerHTML = state.categories
    .map(
      (
        c,
      ) => `<div class="cat-card" data-cat-id="${c.category_id}" onclick="selectCategoryCard(${c.category_id})">
        <div class="cat-card-icon">${c.icon || "📦"}</div>
        <div class="cat-card-name">${c.category_name}</div>
      </div>`,
    )
    .join("");
}

function selectCategoryCard(catId) {
  document.querySelectorAll(".cat-card").forEach((el) => {
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
  showSection(2);
  updateSidebarProgress(2);
  goToStep(2);
  const badge = document.getElementById("catBadge");
  if (badge) {
    badge.textContent =
      (state.category.icon || "") + " " + state.category.category_name;
    badge.style.display = "inline-flex";
  }
}

// ── PRODUCT TYPE ───────────────────────────────────────────
function selectProductType(type) {
  state.productType = type;
  const isVariable = type === "variable";

  document.querySelectorAll(".type-card").forEach((el) => {
    el.classList.toggle("selected", el.dataset.type === type);
  });

  showSection(3);
  showSection(4);
  showSection(5);

  const varSkuSec = document.getElementById("variantSkuSection");
  if (varSkuSec) varSkuSec.style.display = isVariable ? "" : "none";

  const singlePriceSec = document.getElementById("singlePriceSection");
  const parentPriceSec = document.getElementById("parentPriceSection");
  if (singlePriceSec) singlePriceSec.style.display = isVariable ? "none" : "";
  if (parentPriceSec) parentPriceSec.style.display = isVariable ? "" : "none";

  state.variants = [];
  state.attributes = [];
  if (isVariable) renderVariantSkuRows();

  buildSkuFields();

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

// ── SKU BUILDER ───────────────────────────────────────────
function buildSkuFields() {
  if (!state.category) return;
  const cat = state.category;
  const skuLabels =
    typeof cat.sku_labels === "string"
      ? tryParseJson(cat.sku_labels)
      : cat.sku_labels || {};
  const prefix =
    skuLabels.prefix ||
    cat.category_code ||
    cat.category_name?.substring(0, 3).toUpperCase() ||
    "XXX";
  const segments = skuLabels.segments || [];

  const grid = document.getElementById("skuFieldsGrid");
  if (!grid) return;

  let html = `<div>
    <div class="sku-field-label">PREFIX <span class="sku-field-tag tag-fix">FIX</span></div>
    <input id="sku_prefix" class="form-control" value="${prefix}" readonly
      style="font-family:monospace;font-weight:700;text-align:center;">
  </div>`;

  segments.slice(0, 5).forEach((seg, i) => {
    html += `<div>
      <div class="sku-field-label">${seg.label || "ช่อง " + (i + 2)}
        ${seg.locked ? '<span class="sku-field-tag tag-fix">LOCK</span>' : ""}
      </div>
      <input id="sku_s${i}" class="form-control" placeholder="ค่า"
        style="font-family:monospace;text-align:center;text-transform:uppercase;" maxlength="10"
        oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'');updateSkuPreview();">
    </div>`;
  });

  html += `<div>
    <div class="sku-field-label">ลำดับ <span class="sku-field-tag tag-auto">AUTO</span></div>
    <input id="sku_seq" class="form-control" value="001" readonly
      style="font-family:monospace;font-weight:700;text-align:center;">
  </div>`;

  grid.innerHTML = html;
  updateSkuPreview();
}

function tryParseJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function autoSeq(skuPrefix) {
  if (!skuPrefix || skuPrefix.includes("?")) return "001";
  const prefixUpper = skuPrefix.toUpperCase();
  const usedSeqs = state.allProducts
    .map((p) => {
      const code = (p.product_code || "").toUpperCase();
      const parts = code.split("-");
      if (parts.length < 2) return 0;
      const codePrefix = parts.slice(0, -2).join("-");
      if (codePrefix !== prefixUpper) return 0;
      return parseInt(parts[parts.length - 1]) || 0;
    })
    .filter((n) => n > 0);
  const maxSeq = usedSeqs.length ? Math.max(...usedSeqs) : 0;
  return String(maxSeq + 1).padStart(3, "0");
}

function updateSkuPreview() {
  const prefix = document.getElementById("sku_prefix")?.value || "?";
  const segments = [];
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById("sku_s" + i);
    if (!el) continue;
    const v = el.value?.trim();
    segments.push(v ? v.toUpperCase() : "?");
    const prevVal = el.dataset.prevVal;
    if (prevVal !== undefined && prevVal !== el.value) {
      const seqInput = document.getElementById("sku_seq");
      if (seqInput) delete seqInput.dataset.manualEdit;
    }
    el.dataset.prevVal = el.value || "";
  }
  const seqEl = document.getElementById("sku_seq");
  const allSegsValues = segments.filter((s) => s !== "?");
  const seqPrefix =
    allSegsValues.length >= 1
      ? [prefix, ...allSegsValues.slice(0, -1)].join("-")
      : prefix || null;
  if (seqEl && seqPrefix && !seqEl.dataset.manualEdit) {
    seqEl.value = autoSeq(seqPrefix);
  }
  const seq = seqEl?.value || "001";
  const sku = [prefix, ...segments, seq].join("-");
  const preview = document.getElementById("skuPreviewVal");
  if (preview) preview.textContent = sku;
  return sku;
}

function getCurrentSku() {
  const prefix = document.getElementById("sku_prefix")?.value || "?";
  const segs = [];
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById(`sku_s${i}`);
    if (el) segs.push(el.value || "?");
  }
  const seq = document.getElementById("sku_seq")?.value || "?";
  return [prefix, ...segs, seq].filter(Boolean).join("-").toUpperCase();
}

// ── UNIT ROWS ─────────────────────────────────────────────
function addUnitRow(data = {}) {
  state.unitRowCount++;
  const id = state.unitRowCount;
  const div = document.createElement("div");
  div.id = `unit-row-${id}`;
  div.className = `unit-row${data.is_base_unit ? " unit-row-base" : ""}`;
  div.innerHTML = `
    <input class="form-control" placeholder="ชื่อหน่วย เช่น กล่อง"
      value="${data.unit_name || ""}" id="uname-${id}" style="flex:2;">
    <input class="form-control" placeholder="= ? ชิ้น" type="number" min="1"
      value="${data.conversion_qty || 1}" id="uconv-${id}" style="width:90px;text-align:right;">
    <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text2);flex-shrink:0;cursor:pointer;">
      <input type="checkbox" id="ubase-${id}" ${data.is_base_unit ? "checked" : ""}
        onchange="markBaseUnit(${id})"> หน่วยหลัก
    </label>
    ${
      data.is_base_unit
        ? '<span class="unit-base-badge">หน่วยหลัก</span>'
        : `<button onclick="removeUnitRow(${id})"
          style="width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;
          color:var(--text3);font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;"
          title="ลบ">✕</button>`
    }`;
  document.getElementById("unitsContainer").appendChild(div);
}

function removeUnitRow(id) {
  document.getElementById(`unit-row-${id}`)?.remove();
}

function markBaseUnit(id) {
  document.querySelectorAll('[id^="ubase-"]').forEach((cb) => {
    const rowId = cb.id.replace("ubase-", "");
    cb.checked = rowId === String(id);
    const row = document.getElementById(`unit-row-${rowId}`);
    if (row) row.classList.toggle("unit-row-base", rowId === String(id));
  });
}

// ── VARIANT SKU ROWS ──────────────────────────────────────
function addVariantSkuRow() {
  const parentSku = getCurrentSku();
  if (parentSku.includes("?")) {
    showToast("กรอก SKU หลักให้ครบก่อน", "warning");
    return;
  }
  const cat = state.category;
  const skuLabels =
    typeof cat?.sku_labels === "string"
      ? tryParseJson(cat.sku_labels)
      : cat?.sku_labels || {};
  const baseSeq = parseInt(document.getElementById("sku_seq")?.value) || 1;
  const nextSeq = baseSeq + state.variants.length + 1;
  const seqStr = String(nextSeq).padStart(3, "0");
  state.variants.push({
    enabled: true,
    sku: "",
    variantLabel: "",
    seq: seqStr,
    cost: 0,
    sale: 0,
  });
  renderVariantSkuRows();
}

function renderVariantSkuRows() {
  const container = document.getElementById("variantSkuRows");
  if (!container) return;

  const cat = state.category;
  const skuLabels =
    typeof cat?.sku_labels === "string"
      ? tryParseJson(cat.sku_labels)
      : cat?.sku_labels || {};
  const segments = skuLabels.segments || [];
  const f1Val = document.getElementById("sku_prefix")?.value || "???";
  const seqVal = document.getElementById("sku_seq")?.value || "?";
  const catColor = cat?.color || "#0f4c75";

  // อ่าน segment ตามลำดับจาก DOM
  // อ่าน segment เฉพาะที่ buildSkuFields() สร้างจริง (ตาม segments.length)
  const allSegments = [];
  const segCount = Math.min(segments.length, 5); // render แค่ตาม segment ที่มีจริง
  for (let i = 0; i < segCount; i++) {
    const el = document.getElementById(`sku_s${i}`);
    if (!el) continue;
    const segDef = segments[i] || {};
    allSegments.push({
      value: el.value || "?",
      label: segDef.label || `ช่อง ${i + 2}`,
      locked: !!segDef.locked,
      index: i,
    });
  }

  // หา editable segment แรก (ตัวที่ variant กรอก)
  const variantSegDef = allSegments.find((s) => !s.locked) || {
    label: "ตัวเลือก",
  };

  if (state.variants.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--text3);
        border:1.5px dashed var(--border);border-radius:8px;font-size:12px;">
        กด "+ เพิ่มตัวเลือก" เพื่อเพิ่ม SKU ย่อย เช่น สีแดง, ไซส์ S
      </div>`;
    updateSummary();
    return;
  }

  container.innerHTML = state.variants
    .map((v, vi) => {
      const varSuffix = v.variantLabel ? v.variantLabel.toUpperCase() : "?";
      const vSeq = v.seq || seqVal;

      // สร้าง SKU ตามลำดับจริง
      const skuParts = [f1Val];
      allSegments.forEach((seg) => {
        skuParts.push(seg.locked ? seg.value : varSuffix);
      });
      skuParts.push(vSeq);
      const autoSku = skuParts.join("-").toUpperCase();
      state.variants[vi].sku = autoSku;

      // render columns ตามลำดับจริง (ไม่แยก locked/editable ออกจากกัน)
      const segCols = allSegments
        .map((seg) => {
          if (seg.locked) {
            return `
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:3px;">
                ${seg.label}
                <span style="font-size:9px;background:#e5e7eb;color:#6b7280;
                  padding:1px 4px;border-radius:3px;">LOCK</span>
              </div>
              <input class="form-control" value="${seg.value}" readonly
                style="width:100%;font-family:monospace;font-size:12px;text-align:center;
                background:var(--surface3,#f3f4f6);color:var(--text2);cursor:not-allowed;">
            </div>`;
          } else {
            return `
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:3px;">
                ${seg.label}
              </div>
              <input class="form-control variant-label-input" value="${v.variantLabel}"
                placeholder="เช่น RED, S, XL"
                style="width:100%;font-family:monospace;text-transform:uppercase;font-weight:700;
                  font-size:13px;color:var(--accent);text-align:center;
                  border-color:var(--accent);background:var(--accent-pale);"
                oninput="updateVariantSkuLabel(${vi}, this.value)">
            </div>`;
          }
        })
        .join("");

      return `
    <div style="background:var(--surface2);border:1.5px solid var(--border);
      border-radius:10px;padding:12px 14px;margin-bottom:10px;">

      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:8px;">

        <!-- PREFIX -->
        <div style="width:80px;flex-shrink:0;">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:3px;">
            PREFIX
            <span style="font-size:9px;background:${catColor}22;color:${catColor};
              padding:1px 4px;border-radius:3px;">FIX</span>
          </div>
          <input class="form-control" value="${f1Val}" readonly
            style="width:100%;font-family:monospace;font-size:12px;font-weight:700;text-align:center;
            background:${catColor}22;color:${catColor};border-color:${catColor}44;cursor:not-allowed;">
        </div>

        <!-- Segments ตามลำดับจริง -->
        ${segCols}

        <!-- ลำดับ -->
        <div style="width:70px;flex-shrink:0;">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:3px;">ลำดับ</div>
          <input class="form-control" value="${vSeq}" readonly
            style="width:100%;font-family:monospace;font-size:12px;font-weight:700;text-align:center;
            background:#f0fdf4;color:#166534;cursor:not-allowed;">
        </div>

        <!-- ลบ -->
        <div style="flex-shrink:0;">
          <button onclick="removeVariant(${vi})"
            style="width:34px;height:38px;border:1px solid #fca5a5;background:#fff5f5;
              color:#dc2626;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
        </div>
      </div>

      <!-- SKU Preview -->
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">
        SKU: <span style="font-family:monospace;font-weight:700;color:var(--text1);">${autoSku}</span>
        &nbsp;&nbsp;
        ราคาทุน: <input type="number" value="${v.cost}" min="0" step="0.01"
          style="width:80px;font-size:12px;padding:3px 6px;border:1px solid var(--border);
            border-radius:5px;font-family:monospace;text-align:right;"
          oninput="state.variants[${vi}].cost=parseFloat(this.value)||0">
        &nbsp;
        ราคาขาย: <input type="number" value="${v.sale}" min="0" step="0.01"
          style="width:80px;font-size:12px;padding:3px 6px;border:1px solid var(--border);
            border-radius:5px;font-family:monospace;text-align:right;"
          oninput="state.variants[${vi}].sale=parseFloat(this.value)||0">
      </div>
    </div>`;
    })
    .join("");

  updateSummary();
}
function updateVariantSkuLabel(vi, val) {
  state.variants[vi].variantLabel = val.toUpperCase();

  const cat = state.category;
  const skuLabels =
    typeof cat?.sku_labels === "string"
      ? tryParseJson(cat.sku_labels)
      : cat?.sku_labels || {};
  const segments = skuLabels.segments || [];
  const f1 = document.getElementById("sku_prefix")?.value || "?";
  const vSeq =
    state.variants[vi].seq || document.getElementById("sku_seq")?.value || "?";
  const label = val.trim().toUpperCase() || "?";

  // สร้าง SKU ตามลำดับจริง
  const skuParts = [f1];
  const segCount2 = Math.min(segments.length, 5);
  for (let i = 0; i < segCount2; i++) {
    const el = document.getElementById(`sku_s${i}`);
    if (!el) continue;
    const segDef = segments[i] || {};
    skuParts.push(segDef.locked ? el.value || "?" : label);
  }
  skuParts.push(vSeq);
  state.variants[vi].sku = skuParts.join("-").toUpperCase();

  // update SKU preview text ใน row
  const rows = document.querySelectorAll("#variantSkuRows > div");
  if (rows[vi]) {
    const skuSpan = rows[vi].querySelector("span[style*='monospace']");
    if (skuSpan) skuSpan.textContent = state.variants[vi].sku;
  }
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
  const skuEl = document.getElementById("summSku");
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
  if (skuEl) skuEl.textContent = getCurrentSku() || "—";
  if (varEl)
    varEl.textContent =
      state.productType === "variable"
        ? `${state.variants.filter((v) => v.enabled).length} variants`
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
    grid.appendChild(slot);
  }
}

function openImgPicker(idx) {
  imgSlotTarget = idx;
  document.getElementById("imgFileInput").value = "";
  document.getElementById("imgFileInput").click();
}

function onImgFileSelected(e) {
  const file = e.target.files[0];
  if (!file || imgSlotTarget === null) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    imgFiles[imgSlotTarget] = file;
    const slot = document.querySelector(
      `.img-slot[data-idx="${imgSlotTarget}"]`,
    );
    if (!slot) return;
    slot.innerHTML = `
      <img src="${ev.target.result}" alt="product-img-${imgSlotTarget}" />
      <div class="img-remove" onclick="removeImg(event, ${imgSlotTarget})">✕</div>`;
    if (imgSlotTarget === 0) slot.classList.add("img-main-badge");
  };
  reader.readAsDataURL(file);
}

function removeImg(e, idx) {
  e.stopPropagation();
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
  if (filesToUpload.length === 0) return;

  await supabaseFetch("product_images", {
    method: "DELETE",
    query: `?product_id=eq.${productId}`,
  }).catch(() => {});

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
      const ext = file.name.split(".").pop().toLowerCase();
      const fileName = `${productId}_${idx}_${Date.now()}.${ext}`;
      const uploadPath = `products/${fileName}`;
      const uploadRes = await fetch(
        `${url}/storage/v1/object/product-images/${uploadPath}`,
        {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": file.type,
            "x-upsert": "true",
          },
          body: file,
        },
      );
      if (!uploadRes.ok)
        throw new Error(
          (await uploadRes.json().catch(() => ({}))).message || "Upload failed",
        );
      const publicUrl = `${url}/storage/v1/object/public/product-images/${uploadPath}`;
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

  let sku;
  if (state.productType === "variable") {
    const prefix = document.getElementById("sku_prefix")?.value || "?";
    const segs = [];
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById(`sku_s${i}`);
      if (el) segs.push(el.value || "?");
    }
    const seq = document.getElementById("sku_seq")?.value || "?";
    sku = [prefix, ...segs, seq].filter(Boolean).join("-").toUpperCase();
  } else {
    sku = getCurrentSku();
  }

  const name = document.getElementById("fName")?.value?.trim();
  const base = document.getElementById("fBaseUnit")?.value?.trim();

  if (!sku || sku.includes("?")) {
    showToast("กรุณากรอก SKU ให้ครบ", "error");
    return;
  }
  if (sku.length > 50) {
    showToast(`SKU ยาวเกินไป (${sku.length} ตัว)`, "error");
    return;
  }
  if (!name) {
    showToast("กรุณากรอกชื่อสินค้า", "error");
    return;
  }
  if (!base) {
    showToast("กรุณากรอกหน่วยฐาน", "error");
    return;
  }

  const isDup = state.allProducts.some(
    (p) =>
      p.product_code === sku && String(p.product_id) !== String(state.editId),
  );
  if (isDup) {
    showToast("รหัสสินค้า (SKU) ซ้ำกับที่มีอยู่แล้ว!", "error");
    return;
  }

  if (state.productType === "variable") {
    const activeVariants = state.variants.filter(
      (v) => v.enabled && v.variantLabel,
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

    if (state.productType === "variable") {
      const f1 = document.getElementById("sku_prefix")?.value || "?";
      const seq = document.getElementById("sku_seq")?.value || "?";

      // อ่าน segments พร้อม locked flag ตามลำดับจริง
      const skuLabelsSave =
        typeof state.category?.sku_labels === "string"
          ? tryParseJson(state.category.sku_labels)
          : state.category?.sku_labels || {};
      const segDefsSave = skuLabelsSave.segments || [];
      const segCountSave = Math.min(segDefsSave.length, 5);
      const allSegObjsSave = [];
      for (let i = 0; i < segCountSave; i++) {
        const el = document.getElementById(`sku_s${i}`);
        if (!el) continue;
        allSegObjsSave.push({
          value: el.value || "?",
          locked: !!segDefsSave[i]?.locked,
        });
      }

      // helper: สร้าง SKU จาก variantLabel ตาม locked flag จริง
      function buildVariantSku(label, vSeq) {
        const parts = [f1];
        allSegObjsSave.forEach((seg) => {
          parts.push(seg.locked ? seg.value : label);
        });
        parts.push(vSeq || seq);
        return parts.join("-").toUpperCase();
      }

      // sync variant labels from DOM
      const variantInputs = document.querySelectorAll(".variant-label-input");
      state.variants.forEach((v, vi) => {
        if (variantInputs[vi]) {
          const label = variantInputs[vi].value.trim().toUpperCase();
          if (label) {
            state.variants[vi].variantLabel = label;
            state.variants[vi].sku = buildVariantSku(label, v.seq || seq);
          }
        }
      });

      // parent variant — ค่าจาก editable segment แรกใน SKU Builder
      const editableSegSave = allSegObjsSave.find((s) => !s.locked);
      const parentVariantLabel = (editableSegSave?.value || "").toUpperCase();
      const parentSku = buildVariantSku(parentVariantLabel, seq);
      const alreadyHasParent = state.variants.some(
        (v) => v.variantLabel.toUpperCase() === parentVariantLabel,
      );
      if (
        parentVariantLabel &&
        parentVariantLabel !== "?" &&
        !alreadyHasParent
      ) {
        state.variants.unshift({
          enabled: true,
          variantLabel: parentVariantLabel,
          sku: parentSku,
          seq,
          cost: parseFloat(document.getElementById("parentCost")?.value) || 0,
          sale: parseFloat(document.getElementById("parentSale")?.value) || 0,
        });
      }

      for (const v of state.variants.filter(
        (v) => v.enabled && v.variantLabel,
      )) {
        if (!state.allProducts.find((p) => p.product_code === v.sku)) {
          const vPayload = {
            product_code: v.sku,
            product_name: `${name} (${v.variantLabel})`,
            category_id: state.category.category_id,
            base_unit: base,
            cost_price:
              v.cost ||
              parseFloat(document.getElementById("parentCost")?.value) ||
              0,
            sale_price:
              v.sale ||
              parseFloat(document.getElementById("parentSale")?.value) ||
              0,
            reorder_point: reorderPoint,
          };
          const res = await supabaseFetch("products", {
            method: "POST",
            body: vPayload,
          });
          const variantId = res[0].product_id;
          for (const div of document.querySelectorAll('[id^="unit-row-"]')) {
            const rowId = div.id.replace("unit-row-", "");
            const uname = document
              .getElementById(`uname-${rowId}`)
              ?.value?.trim();
            const uconv =
              parseFloat(document.getElementById(`uconv-${rowId}`)?.value) || 1;
            const ubase =
              document.getElementById(`ubase-${rowId}`)?.checked || false;
            if (uname)
              await supabaseFetch("product_units", {
                method: "POST",
                body: {
                  product_id: variantId,
                  unit_name: uname,
                  conversion_qty: uconv,
                  is_base_unit: ubase,
                },
              });
          }
          await uploadProductImages(variantId);
        }
      }
    } else {
      const payload = {
        product_code: sku,
        product_name: name,
        category_id: state.category.category_id,
        base_unit: base,
        reorder_point: reorderPoint,
        cost_price: parseFloat(document.getElementById("fCost")?.value) || 0,
        sale_price: parseFloat(document.getElementById("fSale")?.value) || 0,
      };
      let productId;
      if (state.editId) {
        await supabaseFetch("products", {
          method: "PATCH",
          body: payload,
          query: `?product_id=eq.${state.editId}`,
        });
        productId = parseInt(state.editId);
      } else {
        const res = await supabaseFetch("products", {
          method: "POST",
          body: payload,
        });
        productId = res[0].product_id;
      }
      await supabaseFetch("product_units", {
        method: "DELETE",
        query: `?product_id=eq.${productId}`,
      }).catch(() => {});
      for (const div of document.querySelectorAll('[id^="unit-row-"]')) {
        const rowId = div.id.replace("unit-row-", "");
        const uname = document.getElementById(`uname-${rowId}`)?.value?.trim();
        const uconv =
          parseFloat(document.getElementById(`uconv-${rowId}`)?.value) || 1;
        const ubase =
          document.getElementById(`ubase-${rowId}`)?.checked || false;
        if (uname)
          await supabaseFetch("product_units", {
            method: "POST",
            body: {
              product_id: productId,
              unit_name: uname,
              conversion_qty: uconv,
              is_base_unit: ubase,
            },
          });
      }
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
    const catSel = document.getElementById("fCategory");
    if (catSel) {
      catSel.value = p.category_id;
      onCategoryChange();
    }
    selectProductType(p.product_type === "variable" ? "variable" : "single");
    const parts = (p.product_code || "").split("-");
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById(`sku_s${i}`);
      if (el) el.value = parts[i + 1] || "";
    }
    updateSkuPreview();
    document.getElementById("fName").value = p.product_name || "";
    document.getElementById("fBaseUnit").value = p.base_unit || "";
    document.getElementById("fReorder").value = p.reorder_point || "";
    document.getElementById("fCost").value = p.cost_price || "";
    document.getElementById("fSale").value = p.sale_price || "";
    const unitsContainer = document.getElementById("unitsContainer");
    if (unitsContainer) {
      unitsContainer.innerHTML = "";
      state.unitRowCount = 0;
      const prodUnits = state.units.filter(
        (u) => u.product_id === parseInt(id),
      );
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
function enableCategoryDrag() {
  const grid = document.getElementById("categoryCardGrid");
  if (!grid) return;
  let dragEl = null;
  grid.querySelectorAll(".cat-card").forEach((card) => {
    card.draggable = true;
    card.addEventListener("dragstart", () => {
      dragEl = card;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      saveCategoryOrder();
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      const after = getDragAfterElement(grid, e.clientX);
      if (after == null) grid.appendChild(dragEl);
      else grid.insertBefore(dragEl, after);
    });
  });
}

function getDragAfterElement(container, x) {
  const els = [...container.querySelectorAll(".cat-card:not(.dragging)")];
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
  const grid = document.getElementById("categoryCardGrid");
  if (!grid) return;
  const cards = [...grid.querySelectorAll(".cat-card")];
  for (let i = 0; i < cards.length; i++) {
    const id = cards[i].dataset.catId;
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
