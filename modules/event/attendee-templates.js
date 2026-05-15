/* ============================================================
   attendee-templates.js — Master CRUD for attendee_form_templates
============================================================ */

const FIELD_LABELS = {
  phone:        "เบอร์โทร",
  position:     "ตำแหน่ง",
  upline:       "สายงาน",
  cs_staff:     "CS",
  line_name:    "ชื่อไลน์ที่แจ้ง",
  fb_page_name: "ชื่อเพจ Facebook",
  had_attended: "เคยเรียน/ไม่เคยเรียน",
  note:         "หมายเหตุ",
};

const DEFAULT_FIELD_ORDER = ["phone", "position", "upline", "cs_staff", "line_name", "fb_page_name", "had_attended", "note"];
const DEFAULT_CONFIG = {
  fields: {
    phone:        { show: true,  required: false },
    position:     { show: true,  required: false },
    upline:       { show: true,  required: true  },
    cs_staff:     { show: true,  required: false },
    line_name:    { show: true,  required: false },
    fb_page_name: { show: true,  required: false },
    had_attended: { show: true,  required: false },
    note:         { show: true,  required: false },
  },
  field_order: DEFAULT_FIELD_ORDER.slice(),
  hidden_keys: [],
  custom_fields: [],
  qualifications: [],
};
function _tplFieldLabel(key) {
  return (_draft?.fields?.[key]?.label) || FIELD_LABELS[key] || key;
}

let _allTemplates = [];
let _usageCounts = {};          // { template_id: number_of_events }
let _draft = null;              // working copy of config in modal
let _selectedIds = new Set();   // bulk-select template ids

// ── API helpers ────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `HTTP ${res.status}`);
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 2400);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Load + render list ─────────────────────────────────────
async function loadTemplates() {
  try {
    const [tpls, events] = await Promise.all([
      sbFetch("attendee_form_templates",
        "?select=id,name,description,config,sort_order,is_active,created_at&order=sort_order.asc,id.asc"),
      sbFetch("events", "?select=template_id&template_id=not.is.null"),
    ]);
    _allTemplates = tpls || [];
    _usageCounts = {};
    (events || []).forEach(e => {
      if (e.template_id) _usageCounts[e.template_id] = (_usageCounts[e.template_id] || 0) + 1;
    });
    renderTemplateTable();
  } catch (e) {
    showToast("โหลดเทมเพลตไม่สำเร็จ: " + e.message, "error");
  }
}

function renderTemplateTable() {
  const tb = document.getElementById("tplTableBody");
  document.getElementById("tplCount").textContent = `${_allTemplates.length} รายการ`;
  // drop selections that no longer exist
  const aliveIds = new Set(_allTemplates.map(t => t.id));
  _selectedIds.forEach(id => { if (!aliveIds.has(id)) _selectedIds.delete(id); });
  if (!_allTemplates.length) {
    tb.innerHTML = `<tr><td colspan="9"><div class="empty-state" style="padding:30px">
      <div class="empty-icon">📋</div>
      <div class="empty-text">ยังไม่มีเทมเพลต — กด "เพิ่มเทมเพลต"</div>
    </div></td></tr>`;
    updateBulkBar();
    return;
  }
  tb.innerHTML = _allTemplates.map((t, i) => {
    const cfg = t.config || {};
    const fieldsCount = cfg.fields
      ? Object.values(cfg.fields).filter(f => f && f.show !== false).length
      : 0;
    const qualsCount = Array.isArray(cfg.qualifications) ? cfg.qualifications.length : 0;
    const usage = _usageCounts[t.id] || 0;
    const checked = _selectedIds.has(t.id) ? "checked" : "";
    return `<tr${checked ? ' style="background:#f0fdf4"' : ''}>
      <td class="col-center">
        <input type="checkbox" class="tpl-row-check" data-id="${t.id}" ${checked}
          onclick="window.tplToggleRow(${t.id}, this.checked)"
          style="width:16px;height:16px;cursor:pointer;accent-color:#16a34a">
      </td>
      <td class="col-center" style="font-family:'IBM Plex Mono',monospace;color:var(--text3)">${i + 1}</td>
      <td>
        <div style="font-weight:700;color:#0f172a">${escapeHtml(t.name)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:'IBM Plex Mono',monospace">id #${t.id}</div>
      </td>
      <td style="color:var(--text2);font-size:12.5px">${escapeHtml(t.description || "—")}</td>
      <td class="col-center">
        <span style="background:#e0e7ff;color:#3730a3;padding:2px 9px;border-radius:5px;font-weight:700;font-size:12px">${fieldsCount}/8</span>
      </td>
      <td class="col-center">
        ${qualsCount
          ? `<span style="background:#fef3c7;color:#92400e;padding:2px 9px;border-radius:5px;font-weight:700;font-size:12px">${qualsCount} ข้อ</span>`
          : `<span style="color:var(--text3);font-size:12px">—</span>`}
      </td>
      <td class="col-center">
        ${usage > 0
          ? `<span style="background:#d1fae5;color:#065f46;padding:2px 9px;border-radius:5px;font-weight:700;font-size:12px" title="event ที่ใช้ template นี้">🔗 ${usage}</span>`
          : `<span style="color:var(--text3);font-size:12px">—</span>`}
      </td>
      <td class="col-center">
        <button onclick="window.toggleTemplateActive(${t.id}, ${!t.is_active})"
          style="background:${t.is_active ? '#dcfce7' : '#f1f5f9'};color:${t.is_active ? '#15803d' : '#64748b'};border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:700">
          ${t.is_active ? '● เปิด' : '○ ปิด'}
        </button>
      </td>
      <td class="col-center">
        <div style="display:inline-flex;gap:4px">
          <button onclick="window.openTemplateModal(${t.id})" title="แก้ไข"
            style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12.5px">✏️ แก้</button>
          <button onclick="window.duplicateTemplate(${t.id})" title="ทำสำเนา"
            style="background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:13px">📑</button>
          <button onclick="window.deleteTemplate(${t.id})" title="ลบ"
            style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:13px">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");
  updateBulkBar();
}

// ── Bulk select ────────────────────────────────────────────
function updateBulkBar() {
  const bar = document.getElementById("tplBulkBar");
  const cntEl = document.getElementById("tplBulkCount");
  const all = document.getElementById("tplSelectAll");
  const n = _selectedIds.size;
  if (bar) bar.style.display = n > 0 ? "inline-flex" : "none";
  if (cntEl) cntEl.textContent = `เลือก ${n} รายการ`;
  if (all) {
    const total = _allTemplates.length;
    all.checked = total > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
}

window.tplToggleRow = function (id, checked) {
  if (checked) _selectedIds.add(id);
  else _selectedIds.delete(id);
  renderTemplateTable();
};

window.tplToggleAll = function (checked) {
  if (checked) _allTemplates.forEach(t => _selectedIds.add(t.id));
  else _selectedIds.clear();
  renderTemplateTable();
};

window.tplClearSelection = function () {
  _selectedIds.clear();
  renderTemplateTable();
};

window.bulkDeleteTemplates = async function () {
  if (!_selectedIds.size) return;
  const ids = [..._selectedIds];
  const items = _allTemplates.filter(t => ids.includes(t.id));
  const usedItems = items.filter(t => (_usageCounts[t.id] || 0) > 0);
  const namesPreview = items.slice(0, 5).map(t => `• ${t.name}`).join("\n")
    + (items.length > 5 ? `\n…และอีก ${items.length - 5} รายการ` : "");
  const ok = await ConfirmModal.open({
    title: "ยืนยันการลบหลายเทมเพลต",
    message: `ลบ ${items.length} template?\n\n${namesPreview}`,
    icon: "🗑",
    okText: `ลบ ${items.length} รายการ`,
    cancelText: "ยกเลิก",
    tone: "danger",
    note: usedItems.length
      ? `⚠️ มี <b>${usedItems.length}</b> template ที่กำลังถูก event ใช้งาน — จะ unlink (FK SET NULL) แต่ override ของ event ยังอยู่`
      : null,
  });
  if (!ok) return;
  try {
    const inList = ids.join(",");
    await sbFetch("attendee_form_templates", `?id=in.(${inList})`, { method: "DELETE" });
    showToast(`ลบ ${items.length} template แล้ว`, "success");
    _selectedIds.clear();
    await loadTemplates();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
};

// ── Modal ──────────────────────────────────────────────────
window.openTemplateModal = function (id) {
  const t = id ? _allTemplates.find(x => x.id === id) : null;
  _draft = t ? JSON.parse(JSON.stringify(t.config || DEFAULT_CONFIG)) : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!_draft.fields) _draft.fields = JSON.parse(JSON.stringify(DEFAULT_CONFIG.fields));
  if (!Array.isArray(_draft.qualifications)) _draft.qualifications = [];
  if (!Array.isArray(_draft.custom_fields)) _draft.custom_fields = [];

  document.getElementById("tplFormId").value = t?.id || "";
  document.getElementById("tplName").value = t?.name || "";
  document.getElementById("tplDesc").value = t?.description || "";
  document.getElementById("tplIsActive").checked = t ? !!t.is_active : true;
  document.getElementById("tplModalTitle").textContent = t ? `✏️ แก้ไข — ${t.name}` : "➕ เพิ่มเทมเพลต";

  renderFields();
  renderCustomFields();
  renderQuals();
  document.getElementById("tplOverlay").classList.add("open");
  requestAnimationFrame(() => document.getElementById("tplName").focus());
};

window.closeTemplateModal = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("tplOverlay").classList.remove("open");
  _draft = null;
};

function renderFields() {
  const grid = document.getElementById("tplFieldsGrid");
  if (!grid || !_draft) return;
  if (!Array.isArray(_draft.field_order)) _draft.field_order = [];
  if (!Array.isArray(_draft.hidden_keys)) _draft.hidden_keys = [];
  // fallback: ถ้าทั้ง order ว่าง + ไม่มี hidden_keys → ตั้ง default
  if (!_draft.field_order.length && !_draft.hidden_keys.length) {
    _draft.field_order = DEFAULT_FIELD_ORDER.slice();
  }
  const validKeys = Object.keys(FIELD_LABELS);
  // เติม default ที่ขาดเฉพาะตัวที่ user ยังไม่ได้ลบ
  validKeys.forEach(k => {
    if (!_draft.field_order.includes(k) && !_draft.hidden_keys.includes(k)) {
      _draft.field_order.push(k);
    }
  });
  _draft.field_order = _draft.field_order.filter(k => validKeys.includes(k) && !_draft.hidden_keys.includes(k));
  _draft.hidden_keys = _draft.hidden_keys.filter(k => validKeys.includes(k));
  const order = _draft.field_order;
  // Column-first layout (1 ลงล่าง · ใช้ครึ่งบน → ครึ่งล่าง)
  const rowsCount = Math.max(1, Math.ceil(order.length / 2));
  grid.style.gridTemplateRows = `repeat(${rowsCount}, auto)`;
  grid.style.gridAutoFlow = "column";
  if (!order.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:14px;text-align:center;color:var(--text3);font-size:12px">ลบฟิลด์มาตรฐานออกหมดแล้ว — คืนค่าได้ที่ "ฟิลด์ที่ซ่อน" ด้านล่าง</div>';
  } else {
    grid.innerHTML = order.map((key, idx) => {
      if (!FIELD_LABELS[key]) return "";
      const f = _draft.fields[key] || {};
      const show = f.show !== false;
      const req = f.required === true;
      const lbl = _tplFieldLabel(key);
      return `<div class="drag-row" draggable="true" data-list="field" data-idx="${idx}"
        ondragstart="window._tplDragStart(event, 'field', ${idx})"
        ondragover="window._tplDragOver(event)"
        ondragleave="window._tplDragLeave(event)"
        ondrop="window._tplDrop(event, 'field', ${idx})"
        ondragend="window._tplDragEnd(event)">
        <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
        <span class="drag-num">${idx + 1}.</span>
        <label class="drag-row-main">
          <input type="checkbox" ${show ? "checked" : ""} onchange="window.tplToggleShow('${key}', this.checked)">
          <span class="${show ? '' : 'inactive'}">${escapeHtml(lbl)}</span>
        </label>
        <button class="drag-row-edit" title="แก้ไขชื่อหัวข้อ" onclick="window.tplRenameField('${key}')">✏️</button>
        <label class="drag-row-req">
          <input type="checkbox" ${req ? "checked" : ""} ${show ? "" : "disabled"} onchange="window.tplToggleReq('${key}', this.checked)">
          บังคับ*
        </label>
        <button class="drag-row-del" title="ลบฟิลด์นี้ (คืนค่าได้ภายหลัง)" onclick="window.tplRemoveStandardField('${key}')">🗑</button>
      </div>`;
    }).join("");
  }
  renderHiddenFields();
}

function renderHiddenFields() {
  const box = document.getElementById("tplHiddenFieldsBox");
  if (!box) return;
  const hidden = Array.isArray(_draft?.hidden_keys) ? _draft.hidden_keys : [];
  if (!hidden.length) { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "";
  box.innerHTML = `
    <div style="font-size:11px;color:#64748b;margin-bottom:6px">🗑 ฟิลด์ที่ซ่อน <span style="color:var(--text3)">— กดเพื่อคืนค่ากลับ</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${hidden.map(k => `
        <button type="button" class="fc-hidden-chip" onclick="window.tplRestoreStandardField('${k}')" title="คืนค่าฟิลด์นี้">
          ↺ ${escapeHtml(FIELD_LABELS[k] || k)}
        </button>
      `).join("")}
    </div>`;
}

window.tplRemoveStandardField = function (key) {
  if (!_draft) return;
  if (!Array.isArray(_draft.hidden_keys)) _draft.hidden_keys = [];
  if (!_draft.hidden_keys.includes(key)) _draft.hidden_keys.push(key);
  _draft.field_order = (_draft.field_order || []).filter(k => k !== key);
  renderFields();
};

window.tplRestoreStandardField = function (key) {
  if (!_draft) return;
  _draft.hidden_keys = (_draft.hidden_keys || []).filter(k => k !== key);
  if (!Array.isArray(_draft.field_order)) _draft.field_order = [];
  if (!_draft.field_order.includes(key)) _draft.field_order.push(key);
  renderFields();
};

window.tplRenameField = async function (key) {
  const current = _tplFieldLabel(key);
  const next = await PromptModal.open({
    title: "แก้ไขชื่อหัวข้อ",
    message: `หัวข้อปัจจุบัน: "${current}"`,
    icon: "✏️",
    okText: "บันทึก",
    tone: "primary",
    defaultValue: current,
    placeholder: "เว้นว่างเพื่อใช้ชื่อเริ่มต้น",
  });
  if (next == null) return;
  const trimmed = next.trim();
  if (!_draft.fields[key]) _draft.fields[key] = {};
  if (!trimmed || trimmed === FIELD_LABELS[key]) {
    delete _draft.fields[key].label;
  } else {
    _draft.fields[key].label = trimmed;
  }
  renderFields();
};

// ── Custom text fields ─────────────────────────────────────
function renderCustomFields() {
  const list = document.getElementById("tplCustomList");
  if (!list || !_draft) return;
  if (!Array.isArray(_draft.custom_fields)) _draft.custom_fields = [];
  if (!_draft.custom_fields.length) {
    list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text3);font-size:12px">ยังไม่มีฟิลด์เพิ่มเติม — เพิ่มด้านบน</div>';
    return;
  }
  list.innerHTML = _draft.custom_fields.map((cf, i) => `
    <div class="drag-row" draggable="true" data-list="custom" data-idx="${i}"
      ondragstart="window._tplDragStart(event, 'custom', ${i})"
      ondragover="window._tplDragOver(event)"
      ondragleave="window._tplDragLeave(event)"
      ondrop="window._tplDrop(event, 'custom', ${i})"
      ondragend="window._tplDragEnd(event)">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
      <span class="drag-num">${i + 1}.</span>
      <span class="drag-row-label">${escapeHtml(cf.label)}</span>
      <span class="drag-row-key" title="key">${escapeHtml(cf.key)}</span>
      <button class="drag-row-edit" title="แก้ไขชื่อ" onclick="window.tplRenameCustom(${i})">✏️</button>
      <button class="drag-row-del" title="ลบ" onclick="window.tplRemoveCustom(${i})">🗑</button>
    </div>
  `).join("");
}

window.tplAddCustom = function () {
  const inp = document.getElementById("tplNewCustomLabel");
  const label = inp.value.trim();
  if (!label) { inp.focus(); return; }
  const baseKey = "cf_" + label.toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]/gu, "").replace(/\s+/g, "_").slice(0, 36);
  let key = baseKey;
  const used = new Set((_draft.custom_fields || []).map(c => c.key));
  let n = 2;
  while (used.has(key)) key = `${baseKey}_${n++}`;
  if (!Array.isArray(_draft.custom_fields)) _draft.custom_fields = [];
  _draft.custom_fields.push({ key, label });
  inp.value = "";
  renderCustomFields();
};

window.tplRenameCustom = async function (idx) {
  const cf = _draft.custom_fields[idx];
  if (!cf) return;
  const next = await PromptModal.open({
    title: "แก้ไขชื่อฟิลด์",
    message: `ฟิลด์ปัจจุบัน: "${cf.label}"`,
    icon: "✏️",
    okText: "บันทึก",
    tone: "primary",
    defaultValue: cf.label,
    required: true,
  });
  if (next == null || !next.trim()) return;
  cf.label = next.trim();
  renderCustomFields();
};

window.tplRemoveCustom = function (idx) {
  _draft.custom_fields.splice(idx, 1);
  renderCustomFields();
};

window.tplToggleShow = function (key, val) {
  if (!_draft.fields[key]) _draft.fields[key] = {};
  _draft.fields[key].show = val;
  if (!val) _draft.fields[key].required = false;
  renderFields();
};
window.tplToggleReq = function (key, val) {
  if (!_draft.fields[key]) _draft.fields[key] = {};
  _draft.fields[key].required = val;
};

function renderQuals() {
  const list = document.getElementById("tplQualList");
  if (!list || !_draft) return;
  if (!_draft.qualifications.length) {
    list.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">ยังไม่มี checklist — เพิ่มด้านบน</div>';
    return;
  }
  list.innerHTML = _draft.qualifications.map((q, i) => `
    <div class="drag-row" draggable="true" data-list="qual" data-idx="${i}"
      ondragstart="window._tplDragStart(event, 'qual', ${i})"
      ondragover="window._tplDragOver(event)"
      ondragleave="window._tplDragLeave(event)"
      ondrop="window._tplDrop(event, 'qual', ${i})"
      ondragend="window._tplDragEnd(event)">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
      <span class="drag-num">${i + 1}.</span>
      <span class="drag-row-label">${escapeHtml(q.label)}</span>
      <span class="drag-row-key" title="key">${escapeHtml(q.key)}</span>
      <button class="drag-row-del" onclick="window.tplRemoveQual(${i})" title="ลบ">🗑</button>
    </div>
  `).join("");
}

// ── Drag-and-drop (works for both 'field' and 'qual' lists) ─
let _tplDragSrc = null;
window._tplDragStart = function (ev, listType, idx) {
  _tplDragSrc = { listType, idx };
  ev.dataTransfer.effectAllowed = "move";
  try { ev.dataTransfer.setData("text/plain", String(idx)); } catch {}
  ev.currentTarget.classList.add("dragging");
};
window._tplDragOver = function (ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "move";
  ev.currentTarget.classList.add("drag-over");
};
window._tplDragLeave = function (ev) {
  ev.currentTarget.classList.remove("drag-over");
};
window._tplDragEnd = function (ev) {
  ev.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".drag-row.drag-over").forEach(el => el.classList.remove("drag-over"));
  _tplDragSrc = null;
};
window._tplDrop = function (ev, listType, targetIdx) {
  ev.preventDefault();
  ev.currentTarget.classList.remove("drag-over");
  if (!_tplDragSrc || _tplDragSrc.listType !== listType) return;
  const srcIdx = _tplDragSrc.idx;
  if (srcIdx === targetIdx) return;
  const arr = listType === "field" ? _draft.field_order
            : listType === "custom" ? _draft.custom_fields
            : _draft.qualifications;
  const [moved] = arr.splice(srcIdx, 1);
  arr.splice(targetIdx, 0, moved);
  _tplDragSrc = null;
  if (listType === "field") renderFields();
  else if (listType === "custom") renderCustomFields();
  else renderQuals();
};

window.tplAddQual = function () {
  const inp = document.getElementById("tplNewQualLabel");
  const label = inp.value.trim();
  if (!label) { inp.focus(); return; }
  const baseKey = label.toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]/gu, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  let key = baseKey || `q${Date.now()}`;
  const used = new Set(_draft.qualifications.map(q => q.key));
  let n = 2;
  while (used.has(key)) { key = `${baseKey}_${n++}`; }
  _draft.qualifications.push({ key, label });
  inp.value = "";
  renderQuals();
};

window.tplRemoveQual = function (idx) {
  _draft.qualifications.splice(idx, 1);
  renderQuals();
};

// ── Save / Delete / Toggle ─────────────────────────────────
window.saveTemplate = async function () {
  const id = document.getElementById("tplFormId").value;
  const name = document.getElementById("tplName").value.trim();
  if (!name) { showToast("กรุณาระบุชื่อ template", "error"); return; }
  const payload = {
    name,
    description: document.getElementById("tplDesc").value.trim() || null,
    config: _draft || DEFAULT_CONFIG,
    is_active: document.getElementById("tplIsActive").checked,
  };
  try {
    if (id) {
      await sbFetch("attendee_form_templates", `?id=eq.${id}`, { method: "PATCH", body: payload });
      showToast("บันทึก template แล้ว ✏️", "success");
    } else {
      await sbFetch("attendee_form_templates", "", { method: "POST", body: { ...payload, sort_order: 1000 } });
      showToast("เพิ่ม template แล้ว ➕", "success");
    }
    window.closeTemplateModal();
    await loadTemplates();
  } catch (e) {
    if (/duplicate|unique/i.test(e.message || "")) {
      showToast(`มี template ชื่อ "${name}" อยู่แล้ว`, "error");
    } else {
      showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
  }
};

window.deleteTemplate = async function (id) {
  const t = _allTemplates.find(x => x.id === id);
  if (!t) return;
  const usage = _usageCounts[id] || 0;
  const ok = await ConfirmModal.open({
    title: "ยืนยันการลบเทมเพลต",
    message: `ลบ template "${t.name}"?`,
    icon: "🗑",
    okText: "ลบเทมเพลต",
    cancelText: "ยกเลิก",
    tone: "danger",
    note: usage > 0
      ? `⚠️ มี <b>${usage}</b> event ที่ใช้ template นี้ — จะ unlink (FK SET NULL) แต่ override ของ event ยังอยู่`
      : null,
  });
  if (!ok) return;
  try {
    await sbFetch("attendee_form_templates", `?id=eq.${id}`, { method: "DELETE" });
    showToast("ลบ template แล้ว", "success");
    await loadTemplates();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
};

window.toggleTemplateActive = async function (id, active) {
  try {
    await sbFetch("attendee_form_templates", `?id=eq.${id}`, {
      method: "PATCH", body: { is_active: active },
    });
    await loadTemplates();
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error");
  }
};

window.duplicateTemplate = async function (id) {
  const t = _allTemplates.find(x => x.id === id);
  if (!t) return;
  const newName = await PromptModal.open({
    title: "ทำสำเนาเทมเพลต",
    message: `จาก "${t.name}" → ตั้งชื่อใหม่:`,
    icon: "📑",
    okText: "ทำสำเนา",
    tone: "primary",
    defaultValue: t.name + " (copy)",
    required: true,
  });
  if (!newName || !newName.trim()) return;
  try {
    await sbFetch("attendee_form_templates", "", {
      method: "POST",
      body: {
        name: newName.trim(),
        description: t.description,
        config: t.config,
        sort_order: (t.sort_order || 100) + 1,
        is_active: true,
      },
    });
    showToast(`ทำสำเนาเป็น "${newName.trim()}" แล้ว`, "success");
    await loadTemplates();
  } catch (e) {
    if (/duplicate|unique/i.test(e.message || "")) {
      showToast(`มีชื่อ "${newName.trim()}" อยู่แล้ว`, "error");
    } else {
      showToast("ทำสำเนาไม่สำเร็จ: " + e.message, "error");
    }
  }
};

// ── Init ───────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadTemplates);
} else {
  loadTemplates();
}
