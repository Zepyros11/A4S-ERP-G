/* ═══════════════════════════════════════════════════════════
   PASSPORT SHEET — Print + Export PDF
   A4 landscape · 2 คน/หน้า · พร้อมรายละเอียดผู้เดินทาง
   Loaded as a separate classic script by check-seat.html.
   Globals used from check-seat.html: rows, currentTrip,
   currentTripId, esc, toast, window.DateFmt.
   PDF export needs: window.html2canvas, window.jspdf (CDN).
═══════════════════════════════════════════════════════════ */

/* ── เก็บข้อมูล + สร้างการ์ดต่อคน ─────────────────────────── */
function _passportData() {
  const list = rows.filter(r => r.passImg || r.passImgFile);
  if (list.length === 0) return null;

  const fmt       = (window.DateFmt && window.DateFmt.formatDMY) || (s => s || '');
  const tripName  = (currentTrip && currentTrip.trip_name)
                    || (currentTripId != null ? `Trip #${currentTripId}` : 'Check Seat');
  const range     = currentTrip
    ? `${currentTrip.start_date ? fmt(currentTrip.start_date) : '—'} → ${currentTrip.end_date ? fmt(currentTrip.end_date) : '—'}`
    : '';
  const printedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  const cards = list.map(r => {
    let src = r.passImg;
    if (!src && r.passImgFile) { try { src = URL.createObjectURL(r.passImgFile); } catch (e) {} }
    const det = [
      ['Gender', r.gender], ['Nationality', r.nationality],
      ['PIN', r.pin],       ['Seat', r.seat],
      ['Port', r.port],     ['Group', r.group],
      ['Flight', r.flight], ['Pass. ID', r.passId],
      ['Pass. Exp.', r.passExp], ['Tel', r.tel],
    ].map(([k, v]) =>
      `<div class="d-cell"><span class="d-k">${k}</span><span class="d-v">${esc(v) || '—'}</span></div>`
    ).join('');
    return `<div class="pp-card">
      <div class="pp-img"><img src="${esc(src)}" alt="passport" crossorigin="anonymous" /></div>
      <div class="pp-id"><span class="pp-code">${esc(r.code) || '—'}</span><span class="pp-name">${esc(r.name) || '—'}</span></div>
      <div class="pp-details">${det}</div>
    </div>`;
  });

  return { list, tripName, range, printedAt, cards };
}

/* ── HTML: จับคู่ 2 คน/หน้า ───────────────────────────────── */
function _passportPagesHTML(d) {
  const pageCount = Math.ceil(d.cards.length / 2);
  let pages = '';
  for (let i = 0; i < d.cards.length; i += 2) {
    const pageNo = i / 2 + 1;
    const right  = d.cards[i + 1] || '<div class="pp-card pp-empty"></div>';
    pages += `<section class="pp-page">
      <div class="pp-head">
        <span class="h-title">✈ ${esc(d.tripName)}</span>
        <span class="h-sub">${d.range ? esc(d.range) + ' · ' : ''}Passport ${d.list.length} รายการ · หน้า ${pageNo}/${pageCount} · พิมพ์ ${esc(d.printedAt)}</span>
      </div>
      <div class="pp-row">${d.cards[i]}${right}</div>
    </section>`;
  }
  return pages;
}

/* ── CSS (scope='' = สำหรับ print window · scope='#x' = inline) ── */
function _passportCSS(scope) {
  const p = scope ? scope + ' ' : '';
  const rules = [
    ['*', 'box-sizing:border-box;margin:0;padding:0;'],
    ['.pp-page', "width:297mm;height:210mm;padding:8mm;background:#fff;overflow:hidden;" +
                 "font-family:'Segoe UI',Tahoma,sans-serif;color:#1f2937;page-break-after:always;"],
    ['.pp-page:last-child', 'page-break-after:auto;'],
    ['.pp-head', 'display:flex;justify-content:space-between;align-items:baseline;' +
                 'border-bottom:2px solid #0f4c75;padding-bottom:4px;margin-bottom:7px;'],
    ['.pp-head .h-title', 'font-size:14px;font-weight:700;color:#0f4c75;'],
    ['.pp-head .h-sub', 'font-size:10px;color:#6b7280;'],
    ['.pp-row', 'display:flex;gap:7mm;align-items:flex-start;'],
    ['.pp-card', 'width:50%;border:1px solid #d1d5db;border-radius:6px;padding:9px;' +
                 'display:flex;flex-direction:column;'],
    ['.pp-empty', 'border:none;'],
    ['.pp-img', 'background:#f3f4f6;border-radius:4px;text-align:center;'],
    ['.pp-img img', 'max-width:100%;max-height:120mm;object-fit:contain;display:inline-block;'],
    ['.pp-id', 'display:flex;gap:9px;align-items:baseline;margin:8px 0 5px;'],
    ['.pp-code', 'font-size:13px;font-weight:700;color:#0f4c75;'],
    ['.pp-name', 'font-size:15px;font-weight:700;'],
    ['.pp-details', 'display:grid;grid-template-columns:1fr 1fr;gap:0 16px;'],
    ['.d-cell', 'display:flex;font-size:11px;border-bottom:1px dotted #e5e7eb;padding:2.5px 0;'],
    ['.d-k', 'color:#6b7280;width:82px;flex-shrink:0;'],
    ['.d-v', 'font-weight:600;'],
  ];
  let css = scope ? '' : '@page { size: A4 landscape; margin: 0; }\n';
  for (const [sel, body] of rules) css += `${p}${sel} { ${body} }\n`;
  return css;
}

/* ═══ พิมพ์ (เปิดหน้าต่าง → print dialog) ═══════════════════ */
function printPassports() {
  const d = _passportData();
  if (!d) { toast('ไม่มีรูป Passport ให้พิมพ์', 'error'); return; }

  const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>Passport — ${esc(d.tripName)}</title>
<style>${_passportCSS('')}</style></head><body>
${_passportPagesHTML(d)}
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('เบราว์เซอร์บล็อก popup — อนุญาต popup แล้วลองใหม่', 'error'); return; }
  w.document.open();
  w.document.write(doc);
  w.document.close();

  const fire = () => { try { w.focus(); w.print(); } catch (e) {} };
  const imgs = Array.prototype.slice.call(w.document.images);
  let left = imgs.length;
  if (left === 0) {
    setTimeout(fire, 120);
  } else {
    const done = () => { if (--left <= 0) setTimeout(fire, 250); };
    imgs.forEach(img => {
      if (img.complete) done();
      else { img.addEventListener('load', done); img.addEventListener('error', done); }
    });
  }
  toast(`เตรียมพิมพ์ Passport ${d.list.length} รายการ`, 'success');
}

/* ── overlay บอกความคืบหน้า ──────────────────────────────── */
function _pdfProgress(msg) {
  let el = document.getElementById('pdf-progress');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pdf-progress';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;' +
      'display:flex;align-items:center;justify-content:center;font-family:Tahoma,sans-serif;';
    el.innerHTML = '<div style="background:#fff;padding:22px 34px;border-radius:12px;font-size:14px;' +
      'color:#0f4c75;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,.3)"></div>';
    document.body.appendChild(el);
  }
  el.firstChild.textContent = msg;
  el.style.display = 'flex';
}
function _pdfProgressDone() {
  const el = document.getElementById('pdf-progress');
  if (el) el.remove();
}

/* ═══ Export PDF (ดาวน์โหลดไฟล์ .pdf ตรงๆ) ═════════════════ */
let _pdfBusy = false;
async function exportPassportsPDF() {
  if (_pdfBusy) return;
  const d = _passportData();
  if (!d) { toast('ไม่มีรูป Passport ให้ Export', 'error'); return; }
  if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
    toast('ไลบรารี PDF ยังโหลดไม่เสร็จ — รอสักครู่แล้วลองใหม่', 'error');
    return;
  }

  _pdfBusy = true;
  _pdfProgress('กำลังเตรียม PDF…');

  // stage นอกจอ + CSS แบบ scoped (ไม่กระทบหน้าหลัก)
  const style = document.createElement('style');
  style.id = 'pdf-stage-style';
  style.textContent = _passportCSS('#pdf-stage');
  document.head.appendChild(style);

  const stage = document.createElement('div');
  stage.id = 'pdf-stage';
  stage.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1;';
  stage.innerHTML = _passportPagesHTML(d);
  document.body.appendChild(stage);

  try {
    const pageEls = Array.prototype.slice.call(stage.querySelectorAll('.pp-page'));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    for (let i = 0; i < pageEls.length; i++) {
      _pdfProgress(`กำลังสร้าง PDF… หน้า ${i + 1}/${pageEls.length}`);
      const canvas = await html2canvas(pageEls[i], {
        scale: 2, useCORS: true, backgroundColor: '#ffffff', imageTimeout: 20000,
      });
      const img = canvas.toDataURL('image/jpeg', 0.85);
      if (i > 0) pdf.addPage('a4', 'landscape');
      pdf.addImage(img, 'JPEG', 0, 0, 297, 210);
    }

    const safeName = (d.tripName || 'passport').replace(/[^\w฀-๿ .-]/g, '').trim() || 'passport';
    const stamp = new Date().toISOString().slice(0, 10);
    pdf.save(`Passport-${safeName}-${stamp}.pdf`);
    toast(`Export PDF สำเร็จ — Passport ${d.list.length} รายการ`, 'success');
  } catch (err) {
    console.error('PDF export failed:', err);
    toast('Export PDF ล้มเหลว: ' + (err && err.message || err), 'error');
  } finally {
    stage.remove();
    style.remove();
    _pdfProgressDone();
    _pdfBusy = false;
  }
}
