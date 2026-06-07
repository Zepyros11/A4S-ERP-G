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
  // left data panel — เลือกทริปเพื่อไปจัดข้อมูลใน Custom Report
  panel: { trip: null },
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
  // panel: prefill ทริปจาก binding เดิม (ถ้ามี)
  if (b && b.trip_id) state.panel.trip = b.trip_id;
  renderTripOptions();
  resetHistory();   // เริ่มประวัติ undo/redo จากสถานะที่โหลดมา
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
// ไป Custom Report เพื่อเลือก/กรองข้อมูล แล้วส่งกลับมาที่เอกสารนี้
// - แทรก placeholder บล็อกที่ตำแหน่งเคอร์เซอร์ (ถ้ายังไม่มี) → custom-report จะเติมตารางตรงนี้
// - บันทึกเอกสารก่อน (ต้องมี doc_id) → custom-report.html?trip_id=X&insert_doc=N
window.goCustomReport = async function () {
  const trip = +$("dePanelTrip").value || (state.doc.data_bindings && state.doc.data_bindings.trip_id) || null;
  if (!trip) { showToast("เลือกทริปก่อน", "error"); $("dePanelTrip").focus(); return; }
  if (!$("deTitle").value.trim()) { showToast("กรอกชื่อเอกสารก่อน", "error"); $("deTitle").focus(); return; }
  // วาง placeholder ตารางที่เคอร์เซอร์ ถ้ายังไม่มีบล็อกข้อมูล
  if (!document.querySelector("#deBody [data-doc-datablock]")) {
    focusBody();
    document.execCommand("insertHTML", false, `<div data-doc-datablock="1"></div>`);
  }
  await window.saveDoc();          // insert (โหมดใหม่) หรือ update → ผูก state.docId
  if (!state.docId) return;        // save ไม่ผ่าน (เช่น error) → ไม่ไปต่อ
  location.href = `./custom-report.html?trip_id=${trip}&insert_doc=${state.docId}`;
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
  initHistory();
  $("deLetterhead").addEventListener("change", renderHead);
  $("deSignatory").addEventListener("change", renderSig);
  $("deImageInput").addEventListener("change", onImagePicked);
  document.addEventListener("selectionchange", onSelChange);
  // popup ตารางตามแถว: เลื่อน/ย่อขยายจอ → reposition
  $("deCanvas").addEventListener("scroll", () => { if (_activeCell) positionTableTools(_activeCell); });
  window.addEventListener("resize", () => { if (_activeCell) positionTableTools(_activeCell); });
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    // ใช้ e.code (ปุ่มจริง) ไม่ใช่ e.key → ทำงานได้ทุกภาษาคีย์บอร์ด (ไทย/อังกฤษ)
    // Undo / Redo
    if (mod && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && e.code === "KeyY") { e.preventDefault(); doRedo(); return; }
    // Ctrl+S = save
    if (mod && e.code === "KeyS") { e.preventDefault(); window.saveDoc(); return; }
    // ESC = ปิดพรีวิวเอกสาร
    if (e.key === "Escape" && $("dePreviewModal").classList.contains("open")) window.closePreview();
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

// ── UNDO / REDO (snapshot history ครอบคลุมทุกการแก้ รวม DOM ตาราง) ──
let _hist = [], _hi = -1, _histTimer = null, _restoring = false, _mo = null;
function initHistory() {
  // MutationObserver จับทุกการเปลี่ยนใน body (พิมพ์/จัดรูปแบบ/แก้ตาราง) → snapshot (debounce)
  _mo = new MutationObserver(() => { if (!_restoring) scheduleSnapshot(); });
  _mo.observe($("deBody"), { childList: true, subtree: true, characterData: true, attributes: true });
}
function resetHistory() {            // เรียกตอนโหลดเอกสารเสร็จ — เริ่ม history ใหม่
  _hist = [cleanBody()];
  _hi = 0;
  clearTimeout(_histTimer);
}
function snapshot() {
  const html = cleanBody();          // ตัด highlight cell (de-cell-active) ออก → ไม่เก็บใน history
  if (_hi >= 0 && _hist[_hi] === html) return;   // เหมือนเดิม → ไม่บันทึก (กัน restore ทำ tail หาย)
  _hist = _hist.slice(0, _hi + 1);               // ตัด redo tail เมื่อมีการแก้ใหม่
  _hist.push(html);
  if (_hist.length > 120) _hist.shift();
  _hi = _hist.length - 1;
}
function scheduleSnapshot() { clearTimeout(_histTimer); _histTimer = setTimeout(snapshot, 350); }
function restoreHist() {
  _restoring = true;
  $("deBody").innerHTML = _hist[_hi];
  _restoring = false;
  highlightCell(null);              // ตารางถูกแทนที่ → ปิด popup เครื่องมือ
  try { $("deBody").focus(); const s = window.getSelection(); s.selectAllChildren($("deBody")); s.collapseToEnd(); } catch (e) {}
}
function doUndo() {
  clearTimeout(_histTimer);
  if (_hi < 0) return;
  if (cleanBody() !== _hist[_hi]) snapshot();  // เก็บการพิมพ์ที่ยังค้าง debounce ก่อน
  if (_hi <= 0) return;
  _hi--; restoreHist();
}
function doRedo() {
  clearTimeout(_histTimer);
  if (_hi >= _hist.length - 1) return;
  _hi++; restoreHist();
}

// ── TOOLBAR ────────────────────────────────────────────────
function bindToolbar() {
  try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
  // ทุกปุ่มใน toolbar + popup ตาราง: คง selection/caret ไว้ (กัน selection หลุด → รู้ว่าอยู่ cell ไหน)
  document.querySelectorAll("#deToolbar button, #deTableTools button").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
  });
  document.querySelectorAll("#deToolbar button[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd;
      if (cmd === "undo") return doUndo();
      if (cmd === "redo") return doRedo();
      focusBody();
      document.execCommand(cmd, false, null);
    });
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
  positionTableTools(_activeCell);
}
// วาง popup เครื่องมือตาราง "เหนือแถว" ที่เลือก (ถ้าไม่มีที่ → ใต้แถว) — ไม่บังเซลล์ที่กำลังพิมพ์
function positionTableTools(cell) {
  const tools = $("deTableTools");
  if (!cell || !$("deBody").contains(cell)) { tools.classList.remove("open"); return; }
  tools.classList.add("open");
  const rowR = cell.parentElement.getBoundingClientRect();
  const cellR = cell.getBoundingClientRect();
  const tw = tools.offsetWidth || 300, th = tools.offsetHeight || 50;
  let top = rowR.top - th - 6;                 // เหนือแถว
  if (top < 8) top = rowR.bottom + 6;          // ไม่พอด้านบน → ใต้แถว
  top = Math.min(window.innerHeight - th - 8, Math.max(8, top));
  const left = Math.max(8, Math.min(window.innerWidth - tw - 8, cellR.left)); // จัดซ้ายตรงเซลล์
  tools.style.left = left + "px";
  tools.style.top = top + "px";
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
  highlightCell(cell); // reposition popup
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
  highlightCell(cell); // reposition popup (แถวกว้างขึ้น)
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
