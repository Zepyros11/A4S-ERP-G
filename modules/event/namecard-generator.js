/* ============================================================
   namecard-generator.js
   ป้ายชื่อ Event · 8.5cm × 6cm · A4 layout 8/หน้า
   ============================================================ */
(function () {
  "use strict";

  // Loaded-version marker — if the console does NOT show this, the browser is
  // serving a cached copy and none of the recent fixes are running.
  console.log("%c[namecard-generator] v14 loaded", "color:#6BBE45;font-weight:bold");

  const A4_W_MM = 210, A4_H_MM = 297;
  const LOGO_FALLBACK = "../../assets/logo/logo-a4s.png";

  // Card size (mm) · default 85×60 (8/หน้า 2×4) · adjustable via the size bar.
  let cardW = 85, cardH = 60;
  // How many cards fit on a portrait A4 at the current size.
  function nmcGrid() {
    const cols = Math.max(1, Math.floor(A4_W_MM / cardW));
    const rows = Math.max(1, Math.floor(A4_H_MM / cardH));
    return { cols, rows, perPage: cols * rows };
  }
  // Company logo from "ตั้งค่าบริษัท" (app_settings) · falls back to A4S logo
  function logoPath() {
    return (window.CompanyLogo ? window.CompanyLogo.logoUrl(LOGO_FALLBACK) : LOGO_FALLBACK);
  }

  // [{ name, position, qty }]
  let rows = [];
  let zoom = 0.75;
  let qtyMode = false;              // "กำหนดชุด" — print N copies per person

  // Expand rows → one entry per card (respects per-person qty when qtyMode on).
  function rowCards() {
    const out = [];
    for (const r of rows) {
      const q = qtyMode ? Math.max(1, parseInt(r.qty, 10) || 1) : 1;
      for (let i = 0; i < q; i++) out.push(r);
    }
    return out;
  }

  let activeTab = "namecard";       // "namecard" | "custom" | "cert"

  // ── Custom tab state (merged: VIP + Badge + Seat) ─────────
  let cMode    = "repeat";          // "repeat" (logo+text ×N) | "sequence" (A1,A2…)
  let cW       = 95;                // card width  (mm)
  let cH       = 60;                // card height (mm)
  let cOrient  = "portrait";        // "portrait" | "landscape"
  let cVAlign  = "center";          // vertical align of card content · "top" | "center" | "bottom"
  let cZoom    = 0.5;
  // repeat-mode
  let cText     = "VIP";            // text/name on every card
  let cStyle    = "plain";          // "plain" (logo+name) | "vip" (green band)
  let cLogoSize = 100;             // logo size override (px) · 0 = auto · default 100
  let cTextSize = 60;              // text/name size override (px) · 0 = auto-fit · default 60 (capped to card width)
  let cQty      = 10;
  let cLogos   = [];                // [{ path, url }] — library from Supabase
  let cLogoKey = "__company__";     // selected logo · "__company__" | path | null
  const C_LOGO_BUCKET = "badge-logos";
  const C_COMPANY_KEY  = "__company__";
  // sequence-mode
  let cRowInput = "A-J";            // row tokens (e.g. "A-M" or "A,B,C")
  let cColInput = "1-12";           // column tokens (e.g. "1-24" or "1,2,3")
  let cSep      = "";               // separator between row & col ("" → "A1")
  let cNumSize  = 0;                // big sequence-number size override (px) · 0 = auto-fit
  let cSeqSets  = 1;                // print the whole sequence N times (e.g. 3 ชุด → A1..An ×3)

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
      let qty = parseInt(r[2], 10);
      if (!isFinite(qty) || qty < 1) qty = 1;
      if (qty > 200) qty = 200;
      if (!name && !position) continue;
      out.push({ name, position, qty });
    }
    if (!out.length) {
      showToast("ไม่พบรายชื่อ — ใส่ข้อมูลในคอลัมน์ A (ชื่อ) และ B (ตำแหน่ง)", "error");
      return;
    }
    rows = out;
    // Excel carried a quantity column → switch on "กำหนดชุด" automatically.
    if (out.some(r => (r.qty || 1) > 1)) qtyMode = true;
    showToast(`โหลดสำเร็จ · ${out.length} รายชื่อ`);
    refreshAll();
  }

  // ── Data editor table ──────────────────────────────────────
  function renderPreviewTable() {
    const body = $("previewBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${qtyMode ? 5 : 4}" style="padding:24px;text-align:center;color:#94a3b8">ยังไม่มีข้อมูล — กรุณาอัปโหลดไฟล์</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((r, i) => {
      const qtyCell = qtyMode
        ? `<td class="col-qty"><input type="number" class="nmc-cell-input nmc-qty-input" data-field="qty" data-idx="${i}" min="1" max="200" value="${Math.max(1, parseInt(r.qty, 10) || 1)}"></td>`
        : "";
      return `
      <tr data-idx="${i}">
        <td class="col-idx">${i + 1}</td>
        <td><input class="nmc-cell-input" data-field="name" data-idx="${i}" value="${esc(r.name)}" placeholder="ชื่อ-นามสกุล"></td>
        <td><input class="nmc-cell-input" data-field="position" data-idx="${i}" value="${esc(r.position)}" placeholder="ตำแหน่ง"></td>
        ${qtyCell}
        <td class="col-act"><button class="nmc-row-del" data-idx="${i}" title="ลบแถวนี้">🗑</button></td>
      </tr>
    `;}).join("");

    body.querySelectorAll(".nmc-cell-input").forEach(inp => {
      inp.addEventListener("input", () => {
        const idx = +inp.dataset.idx;
        const field = inp.dataset.field;
        if (!rows[idx]) return;
        if (field === "qty") {
          let q = parseInt(inp.value, 10);
          if (!isFinite(q) || q < 1) q = 1;
          if (q > 200) q = 200;
          rows[idx].qty = q;
          updateCounts();        // qty changes card/page totals
          renderSheets();
          return;
        }
        rows[idx][field] = inp.value;
        renderSheets(); // live update of card preview
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
        <div class="nmc-card-name"><span class="nmc-card-name-text" data-text="${name}">${name}</span></div>
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

    const g = nmcGrid();
    const pages = chunked(rowCards(), g.perPage);
    // Build the on-screen (wrapped) sheets only. The off-screen print area is
    // filled by cloning these AFTER auto-fit — measuring text inside a hidden /
    // off-screen element is unreliable (it left print names at full size), so we
    // size the visible preview and copy the finished result.
    scroller.innerHTML = pages.map(page => {
      const cells = [];
      for (let i = 0; i < g.perPage; i++) {
        cells.push(page[i] ? cardHtml(page[i]) : blankCardHtml());
      }
      return `<div class="nmc-a4-wrap"><div class="nmc-a4">${cells.join("")}</div></div>`;
    }).join("");
    printArea.innerHTML = "";   // populated by syncPrintArea() after auto-fit

    // Apply zoom to on-screen wrappers (drives wrapper size + inner scale)
    scroller.querySelectorAll(".nmc-a4-wrap").forEach(el => {
      el.style.setProperty("--nmc-zoom", zoom);
    });
    // Card-size + grid vars on every sheet (inherited by .nmc-card)
    scroller.querySelectorAll(".nmc-a4").forEach(el => {
      el.style.setProperty("--nmc-cols", g.cols);
      el.style.setProperty("--nmc-rows", g.rows);
      el.style.setProperty("--nmc-cw", cardW + "mm");
      el.style.setProperty("--nmc-ch", cardH + "mm");
    });

    // Auto-fit + line-lock the VISIBLE preview, then clone into the print area
    // so the PDF / printout matches it exactly.
    requestAnimationFrame(() => {
      scroller.querySelectorAll(".nmc-card-name").forEach(autoFit);
      uniformFit(Array.from(scroller.querySelectorAll(".nmc-card-position")));
      scroller.querySelectorAll(".nmc-card-name .nmc-card-name-text").forEach(lockNameLines);
      syncPrintArea();
    });
  }

  // Clone the auto-fitted on-screen sheets into the off-screen print area used by
  // html2canvas (Review/Print PDF) and window.print(). Cloning copies the inline
  // font sizes + locked single-line names verbatim — no re-measuring in a hidden
  // element — so the output is identical to the preview.
  function syncPrintArea() {
    const scroller = $("sheetScroller");
    const printArea = $("printArea");
    if (!scroller || !printArea) return;
    printArea.innerHTML = "";
    // Append sheets as ADJACENT siblings (no break divs between) so the
    // `.nmc-a4 + .nmc-a4` print rule can put each sheet after the first on a
    // fresh page. (Old break-after + 297mm-tall sheets dropped page 2 on Edge.)
    scroller.querySelectorAll(".nmc-a4-wrap > .nmc-a4").forEach(sheet => {
      printArea.appendChild(sheet.cloneNode(true));
    });
  }

  // Freeze a name span's current visual line wrapping into explicit single-line
  // blocks, each pinned to an ABSOLUTE top computed from the on-screen preview.
  // html2canvas collapses flex/auto-wrapped centered text onto one line (overlap);
  // absolutely-positioned single lines are painted exactly where we put them (same
  // reliable path as the green-band "VIP" text). Run AFTER autoFit so the font
  // size — and therefore the line breaks — match what the user sees.
  function lockNameLines(span) {
    const text = (span.textContent || "").trim();
    if (!text) return;
    const words = text.split(/\s+/);
    // Recover the line groups exactly as the browser wrapped them (preview values).
    let lineStrings;
    if (words.length === 1) {
      lineStrings = [text];
    } else {
      // Measured while still display:block (is-locked not applied) so words wrap
      // as normal text and offsetTop reflects the real preview line breaks.
      span.innerHTML = words.map(w => `<span class="nmc-fit-word">${esc(w)}</span>`).join(" ");
      const wordEls = span.querySelectorAll(".nmc-fit-word");
      const lines = [];
      let curTop = null, cur = [];
      wordEls.forEach(w => {
        const top = w.offsetTop;
        if (curTop === null) curTop = top;
        if (Math.abs(top - curTop) > 1) { lines.push(cur); cur = []; curTop = top; }
        cur.push(w.textContent);
      });
      if (cur.length) lines.push(cur);
      lineStrings = lines.map(l => l.join(" "));
    }

    // Pin each line at a fixed top so the printout matches the preview exactly.
    const nameEl = span.closest(".nmc-card-name") || span.parentElement;
    const cs = getComputedStyle(nameEl);
    const fontPx = parseFloat(cs.fontSize) || 16;
    let lineH = parseFloat(cs.lineHeight);
    if (!isFinite(lineH) || lineH <= 0) lineH = fontPx * 1.1;
    const boxH = nameEl.clientHeight;
    const boxW = nameEl.clientWidth;
    const startTop = (boxH - lineStrings.length * lineH) / 2;   // vertically centered
    span.innerHTML = lineStrings.map((l, i) =>
      `<span class="nmc-card-name-line" style="top:${(startTop + i * lineH).toFixed(2)}px">${esc(l)}</span>`
    ).join("");
    span.classList.add("is-locked");
    // Center each line horizontally with a computed left offset — NOT
    // text-align:center, which html2canvas mis-renders (it breaks the text at the
    // "." separators and stacks each piece at the centre → horizontal smear).
    span.querySelectorAll(".nmc-card-name-line").forEach(lineEl => {
      const w = lineEl.offsetWidth;
      lineEl.style.left = Math.max(0, (boxW - w) / 2).toFixed(2) + "px";
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
    let max = isName ? 32 : 34;
    const min = isName ? 8 : 12;
    el.style.fontSize = max + "px";

    // The name text lives in an inner <span> (the line-lock target); measure
    // that span. Position text measures itself.
    const probe = isName ? (el.firstElementChild || el) : el;
    const boxH = el.clientHeight;                    // fixed box the text must fit
    const parent = el.parentElement;
    const parentH = parent ? parent.clientHeight : Infinity;

    let safety = 40;
    while (max > min && safety-- > 0) {
      // Horizontal: text wider than the span's own content box (unbreakable run).
      const tooWide = probe.scrollWidth > probe.clientWidth + 1;
      // Vertical: wrapped text taller than the name box (or the whole card).
      const tooTall = probe.scrollHeight > boxH + 1
                   || probe.scrollHeight > parentH + 1;
      if (!tooWide && !tooTall) break;
      max -= 1;
      el.style.fontSize = max + "px";
    }
  }

  // ── Stat updates ───────────────────────────────────────────
  function updateCounts() {
    const cards = rowCards().length;
    const g = nmcGrid();
    $("rowCount")  && ($("rowCount").textContent  = rows.length);
    $("cardCount") && ($("cardCount").textContent = cards);
    const pages = Math.max(1, Math.ceil(cards / g.perPage));
    $("pageCount") && ($("pageCount").textContent = cards ? pages : 0);
  }

  // ── Card size (กว้าง × สูง) ────────────────────────────────
  function clampCard() {
    cardW = Math.min(A4_W_MM, Math.max(30, cardW));
    cardH = Math.min(A4_H_MM, Math.max(20, cardH));
  }
  function syncNmcSizeInputs() {
    const wi = $("nmcWInput"), hi = $("nmcHInput");
    if (wi && document.activeElement !== wi) wi.value = +(cardW / 10).toFixed(2);
    if (hi && document.activeElement !== hi) hi.value = +(cardH / 10).toFixed(2);
  }
  function updateLayoutTitle() {
    const g = nmcGrid();
    const t = $("nmcLayoutTitle");
    if (t) t.textContent = `👁️ ตัวอย่าง Layout · กระดาษ A4 (${g.perPage} ใบ/หน้า · ${g.cols}×${g.rows})`;
  }
  function afterSizeChange() {
    clampCard();
    updateCounts();
    updateLayoutTitle();
    renderSheets();
  }
  function setNmcW(v) { const n = parseFloat(v); if (!isFinite(n)) return; cardW = n * 10; afterSizeChange(); }
  function setNmcH(v) { const n = parseFloat(v); if (!isFinite(n)) return; cardH = n * 10; afterSizeChange(); }
  function setNmcSize(wCm, hCm) { cardW = wCm * 10; cardH = hCm * 10; afterSizeChange(); syncNmcSizeInputs(); }

  function refreshAll() {
    const has = rows.length > 0;
    $("dataBlock").style.display = has ? "" : "none";
    $("actionsBlock").style.display = has ? "" : "none";
    $("layoutBlock").style.display = has ? "" : "none";
    setStep(has ? 2 : 1);
    syncQtyModeUI();
    syncNmcSizeInputs();
    updateLayoutTitle();
    updateCounts();
    renderPreviewTable();
    renderSheets();
  }

  // Reflect qtyMode in the toolbar button + column header
  function syncQtyModeUI() {
    const btn = $("btnQtyMode");
    if (btn) btn.classList.toggle("active", qtyMode);
    const th = $("thQty");
    if (th) th.style.display = qtyMode ? "" : "none";
  }

  // "กำหนดชุด" toggle — reveal per-person quantity column.
  function toggleQtyMode() {
    qtyMode = !qtyMode;
    if (qtyMode) rows.forEach(r => { if (r.qty == null) r.qty = 1; });
    syncQtyModeUI();
    renderPreviewTable();
    updateCounts();
    renderSheets();
    showToast(qtyMode
      ? 'เปิดกำหนดชุด — ใส่จำนวนใบของแต่ละคนในคอลัมน์ "จำนวน"'
      : "ปิดกำหนดชุด — พิมพ์คนละ 1 ใบ");
  }

  // ── Actions ────────────────────────────────────────────────
  function addRow() {
    rows.push({ name: "", position: "", qty: 1 });
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
    qtyMode = false;
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
    // wait for the autoFit RAF + a paint frame so every sheet is fully laid out.
    renderSheets();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => printSheetsViaIframe(), 150);
    }));
  }

  // Print each A4 sheet on its own page via a CLEAN, isolated iframe.
  // Printing the sheets in-place failed on Edge — the main page's nesting/context
  // swallowed the page-breaks and crammed every sheet onto 1 sheet of paper. A
  // standalone document (just the sheets + minimal CSS) paginates reliably.
  function printSheetsViaIframe() {
    const printArea = $("printArea");
    const sheets = printArea ? printArea.querySelectorAll(".nmc-a4") : [];
    if (!sheets.length) { showToast("ยังไม่มีข้อมูลพิมพ์", "error"); return; }

    const old = document.getElementById("nmcPrintFrame");
    if (old) old.remove();

    const iframe = document.createElement("iframe");
    iframe.id = "nmcPrintFrame";
    iframe.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0;";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const cssAbs = new URL("./namecard-generator.css?v=14", location.href).href;
    // Each sheet wrapped in a plain block → page-break on the wrapper (not the
    // grid element) is the most reliable across browsers.
    const body = Array.from(sheets)
      .map(s => `<div class="print-page">${s.outerHTML}</div>`).join("");

    doc.open();
    doc.write(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<base href="' + location.href + '">' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap">' +
      '<link rel="stylesheet" href="' + cssAbs + '">' +
      '<style>' +
        '@page{size:A4 portrait;margin:0}' +
        'html,body{margin:0;padding:0;background:#fff}' +
        '.print-page{break-after:page;page-break-after:always}' +
        '.print-page:last-child{break-after:auto;page-break-after:auto}' +
        // Neutralise the on-screen scale/negative-margin so each sheet is a real A4
        '.nmc-a4{transform:none!important;margin:0 auto!important;width:210mm!important;' +
          'height:auto!important;box-shadow:none!important;--nmc-zoom:1!important}' +
        '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
      '</style></head><body>' + body + '</body></html>'
    );
    doc.close();

    const win = iframe.contentWindow;
    const doPrint = () => {
      try { win.focus(); win.print(); } catch (e) { console.error(e); }
      setTimeout(() => iframe.remove(), 1500);
    };
    // Wait for the iframe's fonts + images before printing so nothing reflows.
    const fontsReady = (doc.fonts && doc.fonts.ready) ? doc.fonts.ready : Promise.resolve();
    fontsReady.then(() => setTimeout(doPrint, 450)).catch(() => setTimeout(doPrint, 650));
  }

  // ── Export PDF (via html2canvas + jsPDF) ──────────────────
  // ⚠️ LEGACY / UNUSED for the ป้ายชื่อ tab — no button calls this anymore.
  // html2canvas's text engine smeared long dotted names (e.g. "ASSOC.PROF.DR.VIPUT"),
  // so namecard printing moved to printSheetsViaIframe() (native print, clean iframe).
  // Kept only as reference; the custom/cert tabs still use their OWN html2canvas
  // exporters (short labels → no smear). Do NOT wire this back to the namecard button.
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
      // Make sure the Sarabun web font is loaded BEFORE measuring/capturing.
      // autoFit sizes names against the real font, and html2canvas clones the
      // page into an iframe — if the font isn't ready it falls back to a wider
      // font, the name re-wraps to extra lines, and the lines overlap.
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) {}
      }
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
          showToast(`เปิดตัวอย่าง PDF (${sheets.length} หน้า · ${rowCards().length} ใบ)`);
        }
      } else {
        // Print: save the PDF file (เหมือนเดิม)
        updateProcessing("กำลังบันทึกไฟล์...");
        pdf.save(`namecards-${stamp}.pdf`);
        showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${rowCards().length} ใบ)`);
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
  // TAB SWITCHING
  // ════════════════════════════════════════════════════════════
  const TOOL_TITLES = {
    namecard: "🪪 ป้ายชื่อ",
    custom:   "🎫 ป้ายกำหนดเอง",
    cert:     "🏆 ใบประกาศนียบัตร",
  };

  // Landing view: show the tool-picker cards, hide every tool pane.
  function showPicker() {
    activeTab = null;
    $("toolPicker") && ($("toolPicker").style.display = "");
    $("toolBack")   && ($("toolBack").style.display   = "none");
    ["paneNamecard", "paneCustom", "paneCert"].forEach(id => {
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
    $("paneCustom").style.display   = tab === "custom"   ? "" : "none";
    $("paneCert").style.display     = tab === "cert"     ? "" : "none";
    // Template-download button is namecard-specific
    const btnT = $("btnTemplate");
    if (btnT) btnT.style.display = tab === "namecard" ? "" : "none";

    if (tab === "cert")   renderCertSheets();
    if (tab === "custom") { renderCustomSheets(); refreshCLogos(); }
  }

  // ════════════════════════════════════════════════════════════
  // CUSTOM TAB (merged: VIP + Badge/logo + Seat-sequence)
  // ════════════════════════════════════════════════════════════
  // Mode "repeat"   → logo (optional) + text, repeated × quantity
  // Mode "sequence" → auto labels (A1, A2…) from Row × Column
  // Shared: card size (mm), orientation, zoom, export PDF.

  // ── Logo library (shared bucket · same as before) ─────────
  function cLogoPublicUrl(path) {
    if (!path || !SB_URL) return null;
    return `${SB_URL}/storage/v1/object/public/${C_LOGO_BUCKET}/${encodeURIComponent(path)}`;
  }
  async function listCLogos() {
    if (!SB_URL) return [];
    const res = await fetch(`${SB_URL}/storage/v1/object/list/${C_LOGO_BUCKET}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 200, sortBy: { column: "created_at", order: "desc" } }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[c-logos list]", res.status, t);
      throw new Error("HTTP " + res.status);
    }
    const data = await res.json().catch(() => []);
    return (Array.isArray(data) ? data : [])
      .filter(o => o && o.name && o.id)
      .map(o => ({ path: o.name, url: cLogoPublicUrl(o.name) }));
  }
  // Resize logo: keep egress small, preserve transparency (PNG/WebP → PNG).
  function resizeLogo(file) {
    return new Promise((resolve, reject) => {
      if (file.type === "image/svg+xml") { resolve({ blob: file, ext: "svg" }); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 600;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) { const s = Math.min(MAX / w, MAX / h); w = Math.round(w * s); h = Math.round(h * s); }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const keepAlpha = /png|webp/.test(file.type);
        const mime = keepAlpha ? "image/png" : "image/jpeg";
        const ext  = keepAlpha ? "png" : "jpg";
        canvas.toBlob(b => b ? resolve({ blob: b, ext }) : reject(new Error("แปลงรูปไม่สำเร็จ")), mime, keepAlpha ? undefined : 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านไฟล์ภาพไม่สำเร็จ")); };
      img.src = url;
    });
  }
  function cSafeName(filename) {
    const base = String(filename || "logo").replace(/\.[^.]+$/, "");
    const clean = base.replace(/[<>:"\/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, "-").slice(0, 40);
    return clean || "logo";
  }
  async function uploadCLogo(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error("รับเฉพาะไฟล์ภาพ");
    const { blob, ext } = await resizeLogo(file);
    const path = `${Date.now()}-${cSafeName(file.name)}.${ext}`;
    const res = await fetch(`${SB_URL}/storage/v1/object/${C_LOGO_BUCKET}/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": blob.type || "image/png", "x-upsert": "true", "cache-control": "max-age=31536000",
      },
      body: blob,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[c-logo upload]", res.status, txt);
      if (res.status === 404 || res.status === 405) throw new Error(`ยังไม่ได้สร้าง bucket "badge-logos" — รัน sql/134_badge_logos_bucket.sql ใน Supabase`);
      if (res.status === 403) throw new Error("Permission denied — เช็ค RLS policy (รัน sql/134 ใหม่)");
      if (res.status === 413) throw new Error("ไฟล์ใหญ่เกิน 10 MB");
      throw new Error(`HTTP ${res.status} · ${txt.slice(0, 120)}`);
    }
    return path;
  }
  async function deleteCLogo(path) {
    const res = await fetch(`${SB_URL}/storage/v1/object/${C_LOGO_BUCKET}/${encodeURIComponent(path)}`, {
      method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok && res.status !== 404) { const t = await res.text().catch(() => ""); throw new Error(`${res.status} ${t.slice(0, 100)}`); }
  }

  // Currently-selected logo URL · "__company__" → company logo · null → none
  function cCurrentLogoUrl() {
    if (cLogoKey === C_COMPANY_KEY) return logoPath();
    if (cLogoKey) return cLogoPublicUrl(cLogoKey);
    return null;
  }

  // ── Logo library UI ───────────────────────────────────────
  async function refreshCLogos() {
    const grid = $("cLogoGrid");
    if (grid && !cLogos.length) grid.innerHTML = `<div class="badge-logo-empty">⏳ กำลังโหลดโลโก้...</div>`;
    try { cLogos = await listCLogos(); }
    catch (err) { cLogos = []; renderCLogoGrid(); return; }
    if (cLogoKey && cLogoKey !== C_COMPANY_KEY && !cLogos.some(l => l.path === cLogoKey)) cLogoKey = C_COMPANY_KEY;
    renderCLogoGrid();
  }
  function renderCLogoGrid() {
    const grid = $("cLogoGrid");
    if (!grid) return;
    const companyUrl = logoPath();
    let html = "";
    // built-in: company logo
    html += `<div class="badge-logo-item ${cLogoKey === C_COMPANY_KEY ? "selected" : ""}" data-key="${C_COMPANY_KEY}" title="โลโก้บริษัท (จากตั้งค่าบริษัท)">
      <span class="badge-logo-check">✓</span><img src="${esc(companyUrl)}" alt="" crossorigin="anonymous"><span class="c-logo-tag">บริษัท</span></div>`;
    // built-in: no logo
    html += `<div class="badge-logo-item c-logo-none ${cLogoKey === null ? "selected" : ""}" data-key="__none__" title="ไม่มีโลโก้">
      <span class="badge-logo-check">✓</span><span class="c-logo-none-x">∅</span><span class="c-logo-tag">ไม่มี</span></div>`;
    // uploaded logos
    html += cLogos.map(l => `<div class="badge-logo-item ${l.path === cLogoKey ? "selected" : ""}" data-key="${esc(l.path)}" title="${esc(l.path)}">
      <span class="badge-logo-check">✓</span><img src="${esc(l.url)}" alt="" loading="lazy" crossorigin="anonymous">
      <button class="badge-logo-del" data-path="${esc(l.path)}" title="ลบโลโก้นี้">✕</button></div>`).join("");
    grid.innerHTML = html;
    grid.querySelectorAll(".badge-logo-item").forEach(el => {
      el.addEventListener("click", (e) => { if (e.target.closest(".badge-logo-del")) return; selectCLogo(el.dataset.key); });
    });
    grid.querySelectorAll(".badge-logo-del").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); removeCLogo(btn.dataset.path); });
    });
  }
  function selectCLogo(key) {
    if (key === "__none__") cLogoKey = null;
    else cLogoKey = key;                       // "__company__" or a path
    renderCLogoGrid();
    renderCustomSheets();
  }
  async function onCLogoPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    let lastPath = null, ok = 0;
    for (const f of files) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      try { showToast(`⏳ กำลังอัปโหลด ${f.name} (${sizeMB} MB)...`); lastPath = await uploadCLogo(f); ok++; }
      catch (err) { showToast("อัปโหลดล้มเหลว — " + err.message, "error"); }
    }
    if (ok) {
      await refreshCLogos();
      if (lastPath && cLogos.some(l => l.path === lastPath)) cLogoKey = lastPath;
      renderCLogoGrid();
      renderCustomSheets();
      showToast(`✓ อัปโหลดโลโก้สำเร็จ (${ok} รูป)`);
    }
  }
  async function removeCLogo(path) {
    const ok = await ConfirmModal.open({ title: "ลบโลโก้?", message: "จะลบโลโก้นี้ออกจาก Supabase Storage (ทุกเครื่อง)", icon: "🗑", tone: "danger", okText: "ลบ" });
    if (!ok) return;
    try {
      await deleteCLogo(path);
      if (cLogoKey === path) cLogoKey = C_COMPANY_KEY;
      await refreshCLogos();
      renderCustomSheets();
      showToast("✓ ลบโลโก้สำเร็จ");
    } catch (err) { showToast("ลบไม่สำเร็จ — " + err.message, "error"); }
  }

  // ── Sequence labels (Row × Column) ────────────────────────
  function expandTokens(input) {
    const out = [];
    String(input == null ? "" : input).split(/[,\s]+/).forEach(tokRaw => {
      const tok = tokRaw.trim();
      if (!tok) return;
      const m = tok.match(/^(.+?)-(.+)$/);
      if (m) {
        const a = m[1].trim(), b = m[2].trim();
        if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
          let s = +a, e = +b, step = s <= e ? 1 : -1;
          for (let i = s; step > 0 ? i <= e : i >= e; i += step) out.push(String(i));
          return;
        }
        if (/^[A-Za-z]$/.test(a) && /^[A-Za-z]$/.test(b)) {
          let s = a.toUpperCase().charCodeAt(0), e = b.toUpperCase().charCodeAt(0), step = s <= e ? 1 : -1;
          for (let i = s; step > 0 ? i <= e : i >= e; i += step) out.push(String.fromCharCode(i));
          return;
        }
      }
      out.push(tok);
    });
    return out;
  }
  function buildSeqLabels() {
    const rs = expandTokens(cRowInput);
    const cs = expandTokens(cColInput);
    if (!rs.length && !cs.length) return [];
    const rows = rs.length ? rs : [""];
    const cols = cs.length ? cs : [""];
    const base = [];
    for (const r of rows) for (const c of cols) { const sep = (r && c) ? cSep : ""; base.push(r + sep + c); }
    const sets = Math.max(1, cSeqSets | 0);
    if (sets <= 1) return base;
    const out = [];
    for (let s = 0; s < sets; s++) out.push(...base);   // repeat the whole sequence ×N (จำนวนชุด)
    return out;
  }

  // ── Grid (size-based · orientation-aware) ─────────────────
  function cGrid() {
    const land = cOrient === "landscape";
    const pw = land ? A4_H_MM : A4_W_MM;
    const ph = land ? A4_W_MM : A4_H_MM;
    const cols = Math.max(1, Math.floor(pw / cW));
    const rows = Math.max(1, Math.floor(ph / cH));
    return { cols, rows, perPage: cols * rows, pw, ph };
  }
  // Best-fit grid for exactly N cards/sheet → derive card size (cw×ch closest to square).
  function bestFitGrid(n) {
    const N = Math.max(1, n | 0);
    const land = cOrient === "landscape";
    const pw = land ? A4_H_MM : A4_W_MM;
    const ph = land ? A4_W_MM : A4_H_MM;
    let best = null;
    for (let cols = 1; cols <= N; cols++) {
      if (N % cols) continue;
      const rows = N / cols;
      const cw = pw / cols, ch = ph / rows;
      const score = Math.abs(Math.log(cw / ch));   // 0 = perfectly square
      if (!best || score < best.score) best = { cols, rows, cw, ch, score };
    }
    return best;
  }
  // Page dimensions (mm) for the current orientation
  function cPageDims() {
    const land = cOrient === "landscape";
    return { pw: land ? A4_H_MM : A4_W_MM, ph: land ? A4_W_MM : A4_H_MM };
  }
  // Card must never exceed the page → clamp w/h to page dims (keeps min 3×2 cm)
  function clampCardToPage() {
    const { pw, ph } = cPageDims();
    cW = Math.min(pw, Math.max(30, cW));
    cH = Math.min(ph, Math.max(20, cH));
  }
  function applyCVars(el, g) {
    el.style.setProperty("--c-w", cW + "mm");
    el.style.setProperty("--c-h", cH + "mm");
    el.style.setProperty("--c-cols", g.cols);
    el.style.setProperty("--c-rows", g.rows);
    el.style.setProperty("--c-pw", g.pw + "mm");
    el.style.setProperty("--c-ph", g.ph + "mm");
    el.style.setProperty("--nmc-zoom", cZoom);
  }

  // ── Card HTML ─────────────────────────────────────────────
  function cCardHtml(label) {
    const url = cCurrentLogoUrl();
    const fixed = cLogoSize > 0;
    const imgSz = fixed ? ` style="max-height:${cLogoSize}px;max-width:${cLogoSize}px"` : "";
    const txtSz = cTextSize > 0 ? ` style="font-size:${cTextSize}px"` : "";   // px overrides auto-fit
    const text = esc(formatName(cText));
    const vaCls = " c-va-" + cVAlign;   // vertical align of content (top/center/bottom · flex column variants)

    // Sequence WITH a number: logo + name header above the big auto number.
    // No number (header-only, e.g. no Row/Col) → fall through to the plain card
    // so the logo/name autofit exactly like repeat mode.
    if (cMode === "sequence" && String(label) !== "") {
      const headH = fixed ? ` style="height:${cLogoSize}px"` : "";   // px controls header logo height
      const logoEl = url
        ? `<div class="c-seq-logo"${headH}><img src="${esc(url)}" alt="" crossorigin="anonymous" onerror="this.style.display='none'"></div>`
        : "";
      const nameEl = text ? `<div class="c-seq-name"${txtSz}>${text}</div>` : "";
      const hasHead = !!(url || text);
      const head = hasHead ? `<div class="c-seq-head">${logoEl}${nameEl}</div>` : "";
      const numSz = cNumSize > 0 ? ` style="font-size:${cNumSize}px"` : "";   // px overrides auto-fit
      const numEl = `<div class="c-seq-numwrap"><div class="c-seq-num"${numSz}>${esc(label)}</div></div>`;
      return `<div class="c-card c-seq${hasHead ? " c-seq--head" : ""}${vaCls}">${head}${numEl}</div>`;
    }

    const logoCls = fixed ? "c-logo c-logo--fixed" : "c-logo";
    // No logo → emit nothing (the old is-empty placeholder reserved 18% at the
    // top and broke vertical-align by pushing the name down).
    const logo = url
      ? `<div class="${logoCls}"><img src="${esc(url)}" alt=""${imgSz} crossorigin="anonymous" onerror="this.style.display='none'"></div>`
      : "";
    if (cStyle === "vip") {
      return `<div class="c-card c-vip">${logo}<div class="c-band"><div class="c-band-text"${txtSz}>${text}</div></div></div>`;
    }
    return `<div class="c-card c-plain${vaCls}">${logo}${text ? `<div class="c-name"${txtSz}>${text}</div>` : ""}</div>`;
  }
  function cBlank() { return `<div class="c-card" style="visibility:hidden"></div>`; }
  function cPageHtml(cells) { return `<div class="c-a4-wrap"><div class="c-a4">${cells}</div></div>`; }

  // ── Font fitting ──────────────────────────────────────────
  // True rendered width of an element's contents, in the element's OWN (unscaled)
  // coordinate space. scrollWidth is UNRELIABLE for centered text (centered
  // overflow spills both sides equally and never grows scrollWidth past
  // clientWidth → the fit never shrinks → ตกขอบ). A Range measures the real glyph
  // box even when it overflows; we then divide out any transform:scale() ancestor
  // (the preview zoom) so it compares against unscaled clientWidth/clientHeight.
  function textW(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    const w  = r.getBoundingClientRect().width;     // scaled (visual) width
    const cw = el.clientWidth;                        // unscaled layout width
    const bw = el.getBoundingClientRect().width;      // scaled box width
    const scale = (bw > 0 && cw > 0) ? bw / cw : 1;   // = preview zoom factor
    return scale > 0 ? w / scale : w;                 // → unscaled
  }
  // `cap` (px) = the user's explicit size: honored when it fits, but the shrink
  // loop still runs so text never spills past the card edge (ตกขอบ). cap = 0/undefined
  // → auto-fill (start large and shrink to fit).
  function fitSeqText(el, cap) {
    const box = el.parentElement; if (!box) return;
    const maxW = box.clientWidth - 8, maxH = box.clientHeight - 8;
    if (maxW <= 0 || maxH <= 0) return;
    let size = cap > 0 ? cap : Math.min(maxH, 800); el.style.fontSize = size + "px";
    let guard = 220;
    while (size > 8 && guard-- > 0 && (textW(el) > maxW || el.scrollHeight > maxH)) { size -= 2; el.style.fontSize = size + "px"; }
  }
  // Sequence header name (e.g. "VIP") — scale up to fit the header width so it
  // stays balanced with the big auto number, capped so the logo keeps its share.
  function fitSeqName(el, cap) {
    const head = el.parentElement; if (!head) return;
    const card = el.closest(".c-card"); if (!card) return;
    const hasLogo = !!head.querySelector(".c-seq-logo");
    const maxW = head.clientWidth - 6;
    // With a logo → keep the name small so the logo owns the header zone.
    // No logo → the name fills the whole header zone, balancing the number.
    const maxH = hasLogo ? card.clientHeight * 0.10 : Math.max(20, head.clientHeight - 4);
    if (maxW <= 0 || maxH <= 0) return;
    let size = cap > 0 ? cap : Math.min(maxH, 400); el.style.fontSize = size + "px";
    let guard = 400;
    while (size > 6 && guard-- > 0 && (textW(el) > maxW || el.scrollHeight > maxH)) { size -= 1; el.style.fontSize = size + "px"; }
  }
  function fitBandText(el, cap) {
    const band = el.parentElement; if (!band) return;
    const maxW = band.clientWidth - 14, maxH = band.clientHeight - 8;
    if (maxW <= 0 || maxH <= 0) return;
    let size = cap > 0 ? cap : Math.min(maxH, 400); el.style.fontSize = size + "px";
    let guard = 160;
    while (size > 8 && guard-- > 0 && (textW(el) > maxW || el.scrollHeight > maxH)) { size -= 2; el.style.fontSize = size + "px"; }
  }
  function fitNameText(el, cap) {
    const card = el.closest(".c-card"); if (!card) return;
    const logo = card.querySelector(".c-logo");
    // Vertical room = card content box (clientHeight already excludes the border,
    // subtract the .c-plain padding) minus the logo's real footprint. Use UNSCALED
    // layout metrics (offsetHeight/clientHeight, not gBCR) so the preview's
    // transform:scale() doesn't skew the reserve.
    const cs = getComputedStyle(card);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const contentH = Math.max(0, card.clientHeight - padY);
    let logoFoot = 0;
    if (logo && !logo.classList.contains("is-empty")) {
      let logoH = logo.offsetHeight;                              // unscaled layout height
      if (logoH < 4) logoH = card.clientHeight * 0.40;           // img not decoded yet → reserve
      logoFoot = logoH + (parseFloat(getComputedStyle(logo).marginBottom) || 0);
    }
    // Width: shrink when the real (Range-measured) glyph width exceeds the name
    // box minus a breathing margin. Safe because textW() shrinks with font-size,
    // unlike scrollWidth which floors at the width:100% box width.
    const boxW = el.clientWidth;
    const maxW = boxW - 12;
    // Height: fill ~90% so vertical-align has room to nudge short text between
    // top / center / bottom without the descenders kissing the card edge.
    const maxH = Math.max(16, (contentH - logoFoot) * 0.90);
    if (maxW <= 0) return;
    // Start at the user's px (when given) or large to fill the card, then shrink
    // to fit so long text (e.g. "Interpreter") never spills past the card edge.
    let size = cap > 0 ? cap : Math.min(maxH, 800); el.style.fontSize = size + "px";
    let guard = 400;
    while (size > 8 && guard-- > 0 && (textW(el) > maxW || el.scrollHeight > maxH + 1)) { size -= 2; el.style.fontSize = size + "px"; }
  }
  function widestLabel(items) {
    if (!items || !items.length) return "";
    const c = widestLabel._c || (widestLabel._c = document.createElement("canvas"));
    const ctx = c.getContext("2d"); ctx.font = '900 100px "Sarabun", sans-serif';
    let best = items[0], bw = -1;
    for (const s of items) { const w = ctx.measureText(s).width; if (w > bw) { bw = w; best = s; } }
    return best;
  }
  function computeSeqFontSize(container, g, widest, cap) {
    if (!widest) return null;
    const probe = document.createElement("div");
    probe.className = "c-a4-wrap";
    probe.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden";
    // Use the real card markup so the header (logo + name) reserves space too
    probe.innerHTML = `<div class="c-a4">${cCardHtml(widest)}</div>`;
    applyCVars(probe, g);
    container.appendChild(probe);
    const el = probe.querySelector(".c-seq-num"); fitSeqText(el, cap); const size = el.style.fontSize;
    probe.remove();
    return size;
  }
  // Apply the right fit pass to every card under root. Explicit px sizes are passed
  // as a `cap` (honored when they fit, shrunk only to stop text spilling the card).
  function fitCustom(root, g, items) {
    const nameCap = cTextSize > 0 ? cTextSize : 0;
    if (cMode === "sequence") {
      // Header-only sequence (no Row/Col) renders as plain cards → fit the name
      // like repeat mode. Numbered sequence → scale the header name to balance
      // the number. Either way an explicit px is capped, not blindly trusted.
      root.querySelectorAll(".c-name").forEach(el => fitNameText(el, nameCap));
      root.querySelectorAll(".c-seq-name").forEach(el => fitSeqName(el, nameCap));
      const size = computeSeqFontSize(root, g, widestLabel(items), cNumSize > 0 ? cNumSize : 0);
      if (size) root.querySelectorAll(".c-seq-num").forEach(el => { el.style.fontSize = size; });
    } else if (cStyle === "vip") {
      root.querySelectorAll(".c-band-text").forEach(el => fitBandText(el, nameCap));
    } else {
      root.querySelectorAll(".c-name").forEach(el => fitNameText(el, nameCap));
    }
  }

  // ── Render preview (capped for huge sequence sets) ────────
  const C_PREVIEW_MAX = 12;
  function customItems() {
    if (cMode === "sequence") {
      const it = buildSeqLabels();
      // header-only (no Row/Col) → still show one card per set with just the header/logo
      if (!it.length && (formatName(cText).trim() || cCurrentLogoUrl())) {
        const sets = Math.max(1, cSeqSets | 0);
        return { items: Array(sets).fill(""), total: sets };
      }
      return { items: it, total: it.length };
    }
    return { items: null, total: Math.max(0, cQty | 0) };
  }
  function renderCustomSheets() {
    const scroller = $("cSheetScroller");
    const printArea = $("customPrintArea");
    if (!scroller) return;

    clampCardToPage();   // defensive: never let a card exceed the page (e.g. portrait size kept after flipping to landscape)
    const ae = document.activeElement;   // reflect clamp in the size inputs, but don't fight active typing
    if (ae !== $("cWInput") && ae !== $("cHInput")) syncCInputs();
    const g = cGrid();
    const { items, total } = customItems();
    const pageCount = Math.max(1, Math.ceil(total / g.perPage));

    $("cTotal")     && ($("cTotal").textContent     = total);
    $("cPageCount") && ($("cPageCount").textContent = total ? pageCount : 0);
    $("cGridDesc")  && ($("cGridDesc").textContent  = `${g.cols} × ${g.rows} (${g.perPage} ใบ/หน้า)`);
    const ppInp = $("cPerPageInput");
    if (ppInp && document.activeElement !== ppInp) ppInp.value = g.perPage;
    $("cCardSize")  && ($("cCardSize").textContent  = `${(cW / 10).toFixed(1)} × ${(cH / 10).toFixed(1)} ซม.`);
    $("cLayoutTitle") && ($("cLayoutTitle").textContent =
      `👁️ ตัวอย่าง Layout · A4 ${cOrient === "landscape" ? "แนวนอน" : "แนวตั้ง"} (${g.perPage} ใบ/หน้า · ${g.cols}×${g.rows})`);

    if (printArea) printArea.innerHTML = "";   // built lazily at export
    if (!total) { scroller.innerHTML = ""; return; }

    const shown = Math.min(pageCount, C_PREVIEW_MAX);
    let html = "";
    for (let p = 0; p < shown; p++) {
      const cells = [];
      for (let i = 0; i < g.perPage; i++) {
        const idx = p * g.perPage + i;
        cells.push(idx < total ? cCardHtml(items ? items[idx] : "") : cBlank());
      }
      html += `<div class="vip-page-item"><div class="vip-page-label">📄 หน้า ${p + 1} / ${pageCount}</div>${cPageHtml(cells.join(""))}</div>`;
    }
    if (pageCount > C_PREVIEW_MAX) {
      html += `<div class="seat-more-note">… แสดงตัวอย่าง ${C_PREVIEW_MAX} หน้าแรก · กด Preview / Print เพื่อดูครบทั้ง ${pageCount} หน้า</div>`;
    }
    scroller.innerHTML = html;
    scroller.querySelectorAll(".c-a4-wrap").forEach(el => applyCVars(el, g));
    requestAnimationFrame(() => fitCustom(scroller, g, items));
    // Logos load async → re-fit once any image decodes so name sizing uses the
    // real logo height (deduped to a single pass via rAF).
    let refitQueued = false;
    scroller.querySelectorAll(".c-card img").forEach(img => {
      if (img.complete) return;
      img.addEventListener("load", () => {
        if (refitQueued) return;
        refitQueued = true;
        requestAnimationFrame(() => { refitQueued = false; fitCustom(scroller, g, items); });
      }, { once: true });
    });
  }

  // ── Setters ───────────────────────────────────────────────
  function setCMode(m) {
    cMode = (m === "sequence") ? "sequence" : "repeat";
    $("cModeRepeat") && $("cModeRepeat").classList.toggle("active", cMode === "repeat");
    $("cModeSeq")    && $("cModeSeq").classList.toggle("active", cMode === "sequence");
    $("cRepeatBox")  && ($("cRepeatBox").style.display = cMode === "repeat" ? "" : "none");
    $("cSeqBox")     && ($("cSeqBox").style.display    = cMode === "sequence" ? "" : "none");
    renderCustomSheets();
  }
  function setCText(v)  { cText = String(v == null ? "" : v); renderCustomSheets(); }
  function setCLogoSize(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 400) n = 400;
    cLogoSize = n;
    renderCustomSheets();
  }
  function setCTextSize(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 400) n = 400;
    cTextSize = n;
    renderCustomSheets();
  }
  function setCStyle(s) {
    cStyle = (s === "vip") ? "vip" : "plain";
    const cb = $("cStyleVip");          // toggle: checked = green band on (vip)
    if (cb && cb.checked !== (cStyle === "vip")) cb.checked = (cStyle === "vip");
    renderCustomSheets();
  }
  function setCQty(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 500) n = 500;
    cQty = n;
    const inp = $("cQtyInput"); if (inp && inp.value !== String(n)) inp.value = n;
    renderCustomSheets();
  }
  function bumpCQty(d) { setCQty(cQty + d); }
  function setCRow(v) { cRowInput = String(v == null ? "" : v); renderCustomSheets(); }
  function setCCol(v) { cColInput = String(v == null ? "" : v); renderCustomSheets(); }
  function setCSep(v) { cSep      = String(v == null ? "" : v); renderCustomSheets(); }
  function setCNumSize(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 800) n = 800;
    cNumSize = n;
    renderCustomSheets();
  }
  function setCSeqSets(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 200) n = 200;
    cSeqSets = n;
    const inp = $("cSeqSetsInput"); if (inp && inp.value !== String(n)) inp.value = n;
    renderCustomSheets();
  }
  function bumpCSeqSets(d) { setCSeqSets(cSeqSets + d); }
  function setCW(v) { const n = parseFloat(v); if (!isFinite(n)) return; cW = n * 10; clampCardToPage(); renderCustomSheets(); }
  function setCH(v) { const n = parseFloat(v); if (!isFinite(n)) return; cH = n * 10; clampCardToPage(); renderCustomSheets(); }
  function setCSize(wCm, hCm) {
    cW = wCm * 10;
    cH = hCm * 10;
    clampCardToPage();
    syncCInputs(); renderCustomSheets();
  }
  // Set how many cards fit on one A4 → derives card size (best-fit) + syncs size inputs.
  function setCPerPage(v) {
    let n = parseInt(v, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 60) n = 60;
    const g = bestFitGrid(n);
    cW = g.cw; cH = g.ch;
    syncCInputs();
    renderCustomSheets();
  }
  function bumpCPerPage(d) { setCPerPage(cGrid().perPage + d); }
  function syncCInputs() {
    const wi = $("cWInput"), hi = $("cHInput");
    if (wi) wi.value = +(cW / 10).toFixed(2);
    if (hi) hi.value = +(cH / 10).toFixed(2);
  }
  function setCOrient(o) {
    cOrient = (o === "landscape") ? "landscape" : "portrait";
    $("cOrientPortrait")  && $("cOrientPortrait").classList.toggle("active", cOrient === "portrait");
    $("cOrientLandscape") && $("cOrientLandscape").classList.toggle("active", cOrient === "landscape");
    clampCardToPage(); syncCInputs();   // card must fit the new page → shrink if it now exceeds it
    renderCustomSheets();
  }
  function setCVAlign(v) {
    cVAlign = (v === "top" || v === "bottom") ? v : "center";
    $("cVAlignTop")    && $("cVAlignTop").classList.toggle("active",    cVAlign === "top");
    $("cVAlignCenter") && $("cVAlignCenter").classList.toggle("active", cVAlign === "center");
    $("cVAlignBottom") && $("cVAlignBottom").classList.toggle("active", cVAlign === "bottom");
    renderCustomSheets();
  }
  function setCZoom(dir) {
    const steps = [0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1.0];
    let i = steps.indexOf(cZoom);
    if (i < 0) i = 3;
    i = Math.max(0, Math.min(steps.length - 1, i + dir));
    cZoom = steps[i];
    $("cZoomLabel") && ($("cZoomLabel").textContent = Math.round(cZoom * 100) + "%");
    document.querySelectorAll("#cSheetScroller .c-a4-wrap").forEach(el => el.style.setProperty("--nmc-zoom", cZoom));
  }
  async function clearCustom() {
    const ok = await ConfirmModal.open({ title: "ล้างค่า?", message: "จะล้างค่าที่กรอกในเครื่องมือนี้", icon: "↺", tone: "warning", okText: "ล้าง" });
    if (!ok) return;
    if (cMode === "sequence") {
      cRowInput = ""; cColInput = ""; cSep = ""; cNumSize = 0; cSeqSets = 1;
      const r = $("cRowInput"); if (r) r.value = "";
      const c = $("cColInput"); if (c) c.value = "";
      const s = $("cSepInput"); if (s) s.value = "";
      const ns = $("cNumSizeInput"); if (ns) ns.value = "";
      const ss = $("cSeqSetsInput"); if (ss) ss.value = "1";
    } else {
      cText = ""; cQty = 0;
      const t = $("cTextInput"); if (t) t.value = "";
      const q = $("cQtyInput");  if (q) q.value = 0;
    }
    renderCustomSheets();
  }

  // Print the custom-tab sheets via a clean isolated iframe (native engine) —
  // same fix as the namecard tab. html2canvas mis-sized/clipped the big sequence
  // numbers; the browser's own renderer matches the on-screen preview exactly.
  // Handles BOTH orientations (custom tab can be portrait or landscape).
  async function printCustomViaIframe() {
    const g = cGrid();
    const { items, total } = customItems();
    if (!total) { showToast("ยังไม่มีการ์ด — กรอกข้อมูลก่อน", "error"); return; }
    if (cMode === "repeat" && !cCurrentLogoUrl() && !cText.trim()) {
      showToast("เลือกโลโก้ หรือ ใส่ข้อความก่อน", "error"); return;
    }
    showProcessing("กำลังเตรียมพิมพ์...", "จัดหน้า");
    try {
      // Build every page in the off-screen print area + fit the text (same as the
      // old html2canvas path) so the sequence numbers are sized correctly.
      const printArea = $("customPrintArea");
      const pageCount = Math.max(1, Math.ceil(total / g.perPage));
      let html = "";
      for (let p = 0; p < pageCount; p++) {
        const cells = [];
        for (let i = 0; i < g.perPage; i++) {
          const idx = p * g.perPage + i;
          cells.push(idx < total ? cCardHtml(items ? items[idx] : "") : cBlank());
        }
        html += cPageHtml(cells.join(""));
      }
      printArea.innerHTML = html;
      printArea.querySelectorAll(".c-a4-wrap").forEach(el => applyCVars(el, g));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      fitCustom(printArea, g, items);
      await new Promise(r => setTimeout(r, 80));

      const sheets = printArea.querySelectorAll(".c-a4");
      // The size vars live on the .c-a4-wrap; copy them onto each .c-a4 so they
      // survive cloning (we clone the sheet, not the wrapper).
      sheets.forEach(s => applyCVars(s, g));
      if (!sheets.length) { showToast("ยังไม่มีข้อมูลพิมพ์", "error"); return; }

      const landscape = cOrient === "landscape";
      const pw = landscape ? "297mm" : "210mm";
      const ph = landscape ? "210mm" : "297mm";

      const old = document.getElementById("nmcPrintFrame");
      if (old) old.remove();
      const iframe = document.createElement("iframe");
      iframe.id = "nmcPrintFrame";
      iframe.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0;";
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const cssAbs = new URL("./namecard-generator.css?v=14", location.href).href;
      const bodyHtml = Array.from(sheets)
        .map(s => `<div class="print-page">${s.outerHTML}</div>`).join("");
      doc.open();
      doc.write(
        '<!doctype html><html><head><meta charset="utf-8">' +
        '<base href="' + location.href + '">' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap">' +
        '<link rel="stylesheet" href="' + cssAbs + '">' +
        '<style>' +
          '@page{size:A4 ' + (landscape ? 'landscape' : 'portrait') + ';margin:0}' +
          'html,body{margin:0;padding:0;background:#fff}' +
          '.print-page{break-after:page;page-break-after:always}' +
          '.print-page:last-child{break-after:auto;page-break-after:auto}' +
          // Each sheet = a real A4 page (cards fill it exactly) · overflow:hidden
          // clips sub-pixel overflow so it never spills onto an extra blank page.
          '.c-a4{position:static!important;transform:none!important;margin:0!important;' +
            'width:' + pw + '!important;height:' + ph + '!important;overflow:hidden!important;' +
            'box-shadow:none!important;--nmc-zoom:1!important}' +
          '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '</style></head><body>' + bodyHtml + '</body></html>'
      );
      doc.close();
      const win = iframe.contentWindow;
      const doPrint = () => {
        try { win.focus(); win.print(); } catch (e) { console.error(e); }
        setTimeout(() => iframe.remove(), 1500);
      };
      const fontsReady = (doc.fonts && doc.fonts.ready) ? doc.fonts.ready : Promise.resolve();
      fontsReady.then(() => setTimeout(doPrint, 450)).catch(() => setTimeout(doPrint, 650));
    } catch (err) {
      console.error(err);
      showToast("เตรียมพิมพ์ไม่สำเร็จ — " + err.message, "error");
    } finally {
      hideProcessing();
      // Free the (possibly huge) DOM after the clone is captured.
      setTimeout(() => { const pa = $("customPrintArea"); if (pa) pa.innerHTML = ""; }, 2500);
    }
  }

  // ── Export PDF (open = preview tab · save = download) ──────
  // ⚠️ LEGACY for the custom tab — button now calls printCustomViaIframe().
  // Kept for reference (html2canvas path). Do NOT rewire to the custom Print button.
  async function exportCustomPDF(mode = "save") {
    const g = cGrid();
    const { items, total } = customItems();
    if (!total) { showToast("ยังไม่มีการ์ด — กรอกข้อมูลก่อน", "error"); return; }
    if (cMode === "repeat" && !cCurrentLogoUrl() && !cText.trim()) {
      showToast("เลือกโลโก้ หรือ ใส่ข้อความก่อน", "error"); return;
    }
    if (!window.html2canvas || !window.jspdf) { showToast("ไลบรารี PDF ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "error"); return; }

    const btnP = $("btnCustomPreview"), btnX = $("btnExportCustomPDF");
    const busy = mode === "open" ? btnP : btnX;
    const orig = busy ? busy.textContent : "";
    [btnP, btnX].forEach(b => b && (b.disabled = true));
    if (busy) busy.textContent = "⏳ กำลังสร้าง PDF...";
    showProcessing("กำลังสร้าง PDF ป้าย...", "เตรียมข้อมูล");

    try {
      updateProcessing("กำลังจัดหน้า...");
      const printArea = $("customPrintArea");
      const pageCount = Math.max(1, Math.ceil(total / g.perPage));
      let html = "";
      for (let p = 0; p < pageCount; p++) {
        const cells = [];
        for (let i = 0; i < g.perPage; i++) {
          const idx = p * g.perPage + i;
          cells.push(idx < total ? cCardHtml(items ? items[idx] : "") : cBlank());
        }
        html += cPageHtml(cells.join(""));
      }
      printArea.innerHTML = html;
      printArea.querySelectorAll(".c-a4-wrap").forEach(el => applyCVars(el, g));

      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      fitCustom(printArea, g, items);
      await new Promise(r => setTimeout(r, 80));

      const o = { position: printArea.style.position, left: printArea.style.left, top: printArea.style.top, visibility: printArea.style.visibility };
      printArea.style.position = "fixed"; printArea.style.left = "0"; printArea.style.top = "0";
      printArea.style.visibility = "visible"; printArea.style.zIndex = "-1";

      const { jsPDF } = window.jspdf;
      const land = cOrient === "landscape";
      const pdf = new jsPDF({ orientation: land ? "landscape" : "portrait", unit: "mm", format: "a4" });
      const pw = land ? A4_H_MM : A4_W_MM, ph = land ? A4_W_MM : A4_H_MM;
      const sheets = printArea.querySelectorAll(".c-a4");

      for (let i = 0; i < sheets.length; i++) {
        updateProcessing(`เรนเดอร์หน้า ${i + 1} / ${sheets.length}`);
        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(sheets[i], { scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false });
        const img = canvas.toDataURL("image/jpeg", 0.95);
        pdf.addImage(img, "JPEG", 0, 0, pw, ph, undefined, "FAST");
      }

      printArea.style.position = o.position; printArea.style.left = o.left; printArea.style.top = o.top; printArea.style.visibility = o.visibility; printArea.style.zIndex = "";

      const stamp = new Date().toISOString().slice(0, 10);
      if (mode === "open") {
        updateProcessing("กำลังเปิดตัวอย่าง...");
        const url = pdf.output("bloburl");
        const win = window.open(url, "_blank");
        if (!win) { pdf.save(`labels-${stamp}.pdf`); showToast("เบราว์เซอร์บล็อกหน้าต่างใหม่ — บันทึกไฟล์แทน", "error"); }
        else showToast(`เปิดตัวอย่าง PDF (${sheets.length} หน้า · ${total} ใบ)`);
      } else {
        updateProcessing("กำลังบันทึกไฟล์...");
        pdf.save(`labels-${stamp}.pdf`);
        showToast(`ส่งออก PDF เรียบร้อย (${sheets.length} หน้า · ${total} ใบ)`);
      }
    } catch (err) {
      console.error(err);
      showToast("สร้าง PDF ไม่สำเร็จ — " + err.message, "error");
    } finally {
      const pa = $("customPrintArea"); if (pa) pa.innerHTML = "";   // free DOM (can be huge)
      [btnP, btnX].forEach(b => b && (b.disabled = false));
      if (busy) busy.textContent = orig;
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
      ["ชื่อ", "ตำแหน่ง", "จำนวนใบ (ไม่บังคับ)"],
      ["คุณสิงหราช กัลยาณมิตร", "ที่ปรึกษา", 2],
      ["คุณสมชาย ใจดี", "ผู้จัดการ", 1],
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
    $("cZoomLabel") && ($("cZoomLabel").textContent = Math.round(cZoom * 100) + "%");
    $("certZoomLabel") && ($("certZoomLabel").textContent = Math.round(certZoom * 100) + "%");
    syncNmcSizeInputs();
    // Reflect the custom-badge size defaults (logo 100px · text 60px) in the inputs
    const lsi = $("cLogoSizeInput"); if (lsi) lsi.value = cLogoSize > 0 ? cLogoSize : "";
    const tsi = $("cTextSizeInput"); if (tsi) tsi.value = cTextSize > 0 ? cTextSize : "";
    updateLayoutTitle();
    loadCertTemplates();
    probeAllCertTpls().then(() => updateCertTplCount());
    renderCustomSheets();
    showPicker();
    // Pull company logo from settings → re-render cards once it resolves
    if (window.CompanyLogo) {
      window.CompanyLogo.refresh().then(() => {
        if (rows.length) renderSheets();
        if (activeTab === "custom") { renderCLogoGrid(); renderCustomSheets(); }
      });
    }
  });

  window.nmc = {
    // Namecard tab
    onDrag, onDrop, onFilePick,
    addRow, clearAll, resetAll, toggleQtyMode,
    setNmcW, setNmcH, setNmcSize, syncNmcSizeInputs,
    setZoom, printNow, exportPDF, downloadTemplate,
    // Custom tab (merged VIP + Badge + Seat)
    setCMode, setCText, setCStyle, setCLogoSize, setCTextSize,
    setCQty, bumpCQty,
    setCRow, setCCol, setCSep, setCNumSize, setCSeqSets, bumpCSeqSets,
    setCW, setCH, setCSize, syncCInputs,
    setCPerPage, bumpCPerPage,
    setCOrient, setCVAlign, setCZoom, clearCustom,
    onCLogoPick, exportCustomPDF, printCustomViaIframe,
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
    // Common
    switchTab, showPicker,
  };
})();
