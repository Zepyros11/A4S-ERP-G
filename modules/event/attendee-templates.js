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
  qualifications: [],
};

let _allTemplates = [];
let _usageCounts = {};          // { template_id: number_of_events }
let _draft = null;              // working copy of config in modal

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
  if (!_allTemplates.length) {
    tb.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:30px">
      <div class="empty-icon">📋</div>
      <div class="empty-text">ยังไม่มีเทมเพลต — กด "เพิ่มเทมเพลต"</div>
    </div></td></tr>`;
    return;
  }
  tb.innerHTML = _allTemplates.map((t, i) => {
    const cfg = t.config || {};
    const fieldsCount = cfg.fields
      ? Object.values(cfg.fields).filter(f => f && f.show !== false).length
      : 0;
    const qualsCount = Array.isArray(cfg.qualifications) ? cfg.qualifications.length : 0;
    const usage = _usageCounts[t.id] || 0;
    return `<tr>
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
}

// ── Modal ──────────────────────────────────────────────────
window.openTemplateModal = function (id) {
  const t = id ? _allTemplates.find(x => x.id === id) : null;
  _draft = t ? JSON.parse(JSON.stringify(t.config || DEFAULT_CONFIG)) : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!_draft.fields) _draft.fields = JSON.parse(JSON.stringify(DEFAULT_CONFIG.fields));
  if (!Array.isArray(_draft.qualifications)) _draft.qualifications = [];

  document.getElementById("tplFormId").value = t?.id || "";
  document.getElementById("tplName").value = t?.name || "";
  document.getElementById("tplDesc").value = t?.description || "";
  document.getElementById("tplIsActive").checked = t ? !!t.is_active : true;
  document.getElementById("tplModalTitle").textContent = t ? `✏️ แก้ไข — ${t.name}` : "➕ เพิ่มเทมเพลต";

  renderFields();
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
  grid.innerHTML = Object.keys(FIELD_LABELS).map(key => {
    const f = _draft.fields[key] || {};
    const show = f.show !== false;
    const req = f.required === true;
    return `<div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:7px 10px;font-size:12.5px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">
        <input type="checkbox" ${show ? "checked" : ""} onchange="window.tplToggleShow('${key}', this.checked)"
          style="width:16px;height:16px;cursor:pointer">
        <span style="${show ? 'color:#0f172a' : 'color:#94a3b8;text-decoration:line-through'}">${FIELD_LABELS[key]}</span>
      </label>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:#92400e">
        <input type="checkbox" ${req ? "checked" : ""} ${show ? "" : "disabled"} onchange="window.tplToggleReq('${key}', this.checked)"
          style="width:14px;height:14px;cursor:pointer">
        บังคับ*
      </label>
    </div>`;
  }).join("");
}

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
    <div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px">
      <span style="font-size:11px;font-weight:700;color:#64748b;font-family:'IBM Plex Mono',monospace;min-width:24px">${i + 1}.</span>
      <span style="flex:1;font-size:12.5px;color:#0f172a">${escapeHtml(q.label)}</span>
      <span style="font-size:10px;color:#7c2d12;background:#fed7aa;padding:1px 6px;border-radius:4px;font-family:'IBM Plex Mono',monospace" title="key">${escapeHtml(q.key)}</span>
      <button onclick="window.tplRemoveQual(${i})" title="ลบ"
        style="background:#fef2f2;color:#b91c1c;border:none;border-radius:4px;padding:3px 7px;font-size:12px;cursor:pointer">🗑</button>
    </div>
  `).join("");
}

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
  const warn = usage > 0
    ? `\n\n⚠️ มี ${usage} event ที่ใช้ template นี้ — จะ unlink (FK SET NULL) แต่ override ของ event ยังอยู่`
    : "";
  if (!confirm(`ลบ template "${t.name}"?${warn}`)) return;
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
  const newName = prompt(`ทำสำเนา "${t.name}" → ตั้งชื่อใหม่:`, t.name + " (copy)");
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
