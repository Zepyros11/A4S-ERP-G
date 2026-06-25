/* ============================================================
   survey-forms.js — Master CRUD for survey_forms (แบบประเมินความพอใจ)
   ------------------------------------------------------------
   · สร้าง/แก้ฟอร์มประเมิน (reusable) เก็บคำถามใน questions JSONB
   · แต่ละ event เลือกผูกฟอร์มในหน้า event-form (events.survey_form_id)
   · public link/QR ให้ผู้เข้าร่วมตอบ (survey-fill.html · ไม่ login)
============================================================ */

// ชนิดคำถาม — ตรงกับที่ survey-fill.js render
const Q_TYPES = {
  rating:      { icon: "⭐", label: "ให้คะแนน" },
  choice:      { icon: "🔘", label: "ตัวเลือกเดียว" },
  multichoice: { icon: "☑️", label: "หลายตัวเลือก" },
  text:        { icon: "📝", label: "ข้อความสั้น" },
  textarea:    { icon: "📄", label: "ข้อความยาว" },
  number:      { icon: "🔢", label: "ตัวเลข" },
};

const PUBLIC_BASE = "https://zepyros11.github.io/A4S-ERP-G";

let _allForms = [];
let _usageCounts = {};      // { form_id: number_of_events }
let _responseCounts = {};   // { form_id: number_of_responses }
let _selectedIds = new Set();
let _questions = [];        // working copy ในโมดอล builder

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

function newQid() {
  return "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function newToken() {
  return "sf" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function buildSurveyUrl(token) {
  const host = location.hostname;
  let base;
  if (host.includes("github.io")) {
    base = `${location.origin}/${location.pathname.split("/")[1]}`;
  } else if (host === "127.0.0.1" || host === "localhost") {
    base = PUBLIC_BASE;
  } else {
    base = location.origin;
  }
  return `${base}/modules/event/survey-fill.html?form=${token}`;
}

// ── Load + render list ─────────────────────────────────────
async function loadForms() {
  try {
    const [forms, events, responses] = await Promise.all([
      sbFetch("survey_forms",
        "?select=id,title,description,intro_text,thank_you_text,questions,public_token,is_active,created_at&order=id.desc"),
      sbFetch("events", "?select=survey_form_id&survey_form_id=not.is.null"),
      sbFetch("survey_responses", "?select=form_id"),
    ]);
    _allForms = forms || [];
    _usageCounts = {};
    (events || []).forEach(e => {
      if (e.survey_form_id) _usageCounts[e.survey_form_id] = (_usageCounts[e.survey_form_id] || 0) + 1;
    });
    _responseCounts = {};
    (responses || []).forEach(r => {
      if (r.form_id) _responseCounts[r.form_id] = (_responseCounts[r.form_id] || 0) + 1;
    });
    renderTable();
  } catch (e) {
    showToast("โหลดฟอร์มไม่สำเร็จ: " + e.message, "error");
  }
}

function renderTable() {
  const tb = document.getElementById("sfTableBody");
  document.getElementById("sfCount").textContent = `${_allForms.length} รายการ`;
  const aliveIds = new Set(_allForms.map(f => f.id));
  _selectedIds.forEach(id => { if (!aliveIds.has(id)) _selectedIds.delete(id); });
  if (!_allForms.length) {
    tb.innerHTML = `<tr><td colspan="9"><div class="empty-state" style="padding:30px">
      <div class="empty-icon">📝</div>
      <div class="empty-text">ยังไม่มีฟอร์ม — กด "สร้างฟอร์มประเมิน"</div>
    </div></td></tr>`;
    updateBulkBar();
    return;
  }
  tb.innerHTML = _allForms.map((f, i) => {
    const qCount = Array.isArray(f.questions) ? f.questions.length : 0;
    const usage = _usageCounts[f.id] || 0;
    const resp = _responseCounts[f.id] || 0;
    const checked = _selectedIds.has(f.id) ? "checked" : "";
    const rowStyle = checked ? ' style="background:#f0fdf4"' : '';
    return `<tr${rowStyle}>
      <td class="col-center">
        <input type="checkbox" class="sf-row-check" data-id="${f.id}" ${checked}
          onclick="window.sfToggleRow(${f.id}, this.checked)"
          style="width:16px;height:16px;cursor:pointer;accent-color:#16a34a">
      </td>
      <td class="col-center" style="font-family:'IBM Plex Mono',monospace;color:var(--text3)">${i + 1}</td>
      <td>
        <div style="font-weight:700;color:#0f172a">${escapeHtml(f.title)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;font-family:'IBM Plex Mono',monospace">id #${f.id}</div>
      </td>
      <td style="color:var(--text2);font-size:12.5px">${escapeHtml(f.description || "—")}</td>
      <td class="col-center">
        <span style="background:#e0e7ff;color:#3730a3;padding:2px 9px;border-radius:5px;font-weight:700;font-size:12px">${qCount} ข้อ</span>
      </td>
      <td class="col-center">
        ${usage > 0
          ? `<span style="background:#d1fae5;color:#065f46;padding:2px 9px;border-radius:5px;font-weight:700;font-size:12px" title="event ที่ผูกฟอร์มนี้">🔗 ${usage}</span>`
          : `<span style="color:var(--text3);font-size:12px">—</span>`}
      </td>
      <td class="col-center">
        ${resp > 0
          ? `<span style="background:#fef3c7;color:#92400e;padding:2px 9px;border-radius:5px;font-weight:700;font-size:12px">📨 ${resp}</span>`
          : `<span style="color:var(--text3);font-size:12px">—</span>`}
      </td>
      <td class="col-center">
        <button onclick="window.toggleFormActive(${f.id}, ${!f.is_active})"
          style="background:${f.is_active ? '#dcfce7' : '#f1f5f9'};color:${f.is_active ? '#15803d' : '#64748b'};border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:700">
          ${f.is_active ? '● เปิด' : '○ ปิด'}
        </button>
      </td>
      <td class="col-center">
        <div class="action-group">
          <button class="btn-icon" onclick="window.openFormModal(${f.id})" title="แก้ไข">✏️</button>
          <button class="btn-icon" onclick="window.viewResults(${f.id})" title="ดูผลตอบกลับ">📊</button>
          <button class="btn-icon" onclick="window.openShare(${f.id})" title="ลิงก์/QR">🔗</button>
          <button class="btn-icon" onclick="window.duplicateForm(${f.id})" title="ทำสำเนา">📑</button>
          <button class="btn-icon danger" onclick="window.deleteForm(${f.id})" title="ลบ">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");
  updateBulkBar();
}

// ── Bulk select ────────────────────────────────────────────
function updateBulkBar() {
  const bar = document.getElementById("sfBulkBar");
  const cntEl = document.getElementById("sfBulkCount");
  const all = document.getElementById("sfSelectAll");
  const n = _selectedIds.size;
  if (bar) bar.style.display = n > 0 ? "inline-flex" : "none";
  if (cntEl) cntEl.textContent = `เลือก ${n} รายการ`;
  if (all) {
    const total = _allForms.length;
    all.checked = total > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
}
window.sfToggleRow = function (id, checked) {
  if (checked) _selectedIds.add(id); else _selectedIds.delete(id);
  renderTable();
};
window.sfToggleAll = function (checked) {
  if (checked) _allForms.forEach(f => _selectedIds.add(f.id)); else _selectedIds.clear();
  renderTable();
};
window.sfClearSelection = function () { _selectedIds.clear(); renderTable(); };

window.bulkDeleteForms = async function () {
  if (!_selectedIds.size) return;
  const ids = [..._selectedIds];
  const items = _allForms.filter(f => ids.includes(f.id));
  const usedItems = items.filter(f => (_usageCounts[f.id] || 0) > 0);
  const namesPreview = items.slice(0, 5).map(f => `• ${f.title}`).join("\n")
    + (items.length > 5 ? `\n…และอีก ${items.length - 5} รายการ` : "");
  const ok = await ConfirmModal.open({
    title: "ยืนยันการลบหลายฟอร์ม",
    message: `ลบ ${items.length} ฟอร์ม?\n\n${namesPreview}`,
    icon: "🗑", okText: `ลบ ${items.length} รายการ`, cancelText: "ยกเลิก", tone: "danger",
    note: usedItems.length
      ? `⚠️ มี <b>${usedItems.length}</b> ฟอร์มที่ event ใช้อยู่ — จะ unlink event (FK SET NULL) และ <b>ลบคำตอบทั้งหมด</b>ของฟอร์มด้วย`
      : "⚠️ คำตอบทั้งหมดของฟอร์มที่ลบจะถูกลบด้วย",
  });
  if (!ok) return;
  try {
    await sbFetch("survey_forms", `?id=in.(${ids.join(",")})`, { method: "DELETE" });
    showToast(`ลบ ${items.length} ฟอร์มแล้ว`, "success");
    _selectedIds.clear();
    await loadForms();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
};

// ══════════════════════════════════════════════════════════
//  FORM BUILDER MODAL
// ══════════════════════════════════════════════════════════
window.openFormModal = function (id) {
  const f = id ? _allForms.find(x => x.id === id) : null;
  _questions = f && Array.isArray(f.questions) ? JSON.parse(JSON.stringify(f.questions)) : [];

  document.getElementById("sfFormId").value = f?.id || "";
  document.getElementById("sfTitle").value = f?.title || "";
  document.getElementById("sfDesc").value = f?.description || "";
  document.getElementById("sfIntro").value = f?.intro_text || "";
  document.getElementById("sfThankYou").value = f?.thank_you_text || "";
  document.getElementById("sfIsActive").checked = f ? !!f.is_active : true;
  document.getElementById("sfModalTitle").textContent = f ? `✏️ แก้ไข — ${f.title}` : "➕ สร้างฟอร์มประเมิน";

  renderQuestions();
  document.getElementById("sfOverlay").classList.add("open");
  requestAnimationFrame(() => document.getElementById("sfTitle").focus());
};

window.closeFormModal = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("sfOverlay").classList.remove("open");
  _questions = [];
};

function renderQuestions() {
  const wrap = document.getElementById("sfQuestions");
  if (!wrap) return;
  wrap.innerHTML = _questions.map(q => {
    const meta = Q_TYPES[q.type] || { icon: "•", label: q.type };
    let detail = meta.label;
    if (q.type === "rating") detail += ` · 1–${q.scale_max || 5}`;
    if (q.type === "choice" || q.type === "multichoice")
      detail += ` · ${(q.options || []).length} ตัวเลือก`;
    return `<div class="sf-q" data-qid="${escapeHtml(q.id)}" draggable="true"
        ondragstart="window._qDragStart(event,'${escapeHtml(q.id)}')"
        ondragover="window._qDragOver(event)"
        ondragleave="window._qDragLeave(event)"
        ondrop="window._qDrop(event,'${escapeHtml(q.id)}')"
        ondragend="window._qDragEnd(event)">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
      <span class="sf-q-type-ic" title="${meta.label}">${meta.icon}</span>
      <div class="sf-q-body">
        <div class="sf-q-label">${escapeHtml(q.label)}</div>
        <div class="sf-q-meta">${detail}</div>
      </div>
      ${q.required ? '<span class="sf-q-req">บังคับ</span>' : ''}
      <div class="sf-q-btns">
        <button class="sf-q-btn" title="แก้ไข" onclick="window.sfEditQuestion('${escapeHtml(q.id)}')">✏️</button>
        <button class="sf-q-btn danger" title="ลบ" onclick="window.sfDeleteQuestion('${escapeHtml(q.id)}')">🗑</button>
      </div>
    </div>`;
  }).join("");
}

window.sfDeleteQuestion = function (qid) {
  _questions = _questions.filter(q => q.id !== qid);
  renderQuestions();
};

// ── Drag reorder ───────────────────────────────────────────
let _qDragId = null;
window._qDragStart = function (ev, id) {
  _qDragId = id;
  ev.dataTransfer.effectAllowed = "move";
  try { ev.dataTransfer.setData("text/plain", id); } catch {}
  ev.currentTarget.classList.add("dragging");
};
window._qDragOver = function (ev) {
  if (!_qDragId) return;
  ev.preventDefault();
  ev.currentTarget.classList.add("drag-over");
};
window._qDragLeave = function (ev) { ev.currentTarget.classList.remove("drag-over"); };
window._qDragEnd = function (ev) {
  ev.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".sf-q.drag-over").forEach(e => e.classList.remove("drag-over"));
  _qDragId = null;
};
window._qDrop = function (ev, targetId) {
  ev.preventDefault();
  ev.currentTarget.classList.remove("drag-over");
  if (!_qDragId || _qDragId === targetId) return;
  const from = _questions.findIndex(q => q.id === _qDragId);
  const to = _questions.findIndex(q => q.id === targetId);
  if (from < 0 || to < 0) return;
  const [m] = _questions.splice(from, 1);
  _questions.splice(to, 0, m);
  _qDragId = null;
  renderQuestions();
};

// ══════════════════════════════════════════════════════════
//  QUESTION EDITOR (nested modal)
// ══════════════════════════════════════════════════════════
let _qType = "rating";

function renderTypePicker() {
  const row = document.getElementById("sfQTypeRow");
  row.innerHTML = Object.entries(Q_TYPES).map(([t, m]) =>
    `<button type="button" class="sf-qtype${t === _qType ? ' active' : ''}" data-t="${t}" onclick="window.sfPickQType('${t}')">
      <span class="ic">${m.icon}</span>${escapeHtml(m.label)}
    </button>`).join("");
}

function syncQTypeFields() {
  document.getElementById("sfQOptionsWrap").style.display =
    (_qType === "choice" || _qType === "multichoice") ? "" : "none";
  document.getElementById("sfQScaleWrap").style.display = (_qType === "rating") ? "" : "none";
}

window.sfPickQType = function (t) {
  _qType = t;
  renderTypePicker();
  syncQTypeFields();
};

window.sfOpenQuestionPicker = function () {
  document.getElementById("sfQEditId").value = "";
  document.getElementById("sfQTitle").textContent = "➕ เพิ่มคำถาม";
  _qType = "rating";
  document.getElementById("sfQLabel").value = "";
  document.getElementById("sfQOptions").value = "";
  document.getElementById("sfQScaleMax").value = "5";
  document.getElementById("sfQScaleStyle").value = "star";
  document.getElementById("sfQScaleMinLabel").value = "";
  document.getElementById("sfQScaleMaxLabel").value = "";
  document.getElementById("sfQRequired").checked = true;
  renderTypePicker();
  syncQTypeFields();
  document.getElementById("sfQOverlay").classList.add("open");
  requestAnimationFrame(() => document.getElementById("sfQLabel").focus());
};

window.sfEditQuestion = function (qid) {
  const q = _questions.find(x => x.id === qid);
  if (!q) return;
  document.getElementById("sfQEditId").value = qid;
  document.getElementById("sfQTitle").textContent = "✏️ แก้ไขคำถาม";
  _qType = q.type;
  document.getElementById("sfQLabel").value = q.label || "";
  document.getElementById("sfQOptions").value = (q.options || []).join("\n");
  document.getElementById("sfQScaleMax").value = String(q.scale_max || 5);
  document.getElementById("sfQScaleStyle").value = q.scale_style || "star";
  document.getElementById("sfQScaleMinLabel").value = q.scale_min_label || "";
  document.getElementById("sfQScaleMaxLabel").value = q.scale_max_label || "";
  document.getElementById("sfQRequired").checked = q.required !== false;
  renderTypePicker();
  syncQTypeFields();
  document.getElementById("sfQOverlay").classList.add("open");
  requestAnimationFrame(() => document.getElementById("sfQLabel").focus());
};

window.sfCloseQuestionEditor = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("sfQOverlay").classList.remove("open");
};

window.sfConfirmQuestion = function () {
  const label = document.getElementById("sfQLabel").value.trim();
  if (!label) { showToast("กรอกคำถามก่อน", "error"); document.getElementById("sfQLabel").focus(); return; }

  const q = { type: _qType, label, required: document.getElementById("sfQRequired").checked };

  if (_qType === "choice" || _qType === "multichoice") {
    const opts = document.getElementById("sfQOptions").value
      .split("\n").map(s => s.trim()).filter(Boolean);
    if (opts.length < 2) { showToast("ใส่ตัวเลือกอย่างน้อย 2 ข้อ (บรรทัดละ 1)", "error"); return; }
    q.options = opts;
  } else if (_qType === "rating") {
    q.scale_max = parseInt(document.getElementById("sfQScaleMax").value) || 5;
    q.scale_style = document.getElementById("sfQScaleStyle").value || "star";
    const minL = document.getElementById("sfQScaleMinLabel").value.trim();
    const maxL = document.getElementById("sfQScaleMaxLabel").value.trim();
    if (minL) q.scale_min_label = minL;
    if (maxL) q.scale_max_label = maxL;
  }

  const editId = document.getElementById("sfQEditId").value;
  if (editId) {
    const idx = _questions.findIndex(x => x.id === editId);
    if (idx >= 0) { q.id = editId; _questions[idx] = q; }
  } else {
    q.id = newQid();
    _questions.push(q);
  }
  document.getElementById("sfQOverlay").classList.remove("open");
  renderQuestions();
};

// ── Save / Delete / Toggle / Duplicate ─────────────────────
window.saveForm = async function () {
  const id = document.getElementById("sfFormId").value;
  const title = document.getElementById("sfTitle").value.trim();
  if (!title) { showToast("กรุณาระบุชื่อฟอร์ม", "error"); return; }
  if (!_questions.length) { showToast("เพิ่มคำถามอย่างน้อย 1 ข้อ", "error"); return; }

  const payload = {
    title,
    description: document.getElementById("sfDesc").value.trim() || null,
    intro_text: document.getElementById("sfIntro").value.trim() || null,
    thank_you_text: document.getElementById("sfThankYou").value.trim() || null,
    questions: _questions,
    is_active: document.getElementById("sfIsActive").checked,
  };
  try {
    if (id) {
      await sbFetch("survey_forms", `?id=eq.${id}`, { method: "PATCH", body: payload });
      showToast("บันทึกฟอร์มแล้ว ✏️", "success");
    } else {
      const me = window.Auth?.getUser?.() || window.currentUser || null;
      await sbFetch("survey_forms", "", {
        method: "POST",
        body: { ...payload, public_token: newToken(), created_by: me?.full_name || me?.username || null },
      });
      showToast("สร้างฟอร์มแล้ว ➕", "success");
    }
    window.closeFormModal();
    await loadForms();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

window.deleteForm = async function (id) {
  const f = _allForms.find(x => x.id === id);
  if (!f) return;
  const usage = _usageCounts[id] || 0;
  const resp = _responseCounts[id] || 0;
  const ok = await ConfirmModal.open({
    title: "ยืนยันการลบฟอร์ม",
    message: `ลบฟอร์ม "${f.title}"?`,
    icon: "🗑", okText: "ลบฟอร์ม", cancelText: "ยกเลิก", tone: "danger",
    note: (usage > 0 || resp > 0)
      ? `⚠️ ${usage > 0 ? `มี <b>${usage}</b> event ผูกฟอร์มนี้ (จะ unlink) · ` : ""}${resp > 0 ? `<b>${resp}</b> คำตอบจะถูกลบด้วย` : ""}`
      : null,
  });
  if (!ok) return;
  try {
    await sbFetch("survey_forms", `?id=eq.${id}`, { method: "DELETE" });
    showToast("ลบฟอร์มแล้ว", "success");
    await loadForms();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
};

window.toggleFormActive = async function (id, active) {
  try {
    await sbFetch("survey_forms", `?id=eq.${id}`, { method: "PATCH", body: { is_active: active } });
    await loadForms();
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error");
  }
};

window.duplicateForm = async function (id) {
  const f = _allForms.find(x => x.id === id);
  if (!f) return;
  const newTitle = await PromptModal.open({
    title: "ทำสำเนาฟอร์ม", message: `จาก "${f.title}" → ตั้งชื่อใหม่:`,
    icon: "📑", okText: "ทำสำเนา", tone: "primary",
    defaultValue: f.title + " (copy)", required: true,
  });
  if (!newTitle || !newTitle.trim()) return;
  try {
    await sbFetch("survey_forms", "", {
      method: "POST",
      body: {
        title: newTitle.trim(),
        description: f.description,
        intro_text: f.intro_text,
        thank_you_text: f.thank_you_text,
        questions: f.questions,
        public_token: newToken(),
        is_active: true,
      },
    });
    showToast(`ทำสำเนาเป็น "${newTitle.trim()}" แล้ว`, "success");
    await loadForms();
  } catch (e) {
    showToast("ทำสำเนาไม่สำเร็จ: " + e.message, "error");
  }
};

window.viewResults = function (id) {
  location.href = `./survey-results.html?form_id=${id}`;
};

// ── Share (standalone link + QR) ───────────────────────────
window.openShare = function (id) {
  const f = _allForms.find(x => x.id === id);
  if (!f) return;
  if (!f.public_token) { showToast("ฟอร์มนี้ยังไม่มีลิงก์ — แก้ไขแล้วบันทึกก่อน", "warning"); return; }
  const url = buildSurveyUrl(f.public_token);
  document.getElementById("sfShareName").textContent = f.title;
  document.getElementById("sfShareUrl").value = url;
  document.getElementById("sfSharePreview").href = url;
  const wrap = document.getElementById("sfShareQr");
  wrap.innerHTML = "";
  if (window.QRCode) {
    new QRCode(wrap, { text: url, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  } else {
    wrap.textContent = "QR library ยังไม่โหลด — รีเฟรชหน้า";
  }
  document.getElementById("sfShareOverlay").classList.add("open");
};
window.sfCloseShare = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("sfShareOverlay").classList.remove("open");
};
window.sfCopyShare = async function () {
  const input = document.getElementById("sfShareUrl");
  const url = input.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast("คัดลอกลิงก์แล้ว 🔗", "success");
  } catch {
    input.select();
    document.execCommand("copy");
    showToast("คัดลอกแล้ว", "success");
  }
};

// ── Init ───────────────────────────────────────────────────
function _boot() {
  loadForms();
  const id = parseInt(new URLSearchParams(location.search).get("edit") || "", 10);
  if (!isNaN(id)) {
    // เปิด editor หลังโหลดเสร็จ
    const t = setInterval(() => {
      if (_allForms.some(f => f.id === id)) { clearInterval(t); window.openFormModal(id); }
    }, 150);
    setTimeout(() => clearInterval(t), 4000);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _boot);
} else {
  _boot();
}
