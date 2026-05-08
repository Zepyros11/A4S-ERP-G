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
        query: "?select=product_id,product_code,product_name,category_id",
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
      const path = `products/${productId}_${idx}_${Date.now()}`;
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
    const uname = document.getElementById(`uname-${rowId}`)?.value?.trim();
    const uconv =
      parseFloat(document.getElementById(`uconv-${rowId}`)?.value) || 1;
    const ubase = document.getElementById(`ubase-${rowId}`)?.checked || false;
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

    if (state.productType === "variable") {
      // ใช้ codes ทั้งจาก DB + ที่ gen ใน loop เพื่อกัน duplicate
      const usedCodes = state.allProducts.map((p) => p.product_code);

      for (const v of state.variants.filter(
        (vt) => vt.enabled && vt.variantLabel?.trim(),
      )) {
        const productCode = generateNextProductCode(usedCodes);
        usedCodes.push(productCode);

        const vPayload = {
          product_code: productCode,
          product_name: `${name} (${v.variantLabel.trim()})`,
          category_id: state.category.category_id,
          base_unit: base,
          cost_price: v.cost || 0,
          sale_price: v.sale || 0,
          reorder_point: reorderPoint,
        };
        const res = await supabaseFetch("products", {
          method: "POST",
          body: vPayload,
        });
        const variantId = res[0].product_id;

        await saveUnitsForProduct(variantId);
        await uploadProductImages(variantId);
      }
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
    const catSel = document.getElementById("fCategory");
    if (catSel) {
      catSel.value = p.category_id;
      onCategoryChange();
    }
    selectProductType("single"); // edit รองรับ single เท่านั้น (variant = หลาย row)

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
