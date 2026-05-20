/* ═══════════════════════════════════════════════════════════
   PRINT PASSPORTS — printable sheet of passport images
   A4 landscape · 2 คน/หน้า · พร้อมรายละเอียดผู้เดินทาง
   Loaded as a separate classic script by check-seat.html.
   Relies on globals from check-seat.html: rows, currentTrip,
   currentTripId, esc, toast, window.DateFmt.
═══════════════════════════════════════════════════════════ */
function printPassports() {
  const list = rows.filter(r => r.passImg || r.passImgFile);
  if (list.length === 0) {
    toast('ไม่มีรูป Passport ให้พิมพ์', 'error');
    return;
  }

  const fmt       = (window.DateFmt && window.DateFmt.formatDMY) || (s => s || '');
  const tripName  = (currentTrip && currentTrip.trip_name)
                    || (currentTripId != null ? `Trip #${currentTripId}` : 'Check Seat');
  const range     = currentTrip
    ? `${currentTrip.start_date ? fmt(currentTrip.start_date) : '—'} → ${currentTrip.end_date ? fmt(currentTrip.end_date) : '—'}`
    : '';
  const printedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  // ── 1 การ์ดต่อ 1 คน ────────────────────────────────────
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
      <div class="pp-img"><img src="${esc(src)}" alt="passport" /></div>
      <div class="pp-id"><span class="pp-code">${esc(r.code) || '—'}</span><span class="pp-name">${esc(r.name) || '—'}</span></div>
      <div class="pp-details">${det}</div>
    </div>`;
  });

  // ── จับคู่ 2 คน/หน้า ───────────────────────────────────
  const pageCount = Math.ceil(cards.length / 2);
  let pages = '';
  for (let i = 0; i < cards.length; i += 2) {
    const pageNo = i / 2 + 1;
    const right  = cards[i + 1] || '<div class="pp-card pp-empty"></div>';
    pages += `<section class="pp-page">
      <div class="pp-head">
        <span class="h-title">✈ ${esc(tripName)}</span>
        <span class="h-sub">${range ? esc(range) + ' · ' : ''}Passport ${list.length} รายการ · หน้า ${pageNo}/${pageCount} · พิมพ์ ${esc(printedAt)}</span>
      </div>
      <div class="pp-row">${cards[i]}${right}</div>
    </section>`;
  }

  const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>Passport — ${esc(tripName)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; }
  .pp-page { page-break-after: always; }
  .pp-page:last-child { page-break-after: auto; }
  .pp-head { display: flex; justify-content: space-between; align-items: baseline;
             border-bottom: 2px solid #0f4c75; padding-bottom: 4px; margin-bottom: 7px; }
  .pp-head .h-title { font-size: 14px; font-weight: 700; color: #0f4c75; }
  .pp-head .h-sub { font-size: 10px; color: #6b7280; }
  .pp-row { display: flex; gap: 7mm; align-items: flex-start; }
  .pp-card { width: 50%; border: 1px solid #d1d5db; border-radius: 6px; padding: 9px;
             display: flex; flex-direction: column; page-break-inside: avoid; }
  .pp-empty { border: none; }
  .pp-img { background: #f3f4f6; border-radius: 4px; text-align: center; }
  .pp-img img { max-width: 100%; max-height: 120mm; object-fit: contain; display: inline-block; }
  .pp-id { display: flex; gap: 9px; align-items: baseline; margin: 8px 0 5px; }
  .pp-code { font-size: 13px; font-weight: 700; color: #0f4c75; }
  .pp-name { font-size: 15px; font-weight: 700; }
  .pp-details { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .d-cell { display: flex; font-size: 11px; border-bottom: 1px dotted #e5e7eb; padding: 2.5px 0; }
  .d-k { color: #6b7280; width: 82px; flex-shrink: 0; }
  .d-v { font-weight: 600; }
</style></head><body>
${pages}
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('เบราว์เซอร์บล็อก popup — อนุญาต popup แล้วลองใหม่', 'error'); return; }
  w.document.open();
  w.document.write(doc);
  w.document.close();

  // สั่งพิมพ์เมื่อรูปโหลดครบ — ควบคุมจากหน้าหลัก
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
  toast(`เตรียมพิมพ์ Passport ${list.length} รายการ`, 'success');
}
