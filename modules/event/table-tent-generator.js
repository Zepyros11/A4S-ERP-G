/* ============================================================
   table-tent-generator.js
   ป้ายตั้งโต๊ะ (รายชื่อกลุ่ม/VIP) · A4 · 1 แผ่น = รายชื่อทั้งกลุ่ม
   ------------------------------------------------------------
   • แนวตั้ง/นอน · จำนวนรายชื่อต่อหน้า (เกิน → ขึ้นหน้าใหม่ เลขต่อเนื่อง)
   • โลโก้ (ซ้าย/กลาง/ขวา + ขนาด px) · ภาพพื้นหลัง (BG) + ฉากมืด
   • รายชื่อ + ตำแหน่ง (กรอกเอง / นำเข้า Excel) · จำนวนสำเนา
   • พิมพ์/บันทึก PDF ผ่าน iframe (native print · สีพื้นหลังครบ)
   ============================================================ */
(function () {
  "use strict";
  console.log("%c[table-tent-generator] v1 loaded", "color:#caa83a;font-weight:bold");

  const A4_W_MM = 210, A4_H_MM = 297;
  const MM2PX = 96 / 25.4;                       // 1mm ≈ 3.7795px @96dpi
  const LOGO_FALLBACK = "../../assets/logo/logo-a4s.png";
  const PREVIEW_MAX = 8;                          // หน้าพรีวิวสูงสุด (พิมพ์จริงครบทุกหน้า)

  // ── State ─────────────────────────────────────────────────
  const S = {
    title: "VIP 1",
    titleSize: 0,            // px · 0 = auto
    orient: "portrait",      // "portrait" | "landscape"
    theme: "gold",           // "gold" | "light"
    perPage: 10,
    showNum: true,
    startNum: 1,
    logo: null,              // dataURL หรือ URL
    logoPos: "left",         // "left" | "center" | "right"
    logoSize: 90,            // px
    bg: null,                // dataURL
    overlay: 0,              // 0..0.8
    copies: 1,
    rows: [],                // [{ name, role }]
    zoom: 0.5,
  };

  // ── tiny helpers ──────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function clamp(min, v, max) { return Math.max(min, Math.min(max, v)); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function raf2() { return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }
  function toast(msg, type = "success") {
    const t = $("toast"); if (!t) return;
    t.className = `toast toast-${type} show`; t.textContent = msg;
    setTimeout(() => t.classList.remove("show"), 2800);
  }
  function showProcessing(title, sub = "") {
    const ov = $("loadingOverlay"); if (!ov) return;
    ov.style.display = "flex";
    const t = $("processingTitle"); if (t) t.textContent = title || "กำลังประมวลผล...";
    const s = $("processingSub"); if (s) s.textContent = sub || "";
    ov.classList.add("show");
  }
  function hideProcessing() {
    const ov = $("loadingOverlay"); if (!ov) return;
    ov.classList.remove("show"); ov.style.display = "none";
  }
  // strip a trailing space after a Thai honorific so "คุณ  X" → "คุณ X"
  function formatName(raw) {
    return String(raw || "").trim().replace(/\s+/g, " ");
  }

  // ── Image → compressed dataURL ────────────────────────────
  function compressImage(file, { maxPx, mime, quality }) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width: w, height: h } = img;
        if (!w || !h) { reject(new Error("ภาพเสียหาย")); return; }
        if (w > maxPx || h > maxPx) {
          const s = Math.min(maxPx / w, maxPx / h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL(mime, quality)); }
        catch (e) { reject(new Error("แปลงรูปไม่สำเร็จ")); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านไฟล์ภาพไม่สำเร็จ")); };
      img.src = url;
    });
  }

  // ── Geometry ──────────────────────────────────────────────
  function pageDimsMm() {
    return S.orient === "landscape"
      ? { pw: A4_H_MM, ph: A4_W_MM }
      : { pw: A4_W_MM, ph: A4_H_MM };
  }
  function applyWrapVars(wrap, zoom) {
    const { pw, ph } = pageDimsMm();
    wrap.style.setProperty("--tt-pw", pw + "mm");
    wrap.style.setProperty("--tt-ph", ph + "mm");
    wrap.style.setProperty("--tt-zoom", zoom);
  }
  function applySheetVars(sheet) {
    const { pw } = pageDimsMm();
    const pwPx = pw * MM2PX;
    sheet.style.setProperty("--tt-per-page", Math.max(1, S.perPage | 0));
    sheet.style.setProperty("--tt-logo-justify",
      S.logoPos === "center" ? "center" : S.logoPos === "right" ? "flex-end" : "flex-start");
    sheet.style.setProperty("--tt-logo-size", (S.logoSize | 0) + "px");
    sheet.style.setProperty("--tt-overlay", S.overlay || 0);
    sheet.style.setProperty("--tt-cols", S.showNum ? "minmax(1.7em,auto) 1fr auto" : "1fr auto");
    const tsize = S.titleSize > 0 ? S.titleSize : clamp(28, Math.round(pwPx * 0.11), 130);
    sheet.style.setProperty("--tt-title-size", tsize + "px");
  }
  // font sizing derived from the measured (full-size) row height
  function fit(container) {
    container.querySelectorAll(".tt-a4").forEach(sheet => {
      const row = sheet.querySelector(".tt-row");
      if (!row) return;
      const h = row.clientHeight;
      if (!h) return;
      sheet.style.setProperty("--tt-name-size", clamp(11, Math.round(h * 0.40), 46) + "px");
      sheet.style.setProperty("--tt-num-size", clamp(12, Math.round(h * 0.52), 60) + "px");
      sheet.style.setProperty("--tt-role-size", clamp(9, Math.round(h * 0.30), 30) + "px");
    });
  }

  // ── HTML builders ─────────────────────────────────────────
  function cleanRows() {
    return S.rows.filter(r => (r.name || "").trim() || (r.role || "").trim());
  }
  function sheetHtml(rowsSlice, startNumber) {
    const themeCls = S.theme === "light" ? "tt-theme-light" : "tt-theme-gold";
    const hasBg = !!S.bg;
    const bgStyle = hasBg ? ` style="background-image:url('${S.bg}')"` : "";
    const logo = S.logo
      ? `<div class="tt-logo-line"><img src="${esc(S.logo)}" alt="" crossorigin="anonymous" onerror="this.style.display='none'"></div>`
      : "";
    const title = (S.title || "").trim() ? `<div class="tt-title">${esc(S.title)}</div>` : "";
    const head = (logo || title) ? `<div class="tt-head">${logo}${title}</div>` : "";

    let rowsHtml = "";
    rowsSlice.forEach((r, i) => {
      const num = S.showNum ? `<div class="tt-num">${esc(startNumber + i)}</div>` : "";
      const name = `<div class="tt-name">${esc(formatName(r.name))}</div>`;
      const role = `<div class="tt-role">${esc((r.role || "").trim())}</div>`;
      rowsHtml += `<div class="tt-row">${num}${name}${role}</div>`;
    });
    return `<div class="tt-a4 ${themeCls}${hasBg ? " tt-has-bg" : ""}"${bgStyle}>` +
      `<div class="tt-bg-overlay"></div>` +
      `<div class="tt-inner">${head}<div class="tt-list">${rowsHtml}</div></div></div>`;
  }
  // build every page (rows chunked by perPage · whole set repeated ×copies).
  // numbering is continuous within a copy and restarts each copy.
  function buildPages(forPrint) {
    const rows = cleanRows();
    const per = Math.max(1, S.perPage | 0);
    const copies = Math.max(1, S.copies | 0);
    const start = S.startNum | 0;
    const chunks = [];
    for (let i = 0; i < rows.length; i += per) chunks.push({ rows: rows.slice(i, i + per), offset: i });
    if (!chunks.length) return { html: "", pages: 0, totalRows: 0 };

    const totalPages = chunks.length * copies;
    let html = "", pageNo = 0;
    outer:
    for (let c = 0; c < copies; c++) {
      for (const ch of chunks) {
        pageNo++;
        if (!forPrint && pageNo > PREVIEW_MAX) break outer;
        const sheet = sheetHtml(ch.rows, start + ch.offset);
        html += forPrint
          ? `<div class="tt-a4-wrap">${sheet}</div>`
          : `<div class="tt-page-item"><div class="tt-page-label">📄 หน้า ${pageNo} / ${totalPages}</div><div class="tt-a4-wrap">${sheet}</div></div>`;
      }
    }
    if (!forPrint && totalPages > PREVIEW_MAX)
      html += `<div class="tt-more-note">… แสดง ${PREVIEW_MAX} หน้าแรก · กดพิมพ์เพื่อออกครบทั้ง ${totalPages} หน้า</div>`;
    return { html, pages: totalPages, totalRows: rows.length };
  }

  // ── Render ────────────────────────────────────────────────
  function renderPreview() {
    const scroller = $("ttSheetScroller");
    if (!scroller) return;
    const { html, pages, totalRows } = buildPages(false);
    $("ttCount") && ($("ttCount").textContent = totalRows);
    $("ttPages") && ($("ttPages").textContent = totalRows ? pages : 0);
    $("ttPreviewTitle") && ($("ttPreviewTitle").textContent =
      `👁️ ตัวอย่าง · A4 ${S.orient === "landscape" ? "แนวนอน" : "แนวตั้ง"}`);
    if (!totalRows) { scroller.innerHTML = `<div class="tt-rows-empty">เพิ่มรายชื่อเพื่อดูตัวอย่าง</div>`; return; }
    scroller.innerHTML = html;
    scroller.querySelectorAll(".tt-a4-wrap").forEach(w => applyWrapVars(w, S.zoom));
    scroller.querySelectorAll(".tt-a4").forEach(s => applySheetVars(s));
    requestAnimationFrame(() => {
      fit(scroller);
      // logo/bg load async → header height changes → refit once
      let queued = false;
      scroller.querySelectorAll(".tt-a4 img").forEach(img => {
        if (img.complete) return;
        img.addEventListener("load", () => {
          if (queued) return; queued = true;
          requestAnimationFrame(() => { queued = false; fit(scroller); });
        }, { once: true });
      });
    });
  }
  function renderTable() {
    const tb = $("ttRowsBody");
    if (!tb) return;
    if (!S.rows.length) {
      tb.innerHTML = `<tr><td colspan="4" class="tt-rows-empty">ยังไม่มีรายชื่อ — กด ＋ เพิ่มแถว หรือ นำเข้า Excel</td></tr>`;
      return;
    }
    tb.innerHTML = S.rows.map((r, i) => `<tr>
      <td class="tt-col-idx">${i + 1}</td>
      <td><input value="${esc(r.name || "")}" placeholder="ชื่อ-นามสกุล" oninput="ttg.editRow(${i},'name',this.value)"></td>
      <td><input value="${esc(r.role || "")}" placeholder="ตำแหน่ง (ไม่บังคับ)" oninput="ttg.editRow(${i},'role',this.value)"></td>
      <td class="tt-col-act"><button class="tt-del-row" onclick="ttg.delRow(${i})" title="ลบแถวนี้">🗑</button></td>
    </tr>`).join("");
  }
  function renderAll() { renderTable(); renderPreview(); }

  // ── Rows CRUD ─────────────────────────────────────────────
  function editRow(i, field, val) { if (S.rows[i]) { S.rows[i][field] = val; renderPreview(); } }
  function addRow() {
    S.rows.push({ name: "", role: "" });
    renderTable(); renderPreview();
    const inputs = $("ttRowsBody").querySelectorAll('tr:last-child input');
    if (inputs[0]) inputs[0].focus();
  }
  function delRow(i) { S.rows.splice(i, 1); renderAll(); }
  async function clearRows() {
    if (!S.rows.length) return;
    const ok = window.ConfirmModal
      ? await ConfirmModal.open({ title: "ล้างรายชื่อทั้งหมด?", message: "ลบทุกแถวออกจากรายการ", icon: "🗑", tone: "danger", okText: "ล้าง" })
      : true;
    if (!ok) return;
    S.rows = []; renderAll();
  }

  // ── Excel import / template ───────────────────────────────
  async function onXlsPick(e) {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (!window.XLSX) { toast("ไลบรารี Excel ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง", "error"); return; }
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const arr = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
      const rows = [];
      arr.forEach((row, i) => {
        const name = String(row[0] == null ? "" : row[0]).trim();
        const role = String(row[1] == null ? "" : row[1]).trim();
        if (!name && !role) return;
        if (i === 0 && /^(ชื่อ|name|รายชื่อ)$/i.test(name)) return;   // skip header row
        rows.push({ name, role });
      });
      if (!rows.length) { toast("ไม่พบรายชื่อในไฟล์", "error"); return; }
      S.rows = rows; renderAll();
      toast(`✓ นำเข้า ${rows.length} รายชื่อ`);
    } catch (err) { console.error(err); toast("นำเข้าไม่สำเร็จ — " + err.message, "error"); }
  }
  function downloadTemplate() {
    if (!window.XLSX) { toast("ไลบรารียังโหลดไม่เสร็จ", "error"); return; }
    const data = [["ชื่อ", "ตำแหน่ง"],
      ["ดร.มุกดา ภัทรบัญชา", "CFO"],
      ["สิงหราช กัลยาณมิตร", "ที่ปรึกษากฎหมาย"],
      ["ดร.กิ่งแก้ว แสงสุวรรณ", "CEO สปป.ลาว"]];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "รายชื่อ");
    XLSX.writeFile(wb, "table-tent-template.xlsx");
  }

  // ── Logo ──────────────────────────────────────────────────
  function updateLogoThumb() {
    const thumb = $("ttLogoThumb"), clr = $("ttLogoClear");
    if (thumb) thumb.innerHTML = S.logo
      ? `<img src="${esc(S.logo)}" alt="" crossorigin="anonymous">`
      : `<span class="tt-logo-empty">∅</span>`;
    if (clr) clr.style.display = S.logo ? "" : "none";
  }
  async function onLogoPick(e) {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast("รับเฉพาะไฟล์ภาพ", "error"); return; }
    try {
      showProcessing("กำลังอ่านโลโก้...");
      const keepAlpha = /png|webp|svg/i.test(f.type);
      S.logo = await compressImage(f, { maxPx: 600, mime: keepAlpha ? "image/png" : "image/jpeg", quality: 0.92 });
      updateLogoThumb(); renderPreview();
      toast("✓ เพิ่มโลโก้แล้ว");
    } catch (err) { toast("โลโก้ไม่สำเร็จ — " + err.message, "error"); }
    finally { hideProcessing(); }
  }
  function useCompanyLogo() {
    S.logo = window.CompanyLogo ? window.CompanyLogo.logoUrl(LOGO_FALLBACK) : LOGO_FALLBACK;
    updateLogoThumb(); renderPreview();
    toast("✓ ใช้โลโก้บริษัท");
  }
  function clearLogo() { S.logo = null; updateLogoThumb(); renderPreview(); }

  // ── Background image ──────────────────────────────────────
  function updateBgThumb() {
    const thumb = $("ttBgThumb"), clr = $("ttBgClear");
    if (thumb) thumb.innerHTML = S.bg
      ? `<img src="${esc(S.bg)}" alt="">`
      : `<span class="tt-logo-empty">∅</span>`;
    if (clr) clr.style.display = S.bg ? "" : "none";
  }
  async function onBgPick(e) {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast("รับเฉพาะไฟล์ภาพ", "error"); return; }
    try {
      showProcessing("กำลังอ่านภาพพื้นหลัง...");
      S.bg = await compressImage(f, { maxPx: 1900, mime: "image/jpeg", quality: 0.85 });
      updateBgThumb(); renderPreview();
      toast("✓ เพิ่มภาพพื้นหลังแล้ว");
    } catch (err) { toast("ภาพพื้นหลังไม่สำเร็จ — " + err.message, "error"); }
    finally { hideProcessing(); }
  }
  function clearBg() { S.bg = null; updateBgThumb(); renderPreview(); }

  // ── Setters ───────────────────────────────────────────────
  function setTitle(v) { S.title = String(v == null ? "" : v); renderPreview(); }
  function setTitleSize(v) { S.titleSize = Math.max(0, parseInt(v, 10) || 0); renderPreview(); }
  function setOrient(o) {
    S.orient = o === "landscape" ? "landscape" : "portrait";
    $("ttOrientPortrait").classList.toggle("active", S.orient === "portrait");
    $("ttOrientLandscape").classList.toggle("active", S.orient === "landscape");
    renderPreview();
  }
  function setTheme(t) {
    S.theme = t === "light" ? "light" : "gold";
    $("ttThemeGold").classList.toggle("active", S.theme === "gold");
    $("ttThemeLight").classList.toggle("active", S.theme === "light");
    renderPreview();
  }
  function setPerPage(v) {
    S.perPage = clamp(1, parseInt(v, 10) || 1, 40);
    const inp = $("ttPerPage"); if (inp && document.activeElement !== inp) inp.value = S.perPage;
    renderPreview();
  }
  function bumpPerPage(d) { setPerPage(S.perPage + d); $("ttPerPage").value = S.perPage; }
  function setShowNum(on) { S.showNum = !!on; renderPreview(); }
  function setStartNum(v) { S.startNum = clamp(0, parseInt(v, 10) || 0, 999); renderPreview(); }
  function setLogoPos(p) {
    S.logoPos = (p === "center" || p === "right") ? p : "left";
    $("ttLogoLeft").classList.toggle("active", S.logoPos === "left");
    $("ttLogoCenter").classList.toggle("active", S.logoPos === "center");
    $("ttLogoRight").classList.toggle("active", S.logoPos === "right");
    renderPreview();
  }
  function setLogoSize(v) { S.logoSize = clamp(20, parseInt(v, 10) || 90, 400); renderPreview(); }
  function setOverlay(v) {
    const pct = clamp(0, parseInt(v, 10) || 0, 80);
    S.overlay = pct / 100;
    $("ttOverlayVal") && ($("ttOverlayVal").textContent = pct + "%");
    // live: just update the var on existing sheets (no rebuild)
    $("ttSheetScroller").querySelectorAll(".tt-a4").forEach(s => s.style.setProperty("--tt-overlay", S.overlay));
  }
  function setCopies(v) {
    S.copies = clamp(1, parseInt(v, 10) || 1, 99);
    const inp = $("ttCopies"); if (inp && document.activeElement !== inp) inp.value = S.copies;
    renderPreview();
  }
  function bumpCopies(d) { setCopies(S.copies + d); $("ttCopies").value = S.copies; }
  function setZoom(dir) {
    S.zoom = clamp(0.2, +(S.zoom + dir * 0.1).toFixed(2), 1.5);
    $("ttZoomLabel") && ($("ttZoomLabel").textContent = Math.round(S.zoom * 100) + "%");
    $("ttSheetScroller").querySelectorAll(".tt-a4-wrap").forEach(w => applyWrapVars(w, S.zoom));
  }

  async function resetAll() {
    const ok = window.ConfirmModal
      ? await ConfirmModal.open({ title: "เริ่มใหม่?", message: "ล้างรายชื่อ โลโก้ ภาพพื้นหลัง และตั้งค่าทั้งหมด", icon: "↺", tone: "danger", okText: "เริ่มใหม่" })
      : true;
    if (!ok) return;
    Object.assign(S, {
      title: "", titleSize: 0, orient: "portrait", theme: "gold", perPage: 10,
      showNum: true, startNum: 1, logo: null, logoPos: "left", logoSize: 90,
      bg: null, overlay: 0, copies: 1, rows: [], zoom: 0.5,
    });
    syncUI(); renderAll();
  }

  // ── Print / PDF (native, via off-screen iframe) ───────────
  async function printNow() {
    const rows = cleanRows();
    if (!rows.length) { toast("ยังไม่มีรายชื่อ — กรอกข้อมูลก่อน", "error"); return; }
    showProcessing("กำลังเตรียมพิมพ์...", "จัดหน้า");
    try {
      const printArea = $("ttPrintArea");
      printArea.innerHTML = buildPages(true).html;
      // full-size (zoom 1) so measured row height = real print size
      printArea.querySelectorAll(".tt-a4-wrap").forEach(w => applyWrapVars(w, 1));
      printArea.querySelectorAll(".tt-a4").forEach(s => applySheetVars(s));
      await raf2();
      fit(printArea);
      await sleep(70);

      const sheets = printArea.querySelectorAll(".tt-a4");
      if (!sheets.length) { toast("ไม่มีข้อมูลพิมพ์", "error"); return; }

      const landscape = S.orient === "landscape";
      const pwCss = landscape ? "297mm" : "210mm";
      const phCss = landscape ? "210mm" : "297mm";

      const old = document.getElementById("ttPrintFrame");
      if (old) old.remove();
      const iframe = document.createElement("iframe");
      iframe.id = "ttPrintFrame";
      iframe.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0;";
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const cssAbs = new URL("./table-tent-generator.css?v=1", location.href).href;
      const body = Array.from(sheets).map(s => `<div class="print-page">${s.outerHTML}</div>`).join("");
      doc.open();
      doc.write(
        '<!doctype html><html><head><meta charset="utf-8">' +
        '<base href="' + location.href + '">' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800;900&family=Cinzel:wght@500;600;700&display=swap">' +
        '<link rel="stylesheet" href="' + cssAbs + '">' +
        '<style>' +
          '@page{size:A4 ' + (landscape ? 'landscape' : 'portrait') + ';margin:0}' +
          'html,body{margin:0;padding:0;background:#fff}' +
          '.print-page{break-after:page;page-break-after:always}' +
          '.print-page:last-child{break-after:auto;page-break-after:auto}' +
          '.tt-a4{position:static!important;transform:none!important;margin:0 auto!important;' +
            'width:' + pwCss + '!important;height:' + phCss + '!important;' +
            'overflow:hidden!important;box-shadow:none!important;--tt-zoom:1!important}' +
          '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '</style></head><body>' + body + '</body></html>'
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
      toast("เตรียมพิมพ์ไม่สำเร็จ — " + err.message, "error");
    } finally {
      hideProcessing();
      setTimeout(() => { const pa = $("ttPrintArea"); if (pa) pa.innerHTML = ""; }, 2500);
    }
  }

  // ── Sync UI from state (after reset / init) ───────────────
  function syncUI() {
    $("ttTitle").value = S.title;
    $("ttTitleSize").value = S.titleSize || "";
    $("ttPerPage").value = S.perPage;
    $("ttShowNum").checked = S.showNum;
    $("ttStartNum").value = S.startNum;
    $("ttLogoSize").value = S.logoSize;
    $("ttCopies").value = S.copies;
    $("ttOverlay").value = Math.round(S.overlay * 100);
    $("ttOverlayVal").textContent = Math.round(S.overlay * 100) + "%";
    $("ttZoomLabel").textContent = Math.round(S.zoom * 100) + "%";
    setOrient(S.orient); setTheme(S.theme); setLogoPos(S.logoPos);
    updateLogoThumb(); updateBgThumb();
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    // seed a couple example rows so the first view shows a real-looking sign
    S.rows = [
      { name: "ดร.มุกดา ภัทรบัญชา", role: "CFO" },
      { name: "สิงหราช กัลยาณมิตร", role: "ที่ปรึกษากฎหมาย" },
      { name: "ดร.กิ่งแก้ว แสงสุวรรณ", role: "CEO สปป.ลาว" },
    ];
    syncUI();
    renderAll();
  }

  // expose (assigning window.ttg flushes any queued early clicks — see HTML guard)
  window.ttg = {
    setTitle, setTitleSize, setOrient, setTheme, setPerPage, bumpPerPage,
    setShowNum, setStartNum, setLogoPos, setLogoSize, setOverlay,
    setCopies, bumpCopies, setZoom,
    onLogoPick, useCompanyLogo, clearLogo, onBgPick, clearBg,
    editRow, addRow, delRow, clearRows, onXlsPick, downloadTemplate,
    resetAll, printNow,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
