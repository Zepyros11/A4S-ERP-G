/* ============================================================
   namecard-generator.js
   ป้ายชื่อ Event · 8.5cm × 6cm · A4 layout 8/หน้า
   ============================================================ */
(function () {
  "use strict";

  const PER_PAGE = 8;
  const A4_W_MM = 210, A4_H_MM = 297;
  const LOGO_FALLBACK = "../../assets/logo/logo-a4s.png";
  // Company logo from "ตั้งค่าบริษัท" (app_settings) · falls back to A4S logo
  function logoPath() {
    return (window.CompanyLogo ? window.CompanyLogo.logoUrl(LOGO_FALLBACK) : LOGO_FALLBACK);
  }

  // [{ name, position }]
  let rows = [];
  let zoom = 0.75;

  // ── VIP tab state ─────────────────────────────────────────
  let vipQty  = 10;
  let vipZoom = 0.65;
  let vipW    = 95;                 // card width  (mm)
  let vipH    = 50;                 // card height (mm)
  let vipText = "VIP";              // label text on the card
  let activeTab = "namecard";       // "namecard" | "vip" | "cert" | "seat"

  // ── Seat-number tab state ─────────────────────────────────
  let seatRowInput = "A-J";         // row tokens (e.g. "A-M" or "A,B,C")
  let seatColInput = "1-12";        // column tokens (e.g. "1-24" or "1,2,3")
  let seatSep      = "";            // separator between row & col ("" → "A1")
  let seatOrient   = "portrait";    // "portrait" | "landscape"
  let seatPerPage  = 6;             // cards per A4 sheet
  let seatZoom     = 0.5;

  // ── Badge tab state (logo + name · independent) ───────────
  let badgeQty     = 10;
  let badgeZoom    = 0.65;
  let badgeW       = 95;            // card width  (mm)
  let badgeH       = 60;            // card height (mm)
  let badgeName    = "";            // text written on every card
  let badgeLogos   = [];            // [{ path, url }] — library from Supabase
  let badgeLogoKey = null;          // selected logo path (null = no logo)
  const BADGE_LOGO_BUCKET = "badge-logos";

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
  const CERT_SINGLE_POS_DEFAULT = "middle";   // 'top' | 'middle' | 'bottom'
  let certConfig = {};              // { key: { nameY, nameLh, singlePos } }
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
  function getTplSinglePos(key) {
    const c = certConfig[key];
    const v = c && c.singlePos;
    return (v === "top" || v === "middle" || v === "bottom") ? v : CERT_SINGLE_POS_DEFAULT;
  }
  function setTplConfig(key, nameY, nameLh, singlePos) {
    certConfig[key] = {
      nameY:    nameY    ?? getTplNameY(key),
      nameLh:   nameLh   ?? getTplNameLh(key),
      singlePos: singlePos ?? getTplSinglePos(key),
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

  // ── Processing popup (export PDF/ZIP) ─────────────────────
  function showProcessing(title, sub = "") {
    const ov = $("loadingOverlay");
    if (!ov) return;
    const t = $("processingTitle"); if (t) t.textContent = title || "กำลังประมวลผล...";
    const s = $("processingSub");   if (s) s.textContent = sub || "";
    ov.classList.add("show");
  }
  function updateProcessing(sub) {
    const s = $("processingSub");
    if (s) s.textContent = sub || "";
  }
  function hideProcessing() {
    const ov = $("loadingOverlay");
    if (ov) ov.classList.remove("show");
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
        <div class="nmc-card-logo"><img src="${logoPath()}" alt="logo" crossorigin="anonymous" onerror="this.style.display='none'"></div>
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
    // withBreaks → hard page-break divs (print area) · wrap → .nmc-a4-wrap (on-screen)
    const buildHtml = (withBreaks, wrap) => pages.map((page, idx) => {
      const cells = [];
      for (let i = 0; i < PER_PAGE; i++) {
        cells.push(page[i] ? cardHtml(page[i]) : blankCardHtml());
      }
      const brk = (withBreaks && idx > 0) ? '<div class="nmc-page-break"></div>' : '';
      const sheet = `<div class="nmc-a4">${cells.join("")}</div>`;
      return brk + (wrap ? `<div class="nmc-a4-wrap">${sheet}</div>` : sheet);
    }).join("");

    scroller.innerHTML  = buildHtml(false, true);  // wrapped, no break divs
    printArea.innerHTML = buildHtml(true, false);  // bare sheets + break divs

    // Apply zoom to on-screen wrappers (drives wrapper size + inner scale)
    scroller.querySelectorAll(".nmc-a4-wrap").forEach(el => {
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
    const steps = [0.25, 0.35, 0.5, 0.65, 0.75, 0.9, 1.0];
    let i = steps.indexOf(zoom);
    if (i < 0) i = 4;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    zoom = steps[i];
    $("zoomLabel") && ($("zoomLabel").textContent = Math.round(zoom * 100) + "%");
    document.querySelectorAll("#sheetScroller .nmc-a4-wrap").forEach(el => {
      el.style.setProperty("--nmc-zoom", zoom);
    });
  }

  function printNow() {
    if (!rows.length) {
      showToast("ยังไม่มีรายชื่อ", "error");
      return;
    }
    setStep(3);
    // Re-render so the off-screen print area matches the current rows, then
    // wait for the autoFit RAF + a paint frame before opening the dialog so
    // every sheet is fully laid out (otherwise Edge can mis-count pages).
    renderSheets();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => window.print(), 120);
    }));
  }

  // ── Export PDF (via html2canvas + jsPDF) ──────────────────
  // Bypasses Edge's flaky print pipeline. Each A4 sheet rendered
  // off-screen → captured as canvas → embedded in PDF page.
  async function exportPDF(mode = "save") {
    if (!rows.length) {
      showToast("ยังไม่มีรายชื่อ", "error");
      return;
    }
    if (!window.html2canvas || !window.jspdf) {
      showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "error");
      return;
    }
    setStep(3);
    // Disable both action buttons while rendering · restore in finally
    const btnReview = $("btnReview"), btnPrint = $("btnPrint");
    const busyBtn = mode === "open" ? btnReview : btnPrint;
    const origText = busyBtn ? busyBtn.textContent : "";
    [btnReview, btnPrint].forEach(b => b && (b.disabled = true));
    if (busyBtn) busyBtn.textContent = "⏳ กำลังสร้าง PDF...";
    showProcessing("กำลังสร้าง PDF ป้ายชื่อ...", "เตรียมข้อมูล");

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
        updateProcessing(`เรนเดอร์หน้า ${i + 1} / ${sheets.length}`);
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
      if (mode === "open") {
        // Review: open the PDF in a new tab for preview / print-from-viewer
        updateProcessing("กำลังเปิดตัวอย่าง...");
        const url = pdf.output("bloburl");
        const win = window.open(url, "_blank");
        if (!win) {
          // Popup blocked → fall back to download so the user still gets it
          pdf.save(`namecards-${stamp}.pdf`);
          showToast("เบราว์เซอร์บล็อกหน้าต่างใหม่ — บันทึกไฟล์แทน", "error");
        } else {
          showToast(`เปิดตัวอย่าง PDF (${sheets.length} หน้า · ${rows.length} ใบ)`);
        }
      } else {
        // Print: save the PDF file (เหมือนเดิม)
        updateProcessing("กำลังบันทึกไฟล์...");
        pdf.save(`namecards-${stamp}.pdf`);
        showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${rows.length} ใบ)`);
      }
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      [btnReview, btnPrint].forEach(b => b && (b.disabled = false));
      if (busyBtn) busyBtn.textContent = origText;
      hideProcessing();
    }
  }

  // ════════════════════════════════════════════════════════════
  // VIP TAB
  // ════════════════════════════════════════════════════════════
  const TOOL_TITLES = {
    namecard: "🪪 ป้ายชื่อ",
    vip:      "⭐ ป้าย VIP",
    cert:     "🏆 ใบประกาศนียบัตร",
    seat:     "🎫 หมายเลขที่นั่ง",
    badge:    "🆕 ป้ายโลโก้+ชื่อ",
  };

  // Landing view: show the tool-picker cards, hide every tool pane.
  function showPicker() {
    activeTab = null;
    $("toolPicker") && ($("toolPicker").style.display = "");
    $("toolBack")   && ($("toolBack").style.display   = "none");
    ["paneNamecard", "paneVip", "paneCert", "paneSeat", "paneBadge"].forEach(id => {
      const el = $(id); if (el) el.style.display = "none";
    });
    const btnT = $("btnTemplate");
    if (btnT) btnT.style.display = "none";
  }

  function switchTab(tab) {
    activeTab = tab;
    $("toolPicker") && ($("toolPicker").style.display = "none");
    $("toolBack")   && ($("toolBack").style.display   = "");
    $("toolBackTitle") && ($("toolBackTitle").textContent = TOOL_TITLES[tab] || "");
    $("paneNamecard").style.display = tab === "namecard" ? "" : "none";
    $("paneVip").style.display      = tab === "vip"      ? "" : "none";
    $("paneCert").style.display     = tab === "cert"     ? "" : "none";
    $("paneSeat").style.display     = tab === "seat"     ? "" : "none";
    $("paneBadge").style.display    = tab === "badge"    ? "" : "none";
    // Template-download button is namecard-specific
    const btnT = $("btnTemplate");
    if (btnT) btnT.style.display = tab === "namecard" ? "" : "none";

    if (tab === "vip")  renderVipSheets();
    if (tab === "cert") renderCertSheets();
    if (tab === "seat") renderSeatSheets();
    if (tab === "badge") { renderBadgeSheets(); refreshBadgeLogos(); }
  }

  function vipCardHtml() {
    return `
      <div class="vip-card">
        <div class="vip-card-logo"><img src="${logoPath()}" alt="logo" crossorigin="anonymous" onerror="this.style.display='none'"></div>
        <div class="vip-card-band">
          <div class="vip-card-text">${esc(vipText || "")}</div>
        </div>
      </div>
    `;
  }
  function vipBlankHtml() { return `<div class="vip-card" style="visibility:hidden"></div>`; }

  // How many cards fit on one A4 sheet for the current card size.
  function vipGrid() {
    const cols = Math.max(1, Math.floor(A4_W_MM / vipW));
    const rows = Math.max(1, Math.floor(A4_H_MM / vipH));
    return { cols, rows, perPage: cols * rows };
  }

  // Shrink VIP text font-size until it fits inside its green band.
  function fitVipText(el) {
    const band = el.parentElement;
    if (!band) return;
    const maxW = band.clientWidth  - 14;
    const maxH = band.clientHeight - 8;
    if (maxW <= 0 || maxH <= 0) return;
    let size = Math.min(maxH, 400);
    el.style.fontSize = size + "px";
    let guard = 160;
    while (size > 8 && guard-- > 0 &&
           (el.scrollWidth > maxW || el.scrollHeight > maxH)) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
  }

  function renderVipSheets() {
    const qty = Math.max(0, vipQty | 0);
    const scroller  = $("vipSheetScroller");
    const printArea = $("vipPrintArea");
    if (!scroller || !printArea) return;

    const { cols, rows: gRows, perPage } = vipGrid();
    const pageCount = Math.max(1, Math.ceil(qty / perPage));

    // Layout info / counters
    $("vipPerPage")    && ($("vipPerPage").textContent    = perPage);
    $("vipGridDesc")   && ($("vipGridDesc").textContent   = cols + " × " + gRows);
    $("vipPageCount")  && ($("vipPageCount").textContent  = qty ? pageCount : 0);
    $("vipPerPageMeta")&& ($("vipPerPageMeta").textContent= `(${perPage} ใบ/หน้า · ${cols}×${gRows})`);
    $("vipLayoutTitle")&& ($("vipLayoutTitle").textContent=
      `👁️ ตัวอย่าง Layout · กระดาษ A4 (${perPage} ใบ/หน้า · ${cols}×${gRows})`);

    if (!qty) {
      scroller.innerHTML  = "";
      printArea.innerHTML = "";
      return;
    }

    let remaining = qty;
    const pageCells = [];
    for (let p = 0; p < pageCount; p++) {
      const cells = [];
      for (let i = 0; i < perPage; i++) {
        if (remaining > 0) { cells.push(vipCardHtml()); remaining--; }
        else cells.push(vipBlankHtml());
      }
      pageCells.push(cells.join(""));
    }
    const wrapHtml = (cells) => `<div class="vip-a4-wrap"><div class="vip-a4">${cells}</div></div>`;
    // On-screen preview: each page labelled · print area: bare sheets
    scroller.innerHTML = pageCells.map((cells, i) =>
      `<div class="vip-page-item">` +
        `<div class="vip-page-label">📄 หน้า ${i + 1} / ${pageCount}</div>` +
        wrapHtml(cells) +
      `</div>`
    ).join("");
    printArea.innerHTML = pageCells.map(wrapHtml).join("");

    // Card size + grid + zoom → CSS vars on each A4 wrapper (inherit inward)
    const applyVars = (el) => {
      el.style.setProperty("--vip-w", vipW + "mm");
      el.style.setProperty("--vip-h", vipH + "mm");
      el.style.setProperty("--vip-cols", cols);
      el.style.setProperty("--vip-rows", gRows);
      el.style.setProperty("--nmc-zoom", vipZoom);
    };
    scroller.querySelectorAll(".vip-a4-wrap").forEach(applyVars);
    printArea.querySelectorAll(".vip-a4-wrap").forEach(applyVars);

    // Auto-fit label text once layout has painted
    requestAnimationFrame(() => {
      [scroller, printArea].forEach(root => {
        root.querySelectorAll(".vip-card-text").forEach(fitVipText);
      });
    });
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

  // ── VIP text + custom size ────────────────────────────────
  function setVipText(v) {
    vipText = String(v == null ? "" : v);
    renderVipSheets();
  }
  function setVipW(v) {
    const n = parseFloat(v);
    if (!isFinite(n)) return;
    vipW = Math.max(3, Math.min(21, n)) * 10;     // cm → mm
    renderVipSheets();
  }
  function setVipH(v) {
    const n = parseFloat(v);
    if (!isFinite(n)) return;
    vipH = Math.max(2, Math.min(29.7, n)) * 10;   // cm → mm
    renderVipSheets();
  }
  function setVipSize(wCm, hCm) {
    vipW = Math.max(3, Math.min(21,   wCm)) * 10;
    vipH = Math.max(2, Math.min(29.7, hCm)) * 10;
    syncVipInputs();
    renderVipSheets();
  }
  // Write the clamped mm values back into the cm inputs.
  function syncVipInputs() {
    const wi = $("vipWInput"), hi = $("vipHInput");
    if (wi) wi.value = +(vipW / 10).toFixed(2);
    if (hi) hi.value = +(vipH / 10).toFixed(2);
  }

  function setVipZoom(dir) {
    const steps = [0.25, 0.35, 0.5, 0.65, 0.75, 0.9, 1.0];
    let i = steps.indexOf(vipZoom);
    if (i < 0) i = 4;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    vipZoom = steps[i];
    $("vipZoomLabel") && ($("vipZoomLabel").textContent = Math.round(vipZoom * 100) + "%");
    document.querySelectorAll("#vipSheetScroller .vip-a4-wrap").forEach(el => {
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
    showProcessing("กำลังสร้าง PDF ป้าย VIP...", "เตรียมข้อมูล");

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
        updateProcessing(`เรนเดอร์หน้า ${i + 1} / ${sheets.length}`);
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

      updateProcessing("กำลังบันทึกไฟล์...");
      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`vip-cards-${stamp}.pdf`);
      showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${vipQty} ใบ)`);
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      hideProcessing();
    }
  }

  // ════════════════════════════════════════════════════════════
  // BADGE TAB (upload logo + write name → tile on A4)
  // ════════════════════════════════════════════════════════════
  function badgeLogoUrl(path) {
    if (!path || !SB_URL) return null;
    return `${SB_URL}/storage/v1/object/public/${BADGE_LOGO_BUCKET}/${encodeURIComponent(path)}`;
  }

  // List every logo in the shared bucket (newest first).
  async function listBadgeLogos() {
    if (!SB_URL) return [];
    const res = await fetch(`${SB_URL}/storage/v1/object/list/${BADGE_LOGO_BUCKET}`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: "",
        limit: 200,
        sortBy: { column: "created_at", order: "desc" },
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[badge-logos list]", res.status, txt);
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => []);
    // Storage returns a placeholder row (id=null) for empty folders — skip it
    return (Array.isArray(data) ? data : [])
      .filter(o => o && o.name && o.id)
      .map(o => ({ path: o.name, url: badgeLogoUrl(o.name) }));
  }

  // Resize a logo to keep egress small while preserving transparency.
  // PNG/SVG/WebP → PNG (keeps alpha) · others → JPEG q0.85.
  function resizeLogo(file) {
    return new Promise((resolve, reject) => {
      // SVG is vector — upload as-is (no raster resize)
      if (file.type === "image/svg+xml") { resolve({ blob: file, ext: "svg" }); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 600;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          const s = Math.min(MAX / w, MAX / h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const keepAlpha = /png|webp/.test(file.type);
        const mime = keepAlpha ? "image/png" : "image/jpeg";
        const ext  = keepAlpha ? "png" : "jpg";
        canvas.toBlob(
          b => b ? resolve({ blob: b, ext }) : reject(new Error("แปลงรูปไม่สำเร็จ")),
          mime, keepAlpha ? undefined : 0.85
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านไฟล์ภาพไม่สำเร็จ")); };
      img.src = url;
    });
  }

  // Slugify the original filename → safe storage key (keep Thai/EN/digits).
  function badgeSafeName(filename) {
    const base = String(filename || "logo").replace(/\.[^.]+$/, "");
    const clean = base.replace(/[<>:"\/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, "-").slice(0, 40);
    return clean || "logo";
  }

  async function uploadBadgeLogo(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error("รับเฉพาะไฟล์ภาพ");
    const { blob, ext } = await resizeLogo(file);
    const path = `${Date.now()}-${badgeSafeName(file.name)}.${ext}`;
    const res = await fetch(`${SB_URL}/storage/v1/object/${BADGE_LOGO_BUCKET}/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": blob.type || "image/png",
        "x-upsert": "true",
        "cache-control": "max-age=31536000",
      },
      body: blob,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[badge-logo upload]", res.status, txt);
      if (res.status === 404 || res.status === 405) {
        throw new Error(`ยังไม่ได้สร้าง bucket "badge-logos" — รัน sql/134_badge_logos_bucket.sql ใน Supabase`);
      }
      if (res.status === 403) throw new Error("Permission denied — เช็ค RLS policy (รัน sql/134 ใหม่)");
      if (res.status === 413) throw new Error("ไฟล์ใหญ่เกิน 10 MB");
      throw new Error(`HTTP ${res.status} · ${txt.slice(0, 120)}`);
    }
    return path;
  }

  async function deleteBadgeLogo(path) {
    const res = await fetch(`${SB_URL}/storage/v1/object/${BADGE_LOGO_BUCKET}/${encodeURIComponent(path)}`, {
      method: "DELETE",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => "");
      throw new Error(`${res.status} ${txt.slice(0, 100)}`);
    }
  }

  // ── Logo library UI ───────────────────────────────────────
  async function refreshBadgeLogos() {
    const grid = $("badgeLogoGrid");
    if (grid && !badgeLogos.length) {
      grid.innerHTML = `<div class="badge-logo-empty">⏳ กำลังโหลดโลโก้...</div>`;
    }
    try {
      badgeLogos = await listBadgeLogos();
    } catch (err) {
      badgeLogos = [];
      if (grid) grid.innerHTML = `<div class="badge-logo-empty">⚠ โหลดโลโก้ไม่สำเร็จ — ${esc(err.message)}</div>`;
      return;
    }
    // Drop selection if the selected logo no longer exists
    if (badgeLogoKey && !badgeLogos.some(l => l.path === badgeLogoKey)) badgeLogoKey = null;
    renderBadgeLogoGrid();
  }

  function renderBadgeLogoGrid() {
    const grid = $("badgeLogoGrid");
    if (!grid) return;
    $("badgeLogoCount") && ($("badgeLogoCount").textContent = badgeLogos.length);
    if (!badgeLogos.length) {
      grid.innerHTML = `<div class="badge-logo-empty">ยังไม่มีโลโก้ — กด “⬆ อัปโหลดโลโก้”</div>`;
      return;
    }
    grid.innerHTML = badgeLogos.map(l => `
      <div class="badge-logo-item ${l.path === badgeLogoKey ? "selected" : ""}" data-path="${esc(l.path)}" title="${esc(l.path)}">
        <span class="badge-logo-check">✓</span>
        <img src="${esc(l.url)}" alt="" loading="lazy">
        <button class="badge-logo-del" data-path="${esc(l.path)}" title="ลบโลโก้นี้">✕</button>
      </div>
    `).join("");

    grid.querySelectorAll(".badge-logo-item").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".badge-logo-del")) return;
        selectBadgeLogo(el.dataset.path);
      });
    });
    grid.querySelectorAll(".badge-logo-del").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeBadgeLogo(btn.dataset.path);
      });
    });
  }

  function selectBadgeLogo(path) {
    badgeLogoKey = (badgeLogoKey === path) ? null : path;   // toggle off if re-click
    renderBadgeLogoGrid();
    renderBadgeSheets();
  }

  async function onBadgeLogoPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";   // allow re-pick same file
    if (!files.length) return;
    let lastPath = null, ok = 0;
    for (const f of files) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      try {
        showToast(`⏳ กำลังอัปโหลด ${f.name} (${sizeMB} MB)...`);
        lastPath = await uploadBadgeLogo(f);
        ok++;
      } catch (err) {
        showToast("อัปโหลดล้มเหลว — " + err.message, "error");
      }
    }
    if (ok) {
      await refreshBadgeLogos();
      if (lastPath && badgeLogos.some(l => l.path === lastPath)) badgeLogoKey = lastPath;  // auto-select last upload
      renderBadgeLogoGrid();
      renderBadgeSheets();
      showToast(`✓ อัปโหลดโลโก้สำเร็จ (${ok} รูป)`);
    }
  }

  async function removeBadgeLogo(path) {
    const ok = await ConfirmModal.open({
      title: "ลบโลโก้?",
      message: "จะลบโลโก้นี้ออกจาก Supabase Storage (ทุกเครื่อง)",
      icon: "🗑",
      tone: "danger",
      okText: "ลบ",
    });
    if (!ok) return;
    try {
      await deleteBadgeLogo(path);
      if (badgeLogoKey === path) badgeLogoKey = null;
      await refreshBadgeLogos();
      renderBadgeSheets();
      showToast("✓ ลบโลโก้สำเร็จ");
    } catch (err) {
      showToast("ลบไม่สำเร็จ — " + err.message, "error");
    }
  }

  // ── Badge card render ─────────────────────────────────────
  function badgeCardHtml() {
    const url = badgeLogoKey ? badgeLogoUrl(badgeLogoKey) : null;
    const logo = url
      ? `<div class="badge-card-logo"><img src="${esc(url)}" alt="" crossorigin="anonymous"></div>`
      : `<div class="badge-card-logo is-empty"></div>`;
    const name = esc(formatName(badgeName));
    return `
      <div class="badge-card">
        ${logo}
        ${name ? `<div class="badge-card-name">${name}</div>` : ""}
      </div>
    `;
  }
  function badgeBlankHtml() { return `<div class="badge-card" style="visibility:hidden"></div>`; }

  function badgeGrid() {
    const cols = Math.max(1, Math.floor(A4_W_MM / badgeW));
    const rows = Math.max(1, Math.floor(A4_H_MM / badgeH));
    return { cols, rows, perPage: cols * rows };
  }

  // Shrink name font-size until it fits the width + the height left after
  // the logo block (so a long name never bleeds out of the card).
  function fitBadgeText(el) {
    const card = el.closest(".badge-card");
    if (!card) return;
    const logo = card.querySelector(".badge-card-logo");
    const padV = card.clientHeight * 0.13;                 // 4mm top+bottom padding ≈ 13% of 60mm
    const logoH = logo ? logo.getBoundingClientRect().height : 0;
    const maxW = card.clientWidth - 18;
    const maxH = Math.max(20, card.clientHeight - logoH - padV);
    if (maxW <= 0) return;
    let size = 80;
    el.style.fontSize = size + "px";
    let guard = 120;
    while (size > 8 && guard-- > 0 &&
           (el.scrollWidth > maxW || el.scrollHeight > maxH + 1)) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
  }

  function renderBadgeSheets() {
    const qty = Math.max(0, badgeQty | 0);
    const scroller  = $("badgeSheetScroller");
    const printArea = $("badgePrintArea");
    if (!scroller || !printArea) return;

    const { cols, rows: gRows, perPage } = badgeGrid();
    const pageCount = Math.max(1, Math.ceil(qty / perPage));

    $("badgePerPage")    && ($("badgePerPage").textContent    = perPage);
    $("badgeGridDesc")   && ($("badgeGridDesc").textContent   = cols + " × " + gRows);
    $("badgePageCount")  && ($("badgePageCount").textContent  = qty ? pageCount : 0);
    $("badgePerPageMeta")&& ($("badgePerPageMeta").textContent= `(${perPage} ใบ/หน้า · ${cols}×${gRows})`);
    $("badgeLayoutTitle")&& ($("badgeLayoutTitle").textContent=
      `👁️ ตัวอย่าง Layout · กระดาษ A4 (${perPage} ใบ/หน้า · ${cols}×${gRows})`);

    if (!qty) { scroller.innerHTML = ""; printArea.innerHTML = ""; return; }

    let remaining = qty;
    const pageCells = [];
    for (let p = 0; p < pageCount; p++) {
      const cells = [];
      for (let i = 0; i < perPage; i++) {
        if (remaining > 0) { cells.push(badgeCardHtml()); remaining--; }
        else cells.push(badgeBlankHtml());
      }
      pageCells.push(cells.join(""));
    }
    const wrapHtml = (cells) => `<div class="badge-a4-wrap"><div class="badge-a4">${cells}</div></div>`;
    scroller.innerHTML = pageCells.map((cells, i) =>
      `<div class="vip-page-item">` +
        `<div class="vip-page-label">📄 หน้า ${i + 1} / ${pageCount}</div>` +
        wrapHtml(cells) +
      `</div>`
    ).join("");
    printArea.innerHTML = pageCells.map(wrapHtml).join("");

    const applyVars = (el) => {
      el.style.setProperty("--badge-w", badgeW + "mm");
      el.style.setProperty("--badge-h", badgeH + "mm");
      el.style.setProperty("--badge-cols", cols);
      el.style.setProperty("--badge-rows", gRows);
      el.style.setProperty("--nmc-zoom", badgeZoom);
    };
    scroller.querySelectorAll(".badge-a4-wrap").forEach(applyVars);
    printArea.querySelectorAll(".badge-a4-wrap").forEach(applyVars);

    requestAnimationFrame(() => {
      [scroller, printArea].forEach(root => {
        root.querySelectorAll(".badge-card-name").forEach(fitBadgeText);
      });
    });
  }

  // ── Badge setters ─────────────────────────────────────────
  function setBadgeName(v) { badgeName = String(v == null ? "" : v); renderBadgeSheets(); }
  function setBadgeW(v) {
    const n = parseFloat(v);
    if (!isFinite(n)) return;
    badgeW = Math.max(3, Math.min(21, n)) * 10;
    renderBadgeSheets();
  }
  function setBadgeH(v) {
    const n = parseFloat(v);
    if (!isFinite(n)) return;
    badgeH = Math.max(2, Math.min(29.7, n)) * 10;
    renderBadgeSheets();
  }
  function setBadgeSize(wCm, hCm) {
    badgeW = Math.max(3, Math.min(21,   wCm)) * 10;
    badgeH = Math.max(2, Math.min(29.7, hCm)) * 10;
    syncBadgeInputs();
    renderBadgeSheets();
  }
  function syncBadgeInputs() {
    const wi = $("badgeWInput"), hi = $("badgeHInput");
    if (wi) wi.value = +(badgeW / 10).toFixed(2);
    if (hi) hi.value = +(badgeH / 10).toFixed(2);
  }
  function setBadgeQty(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 500) n = 500;
    badgeQty = n;
    const inp = $("badgeQtyInput");
    if (inp && inp.value !== String(n)) inp.value = n;
    renderBadgeSheets();
  }
  function bumpBadgeQty(dir) { setBadgeQty(badgeQty + dir); }
  function setBadgeZoom(dir) {
    const steps = [0.25, 0.35, 0.5, 0.65, 0.75, 0.9, 1.0];
    let i = steps.indexOf(badgeZoom);
    if (i < 0) i = 3;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    badgeZoom = steps[i];
    $("badgeZoomLabel") && ($("badgeZoomLabel").textContent = Math.round(badgeZoom * 100) + "%");
    document.querySelectorAll("#badgeSheetScroller .badge-a4-wrap").forEach(el => {
      el.style.setProperty("--nmc-zoom", badgeZoom);
    });
  }

  async function exportBadgePDF() {
    if (!badgeQty) { showToast("กรุณาระบุจำนวนป้าย", "error"); return; }
    if (!badgeLogoKey && !badgeName.trim()) {
      showToast("เลือกโลโก้ หรือ ใส่ชื่อก่อน", "error"); return;
    }
    if (!window.html2canvas || !window.jspdf) {
      showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "error"); return;
    }
    const btn = $("btnExportBadgePDF");
    const orig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังสร้าง PDF..."; }
    showProcessing("กำลังสร้าง PDF ป้าย...", "เตรียมข้อมูล");

    try {
      renderBadgeSheets();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 120));

      const printArea = $("badgePrintArea");
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
      const sheets = printArea.querySelectorAll(".badge-a4");

      for (let i = 0; i < sheets.length; i++) {
        updateProcessing(`เรนเดอร์หน้า ${i + 1} / ${sheets.length}`);
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

      updateProcessing("กำลังบันทึกไฟล์...");
      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`badges-${stamp}.pdf`);
      showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${badgeQty} ใบ)`);
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      hideProcessing();
    }
  }

  // ════════════════════════════════════════════════════════════
  // SEAT-NUMBER TAB
  // ════════════════════════════════════════════════════════════
  // Expand "A-M" / "1-24" ranges and comma lists into a token array.
  // Ranges work for single letters (A-M) and integers (1-24), ascending
  // or descending. Anything else is kept as a literal token.
  function expandTokens(input) {
    const out = [];
    String(input == null ? "" : input).split(/[,\s]+/).forEach(tokRaw => {
      const tok = tokRaw.trim();
      if (!tok) return;
      const m = tok.match(/^(.+?)-(.+)$/);
      if (m) {
        const a = m[1].trim(), b = m[2].trim();
        if (/^\d+$/.test(a) && /^\d+$/.test(b)) {            // numeric range
          let s = +a, e = +b, step = s <= e ? 1 : -1;
          for (let i = s; step > 0 ? i <= e : i >= e; i += step) out.push(String(i));
          return;
        }
        if (/^[A-Za-z]$/.test(a) && /^[A-Za-z]$/.test(b)) {   // single-letter range
          let s = a.toUpperCase().charCodeAt(0), e = b.toUpperCase().charCodeAt(0);
          let step = s <= e ? 1 : -1;
          for (let i = s; step > 0 ? i <= e : i >= e; i += step) out.push(String.fromCharCode(i));
          return;
        }
      }
      out.push(tok);
    });
    return out;
  }

  // Build the seat list = every Row × Column combination → { label }.
  function buildSeats() {
    const rs = expandTokens(seatRowInput);
    const cs = expandTokens(seatColInput);
    if (!rs.length && !cs.length) return [];
    const rows = rs.length ? rs : [""];
    const cols = cs.length ? cs : [""];
    const out = [];
    for (const r of rows) {
      for (const c of cols) {
        const sep = (r && c) ? seatSep : "";
        out.push({ label: r + sep + c });
      }
    }
    return out;
  }

  // Choose the cols×rows grid (product = perPage) whose cell is closest to
  // square for the current paper orientation → biggest, most readable cards.
  function seatGrid() {
    const N = Math.max(1, seatPerPage | 0);
    const land = seatOrient === "landscape";
    const pw = land ? A4_H_MM : A4_W_MM;   // page width  (mm)
    const ph = land ? A4_W_MM : A4_H_MM;   // page height (mm)
    let best = null;
    for (let cols = 1; cols <= N; cols++) {
      if (N % cols) continue;
      const gRows = N / cols;
      const cw = pw / cols, ch = ph / gRows;
      const score = Math.abs(Math.log(cw / ch));   // 0 = perfectly square
      if (!best || score < best.score) best = { cols, gRows, cw, ch, score };
    }
    return { cols: best.cols, rows: best.gRows, cardW: best.cw, cardH: best.ch, perPage: N, pw, ph };
  }

  function seatCardHtml(s) {
    return `<div class="seat-card"><div class="seat-card-num">${esc(s.label)}</div></div>`;
  }
  function seatBlankHtml() { return `<div class="seat-card seat-blank"></div>`; }

  // Pick the visually-widest label — it drives the uniform font size for the
  // whole set (e.g. "C7" matches "C10"). Measured with a canvas so there is
  // NO layout reflow even for thousands of seats.
  function widestSeatLabel(seats) {
    if (!seats.length) return "";
    const c = widestSeatLabel._c || (widestSeatLabel._c = document.createElement("canvas"));
    const ctx = c.getContext("2d");
    ctx.font = '900 100px "Sarabun", sans-serif';
    let best = seats[0].label, bestW = -1;
    for (const s of seats) {
      const w = ctx.measureText(s.label).width;
      if (w > bestW) { bestW = w; best = s.label; }
    }
    return best;
  }

  // Apply grid + zoom CSS vars to one .seat-a4-wrap.
  function applySeatVars(el, g) {
    el.style.setProperty("--seat-pw", g.pw + "mm");
    el.style.setProperty("--seat-ph", g.ph + "mm");
    el.style.setProperty("--seat-cols", g.cols);
    el.style.setProperty("--seat-rows", g.rows);
    el.style.setProperty("--seat-w", g.cardW + "mm");
    el.style.setProperty("--seat-h", g.cardH + "mm");
    el.style.setProperty("--nmc-zoom", seatZoom);
  }

  // One A4 page of seat cards (fills the grid · pads blanks).
  function seatPageHtml(pg, perPage) {
    const cells = [];
    for (let i = 0; i < perPage; i++) {
      cells.push(pg[i] ? seatCardHtml(pg[i]) : seatBlankHtml());
    }
    return `<div class="seat-a4-wrap"><div class="seat-a4">${cells.join("")}</div></div>`;
  }

  // Fit ONE hidden probe card with the widest label → returns the px size to
  // apply uniformly. O(1) layout work instead of fitting every card.
  function computeSeatFontSize(container, g, widest) {
    if (!widest) return null;
    const probe = document.createElement("div");
    probe.className = "seat-a4-wrap";
    probe.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden";
    probe.innerHTML =
      `<div class="seat-a4"><div class="seat-card"><div class="seat-card-num">${esc(widest)}</div></div></div>`;
    applySeatVars(probe, g);
    container.appendChild(probe);
    const size = (() => { const el = probe.querySelector(".seat-card-num"); fitSeatText(el); return el.style.fontSize; })();
    probe.remove();
    return size;
  }

  // Shrink seat number until it fits its card (width & height).
  function fitSeatText(el) {
    const box = el.parentElement;
    if (!box) return;
    const maxW = box.clientWidth - 8;
    const maxH = box.clientHeight - 8;
    if (maxW <= 0 || maxH <= 0) return;
    let size = Math.min(maxH, 800);
    el.style.fontSize = size + "px";
    let guard = 220;
    while (size > 8 && guard-- > 0 &&
           (el.scrollWidth > maxW || el.scrollHeight > maxH)) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
  }

  // How many A4 pages to draw in the live preview. Print/Export always cover
  // every page — the preview is capped so typing a huge range never freezes.
  const SEAT_PREVIEW_MAX = 12;

  function renderSeatSheets() {
    const scroller  = $("seatSheetScroller");
    const printArea = $("seatPrintArea");
    if (!scroller) return;

    const seats = buildSeats();
    const g = seatGrid();
    const total = seats.length;
    const pageCount = Math.max(1, Math.ceil(total / g.perPage));

    // Layout info / counters
    $("seatTotal")     && ($("seatTotal").textContent     = total);
    $("seatPageCount") && ($("seatPageCount").textContent = total ? pageCount : 0);
    $("seatGridDesc")  && ($("seatGridDesc").textContent  = `${g.cols} × ${g.rows} (${g.perPage} ใบ/หน้า)`);
    $("seatCardSize")  && ($("seatCardSize").textContent  =
      `${(g.cardW / 10).toFixed(1)} × ${(g.cardH / 10).toFixed(1)} ซม.`);
    $("seatLayoutTitle") && ($("seatLayoutTitle").textContent =
      `👁️ ตัวอย่าง Layout · A4 ${seatOrient === "landscape" ? "แนวนอน" : "แนวตั้ง"} (${g.perPage} ใบ/หน้า · ${g.cols}×${g.rows})`);

    // Print area is built lazily at export time (can be hundreds of pages).
    if (printArea) printArea.innerHTML = "";

    if (!total) { scroller.innerHTML = ""; return; }

    const pages = chunked(seats, g.perPage);
    const shown = pages.slice(0, SEAT_PREVIEW_MAX);
    let html = shown.map((pg, i) =>
      `<div class="vip-page-item">` +
        `<div class="vip-page-label">📄 หน้า ${i + 1} / ${pageCount}</div>` +
        seatPageHtml(pg, g.perPage) +
      `</div>`
    ).join("");
    if (pages.length > SEAT_PREVIEW_MAX) {
      html += `<div class="seat-more-note">… แสดงตัวอย่าง ${SEAT_PREVIEW_MAX} หน้าแรก · กด Preview / Print เพื่อดูครบทั้ง ${pageCount} หน้า</div>`;
    }
    scroller.innerHTML = html;
    scroller.querySelectorAll(".seat-a4-wrap").forEach(el => applySeatVars(el, g));

    requestAnimationFrame(() => {
      const size = computeSeatFontSize(scroller, g, widestSeatLabel(seats));
      if (size) scroller.querySelectorAll(".seat-card-num").forEach(el => { el.style.fontSize = size; });
    });
  }

  // ── Seat setters ──────────────────────────────────────────
  function setSeatRow(v) { seatRowInput = String(v == null ? "" : v); renderSeatSheets(); }
  function setSeatCol(v) { seatColInput = String(v == null ? "" : v); renderSeatSheets(); }
  function setSeatSep(v) { seatSep      = String(v == null ? "" : v); renderSeatSheets(); }
  function setSeatPerPage(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 60) n = 60;
    seatPerPage = n;
    const inp = $("seatPerPageInput");
    if (inp && inp.value !== String(n)) inp.value = n;
    renderSeatSheets();
  }
  function bumpSeatPerPage(dir) { setSeatPerPage(seatPerPage + dir); }
  function setSeatOrient(o) {
    seatOrient = (o === "landscape") ? "landscape" : "portrait";
    $("seatOrientPortrait")  && $("seatOrientPortrait").classList.toggle("active", seatOrient === "portrait");
    $("seatOrientLandscape") && $("seatOrientLandscape").classList.toggle("active", seatOrient === "landscape");
    renderSeatSheets();
  }
  function setSeatZoom(dir) {
    const steps = [0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1.0];
    let i = steps.indexOf(seatZoom);
    if (i < 0) i = 3;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    seatZoom = steps[i];
    $("seatZoomLabel") && ($("seatZoomLabel").textContent = Math.round(seatZoom * 100) + "%");
    document.querySelectorAll("#seatSheetScroller .seat-a4-wrap").forEach(el => {
      el.style.setProperty("--nmc-zoom", seatZoom);
    });
  }
  async function clearSeat() {
    if (!buildSeats().length) return;
    const ok = await ConfirmModal.open({
      title: "ล้างหมายเลขที่นั่ง?",
      message: "จะล้างค่า Row / Column ที่กรอกไว้",
      icon: "↺",
      tone: "warning",
      okText: "ล้าง",
    });
    if (!ok) return;
    seatRowInput = ""; seatColInput = ""; seatSep = "";
    const ri = $("seatRowInput"); if (ri) ri.value = "";
    const ci = $("seatColInput"); if (ci) ci.value = "";
    const si = $("seatSepInput"); if (si) si.value = "";
    renderSeatSheets();
  }

  async function exportSeatPDF(mode = "save") {
    if (!buildSeats().length) { showToast("กรุณาระบุ Row และ/หรือ Column", "error"); return; }
    if (!window.html2canvas || !window.jspdf) {
      showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "error"); return;
    }
    // Disable both action buttons while rendering · restore in finally
    const btnPreview = $("btnSeatPreview"), btnPrint = $("btnExportSeatPDF");
    const busyBtn = mode === "open" ? btnPreview : btnPrint;
    const orig = busyBtn ? busyBtn.textContent : "";
    [btnPreview, btnPrint].forEach(b => b && (b.disabled = true));
    if (busyBtn) busyBtn.textContent = "⏳ กำลังสร้าง PDF...";
    showProcessing("กำลังสร้าง PDF หมายเลขที่นั่ง...", "เตรียมข้อมูล");

    try {
      // Build ALL pages into the off-screen print area (full set).
      updateProcessing("กำลังจัดหน้า...");
      const seats = buildSeats();
      const g = seatGrid();
      const pages = chunked(seats, g.perPage);
      const printArea = $("seatPrintArea");
      printArea.innerHTML = pages.map(pg => seatPageHtml(pg, g.perPage)).join("");
      printArea.querySelectorAll(".seat-a4-wrap").forEach(el => applySeatVars(el, g));

      // Uniform font size (computed once for the whole set).
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const size = computeSeatFontSize(printArea, g, widestSeatLabel(seats));
      if (size) printArea.querySelectorAll(".seat-card-num").forEach(el => { el.style.fontSize = size; });
      await new Promise(r => setTimeout(r, 50));

      const orig2 = {
        position: printArea.style.position, left: printArea.style.left,
        top: printArea.style.top, visibility: printArea.style.visibility,
      };
      printArea.style.position = "fixed";
      printArea.style.left = "0"; printArea.style.top = "0";
      printArea.style.visibility = "visible";
      printArea.style.zIndex = "-1";

      const { jsPDF } = window.jspdf;
      const land = seatOrient === "landscape";
      const pdf = new jsPDF({ orientation: land ? "landscape" : "portrait", unit: "mm", format: "a4" });
      const pw = land ? A4_H_MM : A4_W_MM;
      const ph = land ? A4_W_MM : A4_H_MM;
      const sheets = printArea.querySelectorAll(".seat-a4");

      for (let i = 0; i < sheets.length; i++) {
        updateProcessing(`เรนเดอร์หน้า ${i + 1} / ${sheets.length}`);
        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(sheets[i], {
          scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false,
        });
        const img = canvas.toDataURL("image/jpeg", 0.95);
        pdf.addImage(img, "JPEG", 0, 0, pw, ph, undefined, "FAST");
      }

      printArea.style.position   = orig2.position;
      printArea.style.left       = orig2.left;
      printArea.style.top        = orig2.top;
      printArea.style.visibility = orig2.visibility;
      printArea.style.zIndex     = "";

      const stamp = new Date().toISOString().slice(0, 10);
      if (mode === "open") {
        // Preview: open the PDF in a new tab
        updateProcessing("กำลังเปิดตัวอย่าง...");
        const url = pdf.output("bloburl");
        const win = window.open(url, "_blank");
        if (!win) {
          pdf.save(`seat-numbers-${stamp}.pdf`);
          showToast("เบราว์เซอร์บล็อกหน้าต่างใหม่ — บันทึกไฟล์แทน", "error");
        } else {
          showToast(`เปิดตัวอย่าง PDF (${sheets.length} หน้า · ${buildSeats().length} ใบ)`);
        }
      } else {
        updateProcessing("กำลังบันทึกไฟล์...");
        pdf.save(`seat-numbers-${stamp}.pdf`);
        showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${buildSeats().length} ใบ)`);
      }
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      const pa = $("seatPrintArea"); if (pa) pa.innerHTML = "";   // free the (potentially huge) DOM
      [btnPreview, btnPrint].forEach(b => b && (b.disabled = false));
      if (busyBtn) busyBtn.textContent = orig;
      hideProcessing();
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
    singlePos: CERT_SINGLE_POS_DEFAULT,
    dragging: false,
  };

  function openCertPosModal(key) {
    const src = getTplSrc(key);
    if (!src) { showToast("ยังไม่ได้อัปโหลด template", "error"); return; }
    const label = CERT_POSITIONS.find(p => p.key === key)?.label || key;
    _certPosState.key = key;
    _certPosState.y   = getTplNameY(key);
    _certPosState.lh  = getTplNameLh(key);
    _certPosState.singlePos = getTplSinglePos(key);
    $("certPosLabel").textContent = label;
    $("certPosCanvas").style.backgroundImage = `url('${src}')`;
    $("certPosShow2").checked = true;
    $("certPosName2").style.display = "";
    document.querySelectorAll('input[name="certPosSingle"]').forEach(r => {
      r.checked = (r.value === _certPosState.singlePos);
    });
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
    // Single-name alignment — only affects preview when 2-line is off
    const sp = _certPosState.singlePos || CERT_SINGLE_POS_DEFAULT;
    const justify = (!show2 && sp === "top")    ? "flex-start"
                  : (!show2 && sp === "bottom") ? "flex-end"
                                                : "center";
    names.style.justifyContent = justify;
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
    updateCertPosUI();      // re-sync second guide + single-pos justify
  }
  function setCertPosSingle(pos) {
    if (pos !== "top" && pos !== "middle" && pos !== "bottom") return;
    _certPosState.singlePos = pos;
    // Auto-uncheck "2 บรรทัด" so user sees the alignment change live
    const cb = $("certPosShow2");
    if (cb && cb.checked) {
      cb.checked = false;
      const el = $("certPosName2");
      if (el) el.style.display = "none";
    }
    updateCertPosUI();
  }
  function saveCertPos() {
    const key = _certPosState.key;
    if (!key) return;
    const src = getTplSrc(key);
    setTplConfig(key, _certPosState.y, _certPosState.lh, _certPosState.singlePos);
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
    // Single-name alignment inside the 2-line block (top/middle/bottom)
    const sp = getTplSinglePos(key);
    const justify = (!n2 && sp === "top")    ? "flex-start"
                  : (!n2 && sp === "bottom") ? "flex-end"
                                             : "center";
    return `
      <div class="cert-a4-wrap">
        <div class="cert-a4" style="background-image:url('${src}');--cert-name-y:${nameY}mm;--cert-name-lh:${nameLh}mm;--cert-name-block-h:${blockH}mm;--cert-name-justify:${justify}">
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
    // NOTE: --cert-name-lh/-y/-block-h are set inline per-row in certHtml() using
    // per-template config — do NOT overwrite them here with global defaults.
    scroller.querySelectorAll(".cert-a4-wrap").forEach(el => {
      el.style.setProperty("--nmc-zoom", certZoom);
    });
    scroller.querySelectorAll(".cert-a4").forEach(el => {
      el.style.setProperty("--nmc-zoom", certZoom);
      el.style.setProperty("--cert-name-size", CERT_NAME_SIZE);
    });
    // PrintArea: no scaling (CSS override handles full size)
    printArea.querySelectorAll(".cert-a4").forEach(el => {
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
    showProcessing("กำลังสร้างภาพใบประกาศ...", `เตรียม ${certRows.length} ใบ`);

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
        updateProcessing(`เรนเดอร์ใบที่ ${i + 1} / ${sheets.length}`);
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
        updateProcessing("กำลังบีบอัด ZIP...");
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
      hideProcessing();
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
    showProcessing("กำลังสร้าง PDF ใบประกาศ...", `เตรียม ${certRows.length} ใบ`);

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
        updateProcessing(`เรนเดอร์ใบที่ ${i + 1} / ${sheets.length}`);
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

      updateProcessing("กำลังบันทึกไฟล์...");
      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`certificates-${stamp}.pdf`);
      showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} ใบ)`);
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      hideProcessing();
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
    $("seatZoomLabel") && ($("seatZoomLabel").textContent = Math.round(seatZoom * 100) + "%");
    $("badgeZoomLabel") && ($("badgeZoomLabel").textContent = Math.round(badgeZoom * 100) + "%");
    loadCertTemplates();
    probeAllCertTpls().then(() => updateCertTplCount());
    renderVipSheets();
    renderSeatSheets();
    renderBadgeSheets();
    showPicker();
    // Pull company logo from settings → re-render cards once it resolves
    if (window.CompanyLogo) {
      window.CompanyLogo.refresh().then(() => {
        if (rows.length) renderSheets();
        renderVipSheets();
      });
    }
  });

  window.nmc = {
    // Namecard tab
    onDrag, onDrop, onFilePick,
    addRow, clearAll, resetAll,
    setZoom, printNow, exportPDF, downloadTemplate,
    // VIP tab
    setVipQty, bumpVipQty, setVipZoom, exportVipPDF,
    setVipText, setVipW, setVipH, setVipSize, syncVipInputs,
    // Certificate tab
    onCertDrag, onCertDrop, onCertFilePick,
    certAddRow, certClearAll, certResetAll,
    setCertZoom, exportCertPDF, exportCertImages,
    openCertTplModal, closeCertTplModal, resetAllCertTpl,
    openCertPosModal, closeCertPosModal,
    setCertPosY, bumpCertPosY, resetCertPosY,
    setCertPosLh, bumpCertPosLh, resetCertPosLh,
    toggleCertPos2, setCertPosSingle, saveCertPos,
    downloadCertTemplate,
    // Seat-number tab
    setSeatRow, setSeatCol, setSeatSep,
    setSeatPerPage, bumpSeatPerPage, setSeatOrient,
    setSeatZoom, clearSeat, exportSeatPDF,
    // Badge tab
    onBadgeLogoPick, setBadgeName,
    setBadgeW, setBadgeH, setBadgeSize, syncBadgeInputs,
    setBadgeQty, bumpBadgeQty, setBadgeZoom, exportBadgePDF,
    // Common
    switchTab, showPicker,
  };
})();
