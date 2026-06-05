/* ============================================================
   doc-editor.js — หน้าแก้ไขเอกสารเต็มจอ (แทน modal เดิมใน trip-docs)
   เปิดด้วย doc-editor.html?doc_id=N
   เครื่องมือ: A4 WYSIWYG + ซูม · RTE (undo/redo, หัวข้อ, B/I/U/S, สี/ขนาด,
   จัดแนว, list, indent) · แทรกรูป/ตาราง/page-break · แก้ตาราง (เพิ่ม/ลบ แถว-คอลัมน์)
   · เลือกหัวกระดาษ/ผู้ลงนาม · บันทึก/พรีวิว/พิมพ์/PDF · 🔄 รีเฟรช data-block
   ============================================================ */

const state = {
  docId: null,
  doc: null,
  letterheads: [],
  signatories: [],
  company: {},
  zoom: 1,
  trips: [],
  // left data panel
  panel: { trip: null, selected: [], groupBy: "", total: false, collapsed: {} },
  // preview+filter modal (ctx cache ไว้ render/filter ไม่ refetch)
  preview: { ctx: null, base: null, filters: {}, collapsed: {} },
};

const LETTERHEAD = {
  logoUrl: "../../assets/logo/logo-a4s.png",
  nameEn: "A4S Can Corporation Co., Ltd.",
  addr:
    "Imperial World Ladprao 3rd Floor, Room AT 02-03, No. 2539 Khlong Chaokhun Sing,\n" +
    "Khet Wang Thonglang, Bangkok 10310.  Tel: 092-326-4946  Email: A4Sservice@gmail.com",
};

// ── SUPABASE ───────────────────────────────────────────────
function getSB() {
  return { url: localStorage.getItem("sb_url") || "", key: localStorage.getItem("sb_key") || "" };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

// ── UTIL ───────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}
function stripHtml(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}
function showToast(msg, type = "success") {
  const t = $("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(on) { $("loadingOverlay")?.classList.toggle("show", on); }

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const id = parseInt(new URLSearchParams(location.search).get("doc_id"), 10);
  state.docId = Number.isFinite(id) ? id : null; // null = โหมดสร้างใหม่ (ยังไม่เขียน DB)
  const { url, key } = getSB();
  if (!url || !key) { showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error"); return; }
  bindToolbar();
  bindBodyEvents();
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [docs, lhs, sigs, comp, trips] = await Promise.all([
      state.docId ? sbFetch("trip_documents", `?doc_id=eq.${state.docId}&select=*`) : Promise.resolve(null),
      sbFetch("trip_doc_letterheads", "?select=*&order=letterhead_id").catch(() => []),
      sbFetch("trip_doc_signatories", "?select=*&order=name").catch(() => []),
      sbFetch("app_settings", "?select=key,value&key=like.company_*").catch(() => []),
      sbFetch("trips", "?select=trip_id,trip_name,start_date,end_date&order=trip_id.desc").catch(() => []),
    ]);
    state.letterheads = lhs || [];
    state.signatories = sigs || [];
    state.company = Object.fromEntries((comp || []).map((r) => [r.key, r.value]));
    state.trips = trips || [];
    if (state.docId) {
      state.doc = (docs || [])[0] || null;
      if (!state.doc) {
        showToast("ไม่พบเอกสารนี้", "error");
        setTimeout(() => (location.href = "./trip-docs.html"), 1200);
        return;
      }
    } else {
      // โหมดสร้างใหม่ — เอกสารเปล่า (ยังไม่บันทึก)
      state.doc = { title: "", status: "DRAFT", body: "", letterhead_id: null, signatory_id: null, data_bindings: {} };
    }
    renderEditor();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function renderEditor() {
  const d = state.doc;
  $("deTitle").value = d.title || "";
  $("deStatus").value = d.status || "DRAFT";
  fillLetterheadSelect(d.letterhead_id);
  fillSignatorySelect(d.signatory_id);
  $("deBody").innerHTML = d.body || "";
  renderHead();
  renderSig();
  // ปุ่ม 🔄 — เฉพาะเอกสารที่มี data binding + บล็อกตาราง
  const b = d.data_bindings;
  const hasBinding = b && b.source === "custom_report" && b.trip_id && /data-doc-datablock/.test(d.body || "");
  $("deRefreshBtn").style.display = hasBinding ? "" : "none";
  document.title = `${d.title || "เอกสาร"} — แก้ไข — A4S-ERP`;
  // panel: prefill จาก binding เดิม (ถ้ามี)
  if (b && b.trip_id) {
    state.panel.trip = b.trip_id;
    state.panel.selected = Array.isArray(b.columns) ? b.columns.slice() : [];
    state.panel.groupBy = b.groupBy || "";
    state.panel.total = !!b.showTotal;
  }
  renderTripOptions();
  renderPanel();
  fitZoom();
}

// ════════════════════════════════════════════════════════════
//   LEFT DATA PANEL — เลือกทริป + คอลัมน์ → แทรกตาราง
// ════════════════════════════════════════════════════════════
function renderTripOptions() {
  const sel = $("dePanelTrip");
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");
  sel.innerHTML = `<option value="">— เลือกทริป —</option>` +
    state.trips.map((t) => {
      const dt = t.start_date ? ` (${fmt(t.start_date)})` : "";
      return `<option value="${t.trip_id}">${escapeHtml(t.trip_name || "Trip #" + t.trip_id)}${dt}</option>`;
    }).join("");
  sel.value = state.panel.trip != null ? String(state.panel.trip) : "";
}
window.togglePanel = function () {
  const p = $("dePanel");
  p.classList.toggle("collapsed");
  p.querySelector(".de-panel-collapse").textContent = p.classList.contains("collapsed") ? "›" : "‹";
};
window.onPanelTrip = function (v) {
  state.panel.trip = v ? +v : null;
  renderPanel();
};
// คอลัมน์ที่เลือกได้ในเอกสาร — ตัด image ออก (จดหมายเป็นตารางข้อความ)
function panelGroups() {
  const groups = (window.TripReportData && window.TripReportData.COLUMN_GROUPS) || [];
  return groups.map((g) => ({ id: g.id, label: g.label, cols: g.cols.filter((c) => c.fmt !== "image") }))
    .filter((g) => g.cols.length);
}
function renderPanel() {
  const pick = $("dePanelPicker");
  if (!state.panel.trip) {
    pick.innerHTML = `<div class="de-pick-empty">เลือกทริปก่อน เพื่อดึงคอลัมน์ที่มี</div>`;
    $("dePanelOpts").style.display = "none";
    $("dePanelInsert").style.display = "none";
    return;
  }
  pick.innerHTML = panelGroups().map((g) => {
    const collapsed = state.panel.collapsed[g.id];
    const nSel = g.cols.filter((c) => state.panel.selected.includes(c.key)).length;
    const opts = g.cols.map((c) => `
      <label class="de-opt">
        <input type="checkbox" value="${escapeHtml(c.key)}" ${state.panel.selected.includes(c.key) ? "checked" : ""}
          onchange="window.togglePanelCol('${escapeHtml(c.key)}', this.checked)">
        <span>${escapeHtml(c.label)}</span>
      </label>`).join("");
    return `<div class="de-pick-group${collapsed ? " collapsed" : ""}">
      <div class="de-pick-ghd" onclick="window.panelToggleGroup('${escapeHtml(g.id)}')">
        <span>${escapeHtml(g.label)}</span>
        <span>${nSel ? `<span class="de-opt-count">${nSel}</span> ` : ""}${collapsed ? "▸" : "▾"}</span>
      </div>
      <div class="de-pick-body">${opts}</div>
    </div>`;
  }).join("");
  renderPanelGroupBy();
  $("dePanelOpts").style.display = "";
  $("dePanelInsert").style.display = state.panel.selected.length ? "" : "none";
}
window.panelToggleGroup = function (gid) {
  state.panel.collapsed[gid] = !state.panel.collapsed[gid];
  renderPanel();
};
window.togglePanelCol = function (key, checked) {
  const i = state.panel.selected.indexOf(key);
  if (checked && i < 0) state.panel.selected.push(key);
  else if (!checked && i >= 0) state.panel.selected.splice(i, 1);
  // groupBy ที่อ้างคอลัมน์ที่เอาออก → reset
  if (!checked && state.panel.groupBy === key) state.panel.groupBy = "";
  renderPanelGroupBy();
  $("dePanelInsert").style.display = state.panel.selected.length ? "" : "none";
  // อัปเดต badge นับในหัวกลุ่ม (re-render เบาๆ)
  renderPanel();
};
function renderPanelGroupBy() {
  const sel = $("dePanelGroup");
  if (!sel) return;
  const byKey = (window.TripReportData && window.TripReportData.COL_BY_KEY) || {};
  const opts = [`<option value="">— ไม่แบ่งกลุ่ม —</option>`,
    `<option value="_flightseg">✈️ ตามช่วงเที่ยวบิน</option>`];
  state.panel.selected.forEach((k) => {
    const c = byKey[k];
    if (c) opts.push(`<option value="${escapeHtml(k)}">${escapeHtml(c.label)}</option>`);
  });
  sel.innerHTML = opts.join("");
  if (state.panel.groupBy && state.panel.groupBy !== "_flightseg" && !state.panel.selected.includes(state.panel.groupBy)) state.panel.groupBy = "";
  sel.value = state.panel.groupBy;
}
window.setPanelGroup = function (v) { state.panel.groupBy = v || ""; };
window.setPanelTotal = function (on) { state.panel.total = !!on; };

// เปิด popup พรีวิว + กรอง (โหลด ctx ครั้งเดียว → กรอง/render ไม่ refetch)
window.openDataPreview = async function () {
  if (!state.panel.trip) { showToast("เลือกทริปก่อน", "error"); return; }
  if (!state.panel.selected.length) { showToast("เลือกคอลัมน์อย่างน้อย 1", "error"); return; }
  if (!window.TripReportData) { showToast("โหลด engine ไม่สำเร็จ (report-data-source.js)", "error"); return; }
  showLoading(true);
  try {
    state.preview.ctx = await window.TripReportData.loadCtx(state.panel.trip);
    state.preview.base = {
      source: "custom_report", trip_id: state.panel.trip, columns: state.panel.selected.slice(),
      hidden: {}, merged: {}, sort: [], groupBy: state.panel.groupBy, showTotal: state.panel.total,
    };
    state.preview.filters = {};   // เริ่ม = ไม่กรอง (ทุกค่าถูกเลือก)
    state.preview.collapsed = {};
    renderPreviewFilters();
    renderPreviewTable();
    $("dpModal").classList.add("open");
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};
window.closeDataPreview = function () { $("dpModal").classList.remove("open"); };

function previewDistinct(key) { return window.TripReportData.distinctValues(state.preview.ctx, key); }
function filterSet(key) {
  if (!state.preview.filters[key]) state.preview.filters[key] = new Set(previewDistinct(key)); // lazy = ทุกค่า
  return state.preview.filters[key];
}
function dispVal(v) { return v === window.TripReportData.BLANK_VAL ? "(ว่าง)" : v; }

function renderPreviewFilters() {
  const wrap = $("dpFilters");
  const COL = window.TripReportData.COL_BY_KEY;
  const parts = [];
  state.preview.base.columns.forEach((k) => {
    const c = COL[k];
    if (!c || c.fmt === "image") return;
    const vals = previewDistinct(k);
    if (vals.length < 2) return; // ค่าเดียว → ไม่ต้องกรอง
    const set = filterSet(k);
    const collapsed = state.preview.collapsed[k];
    const active = set.size < vals.length;
    const opts = vals.map((v) => `
      <label class="dp-fopt"><input type="checkbox" ${set.has(v) ? "checked" : ""}
        data-v="${escapeHtml(String(v))}" onchange="window.dpToggle('${k}', this.getAttribute('data-v'), this.checked)">
        <span>${escapeHtml(dispVal(v))}</span></label>`).join("");
    parts.push(`<div class="dp-fcol${collapsed ? " collapsed" : ""}">
      <div class="dp-fcol-hd" onclick="window.dpToggleCol('${k}')">
        <span>${escapeHtml(c.label)}</span>
        <span>${active ? `<span class="dp-fbadge">${set.size}</span> ` : ""}${collapsed ? "▸" : "▾"}</span>
      </div>
      <div class="dp-fcol-acts">
        <button onclick="event.stopPropagation();window.dpAll('${k}',true)">ทั้งหมด</button>
        <button onclick="event.stopPropagation();window.dpAll('${k}',false)">ล้าง</button>
      </div>
      <div class="dp-fcol-list">${opts}</div>
    </div>`);
  });
  wrap.innerHTML = parts.length ? parts.join("") : `<div class="dp-filters-empty">คอลัมน์ที่เลือกไม่มีค่าให้กรอง</div>`;
}
window.dpToggleCol = function (key) { state.preview.collapsed[key] = !state.preview.collapsed[key]; renderPreviewFilters(); };
window.dpToggle = function (key, val, checked) {
  const set = filterSet(key);
  if (checked) set.add(val); else set.delete(val);
  renderPreviewFilters();
  renderPreviewTable();
};
window.dpAll = function (key, sel) {
  const set = filterSet(key);
  set.clear();
  if (sel) previewDistinct(key).forEach((v) => set.add(v));
  renderPreviewFilters();
  renderPreviewTable();
};
// binding ปัจจุบันรวม filters (เฉพาะคอลัมน์ที่เลือกบางส่วน → ถือว่ากรอง)
function currentPreviewBinding() {
  const filters = {};
  Object.keys(state.preview.filters).forEach((key) => {
    const set = state.preview.filters[key];
    const total = previewDistinct(key).length;
    if (set && set.size > 0 && set.size < total) filters[key] = [...set];
  });
  return { ...state.preview.base, filters };
}
function renderPreviewTable() {
  const { html, rowCount } = window.TripReportData.renderTable(state.preview.ctx, currentPreviewBinding());
  $("dpPaper").innerHTML = html || `<div style="text-align:center;color:#94a3b8;padding:40px">ไม่มีข้อมูลตามที่กรอง</div>`;
  $("dpMeta").textContent = `· ${rowCount} รายการ`;
}
// แทรก/แทนที่บล็อกข้อมูลในเอกสาร
function placeBlock(html, binding) {
  const block = document.querySelector("#deBody [data-doc-datablock]");
  if (block) block.innerHTML = html;
  else { focusBody(); document.execCommand("insertHTML", false, `<div data-doc-datablock="1">${html}</div><p>&nbsp;</p>`); }
  state.doc.data_bindings = binding; // เก็บไว้ save + 🔄 รีเฟรช
  $("deRefreshBtn").style.display = "";
}
window.confirmInsertBlock = function () {
  const b = currentPreviewBinding();
  const { html, rowCount } = window.TripReportData.renderTable(state.preview.ctx, b);
  if (!html) { showToast("ไม่มีข้อมูลตามที่กรอง", "error"); return; }
  placeBlock(html, b);
  window.closeDataPreview();
  showToast(`แทรกตารางแล้ว (${rowCount} รายการ) — กด 💾 บันทึก`, "success");
};

// ── SELECTS ────────────────────────────────────────────────
function fillLetterheadSelect(sel) {
  const el = $("deLetterhead");
  el.innerHTML = `<option value="">— หัวเริ่มต้น —</option>` +
    state.letterheads.map((l) => `<option value="${l.letterhead_id}">${escapeHtml(l.name)}</option>`).join("");
  el.value = sel != null ? String(sel) : "";
}
function fillSignatorySelect(sel) {
  const el = $("deSignatory");
  el.innerHTML = `<option value="">— ไม่มีลายเซ็น —</option>` +
    state.signatories.map((s) => `<option value="${s.signatory_id}">${escapeHtml(s.name)}${s.title ? " — " + escapeHtml(s.title) : ""}</option>`).join("");
  el.value = sel != null ? String(sel) : "";
}

// ── LETTERHEAD / SIGNATURE RENDER (live) ───────────────────
function companyLogoUrl() { return (state.company && state.company.company_logo_url) || LETTERHEAD.logoUrl; }
function legacyLetterheadHtml(l) {
  return `<div style="font-weight:700;font-size:16px;color:#111">${escapeHtml(l.company_name || LETTERHEAD.nameEn)}</div>` +
    `<div style="font-size:12.5px;line-height:1.6;color:#222;white-space:pre-line">${escapeHtml(l.address || LETTERHEAD.addr)}</div>`;
}
function resolveLetterhead(id) {
  if (id) { const f = state.letterheads.find((l) => l.letterhead_id === +id); if (f) return f; }
  const def = state.letterheads.find((l) => l.is_default);
  if (def) return def;
  if (state.letterheads.length) return state.letterheads[0];
  return { logo_data: null, company_name: LETTERHEAD.nameEn, address: LETTERHEAD.addr };
}
function buildLetterheadHead(lh) {
  const logoSrc = lh.logo_data || companyLogoUrl();
  const contentHtml = lh.content_html && lh.content_html.trim() ? lh.content_html : legacyLetterheadHtml(lh);
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
        <div class="lh-info" style="text-align:center">${contentHtml}</div></div>`;
  }
  const dir = pos === "right" ? "row-reverse" : "row";
  return `<div class="doc-letterhead" style="flex-direction:${dir};align-items:${ai}">
      <div class="lh-logo" style="width:${lw}px">${logoImg}</div>
      <div class="lh-info">${contentHtml}</div></div>`;
}
function signatureHtml(sigId) {
  const sig = sigId ? state.signatories.find((s) => s.signatory_id === +sigId) : null;
  if (!sig) return "";
  const img = sig.signature_data ? `<img src="${sig.signature_data}" alt="signature" />` : `<div class="sig-line"></div>`;
  return `<div class="doc-signature">${img}
      <div class="sig-name">(${escapeHtml(sig.name)})</div>
      ${sig.title ? `<div class="sig-title">${escapeHtml(sig.title)}</div>` : ""}</div>`;
}
function renderHead() { $("dePaperHead").innerHTML = buildLetterheadHead(resolveLetterhead(+$("deLetterhead").value || null)); }
function renderSig() { $("dePaperSig").innerHTML = signatureHtml(+$("deSignatory").value || null); }

// compose เอกสารเต็ม (สำหรับ preview/print/pdf)
function composeDocHtml() {
  const head = buildLetterheadHead(resolveLetterhead(+$("deLetterhead").value || null));
  const body = `<div class="doc-body">${cleanBody()}</div>`;
  return head + body + signatureHtml(+$("deSignatory").value || null);
}

// ── BODY / SELECTION TRACKING ──────────────────────────────
let _range = null;
function bindBodyEvents() {
  $("deLetterhead").addEventListener("change", renderHead);
  $("deSignatory").addEventListener("change", renderSig);
  $("deImageInput").addEventListener("change", onImagePicked);
  document.addEventListener("selectionchange", onSelChange);
  document.addEventListener("keydown", (e) => {
    // Ctrl+S = save
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); window.saveDoc(); return; }
    // ESC = ปิด modal (พรีวิวข้อมูล ก่อน → พรีวิวเอกสาร)
    if (e.key === "Escape") {
      if ($("dpModal").classList.contains("open")) { window.closeDataPreview(); return; }
      if ($("dePreviewModal").classList.contains("open")) window.closePreview();
    }
  });
}
function inBody(node) {
  const el = node && (node.nodeType === 3 ? node.parentElement : node);
  return el && $("deBody").contains(el) ? el : null;
}
// หา cell จาก element ใน body — ถ้าไม่ได้อยู่ใน cell ตรงๆ แต่เลือกคลุมตาราง → ใช้ cell แรก
function cellFromEl(el) {
  if (!el) return null;
  let cell = el.closest ? el.closest("td,th") : null;
  if (cell) return cell;
  const tbl = el.closest ? el.closest("table") : null;
  if (tbl) return tbl.querySelector("td,th");
  const inner = el.querySelector ? el.querySelector("td,th") : null;
  return inner || null;
}
function onSelChange() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const el = inBody(sel.anchorNode);
  if (!el) return;
  _range = sel.getRangeAt(0).cloneRange();
  // อัปเดตช่องขนาดฟอนต์
  const px = Math.round(parseFloat(getComputedStyle(el).fontSize) || 15);
  const box = $("deSize");
  if (box && document.activeElement !== box) box.value = px;
  // highlight cell + เปิด/ปิด table tools
  highlightCell(cellFromEl(el));
}
function restoreRange() {
  if (!_range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(_range);
}
function focusBody() { $("deBody").focus(); restoreRange(); }

// ── TOOLBAR ────────────────────────────────────────────────
function bindToolbar() {
  try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
  // ทุกปุ่มใน toolbar: คง selection/caret ไว้ (กัน selection หลุดตอนคลิก → table tools รู้ว่าอยู่ cell ไหน)
  document.querySelectorAll("#deToolbar button").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
  });
  document.querySelectorAll("#deToolbar button[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => { focusBody(); document.execCommand(btn.dataset.cmd, false, null); });
  });
  document.querySelectorAll("#deToolbar button[data-font]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => rteFont(btn.dataset.font === "up" ? 2 : -2));
  });
  $("deBlock").addEventListener("change", (e) => {
    focusBody();
    document.execCommand("formatBlock", false, e.target.value);
    e.target.selectedIndex = 0;
  });
  $("deSize").addEventListener("change", (e) => {
    const px = parseInt(e.target.value, 10);
    if (px) { focusBody(); applyFontPx(px); }
  });
  $("deSize").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
  $("deColor").addEventListener("input", (e) => { focusBody(); document.execCommand("foreColor", false, e.target.value); });
}
function applyFontPx(px) {
  px = Math.min(96, Math.max(9, px | 0));
  document.execCommand("styleWithCSS", false, false);
  document.execCommand("fontSize", false, "7");
  document.querySelectorAll('#deBody font[size="7"]').forEach((f) => { f.removeAttribute("size"); f.style.fontSize = px + "px"; });
  document.execCommand("styleWithCSS", false, true);
}
function rteFont(delta) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) { showToast("เลือกข้อความที่ต้องการปรับขนาดก่อน", "error"); return; }
  const el = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode);
  const cur = el ? parseFloat(getComputedStyle(el).fontSize) || 15 : 15;
  focusBody();
  applyFontPx(Math.round(cur) + delta);
}

// ── INSERT: image / table / page-break ─────────────────────
window.pickImage = function () { $("deImageInput").click(); };
function onImagePicked(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1000;
      const scale = Math.min(1, max / img.width);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL("image/jpeg", 0.85);
      focusBody();
      document.execCommand("insertHTML", false, `<img src="${url}" style="max-width:100%;height:auto" />`);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
window.insertTable = function () {
  const r = 3, c = 3;
  const cell = `<td style="border:1px solid #000;padding:4px 8px;min-width:40px">&nbsp;</td>`;
  const row = `<tr>${cell.repeat(c)}</tr>`;
  const tbl = `<table style="border-collapse:collapse;width:100%;margin:6px 0">${row.repeat(r)}</table><p>&nbsp;</p>`;
  focusBody();
  document.execCommand("insertHTML", false, tbl);
};
window.insertPageBreak = function () {
  focusBody();
  document.execCommand("insertHTML", false, `<div class="de-pagebreak"></div><p>&nbsp;</p>`);
};

// ── TABLE EDITING ──────────────────────────────────────────
let _activeCell = null;
function highlightCell(cell) {
  if (_activeCell && _activeCell !== cell) _activeCell.classList.remove("de-cell-active");
  _activeCell = cell || null;
  if (_activeCell) _activeCell.classList.add("de-cell-active");
  $("deTableGrp").classList.toggle("off", !_activeCell);
}
function curCell() {
  if (_activeCell && $("deBody").contains(_activeCell)) return _activeCell;
  const sel = window.getSelection();
  const el = sel && sel.anchorNode && inBody(sel.anchorNode);
  return cellFromEl(el);
}
function cellIndex(cell) { return Array.prototype.indexOf.call(cell.parentElement.children, cell); }
window.tblRow = function (dir) {
  const cell = curCell(); if (!cell) return;
  const tr = cell.parentElement;
  const cols = tr.children.length;
  const nr = document.createElement("tr");
  for (let i = 0; i < cols; i++) {
    const td = document.createElement("td");
    td.style.cssText = "border:1px solid #000;padding:4px 8px;min-width:40px";
    td.innerHTML = "&nbsp;";
    nr.appendChild(td);
  }
  if (dir < 0) tr.parentElement.insertBefore(nr, tr);
  else tr.parentElement.insertBefore(nr, tr.nextSibling);
};
window.tblDelRow = function () {
  const cell = curCell(); if (!cell) return;
  const tr = cell.parentElement;
  const tbody = tr.parentElement;
  if (tbody.children.length <= 1) { showToast("ลบแถวสุดท้ายไม่ได้ — ลบทั้งตารางแทน", "error"); return; }
  highlightCell(null);
  tr.remove();
};
window.tblCol = function (dir) {
  const cell = curCell(); if (!cell) return;
  const idx = cellIndex(cell);
  const table = cell.closest("table");
  table.querySelectorAll("tr").forEach((tr) => {
    const ref = tr.children[idx];
    const td = document.createElement(ref && ref.tagName === "TH" ? "th" : "td");
    td.style.cssText = "border:1px solid #000;padding:4px 8px;min-width:40px";
    td.innerHTML = "&nbsp;";
    if (dir < 0) tr.insertBefore(td, ref || null);
    else tr.insertBefore(td, ref ? ref.nextSibling : null);
  });
};
window.tblDelCol = function () {
  const cell = curCell(); if (!cell) return;
  const idx = cellIndex(cell);
  const table = cell.closest("table");
  if (table.rows[0] && table.rows[0].children.length <= 1) { showToast("ลบคอลัมน์สุดท้าย — ลบทั้งตารางแทน", "error"); return; }
  highlightCell(null);
  table.querySelectorAll("tr").forEach((tr) => { if (tr.children[idx]) tr.children[idx].remove(); });
};
window.tblDelTable = function () {
  const cell = curCell(); if (!cell) { showToast("คลิกในตารางที่จะลบก่อน", "error"); return; }
  const table = cell.closest("table");
  const run = () => {
    // ถ้าตารางอยู่ในบล็อกข้อมูล (data-doc-datablock) → ลบทั้งบล็อก + เคลียร์ binding
    const block = table.closest("[data-doc-datablock]");
    highlightCell(null);
    if (block) {
      block.remove();
      if (state.doc) state.doc.data_bindings = {};
      $("deRefreshBtn").style.display = "none";
    } else {
      table.remove();
    }
    showToast("ลบตารางแล้ว", "success");
  };
  if (window.ConfirmModal?.open) {
    window.ConfirmModal.open({ title: "ลบตาราง?", message: "ลบทั้งตารางออกจากเอกสาร", icon: "🗑", tone: "danger", okText: "ลบ" })
      .then((ok) => { if (ok) run(); });
  } else { run(); }
};

// ── ZOOM ───────────────────────────────────────────────────
function applyZoom() {
  $("dePaperScale").style.transform = `scale(${state.zoom})`;
  $("deZoomLabel").textContent = Math.round(state.zoom * 100) + "%";
}
function fitZoom() {
  const avail = $("deCanvas").clientWidth - 32;
  state.zoom = Math.min(1, Math.max(0.3, avail / 794));
  applyZoom();
}
window.deZoom = function (dir) {
  if (dir === 0) { fitZoom(); return; }
  const steps = [0.4, 0.5, 0.6, 0.7, 0.85, 1, 1.25, 1.5];
  let i = steps.findIndex((s) => Math.abs(s - state.zoom) < 0.02);
  if (i < 0) i = 5;
  i = Math.max(0, Math.min(steps.length - 1, i + dir));
  state.zoom = steps[i];
  applyZoom();
};

// ── SAVE ───────────────────────────────────────────────────
function cleanBody() {
  // ลบ highlight cell ชั่วคราวก่อนเก็บ
  const tmp = $("deBody").cloneNode(true);
  tmp.querySelectorAll(".de-cell-active").forEach((c) => c.classList.remove("de-cell-active"));
  return tmp.innerHTML;
}
window.saveDoc = async function () {
  const title = $("deTitle").value.trim();
  if (!title) { showToast("กรุณากรอกชื่อเอกสาร", "error"); return; }
  showLoading(true);
  try {
    const payload = {
      title,
      status: $("deStatus").value || "DRAFT",
      letterhead_id: +$("deLetterhead").value || null,
      signatory_id: +$("deSignatory").value || null,
      body: cleanBody(),
      data_bindings: state.doc.data_bindings || {},
      updated_at: new Date().toISOString(),
    };
    if (state.docId) {
      await sbFetch("trip_documents", `?doc_id=eq.${state.docId}`, { method: "PATCH", body: payload });
      state.doc = { ...state.doc, ...payload };
      showToast("บันทึกเอกสารแล้ว", "success");
    } else {
      // โหมดสร้างใหม่ → INSERT แล้วผูก doc_id + อัปเดต URL (ไม่ reload)
      const res = await sbFetch("trip_documents", "", {
        method: "POST",
        body: { ...payload, template_id: null, field_values: {} },
      });
      const created = Array.isArray(res) ? res[0] : res;
      if (!created?.doc_id) throw new Error("no doc_id returned");
      state.docId = created.doc_id;
      state.doc = created;
      history.replaceState(null, "", `?doc_id=${created.doc_id}`);
      showToast("สร้างเอกสารแล้ว", "success");
    }
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ── PREVIEW / PRINT / PDF ──────────────────────────────────
window.previewDoc = function () {
  $("previewPaper").innerHTML = composeDocHtml();
  $("dePreviewModal").classList.add("open");
};
window.closePreview = function () { $("dePreviewModal").classList.remove("open"); };
window.printDoc = function () {
  $("printArea").innerHTML = `<div class="doc-paper">${composeDocHtml()}</div>`;
  const prev = document.title;
  document.title = $("deTitle").value || "เอกสาร";
  window.print();
  setTimeout(() => (document.title = prev), 400);
};
function waitImages(el) {
  const imgs = [...el.querySelectorAll("img")];
  return Promise.all(imgs.map((im) => im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; })));
}
window.exportPdf = async function () {
  if (!window.jspdf || typeof html2canvas === "undefined") { showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ", "error"); return; }
  showLoading(true);
  try {
    const holder = $("pdfHolder");
    holder.innerHTML = `<div class="doc-paper">${composeDocHtml()}</div>`;
    const paper = holder.firstElementChild;
    paper.style.boxShadow = "none";
    await waitImages(paper);
    const canvas = await html2canvas(paper, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new window.jspdf.jsPDF("p", "mm", "a4");
    const pw = 210, ph = 297;
    const imgH = (canvas.height * pw) / canvas.width;
    if (imgH <= ph) pdf.addImage(img, "JPEG", 0, 0, pw, imgH);
    else {
      let remaining = imgH, position = 0;
      while (remaining > 0) { pdf.addImage(img, "JPEG", 0, position, pw, imgH); remaining -= ph; if (remaining > 0) { pdf.addPage(); position -= ph; } }
    }
    pdf.save((($("deTitle").value || "เอกสาร").replace(/[\\/:*?"<>|]+/g, "_")) + ".pdf");
    holder.innerHTML = "";
    showToast("บันทึก PDF แล้ว", "success");
  } catch (e) {
    showToast("สร้าง PDF ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── REFRESH DATA BLOCK ─────────────────────────────────────
window.refreshDocData = async function () {
  const binding = state.doc?.data_bindings;
  if (!binding || !binding.trip_id) { showToast("เอกสารนี้ไม่ได้เชื่อมข้อมูลจาก custom-report", "error"); return; }
  if (!window.TripReportData) { showToast("โหลด engine ไม่สำเร็จ (report-data-source.js)", "error"); return; }
  const block = document.querySelector("#deBody [data-doc-datablock]");
  if (!block) { showToast("ไม่พบบล็อกตารางในเอกสาร (อาจถูกลบ)", "error"); return; }
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

// ── START ──────────────────────────────────────────────────
window.addEventListener("resize", () => { /* คงซูมไว้ */ });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
