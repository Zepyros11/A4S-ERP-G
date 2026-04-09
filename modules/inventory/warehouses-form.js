/* =====================================================
   warehouses-form.js
   Form Controller — Warehouse Modal
===================================================== */

import {
  fetchCountries,
  createCountry,
  updateCountry,
  removeCountry,
} from "../list/warehouses-api.js";

/* ================================
   STATE (shared กับ list ผ่าน module scope)
================================ */

let _warehouses = [];
let _countries = [];
let selectedCountry = null;

/* inject state จาก list */
export function setFormState(warehouses, countries) {
  _warehouses = warehouses;
  _countries = countries;
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
  document.getElementById("fType").value = data?.warehouse_type || "MAIN";
  document.getElementById("fIcon").value = data?.warehouse_icon || "🏭";
  document.getElementById("fName").value = data?.warehouse_name || "";
  document.getElementById("fAddress").value = data?.location || "";
  document.getElementById("fManager").value = data?.manager_name || "";
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
      parentSel.innerHTML += `<option value="${w.warehouse_id}" ${sel}>${w.warehouse_icon || "🏭"} ${w.warehouse_name}</option>`;
    });

  renderCountryDropdown();
  modal.classList.add("open");
}

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
  openDeleteModal(`ต้องการลบประเทศ "${c.country_name}" หรือไม่?`, async () => {
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
});

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
    warehouse_icon: document.getElementById("fIcon")?.value,
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
