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
  let certZoom = 0.5;

  // 5 position keys ordered by corporate ladder (top → bottom)
  const CERT_POSITIONS = [
    { key: "svp",             label: "Senior Vice President",    short: "SVP" },
    { key: "vp",              label: "Vice President",           short: "VP"  },
    { key: "avp",             label: "Assistant Vice President", short: "AVP" },
    { key: "senior-director", label: "Senior Director",          short: "SD"  },
    { key: "director",        label: "Director",                 short: "DR"  },
  ];
  // Templates uploaded to Supabase Storage (bucket: cert-templates, public).
  // Files stored as {key}.jpg — accessible by anyone with the URL.
  // Position config (nameY, nameLh) stays in localStorage per user.
  const CERT_TPL_BUCKET = "cert-templates";
  const SB_URL = window.supabaseConfig?.url || "";
  const SB_KEY = window.supabaseConfig?.anon || "";

  function getTplSrc(key) {
    if (!key || !SB_URL) return null;
    // Cache-bust on each render so re-uploads show up immediately
    const v = certTplVersion[key] || "";
    return `${SB_URL}/storage/v1/object/public/${CERT_TPL_BUCKET}/${key}.jpg${v ? "?v=" + v : ""}`;
  }

  const CERT_TPL_LS_KEY = "a4s_cert_config_v2";
  let certConfig = {};              // { key: { nameY, nameLh } }
  const certTplExists = {};         // { key: true|false }
  const certTplVersion = {};        // { key: timestamp } cache-buster
  function getTplNameY(key) {
    const c = certConfig[key];
    return (c && typeof c.nameY === "number") ? c.nameY : CERT_NAME_Y_MM;
  }
  function getTplNameLh(key) {
    const c = certConfig[key];
    return (c && typeof c.nameLh === "number") ? c.nameLh : CERT_NAME_LH_MM;
  }
  function setTplConfig(key, nameY, nameLh) {
    certConfig[key] = {
      nameY:  nameY  ?? getTplNameY(key),
      nameLh: nameLh ?? getTplNameLh(key),
    };
  }

  // Probe whether a template file exists in Supabase Storage.
  function probeCertTpl(key) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { certTplExists[key] = true;  resolve(true); };
      img.onerror = () => { certTplExists[key] = false; resolve(false); };
      img.src = `${SB_URL}/storage/v1/object/public/${CERT_TPL_BUCKET}/${key}.jpg?_=${Date.now()}`;
    });
  }
  function probeAllCertTpls() {
    return Promise.all(CERT_POSITIONS.map(p => probeCertTpl(p.key)));
  }

  // Upload to Supabase Storage. No compression — full quality.
  async function uploadCertTpl(key, file) {
    if (!file) throw new Error("ไม่มีไฟล์");
    if (!/^image\//.test(file.type)) throw new Error("รับเฉพาะไฟล์ภาพ");
    const path = `${key}.jpg`;
    const url = `${SB_URL}/storage/v1/object/${CERT_TPL_BUCKET}/${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": file.type || "image/jpeg",
        "x-upsert": "true",         // overwrite if exists
        "cache-control": "max-age=0",
      },
      body: file,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[cert-tpl upload]", res.status, txt);   // full body in console
      if (res.status === 404 || res.status === 405) {
        throw new Error(`ยังไม่ได้สร้าง bucket "cert-templates" — รัน sql/111_cert_templates_bucket.sql ใน Supabase SQL Editor`);
      }
      if (res.status === 400 && /mime/i.test(txt)) {
        throw new Error(`ไฟล์เป็น ${file.type} — bucket ตั้งให้รับเฉพาะ image/jpeg + image/png`);
      }
      if (res.status === 403) {
        throw new Error(`Permission denied — RLS policy ไม่อนุญาต anon write\nรัน sql/111 ใหม่อีกครั้ง หรือเช็ค Storage > Policies`);
      }
      if (res.status === 413) {
        throw new Error(`ไฟล์ใหญ่เกิน 50 MB`);
      }
      throw new Error(`HTTP ${res.status} · ${txt.slice(0, 150)}`);
    }
    certTplExists[key] = true;
    certTplVersion[key] = Date.now();    // bust cached <img>
  }

  async function deleteCertTpl(key) {
    const url = `${SB_URL}/storage/v1/object/${CERT_TPL_BUCKET}/${key}.jpg`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => "");
      throw new Error(`${res.status} ${txt.slice(0, 100)}`);
    }
    certTplExists[key] = false;
    delete certTplVersion[key];
  }

  // Cert layout config (mm) — averaged from 5 measured templates
  const CERT_NAME_Y_MM     = 133;   // top of first line
  const CERT_NAME_SIZE     = "30pt";
  const CERT_NAME_LH_MM    = 16;    // each line takes 16mm (was 13.5 — too tight for Thai tone marks)
  const CERT_NAME_BLOCK_MM = 32;    // 2 × line-height

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
  async function clearAll() {
    if (!rows.length) return;
    const ok = await ConfirmModal.open({
      title: "ล้างรายชื่อทั้งหมด?",
      message: `จะลบรายชื่อ ${rows.length} รายการออกจากตาราง`,
      icon: "🗑",
      tone: "danger",
      okText: "ล้างทั้งหมด",
    });
    if (!ok) return;
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
  // Order matters: check more specific patterns first (SVP/SD before VP/DIR)
  function matchPositionKey(pos) {
    const p = (pos || "").toUpperCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!p) return null;
    if (/^SVP$|SENIOR\s*VICE\s*PRES/.test(p)) return "svp";
    if (/^SD$|SR\s*DIR|SENIOR\s*DIR/.test(p)) return "senior-director";
    if (/^AVP$|ASS(IS|T)\w*\s*VICE\s*PRES|ASSISTANT\s*V\.?P/.test(p)) return "avp";
    if (/^VP$|VICE\s*PRES/.test(p)) return "vp";
    if (/^DR$|^DIR$|DIRECTOR/.test(p)) return "director";
    return null;
  }

  // ── Template config storage (localStorage — config only, NOT images) ─
  function loadCertTemplates() {
    try {
      const raw = localStorage.getItem(CERT_TPL_LS_KEY);
      certConfig = raw ? JSON.parse(raw) : {};
    } catch (e) { certConfig = {}; }
    // Migrate from old v1 format if exists
    try {
      const oldRaw = localStorage.getItem("a4s_cert_templates_v1");
      if (oldRaw && !Object.keys(certConfig).length) {
        const old = JSON.parse(oldRaw);
        for (const [k, v] of Object.entries(old)) {
          if (v && typeof v === "object" && (v.nameY != null || v.nameLh != null)) {
            certConfig[k] = { nameY: v.nameY, nameLh: v.nameLh };
          }
        }
        saveCertTemplates();
        localStorage.removeItem("a4s_cert_templates_v1");  // drop bulky images
      }
    } catch (e) {}
  }
  function saveCertTemplates() {
    try {
      localStorage.setItem(CERT_TPL_LS_KEY, JSON.stringify(certConfig));
    } catch (e) {
      showToast("บันทึก config ไม่สำเร็จ", "error");
    }
  }

  function updateCertTplCount() {
    const n = Object.values(certTplExists).filter(Boolean).length;
    $("certTplCount") && ($("certTplCount").textContent = n);
  }

  // ── Template management modal ────────────────────────────
  async function openCertTplModal() {
    renderCertTplGrid();          // initial render (with "⏳ กำลังตรวจ" placeholder)
    $("certTplOverlay")?.classList.add("open");
    await probeAllCertTpls();     // check file presence
    updateCertTplCount();
    renderCertTplGrid();          // re-render with real status
  }
  function closeCertTplModal() {
    $("certTplOverlay")?.classList.remove("open");
    // Re-render preview in case templates changed
    if (activeTab === "cert") renderCertSheets();
  }
  async function _setCertTplFromFile(key, file) {
    if (!file || !/^image\//.test(file.type)) {
      showToast("รับเฉพาะไฟล์ภาพ", "error");
      return;
    }
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    try {
      showToast(`⏳ กำลังอัปโหลด ${key}.jpg (${sizeMB} MB)...`);
      await uploadCertTpl(key, file);
      renderCertTplGrid();
      updateCertTplCount();
      if (activeTab === "cert") renderCertSheets();
      showToast(`✓ อัปโหลด ${key} สำเร็จ (${sizeMB} MB)`);
    } catch (err) {
      showToast("อัปโหลดล้มเหลว — " + err.message, "error");
    }
  }

  function renderCertTplGrid() {
    const grid = $("certTplGrid");
    if (!grid) return;
    grid.innerHTML = CERT_POSITIONS.map(p => {
      const src = getTplSrc(p.key);
      const nameY  = getTplNameY(p.key);
      const nameLh = getTplNameLh(p.key);
      const exists = certTplExists[p.key];
      const previewStyle = exists ? `background-image:url('${src}')` : "";
      return `
        <div class="cert-tpl-slot ${exists ? 'has-img' : (exists === false ? 'is-missing' : '')}" data-key="${p.key}">
          <div class="cert-tpl-label">
            ${esc(p.label)}
            <span class="cert-tpl-key">${p.key}.jpg</span>
            <span class="cert-tpl-key">📍 Y: ${nameY.toFixed(1)} mm · 📏 LH: ${nameLh.toFixed(1)} mm</span>
          </div>
          <div class="cert-tpl-preview cert-tpl-drop" data-key="${p.key}" style="${previewStyle}" title="ลากไฟล์มาวาง หรือคลิกเพื่อเลือก">
            ${exists ? "" : exists === false ? `<div class="cert-tpl-drop-hint">📥 ลากไฟล์มาวาง<br><span style="font-size:10px">หรือคลิก</span></div>` : `<div class="cert-tpl-drop-hint">⏳ กำลังตรวจ...</div>`}
            <input type="file" accept="image/*" style="display:none" data-key="${p.key}" class="cert-tpl-file">
          </div>
          <div class="cert-tpl-actions">
            <label class="btn btn-outline btn-sm cert-tpl-pick" data-key="${p.key}" style="cursor:pointer">
              ${exists ? "🔄 เปลี่ยน" : "⬆ อัปโหลด"}
            </label>
            ${exists ? `<button class="btn btn-primary btn-sm cert-tpl-pos" data-key="${p.key}">📍 ตำแหน่งชื่อ</button>` : ""}
            ${exists ? `<button class="btn btn-outline btn-sm cert-tpl-del" data-key="${p.key}" style="color:#dc2626">🗑 ลบ</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    // File input
    grid.querySelectorAll(".cert-tpl-file").forEach(inp => {
      inp.addEventListener("change", (e) => {
        const f = e.target.files?.[0];
        if (f) _setCertTplFromFile(inp.dataset.key, f);
        inp.value = "";    // allow re-pick same file
      });
    });
    // Button → trigger file input
    grid.querySelectorAll(".cert-tpl-pick").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        grid.querySelector(`.cert-tpl-file[data-key="${key}"]`)?.click();
      });
    });
    // Drop zone (preview area)
    grid.querySelectorAll(".cert-tpl-drop").forEach(zone => {
      zone.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;
        zone.querySelector("input.cert-tpl-file")?.click();
      });
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("dragover");
        const f = e.dataTransfer?.files?.[0];
        if (f) _setCertTplFromFile(zone.dataset.key, f);
      });
    });
    // Position picker
    grid.querySelectorAll(".cert-tpl-pos").forEach(btn => {
      btn.addEventListener("click", () => openCertPosModal(btn.dataset.key));
    });
    // Delete
    grid.querySelectorAll(".cert-tpl-del").forEach(btn => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.key;
        const label = CERT_POSITIONS.find(p => p.key === key)?.label || key;
        const ok = await ConfirmModal.open({
          title: "ลบ Template?",
          message: `จะลบ ${label} ออกจาก Supabase Storage`,
          details: { "File": `${key}.jpg` },
          icon: "🗑",
          tone: "danger",
          okText: "ลบ",
        });
        if (!ok) return;
        try {
          await deleteCertTpl(key);
          renderCertTplGrid();
          updateCertTplCount();
          if (activeTab === "cert") renderCertSheets();
          showToast(`✓ ลบ ${key} สำเร็จ`);
        } catch (err) {
          showToast("ลบไม่สำเร็จ — " + err.message, "error");
        }
      });
    });
  }
  // ── Position picker modal ─────────────────────────────────
  let _certPosState = {
    key: null,
    y:  CERT_NAME_Y_MM,
    lh: CERT_NAME_LH_MM,
    dragging: false,
  };

  function openCertPosModal(key) {
    const src = getTplSrc(key);
    if (!src) { showToast("ยังไม่ได้อัปโหลด template", "error"); return; }
    const label = CERT_POSITIONS.find(p => p.key === key)?.label || key;
    _certPosState.key = key;
    _certPosState.y   = getTplNameY(key);
    _certPosState.lh  = getTplNameLh(key);
    $("certPosLabel").textContent = label;
    $("certPosCanvas").style.backgroundImage = `url('${src}')`;
    $("certPosShow2").checked = true;
    $("certPosName2").style.display = "";
    updateCertPosUI();
    $("certPosOverlay")?.classList.add("open");
    _bindCertPosDragOnce();
  }
  function closeCertPosModal() {
    $("certPosOverlay")?.classList.remove("open");
  }
  function updateCertPosUI() {
    const yMm  = _certPosState.y;
    const lhMm = _certPosState.lh;
    const canvas = $("certPosCanvas");
    const names  = $("certPosNames");
    const guide  = $("certPosGuide");
    const guide2 = $("certPosGuide2");
    if (!canvas || !names) return;
    const ratio = canvas.clientHeight / 210; // mm → px

    // Apply line-height to preview names (2 × lhMm = block height)
    const blockMm = 2 * lhMm;
    // 27mm out of 297mm canvas width = 9.09cqw, etc. Set explicit px instead
    names.style.height = (blockMm * ratio) + "px";
    names.style.top    = (yMm * ratio) + "px";
    names.querySelectorAll(".cert-pos-name").forEach(el => {
      el.style.lineHeight = (lhMm * ratio) + "px";
    });

    if (guide)  guide.style.top  = (yMm * ratio) + "px";
    const show2 = $("certPosShow2")?.checked;
    if (guide2) {
      guide2.style.display = show2 ? "" : "none";
      guide2.style.top = ((yMm + blockMm) * ratio) + "px";
    }
    const yInp = $("certPosYInput");
    if (yInp && document.activeElement !== yInp) yInp.value = yMm.toFixed(1);
    const lhInp = $("certPosLhInput");
    if (lhInp && document.activeElement !== lhInp) lhInp.value = lhMm.toFixed(1);
  }
  function setCertPosY(v) {
    let n = parseFloat(v);
    if (!isFinite(n)) return;
    n = Math.max(0, Math.min(200, n));
    _certPosState.y = n;
    updateCertPosUI();
  }
  function bumpCertPosY(d) { setCertPosY(_certPosState.y + d); }
  function resetCertPosY() { setCertPosY(CERT_NAME_Y_MM); }

  function setCertPosLh(v) {
    let n = parseFloat(v);
    if (!isFinite(n)) return;
    n = Math.max(8, Math.min(40, n));
    _certPosState.lh = n;
    updateCertPosUI();
  }
  function bumpCertPosLh(d) { setCertPosLh(_certPosState.lh + d); }
  function resetCertPosLh() { setCertPosLh(CERT_NAME_LH_MM); }

  function toggleCertPos2(show) {
    const el = $("certPosName2");
    if (el) el.style.display = show ? "" : "none";
    updateCertPosUI();      // re-sync second guide visibility
  }
  function saveCertPos() {
    const key = _certPosState.key;
    if (!key) return;
    const src = getTplSrc(key);
    setTplConfig(key, _certPosState.y, _certPosState.lh);
    saveCertTemplates();
    renderCertTplGrid();
    if (activeTab === "cert") renderCertSheets();
    closeCertPosModal();
    showToast(`บันทึก ${key}: Y=${_certPosState.y.toFixed(1)}mm · LH=${_certPosState.lh.toFixed(1)}mm`);
  }

  let _certPosDragBound = false;
  function _bindCertPosDragOnce() {
    if (_certPosDragBound) return;
    _certPosDragBound = true;
    const names = $("certPosNames");
    const canvas = $("certPosCanvas");
    if (!names || !canvas) return;
    let startClientY = 0, startMmY = 0, dragging = false;

    const begin = (clientY) => {
      dragging = true;
      _certPosState.dragging = true;
      names.classList.add("dragging");
      startClientY = clientY;
      startMmY = _certPosState.y;
    };
    const move = (clientY) => {
      if (!dragging) return;
      const dy = clientY - startClientY;
      const dyMm = (dy / canvas.clientHeight) * 210;
      setCertPosY(startMmY + dyMm);
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      _certPosState.dragging = false;
      names.classList.remove("dragging");
    };

    names.addEventListener("mousedown", e => { e.preventDefault(); begin(e.clientY); });
    document.addEventListener("mousemove", e => move(e.clientY));
    document.addEventListener("mouseup", end);
    names.addEventListener("touchstart", e => { begin(e.touches[0].clientY); }, { passive: true });
    document.addEventListener("touchmove", e => move(e.touches[0].clientY), { passive: true });
    document.addEventListener("touchend", end);

    // Re-sync UI on window resize (canvas height changes)
    window.addEventListener("resize", () => {
      if ($("certPosOverlay")?.classList.contains("open")) updateCertPosUI();
    });
  }

  async function resetAllCertTpl() {
    const n = Object.keys(certConfig).length;
    if (!n) return;
    const ok = await ConfirmModal.open({
      title: "รีเซ็ตค่าตำแหน่งทั้งหมด?",
      message: `จะรีเซ็ตค่า Y/Line-height ของทุก template กลับเป็นค่า default`,
      icon: "↺",
      tone: "warning",
      okText: "รีเซ็ตทั้งหมด",
    });
    if (!ok) return;
    certConfig = {};
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
      const tplOK   = matched && certTplExists[matched];
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
  async function certClearAll() {
    if (!certRows.length) return;
    const ok = await ConfirmModal.open({
      title: "ล้างรายชื่อทั้งหมด?",
      message: `จะลบรายชื่อ ${certRows.length} ใบออกจากตาราง`,
      icon: "🗑",
      tone: "danger",
      okText: "ล้างทั้งหมด",
    });
    if (!ok) return;
    certRows = [];
    certRefreshAll();
  }
  function certResetAll() {
    certRows = [];
    const f = $("certFileInput"); if (f) f.value = "";
    certRefreshAll();
  }

  // ── Cert card HTML — uses hard-coded template file + 2-line names ─
  // Wrapped in .cert-a4-wrap so flex layout sees the SCALED (visual) size,
  // not the 297×210mm raw size. Otherwise certs overlap each other.
  function certHtml(r) {
    const key = matchPositionKey(r.position);
    const src = key ? getTplSrc(key) : null;
    const fileOK = key && certTplExists[key];
    if (!src || !fileOK) {
      const msg = !r.position
        ? "⚠ ไม่ได้ระบุตำแหน่ง"
        : !key
          ? `⚠ ตำแหน่ง "${esc(r.position)}" ไม่ match กับ template ใดเลย`
          : `⚠ ไม่พบ template สำหรับ ${key} — กรุณาอัปโหลด`;
      return `<div class="cert-a4-wrap"><div class="cert-a4 cert-missing"><div class="cert-missing-msg">${msg}</div></div></div>`;
    }
    const nameY  = getTplNameY(key);
    const nameLh = getTplNameLh(key);
    const blockH = 2 * nameLh;
    const n1 = esc(formatName(r.name1));
    const n2 = esc(formatName(r.name2 || ""));
    return `
      <div class="cert-a4-wrap">
        <div class="cert-a4" style="background-image:url('${src}');--cert-name-y:${nameY}mm;--cert-name-lh:${nameLh}mm;--cert-name-block-h:${blockH}mm">
          <div class="cert-names">
            <div class="cert-name-line">${n1}</div>
            ${n2 ? `<div class="cert-name-line">${n2}</div>` : ""}
          </div>
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

    // Preview: --nmc-zoom set on the wrapper (drives both wrapper size + inner scale)
    scroller.querySelectorAll(".cert-a4-wrap").forEach(el => {
      el.style.setProperty("--nmc-zoom", certZoom);
    });
    scroller.querySelectorAll(".cert-a4").forEach(el => {
      el.style.setProperty("--nmc-zoom", certZoom);
      el.style.setProperty("--cert-name-lh",   CERT_NAME_LH_MM + "mm");
      el.style.setProperty("--cert-name-size", CERT_NAME_SIZE);
    });
    // PrintArea: no scaling (CSS override handles full size)
    printArea.querySelectorAll(".cert-a4").forEach(el => {
      el.style.setProperty("--cert-name-lh",   CERT_NAME_LH_MM + "mm");
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
    document.querySelectorAll("#certSheetScroller .cert-a4-wrap, #certSheetScroller .cert-a4").forEach(el => {
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

  // ── Export each cert as a PNG · single = direct download · multiple = ZIP
  // Format: cert-{POSITION}-{NAME}.png  (e.g. cert-SVP-คุณสมชาย.png)
  function makeCertFilename(r, idx) {
    const key = matchPositionKey(r.position);
    const short = CERT_POSITIONS.find(p => p.key === key)?.short
                 || (r.position || "").trim();
    const n1 = (r.name1 || "").trim();
    const n2 = (r.name2 || "").trim();
    let name = n2 ? `${n1}+${n2}` : n1;
    // Strip filename-unsafe chars · keep Thai/English/digits/space
    const clean = s => s.replace(/[<>:"\/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
    name = clean(name);
    const pos = clean(short);
    if (!name) name = `row-${idx + 1}`;
    return pos ? `cert-${pos}-${name}` : `cert-${name}`;
  }

  async function exportCertImages() {
    if (!certRows.length) {
      showToast("ยังไม่มีรายชื่อ — อัปโหลด Excel ก่อน", "error");
      return;
    }
    if (!window.html2canvas) {
      showToast("ไลบรารี html2canvas ยังโหลดไม่เสร็จ", "error"); return;
    }
    // Validate all rows have a matching template
    const missing = [];
    for (const r of certRows) {
      const key = matchPositionKey(r.position);
      if (!key || !certTplExists[key]) missing.push(r.position || "(ว่าง)");
    }
    if (missing.length) {
      const uniq = [...new Set(missing)].slice(0, 3).join(", ");
      showToast(`มี ${missing.length} ใบที่ขาด template — ${uniq}${missing.length>3?" …":""}`, "error");
      return;
    }
    // For multi-cert export we need JSZip
    if (certRows.length > 1 && !window.JSZip) {
      showToast("ไลบรารี JSZip ยังโหลดไม่เสร็จ", "error"); return;
    }
    const btn = $("btnExportCertImg");
    const orig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังสร้างภาพ..."; }

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

      const sheets = printArea.querySelectorAll(".cert-a4");
      const images = [];

      for (let i = 0; i < sheets.length; i++) {
        if (btn) btn.textContent = `⏳ กำลังสร้างภาพ... (${i + 1}/${sheets.length})`;
        const canvas = await html2canvas(sheets[i], {
          scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false,
        });
        const dataUrl = canvas.toDataURL("image/png");
        images.push({ name: makeCertFilename(certRows[i], i), dataUrl });
      }

      printArea.style.position   = orig2.position;
      printArea.style.left       = orig2.left;
      printArea.style.top        = orig2.top;
      printArea.style.visibility = orig2.visibility;
      printArea.style.zIndex     = "";

      const stamp = new Date().toISOString().slice(0, 10);

      if (images.length === 1) {
        const a = document.createElement("a");
        a.href = images[0].dataUrl;
        a.download = `${images[0].name}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        showToast(`ดาวน์โหลดภาพเรียบร้อย`);
      } else {
        if (btn) btn.textContent = "⏳ กำลังบีบอัด ZIP...";
        const zip = new JSZip();
        // Avoid filename collisions (e.g. 2 rows with same name)
        const used = {};
        for (const img of images) {
          let fname = `${img.name}.png`;
          if (used[fname]) {
            used[img.name] = (used[img.name] || 1) + 1;
            fname = `${img.name}-${used[img.name]}.png`;
          } else {
            used[fname] = 1;
            used[img.name] = 1;
          }
          const base64 = img.dataUrl.split(",")[1];
          zip.file(fname, base64, { base64: true });
        }
        const blob = await zip.generateAsync({
          type: "blob",
          compression: "STORE",  // PNG already compressed — STORE = fast
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `certificates-${stamp}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showToast(`ส่งออก ZIP เรียบร้อย (${images.length} ใบ)`);
      }
    } catch (err) {
      console.error(err);
      showToast("สร้างภาพไม่สำเร็จ — " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
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
      if (!key || !certTplExists[key]) missing.push(r.position || "(ว่าง)");
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
          scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false,
        });
        // PNG = lossless · avoids JPEG compounding (template→canvas→pdf)
        const img = canvas.toDataURL("image/png");
        pdf.addImage(img, "PNG", 0, 0, 297, 210, undefined, "SLOW");
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
    probeAllCertTpls().then(() => updateCertTplCount());
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
    setCertZoom, exportCertPDF, exportCertImages,
    openCertTplModal, closeCertTplModal, resetAllCertTpl,
    openCertPosModal, closeCertPosModal,
    setCertPosY, bumpCertPosY, resetCertPosY,
    setCertPosLh, bumpCertPosLh, resetCertPosLh,
    toggleCertPos2, saveCertPos,
    downloadCertTemplate,
    // Common
    switchTab,
  };
})();
