/* =====================================================
   warehouses-form.js
   Form Controller — Warehouse Modal (In-Context CRUD pattern)
   - country & warehouse type ใช้ native <select> + ⚙️ จัดการ nested modal
   - auto-gen code + hide จาก UI
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

/* helper: ดึง country object จาก code */
function findCountryByCode(code) {
  return _countries.find((c) => c.country_code === code) || null;
}
function findTypeByCode(code) {
  return _types.find((t) => t.type_code === code) || null;
}

export function getSelectedCountry() {
  const code = document.getElementById("fCountry")?.value;
  return findCountryByCode(code);
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
    if (currentManager && !_users.some((u) => u.full_name === currentManager)) {
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

  /* type select — default = ตัวแรก ถ้าเป็น new */
  const initialTypeCode = data?.warehouse_type || _types[0]?.type_code || "";
  populateTypeSelect(initialTypeCode);

  /* country select */
  populateCountrySelect(data?.country || "");

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

  updateWarehousePreview();
  modal.classList.add("open");
}

/* ================================
   LIVE PREVIEW
================================ */

window.updateWarehousePreview = function () {
  const name = document.getElementById("fName")?.value.trim() || "ชื่อคลัง";
  const code = document.getElementById("fCode")?.value.trim() || "WH-000";
  const typeCode = document.getElementById("fType")?.value;
  const t = findTypeByCode(typeCode);
  const icon = t?.icon || "🏭";

  const pIcon = document.getElementById("whPrevIcon");
  const pName = document.getElementById("whPrevName");
  const pCode = document.getElementById("whPrevCode");

  if (pIcon) pIcon.textContent = icon;
  if (pName) pName.textContent = name;
  if (pCode) pCode.textContent = code;
};

window.onWhtSelectChange = function () {
  updateWarehousePreview();
};
window.onCountrySelectChange = function () {
  /* ไม่ต้องทำอะไรเป็นพิเศษ — แค่ trigger event เผื่อในอนาคต */
};

export function closeWarehouseModal() {
  document.getElementById("warehouseModal")?.classList.remove("open");
}

window.closeWarehouseModal = closeWarehouseModal;

/* ================================
   POPULATE SELECTS
================================ */

function populateCountrySelect(currentCode = "") {
  const sel = document.getElementById("fCountry");
  if (!sel) return;
  const opts = _countries
    .map((c) => `<option value="${c.country_code}">${c.country_name}</option>`)
    .join("");
  sel.innerHTML = `<option value="">— เลือกประเทศ —</option>${opts}`;
  if (currentCode && _countries.some((c) => c.country_code === currentCode)) {
    sel.value = currentCode;
  }
}

function populateTypeSelect(currentCode = "") {
  const sel = document.getElementById("fType");
  if (!sel) return;
  const opts = _types
    .map(
      (t) =>
        `<option value="${t.type_code}">${t.icon ? t.icon + " " : ""}${t.type_name}</option>`,
    )
    .join("");
  sel.innerHTML = `<option value="">— เลือกประเภท —</option>${opts}`;
  if (currentCode && _types.some((t) => t.type_code === currentCode)) {
    sel.value = currentCode;
  } else if (_types[0]) {
    sel.value = _types[0].type_code;
  }
}

/* ================================
   COUNTRY MANAGER (In-Context CRUD)
================================ */

window.openCountryManager = function () {
  renderCountryManagerList();
  document.getElementById("countryManagerOverlay").classList.add("open");
  document.getElementById("countryNewName")?.focus();
};
window.closeCountryManager = function () {
  document.getElementById("countryManagerOverlay")?.classList.remove("open");
};
window.closeCountryManagerBg = function (e) {
  if (e.target === document.getElementById("countryManagerOverlay"))
    window.closeCountryManager();
};

function renderCountryManagerList() {
  const list = document.getElementById("countryManagerList");
  if (!list) return;
  if (!_countries.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌐</div><div>ยังไม่มีประเทศ</div></div>`;
    return;
  }
  list.innerHTML = _countries
    .map(
      (c) => `
    <div class="ic-row" data-id="${c.country_id}">
      <input class="form-control" data-edit-name="${c.country_id}" value="${(c.country_name || "").replace(/"/g, "&quot;")}" placeholder="ชื่อประเทศ" />
      <div class="ic-actions">
        <button class="btn-icon" title="บันทึก" onclick="saveCountryEntry(${c.country_id})">💾</button>
        <button class="btn-icon danger" title="ลบ" onclick="deleteCountryEntry(${c.country_id})">🗑</button>
      </div>
    </div>`,
    )
    .join("");
}

/* auto-gen country_code: CTRY001, CTRY002, ... — กันชนของเดิม */
function generateCountryCode() {
  let max = 0;
  for (const c of _countries) {
    const m = /^CTRY(\d+)$/i.exec(c.country_code || "");
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return "CTRY" + String(max + 1).padStart(3, "0");
}

window.addCountryEntry = async function () {
  const nameEl = document.getElementById("countryNewName");
  const country_name = nameEl.value.trim();
  if (!country_name) {
    showFormToast("กรุณากรอกชื่อประเทศ", "warning");
    return;
  }
  if (
    _countries.some(
      (c) =>
        (c.country_name || "").toLowerCase() === country_name.toLowerCase(),
    )
  ) {
    showFormToast(`ประเทศ "${country_name}" มีอยู่แล้ว`, "warning");
    return;
  }
  const country_code = generateCountryCode();
  const sort_order =
    _countries.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1;
  try {
    const created = await createCountry({
      country_code,
      country_name,
      sort_order,
    });
    if (Array.isArray(created) && created[0]) _countries.push(created[0]);
    else _countries.push({ country_code, country_name, sort_order });
    nameEl.value = "";
    nameEl.focus();
    populateCountrySelect(document.getElementById("fCountry")?.value);
    renderCountryManagerList();
    showFormToast("✅ เพิ่มประเทศแล้ว");
  } catch (e) {
    showFormToast("เพิ่มไม่ได้: " + e.message, "error");
  }
};

window.saveCountryEntry = async function (id) {
  const input = document.querySelector(`input[data-edit-name="${id}"]`);
  if (!input) return;
  const country_name = input.value.trim();
  if (!country_name) {
    showFormToast("ชื่อประเทศห้ามว่าง", "warning");
    return;
  }
  try {
    await updateCountry(id, { country_name });
    const cur = _countries.find((x) => x.country_id === id);
    if (cur) cur.country_name = country_name;
    populateCountrySelect(document.getElementById("fCountry")?.value);
    showFormToast("✅ บันทึกชื่อประเทศแล้ว");
  } catch (e) {
    showFormToast("บันทึกไม่ได้: " + e.message, "error");
  }
};

window.deleteCountryEntry = async function (id) {
  const c = _countries.find((x) => x.country_id === id);
  if (!c) return;
  /* pre-check: นับ warehouses ที่ใช้ country นี้ — block ถ้ามี */
  const whInUse = _warehouses.filter((w) => w.country === c.country_code).length;
  if (whInUse > 0) {
    if (window.ConfirmModal) {
      await ConfirmModal.open({
        title: "ลบไม่ได้",
        icon: "🚫",
        tone: "danger",
        message: `ประเทศ "${c.country_name}" มีคลังสินค้าใช้อยู่ ${whInUse} คลัง — กรุณาเปลี่ยนหรือลบคลังเหล่านั้นก่อน`,
        okText: "เข้าใจแล้ว",
        hideCancel: true,
      });
    } else {
      showFormToast(`ลบไม่ได้ — มีคลัง ${whInUse} แห่งใช้ประเทศนี้`, "error");
    }
    return;
  }
  const onConfirm = async () => {
    try {
      await removeCountry(id);
      _countries = _countries.filter((x) => x.country_id !== id);
      populateCountrySelect(document.getElementById("fCountry")?.value);
      renderCountryManagerList();
      showFormToast("ลบประเทศแล้ว");
    } catch (e) {
      showFormToast("ลบไม่ได้: " + e.message, "error");
    }
  };
  if (window.DeleteModal)
    DeleteModal.open(`ลบประเทศ "${c.country_name}" หรือไม่?`, onConfirm);
  else onConfirm();
};

/* ================================
   WAREHOUSE TYPE MANAGER (In-Context CRUD)
================================ */

window.openWhtManager = function () {
  renderWhtManagerList();
  document.getElementById("whtManagerOverlay").classList.add("open");
  document.getElementById("whtNewName")?.focus();
};
window.closeWhtManager = function () {
  document.getElementById("whtManagerOverlay")?.classList.remove("open");
};
window.closeWhtManagerBg = function (e) {
  if (e.target === document.getElementById("whtManagerOverlay"))
    window.closeWhtManager();
};

function renderWhtManagerList() {
  const list = document.getElementById("whtManagerList");
  if (!list) return;
  if (!_types.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷️</div><div>ยังไม่มีประเภท</div></div>`;
    return;
  }
  list.innerHTML = _types
    .map(
      (t) => `
    <div class="ic-row-type" data-id="${t.type_id}">
      <input class="form-control" data-edit-icon="${t.type_id}" value="${(t.icon || "").replace(/"/g, "&quot;")}" maxlength="4" style="text-align:center" placeholder="🏭" />
      <input class="form-control" data-edit-name="${t.type_id}" value="${(t.type_name || "").replace(/"/g, "&quot;")}" placeholder="ชื่อประเภท" />
      <div class="ic-actions">
        <button class="btn-icon" title="บันทึก" onclick="saveWhtEntry(${t.type_id})">💾</button>
        <button class="btn-icon danger" title="ลบ" onclick="deleteWhtEntry(${t.type_id})">🗑</button>
      </div>
    </div>`,
    )
    .join("");
}

/* auto-gen type_code: TYPE-001, TYPE-002, ... กัน collide กับโค้ดเก่า (MAIN/BRANCH/...) */
function generateTypeCode() {
  let max = 0;
  for (const t of _types) {
    const m = /^TYPE-(\d+)$/.exec(t.type_code || "");
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return `TYPE-${String(max + 1).padStart(3, "0")}`;
}

window.addWhtEntry = async function () {
  const iconEl = document.getElementById("whtNewIcon");
  const nameEl = document.getElementById("whtNewName");
  const type_name = nameEl.value.trim();
  const icon = iconEl.value.trim() || "📦";
  if (!type_name) {
    showFormToast("กรุณากรอกชื่อประเภท", "warning");
    return;
  }
  if (
    _types.some(
      (t) => (t.type_name || "").toLowerCase() === type_name.toLowerCase(),
    )
  ) {
    showFormToast(`ประเภท "${type_name}" มีอยู่แล้ว`, "warning");
    return;
  }
  const type_code = generateTypeCode();
  const sort_order = _types.length + 1;
  try {
    const created = await createWarehouseType({
      type_code,
      type_name,
      icon,
      sort_order,
    });
    if (Array.isArray(created) && created[0]) _types.push(created[0]);
    else _types.push({ type_code, type_name, icon, sort_order });
    iconEl.value = "";
    nameEl.value = "";
    nameEl.focus();
    populateTypeSelect(document.getElementById("fType")?.value);
    renderWhtManagerList();
    updateWarehousePreview();
    showFormToast("✅ เพิ่มประเภทแล้ว");
  } catch (e) {
    showFormToast("เพิ่มไม่ได้: " + e.message, "error");
  }
};

window.saveWhtEntry = async function (id) {
  const nameInput = document.querySelector(`input[data-edit-name="${id}"]`);
  const iconInput = document.querySelector(`input[data-edit-icon="${id}"]`);
  if (!nameInput) return;
  const type_name = nameInput.value.trim();
  const icon = (iconInput?.value || "").trim() || "📦";
  if (!type_name) {
    showFormToast("ชื่อประเภทห้ามว่าง", "warning");
    return;
  }
  try {
    await updateWarehouseType(id, { type_name, icon });
    const cur = _types.find((x) => x.type_id === id);
    if (cur) {
      cur.type_name = type_name;
      cur.icon = icon;
    }
    populateTypeSelect(document.getElementById("fType")?.value);
    updateWarehousePreview();
    showFormToast("✅ บันทึกประเภทแล้ว");
  } catch (e) {
    showFormToast("บันทึกไม่ได้: " + e.message, "error");
  }
};

window.deleteWhtEntry = async function (id) {
  const t = _types.find((x) => x.type_id === id);
  if (!t) return;
  /* pre-check: นับ warehouses ที่ใช้ type นี้ — block ถ้ามี */
  const whInUse = _warehouses.filter((w) => w.warehouse_type === t.type_code).length;
  if (whInUse > 0) {
    if (window.ConfirmModal) {
      await ConfirmModal.open({
        title: "ลบไม่ได้",
        icon: "🚫",
        tone: "danger",
        message: `ประเภท "${t.type_name}" มีคลังสินค้าใช้อยู่ ${whInUse} คลัง — กรุณาเปลี่ยนหรือลบคลังเหล่านั้นก่อน`,
        okText: "เข้าใจแล้ว",
        hideCancel: true,
      });
    } else {
      showFormToast(`ลบไม่ได้ — มีคลัง ${whInUse} แห่งใช้ประเภทนี้`, "error");
    }
    return;
  }
  const onConfirm = async () => {
    try {
      await removeWarehouseType(id);
      _types = _types.filter((x) => x.type_id !== id);
      populateTypeSelect(document.getElementById("fType")?.value);
      renderWhtManagerList();
      updateWarehousePreview();
      showFormToast("ลบประเภทแล้ว");
    } catch (e) {
      showFormToast("ลบไม่ได้: " + e.message, "error");
    }
  };
  if (window.DeleteModal)
    DeleteModal.open(`ลบประเภท "${t.type_name}" หรือไม่?`, onConfirm);
  else onConfirm();
};

/* ================================
   SAVE — dispatch event
================================ */

window.saveWarehouseForm = function () {
  const countryCode = document.getElementById("fCountry")?.value;
  if (!countryCode) {
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
    country: countryCode,
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
