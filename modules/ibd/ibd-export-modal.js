/* ============================================================
   ibd-export-modal.js — Date range picker for Export CSV
   Used by: ibd-complaints / ibd-ewallet / ibd-relocation / ibd-dashboard

   Usage:
     const range = await IBDExportModal.open({
       title: 'ส่งออก Complaints',
       defaultPreset: 'today',  // 'today' | '7d' | '30d' | 'thismonth' | 'all'
     });
     if (!range) return;            // cancelled
     // range = { from: '2026-04-30', to: '2026-04-30', label: '2026-04-30' }
     // or     { from: '', to: '', label: 'all' }       (preset 'all')

   Helpers also exposed:
     IBDExportModal.todayBkk()
     IBDExportModal.addDays(iso, n)
     IBDExportModal.bkkRangeFilter(from, to, field='created_at')
       → returns query string to append to PostgREST URL, e.g.
         "&created_at=gte.2026-04-30T00:00:00%2B07:00&created_at=lt.2026-05-01T00:00:00%2B07:00"
   ============================================================ */

window.IBDExportModal = (() => {
  let resolver = null;
  let cfg = {};

  function todayBkk() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function startOfMonthBkk() {
    return todayBkk().slice(0, 7) + '-01';
  }
  function bkkRangeFilter(from, to, field = 'created_at') {
    if (!from || !to) return '';
    const startIso = `${from}T00:00:00%2B07:00`;
    const endIso   = `${addDays(to, 1)}T00:00:00%2B07:00`;
    return `&${field}=gte.${startIso}&${field}=lt.${endIso}`;
  }

  const PRESETS = [
    { key: 'today',     label: 'วันนี้',    from: () => todayBkk(),               to: () => todayBkk() },
    { key: '7d',        label: '7 วัน',     from: () => addDays(todayBkk(), -6),  to: () => todayBkk() },
    { key: '30d',       label: '30 วัน',    from: () => addDays(todayBkk(), -29), to: () => todayBkk() },
    { key: 'thismonth', label: 'เดือนนี้', from: () => startOfMonthBkk(),         to: () => todayBkk() },
    { key: 'all',       label: 'ทั้งหมด',   from: () => '',                        to: () => '' },
  ];

  function ensureModal() {
    if (document.getElementById('iemOverlay')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="iemOverlay" class="iem-overlay" onclick="if(event.target===this)IBDExportModal._close(null)">
        <div class="iem-modal">
          <div class="iem-head">
            <span style="font-size:22px">📥</span>
            <span class="iem-title" id="iemTitle">ส่งออก CSV</span>
            <button class="iem-close" onclick="IBDExportModal._close(null)" title="ปิด">×</button>
          </div>
          <div class="iem-body">
            <div class="iem-section-label">เลือกช่วงเวลาด่วน</div>
            <div class="iem-presets" id="iemPresets"></div>
            <div class="iem-section-label" style="margin-top:14px">หรือเลือกช่วงวันที่เอง</div>
            <div class="iem-dates">
              <div class="iem-date-group">
                <label>จากวันที่</label>
                <input type="date" id="iemFrom" oninput="IBDExportModal._onCustomChange()" />
              </div>
              <div class="iem-arrow">→</div>
              <div class="iem-date-group">
                <label>ถึงวันที่</label>
                <input type="date" id="iemTo" oninput="IBDExportModal._onCustomChange()" />
              </div>
            </div>
          </div>
          <div class="iem-foot">
            <button class="iem-btn iem-btn-ghost" onclick="IBDExportModal._close(null)">ยกเลิก</button>
            <button class="iem-btn iem-btn-primary" onclick="IBDExportModal._submit()">📥 Export</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    injectCss();
  }

  function injectCss() {
    if (document.getElementById('iemStyle')) return;
    const s = document.createElement('style');
    s.id = 'iemStyle';
    s.textContent = `
      .iem-overlay {
        position: fixed; inset: 0;
        background: rgba(15, 23, 42, .55);
        backdrop-filter: blur(4px);
        display: none;
        align-items: center; justify-content: center;
        z-index: 9999;
        padding: 20px;
      }
      .iem-overlay.open { display: flex; }
      .iem-modal {
        background: #fff;
        border-radius: 14px;
        max-width: 460px; width: 100%;
        box-shadow: 0 20px 60px rgba(0,0,0,.3);
        overflow: hidden;
      }
      .iem-head {
        padding: 14px 18px;
        background: linear-gradient(135deg, #0f4c75, #1b6ca8);
        color: #fff;
        display: flex; align-items: center; gap: 10px;
      }
      .iem-title { font-size: 16px; font-weight: 700; flex: 1; }
      .iem-close {
        background: rgba(255,255,255,.15);
        color: #fff; border: none;
        width: 30px; height: 30px;
        border-radius: 50%;
        font-size: 18px;
        cursor: pointer;
      }
      .iem-close:hover { background: rgba(255,255,255,.3); }

      .iem-body { padding: 18px 20px; }
      .iem-section-label {
        font-size: 11.5px; font-weight: 700;
        color: #64748b; letter-spacing: .4px;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .iem-presets { display: flex; flex-wrap: wrap; gap: 6px; }
      .iem-preset {
        padding: 7px 14px;
        border: 1.5px solid #e2e8f0;
        background: #fff;
        border-radius: 18px;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        color: #475569;
        cursor: pointer;
        transition: all .15s;
      }
      .iem-preset:hover { border-color: #0f4c75; color: #0f4c75; }
      .iem-preset.active {
        background: linear-gradient(135deg, #0f4c75, #1b6ca8);
        color: #fff;
        border-color: transparent;
      }

      .iem-dates {
        display: flex; align-items: flex-end; gap: 10px;
      }
      .iem-date-group { flex: 1; }
      .iem-date-group label {
        display: block;
        font-size: 11.5px;
        color: #64748b;
        margin-bottom: 4px;
      }
      .iem-date-group input {
        width: 100%;
        padding: 8px 10px;
        border: 1.5px solid #e2e8f0;
        border-radius: 8px;
        font-family: inherit;
        font-size: 13px;
        outline: none;
        transition: border-color .15s;
      }
      .iem-date-group input:focus { border-color: #0f4c75; }
      .iem-arrow { color: #94a3b8; font-size: 16px; padding-bottom: 9px; }

      .iem-foot {
        padding: 12px 20px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
        display: flex; justify-content: flex-end; gap: 8px;
      }
      .iem-btn {
        padding: 9px 18px;
        border: none;
        border-radius: 8px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all .15s;
      }
      .iem-btn-primary {
        background: linear-gradient(135deg, #0f4c75, #1b6ca8);
        color: #fff;
      }
      .iem-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(var(--accent-rgb),.3); }
      .iem-btn-ghost {
        background: transparent;
        border: 1px solid #cbd5e1;
        color: #475569;
      }
      .iem-btn-ghost:hover { background: #f1f5f9; }

      @media (max-width: 540px) {
        .iem-dates { flex-direction: column; align-items: stretch; }
        .iem-arrow { display: none; }
      }
    `;
    document.head.appendChild(s);
  }

  function open(opts = {}) {
    ensureModal();
    cfg = { title: 'ส่งออก CSV', defaultPreset: 'today', ...opts };
    document.getElementById('iemTitle').textContent = cfg.title;
    document.getElementById('iemPresets').innerHTML = PRESETS.map(p =>
      `<button class="iem-preset ${p.key === cfg.defaultPreset ? 'active' : ''}" data-key="${p.key}" onclick="IBDExportModal._pickPreset('${p.key}')">${p.label}</button>`
    ).join('');
    pickPreset(cfg.defaultPreset);
    document.getElementById('iemOverlay').classList.add('open');
    return new Promise(r => { resolver = r; });
  }

  function pickPreset(key) {
    const p = PRESETS.find(x => x.key === key);
    if (!p) return;
    document.getElementById('iemFrom').value = p.from();
    document.getElementById('iemTo').value   = p.to();
    document.querySelectorAll('.iem-preset').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  }

  function onCustomChange() {
    // de-highlight presets when user picks custom date
    document.querySelectorAll('.iem-preset').forEach(b => b.classList.remove('active'));
  }

  function submit() {
    const from = document.getElementById('iemFrom').value;
    const to   = document.getElementById('iemTo').value;
    if ((from && !to) || (!from && to)) {
      alert('กรุณาเลือกทั้ง "จากวันที่" และ "ถึงวันที่"');
      return;
    }
    if (from && to && from > to) {
      alert('"จากวันที่" ต้องไม่หลัง "ถึงวันที่"');
      return;
    }
    let label = 'all';
    if (from && to) label = from === to ? from : `${from}_to_${to}`;
    close({ from, to, label });
  }

  function close(result) {
    document.getElementById('iemOverlay')?.classList.remove('open');
    if (resolver) { resolver(result); resolver = null; }
  }

  return {
    open,
    todayBkk, addDays, bkkRangeFilter,
    _close: close,
    _submit: submit,
    _pickPreset: pickPreset,
    _onCustomChange: onCustomChange,
  };
})();
