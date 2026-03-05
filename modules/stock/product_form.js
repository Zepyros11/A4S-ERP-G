/* ============================================================
   product_form.js — A4S-ERP Product Form Logic
   ============================================================ */

// ── STATE ──────────────────────────────────────────────────
let SUPABASE_URL = localStorage.getItem("sb_url") || "";
let SUPABASE_KEY = localStorage.getItem("sb_key") || "";

const state = {
  mode: "new", // 'new' | 'edit'
  editId: null,
  productType: null, // 'single' | 'variable'
  category: null, // selected category object
  categories: [],
  allProducts: [],
  units: [],
  unitRowCount: 0,

  // Variant state
  variantMode: "list", // 'matrix' | 'list'
  attributes: [], // [{ label, values: [] }]
  variants: [], // [{ enabled, attrs, sku, name, cost, sale }]
};

// ── SUPABASE ───────────────────────────────────────────────
async function supabaseFetch(table, options = {}) {
  const { method = "GET", body, query = "" } = options;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST"
          ? "return=representation"
          : method === "PATCH"
            ? "return=representation"
            : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.message || "Error");
  }
  return method === "GET" ? res.json() : res.json().catch(() => null);
}

// ── INIT ───────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(location.search);
  state.mode = params.has("id") ? "edit" : "new";
  state.editId = params.get("id");

  updatePageTitle();

  if (SUPABASE_URL && SUPABASE_KEY) {
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
      supabaseFetch("categories", { query: "?select=*&order=category_name" }),
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
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── STEP NAVIGATION ───────────────────────────────────────
function goToStep(step) {
  // อัปเดต active step ใน sidebar (เฉพาะที่ไม่ซ่อน)
  document.querySelectorAll(".pf-step").forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle("active", s === step);
  });

  // แสดง sections ถึง step ปัจจุบัน
  document.querySelectorAll(".pf-section[data-step]").forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.style.display = s <= step ? "" : "none";
  });

  updateSidebarProgress(step);
  // Scroll to section
  const target = document.querySelector(`.pf-section[data-step="${step}"]`);
  if (target)
    setTimeout(
      () => target.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
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
  // sync hidden select
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

  // render category cards
  const grid = document.getElementById("categoryCardGrid");
  if (!grid) return;
  if (state.categories.length === 0) {
    grid.innerHTML = '<div class="cat-card-empty">ยังไม่มีหมวดหมู่ในระบบ</div>';
    return;
  }
  grid.innerHTML = state.categories
    .map(
      (c) => `
    <div class="cat-card" data-cat-id="${c.category_id}" onclick="selectCategoryCard(${c.category_id})">
      <div class="cat-card-icon">${c.icon || "📦"}</div>
      <div class="cat-card-name">${c.category_name}</div>
    </div>
  `,
    )
    .join("");
}

function selectCategoryCard(catId) {
  // อัปเดต card UI
  document.querySelectorAll(".cat-card").forEach((el) => {
    el.classList.toggle("selected", parseInt(el.dataset.catId) === catId);
  });
  // sync hidden select แล้วเรียก onCategoryChange
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

  if (!state.category) {
    updateSummary();
    return;
  }

  // Update summary
  updateSummary();

  // Show type selector section
  showSection(2);
  updateSidebarProgress(2);
  goToStep(2);

  // Update step 2 header badge
  const badge = document.getElementById("catBadge");
  if (badge) {
    badge.textContent =
      (state.category.icon || "") + " " + state.category.category_name;
    badge.style.display = "inline-flex";
  }
}

// ── PRODUCT TYPE SELECTION ────────────────────────────────
function selectProductType(type) {
  state.productType = type;
  const isVariable = type === "variable";

  // Update type-card UI
  document.querySelectorAll(".type-card").forEach((el) => {
    el.classList.toggle("selected", el.dataset.type === type);
  });

  // Content sections
  showSection(3);
  showSection(4);

  // แสดง/ซ่อน variant SKU section ใน step 3
  const varSkuSec = document.getElementById("variantSkuSection");
  if (varSkuSec) varSkuSec.style.display = isVariable ? "" : "none";

  // แสดง/ซ่อน price section ใน step 3 (สินค้าเดี่ยว)
  const singlePriceSec = document.getElementById("singlePriceSection");
  const parentPriceSec = document.getElementById("parentPriceSection");
  if (singlePriceSec) singlePriceSec.style.display = isVariable ? "none" : "";
  if (parentPriceSec) parentPriceSec.style.display = isVariable ? "" : "none";

  // label step 3
  const skuBuilderLabel = document.getElementById("skuBuilderLabel");
  if (skuBuilderLabel)
    skuBuilderLabel.textContent = isVariable
      ? "SKU หลัก (Parent)"
      : "SKU สินค้า";

  // step 4 title
  const s4title = document.querySelector(
    '.pf-section[data-step="4"] .pf-section-title',
  );
  if (s4title) s4title.textContent = "Step 4 — ข้อมูลสินค้า";

  // reset variant sku rows
  if (isVariable) {
    state.variants = [];
    renderVariantSkuRows();
  }

  // Reset SKU builder
  buildSkuFields();

  // Reset unit rows
  state.unitRowCount = 0;
  const unitsContainer = document.getElementById("unitsContainer");
  if (unitsContainer) {
    unitsContainer.innerHTML = "";
    addUnitRow({ unit_name: "", conversion_qty: 1, is_base_unit: true });
  }

  // Reset variants
  if (isVariable) {
    state.attributes = [];
    state.variants = [];
    renderVariantSkuRows();
  }

  // Sidebar step 2 sub-label
  const stepSubEl = document.querySelector(
    '.pf-step[data-step="2"] .pf-step-sub',
  );
  if (stepSubEl)
    stepSubEl.textContent = isVariable ? "สินค้าชุด" : "สินค้าเดี่ยว";

  updateSidebarProgress(3);
  goToStep(3);
  updateSummary();
}

// ── SKU BUILDER ───────────────────────────────────────────
function buildSkuFields() {
  if (!state.category) return;
  const cat = state.category;

  // ดึงค่าจาก sku_labels object (โครงสร้างจริงใน DB)
  const skuLabels =
    typeof cat.sku_labels === "string"
      ? tryParseJson(cat.sku_labels)
      : cat.sku_labels || {};

  const prefix =
    skuLabels.prefix ||
    cat.sku_prefix ||
    cat.category_code ||
    cat.category_name?.substring(0, 3).toUpperCase() ||
    "XXX";
  const catColor = cat.color || "#0f4c75";

  // Label ของแต่ละช่อง
  const lbl = {
    l2: skuLabels.l2 || cat.sku_label2 || "ช่อง 2",
    l3: skuLabels.l3 || cat.sku_label3 || "ช่อง 3",
    l4: skuLabels.l4 || cat.sku_label4 || "ช่อง 4",
  };

  // Options: ดึงจาก products เดิมในหมวดเดียวกัน (เหมือน products.html)
  const catProds = state.allProducts.filter(
    (p) => p.category_id === cat.category_id,
  );
  function extractPart(idx) {
    const vals = new Set();
    catProds.forEach((p) => {
      const parts = (p.product_code || "").split("-");
      if (parts[idx]) vals.add(parts[idx].trim());
    });
    return [...vals].filter(Boolean).sort();
  }
  const skuOptions = {
    f2: extractPart(1),
    f3: extractPart(2),
    f4: extractPart(3),
  };

  const seq = autoSeq(cat.category_id);

  const grid = document.getElementById("skuFieldsGrid");
  if (!grid) return;

  // คำนวณ readable text color จาก catColor (ถ้าสีเข้มใช้ขาว ถ้าสีอ่อนใช้ดำ)
  const textOnCat = isColorDark(catColor) ? "#fff" : "#111827";

  grid.innerHTML = `
    <!-- ช่อง 1: PREFIX (readonly) -->
    <div style="min-width:0;">
      <div class="sku-field-label">PREFIX <span class="sku-field-tag tag-fix">FIX</span></div>
      <input id="sku_f1" class="form-control" value="${prefix}" readonly
        style="font-family:monospace;font-size:13px;font-weight:700;text-align:center;width:100%;
        background:${catColor}22;color:${catColor};border-color:${catColor}66;">
    </div>

    <!-- ช่อง 2 -->
    <div style="min-width:0;">
      <div class="sku-field-label">${lbl.l2}</div>
      <input id="sku_f2" class="form-control" placeholder="ค่า"
        list="lst_f2" style="font-family:monospace;text-transform:uppercase;text-align:center;width:100%;"
        oninput="this.value=this.value.toUpperCase();updateSkuPreview()">
      <datalist id="lst_f2">${skuOptions.f2.map((v) => `<option value="${v}">`).join("")}</datalist>
    </div>

    <!-- ช่อง 3 -->
    <div style="min-width:0;">
      <div class="sku-field-label">${lbl.l3}</div>
      <input id="sku_f3" class="form-control" placeholder="ค่า"
        list="lst_f3" style="font-family:monospace;text-transform:uppercase;text-align:center;width:100%;"
        oninput="this.value=this.value.toUpperCase();updateSkuPreview()">
      <datalist id="lst_f3">${skuOptions.f3.map((v) => `<option value="${v}">`).join("")}</datalist>
    </div>

    <!-- ช่อง 4 -->
    <div style="min-width:0;">
      <div class="sku-field-label">${lbl.l4}</div>
      <input id="sku_f4" class="form-control" placeholder="ค่า"
        list="lst_f4" style="font-family:monospace;text-transform:uppercase;text-align:center;width:100%;"
        oninput="this.value=this.value.toUpperCase();updateSkuPreview()">
      <datalist id="lst_f4">${skuOptions.f4.map((v) => `<option value="${v}">`).join("")}</datalist>
    </div>

    <!-- ช่อง 5: ลำดับ -->
    <div style="min-width:0;">
      <div class="sku-field-label">ลำดับ <span class="sku-field-tag tag-auto">AUTO</span></div>
      <input id="sku_f5" class="form-control" value="${seq}"
        style="font-family:monospace;font-size:13px;font-weight:700;text-align:center;
        width:100%;background:var(--surface2);"
        oninput="updateSkuPreview()">
    </div>
  `;

  updateSkuPreview();
}

function tryParseOptions(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function tryParseJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isColorDark(hex) {
  const c = hex.replace("#", "");
  if (c.length < 6) return false;
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function autoSeq(catId) {
  // หาเลข sequence ที่ยังไม่ถูกใช้ใน DB จริง
  // โดยดูจาก part สุดท้ายของ product_code ในหมวดเดียวกัน
  const catProds = state.allProducts.filter((p) => p.category_id === catId);
  const usedSeqs = new Set(
    catProds.map((p) => {
      const parts = (p.product_code || "").split("-");
      const last = parts[parts.length - 1];
      return parseInt(last) || 0;
    }),
  );
  let seq = 1;
  while (usedSeqs.has(seq)) seq++;
  return String(seq).padStart(3, "0");
}

function updateSkuPreview() {
  const parts = ["f1", "f2", "f3", "f4", "f5"].map((k) => {
    const el = document.getElementById("sku_" + k);
    return el ? (el.value || "?").toUpperCase() : "?";
  });
  const sku = parts.join("-");

  // อัปเดต preview bar
  const preview = document.getElementById("skuPreviewVal");
  if (preview) preview.textContent = sku;

  // เช็ค SKU ซ้ำ
  const dupWarn = document.getElementById("skuDupWarn");
  if (dupWarn) {
    const isDup = state.allProducts.some(
      (p) =>
        p.product_code === sku && String(p.product_id) !== String(state.editId),
    );
    dupWarn.style.display = isDup ? "block" : "none";
  }

  // unlock step 4 และ 5 เมื่อ SKU ครบ โดยไม่ scroll
  if (!sku.includes("?") && sku.length > 4) {
    showSection(4);
    showSection(5);
    updateSidebarProgress(4);
  }

  // Re-render variant rows เมื่อ parent SKU เปลี่ยน
  if (state.productType === "variable" && state.variants.length > 0) {
    renderVariantSkuRows();
  }

  updateSummary();
  return sku;
}

function getCurrentSku() {
  // สำหรับ variable product: parent SKU ไม่รวม f4 (ช่อง f4 ใช้เป็น variant suffix)
  if (state.productType === "variable") {
    const f1 = document.getElementById("sku_f1")?.value || "?";
    const f2 = document.getElementById("sku_f2")?.value || "?";
    const f3 = document.getElementById("sku_f3")?.value || "?";
    const f5 = document.getElementById("sku_f5")?.value || "?";
    return [f1, f2, f3, f5].filter(Boolean).join("-").toUpperCase();
  }
  return document.getElementById("skuPreviewVal")?.textContent?.trim() || "";
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
        : `
    <button onclick="removeUnitRow(${id})"
      style="width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;
      color:var(--text3);font-size:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;"
      title="ลบ">✕</button>`
    }
  `;
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

// ── VARIANT: ATTRIBUTES ───────────────────────────────────
function setVariantMode(mode) {
  state.variantMode = mode;
  document.querySelectorAll(".vtoggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  renderVariantUI();
}

function renderAttributeInputs() {
  const container = document.getElementById("attrContainer");
  if (!container) return;

  // Default attributes from category if not set
  if (state.attributes.length === 0 && state.category) {
    const defaultAttrs = [];
    if (state.category.sku_label2)
      defaultAttrs.push({ label: state.category.sku_label2, values: [] });
    if (state.category.sku_label3)
      defaultAttrs.push({ label: state.category.sku_label3, values: [] });
    if (defaultAttrs.length > 0) state.attributes = defaultAttrs;
    else state.attributes = [{ label: "ตัวเลือก", values: [] }];
  }

  container.innerHTML = state.attributes
    .map(
      (attr, ai) => `
    <div class="attr-section">
      <div class="attr-header">
        <input class="form-control" value="${attr.label}" placeholder="ชื่อ Attribute เช่น สี, ไซส์"
          style="font-size:13px;font-weight:600;max-width:160px;"
          oninput="updateAttrLabel(${ai}, this.value)">
        <button class="btn btn-outline" style="padding:5px 10px;font-size:12px;"
          onclick="addAttribute()" title="เพิ่ม Attribute">＋ เพิ่ม</button>
        ${
          ai > 0
            ? `<button class="btn" style="padding:5px 10px;font-size:12px;color:var(--danger);background:var(--danger-pale);"
          onclick="removeAttribute(${ai})">✕ ลบ</button>`
            : ""
        }
      </div>
      <div class="attr-tags" id="attr-tags-${ai}" onclick="focusAttrInput(${ai})">
        ${attr.values
          .map(
            (v, vi) => `
          <span class="attr-tag">${v}
            <button class="attr-tag-del" onclick="removeAttrValue(${ai},${vi})">✕</button>
          </span>`,
          )
          .join("")}
        <input class="attr-tag-input" id="attr-input-${ai}"
          placeholder="${attr.values.length === 0 ? "พิมพ์แล้วกด Enter..." : "+"}"
          onkeydown="onAttrKeydown(event, ${ai})">
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">
        พิมพ์ค่าแล้วกด Enter หรือ , เพื่อเพิ่ม
        ${
          tryParseOptions(state.category?.[`sku_options${ai + 2}`]).length > 0
            ? `<span style="margin-left:8px;">Preset: ${tryParseOptions(
                state.category?.[`sku_options${ai + 2}`],
              )
                .map(
                  (v) => `
            <button onclick="addAttrPreset(${ai},'${v}')" style="border:1px solid var(--border);background:var(--surface2);
              padding:1px 6px;border-radius:4px;font-size:11px;cursor:pointer;margin-right:2px;">${v}</button>`,
                )
                .join("")}</span>`
            : ""
        }
      </div>
    </div>
  `,
    )
    .join("");
}

function focusAttrInput(ai) {
  document.getElementById(`attr-input-${ai}`)?.focus();
}

function onAttrKeydown(e, ai) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,/g, "").toUpperCase();
    if (val) addAttrValue(ai, val);
    e.target.value = "";
  }
  if (e.key === "Backspace" && !e.target.value) {
    const vals = state.attributes[ai].values;
    if (vals.length > 0) {
      vals.splice(vals.length - 1, 1);
      renderAttributeInputs();
    }
  }
}

function addAttrValue(ai, val) {
  if (!state.attributes[ai].values.includes(val)) {
    state.attributes[ai].values.push(val);
    renderAttributeInputs();
  }
}

function addAttrPreset(ai, val) {
  addAttrValue(ai, val.toUpperCase());
}

function removeAttrValue(ai, vi) {
  state.attributes[ai].values.splice(vi, 1);
  renderAttributeInputs();
}

function updateAttrLabel(ai, val) {
  state.attributes[ai].label = val;
}

function addAttribute() {
  state.attributes.push({
    label: "ตัวเลือก " + (state.attributes.length + 1),
    values: [],
  });
  renderAttributeInputs();
}

function removeAttribute(ai) {
  state.attributes.splice(ai, 1);
  renderAttributeInputs();
}

// ── VARIANT: GENERATE ─────────────────────────────────────
function generateVariants() {
  const parentSku = getCurrentSku();
  if (parentSku.includes("?")) {
    showToast("กรุณากรอก SKU ให้ครบก่อน", "warning");
    return;
  }

  const attrs = state.attributes.filter((a) => a.values.length > 0);
  if (attrs.length === 0) {
    showToast("กรุณาเพิ่มค่า Attribute อย่างน้อย 1 ค่า", "warning");
    return;
  }

  if (state.variantMode === "matrix") {
    state.variants = generateMatrix(attrs, parentSku);
  } else {
    // List mode: gen from first attribute only (or all combined)
    state.variants = generateList(attrs, parentSku);
  }

  renderVariantTable();
  showToast(`✅ สร้าง ${state.variants.length} variants แล้ว`, "success");
}

function generateMatrix(attrs, parentSku) {
  // Cartesian product of all attribute values
  let combos = [[]];
  attrs.forEach((attr) => {
    const newCombos = [];
    combos.forEach((combo) => {
      attr.values.forEach((val) =>
        newCombos.push([...combo, { label: attr.label, val }]),
      );
    });
    combos = newCombos;
  });

  return combos.map((combo) => {
    const attrStr = combo.map((c) => c.val).join("-");
    return {
      enabled: true,
      attrs: combo,
      sku: `${parentSku}-${attrStr}`,
      name: combo.map((c) => c.val).join(" / "),
      cost: parseFloat(document.getElementById("fCost")?.value) || 0,
      sale: parseFloat(document.getElementById("fSale")?.value) || 0,
    };
  });
}

function generateList(attrs, parentSku) {
  // All attrs flattened into individual rows (for trophy/bow style)
  const rows = [];
  attrs.forEach((attr) => {
    attr.values.forEach((val) => {
      rows.push({
        enabled: true,
        attrs: [{ label: attr.label, val }],
        sku: `${parentSku}-${val}`,
        name: val,
        cost: parseFloat(document.getElementById("fCost")?.value) || 0,
        sale: parseFloat(document.getElementById("fSale")?.value) || 0,
      });
    });
  });
  return rows;
}

function addVariantRow() {
  state.variants.push({
    enabled: true,
    attrs: [],
    sku: getCurrentSku() + "-",
    name: "",
    cost: parseFloat(document.getElementById("fCost")?.value) || 0,
    sale: parseFloat(document.getElementById("fSale")?.value) || 0,
  });
  renderVariantTable();
}

// ── VARIANT: RENDER TABLE ─────────────────────────────────
function renderVariantTable() {
  const container = document.getElementById("variantTableContainer");
  if (!container) return;

  if (state.variants.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);">
        <div style="font-size:28px;margin-bottom:8px;">📋</div>
        <div style="font-size:13px;">ยังไม่มี Variant — กด "สร้าง Variants" เพื่อ Generate</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="variant-table-wrap">
      <table class="variant-table">
        <thead>
          <tr>
            <th style="width:40px;text-align:center;">
              <input type="checkbox" checked onchange="toggleAllVariants(this.checked)" title="เลือกทั้งหมด">
            </th>
            <th style="min-width:180px;">SKU</th>
            <th>ชื่อ / Variant</th>
            ${state.attributes.map((a) => `<th>${a.label}</th>`).join("")}
            <th style="width:110px;">ราคาทุน (฿)</th>
            <th style="width:110px;">ราคาขาย (฿)</th>
            <th style="width:40px;"></th>
          </tr>
        </thead>
        <tbody>
          ${state.variants
            .map(
              (v, vi) => `
            <tr class="${!v.enabled ? "disabled" : ""}">
              <td style="text-align:center;">
                <input type="checkbox" class="vt-toggle" ${v.enabled ? "checked" : ""}
                  onchange="toggleVariant(${vi}, this.checked)">
              </td>
              <td>
                <input class="vt-input vt-sku" value="${v.sku}"
                  style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--accent);"
                  oninput="updateVariantField(${vi},'sku',this.value)">
              </td>
              <td>
                <input class="vt-input" value="${v.name}" placeholder="ชื่อ variant"
                  oninput="updateVariantField(${vi},'name',this.value)">
              </td>
              ${state.attributes
                .map((a, ai) => {
                  const found = v.attrs.find((x) => x.label === a.label);
                  return `<td><span class="vt-attr-badge">${found?.val || "—"}</span></td>`;
                })
                .join("")}
              <td>
                <input class="vt-input" type="number" min="0" step="0.01" value="${v.cost}"
                  oninput="updateVariantField(${vi},'cost',parseFloat(this.value)||0)"
                  style="text-align:right;">
              </td>
              <td>
                <input class="vt-input" type="number" min="0" step="0.01" value="${v.sale}"
                  oninput="updateVariantField(${vi},'sale',parseFloat(this.value)||0)"
                  style="text-align:right;">
              </td>
              <td>
                <button onclick="removeVariant(${vi})"
                  style="width:28px;height:28px;border:none;background:var(--danger-pale);color:var(--danger);
                  border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">
                  ✕
                </button>
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
      <div style="font-size:12px;color:var(--text3);">
        รวม <strong style="color:var(--text)">${state.variants.filter((v) => v.enabled).length}</strong> 
        จาก ${state.variants.length} variants จะถูกบันทึก
      </div>
      <button class="btn btn-outline" style="font-size:12px;" onclick="addVariantRow()">＋ เพิ่มแถว</button>
    </div>
  `;

  updateSummary();
}

function renderVariantUI() {
  const modeLabel =
    state.variantMode === "matrix"
      ? "Matrix (ผสม Attribute)"
      : "List (ทีละแถว)";
  const modeDesc =
    state.variantMode === "matrix"
      ? "ระบบจะ Auto-generate ทุก combination ของ Attribute ที่เลือก"
      : "เพิ่ม Variant ทีละรายการ เหมาะกับสินค้าที่แต่ละ Variant ไม่ผสมกัน";

  const descEl = document.getElementById("variantModeDesc");
  if (descEl) descEl.textContent = modeDesc;
  renderAttributeInputs();
  renderVariantTable();
}

function toggleVariant(vi, enabled) {
  state.variants[vi].enabled = enabled;
  const row = document.querySelectorAll(".variant-table tbody tr")[vi];
  if (row) row.classList.toggle("disabled", !enabled);
  updateSummary();
}

function toggleAllVariants(enabled) {
  state.variants.forEach((v) => (v.enabled = enabled));
  renderVariantTable();
}

function updateVariantField(vi, field, value) {
  state.variants[vi][field] = value;
}

function removeVariant(vi) {
  state.variants.splice(vi, 1);
  renderVariantSkuRows();
  renderVariantTable();
}

// ── VARIANT SKU ROWS (in Step 3) ─────────────────────────
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
  const f4Label = skuLabels.l4 || cat?.sku_label4 || "ตัวเลือก";

  state.variants.push({
    enabled: true,
    sku: "",
    variantLabel: "",
    cost: parseFloat(document.getElementById("fCost")?.value) || 0,
    sale: parseFloat(document.getElementById("fSale")?.value) || 0,
    _f4Label: f4Label,
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
  const f4Label = skuLabels.l4 || cat?.sku_label4 || "ตัวเลือก";

  // Get current parent SKU parts
  const f1Val = document.getElementById("sku_f1")?.value || "???";
  const f2Val = document.getElementById("sku_f2")?.value || "?";
  const f3Val = document.getElementById("sku_f3")?.value || "?";
  const f4Val = document.getElementById("sku_f4")?.value || "";
  const f5Val = document.getElementById("sku_f5")?.value || "?";
  const lbl2 = skuLabels.l2 || cat?.sku_label2 || "ช่อง 2";
  const lbl3 = skuLabels.l3 || cat?.sku_label3 || "ช่อง 3";
  const catColor = cat?.color || "#0f4c75";

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
      // auto-gen sku
      // Format: [PREFIX]-[f2]-[f3]-[variantLabel]-[f5]
      const varSuffix = v.variantLabel ? v.variantLabel.toUpperCase() : "?";
      const autoSku = [f1Val, f2Val, f3Val, varSuffix, f5Val]
        .filter(Boolean)
        .join("-");
      state.variants[vi].sku = autoSku;

      return `
    <div style="background:var(--surface2);border:1.5px solid var(--border);
      border-radius:10px;padding:12px 14px;margin-bottom:10px;transition:border-color .15s;"
      onmouseover="this.style.borderColor='var(--border2)'"
      onmouseout="this.style.borderColor='var(--border)'">

      <!-- SKU Fields Row: flex, ปุ่ม ✕ อยู่ท้ายสุด -->
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:8px;">

        <!-- ช่อง 1: PREFIX -->
        <div style="width:90px;flex-shrink:0;">
          <div style="font-size:14px;font-weight:700;color:var(--text3);letter-spacing:.4px;margin-bottom:3px;">
            PREFIX <span style="font-size:9px;background:${catColor}22;color:${catColor};padding:1px 4px;border-radius:3px;">FIX</span>
          </div>
          <input class="form-control" value="${f1Val}" readonly
            style="width:100%;font-family:monospace;font-size:12px;font-weight:700;text-align:center;
            background:${catColor}22;color:${catColor};border-color:${catColor}44;cursor:not-allowed;">
        </div>

        <!-- ช่อง 2 -->
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:var(--text3);letter-spacing:.4px;margin-bottom:3px;">
            ${lbl2}
          </div>
          <input class="form-control" value="${f2Val}" readonly
            style="width:100%;font-family:monospace;font-size:12px;text-align:center;
            background:var(--surface3,#f3f4f6);color:var(--text2);cursor:not-allowed;">
        </div>

        <!-- ช่อง 3 -->
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:var(--text3);letter-spacing:.4px;margin-bottom:3px;">
            ${lbl3}
          </div>
          <input class="form-control" value="${f3Val}" readonly
            style="width:100%;font-family:monospace;font-size:12px;text-align:center;
            background:var(--surface3,#f3f4f6);color:var(--text2);cursor:not-allowed;">
        </div>

        <!-- ช่อง 4: กรอก -->
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:var(--accent);letter-spacing:.4px;margin-bottom:3px;">
            ${f4Label} 
          </div>
          <input class="form-control variant-label-input" value="${v.variantLabel}"
            placeholder="เช่น RED, S"
            style="width:100%;font-family:monospace;text-transform:uppercase;font-weight:700;
              font-size:13px;color:var(--accent);text-align:center;
              border-color:var(--accent);background:var(--accent-pale);"
            oninput="updateVariantSkuLabel(${vi}, this.value)">
        </div>

        <!-- ช่อง ลำดับ -->
        <div style="width:80px;flex-shrink:0;">
          <div style="font-size:14px;font-weight:700;color:var(--text3);letter-spacing:.4px;margin-bottom:3px;">
            ลำดับ
          </div>
          <input class="form-control" value="${f5Val}" readonly
            style="width:100%;font-family:monospace;font-size:12px;text-align:center;
            background:var(--surface3,#f3f4f6);color:var(--text2);cursor:not-allowed;">
        </div>

        <!-- ปุ่ม ✕ -->
        <button onclick="removeVariant(${vi})"
          style="width:32px;height:32px;flex-shrink:0;border:none;background:var(--danger-pale);
          color:var(--danger);border-radius:6px;cursor:pointer;font-size:13px;
          display:flex;align-items:center;justify-content:center;">✕</button>

      </div>

      <!-- SKU Preview + ราคา -->
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="font-size:11px;color:var(--text3);">
          SKU: <span id="vsku-preview-${vi}" style="font-family:monospace;font-weight:700;color:var(--accent);
            background:var(--accent-pale);padding:2px 8px;border-radius:4px;">${autoSku}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
          <div style="font-size:11px;color:var(--text3);">ราคาทุน:</div>
          <input class="form-control" type="number" min="0" step="0.01" value="${v.cost}"
            placeholder="0.00" style="width:90px;font-family:monospace;text-align:right;font-size:12px;"
            oninput="updateVariantField(${vi},'cost',parseFloat(this.value)||0)">
          <div style="font-size:11px;color:var(--text3);">ราคาขาย:</div>
          <input class="form-control" type="number" min="0" step="0.01" value="${v.sale}"
            placeholder="0.00" style="width:90px;font-family:monospace;text-align:right;font-size:12px;color:var(--accent);"
            oninput="updateVariantField(${vi},'sale',parseFloat(this.value)||0)">
        </div>
      </div>
    </div>`;
    })
    .join("");

  updateSummary();
}

function updateVariantSkuLabel(vi, val) {
  state.variants[vi].variantLabel = val.toUpperCase();
  const f1 = document.getElementById("sku_f1")?.value || "?";
  const f2 = document.getElementById("sku_f2")?.value || "?";
  const f3 = document.getElementById("sku_f3")?.value || "?";
  const f5 = document.getElementById("sku_f5")?.value || "?";
  const suffix = val ? val.toUpperCase() : "?";
  // Format: [PREFIX]-[f2]-[f3]-[variantLabel]-[f5]
  state.variants[vi].sku = [f1, f2, f3, suffix, f5].filter(Boolean).join("-");
  const previewEl = document.getElementById(`vsku-preview-${vi}`);
  if (previewEl) previewEl.textContent = state.variants[vi].sku;
  updateSummary();
}

// ── SECTION VISIBILITY ────────────────────────────────────
function showSection(step) {
  const el = document.querySelector(`.pf-section[data-step="${step}"]`);
  if (el) el.style.display = "";
}

// ── SUMMARY SIDEBAR ───────────────────────────────────────
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

  // ── update save bar ──
  const barName = document.getElementById("saveBarName");
  const barSku = document.getElementById("saveBarSku");
  const name = document.getElementById("fName")?.value || "";
  if (barName) barName.textContent = name || "—";

  if (barSku) {
    if (state.productType === "variable" && state.variants.length > 0) {
      // แสดง SKU ของทุก variant คั่นด้วย " · "
      const skuList = state.variants
        .filter((v) => v.enabled)
        .map((v) => {
          const el = document.getElementById(
            `vsku-preview-${state.variants.indexOf(v)}`,
          );
          return el ? el.textContent : v.variantLabel || "?";
        })
        .filter(Boolean);
      barSku.textContent = skuList.length ? skuList.join("  ·  ") : "";
    } else {
      const s = getCurrentSku();
      barSku.textContent = s && s !== "—" ? s : "";
    }
  }
}
/* ══════════════════════════════════════
   STEP 5 — Image Upload
══════════════════════════════════════ */
const IMG_SLOTS = 5;
let imgSlotTarget = null; // index ที่จะ assign รูป
const imgFiles = new Array(IMG_SLOTS).fill(null); // เก็บ File object

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
    const isMain = imgSlotTarget === 0;
    slot.innerHTML = `
      <img src="${ev.target.result}" alt="product-img-${imgSlotTarget}" />
      <div class="img-remove" onclick="removeImg(event, ${imgSlotTarget})">✕</div>
    `;
    if (isMain) slot.classList.add("img-main-badge");
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

// Init grid เมื่อโหลดหน้า
document.addEventListener("DOMContentLoaded", initImgUploadGrid);

// ── UPLOAD IMAGES TO SUPABASE STORAGE ─────────────────────
async function uploadProductImages(productId) {
  const filesToUpload = imgFiles
    .map((file, idx) => ({ file, idx }))
    .filter(({ file }) => file !== null);

  if (filesToUpload.length === 0) return;

  // ลบรูปเก่าของ product นี้ก่อน (กรณี edit)
  await supabaseFetch("product_images", {
    method: "DELETE",
    query: `?product_id=eq.${productId}`,
  }).catch(() => {});

  for (const { file, idx } of filesToUpload) {
    // ถ้าเป็น URL เดิม (edit mode) ให้ re-insert record โดยไม่ต้อง upload ใหม่
    if (file._existingUrl) {
      try {
        await supabaseFetch("product_images", {
          method: "POST",
          body: {
            product_id: productId,
            url: file._existingUrl,
            sort_order: idx,
          },
        });
      } catch (e) {
        console.warn(`Re-insert existing image slot ${idx} failed:`, e.message);
      }
      continue;
    }

    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const fileName = `${productId}_${idx}_${Date.now()}.${ext}`;
      const uploadPath = `products/${fileName}`;

      const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/product-images/${uploadPath}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": file.type,
            "x-upsert": "true",
          },
          body: file,
        },
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${uploadPath}`;

      await supabaseFetch("product_images", {
        method: "POST",
        body: {
          product_id: productId,
          url: publicUrl,
          sort_order: idx,
        },
      });
    } catch (e) {
      console.warn(`Upload image slot ${idx} failed:`, e.message);
      showToast(
        `⚠️ อัปโหลดรูป slot ${idx + 1} ไม่สำเร็จ: ${e.message}`,
        "error",
      );
    }
  }
}

// ── SAVE ──────────────────────────────────────────────────
async function saveProduct() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
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

  // สร้าง parent SKU โดยตรง (ไม่ผ่าน preview element ที่อาจมี f4 ค้างอยู่)
  let sku;
  if (state.productType === "variable") {
    const f1 = document.getElementById("sku_f1")?.value || "?";
    const f2 = document.getElementById("sku_f2")?.value || "?";
    const f3 = document.getElementById("sku_f3")?.value || "?";
    const f5 = document.getElementById("sku_f5")?.value || "?";
    sku = [f1, f2, f3, f5].filter(Boolean).join("-").toUpperCase();
  } else {
    sku = getCurrentSku();
  }
  const name = document.getElementById("fName")?.value?.trim();
  const base = document.getElementById("fBaseUnit")?.value?.trim();

  if (!sku || sku.includes("?")) {
    showToast("กรุณากรอก SKU ให้ครบ", "error");
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

  // Duplicate SKU check
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
      showToast("กรุณาเพิ่มตัวเลือกอย่างน้อย 1 รายการใน Step 3", "error");
      return;
    }
  }

  showLoading(true);
  try {
    const reorderPoint =
      parseFloat(document.getElementById("fReorder")?.value) || 0;

    // ── VARIABLE: บันทึกทุก variant เป็น product แยก ไม่มี parent record ──
    if (state.productType === "variable") {
      const f1 = document.getElementById("sku_f1")?.value || "?";
      const f2 = document.getElementById("sku_f2")?.value || "?";
      const f3 = document.getElementById("sku_f3")?.value || "?";
      const f4 = document.getElementById("sku_f4")?.value?.toUpperCase() || "";
      const f5 = document.getElementById("sku_f5")?.value || "?";

      // Sync ค่า variantLabel จาก DOM เข้า state ก่อน save
      const variantInputs = document.querySelectorAll(".variant-label-input");
      state.variants.forEach((v, vi) => {
        if (variantInputs[vi]) {
          const label = variantInputs[vi].value.trim().toUpperCase();
          if (label) {
            state.variants[vi].variantLabel = label;
            state.variants[vi].sku = [f1, f2, f3, label, f5]
              .filter(Boolean)
              .join("-");
          }
        }
      });

      // เพิ่ม f4 (parent SKU field) เป็น variant แรกถ้ายังไม่มีใน state
      const allVariantLabels = state.variants.map((v) =>
        v.variantLabel.toUpperCase(),
      );
      if (f4 && !allVariantLabels.includes(f4)) {
        state.variants.unshift({
          enabled: true,
          variantLabel: f4,
          sku: [f1, f2, f3, f4, f5].filter(Boolean).join("-"),
          cost: parseFloat(document.getElementById("parentCost")?.value) || 0,
          sale: parseFloat(document.getElementById("parentSale")?.value) || 0,
        });
      }

      const activeVariants = state.variants.filter(
        (v) => v.enabled && v.variantLabel,
      );

      for (const v of activeVariants) {
        const existing = state.allProducts.find(
          (p) => p.product_code === v.sku,
        );
        if (!existing) {
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

          // บันทึก units ให้ทุก variant
          const unitDivs = document.querySelectorAll('[id^="unit-row-"]');
          for (const div of unitDivs) {
            const rowId = div.id.replace("unit-row-", "");
            const uname = document
              .getElementById(`uname-${rowId}`)
              ?.value?.trim();
            const uconv =
              parseFloat(document.getElementById(`uconv-${rowId}`)?.value) || 1;
            const ubase =
              document.getElementById(`ubase-${rowId}`)?.checked || false;
            if (uname) {
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
          }

          // ✅ อัปโหลดรูปภาพให้ทุก variant ใช้รูปเดียวกัน
          await uploadProductImages(variantId);
        }
      }

      // ── SINGLE: บันทึก product เดี่ยว ──
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

      // Save units
      await supabaseFetch("product_units", {
        method: "DELETE",
        query: `?product_id=eq.${productId}`,
      }).catch(() => {});
      const unitDivs = document.querySelectorAll('[id^="unit-row-"]');
      for (const div of unitDivs) {
        const rowId = div.id.replace("unit-row-", "");
        const uname = document.getElementById(`uname-${rowId}`)?.value?.trim();
        const uconv =
          parseFloat(document.getElementById(`uconv-${rowId}`)?.value) || 1;
        const ubase =
          document.getElementById(`ubase-${rowId}`)?.checked || false;
        if (uname) {
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
      }

      // ✅ อัปโหลดรูปภาพ (single product)
      await uploadProductImages(productId);
    }

    showToast("✅ บันทึกสินค้าสำเร็จ!", "success");
    setTimeout(() => {
      window.location.href = "products.html";
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

    // Set category
    const catSel = document.getElementById("fCategory");
    if (catSel) {
      catSel.value = p.category_id;
      onCategoryChange();
    }

    // Set type
    selectProductType(p.product_type === "variable" ? "variable" : "single");

    // Set SKU parts
    const parts = (p.product_code || "").split("-");
    ["f2", "f3", "f4", "f5"].forEach((f, i) => {
      const el = document.getElementById(`sku_${f}`);
      if (el) el.value = parts[i + 1] || "";
    });
    updateSkuPreview();

    // Set basic info
    document.getElementById("fName").value = p.product_name || "";
    document.getElementById("fBaseUnit").value = p.base_unit || "";
    document.getElementById("fReorder").value = p.reorder_point || "";
    document.getElementById("fCost").value = p.cost_price || "";
    document.getElementById("fSale").value = p.sale_price || "";

    // Load units
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

    // ── โหลดรูปภาพเดิม (edit mode) ──
    try {
      const imgs = await supabaseFetch("product_images", {
        query: `?product_id=eq.${id}&order=sort_order.asc`,
      });
      const grid = document.getElementById("imgUploadGrid");
      if (grid && imgs && imgs.length > 0) {
        imgs.forEach((img) => {
          const idx = img.sort_order ?? 0;
          if (idx >= IMG_SLOTS) return;
          const slot = document.querySelector(`.img-slot[data-idx="${idx}"]`);
          if (!slot) return;
          const isMain = idx === 0;
          slot.innerHTML = `
            <img src="${img.url}" alt="product-img-${idx}" />
            <div class="img-remove" onclick="removeImg(event, ${idx})">✕</div>
          `;
          // imgFiles[idx] ยังเป็น null เพราะเป็น URL เดิม — เก็บ URL ไว้แทน
          imgFiles[idx] = { _existingUrl: img.url, _imageId: img.image_id };
          if (isMain) slot.classList.add("img-main-badge");
        });
      }
    } catch {}

    updateSummary();
  } catch (e) {
    showToast("โหลดข้อมูลสินค้าไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── UTILS ─────────────────────────────────────────────────
function goBack() {
  if (history.length > 1) history.back();
  else window.location.href = "products.html";
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
