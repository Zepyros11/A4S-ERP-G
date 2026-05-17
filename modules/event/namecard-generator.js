/* ============================================================
   namecard-generator.js
   ป้ายชื่อ Event · 8.5cm × 6cm · A4 layout 8/หน้า
   ============================================================ */
(function () {
  "use strict";

  const PER_PAGE = 8;
  const LOGO_PATH = "../../assets/logo/logo-a4s.png";

  // [{ name, position }]
  let rows = [];
  let zoom = 0.5;

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

    // Auto-fit name & position text to box
    requestAnimationFrame(() => {
      [scroller, printArea].forEach(root => {
        root.querySelectorAll(".nmc-card-name").forEach(autoFit);
        root.querySelectorAll(".nmc-card-position").forEach(autoFit);
      });
    });
  }

  // Shrink font-size until text fits its container (width & height)
  function autoFit(el) {
    const isName = el.classList.contains("nmc-card-name");
    let max = isName ? 28 : 34;   // px · position bigger than name's max
    const min = isName ? 8 : 12;
    el.style.fontSize = max + "px";
    let safety = 40;
    while (
      (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      && max > min && safety-- > 0
    ) {
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
    // Allow autoFit to run, then print
    requestAnimationFrame(() => {
      setTimeout(() => window.print(), 80);
    });
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
  });

  window.nmc = {
    onDrag, onDrop, onFilePick,
    addRow, clearAll, resetAll,
    setZoom, printNow, downloadTemplate,
  };
})();
