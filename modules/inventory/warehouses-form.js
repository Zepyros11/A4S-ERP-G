/* =====================================================
   warehouses-form.js
   Form Controller — Warehouse Modal
===================================================== */

import {
  fetchCountries,
  createCountry,
  updateCountry,
  removeCountry,
  fetchWarehouseTypes,
  createWarehouseType,
  updateWarehouseType,
  removeWarehouseType,
} from "./warehouses-api.js";

/* ================================
   STATE (shared กับ list ผ่าน module scope)
================================ */

let _warehouses = [];
let _countries = [];
let _users = [];
let _types = [];
let selectedCountry = null;
let selectedType = null;

export function whIcon(w) {
  const t = _types.find((x) => x.type_code === w?.warehouse_type);
  return t?.icon || "🏭";
}

/* inject state จาก list */
export function setFormState(warehouses, countries, users = [], types = []) {
  _warehouses = warehouses;
  _countries = countries;
  _users = users;
  _types = types;
}

export function getSelectedCountry() {
  return selectedCountry;
}

/* ================================
   OPEN / CLOSE
================================ */

export function openWarehouseModal(data = null) {
  const modal = document.getElementById("warehouseModal");
  if (!modal) return;

  document.getElementById("warehouseModalTitle").textContent = data
    ? "แก้ไขคลัง"
    : "เพิ่มคลังใหม่";

  document.getElementById("whEditId").value = data?.warehouse_id || "";
  document.getElementById("fCode").value =
    data?.warehouse_code || generateCode();
  /* type */
  const initialTypeCode = data?.warehouse_type || _types[0]?.type_code || "MAIN";
  selectedType =
    _types.find((t) => t.type_code === initialTypeCode) || _types[0] || null;
  document.getElementById("fType").value = selectedType?.type_code || "MAIN";

  document.getElementById("fName").value = data?.warehouse_name || "";
  document.getElementById("fAddress").value = data?.location || "";
  /* populate manager dropdown — อ้างอิงจาก users.full_name */
  const mgrSel = document.getElementById("fManager");
  if (mgrSel) {
    const currentManager = data?.manager_name || "";
    let opts = `<option value="">— ไม่กำหนด —</option>`;
    opts += _users
      .map(
        (u) =>
          `<option value="${u.full_name}" ${u.full_name === currentManager ? "selected" : ""}>${u.full_name}</option>`,
      )
      .join("");
    /* ถ้า manager_name เก่าไม่ตรงกับ user คนไหน → เก็บไว้เป็น option (ค่าเดิม) */
    if (
      currentManager &&
      !_users.some((u) => u.full_name === currentManager)
    ) {
      opts += `<option value="${currentManager}" selected>${currentManager} (ค่าเดิม)</option>`;
    }
    mgrSel.innerHTML = opts;
  }
  document.getElementById("fPhone").value = data?.phone || "";
  document.getElementById("fCapacity").value = data?.capacity || "";
  document.getElementById("fNote").value = data?.note || "";
  document.getElementById("fStatus").value = data
    ? String(data.is_active)
    : "true";

  /* country */
  selectedCountry = data?.country
    ? _countries.find((c) => c.country_code === data.country) || null
    : null;

  /* parent select */
  const parentSel = document.getElementById("fParent");
  parentSel.innerHTML = `<option value="">— ไม่มี (คลังหลัก) —</option>`;
  _warehouses
    .filter(
      (w) =>
        w.warehouse_id !== (data?.warehouse_id || -1) &&
        w.warehouse_type === "MAIN",
    )
    .forEach((w) => {
      const sel = data?.parent_id === w.warehouse_id ? "selected" : "";
      parentSel.innerHTML += `<option value="${w.warehouse_id}" ${sel}>${w.warehouse_name}</option>`;
    });

  renderCountryDropdown();
  renderWhtDropdown();
  updateWarehousePreview();
  modal.classList.add("open");
}

/* ================================
   LIVE PREVIEW
================================ */

window.updateWarehousePreview = function () {
  const name =
    document.getElementById("fName")?.value.trim() || "ชื่อคลัง";
  const code =
    document.getElementById("fCode")?.value.trim() || "WH-000";
  const icon = selectedType?.icon || "🏭";

  const pIcon = document.getElementById("whPrevIcon");
  const pName = document.getElementById("whPrevName");
  const pCode = document.getElementById("whPrevCode");

  if (pIcon) pIcon.textContent = icon;
  if (pName) pName.textContent = name;
  if (pCode) pCode.textContent = code;
};

export function closeWarehouseModal() {
  document.getElementById("warehouseModal")?.classList.remove("open");
  closeCountryDropdown();
}

window.closeWarehouseModal = closeWarehouseModal;

/* ================================
   COUNTRY DROPDOWN
================================ */

function renderCountryDropdown() {
  const trigger = document.getElementById("countryTrigger");
  if (!trigger) return;
  trigger.innerHTML = selectedCountry
    ? `${selectedCountry.country_name} <span class="country-trigger-arrow">▾</span>`
    : `— เลือกประเทศ — <span class="country-trigger-arrow">▾</span>`;
  renderCountryList();
}
window.toggleCountryDropdown = function (e) {
  e.stopPropagation();
  const panel = document.getElementById("countryPanel");
  panel.classList.contains("open")
    ? closeCountryDropdown()
    : panel.classList.add("open");
};

function closeCountryDropdown() {
  document.getElementById("countryPanel")?.classList.remove("open");
}

function renderCountryList() {
  const list = document.getElementById("countryList");
  if (!list) return;

  list.innerHTML =
    _countries
      .map(
        (c) => `
    <div class="country-item ${selectedCountry?.country_id === c.country_id ? "selected" : ""}"
         data-id="${c.country_id}" id="ci-${c.country_id}">
      <span class="country-item-label" onclick="selectCountry(${c.country_id})">
        ${c.country_name}
        <small class="country-code">${c.country_code}</small>
      </span>
      <span class="country-item-actions">
        <button class="ci-btn" onclick="startEditCountry(${c.country_id},event)">✏️</button>
        <button class="ci-btn danger" onclick="deleteCountry(${c.country_id})">🗑</button>
      </span>
    </div>`,
      )
      .join("") +
    `
    <div class="country-add-row">
      <button class="country-add-btn" onclick="startAddCountry(event)">＋ เพิ่มประเทศ</button>
    </div>`;
}

window.selectCountry = function (id) {
  selectedCountry = _countries.find((c) => c.country_id === id) || null;
  renderCountryDropdown();
  closeCountryDropdown();
};

window.startEditCountry = function (id, e) {
  e?.stopPropagation();
  const c = _countries.find((c) => c.country_id === id);
  if (!c) return;
  const item = document.getElementById(`ci-${id}`);
  item.classList.add("editing");
  item.innerHTML = `
    <input class="ci-input" id="ci-name-${id}" value="${c.country_name}" placeholder="ชื่อประเทศ" />
    <input class="ci-input" id="ci-code-${id}" value="${c.country_code}" placeholder="CODE" style="width:60px;text-transform:uppercase" />
    <span class="country-item-actions">
      <button class="ci-btn success" onclick="saveEditCountry(${id},event)">✔</button>
      <button class="ci-btn" onclick="renderCountryListPublic()">✕</button>
    </span>`;
};

window.saveEditCountry = async function (id, e) {
  e?.stopPropagation();
  const name = document.getElementById(`ci-name-${id}`)?.value.trim();
  const code = document
    .getElementById(`ci-code-${id}`)
    ?.value.trim()
    .toUpperCase();
  if (!name || !code) {
    showFormToast("กรุณากรอกชื่อและรหัส", "warning");
    return;
  }
  try {
    await updateCountry(id, { country_name: name, country_code: code });
    await reloadCountries();
    if (selectedCountry?.country_id === id)
      selectedCountry = _countries.find((c) => c.country_id === id);
    renderCountryDropdown();
    showFormToast("แก้ไขสำเร็จ");
  } catch {
    showFormToast("แก้ไขไม่สำเร็จ", "error");
  }
};

window.startAddCountry = function (e) {
  e?.stopPropagation();
  const list = document.getElementById("countryList");
  const addRow = list.querySelector(".country-add-row");
  if (document.getElementById("ci-new")) return;
  const newRow = document.createElement("div");
  newRow.className = "country-item editing";
  newRow.id = "ci-new";
  newRow.innerHTML = `
    <input class="ci-input" id="ci-new-name" placeholder="ชื่อประเทศ" />
    <input class="ci-input" id="ci-new-code" placeholder="CODE" style="width:60px;text-transform:uppercase" />
    <span class="country-item-actions">
      <button class="ci-btn success" onclick="saveAddCountry()">✔</button>
      <button class="ci-btn" onclick="renderCountryListPublic()">✕</button>
    </span>`;
  list.insertBefore(newRow, addRow);
  document.getElementById("ci-new-name").focus();
};

window.saveAddCountry = async function () {
  const name = document.getElementById("ci-new-name")?.value.trim();
  const code = document
    .getElementById("ci-new-code")
    ?.value.trim()
    .toUpperCase();
  if (!name || !code) {
    showFormToast("กรุณากรอกชื่อและรหัส", "warning");
    return;
  }
  try {
    await createCountry({ country_name: name, country_code: code });
    await reloadCountries();
    renderCountryList();
    showFormToast("เพิ่มประเทศสำเร็จ");
  } catch (e) {
    showFormToast("เพิ่มไม่สำเร็จ: " + e.message, "error");
  }
};

window.deleteCountry = async function (id) {
  const c = _countries.find((c) => c.country_id === id);
  if (!c) return;
  DeleteModal.open(`ต้องการลบประเทศ "${c.country_name}" หรือไม่?`, async () => {
    try {
      await removeCountry(id);
      await reloadCountries();
      if (selectedCountry?.country_id === id)
        selectedCountry = _countries[0] || null;
      renderCountryDropdown();
      showFormToast("ลบสำเร็จ");
    } catch {
      showFormToast("ลบไม่สำเร็จ", "error");
    }
  });
};

/* expose สำหรับ inline cancel button */
window.renderCountryListPublic = renderCountryList;

async function reloadCountries() {
  _countries = await fetchCountries();
}

/* ================================
   CLOSE DROPDOWN ON OUTSIDE CLICK
================================ */

document.addEventListener("click", (e) => {
  if (!e.target.closest("#countryDropdownWrap")) closeCountryDropdown();
  if (!e.target.closest("#whtDropdownWrap")) closeWhtDropdown();
});

/* ================================
   WAREHOUSE TYPE DROPDOWN (CRUD)
================================ */

function renderWhtDropdown() {
  const trigger = document.getElementById("whtTrigger");
  if (!trigger) return;
  trigger.innerHTML = selectedType
    ? `${selectedType.icon || "📦"} ${selectedType.type_name} <span class="country-trigger-arrow">▾</span>`
    : `— เลือกประเภท — <span class="country-trigger-arrow">▾</span>`;
  renderWhtList();
}

window.toggleWhtDropdown = function (e) {
  e.stopPropagation();
  const panel = document.getElementById("whtPanel");
  panel.classList.contains("open")
    ? closeWhtDropdown()
    : panel.classList.add("open");
};

function closeWhtDropdown() {
  document.getElementById("whtPanel")?.classList.remove("open");
}

function renderWhtList() {
  const list = document.getElementById("whtList");
  if (!list) return;

  list.innerHTML =
    _types
      .map(
        (t) => `
    <div class="country-item ${selectedType?.type_id === t.type_id ? "selected" : ""}"
         data-id="${t.type_id}" id="wht-${t.type_id}">
      <span class="country-item-label" onclick="selectType(${t.type_id})">
        ${t.icon || "📦"} ${t.type_name}
      </span>
      <span class="country-item-actions">
        <button class="ci-btn" onclick="startEditType(${t.type_id},event)">✏️</button>
        <button class="ci-btn danger" onclick="deleteType(${t.type_id})">🗑</button>
      </span>
    </div>`,
      )
      .join("") +
    `
    <div class="country-add-row">
      <button class="country-add-btn" onclick="startAddType(event)">＋ เพิ่มประเภท</button>
    </div>`;
}

window.selectType = function (id) {
  selectedType = _types.find((t) => t.type_id === id) || null;
  document.getElementById("fType").value = selectedType?.type_code || "";
  renderWhtDropdown();
  closeWhtDropdown();
  updateWarehousePreview();
};

window.startEditType = function (id, e) {
  e?.stopPropagation();
  const t = _types.find((t) => t.type_id === id);
  if (!t) return;
  const item = document.getElementById(`wht-${id}`);
  item.classList.add("editing");
  item.innerHTML = `
    <input class="ci-input" id="wht-icon-${id}" value="${t.icon || ""}" placeholder="🏭" style="width:50px;text-align:center" />
    <input class="ci-input" id="wht-name-${id}" value="${t.type_name}" placeholder="ชื่อประเภท" />
    <span class="country-item-actions">
      <button class="ci-btn success" onclick="saveEditType(${id},event)">✔</button>
      <button class="ci-btn" onclick="renderWhtListPublic()">✕</button>
    </span>`;
};

window.saveEditType = async function (id, e) {
  e?.stopPropagation();
  const icon = document.getElementById(`wht-icon-${id}`)?.value.trim() || "📦";
  const name = document.getElementById(`wht-name-${id}`)?.value.trim();
  if (!name) {
    showFormToast("กรุณากรอกชื่อประเภท", "warning");
    return;
  }
  try {
    await updateWarehouseType(id, {
      type_name: name,
      icon,
    });
    await reloadTypes();
    if (selectedType?.type_id === id) {
      selectedType = _types.find((t) => t.type_id === id);
      document.getElementById("fType").value = selectedType?.type_code || "";
    }
    renderWhtDropdown();
    updateWarehousePreview();
    showFormToast("แก้ไขสำเร็จ");
  } catch {
    showFormToast("แก้ไขไม่สำเร็จ", "error");
  }
};

window.startAddType = function (e) {
  e?.stopPropagation();
  const list = document.getElementById("whtList");
  const addRow = list.querySelector(".country-add-row");
  if (document.getElementById("wht-new")) return;
  const newRow = document.createElement("div");
  newRow.className = "country-item editing";
  newRow.id = "wht-new";
  newRow.innerHTML = `
    <input class="ci-input" id="wht-new-icon" placeholder="🏭" style="width:50px;text-align:center" />
    <input class="ci-input" id="wht-new-name" placeholder="ชื่อประเภท" />
    <span class="country-item-actions">
      <button class="ci-btn success" onclick="saveAddType()">✔</button>
      <button class="ci-btn" onclick="renderWhtListPublic()">✕</button>
    </span>`;
  list.insertBefore(newRow, addRow);
  document.getElementById("wht-new-name").focus();
};

/* auto-gen type_code: TYPE-001, TYPE-002, ... กัน collide กับโค้ดเก่า (MAIN/BRANCH/...) */
function genTypeCode() {
  const nums = _types.map((t) => {
    const m = String(t.type_code || "").match(/^TYPE-(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `TYPE-${String(next).padStart(3, "0")}`;
}

window.saveAddType = async function () {
  const icon = document.getElementById("wht-new-icon")?.value.trim() || "📦";
  const name = document.getElementById("wht-new-name")?.value.trim();
  if (!name) {
    showFormToast("กรุณากรอกชื่อประเภท", "warning");
    return;
  }
  try {
    await createWarehouseType({
      type_code: genTypeCode(),
      type_name: name,
      icon,
      sort_order: _types.length + 1,
    });
    await reloadTypes();
    renderWhtList();
    showFormToast("เพิ่มประเภทสำเร็จ");
  } catch (e) {
    showFormToast("เพิ่มไม่สำเร็จ: " + e.message, "error");
  }
};

window.deleteType = async function (id) {
  const t = _types.find((t) => t.type_id === id);
  if (!t) return;
  /* ป้องกันลบ type ที่ยังถูกใช้ใน warehouses */
  const inUse = _warehouses.some((w) => w.warehouse_type === t.type_code);
  if (inUse) {
    showFormToast(`ลบไม่ได้ — มีคลังใช้ประเภท "${t.type_name}" อยู่`, "warning");
    return;
  }
  DeleteModal.open(`ต้องการลบประเภท "${t.type_name}" หรือไม่?`, async () => {
    try {
      await removeWarehouseType(id);
      await reloadTypes();
      if (selectedType?.type_id === id) {
        selectedType = _types[0] || null;
        document.getElementById("fType").value = selectedType?.type_code || "";
      }
      renderWhtDropdown();
      updateWarehousePreview();
      showFormToast("ลบสำเร็จ");
    } catch {
      showFormToast("ลบไม่สำเร็จ", "error");
    }
  });
};

window.renderWhtListPublic = renderWhtList;

async function reloadTypes() {
  _types = (await fetchWarehouseTypes()) || [];
}

/* ================================
   SAVE — dispatch event
================================ */

window.saveWarehouseForm = function () {
  if (!selectedCountry) {
    showFormToast("กรุณาเลือกประเทศ", "warning");
    return;
  }

  const editId = document.getElementById("whEditId")?.value || null;

  const payload = {
    warehouse_code: document.getElementById("fCode")?.value.trim(),
    warehouse_name: document.getElementById("fName")?.value.trim(),
    warehouse_type: document.getElementById("fType")?.value,
    location: document.getElementById("fAddress")?.value.trim(),
    manager_name: document.getElementById("fManager")?.value.trim(),
    phone: document.getElementById("fPhone")?.value.trim(),
    capacity: parseInt(document.getElementById("fCapacity")?.value) || 0,
    note: document.getElementById("fNote")?.value.trim(),
    is_active: document.getElementById("fStatus")?.value === "true",
    country: selectedCountry.country_code,
    parent_id: parseInt(document.getElementById("fParent")?.value) || null,
  };

  window.dispatchEvent(
    new CustomEvent("warehouse-saved", {
      detail: { warehouse_id: editId, ...payload },
    }),
  );

  closeWarehouseModal();
};

/* ================================
   GENERATE CODE
================================ */

function generateCode() {
  if (_warehouses.length === 0) return "WH-001";
  const nums = _warehouses.map(
    (w) => parseInt(w.warehouse_code.replace("WH-", "")) || 0,
  );
  return "WH-" + String(Math.max(...nums) + 1).padStart(3, "0");
}

/* ================================
   TOAST (local)
================================ */

function showFormToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
