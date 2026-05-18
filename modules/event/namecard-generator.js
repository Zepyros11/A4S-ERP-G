/* ============================================================
   namecard-generator.js
   ป้ายชื่อ Event · 8.5cm × 6cm · A4 layout 8/หน้า
   ============================================================ */
(function () {
  "use strict";

  const PER_PAGE = 8;
  const VIP_PER_PAGE = 10;          // 2 × 5
  const LOGO_PATH = "../../assets/logo/logo-a4s.png";

  // [{ name, position }]
  let rows = [];
  let zoom = 0.5;

  // ── VIP tab state ─────────────────────────────────────────
  let vipQty = 10;
  let vipZoom = 0.5;
  let activeTab = "namecard";       // "namecard" | "vip" | "cert"

  // ── Certificate tab state (independent from namecard rows) ─
  let certRows = [];                // [{ name1, name2, position }]
  let certZoom = 0.4;

  // 5 position keys (matches default A4S corporate ladder)
  const CERT_POSITIONS = [
    { key: "avp",             label: "Assistant Vice President", short: "AVP" },
    { key: "vp",              label: "Vice President",           short: "VP"  },
    { key: "svp",             label: "Senior Vice President",    short: "SVP" },
    { key: "director",        label: "Director",                 short: "DIR" },
    { key: "senior-director", label: "Senior Director",          short: "SD"  },
  ];
  // Templates stored as data URLs in localStorage
  const CERT_TPL_LS_KEY = "a4s_cert_templates_v1";
  let certTemplates = {};           // { avp: "data:image/jpeg;base64,..." }

  // Cert layout config (mm) — averaged from 5 measured templates
  const CERT_NAME_Y_MM   = 133;     // top of first line
  const CERT_NAME_LH     = 1.27;    // line-height for ~13.5mm gap at 30pt
  const CERT_NAME_SIZE   = "30pt";

  // ── Helpers ────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function showToast(msg, type = "success") {
    const t = $("toast");
    if (!t) return;
    t.className = `toast toast-${type} show`;
    t.textContent = msg;
    setTimeout(() => t.classList.remove("show"), 2800);
  }

  function setStep(idx) {
    [1, 2, 3].forEach(i => {
      const el = $("step" + i);
      if (!el) return;
      el.classList.remove("active", "done");
      if (i < idx) el.classList.add("done");
      else if (i === idx) el.classList.add("active");
    });
  }

  // ── Drag & drop / file pick ────────────────────────────────
  function onDrag(e, over) {
    e.preventDefault();
    $("dropZone")?.classList.toggle("dragover", !!over);
  }
  function onDrop(e) {
    e.preventDefault();
    $("dropZone")?.classList.remove("dragover");
    const f = e.dataTransfer?.files?.[0];
    if (f) readFile(f);
  }
  function onFilePick(e) {
    const f = e.target.files?.[0];
    if (f) readFile(f);
  }
  function readFile(file) {
    const name = file.name.toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(name)) {
      showToast("รองรับเฉพาะไฟล์ .xlsx / .xls / .csv", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        parseSheet(raw);
      } catch (err) {
        console.error(err);
        showToast("อ่านไฟล์ไม่สำเร็จ — " + err.message, "error");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Parse rows (skip header row if non-data) ───────────────
  function parseSheet(raw) {
    if (!raw || !raw.length) {
      showToast("ไม่พบข้อมูลในไฟล์", "error");
      return;
    }
    // Detect header: if row 0 first cell matches common labels, skip
    const headerHints = ["ชื่อ", "name", "fullname", "full name", "full_name"];
    let start = 0;
    const r0 = (raw[0]?.[0] || "").toString().trim().toLowerCase();
    if (headerHints.some(h => r0 === h.toLowerCase())) start = 1;

    const out = [];
    for (let i = start; i < raw.length; i++) {
      const r = raw[i] || [];
      const name = (r[0] != null ? String(r[0]) : "").trim();
      const position = (r[1] != null ? String(r[1]) : "").trim();
      if (!name && !position) continue;
      out.push({ name, position });
    }
    if (!out.length) {
      showToast("ไม่พบรายชื่อ — ใส่ข้อมูลในคอลัมน์ A (ชื่อ) และ B (ตำแหน่ง)", "error");
      return;
    }
    rows = out;
    showToast(`โหลดสำเร็จ · ${out.length} รายชื่อ`);
    refreshAll();
  }

  // ── Data editor table ──────────────────────────────────────
  function renderPreviewTable() {
    const body = $("previewBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" style="padding:24px;text-align:center;color:#94a3b8">ยังไม่มีข้อมูล — กรุณาอัปโหลดไฟล์</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((r, i) => `
      <tr data-idx="${i}">
        <td class="col-idx">${i + 1}</td>
        <td><input class="nmc-cell-input" data-field="name" data-idx="${i}" value="${esc(r.name)}" placeholder="ชื่อ-นามสกุล"></td>
        <td><input class="nmc-cell-input" data-field="position" data-idx="${i}" value="${esc(r.position)}" placeholder="ตำแหน่ง"></td>
        <td class="col-act"><button class="nmc-row-del" data-idx="${i}" title="ลบแถวนี้">🗑</button></td>
      </tr>
    `).join("");

    body.querySelectorAll(".nmc-cell-input").forEach(inp => {
      inp.addEventListener("input", () => {
        const idx = +inp.dataset.idx;
        const field = inp.dataset.field;
        if (rows[idx]) {
          rows[idx][field] = inp.value;
          renderSheets(); // live update of card preview
        }
      });
    });
    body.querySelectorAll(".nmc-row-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = +btn.dataset.idx;
        rows.splice(idx, 1);
        refreshAll();
      });
    });
  }

  // Thai honorifics: glue them to the following first name (remove the space)
  // e.g. "คุณ วันวิสาข แก้วแกมทอง" → "คุณวันวิสาข แก้วแกมทอง"
  function formatName(raw) {
    const s = String(raw || "").trim().replace(/\s+/g, " ");
    return s.replace(/^(คุณ|นาย|นาง|นางสาว|น\.ส\.|ดร\.|ด\.ช\.|ด\.ญ\.)\s+/, "$1");
  }

  // ── A4 sheet renderer ──────────────────────────────────────
  function cardHtml(r) {
    const name = esc(formatName(r.name));
    const pos  = esc(r.position || "");
    return `
      <div class="nmc-card">
        <div class="nmc-card-logo"><img src="${LOGO_PATH}" alt="A4S" onerror="this.style.display='none'"></div>
        <div class="nmc-card-name" data-text="${name}">${name}</div>
        <div class="nmc-card-band">
          <div class="nmc-card-position" data-text="${pos}">${pos}</div>
        </div>
      </div>
    `;
  }

  function blankCardHtml() {
    return `<div class="nmc-card" style="visibility:hidden"></div>`;
  }

  function chunked(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function renderSheets() {
    const scroller = $("sheetScroller");
    const printArea = $("printArea");
    if (!scroller || !printArea) return;

    if (!rows.length) {
      scroller.innerHTML = "";
      printArea.innerHTML = "";
      return;
    }

    const pages = chunked(rows, PER_PAGE);
    const buildHtml = (withBreaks) => pages.map((page, idx) => {
      const cells = [];
      for (let i = 0; i < PER_PAGE; i++) {
        cells.push(page[i] ? cardHtml(page[i]) : blankCardHtml());
      }
      const brk = (withBreaks && idx > 0) ? '<div class="nmc-page-break"></div>' : '';
      return `${brk}<div class="nmc-a4">${cells.join("")}</div>`;
    }).join("");

    scroller.innerHTML  = buildHtml(false); // no break divs in on-screen preview
    printArea.innerHTML = buildHtml(true);  // hard break divs in print area

    // Apply zoom to on-screen sheets only
    scroller.querySelectorAll(".nmc-a4").forEach(el => {
      el.style.setProperty("--nmc-zoom", zoom);
    });

    // Auto-fit name & position text to box · positions use uniform
    // sizing (smallest fit) so all cards look visually consistent.
    requestAnimationFrame(() => {
      [scroller, printArea].forEach(root => {
        root.querySelectorAll(".nmc-card-name").forEach(autoFit);
        const posEls = Array.from(root.querySelectorAll(".nmc-card-position"));
        uniformFit(posEls);
      });
    });
  }

  // Run autoFit on each, then collapse to the smallest size so all
  // text on the page renders at the same scale.
  function uniformFit(elements) {
    if (!elements.length) return;
    const sizes = elements.map(el => {
      autoFit(el);
      return parseFloat(el.style.fontSize) || 12;
    });
    const min = Math.min(...sizes);
    elements.forEach(el => { el.style.fontSize = min + "px"; });
  }

  // Shrink font-size until text fits its container (width & height).
  // For position text we also check the parent band's height so long
  // 2-line strings like "Country Manager Nigeria" don't bleed out.
  function autoFit(el) {
    const isName = el.classList.contains("nmc-card-name");
    let max = isName ? 28 : 34;
    const min = isName ? 8 : 12;
    el.style.fontSize = max + "px";

    const parent = el.parentElement;
    const parentH = parent ? parent.clientHeight : Infinity;
    const parentW = parent ? parent.clientWidth  : Infinity;

    let safety = 40;
    while (max > min && safety-- > 0) {
      const tooWide = el.scrollWidth > el.clientWidth + 1
                   || el.scrollWidth > parentW + 1;
      const tooTall = el.scrollHeight > el.clientHeight + 1
                   || el.scrollHeight > parentH + 1;
      if (!tooWide && !tooTall) break;
      max -= 1;
      el.style.fontSize = max + "px";
    }
  }

  // ── Stat updates ───────────────────────────────────────────
  function updateCounts() {
    $("rowCount") && ($("rowCount").textContent = rows.length);
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    $("pageCount") && ($("pageCount").textContent = rows.length ? pages : 0);
  }

  function refreshAll() {
    const has = rows.length > 0;
    $("dataBlock").style.display = has ? "" : "none";
    $("actionsBlock").style.display = has ? "" : "none";
    $("layoutBlock").style.display = has ? "" : "none";
    setStep(has ? 2 : 1);
    updateCounts();
    renderPreviewTable();
    renderSheets();
  }

  // ── Actions ────────────────────────────────────────────────
  function addRow() {
    rows.push({ name: "", position: "" });
    refreshAll();
    // focus the newly-added name cell
    setTimeout(() => {
      const inputs = $("previewBody").querySelectorAll('.nmc-cell-input[data-field="name"]');
      inputs[inputs.length - 1]?.focus();
    }, 30);
  }
  function clearAll() {
    if (!rows.length) return;
    if (!confirm("ล้างรายชื่อทั้งหมด?")) return;
    rows = [];
    refreshAll();
  }
  function resetAll() {
    rows = [];
    const f = $("fileInput"); if (f) f.value = "";
    refreshAll();
    setStep(1);
  }
  function setZoom(dir) {
    const steps = [0.25, 0.35, 0.5, 0.65, 0.8, 1.0];
    let i = steps.indexOf(zoom);
    if (i < 0) i = 2;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    zoom = steps[i];
    $("zoomLabel") && ($("zoomLabel").textContent = Math.round(zoom * 100) + "%");
    document.querySelectorAll("#sheetScroller .nmc-a4").forEach(el => {
      el.style.setProperty("--nmc-zoom", zoom);
    });
  }

  function printNow() {
    if (!rows.length) {
      showToast("ยังไม่มีรายชื่อ", "error");
      return;
    }
    setStep(3);
    requestAnimationFrame(() => {
      setTimeout(() => window.print(), 80);
    });
  }

  // ── Export PDF (via html2canvas + jsPDF) ──────────────────
  // Bypasses Edge's flaky print pipeline. Each A4 sheet rendered
  // off-screen → captured as canvas → embedded in PDF page.
  async function exportPDF() {
    if (!rows.length) {
      showToast("ยังไม่มีรายชื่อ", "error");
      return;
    }
    if (!window.html2canvas || !window.jspdf) {
      showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "error");
      return;
    }
    setStep(3);
    const btn = $("btnExportPDF");
    const origText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังสร้าง PDF..."; }

    try {
      renderSheets();
      // Wait for autoFit + paint
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 100));

      const printArea = $("printArea");
      // Temporarily promote to visible so html2canvas can capture
      const origStyle = {
        position: printArea.style.position,
        left: printArea.style.left,
        top: printArea.style.top,
        visibility: printArea.style.visibility,
      };
      printArea.style.position = "fixed";
      printArea.style.left = "0";
      printArea.style.top = "0";
      printArea.style.visibility = "visible";
      printArea.style.zIndex = "-1";

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const sheets = printArea.querySelectorAll(".nmc-a4");

      for (let i = 0; i < sheets.length; i++) {
        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(sheets[i], {
          scale: 3,                  // ~3× DPI for sharp print
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        // Captured element is 210×297mm (full A4) with cards already
        // positioned top-center · place at full page coords.
        pdf.addImage(imgData, "JPEG", 0, 0, 210, 297, undefined, "FAST");
      }

      // Restore
      printArea.style.position   = origStyle.position;
      printArea.style.left       = origStyle.left;
      printArea.style.top        = origStyle.top;
      printArea.style.visibility = origStyle.visibility;
      printArea.style.zIndex     = "";

      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`namecards-${stamp}.pdf`);
      showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${rows.length} ใบ)`);
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  }

  // ════════════════════════════════════════════════════════════
  // VIP TAB
  // ════════════════════════════════════════════════════════════
  function switchTab(tab) {
    activeTab = tab;
    $("paneNamecard").style.display = tab === "namecard" ? "" : "none";
    $("paneVip").style.display      = tab === "vip"      ? "" : "none";
    $("paneCert").style.display     = tab === "cert"     ? "" : "none";
    document.querySelectorAll(".nmc-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tab);
    });
    // Template-download button is namecard-specific
    const btnT = $("btnTemplate");
    if (btnT) btnT.style.display = tab === "namecard" ? "" : "none";

    if (tab === "vip")  renderVipSheets();
    if (tab === "cert") renderCertSheets();
  }

  function vipCardHtml() {
    return `
      <div class="vip-card">
        <div class="vip-card-logo"><img src="${LOGO_PATH}" alt="A4S" onerror="this.style.display='none'"></div>
        <div class="vip-card-band">
          <div class="vip-card-text">VIP</div>
        </div>
      </div>
    `;
  }
  function vipBlankHtml() { return `<div class="vip-card" style="visibility:hidden"></div>`; }

  function renderVipSheets() {
    const qty = Math.max(0, vipQty | 0);
    const scroller  = $("vipSheetScroller");
    const printArea = $("vipPrintArea");
    if (!scroller || !printArea) return;

    const pageCount = Math.max(1, Math.ceil(qty / VIP_PER_PAGE));
    $("vipPageCount") && ($("vipPageCount").textContent = qty ? pageCount : 0);

    if (!qty) {
      scroller.innerHTML  = "";
      printArea.innerHTML = "";
      return;
    }

    const buildHtml = () => {
      let remaining = qty;
      const pages = [];
      for (let p = 0; p < pageCount; p++) {
        const cells = [];
        for (let i = 0; i < VIP_PER_PAGE; i++) {
          if (remaining > 0) { cells.push(vipCardHtml()); remaining--; }
          else cells.push(vipBlankHtml());
        }
        pages.push(`<div class="vip-a4">${cells.join("")}</div>`);
      }
      return pages.join("");
    };

    const html = buildHtml();
    scroller.innerHTML  = html;
    printArea.innerHTML = html;
    scroller.querySelectorAll(".vip-a4").forEach(el => el.style.setProperty("--nmc-zoom", vipZoom));
  }

  function setVipQty(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 500) n = 500;
    vipQty = n;
    const inp = $("vipQtyInput");
    if (inp && inp.value !== String(n)) inp.value = n;
    renderVipSheets();
  }
  function bumpVipQty(dir) { setVipQty(vipQty + dir); }

  function setVipZoom(dir) {
    const steps = [0.25, 0.35, 0.5, 0.65, 0.8, 1.0];
    let i = steps.indexOf(vipZoom);
    if (i < 0) i = 2;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    vipZoom = steps[i];
    $("vipZoomLabel") && ($("vipZoomLabel").textContent = Math.round(vipZoom * 100) + "%");
    document.querySelectorAll("#vipSheetScroller .vip-a4").forEach(el => {
      el.style.setProperty("--nmc-zoom", vipZoom);
    });
  }

  async function exportVipPDF() {
    if (!vipQty) { showToast("กรุณาระบุจำนวนป้าย VIP", "error"); return; }
    if (!window.html2canvas || !window.jspdf) {
      showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "error"); return;
    }
    const btn = $("btnExportVipPDF");
    const orig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังสร้าง PDF..."; }

    try {
      renderVipSheets();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 80));

      const printArea = $("vipPrintArea");
      const orig2 = {
        position: printArea.style.position, left: printArea.style.left,
        top: printArea.style.top, visibility: printArea.style.visibility,
      };
      printArea.style.position = "fixed";
      printArea.style.left = "0"; printArea.style.top = "0";
      printArea.style.visibility = "visible";
      printArea.style.zIndex = "-1";

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const sheets = printArea.querySelectorAll(".vip-a4");

      for (let i = 0; i < sheets.length; i++) {
        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(sheets[i], {
          scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false,
        });
        const img = canvas.toDataURL("image/jpeg", 0.95);
        pdf.addImage(img, "JPEG", 0, 0, 210, 297, undefined, "FAST");
      }

      printArea.style.position   = orig2.position;
      printArea.style.left       = orig2.left;
      printArea.style.top        = orig2.top;
      printArea.style.visibility = orig2.visibility;
      printArea.style.zIndex     = "";

      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`vip-cards-${stamp}.pdf`);
      showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${vipQty} ใบ)`);
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  // ════════════════════════════════════════════════════════════
  // CERTIFICATE TAB
  // ════════════════════════════════════════════════════════════
  // ── (legacy generic readers — kept for future reuse) ──────
  function parseSheetGeneric(raw) {
    if (!raw || !raw.length) return null;
    const headerHints = ["ชื่อ", "name", "fullname", "full name", "full_name"];
    let start = 0;
    const r0 = (raw[0]?.[0] || "").toString().trim().toLowerCase();
    if (headerHints.some(h => r0 === h.toLowerCase())) start = 1;
    const out = [];
    for (let i = start; i < raw.length; i++) {
      const r = raw[i] || [];
      const name = (r[0] != null ? String(r[0]) : "").trim();
      const position = (r[1] != null ? String(r[1]) : "").trim();
      if (!name && !position) continue;
      out.push({ name, position });
    }
    return out;
  }
  function readExcelFile(file, onParsed) {
    const name = file.name.toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(name)) {
      showToast("รองรับเฉพาะไฟล์ .xlsx / .xls / .csv", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const parsed = parseSheetGeneric(raw);
        onParsed(parsed);
      } catch (err) {
        console.error(err);
        showToast("อ่านไฟล์ไม่สำเร็จ — " + err.message, "error");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Position → template key matching (case + space tolerant) ─
  function matchPositionKey(pos) {
    const p = (pos || "").toUpperCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!p) return null;
    if (/^SVP$|SENIOR\s*VICE\s*PRES/.test(p)) return "svp";
    if (/^SD$|SR\s*DIR|SENIOR\s*DIR/.test(p)) return "senior-director";
    if (/^AVP$|ASS(IS|T)\w*\s*VICE\s*PRES|ASSISTANT\s*V\.?P/.test(p)) return "avp";
    if (/^VP$|VICE\s*PRES/.test(p)) return "vp";
    if (/^DIR$|DIRECTOR/.test(p)) return "director";
    return null;
  }

  // ── Template storage (localStorage, with image compression) ─
  function loadCertTemplates() {
    try {
      const raw = localStorage.getItem(CERT_TPL_LS_KEY);
      certTemplates = raw ? JSON.parse(raw) : {};
    } catch (e) { certTemplates = {}; }
  }
  function saveCertTemplates() {
    try {
      localStorage.setItem(CERT_TPL_LS_KEY, JSON.stringify(certTemplates));
    } catch (e) {
      showToast("บันทึก template ไม่สำเร็จ (storage เต็ม)", "error");
    }
  }
  // Resize+compress to keep localStorage usage manageable (~500KB/file)
  function compressImageToDataUrl(file, maxWidth = 1500, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const ratio = Math.min(maxWidth / img.width, 1);
          const w = Math.round(img.width * ratio);
          const h = Math.round(img.height * ratio);
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateCertTplCount() {
    const n = Object.keys(certTemplates).length;
    $("certTplCount") && ($("certTplCount").textContent = n);
  }

  // ── Template management modal ────────────────────────────
  function openCertTplModal() {
    renderCertTplGrid();
    $("certTplOverlay")?.classList.add("open");
  }
  function closeCertTplModal() {
    $("certTplOverlay")?.classList.remove("open");
    // Re-render preview in case templates changed
    if (activeTab === "cert") renderCertSheets();
  }
  function renderCertTplGrid() {
    const grid = $("certTplGrid");
    if (!grid) return;
    grid.innerHTML = CERT_POSITIONS.map(p => {
      const has = !!certTemplates[p.key];
      const previewStyle = has
        ? `background-image:url('${certTemplates[p.key]}')`
        : "";
      return `
        <div class="cert-tpl-slot ${has ? 'has-img' : ''}" data-key="${p.key}">
          <div class="cert-tpl-label">
            ${esc(p.label)}
            <span class="cert-tpl-key">key: ${p.key} · short: ${p.short}</span>
          </div>
          <div class="cert-tpl-preview" style="${previewStyle}">
            ${has ? "" : "ยังไม่ได้อัปโหลด"}
          </div>
          <div class="cert-tpl-actions">
            <label class="btn btn-outline btn-sm" style="cursor:pointer">
              ${has ? "🔄 เปลี่ยน" : "⬆ อัปโหลด"}
              <input type="file" accept="image/*" style="display:none" data-key="${p.key}" class="cert-tpl-file">
            </label>
            ${has ? `<button class="btn btn-outline btn-sm cert-tpl-del" data-key="${p.key}" style="color:#dc2626">🗑 ลบ</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    grid.querySelectorAll(".cert-tpl-file").forEach(inp => {
      inp.addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const key = inp.dataset.key;
        try {
          const dataUrl = await compressImageToDataUrl(f);
          certTemplates[key] = dataUrl;
          saveCertTemplates();
          updateCertTplCount();
          renderCertTplGrid();
          showToast(`อัปโหลด ${key} สำเร็จ`);
        } catch (err) {
          showToast("อัปโหลดล้มเหลว — " + err.message, "error");
        }
      });
    });
    grid.querySelectorAll(".cert-tpl-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        if (!confirm(`ลบ template สำหรับ ${key}?`)) return;
        delete certTemplates[key];
        saveCertTemplates();
        updateCertTplCount();
        renderCertTplGrid();
      });
    });
  }
  function resetAllCertTpl() {
    if (!Object.keys(certTemplates).length) return;
    if (!confirm("ลบ template ทั้ง 5 ตำแหน่ง?")) return;
    certTemplates = {};
    saveCertTemplates();
    updateCertTplCount();
    renderCertTplGrid();
    if (activeTab === "cert") renderCertSheets();
  }

  // ── Cert file handlers ───────────────────────────────────
  function onCertDrag(e, over) {
    e.preventDefault();
    $("certDropZone")?.classList.toggle("dragover", !!over);
  }
  function onCertDrop(e) {
    e.preventDefault();
    $("certDropZone")?.classList.remove("dragover");
    const f = e.dataTransfer?.files?.[0];
    if (f) handleCertFile(f);
  }
  function onCertFilePick(e) {
    const f = e.target.files?.[0];
    if (f) handleCertFile(f);
  }
  function handleCertFile(file) {
    const name = file.name.toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(name)) {
      showToast("รองรับเฉพาะไฟล์ .xlsx / .xls / .csv", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const parsed = parseCertSheet(raw);
        if (!parsed || !parsed.length) {
          showToast("ไม่พบรายชื่อในไฟล์", "error"); return;
        }
        certRows = parsed;
        showToast(`โหลดสำเร็จ · ${parsed.length} ใบ`);
        certRefreshAll();
      } catch (err) {
        showToast("อ่านไฟล์ไม่สำเร็จ — " + err.message, "error");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Cert sheet format: A=ชื่อ1, B=ชื่อ2 (optional), C=ตำแหน่ง
  function parseCertSheet(raw) {
    if (!raw || !raw.length) return null;
    const headerHints = ["ชื่อ", "ชื่อ 1", "name", "name 1", "fullname"];
    let start = 0;
    const r0 = (raw[0]?.[0] || "").toString().trim().toLowerCase();
    if (headerHints.some(h => r0 === h.toLowerCase())) start = 1;
    const out = [];
    for (let i = start; i < raw.length; i++) {
      const r = raw[i] || [];
      const name1    = (r[0] != null ? String(r[0]) : "").trim();
      const name2    = (r[1] != null ? String(r[1]) : "").trim();
      const position = (r[2] != null ? String(r[2]) : "").trim();
      if (!name1 && !name2 && !position) continue;
      out.push({ name1, name2, position });
    }
    return out;
  }

  // ── Cert edit table (3 columns) ──────────────────────────
  function renderCertEditTable() {
    const body = $("certPreviewBody");
    if (!body) return;
    if (!certRows.length) {
      body.innerHTML = `<tr><td colspan="5" style="padding:24px;text-align:center;color:#94a3b8">ยังไม่มีข้อมูล — กรุณาอัปโหลดไฟล์</td></tr>`;
      return;
    }
    body.innerHTML = certRows.map((r, i) => {
      const matched = matchPositionKey(r.position);
      const tplOK   = matched && certTemplates[matched];
      const badge   = !r.position
        ? `<span style="color:#94a3b8;font-size:11px">—</span>`
        : tplOK
          ? `<span style="color:#16a34a;font-size:11px;font-weight:600">✓ ${matched}</span>`
          : matched
            ? `<span style="color:#d97706;font-size:11px;font-weight:600">⚠ ไม่มี template ${matched}</span>`
            : `<span style="color:#dc2626;font-size:11px;font-weight:600">✗ ไม่ match ตำแหน่ง</span>`;
      return `
      <tr data-idx="${i}">
        <td class="col-idx">${i + 1}</td>
        <td><input class="nmc-cell-input cert-cell" data-field="name1" data-idx="${i}" value="${esc(r.name1)}" placeholder="ชื่อ"></td>
        <td><input class="nmc-cell-input cert-cell" data-field="name2" data-idx="${i}" value="${esc(r.name2)}" placeholder="(เว้นว่างถ้าไม่มี)"></td>
        <td>
          <input class="nmc-cell-input cert-cell" data-field="position" data-idx="${i}" value="${esc(r.position)}" placeholder="AVP / VP / SVP / Director / Senior Director" list="certPositions">
          <div style="margin-top:2px">${badge}</div>
        </td>
        <td class="col-act"><button class="nmc-row-del cert-row-del" data-idx="${i}" title="ลบแถวนี้">🗑</button></td>
      </tr>
    `;}).join("");

    // Position autocomplete datalist (once per render)
    if (!$("certPositions")) {
      const dl = document.createElement("datalist");
      dl.id = "certPositions";
      dl.innerHTML = CERT_POSITIONS.map(p => `<option value="${p.label}">`).join("");
      document.body.appendChild(dl);
    }

    body.querySelectorAll(".cert-cell").forEach(inp => {
      inp.addEventListener("input", () => {
        const idx = +inp.dataset.idx;
        const field = inp.dataset.field;
        if (certRows[idx]) {
          certRows[idx][field] = inp.value;
          renderCertSheets();
          // Refresh just this row's badge
          if (field === "position") renderCertEditTable();
        }
      });
    });
    body.querySelectorAll(".cert-row-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = +btn.dataset.idx;
        certRows.splice(idx, 1);
        certRefreshAll();
      });
    });
  }

  function certRefreshAll() {
    const has = certRows.length > 0;
    $("certDataBlock").style.display    = has ? "" : "none";
    $("certActionsBlock").style.display = has ? "" : "none";
    $("certLayoutBlock").style.display  = has ? "" : "none";
    $("certCount") && ($("certCount").textContent = certRows.length);
    renderCertEditTable();
    renderCertSheets();
  }

  function certAddRow() {
    certRows.push({ name1: "", name2: "", position: "" });
    certRefreshAll();
    setTimeout(() => {
      const inputs = $("certPreviewBody").querySelectorAll('.cert-cell[data-field="name1"]');
      inputs[inputs.length - 1]?.focus();
    }, 30);
  }
  function certClearAll() {
    if (!certRows.length) return;
    if (!confirm("ล้างรายชื่อทั้งหมด?")) return;
    certRows = [];
    certRefreshAll();
  }
  function certResetAll() {
    certRows = [];
    const f = $("certFileInput"); if (f) f.value = "";
    certRefreshAll();
  }

  // ── Cert card HTML — uses uploaded template + 2-line names ─
  function certHtml(r) {
    const key = matchPositionKey(r.position);
    const tpl = key ? certTemplates[key] : null;
    if (!tpl) {
      const msg = !r.position
        ? "⚠ ไม่ได้ระบุตำแหน่ง"
        : key
          ? `⚠ ยังไม่ได้อัปโหลด template สำหรับ "${esc(r.position)}" (${key})`
          : `⚠ ตำแหน่ง "${esc(r.position)}" ไม่ match กับ template ใดเลย`;
      return `<div class="cert-a4 cert-missing"><div class="cert-missing-msg">${msg}</div></div>`;
    }
    const n1 = esc(formatName(r.name1));
    const n2 = esc(formatName(r.name2 || ""));
    return `
      <div class="cert-a4" style="background-image:url('${tpl}')">
        <div class="cert-names">
          <div class="cert-name-line">${n1}</div>
          ${n2 ? `<div class="cert-name-line">${n2}</div>` : ""}
        </div>
      </div>
    `;
  }

  function renderCertSheets() {
    const scroller  = $("certSheetScroller");
    const printArea = $("certPrintArea");
    if (!scroller || !printArea) return;

    if (!certRows.length) {
      scroller.innerHTML  = "";
      printArea.innerHTML = "";
      return;
    }

    const html = certRows.map(certHtml).join("");
    scroller.innerHTML  = html;
    printArea.innerHTML = html;

    scroller.querySelectorAll(".cert-a4").forEach(el => {
      el.style.setProperty("--nmc-zoom", certZoom);
      el.style.setProperty("--cert-name-y",    CERT_NAME_Y_MM + "mm");
      el.style.setProperty("--cert-name-lh",   CERT_NAME_LH);
      el.style.setProperty("--cert-name-size", CERT_NAME_SIZE);
    });
    printArea.querySelectorAll(".cert-a4").forEach(el => {
      el.style.setProperty("--cert-name-y",    CERT_NAME_Y_MM + "mm");
      el.style.setProperty("--cert-name-lh",   CERT_NAME_LH);
      el.style.setProperty("--cert-name-size", CERT_NAME_SIZE);
    });
  }

  function setCertZoom(dir) {
    const steps = [0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1.0];
    let i = steps.indexOf(certZoom);
    if (i < 0) i = 2;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    certZoom = steps[i];
    $("certZoomLabel") && ($("certZoomLabel").textContent = Math.round(certZoom * 100) + "%");
    document.querySelectorAll("#certSheetScroller .cert-a4").forEach(el => {
      el.style.setProperty("--nmc-zoom", certZoom);
    });
  }

  function downloadCertTemplate() {
    const data = [
      ["ชื่อ 1", "ชื่อ 2 (รหัสคู่)", "ตำแหน่ง"],
      ["MR. JOHN DOE", "", "Assistant Vice President"],
      ["MR. JOHN DOE", "MRS. JANE DOE", "Vice President"],
      ["MR. SAMPLE", "", "Director"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Certificates");
    XLSX.writeFile(wb, "certificate-template.xlsx");
  }

  async function exportCertPDF() {
    if (!certRows.length) {
      showToast("ยังไม่มีรายชื่อ — อัปโหลด Excel ก่อน", "error");
      return;
    }
    if (!window.html2canvas || !window.jspdf) {
      showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ", "error"); return;
    }
    // Validate: every row must have a matching template
    const missing = [];
    for (const r of certRows) {
      const key = matchPositionKey(r.position);
      if (!key || !certTemplates[key]) missing.push(r.position || "(ว่าง)");
    }
    if (missing.length) {
      const uniq = [...new Set(missing)].slice(0, 3).join(", ");
      showToast(`มี ${missing.length} ใบที่ขาด template — ${uniq}${missing.length>3?" …":""}`, "error");
      return;
    }
    const btn = $("btnExportCertPDF");
    const orig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังสร้าง PDF..."; }

    try {
      renderCertSheets();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 120));

      const printArea = $("certPrintArea");
      const orig2 = {
        position: printArea.style.position, left: printArea.style.left,
        top: printArea.style.top, visibility: printArea.style.visibility,
      };
      printArea.style.position = "fixed";
      printArea.style.left = "0"; printArea.style.top = "0";
      printArea.style.visibility = "visible";
      printArea.style.zIndex = "-1";

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const sheets = printArea.querySelectorAll(".cert-a4");

      for (let i = 0; i < sheets.length; i++) {
        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(sheets[i], {
          scale: 2.5, useCORS: true, backgroundColor: "#ffffff", logging: false,
        });
        const img = canvas.toDataURL("image/jpeg", 0.92);
        pdf.addImage(img, "JPEG", 0, 0, 297, 210, undefined, "FAST");
      }

      printArea.style.position   = orig2.position;
      printArea.style.left       = orig2.left;
      printArea.style.top        = orig2.top;
      printArea.style.visibility = orig2.visibility;
      printArea.style.zIndex     = "";

      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`certificates-${stamp}.pdf`);
      showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} ใบ)`);
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  function downloadTemplate() {
    const data = [
      ["ชื่อ", "ตำแหน่ง"],
      ["คุณสิงหราช กัลยาณมิตร", "ที่ปรึกษา"],
      ["คุณสมชาย ใจดี", "ผู้จัดการ"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, "namecard-template.xlsx");
  }

  // ── Init ───────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    setStep(1);
    $("zoomLabel") && ($("zoomLabel").textContent = Math.round(zoom * 100) + "%");
    $("vipZoomLabel") && ($("vipZoomLabel").textContent = Math.round(vipZoom * 100) + "%");
    $("certZoomLabel") && ($("certZoomLabel").textContent = Math.round(certZoom * 100) + "%");
    loadCertTemplates();
    updateCertTplCount();
    renderVipSheets();
  });

  window.nmc = {
    // Namecard tab
    onDrag, onDrop, onFilePick,
    addRow, clearAll, resetAll,
    setZoom, printNow, exportPDF, downloadTemplate,
    // VIP tab
    setVipQty, bumpVipQty, setVipZoom, exportVipPDF,
    // Certificate tab
    onCertDrag, onCertDrop, onCertFilePick,
    certAddRow, certClearAll, certResetAll,
    setCertZoom, exportCertPDF,
    openCertTplModal, closeCertTplModal, resetAllCertTpl,
    downloadCertTemplate,
    // Common
    switchTab,
  };
})();
