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
})();
