/* ============================================================
   attendee-templates.js — Master CRUD for attendee_form_templates
============================================================ */

const FIELD_LABELS = {
  phone:        "เบอร์โทร",
  position:     "ตำแหน่ง",
  upline:       "สายงาน",
  referrer:     "ผู้แนะนำ",
  cs_staff:     "CS",
  line_name:    "ชื่อไลน์ที่แจ้ง",
  fb_page_name: "ชื่อเพจ Facebook",
  had_attended: "เคยเรียน/ไม่เคยเรียน",
  note:         "หมายเหตุ",
};

const DEFAULT_FIELD_ORDER = ["phone", "position", "upline", "referrer", "cs_staff", "line_name", "fb_page_name", "had_attended", "note"];
const DEFAULT_CONFIG = {
  fields: {
    phone:        { show: true,  required: false },
    position:     { show: true,  required: false },
    upline:       { show: true,  required: true  },
    referrer:     { show: true,  required: false },
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
let _draft = null;              // (legacy) working copy of config in modal
let _blocks = [];               // working copy of blocks ในโมดอล (block builder)
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
        "?select=id,name,description,config,sort_order,is_active,is_default,created_at&order=is_default.desc,sort_order.asc,id.asc"),
      sbFetch("events", "?select=template_id&template_id=not.is.null"),
    ]);
    // ⭐ default ขึ้นบนสุดเสมอ (เผื่อ order ฝั่ง DB ไม่ครอบคลุม)
    _allTemplates = (tpls || []).slice().sort((a, b) =>
      (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0)
      || (a.sort_order || 0) - (b.sort_order || 0)
      || a.id - b.id
    );
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
    const isDef = !!t.is_default;
    const rowStyle = isDef
      ? ' style="background:#fffbeb;box-shadow:inset 3px 0 0 #f59e0b"'
      : (checked ? ' style="background:#f0fdf4"' : '');
    return `<tr${rowStyle}>
      <td class="col-center">
        <input type="checkbox" class="tpl-row-check" data-id="${t.id}" ${checked}
          onclick="window.tplToggleRow(${t.id}, this.checked)"
          style="width:16px;height:16px;cursor:pointer;accent-color:#16a34a">
      </td>
      <td class="col-center" style="font-family:'IBM Plex Mono',monospace;color:var(--text3)">${isDef ? '📌' : (i + 1)}</td>
      <td>
        <div style="font-weight:700;color:#0f172a">
          ${escapeHtml(t.name)}
          ${isDef ? '<span style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:700;margin-left:6px;vertical-align:middle">⭐ Default (ทุกงาน)</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:'IBM Plex Mono',monospace">id #${t.id}</div>
      </td>
      <td style="color:var(--text2);font-size:12.5px">${escapeHtml(t.description || "—")}</td>
      <td class="col-center">
        <span style="background:#e0e7ff;color:#3730a3;padding:2px 9px;border-radius:5px;font-weight:700;font-size:12px">${fieldsCount}/9</span>
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
        <div class="action-group">
          <button class="btn-icon tpl-star${isDef ? ' active' : ''}" onclick="window.setDefaultTemplate(${t.id}, ${!isDef})"
            title="${isDef ? 'ยกเลิกการเป็น Default' : 'ตั้งเป็น Default — ใช้กับทุกงานที่ไม่ได้เลือกเทมเพลตเอง'}">⭐</button>
          <button class="btn-icon" onclick="window.openTemplateModal(${t.id})" title="แก้ไข">✏️</button>
          <button class="btn-icon" onclick="window.duplicateTemplate(${t.id})" title="ทำสำเนา">📑</button>
          <button class="btn-icon danger" onclick="window.deleteTemplate(${t.id})" title="ลบ">🗑</button>
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
  _blocks = window.AttendeeFields.ensureBlocks(t ? (t.config || {}) : {});
  _ensureCoreItems();

  document.getElementById("tplFormId").value = t?.id || "";
  document.getElementById("tplName").value = t?.name || "";
  document.getElementById("tplDesc").value = t?.description || "";
  document.getElementById("tplIsActive").checked = t ? !!t.is_active : true;
  document.getElementById("tplModalTitle").textContent = t ? `✏️ แก้ไข — ${t.name}` : "➕ เพิ่มเทมเพลต";

  renderBlocks();
  document.getElementById("tplOverlay").classList.add("open");
  requestAnimationFrame(() => document.getElementById("tplName").focus());
};

window.closeTemplateModal = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("tplOverlay").classList.remove("open");
  _draft = null;
  _blocks = [];
};

// ══════════════════════════════════════════════════════════
//  BLOCK BUILDER — แต่ละ template = blocks[] · block มี items[]
// ══════════════════════════════════════════════════════════
function _findBlock(id) { return _blocks.find(b => b.id === id); }

// ให้แน่ใจว่ามี core (member_code + name) อยู่ใน block แรกเสมอ
function _ensureCoreItems() {
  const AF = window.AttendeeFields;
  if (!Array.isArray(_blocks) || !_blocks.length) {
    _blocks = [{ id: AF.newId("blk"), title: "ฟิลด์มาตรฐาน", items: [] }];
  }
  const first = _blocks[0];
  if (!Array.isArray(first.items)) first.items = [];
  ["member_code", "name"].forEach((k, i) => {
    const exists = _blocks.some(b => (b.items || []).some(it => it.type === "core" && it.key === k));
    if (!exists) first.items.splice(i, 0, { type: "core", key: k });
  });
}

function renderBlocks() {
  const wrap = document.getElementById("tplBlocks");
  if (!wrap) return;
  if (!Array.isArray(_blocks) || !_blocks.length) {
    wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12.5px">ยังไม่มีฟิลด์ — กด "➕ เพิ่มฟิลด์"</div>';
    return;
  }
  wrap.innerHTML = _blocks.map(b => {
    const items = Array.isArray(b.items) ? b.items : [];
    const hasCore = items.some(it => it.type === "core");
    const itemsHtml = items.map(it => _renderBlockItem(b.id, it)).join("")
      || '<div class="tpl-block-empty">ยังไม่มีข้อมูล — กด ➕ เพิ่มข้อมูล</div>';
    return `<div class="tpl-block" data-bid="${escapeHtml(b.id)}" draggable="true"
        ondragstart="window._blkDragStart(event,'${escapeHtml(b.id)}')"
        ondragover="window._blkDragOver(event)"
        ondragleave="window._blkDragLeave(event)"
        ondrop="window._blkDrop(event,'${escapeHtml(b.id)}')"
        ondragend="window._blkDragEnd(event)">
      <div class="tpl-block-hdr">
        <span class="drag-handle" title="ลากเพื่อจัดลำดับฟิลด์">⋮⋮</span>
        <span class="tpl-block-title">${escapeHtml(b.title || "ฟิลด์")}</span>
        <span class="tpl-block-count">${items.length} ข้อมูล</span>
        <span style="flex:1"></span>
        <button class="tpl-block-btn" title="แก้ชื่อฟิลด์" onclick="window.tplRenameBlock('${escapeHtml(b.id)}')">✏️</button>
        <button class="tpl-block-btn danger" title="${hasCore ? 'มีข้อมูลระบบ ลบไม่ได้' : 'ลบฟิลด์'}" onclick="window.tplDeleteBlock('${escapeHtml(b.id)}')" ${hasCore ? 'disabled' : ''}>🗑</button>
      </div>
      <div class="tpl-block-items">${itemsHtml}</div>
      <button class="tpl-additem-btn" onclick="window.openTplItemModal('${escapeHtml(b.id)}')">➕ เพิ่มข้อมูล</button>
    </div>`;
  }).join("");
}

function _renderBlockItem(blockId, it) {
  const AF = window.AttendeeFields;
  const meta = AF.ITEM_TYPES[it.type] || { icon: "•", label: it.type };
  const isCore = it.type === "core";
  const label = isCore
    ? (AF.CORE_FIELDS[it.key]?.label || it.key)
    : (it.type === "std" ? (it.label || AF.STD_FIELDS[it.key]?.label || it.key) : (it.label || it.key));
  const canReq = it.type === "std" || it.type === "text" || it.type === "date" || it.type === "number";
  return `<div class="tpl-item${isCore ? ' core' : ''}" data-key="${escapeHtml(it.key)}" draggable="${isCore ? 'false' : 'true'}"
      ondragstart="window._itemDragStart(event,'${escapeHtml(blockId)}','${escapeHtml(it.key)}')"
      ondragover="window._itemDragOver(event)"
      ondragleave="window._itemDragLeave(event)"
      ondrop="window._itemDrop(event,'${escapeHtml(blockId)}','${escapeHtml(it.key)}')"
      ondragend="window._itemDragEnd(event)">
    <span class="drag-handle">${isCore ? '🔒' : '⋮⋮'}</span>
    <span class="tpl-item-type" title="${meta.label}">${meta.icon}</span>
    <span class="tpl-item-label">${escapeHtml(label)}</span>
    ${isCore ? '<span class="tpl-item-lock">ระบบ</span>' : `
      ${canReq ? `<label class="tpl-item-req"><input type="checkbox" ${it.required ? 'checked' : ''} onchange="window.tplToggleItemReq('${escapeHtml(blockId)}','${escapeHtml(it.key)}',this.checked)">บังคับ*</label>` : ''}
      <button class="tpl-item-btn" title="แก้ชื่อหัวข้อ" onclick="window.tplRenameItem('${escapeHtml(blockId)}','${escapeHtml(it.key)}')">✏️</button>
      <button class="tpl-item-btn danger" title="ลบข้อมูล" onclick="window.tplDeleteItem('${escapeHtml(blockId)}','${escapeHtml(it.key)}')">🗑</button>`}
  </div>`;
}

// ── Block CRUD ─────────────────────────────────────────────
window.tplAddBlock = function () {
  _blocks.push({ id: window.AttendeeFields.newId("blk"), title: "ฟิลด์ใหม่", items: [] });
  renderBlocks();
};

window.tplRenameBlock = async function (id) {
  const b = _findBlock(id); if (!b) return;
  const next = await PromptModal.open({
    title: "แก้ชื่อฟิลด์", message: "ชื่อฟิลด์ (หัวข้อกลุ่มในฟอร์ม)", icon: "✏️",
    okText: "บันทึก", tone: "primary", defaultValue: b.title || "", required: true,
  });
  if (next == null || !next.trim()) return;
  b.title = next.trim();
  renderBlocks();
};

window.tplDeleteBlock = async function (id) {
  const b = _findBlock(id); if (!b) return;
  if ((b.items || []).some(it => it.type === "core")) {
    showToast("ฟิลด์นี้มีข้อมูลระบบ (รหัส/ชื่อ) — ลบไม่ได้", "error"); return;
  }
  const ok = await ConfirmModal.open({
    title: "ลบฟิลด์", message: `ลบฟิลด์ "${b.title}"?\nข้อมูลทั้งหมดในฟิลด์จะถูกลบด้วย`, icon: "🗑",
    okText: "ลบฟิลด์", cancelText: "ยกเลิก", tone: "danger",
  });
  if (!ok) return;
  _blocks = _blocks.filter(x => x.id !== id);
  renderBlocks();
};

// ── Item CRUD ──────────────────────────────────────────────
window.tplToggleItemReq = function (blockId, key, val) {
  const b = _findBlock(blockId); if (!b) return;
  const it = (b.items || []).find(x => x.key === key); if (!it) return;
  it.required = !!val;
};

window.tplRenameItem = async function (blockId, key) {
  const AF = window.AttendeeFields;
  const b = _findBlock(blockId); if (!b) return;
  const it = (b.items || []).find(x => x.key === key); if (!it) return;
  const cur = it.label || (it.type === "std" ? (AF.STD_FIELDS[it.key]?.label || "") : "");
  const next = await PromptModal.open({
    title: "แก้ชื่อหัวข้อ", message: `หัวข้อปัจจุบัน: "${cur}"`, icon: "✏️",
    okText: "บันทึก", tone: "primary", defaultValue: cur,
    placeholder: it.type === "std" ? "เว้นว่าง = ใช้ชื่อมาตรฐาน" : "",
  });
  if (next == null) return;
  const trimmed = next.trim();
  if (it.type === "std") {
    if (!trimmed || trimmed === AF.STD_FIELDS[it.key]?.label) delete it.label;
    else it.label = trimmed;
  } else {
    if (!trimmed) return;
    it.label = trimmed;
  }
  renderBlocks();
};

window.tplDeleteItem = function (blockId, key) {
  const b = _findBlock(blockId); if (!b) return;
  b.items = (b.items || []).filter(x => x.key !== key);
  renderBlocks();
};

// ── Add-item nested modal ──────────────────────────────────
let _itemTargetBlock = null;
let _itemType = null;
window.openTplItemModal = function (blockId) {
  _itemTargetBlock = blockId;
  _itemType = null;
  const types = [["std", "📋 มาตรฐาน"], ["text", "📝 ข้อความ"], ["date", "📅 วันที่"], ["number", "🔢 ตัวเลข"], ["check", "✓ ติ๊กถูก"]];
  document.getElementById("tplItemTypeRow").innerHTML = types.map(([t, l]) =>
    `<button type="button" class="tpl-itype" data-t="${t}" onclick="window._tplPickItemType('${t}')">${l}</button>`).join("");
  document.getElementById("tplItemStdWrap").style.display = "none";
  document.getElementById("tplItemLabelWrap").style.display = "none";
  document.getElementById("tplItemLabel").value = "";
  document.getElementById("tplItemOverlay").classList.add("open");
};

window._tplPickItemType = function (t) {
  _itemType = t;
  document.querySelectorAll("#tplItemTypeRow .tpl-itype").forEach(b => b.classList.toggle("active", b.dataset.t === t));
  const AF = window.AttendeeFields;
  const stdWrap = document.getElementById("tplItemStdWrap");
  const lblWrap = document.getElementById("tplItemLabelWrap");
  if (t === "std") {
    const used = AF.usedStdKeys(_blocks);
    const avail = AF.STD_ORDER.filter(k => !used.has(k));
    const sel = document.getElementById("tplItemStdSel");
    sel.innerHTML = avail.length
      ? avail.map(k => `<option value="${k}">${escapeHtml(AF.STD_FIELDS[k].label)}</option>`).join("")
      : '<option value="">— ใช้ครบทุกข้อมูลมาตรฐานแล้ว —</option>';
    stdWrap.style.display = "";
    lblWrap.style.display = "none";
  } else {
    stdWrap.style.display = "none";
    lblWrap.style.display = "";
    requestAnimationFrame(() => document.getElementById("tplItemLabel").focus());
  }
};

window.closeTplItemModal = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("tplItemOverlay").classList.remove("open");
  _itemTargetBlock = null;
  _itemType = null;
};

window.tplConfirmAddItem = function () {
  const AF = window.AttendeeFields;
  const b = _findBlock(_itemTargetBlock);
  if (!b) { window.closeTplItemModal(); return; }
  if (!_itemType) { showToast("เลือกชนิดข้อมูลก่อน", "error"); return; }
  if (!Array.isArray(b.items)) b.items = [];
  if (_itemType === "std") {
    const key = document.getElementById("tplItemStdSel").value;
    if (!key) { showToast("ไม่มีข้อมูลมาตรฐานเหลือให้เพิ่ม", "error"); return; }
    b.items.push({ type: "std", key, required: false });
  } else {
    const label = document.getElementById("tplItemLabel").value.trim();
    if (!label) { showToast("กรอกชื่อหัวข้อ", "error"); document.getElementById("tplItemLabel").focus(); return; }
    const prefix = _itemType === "check" ? "q_" : "cf_";
    let key = AF.slugKey(label, prefix);
    const used = new Set();
    _blocks.forEach(bb => (bb.items || []).forEach(it => used.add(it.key)));
    const base = key; let n = 2;
    while (used.has(key)) key = `${base}_${n++}`;
    const item = { type: _itemType, key, label };
    if (_itemType !== "check") item.required = false;
    b.items.push(item);
  }
  window.closeTplItemModal();
  renderBlocks();
};

// ── Drag: blocks ───────────────────────────────────────────
let _blkDragId = null;
window._blkDragStart = function (ev, id) {
  _blkDragId = id;
  ev.dataTransfer.effectAllowed = "move";
  try { ev.dataTransfer.setData("text/plain", id); } catch {}
  ev.currentTarget.classList.add("dragging");
};
window._blkDragOver = function (ev) {
  if (!_blkDragId) return;
  ev.preventDefault();
  ev.currentTarget.classList.add("drag-over");
};
window._blkDragLeave = function (ev) { ev.currentTarget.classList.remove("drag-over"); };
window._blkDragEnd = function (ev) {
  ev.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".tpl-block.drag-over").forEach(e => e.classList.remove("drag-over"));
  _blkDragId = null;
};
window._blkDrop = function (ev, targetId) {
  ev.preventDefault();
  ev.currentTarget.classList.remove("drag-over");
  if (!_blkDragId || _blkDragId === targetId) return;
  const from = _blocks.findIndex(b => b.id === _blkDragId);
  const to = _blocks.findIndex(b => b.id === targetId);
  if (from < 0 || to < 0) return;
  const [m] = _blocks.splice(from, 1);
  _blocks.splice(to, 0, m);
  _blkDragId = null;
  renderBlocks();
};

// ── Drag: items (รองรับย้ายข้าม block) ─────────────────────
let _itemDrag = null;  // { blockId, key }
window._itemDragStart = function (ev, blockId, key) {
  _itemDrag = { blockId, key };
  ev.dataTransfer.effectAllowed = "move";
  try { ev.dataTransfer.setData("text/plain", key); } catch {}
  ev.currentTarget.classList.add("dragging");
  ev.stopPropagation();
};
window._itemDragOver = function (ev) {
  if (!_itemDrag) return;
  ev.preventDefault();
  ev.stopPropagation();
  ev.currentTarget.classList.add("drag-over");
};
window._itemDragLeave = function (ev) { ev.currentTarget.classList.remove("drag-over"); };
window._itemDragEnd = function (ev) {
  ev.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".tpl-item.drag-over").forEach(e => e.classList.remove("drag-over"));
  _itemDrag = null;
};
window._itemDrop = function (ev, blockId, key) {
  ev.preventDefault();
  ev.stopPropagation();
  ev.currentTarget.classList.remove("drag-over");
  if (!_itemDrag) return;
  const src = _findBlock(_itemDrag.blockId);
  const dst = _findBlock(blockId);
  if (!src || !dst) return;
  const si = (src.items || []).findIndex(x => x.key === _itemDrag.key);
  if (si < 0) { _itemDrag = null; return; }
  const moved = src.items[si];
  src.items.splice(si, 1);
  let ti = (dst.items || []).findIndex(x => x.key === key);
  if (ti < 0) ti = dst.items.length;
  dst.items.splice(ti, 0, moved);
  _itemDrag = null;
  renderBlocks();
};

// ── Save / Delete / Toggle ─────────────────────────────────
window.saveTemplate = async function () {
  const id = document.getElementById("tplFormId").value;
  const name = document.getElementById("tplName").value.trim();
  if (!name) { showToast("กรุณาระบุชื่อ template", "error"); return; }
  _ensureCoreItems();
  // เก็บทั้ง blocks (layout) + flat (เพื่อ backward-compat กับตาราง/ฟอร์ม attendees)
  const flat = window.AttendeeFields.blocksToFlat(_blocks);
  const config = { ...flat, blocks: _blocks };
  const payload = {
    name,
    description: document.getElementById("tplDesc").value.trim() || null,
    config,
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

// ⭐ ตั้ง/ยกเลิก Default — ได้แค่ตัวเดียว (เคลียร์ตัวเดิมก่อนเสมอ)
window.setDefaultTemplate = async function (id, makeDefault) {
  try {
    if (makeDefault) {
      // เคลียร์ default เดิม (กัน unique index ชน) แล้วตั้งตัวใหม่ + บังคับเปิดใช้งาน
      await sbFetch("attendee_form_templates", "?is_default=eq.true",
        { method: "PATCH", body: { is_default: false } });
      await sbFetch("attendee_form_templates", `?id=eq.${id}`,
        { method: "PATCH", body: { is_default: true, is_active: true } });
      showToast("ตั้งเป็น Default แล้ว ⭐ (ใช้กับทุกงาน)", "success");
    } else {
      await sbFetch("attendee_form_templates", `?id=eq.${id}`,
        { method: "PATCH", body: { is_default: false } });
      showToast("ยกเลิก Default แล้ว", "success");
    }
    await loadTemplates();
  } catch (e) {
    showToast("ตั้ง Default ไม่สำเร็จ: " + e.message, "error");
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
