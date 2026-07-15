/* ============================================================
   A4S-ERP — Date format helpers
   Display format มาตรฐานของโปรเจกต์ = DD/MM/YYYY (ค.ศ.)
   DB ยังเก็บเป็น ISO "YYYY-MM-DD" เสมอ (PostgreSQL DATE)
   ============================================================ */

(function () {
  /* ── YYYY-MM-DD → DD/MM/YYYY ── */
  function formatDMY(iso) {
    if (!iso) return '';
    const s = String(iso).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y}`;
  }

  /* ── DD/MM/YYYY → YYYY-MM-DD (รับ input จากผู้ใช้) ── */
  function parseDMY(dmy) {
    if (!dmy) return null;
    const m = String(dmy).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!m) return null;
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  /* ── YYYY-MM-DD HH:MM:SS → DD/MM/YYYY HH:MM ── */
  function formatDMYTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  window.DateFmt = { formatDMY, parseDMY, formatDMYTime };

  /* ── บังคับ native <input type=date> ให้แสดง DD/MM/YYYY ──
     Chrome/Edge เลือกรูปแบบ native date picker ตามภาษาเบราว์เซอร์ (คุมด้วย lang/CSS/JS ไม่ได้)
     จึงใช้ flatpickr แบบ altInput แทน: ช่องที่เห็นแสดง DD/MM/YYYY แต่ .value ยังเป็น ISO YYYY-MM-DD
     → โค้ดเดิมที่อ่าน/เขียน el.value (ISO) และฟัง event 'change' ทำงานได้เหมือนเดิม */
  const FP_CSS = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
  const FP_JS  = 'https://cdn.jsdelivr.net/npm/flatpickr';
  const nativeValueDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');

  function enhance(el) {
    if (!el || el.dataset.dmyFp || el._flatpickr) return;         // ข้ามถ้าทำแล้ว/หน้ามี flatpickr เอง
    if ((el.getAttribute('type') || '').toLowerCase() !== 'date') return;
    if (typeof window.flatpickr === 'undefined') return;
    el.dataset.dmyFp = '1';

    const fp = window.flatpickr(el, {
      dateFormat: 'Y-m-d',        // ค่าจริงใน el.value = ISO
      altInput: true,             // สร้างช่องที่ผู้ใช้เห็นแยก
      altFormat: 'd/m/Y',         // ช่องที่เห็น = DD/MM/YYYY
      altInputClass: el.className, // ใช้สไตล์เดิมของ input
      allowInput: true,
      disableMobile: true,
      static: true,               // วางปฏิทินอ้างอิง wrapper (กัน popup เพี้ยนตอนหน้า zoom)
    });
    if (fp.altInput) fp.altInput.style.cssText = el.style.cssText; // คง width/inline style เดิม

    /* sync เมื่อโค้ดเซ็ตค่าเอง (เช่น el.value = todayIso()) ให้ picker อัปเดตด้วย */
    let syncing = false;
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return nativeValueDesc.get.call(el); },
      set(v) {
        const cur = nativeValueDesc.get.call(el);
        nativeValueDesc.set.call(el, v == null ? '' : v);
        if (syncing || String(v || '') === String(cur || '')) return;
        syncing = true;
        try { v ? fp.setDate(v, false) : fp.clear(false); } finally { syncing = false; }
      }
    });
  }

  function scan(root) {
    if (root.querySelectorAll) root.querySelectorAll('input[type="date"]').forEach(enhance);
  }
  function boot() {
    scan(document);
    new MutationObserver(muts => {
      for (const m of muts) {
        m.addedNodes && m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input[type="date"]')) enhance(n);
          scan(n);
        });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  function init() {
    if (!document.querySelector('input[type="date"]')) return;    // ไม่มี date input → ไม่ต้องโหลดอะไร
    if (typeof window.flatpickr !== 'undefined') { boot(); return; }
    if (!document.querySelector('link[href*="flatpickr"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = FP_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = FP_JS;
    s.onload = boot;                                              // flatpickr พร้อมแล้วค่อยแปลง
    document.body.appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
