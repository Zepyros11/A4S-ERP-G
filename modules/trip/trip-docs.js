/* ============================================================
   trip-docs.js — Controller for หน้า "เอกสาร" (TRIP)
   ระบบเอกสารจากแม่แบบ: แม่แบบ {{placeholder}} → สร้างเอกสาร → กรอก/แก้ไข/พิมพ์
   Tables: trip_doc_templates, trip_documents  (migration 124)
   ============================================================ */

const state = {
  templates: [],          // trip_doc_templates
  docs: [],               // trip_documents
  signatories: [],        // trip_doc_signatories
  letterheads: [],        // trip_doc_letterheads
  company: {},            // app_settings company_* (logo/ชื่อ/ที่อยู่)
  tab: "docs",
  // create-doc flow
  pickedFields: [],       // placeholder names ของแม่แบบที่เลือก
  // editor
  editDocId: null,
  editTplId: null,
  // signatory manager
  editSigId: null,
  sigImgData: null,       // base64 data URL ที่กำลังแก้
  // letterhead manager
  editLhId: null,
  // excel import
  importRows: [],         // raw rows จาก Excel
  // selections
  selDocs: new Set(),
  selTpls: new Set(),
  // กลุ่มเอกสารที่ถูกพับ (key = template_id หรือ "none")
  collapsedGroups: new Set(),
  groupsInitialized: false, // ครั้งแรกให้พับทุกกลุ่ม
};

// ── หัวกระดาษ A4S (คงที่ทุกเอกสาร) ──────────────────────────
// default (fallback ถ้ายังไม่มี row ใน trip_doc_letterheads)
const LETTERHEAD = {
  logoUrl: "../../assets/logo/logo-a4s.png",
  nameEn: "A4S Can Corporation Co., Ltd.",
  addr:
    "Imperial World Ladprao 3rd Floor, Room AT 02-03, No. 2539 Khlong Chaokhun Sing,\n" +
    "Khet Wang Thonglang, Bangkok 10310.  Tel: 092-326-4946  Email: A4Sservice@gmail.com",
};

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
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  bindEvents();
  initRTE();
  await loadAll();

  // เปิดจาก custom-report (?doc_id=) → เปิด editor ฉบับนั้นทันที
  const openId = parseInt(new URLSearchParams(location.search).get("doc_id"), 10);
  if (Number.isFinite(openId) && state.docs.some((d) => d.doc_id === openId)) {
    window.openDocEdit(openId);
    history.replaceState(null, "", location.pathname); // กัน reopen ตอน refresh
  }
}

// ── RICH-TEXT EDITOR (contenteditable + toolbar) ───────────
function initRTE() {
  try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
  document.querySelectorAll(".rte-toolbar button[data-cmd]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // คง selection ไว้
    btn.addEventListener("click", () => {
      document.execCommand(btn.dataset.cmd, false, null);
      updateLhSimulator();
    });
  });
  // ปุ่มเพิ่ม/ลดขนาดฟอนต์
  document.querySelectorAll(".rte-toolbar button[data-font]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => rteFont(btn.dataset.font === "up" ? 2 : -2));
  });
  // ช่องพิมพ์ขนาด px
  document.querySelectorAll(".rte-size").forEach((inp) => {
    inp.addEventListener("change", () => {
      const px = parseInt(inp.value, 10);
      if (!px || !_lastArea) return;
      _lastArea.focus();
      restoreRteRange();
      applyFontPx(px);
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    });
  });
  // ช่องเลือกสีตัวอักษร
  document.querySelectorAll(".rte-color").forEach((inp) => {
    inp.addEventListener("input", () => {
      if (!_lastArea) return;
      _lastArea.focus();
      restoreRteRange();
      document.execCommand("foreColor", false, inp.value);
      updateLhSimulator();
    });
  });
  // ติดตาม selection → อัปเดตช่องขนาด + จำ range ไว้ (กันหลุดตอนคลิกช่อง px)
  document.addEventListener("selectionchange", onRteSelChange);
}

let _lastRteRange = null;
let _lastArea = null;

function anchorEl(sel) {
  const a = sel.anchorNode;
  return a && (a.nodeType === 3 ? a.parentElement : a);
}
function onRteSelChange() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const el = anchorEl(sel);
  const area = el && el.closest && el.closest(".rte-area");
  if (!area) return; // selection อยู่นอก editor → คง range เดิมไว้
  _lastRteRange = sel.getRangeAt(0).cloneRange();
  _lastArea = area;
  const cur = Math.round(parseFloat(getComputedStyle(el).fontSize) || 15);
  const box = area.parentElement.querySelector(".rte-size");
  if (box && document.activeElement !== box) box.value = cur;
}
function restoreRteRange() {
  if (!_lastRteRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(_lastRteRange);
}
// wrap selection เป็น span ขนาด px (รองรับเลือกข้ามบรรทัด)
function applyFontPx(px) {
  px = Math.min(96, Math.max(9, px | 0));
  // ปิด styleWithCSS ชั่วคราว → fontSize สร้าง <font size="7"> ให้เราแปลงเป็น px เอง
  // (ถ้าเปิดไว้ มันจะใส่ font-size:xx-large แทน ทำให้ขนาดโดด)
  document.execCommand("styleWithCSS", false, false);
  document.execCommand("fontSize", false, "7");
  document.querySelectorAll('.rte-area font[size="7"]').forEach((f) => {
    f.removeAttribute("size");
    f.style.fontSize = px + "px";
  });
  document.execCommand("styleWithCSS", false, true); // คืนค่าให้ align ใช้ CSS
  onRteSelChange();
  updateLhSimulator();
}
// เพิ่ม/ลดขนาดฟอนต์ของข้อความที่เลือก (delta px)
function rteFont(delta) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) {
    showToast("เลือกข้อความที่ต้องการปรับขนาดก่อน", "error");
    return;
  }
  const el = anchorEl(sel);
  const cur = el ? parseFloat(getComputedStyle(el).fontSize) || 15 : 15;
  applyFontPx(Math.round(cur) + delta);
}
function getEditorHTML(id) {
  return document.getElementById(id)?.innerHTML || "";
}
function setEditorHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html || "";
}
function editorIsEmpty(id) {
  const el = document.getElementById(id);
  return !el || !el.textContent.trim();
}

async function loadAll() {
  showLoading(true);
  try {
    const [tpls, docs, sigs, lhs, comp] = await Promise.all([
      sbFetch("trip_doc_templates", "?select=*&order=updated_at.desc").catch(() => []),
      sbFetch("trip_documents", "?select=*&order=updated_at.desc").catch(() => []),
      sbFetch("trip_doc_signatories", "?select=*&order=name").catch(() => []),
      sbFetch("trip_doc_letterheads", "?select=*&order=letterhead_id").catch(() => []),
      sbFetch("app_settings", "?select=key,value&key=like.company_*").catch(() => []),
    ]);
    state.templates = tpls || [];
    state.docs = docs || [];
    state.signatories = sigs || [];
    state.letterheads = lhs || [];
    state.company = Object.fromEntries((comp || []).map((r) => [r.key, r.value]));
    populateTemplateFilter();
    updateStatCards();
    renderDocs();
    renderTemplates();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document.getElementById("docSearch")?.addEventListener("input", renderDocs);
  document.getElementById("docFilterTpl")?.addEventListener("change", renderDocs);
  document.getElementById("docFilterStatus")?.addEventListener("change", renderDocs);
  document.getElementById("tplSearch")?.addEventListener("input", renderTemplates);
}

// ── TABS ───────────────────────────────────────────────────
window.switchTab = function (tab) {
  state.tab = tab;
  document.querySelectorAll(".page-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  document.getElementById("tabDocs").style.display = tab === "docs" ? "" : "none";
  document.getElementById("tabTemplates").style.display = tab === "templates" ? "" : "none";
};

// ── STATS ──────────────────────────────────────────────────
function updateStatCards() {
  document.getElementById("cardTotalDocs").textContent = state.docs.length;
  document.getElementById("cardDraft").textContent =
    state.docs.filter((d) => d.status === "DRAFT").length;
  document.getElementById("cardFinal").textContent =
    state.docs.filter((d) => d.status === "FINAL").length;
  document.getElementById("cardTemplates").textContent = state.templates.length;
}

function populateTemplateFilter() {
  const sel = document.getElementById("docFilterTpl");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML =
    `<option value="">🧩 ทุกแม่แบบ</option>` +
    state.templates
      .map((t) => `<option value="${t.template_id}">${escapeHtml(t.name)}</option>`)
      .join("");
  sel.value = cur;
}

// ════════════════════════════════════════════════════════════
//   เอกสาร (DOCUMENTS)
// ════════════════════════════════════════════════════════════
function templateName(id) {
  const t = state.templates.find((x) => x.template_id === id);
  return t ? t.name : null;
}

function renderDocs() {
  const search = (document.getElementById("docSearch")?.value || "").toLowerCase();
  const tplF = document.getElementById("docFilterTpl")?.value || "";
  const statusF = document.getElementById("docFilterStatus")?.value || "";

  const rows = state.docs.filter((d) => {
    const matchSearch = !search || (d.title || "").toLowerCase().includes(search);
    const matchTpl = !tplF || String(d.template_id) === tplF;
    const matchStatus = !statusF || d.status === statusF;
    return matchSearch && matchTpl && matchStatus;
  });

  const tbody = document.getElementById("docTableBody");
  document.getElementById("docCount").textContent = `${rows.length} รายการ`;
  const fmt = (window.DateFmt && window.DateFmt.formatDMYTime) || ((s) => s || "");

  if (!rows.length) {
    tbody.innerHTML = `
      <tr class="r-card-plain"><td colspan="6">
        <div class="empty-state"><div class="empty-icon">📄</div>
          <div class="empty-text">ยังไม่มีเอกสาร — กด "＋ สร้างเอกสาร" เพื่อเริ่ม</div></div>
      </td></tr>`;
    syncDocBulkBar();
    return;
  }

  // ── จัดกลุ่มตามแม่แบบ ──
  const groups = new Map();
  rows.forEach((d) => {
    const key = d.template_id != null ? String(d.template_id) : "none";
    if (!groups.has(key)) {
      groups.set(key, { key, name: templateName(d.template_id) || "— ไม่มีแม่แบบ —", docs: [], latest: "" });
    }
    const g = groups.get(key);
    g.docs.push(d);
    if ((d.updated_at || "") > g.latest) g.latest = d.updated_at || ""; // อัปเดตล่าสุดในกลุ่ม
  });
  // ครั้งแรก: พับทุกกลุ่มเป็น default
  if (!state.groupsInitialized) {
    groups.forEach((_, key) => state.collapsedGroups.add(key));
    state.groupsInitialized = true;
  }
  // เรียงกลุ่มตามอัปเดตล่าสุด (ใหม่สุดขึ้นบน)
  const ordered = [...groups.values()].sort((a, b) => (b.latest || "").localeCompare(a.latest || ""));

  let idx = 0;
  const parts = [];
  ordered.forEach((g) => {
    const collapsed = state.collapsedGroups.has(g.key);
    parts.push(`<tr class="doc-group r-card-plain" onclick="window.toggleDocGroup('${g.key}')">
      <td colspan="4">
        <span class="doc-group-toggle">${collapsed ? "▸" : "▾"}</span>
        🧩 ${escapeHtml(g.name)}
        <span class="doc-group-count">${g.docs.length}</span>
      </td>
      <td class="col-center" style="white-space:nowrap;font-size:12px;font-weight:600">${fmt(g.latest)}</td>
      <td></td>
    </tr>`);
    if (!collapsed) g.docs.forEach((d) => parts.push(docRowHtml(d, ++idx, fmt)));
  });
  tbody.innerHTML = parts.join("");

  if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(tbody);
  syncDocBulkBar();
}

// แถวเอกสาร 1 แถว (ไม่มีคอลัมน์แม่แบบ — ใช้หัวกลุ่มแทน)
function docRowHtml(d, idx, fmt) {
  const checked = state.selDocs.has(d.doc_id) ? "checked" : "";
  return `<tr>
    <td class="r-card-corner" style="text-align:center">
      <input type="checkbox" data-doc="${d.doc_id}" ${checked} onchange="window.toggleDoc(${d.doc_id}, this)" />
    </td>
    <td data-label="#" style="text-align:center;color:var(--text3);font-size:12px">${idx}</td>
    <td class="r-card-title"><div class="doc-name-cell">${escapeHtml(d.title || "—")}</div></td>
    <td class="col-center" data-label="สถานะ">
      <span class="doc-status-pill doc-status-${d.status || "DRAFT"}">${statusLabel(d.status)}</span>
    </td>
    <td class="col-center" data-label="อัปเดตล่าสุด" style="white-space:nowrap;color:var(--text2);font-size:12px">${fmt(d.updated_at)}</td>
    <td class="col-center" data-label="จัดการ" onclick="event.stopPropagation()">
      <div class="action-group">
        <button class="btn-icon" title="พิมพ์/ดู" onclick="window.printDoc(${d.doc_id})">🖨</button>
        <button class="btn-icon" title="แก้ไข" data-perm="trip_docs_edit" onclick="window.openDocEdit(${d.doc_id})">✏️</button>
        <button class="btn-icon danger" title="ลบ" data-perm="trip_docs_delete" onclick="window.deleteDoc(${d.doc_id})">🗑</button>
      </div>
    </td>
  </tr>`;
}

window.toggleDocGroup = function (key) {
  if (state.collapsedGroups.has(key)) state.collapsedGroups.delete(key);
  else state.collapsedGroups.add(key);
  renderDocs();
}

function statusLabel(s) {
  return { DRAFT: "📝 ฉบับร่าง", FINAL: "✅ เสร็จสมบูรณ์" }[s] || s || "DRAFT";
}

// ── DOC multi-select ───────────────────────────────────────
window.toggleDoc = function (id, el) {
  if (el.checked) state.selDocs.add(id);
  else state.selDocs.delete(id);
  syncDocBulkBar();
};
window.toggleAllDocs = function (el) {
  document.querySelectorAll("#docTableBody input[data-doc]").forEach((cb) => {
    cb.checked = el.checked;
    const id = +cb.dataset.doc;
    if (el.checked) state.selDocs.add(id);
    else state.selDocs.delete(id);
  });
  syncDocBulkBar();
};
window.clearDocSelection = function () {
  state.selDocs.clear();
  document.getElementById("docCheckAll").checked = false;
  renderDocs();
};
function syncDocBulkBar() {
  const bar = document.getElementById("docsBulkBar");
  const n = state.selDocs.size;
  bar.classList.toggle("show", n > 0);
  document.getElementById("docsBulkCount").textContent = `เลือก ${n} รายการ`;
}
window.bulkDeleteDocs = function () {
  const ids = [...state.selDocs];
  if (!ids.length) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const run = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_documents", `?doc_id=in.(${ids.join(",")})`, { method: "DELETE" });
      showToast(`ลบเอกสาร ${ids.length} รายการแล้ว`, "success");
      state.selDocs.clear();
      await loadAll();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  opener
    ? opener(`ต้องการลบเอกสาร ${ids.length} รายการที่เลือกหรือไม่?`, run)
    : run();
};
window.deleteDoc = function (id) {
  const d = state.docs.find((x) => x.doc_id === id);
  if (!d) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const run = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_documents", `?doc_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบเอกสารแล้ว", "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  opener ? opener(`ต้องการลบเอกสาร "${d.title}" หรือไม่?`, run) : run();
};

// ── CREATE DOC (เลือกแม่แบบ → กรอกฟิลด์) ───────────────────
window.openCreateDoc = function () {
  const sel = document.getElementById("cdTemplate");
  sel.innerHTML =
    `<option value="">— เริ่มจากเอกสารเปล่า —</option>` +
    state.templates
      .map((t) => `<option value="${t.template_id}">${escapeHtml(t.name)}</option>`)
      .join("");
  sel.value = "";
  document.getElementById("cdTitle").value = "";
  state.pickedFields = [];
  document.getElementById("cdFieldsWrap").innerHTML = "";
  document.getElementById("createDocOverlay").classList.add("open");
  setTimeout(() => document.getElementById("cdTitle").focus(), 50);
};
window.closeCreateDoc = function (e) {
  if (e && e.target.id !== "createDocOverlay") return;
  document.getElementById("createDocOverlay").classList.remove("open");
};
window.onPickTemplate = function () {
  const id = +document.getElementById("cdTemplate").value || null;
  const wrap = document.getElementById("cdFieldsWrap");
  if (!id) {
    state.pickedFields = [];
    wrap.innerHTML = "";
    return;
  }
  const t = state.templates.find((x) => x.template_id === id);
  if (!document.getElementById("cdTitle").value.trim()) {
    document.getElementById("cdTitle").value = t?.name || "";
  }
  state.pickedFields = extractFields(t?.body || "");
  if (!state.pickedFields.length) {
    wrap.innerHTML = `<div class="field-chips-empty">แม่แบบนี้ไม่มีช่องกรอกข้อมูล — กดสร้างเพื่อแก้ไขเนื้อหาได้เลย</div>`;
    return;
  }
  wrap.innerHTML =
    `<label class="form-label" style="margin-bottom:8px;display:block">กรอกข้อมูลในแม่แบบ</label>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">` +
    state.pickedFields
      .map(
        (f) => `<div class="form-group">
          <label class="form-label" style="font-size:12.5px">${escapeHtml(f)}</label>
          <input class="form-control" data-field="${escapeHtml(f)}" placeholder="${escapeHtml(f)}" autocomplete="off" />
        </div>`
      )
      .join("") +
    `</div>`;
};
window.createDoc = async function () {
  const title = document.getElementById("cdTitle").value.trim();
  if (!title) {
    showToast("กรุณากรอกชื่อเอกสาร", "error");
    return;
  }
  const tplId = +document.getElementById("cdTemplate").value || null;
  const t = tplId ? state.templates.find((x) => x.template_id === tplId) : null;

  // เก็บค่าฟิลด์ + render body
  const values = {};
  document.querySelectorAll("#cdFieldsWrap input[data-field]").forEach((inp) => {
    values[inp.dataset.field] = inp.value;
  });
  const body = renderTemplate(t?.body || "", values);

  const payload = {
    template_id: tplId,
    title,
    status: "DRAFT",
    field_values: values,
    body,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    const rows = await sbFetch("trip_documents", "", { method: "POST", body: payload });
    document.getElementById("createDocOverlay").classList.remove("open");
    await loadAll();
    const created = Array.isArray(rows) ? rows[0] : rows;
    if (created?.doc_id) window.openDocEdit(created.doc_id);
    showToast("สร้างเอกสารแล้ว", "success");
  } catch (e) {
    showToast("สร้างไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ── DOC EDITOR ─────────────────────────────────────────────
// แก้เอกสาร → ไปหน้าแก้ไขเต็มจอ (doc-editor.html) แทน modal เดิม
window.openDocEdit = function (id) {
  location.href = `./doc-editor.html?doc_id=${id}`;
};
// (เดิม: modal ในหน้านี้ — เก็บไว้เป็น fallback แต่ไม่ถูกเรียกแล้ว)
window._openDocEditModal = function (id) {
  const d = state.docs.find((x) => x.doc_id === id);
  if (!d) return;
  state.editDocId = id;
  document.getElementById("deTitle").value = d.title || "";
  document.getElementById("deStatus").value = d.status || "DRAFT";
  setEditorHTML("deBody", d.body);
  fillSignatorySelect("deSignatory", d.signatory_id);
  fillLetterheadSelect("deLetterhead", d.letterhead_id);
  document.getElementById("docEditTitle").textContent = "แก้ไขเอกสาร";
  // ปุ่ม 🔄 รีเฟรช — แสดงเฉพาะเอกสารที่สร้างจาก custom-report (มี data_bindings + บล็อกตาราง)
  const b = d.data_bindings;
  const hasBinding =
    b && b.source === "custom_report" && b.trip_id &&
    /data-doc-datablock/.test(d.body || "");
  const rbtn = document.getElementById("deRefreshBtn");
  if (rbtn) rbtn.style.display = hasBinding ? "" : "none";
  document.getElementById("docEditOverlay").classList.add("open");
};

// 🔄 รีเฟรชข้อมูลในตาราง — ดึงสดผ่าน engine กลาง แล้วแทนที่เฉพาะ [data-doc-datablock]
// (ข้อความเปิด/ปิด + หัวกระดาษ + ลายเซ็น ไม่เปลี่ยน) · ต้องกด 💾 บันทึกเพื่อจัดเก็บ
window.refreshDocData = async function () {
  const d = state.docs.find((x) => x.doc_id === state.editDocId);
  if (!d) return;
  const binding = d.data_bindings;
  if (!binding || !binding.trip_id) {
    showToast("เอกสารนี้ไม่ได้เชื่อมข้อมูลจาก custom-report", "error");
    return;
  }
  if (!window.TripReportData) {
    showToast("โหลด engine ไม่สำเร็จ (report-data-source.js)", "error");
    return;
  }
  const block = document.querySelector("#deBody [data-doc-datablock]");
  if (!block) {
    showToast("ไม่พบบล็อกตารางในเอกสาร (อาจถูกลบ) — สร้างใหม่จาก custom-report", "error");
    return;
  }
  showLoading(true);
  try {
    const { html, rowCount } = await window.TripReportData.buildLetterTable(binding);
    block.innerHTML = html;
    showToast(`รีเฟรชข้อมูลแล้ว (${rowCount} รายการ) — กด 💾 บันทึก เพื่อจัดเก็บ`, "success");
  } catch (e) {
    showToast("รีเฟรชไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// เติม <option> ผู้ลงนามใน select ที่ระบุ
function fillSignatorySelect(selId, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML =
    `<option value="">— ไม่มีลายเซ็น —</option>` +
    state.signatories
      .map(
        (s) =>
          `<option value="${s.signatory_id}">${escapeHtml(s.name)}${
            s.title ? " — " + escapeHtml(s.title) : ""
          }</option>`
      )
      .join("");
  sel.value = selectedId != null ? String(selectedId) : "";
}

// เติม <option> หัวกระดาษใน select ที่ระบุ
function fillLetterheadSelect(selId, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML =
    `<option value="">— หัวเริ่มต้น —</option>` +
    state.letterheads
      .map((l) => `<option value="${l.letterhead_id}">${escapeHtml(l.name)}</option>`)
      .join("");
  sel.value = selectedId != null ? String(selectedId) : "";
}
window.closeDocEdit = function (e) {
  if (e && e.target.id !== "docEditOverlay") return;
  document.getElementById("docEditOverlay").classList.remove("open");
  state.editDocId = null;
};
window.saveDoc = async function () {
  if (!state.editDocId) return;
  const title = document.getElementById("deTitle").value.trim();
  if (!title) {
    showToast("กรุณากรอกชื่อเอกสาร", "error");
    return;
  }
  const payload = {
    title,
    status: document.getElementById("deStatus").value || "DRAFT",
    signatory_id: +document.getElementById("deSignatory").value || null,
    letterhead_id: +document.getElementById("deLetterhead").value || null,
    body: getEditorHTML("deBody"),
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    await sbFetch("trip_documents", `?doc_id=eq.${state.editDocId}`, {
      method: "PATCH",
      body: payload,
    });
    document.getElementById("docEditOverlay").classList.remove("open");
    state.editDocId = null;
    await loadAll();
    showToast("บันทึกเอกสารแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ── COMPOSE / PREVIEW / PRINT ──────────────────────────────
// หาหัวกระดาษที่จะใช้ (id → row · null → ตัวแรก · ไม่มีเลย → default const)
function resolveLetterhead(id) {
  if (id) {
    const f = state.letterheads.find((l) => l.letterhead_id === +id);
    if (f) return f;
  }
  // ไม่ระบุ → ใช้หัว default · ไม่งั้น row แรก
  const def = state.letterheads.find((l) => l.is_default);
  if (def) return def;
  if (state.letterheads.length) return state.letterheads[0];
  return { logo_data: null, company_name: LETTERHEAD.nameEn, address: LETTERHEAD.addr };
}

// แปลงข้อมูลหัวเก่า (company_name/address) → HTML (fallback ถ้าไม่มี content_html)
function legacyLetterheadHtml(l) {
  return (
    `<div style="font-weight:700;font-size:16px;color:#111">${escapeHtml(l.company_name || LETTERHEAD.nameEn)}</div>` +
    `<div style="font-size:12.5px;line-height:1.6;color:#222;white-space:pre-line">${escapeHtml(l.address || LETTERHEAD.addr)}</div>`
  );
}

// โลโก้บริษัท (จากตั้งค่าบริษัท) → fallback asset A4S
function companyLogoUrl() {
  return (state.company && state.company.company_logo_url) || LETTERHEAD.logoUrl;
}
// สร้างเนื้อหาหัวกระดาษจากข้อมูลบริษัท (app_settings)
function companyLetterheadHtml() {
  const c = state.company || {};
  const name = c.company_name_en || c.company_name || "";
  const addr = c.company_address_en || c.company_address || "";
  const contact = [
    c.company_phone ? `Tel: ${c.company_phone}` : "",
    c.company_email ? `Email: ${c.company_email}` : "",
    c.company_website ? `Website: ${c.company_website}` : "",
  ].filter(Boolean).join(" | ");
  return (
    `<div style="font-weight:700;font-size:18px;color:#2e9e2e">${escapeHtml(name)}</div>` +
    (addr ? `<div style="font-size:13px;line-height:1.55;color:#222">${escapeHtml(addr)}</div>` : "") +
    (contact ? `<div style="font-size:13px;color:#222">${escapeHtml(contact)}</div>` : "")
  );
}

// สร้าง HTML หัวกระดาษ (ใช้ร่วมทั้งเอกสารจริง + simulator → WYSIWYG)
function buildLetterheadHead(lh) {
  const logoSrc = lh.logo_data || companyLogoUrl();
  const contentHtml =
    lh.content_html && lh.content_html.trim() ? lh.content_html : legacyLetterheadHtml(lh);
  const pos = lh.logo_position || "left";
  const lw = +lh.logo_width || 120;
  const logoImg = logoSrc
    ? `<img src="${logoSrc}" alt="logo" crossorigin="anonymous" style="max-width:${lw}px;max-height:${Math.round(lw * 0.8)}px;height:auto" onerror="this.style.display='none'" />`
    : "";
  const valign = lh.logo_valign || "top";
  const ai = valign === "center" ? "center" : valign === "bottom" ? "flex-end" : "flex-start";
  if (pos === "top") {
    return `<div class="doc-letterhead" style="flex-direction:column;align-items:center;gap:8px">
        <div class="lh-logo" style="width:auto;text-align:center">${logoImg}</div>
        <div class="lh-info" style="text-align:center">${contentHtml}</div>
      </div>`;
  }
  const dir = pos === "right" ? "row-reverse" : "row";
  return `<div class="doc-letterhead" style="flex-direction:${dir};align-items:${ai}">
      <div class="lh-logo" style="width:${lw}px">${logoImg}</div>
      <div class="lh-info">${contentHtml}</div>
    </div>`;
}

// ประกอบ HTML ของเอกสารเต็ม: หัวกระดาษ + เนื้อหา + บล็อกลายเซ็น
function composeDocHtml(body, signatoryId, letterheadId) {
  const lh = resolveLetterhead(letterheadId);
  const head = buildLetterheadHead(lh);

  // body เป็น HTML (rich-text) แล้ว → inject ตรงๆ
  const bodyHtml = `<div class="doc-body">${body || ""}</div>`;

  let sigHtml = "";
  const sig = signatoryId
    ? state.signatories.find((s) => s.signatory_id === +signatoryId)
    : null;
  if (sig) {
    const img = sig.signature_data
      ? `<img src="${sig.signature_data}" alt="signature" />`
      : `<div class="sig-line"></div>`;
    sigHtml = `
      <div class="doc-signature">
        ${img}
        <div class="sig-name">(${escapeHtml(sig.name)})</div>
        ${sig.title ? `<div class="sig-title">${escapeHtml(sig.title)}</div>` : ""}
      </div>`;
  }

  return head + bodyHtml + sigHtml;
}

// state ของ preview ปัจจุบัน (สำหรับปุ่มพิมพ์)
let _previewTitle = "เอกสาร";

function showPreview(title, body, signatoryId, letterheadId) {
  _previewTitle = title || "เอกสาร";
  document.getElementById("previewPaper").innerHTML = composeDocHtml(body, signatoryId, letterheadId);
  document.getElementById("previewOverlay").classList.add("open");
}

window.previewDocFromEditor = function () {
  showPreview(
    document.getElementById("deTitle").value,
    getEditorHTML("deBody"),
    +document.getElementById("deSignatory").value || null,
    +document.getElementById("deLetterhead").value || null
  );
};
window.printDoc = function (id) {
  const d = state.docs.find((x) => x.doc_id === id);
  if (!d) return;
  showPreview(d.title, d.body, d.signatory_id, d.letterhead_id);
};
window.closePreview = function (e) {
  if (e && e.target.id !== "previewOverlay") return;
  document.getElementById("previewOverlay").classList.remove("open");
};
window.printPreview = function () {
  const src = document.getElementById("previewPaper");
  const pp = document.getElementById("printPaper");
  pp.innerHTML = src.innerHTML;
  // เอกสารที่สูงเกิน A4 นิดหน่อย (≤15%) → ย่อให้พอดี 1 หน้า กันตกไปหน้า 2
  // ใช้ "อัตราส่วน" (สูง/กว้าง) ซึ่งไม่ขึ้นกับ CSS zoom ของแอป
  const a4Ratio = 297 / 210;
  const ratio = src.offsetHeight / src.offsetWidth;
  pp.style.zoom =
    ratio > a4Ratio && ratio <= a4Ratio * 1.15 ? String(a4Ratio / ratio) : "";
  const prev = document.title;
  document.title = _previewTitle;
  window.print();
  setTimeout(() => (document.title = prev), 300);
};

// render เอกสาร 1 ฉบับ → canvas (ใช้ร่วม PDF/PNG)
async function renderDocCanvas(d) {
  const holder = document.getElementById("pdfHolder");
  holder.innerHTML = `<div class="doc-paper">${composeDocHtml(d.body, d.signatory_id, d.letterhead_id)}</div>`;
  const paper = holder.firstElementChild;
  paper.style.boxShadow = "none";
  // แอปตั้ง :root{zoom:0.65} บน desktop (common.css) — html2canvas ไม่รู้จัก CSS zoom
  // เลยวัดกล่องแบบย่อแต่วาดตัวอักษรเต็มขนาด → คำทับกันเละ
  // หักล้างด้วย zoom ผกผันเฉพาะกล่อง render ให้ net zoom = 1 (กล่องอยู่นอกจอ ไม่กระทบ UI)
  const rootZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  if (rootZoom !== 1) paper.style.zoom = String(1 / rootZoom);
  await waitImages(paper);
  await waitFonts(); // รอ Sarabun โหลดครบ ไม่งั้น html2canvas วัดตัวอักษรผิดได้เช่นกัน
  return html2canvas(paper, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
}

// รอให้ web font (Sarabun/IBM Plex Mono) โหลดเสร็จก่อน rasterize
let _fontsReady = null;
function waitFonts() {
  if (_fontsReady) return _fontsReady;
  if (!document.fonts) return Promise.resolve();
  _fontsReady = Promise.all([
    document.fonts.load('400 15px "Sarabun"'),
    document.fonts.load('600 15px "Sarabun"'),
    document.fonts.load('700 15px "Sarabun"'),
    document.fonts.load('400 13px "IBM Plex Mono"'),
  ])
    .catch(() => {})
    .then(() => document.fonts.ready);
  return _fontsReady;
}

// ── EXPORT PDF หลายฉบับ (แยกคนละไฟล์ใน zip) ────────────────
window.bulkExportDocs = async function () {
  const docs = state.docs.filter((d) => state.selDocs.has(d.doc_id));
  if (!docs.length) return;
  if (typeof html2canvas === "undefined" || !window.jspdf || typeof JSZip === "undefined") {
    showToast("โหลด library ไม่สำเร็จ ลองรีเฟรช", "error");
    return;
  }
  showLoading(true);
  try {
    const zip = new JSZip();
    const used = {};
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      showToast(`กำลังสร้าง PDF ${i + 1}/${docs.length}…`, "success");
      const canvas = await renderDocCanvas(d);
      const img = canvas.toDataURL("image/jpeg", 0.92);
      const pdf = new window.jspdf.jsPDF("p", "mm", "a4");
      const pw = 210, ph = 297;
      const imgH = (canvas.height * pw) / canvas.width;
      // เนื้อหาล้นไม่เกิน 15% → ย่อทั้งหน้าให้พอดี A4 หน้าเดียว (กันเอกสารสั้นตกไปหน้า 2)
      const FIT_TOLERANCE = 1.15;
      if (imgH <= ph) {
        pdf.addImage(img, "JPEG", 0, 0, pw, imgH);
      } else if (imgH <= ph * FIT_TOLERANCE) {
        // ย่อคงสัดส่วน จัดชิดบน-กึ่งกลางแนวนอน
        const w = (canvas.width * ph) / canvas.height;
        pdf.addImage(img, "JPEG", (pw - w) / 2, 0, w, ph);
      } else {
        // เนื้อหายาวเกิน 1 หน้า → ตัดเป็นหลายหน้า
        let remaining = imgH, position = 0;
        while (remaining > 0) {
          pdf.addImage(img, "JPEG", 0, position, pw, imgH);
          remaining -= ph;
          if (remaining > 0) { pdf.addPage(); position -= ph; }
        }
      }
      let name = sanitizeFile(d.title || `เอกสาร ${i + 1}`);
      if (used[name]) name = `${name} (${++used[name]})`;
      else used[name] = 1;
      zip.file(name + ".pdf", pdf.output("blob"));
    }
    showToast("กำลังบีบอัดเป็น zip…", "success");
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `เอกสาร-${docs.length}-ฉบับ.zip`);
    showToast(`Export ${docs.length} ไฟล์ (zip) แล้ว`, "success");
  } catch (e) {
    showToast("Export ไม่สำเร็จ: " + e.message, "error");
  }
  document.getElementById("pdfHolder").innerHTML = "";
  showLoading(false);
};

// ── EXPORT PNG หลายฉบับ (แยกคนละไฟล์ใน zip) ────────────────
window.bulkExportPng = async function () {
  const docs = state.docs.filter((d) => state.selDocs.has(d.doc_id));
  if (!docs.length) return;
  if (typeof html2canvas === "undefined" || typeof JSZip === "undefined") {
    showToast("โหลด library ไม่สำเร็จ ลองรีเฟรช", "error");
    return;
  }
  showLoading(true);
  try {
    const zip = new JSZip();
    const used = {};
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      showToast(`กำลังสร้าง PNG ${i + 1}/${docs.length}…`, "success");
      const canvas = await renderDocCanvas(d);
      const blob = await canvasToBlob(canvas, "image/png");
      let name = sanitizeFile(d.title || `เอกสาร ${i + 1}`);
      if (used[name]) name = `${name} (${++used[name]})`;
      else used[name] = 1;
      zip.file(name + ".png", blob);
    }
    showToast("กำลังบีบอัดเป็น zip…", "success");
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `เอกสาร-${docs.length}-ฉบับ-PNG.zip`);
    showToast(`Export ${docs.length} PNG (zip) แล้ว`, "success");
  } catch (e) {
    showToast("Export ไม่สำเร็จ: " + e.message, "error");
  }
  document.getElementById("pdfHolder").innerHTML = "";
  showLoading(false);
};

function canvasToBlob(canvas, type) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type)
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // อย่าลบ <a>/revoke ทันที — Chromium จะ cancel blob download
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 5000);
}

function waitImages(el) {
  const imgs = [...el.querySelectorAll("img")];
  return Promise.all(
    imgs.map((im) =>
      im.complete ? Promise.resolve() : new Promise((res) => { im.onload = im.onerror = res; })
    )
  );
}
function sanitizeFile(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "เอกสาร";
}

// ════════════════════════════════════════════════════════════
//   แม่แบบ (TEMPLATES)
// ════════════════════════════════════════════════════════════
function renderTemplates() {
  const search = (document.getElementById("tplSearch")?.value || "").toLowerCase();
  const rows = state.templates.filter(
    (t) => !search || (t.name || "").toLowerCase().includes(search)
  );

  const tbody = document.getElementById("tplTableBody");
  document.getElementById("tplCount").textContent = `${rows.length} รายการ`;
  const fmt = (window.DateFmt && window.DateFmt.formatDMYTime) || ((s) => s || "");

  if (!rows.length) {
    tbody.innerHTML = `
      <tr class="r-card-plain"><td colspan="7">
        <div class="empty-state"><div class="empty-icon">🧩</div>
          <div class="empty-text">ยังไม่มีแม่แบบ — กด "＋ สร้างแม่แบบ" เพื่อเริ่ม</div></div>
      </td></tr>`;
    syncTplBulkBar();
    return;
  }

  tbody.innerHTML = rows
    .map((t, i) => {
      const nFields = extractFields(t.body || "").length;
      const checked = state.selTpls.has(t.template_id) ? "checked" : "";
      return `<tr>
        <td class="r-card-corner" style="text-align:center">
          <input type="checkbox" data-tpl="${t.template_id}" ${checked} onchange="window.toggleTpl(${t.template_id}, this)" />
        </td>
        <td data-label="#" style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>
        <td class="r-card-title">
          <div class="doc-name-cell">${escapeHtml(t.name || "—")}</div>
          ${t.description ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">${escapeHtml(t.description)}</div>` : ""}
        </td>
        <td class="col-center" data-label="หมวดหมู่">${t.category ? `<span class="doc-tpl-badge">${escapeHtml(t.category)}</span>` : `<span style="color:var(--text3)">—</span>`}</td>
        <td class="col-center" data-label="ฟิลด์"><span class="doc-tpl-badge${nFields ? "" : " none"}">${nFields} ฟิลด์</span></td>
        <td class="col-center" data-label="อัปเดตล่าสุด" style="white-space:nowrap;color:var(--text2);font-size:12px">${fmt(t.updated_at)}</td>
        <td class="col-center" data-label="จัดการ" onclick="event.stopPropagation()">
          <div class="action-group">
            <button class="btn-icon" title="ทำสำเนา" data-perm="trip_docs_create" onclick="window.duplicateTemplate(${t.template_id})">⧉</button>
            <button class="btn-icon" title="แก้ไข" data-perm="trip_docs_edit" onclick="window.openTemplateModal(${t.template_id})">✏️</button>
            <button class="btn-icon danger" title="ลบ" data-perm="trip_docs_delete" onclick="window.deleteTemplate(${t.template_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(tbody);
  syncTplBulkBar();
}

// ── TPL multi-select ───────────────────────────────────────
window.toggleTpl = function (id, el) {
  if (el.checked) state.selTpls.add(id);
  else state.selTpls.delete(id);
  syncTplBulkBar();
};
window.toggleAllTpls = function (el) {
  document.querySelectorAll("#tplTableBody input[data-tpl]").forEach((cb) => {
    cb.checked = el.checked;
    const id = +cb.dataset.tpl;
    if (el.checked) state.selTpls.add(id);
    else state.selTpls.delete(id);
  });
  syncTplBulkBar();
};
window.clearTplSelection = function () {
  state.selTpls.clear();
  document.getElementById("tplCheckAll").checked = false;
  renderTemplates();
};
function syncTplBulkBar() {
  const bar = document.getElementById("tplBulkBar");
  const n = state.selTpls.size;
  bar.classList.toggle("show", n > 0);
  document.getElementById("tplBulkCount").textContent = `เลือก ${n} รายการ`;
}
window.bulkDeleteTpls = function () {
  const ids = [...state.selTpls];
  if (!ids.length) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const run = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_doc_templates", `?template_id=in.(${ids.join(",")})`, { method: "DELETE" });
      showToast(`ลบแม่แบบ ${ids.length} รายการแล้ว`, "success");
      state.selTpls.clear();
      await loadAll();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  opener ? opener(`ต้องการลบแม่แบบ ${ids.length} รายการที่เลือกหรือไม่? (เอกสารเดิมยังอยู่)`, run) : run();
};
window.deleteTemplate = function (id) {
  const t = state.templates.find((x) => x.template_id === id);
  if (!t) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const run = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_doc_templates", `?template_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแม่แบบแล้ว", "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  opener ? opener(`ต้องการลบแม่แบบ "${t.name}" หรือไม่? (เอกสารที่สร้างไว้แล้วยังคงอยู่)`, run) : run();
};

// ── DUPLICATE TEMPLATE ─────────────────────────────────────
window.duplicateTemplate = async function (id) {
  const t = state.templates.find((x) => x.template_id === id);
  if (!t) return;
  const payload = {
    name: (t.name || "แม่แบบ") + " (สำเนา)",
    category: t.category || null,
    description: t.description || null,
    body: t.body || "",
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    await sbFetch("trip_doc_templates", "", { method: "POST", body: payload });
    showToast("ทำสำเนาแม่แบบแล้ว", "success");
    await loadAll();
    window.switchTab("templates");
  } catch (e) {
    showToast("ทำสำเนาไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ── TEMPLATE EDITOR ────────────────────────────────────────
window.openTemplateModal = function (id) {
  state.editTplId = id || null;
  const t = id ? state.templates.find((x) => x.template_id === id) : null;
  document.getElementById("tplModalTitle").textContent = t ? "แก้ไขแม่แบบ" : "สร้างแม่แบบ";
  document.getElementById("tplName").value = t?.name || "";
  document.getElementById("tplCategory").value = t?.category || "";
  document.getElementById("tplDesc").value = t?.description || "";
  setEditorHTML("tplBody", t?.body);
  refreshTplFields();
  document.getElementById("tplOverlay").classList.add("open");
  setTimeout(() => document.getElementById("tplName").focus(), 50);
};
window.closeTemplateModal = function (e) {
  if (e && e.target.id !== "tplOverlay") return;
  document.getElementById("tplOverlay").classList.remove("open");
  state.editTplId = null;
};
window.refreshTplFields = function () {
  // ดึง {{ฟิลด์}} จาก text (placeholders เป็น plain text ใน HTML)
  const body = document.getElementById("tplBody")?.textContent || "";
  const fields = extractFields(body);
  const el = document.getElementById("tplFieldsPreview");
  if (!fields.length) {
    el.className = "field-chips-empty";
    el.textContent = "ยังไม่พบฟิลด์ — เพิ่ม {{ชื่อฟิลด์}} ในเนื้อหา";
    return;
  }
  el.className = "field-chips";
  el.innerHTML = fields.map((f) => `<span class="field-chip">{{${escapeHtml(f)}}}</span>`).join("");
};
window.saveTemplate = async function () {
  const name = document.getElementById("tplName").value.trim();
  const body = getEditorHTML("tplBody");
  if (!name) {
    showToast("กรุณากรอกชื่อแม่แบบ", "error");
    return;
  }
  if (editorIsEmpty("tplBody")) {
    showToast("กรุณากรอกเนื้อหาแม่แบบ", "error");
    return;
  }
  const payload = {
    name,
    category: document.getElementById("tplCategory").value || null,
    description: document.getElementById("tplDesc").value.trim() || null,
    body,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    if (state.editTplId) {
      await sbFetch("trip_doc_templates", `?template_id=eq.${state.editTplId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขแม่แบบแล้ว", "success");
    } else {
      await sbFetch("trip_doc_templates", "", { method: "POST", body: payload });
      showToast("สร้างแม่แบบแล้ว", "success");
    }
    document.getElementById("tplOverlay").classList.remove("open");
    state.editTplId = null;
    await loadAll();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ════════════════════════════════════════════════════════════
//   นำเข้า EXCEL — สร้างหลายฉบับจากแม่แบบเดียว
// ════════════════════════════════════════════════════════════
window.openImportModal = function () {
  // template dropdown
  const tSel = document.getElementById("impTemplate");
  tSel.innerHTML =
    `<option value="">— เลือกแม่แบบ —</option>` +
    state.templates
      .map((t) => `<option value="${t.template_id}">${escapeHtml(t.name)}</option>`)
      .join("");
  tSel.value = "";
  fillSignatorySelect("impSignatory", null);
  fillLetterheadSelect("impLetterhead", null);
  document.getElementById("impStatus").value = "DRAFT";
  document.getElementById("impFile").value = "";
  document.getElementById("impFileName").textContent = "";
  document.getElementById("impPreviewWrap").innerHTML = "";
  document.getElementById("impColsHint").style.display = "none";
  state.importRows = [];
  setImportButtons();
  document.getElementById("importOverlay").classList.add("open");
};
window.closeImport = function (e) {
  if (e && e.target.id !== "importOverlay") return;
  document.getElementById("importOverlay").classList.remove("open");
  state.importRows = [];
};

function importTemplate() {
  const id = +document.getElementById("impTemplate").value || null;
  return id ? state.templates.find((t) => t.template_id === id) : null;
}
function importFields() {
  const t = importTemplate();
  return t ? extractFields(t.body || "") : [];
}
function setImportButtons() {
  const hasTpl = !!importTemplate();
  document.getElementById("impDlBtn").disabled = !hasTpl;
  document.getElementById("impPickBtn").disabled = !hasTpl;
  document.getElementById("impCreateBtn").disabled = !hasTpl || !state.importRows.length;
}

window.onImportPickTemplate = function () {
  // reset rows/preview เมื่อเปลี่ยนแม่แบบ
  state.importRows = [];
  document.getElementById("impPreviewWrap").innerHTML = "";
  document.getElementById("impFileName").textContent = "";
  document.getElementById("impFile").value = "";

  const fields = importFields();
  const hint = document.getElementById("impColsHint");
  if (!importTemplate()) {
    hint.style.display = "none";
  } else {
    hint.style.display = "";
    document.getElementById("impColsList").innerHTML = fields.length
      ? fields.map((c) => `<span class="field-chip" style="margin:2px 4px 2px 0">${escapeHtml(c)}</span>`).join("")
      : `แม่แบบนี้ไม่มี placeholder — แต่ละแถวจะสร้างเอกสารเนื้อหาเหมือนกัน (ชื่อเอกสารตั้งอัตโนมัติ)`;
  }
  setImportButtons();
};

// ดาวน์โหลดเทมเพลต Excel (header = ชื่อเอกสาร + placeholders)
window.downloadImportTemplate = function () {
  const t = importTemplate();
  if (!t) return;
  const cols = extractFields(t.body || "");
  const ws = XLSX.utils.aoa_to_sheet([cols]);
  ws["!cols"] = cols.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Import");
  XLSX.writeFile(wb, `import-${t.name}.xlsx`);
};

window.onImportFile = function (event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!importTemplate()) {
    showToast("กรุณาเลือกแม่แบบก่อน", "error");
    return;
  }
  document.getElementById("impFileName").textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // raw:false → อ่านค่าตามที่แสดงใน Excel (วันที่/ตัวเลขคงรูปแบบเดิม ไม่กลายเป็น Date object)
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
      if (!rows.length) {
        showToast("ไม่พบข้อมูลในไฟล์", "error");
        return;
      }
      state.importRows = rows;
      renderImportPreview();
    } catch (err) {
      showToast("อ่านไฟล์ไม่ได้: " + err.message, "error");
    }
    setImportButtons();
  };
  reader.readAsBinaryString(file);
};

function renderImportPreview() {
  const wrap = document.getElementById("impPreviewWrap");
  const fields = importFields();
  const cols = [...fields];
  const rows = state.importRows;
  const MAX = 20;

  const head = cols.map((c) => `<th style="white-space:nowrap">${escapeHtml(c)}</th>`).join("");
  const body = rows
    .slice(0, MAX)
    .map((r, i) => {
      const tds = cols
        .map((c) => `<td>${escapeHtml(String(r[c] ?? ""))}</td>`)
        .join("");
      return `<tr><td style="text-align:center;color:var(--text3)">${i + 1}</td>${tds}</tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <div class="table-hdr" style="padding:0 0 8px">
      <div class="table-title">ตัวอย่างข้อมูล</div>
      <div class="table-count">จะสร้าง ${rows.length} ฉบับ</div>
    </div>
    <div class="table-wrap" style="max-height:300px;overflow:auto">
      <table class="data-table v-striped">
        <thead><tr><th style="width:40px">#</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${rows.length > MAX ? `<div class="field-chips-empty">แสดง ${MAX} จาก ${rows.length} แถว…</div>` : ""}`;
}

window.runImport = async function () {
  const t = importTemplate();
  if (!t) return;
  if (!state.importRows.length) {
    showToast("ยังไม่มีข้อมูลนำเข้า", "error");
    return;
  }
  const fields = extractFields(t.body || "");
  const sigId = +document.getElementById("impSignatory").value || null;
  const lhId = +document.getElementById("impLetterhead").value || null;
  const status = document.getElementById("impStatus").value || "DRAFT";
  const now = new Date().toISOString();

  // payload — normalize keys ให้ตรงกันทุก row (กัน PGRST102)
  const payloads = state.importRows.map((row, i) => {
    const values = {};
    fields.forEach((f) => (values[f] = String(row[f] ?? "").trim()));
    // ตั้งชื่อเอกสารอัตโนมัติ — เลือกฟิลด์ที่มีคำว่า "ชื่อ"/name ก่อน ไม่งั้นใช้ฟิลด์แรก/ลำดับ
    const nameField = fields.find((f) => /ชื่อ|name/i.test(f)) || fields[0];
    const title = nameField && values[nameField]
      ? `${t.name} — ${values[nameField]}`
      : `${t.name} #${i + 1}`;
    return {
      template_id: t.template_id,
      signatory_id: sigId,
      letterhead_id: lhId,
      title,
      status,
      field_values: values,
      body: renderTemplate(t.body || "", values),
      updated_at: now,
    };
  });

  showLoading(true);
  try {
    // batch ทีละ 200 แถว
    const CHUNK = 200;
    let done = 0;
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const slice = payloads.slice(i, i + CHUNK);
      await sbFetch("trip_documents", "", { method: "POST", body: slice });
      done += slice.length;
    }
    document.getElementById("importOverlay").classList.remove("open");
    state.importRows = [];
    await loadAll();
    window.switchTab("docs");
    showToast(`สร้างเอกสาร ${done} ฉบับแล้ว`, "success");
  } catch (e) {
    showToast("นำเข้าไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ════════════════════════════════════════════════════════════
//   ผู้ลงนาม (SIGNATORIES) — nested manager
// ════════════════════════════════════════════════════════════
window.openSignatoryManager = function () {
  resetSignatoryForm();
  renderSignatoryList();
  document.getElementById("sigMgrOverlay").classList.add("open");
};
window.closeSignatoryManager = function (e) {
  if (e && e.target.id !== "sigMgrOverlay") return;
  document.getElementById("sigMgrOverlay").classList.remove("open");
  // refresh dropdown ใน editor (คงค่าที่เลือกไว้ ถ้ายังอยู่)
  const cur = document.getElementById("deSignatory")?.value || "";
  fillSignatorySelect("deSignatory", cur || null);
};

function renderSignatoryList() {
  const wrap = document.getElementById("sigList");
  if (!state.signatories.length) {
    wrap.innerHTML = `<div class="field-chips-empty" style="padding:8px 0">ยังไม่มีผู้ลงนาม — เพิ่มด้านบน</div>`;
    return;
  }
  wrap.innerHTML = state.signatories
    .map(
      (s) => `<div class="sig-row">
        ${
          s.signature_data
            ? `<img src="${s.signature_data}" alt="sig" />`
            : `<div style="width:90px;height:42px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#f1f5f9;border-radius:6px;color:#94a3b8;font-size:11px">ไม่มีภาพ</div>`
        }
        <div class="sig-meta">
          <b>${escapeHtml(s.name)}</b>
          <div>${escapeHtml(s.title || "—")}</div>
        </div>
        <button class="btn-icon" title="แก้ไข" onclick="window.editSignatory(${s.signatory_id})">✏️</button>
        <button class="btn-icon danger" title="ลบ" onclick="window.deleteSignatory(${s.signatory_id})">🗑</button>
      </div>`
    )
    .join("");
}

window.resetSignatoryForm = function () {
  state.editSigId = null;
  state.sigImgData = null;
  document.getElementById("sigName").value = "";
  document.getElementById("sigTitle").value = "";
  document.getElementById("sigFile").value = "";
  document.getElementById("sigPreviewBox").innerHTML = `<span class="ph">ยังไม่มีภาพ</span>`;
  document.getElementById("sigSaveBtn").textContent = "＋ เพิ่มผู้ลงนาม";
  document.getElementById("sigCancelEdit").style.display = "none";
};

window.editSignatory = function (id) {
  const s = state.signatories.find((x) => x.signatory_id === id);
  if (!s) return;
  state.editSigId = id;
  state.sigImgData = s.signature_data || null;
  document.getElementById("sigName").value = s.name || "";
  document.getElementById("sigTitle").value = s.title || "";
  document.getElementById("sigPreviewBox").innerHTML = s.signature_data
    ? `<img src="${s.signature_data}" alt="sig" />`
    : `<span class="ph">ยังไม่มีภาพ</span>`;
  document.getElementById("sigSaveBtn").textContent = "💾 บันทึกการแก้ไข";
  document.getElementById("sigCancelEdit").style.display = "";
};

window.onSignaturePicked = async function (e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    state.sigImgData = await resizeImageToPngDataUrl(file, 500);
    document.getElementById("sigPreviewBox").innerHTML = `<img src="${state.sigImgData}" alt="sig" />`;
  } catch (err) {
    showToast("อ่านรูปไม่ได้: " + err.message, "error");
  }
};
window.clearSignatureImg = function () {
  state.sigImgData = null;
  document.getElementById("sigFile").value = "";
  document.getElementById("sigPreviewBox").innerHTML = `<span class="ph">ยังไม่มีภาพ</span>`;
};

window.saveSignatory = async function () {
  const name = document.getElementById("sigName").value.trim();
  if (!name) {
    showToast("กรุณากรอกชื่อผู้ลงนาม", "error");
    return;
  }
  const payload = {
    name,
    title: document.getElementById("sigTitle").value.trim() || null,
    signature_data: state.sigImgData || null,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    if (state.editSigId) {
      await sbFetch("trip_doc_signatories", `?signatory_id=eq.${state.editSigId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขผู้ลงนามแล้ว", "success");
    } else {
      await sbFetch("trip_doc_signatories", "", { method: "POST", body: payload });
      showToast("เพิ่มผู้ลงนามแล้ว", "success");
    }
    // reload เฉพาะ signatories
    state.signatories =
      (await sbFetch("trip_doc_signatories", "?select=*&order=name").catch(() => [])) || [];
    resetSignatoryForm();
    renderSignatoryList();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteSignatory = function (id) {
  const s = state.signatories.find((x) => x.signatory_id === id);
  if (!s) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const run = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_doc_signatories", `?signatory_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบผู้ลงนามแล้ว", "success");
      state.signatories =
        (await sbFetch("trip_doc_signatories", "?select=*&order=name").catch(() => [])) || [];
      if (state.editSigId === id) resetSignatoryForm();
      renderSignatoryList();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  opener ? opener(`ต้องการลบผู้ลงนาม "${s.name}" หรือไม่?`, run) : run();
};

// resize รูป → PNG data URL (คง transparency · ลดขนาด egress ตาม[[project_image_compression]])
function resizeImageToPngDataUrl(file, maxW) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read fail"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode fail"));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════
//   หัวกระดาษ (LETTERHEADS) — nested manager
// ════════════════════════════════════════════════════════════
window.openLetterheadManager = function () {
  resetLetterheadForm();
  renderLetterheadList();
  document.getElementById("lhMgrOverlay").classList.add("open");
};
window.closeLetterheadManager = function (e) {
  if (e && e.target.id !== "lhMgrOverlay") return;
  document.getElementById("lhMgrOverlay").classList.remove("open");
  // refresh dropdown หัวกระดาษ (คงค่าที่เลือกไว้)
  const curDe = document.getElementById("deLetterhead")?.value || "";
  fillLetterheadSelect("deLetterhead", curDe || null);
  const curImp = document.getElementById("impLetterhead")?.value || "";
  fillLetterheadSelect("impLetterhead", curImp || null);
};

function renderLetterheadList() {
  const wrap = document.getElementById("lhList");
  if (!state.letterheads.length) {
    wrap.innerHTML = `<div class="field-chips-empty" style="padding:8px 0">ยังไม่มีหัวกระดาษ — เพิ่มด้านบน</div>`;
    return;
  }
  wrap.innerHTML = state.letterheads
    .map(
      (l) => `<div class="lh-item${state.editLhId === l.letterhead_id ? " active" : ""}"
        title="คลิกเพื่อแก้ไข" onclick="window.editLetterhead(${l.letterhead_id})">
        <img src="${l.logo_data || companyLogoUrl()}" alt="logo" onerror="this.style.display='none'" />
        <div class="lh-item-meta">
          <b title="${escapeHtml(l.name)}">${l.is_default ? "⭐ " : ""}${escapeHtml(l.name)}</b>
          <small>${escapeHtml(stripHtml(l.content_html) || l.company_name || "—")}</small>
        </div>
        <div class="lh-item-acts">
          <button class="btn-icon danger" title="ลบ" onclick="event.stopPropagation(); window.deleteLetterhead(${l.letterhead_id})">🗑</button>
        </div>
      </div>`
    )
    .join("");
}

// simulator = หัวกระดาษจริง (ฟังก์ชันเดียวกับเอกสาร) ย่อสัดส่วน → ตรงเป๊ะ
window.updateLhSimulator = function () {
  const box = document.getElementById("lhSimulator");
  if (!box) return;
  // ทำเฉพาะตอน modal หัวกระดาษเปิด (toolbar ใช้ร่วมกับ editor อื่น)
  if (!document.getElementById("lhMgrOverlay")?.classList.contains("open")) return;
  const html = getEditorHTML("lhContent");
  const tempLh = {
    content_html: html && stripHtml(html) ? html : "",
    logo_position: document.getElementById("lhLogoPos").value || "left",
    logo_valign: document.getElementById("lhLogoVAlign").value || "top",
    logo_width: +document.getElementById("lhLogoWidth").value || 120,
    logo_data: null,
  };
  const head = buildLetterheadHead(tempLh); // = หัวกระดาษในเอกสารจริงเป๊ะ

  // ครอบด้วย .doc-paper จริง (base font/family เท่าเอกสาร) → render ตรงเป๊ะ
  const paper = `<div class="doc-paper" style="width:666px;padding:0;margin:0;min-height:0;box-shadow:none;background:transparent">${head}</div>`;
  box.innerHTML = `<div class="lh-sim-scale" style="width:666px">${paper}</div>`;
  const wrap = box.querySelector(".lh-sim-scale");
  const band = wrap.firstElementChild; // .doc-paper
  const avail = box.clientWidth - 28; // ลบ padding ซ้าย/ขวา
  const s = avail > 0 ? Math.min(1, avail / 666) : 0.72;
  wrap.style.transform = `scale(${s})`;
  box.style.height = Math.max(56, band.offsetHeight * s + 24) + "px";
};

// ดึงข้อมูลบริษัท (ตั้งค่าบริษัท) มาใส่เนื้อหาหัวกระดาษ → ปรับแต่งต่อได้
window.pullCompanyInfo = function () {
  if (!state.company || !state.company.company_name && !state.company.company_name_en) {
    showToast("ยังไม่มีข้อมูลบริษัท — ตั้งค่าที่หน้า ตั้งค่าบริษัท ก่อน", "error");
    return;
  }
  setEditorHTML("lhContent", companyLetterheadHtml());
  updateLhSimulator();
  showToast("ดึงข้อมูลบริษัทแล้ว — ปรับแต่งต่อได้เลย", "success");
};

window.resetLetterheadForm = function () {
  state.editLhId = null;
  document.getElementById("lhName").value = "";
  setEditorHTML("lhContent", "");
  document.getElementById("lhDefault").checked = false;
  document.getElementById("lhLogoPos").value = "left";
  document.getElementById("lhLogoVAlign").value = "top";
  document.getElementById("lhLogoWidth").value = 120;
  document.getElementById("lhSaveBtn").textContent = "＋ เพิ่มหัวกระดาษ";
  document.getElementById("lhCancelEdit").style.display = "none";
  renderLetterheadList(); // ล้างไฮไลต์ active
  updateLhSimulator();
};

window.editLetterhead = function (id) {
  const l = state.letterheads.find((x) => x.letterhead_id === id);
  if (!l) return;
  state.editLhId = id;
  document.getElementById("lhName").value = l.name || "";
  setEditorHTML("lhContent", l.content_html || legacyLetterheadHtml(l));
  document.getElementById("lhDefault").checked = !!l.is_default;
  document.getElementById("lhLogoPos").value = l.logo_position || "left";
  document.getElementById("lhLogoVAlign").value = l.logo_valign || "top";
  document.getElementById("lhLogoWidth").value = l.logo_width || 120;
  document.getElementById("lhSaveBtn").textContent = "💾 บันทึกการแก้ไข";
  document.getElementById("lhCancelEdit").style.display = "";
  renderLetterheadList(); // อัปเดตไฮไลต์แถวที่กำลังแก้
  updateLhSimulator();
};


window.saveLetterhead = async function () {
  const name = document.getElementById("lhName").value.trim();
  if (!name) {
    showToast("กรุณากรอกชื่อหัวกระดาษ", "error");
    return;
  }
  const isDefault = document.getElementById("lhDefault").checked;
  const payload = {
    name,
    content_html: getEditorHTML("lhContent"),
    logo_position: document.getElementById("lhLogoPos").value || "left",
    logo_valign: document.getElementById("lhLogoVAlign").value || "top",
    logo_width: parseInt(document.getElementById("lhLogoWidth").value, 10) || 120,
    is_default: isDefault,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    let savedId = state.editLhId;
    if (state.editLhId) {
      await sbFetch("trip_doc_letterheads", `?letterhead_id=eq.${state.editLhId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขหัวกระดาษแล้ว", "success");
    } else {
      const rows = await sbFetch("trip_doc_letterheads", "", { method: "POST", body: payload });
      savedId = (Array.isArray(rows) ? rows[0] : rows)?.letterhead_id;
      showToast("เพิ่มหัวกระดาษแล้ว", "success");
    }
    // มี default ได้ทีละ 1 → เคลียร์ของอื่น
    if (isDefault && savedId) {
      await sbFetch("trip_doc_letterheads", `?letterhead_id=neq.${savedId}`, {
        method: "PATCH",
        body: { is_default: false },
      }).catch(() => {});
    }
    state.letterheads =
      (await sbFetch("trip_doc_letterheads", "?select=*&order=letterhead_id").catch(() => [])) || [];
    resetLetterheadForm();
    renderLetterheadList();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteLetterhead = function (id) {
  const l = state.letterheads.find((x) => x.letterhead_id === id);
  if (!l) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const run = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_doc_letterheads", `?letterhead_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบหัวกระดาษแล้ว", "success");
      state.letterheads =
        (await sbFetch("trip_doc_letterheads", "?select=*&order=letterhead_id").catch(() => [])) || [];
      if (state.editLhId === id) resetLetterheadForm();
      renderLetterheadList();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  opener ? opener(`ต้องการลบหัวกระดาษ "${l.name}" หรือไม่? (เอกสารที่ใช้หัวนี้จะกลับไปใช้หัวเริ่มต้น)`, run) : run();
};

// ── PLACEHOLDER HELPERS ────────────────────────────────────
// ดึงชื่อฟิลด์จาก {{...}} (unique, เรียงตามที่พบ)
function extractFields(body) {
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  const seen = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = m[1].trim();
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen;
}
// แทน {{ฟิลด์}} ด้วยค่า (ค่าว่าง → เก็บ {{ฟิลด์}} ไว้ให้เห็นว่ายังไม่กรอก)
// body เป็น HTML → escape ค่าที่แทน กันค่าผู้ใช้ทำลาย markup
function renderTemplate(body, values) {
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, key) => {
    const v = values[key.trim()];
    return v != null && v !== "" ? escapeHtml(v) : full;
  });
}

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
// ลอก tag ออก → ข้อความล้วน (สำหรับ snippet)
function stripHtml(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
