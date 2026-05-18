/* ============================================================
   onboardingModal.js — Multi-slide tutorial popup

   ใช้แสดงคู่มือการใช้งานหน้าใหม่ครั้งแรก (สอน user step-by-step)
   พร้อม checkbox "ไม่ต้องแสดงอีก" + localStorage persist

   Usage:
     OnboardingModal.show({
       key: 'register_v1',          // localStorage suffix — ขึ้น version ถ้าอัพเดทรูป
       images: [                    // array of image URLs (จะ preload ทุกใบ)
         '../../assets/onboarding/register/01-fill-code.png',
         '../../assets/onboarding/register/02-click-register.png',
         // ...
       ],
       force: false,                // true = เปิดแม้ user dismiss แล้ว (เช่นจากปุ่ม "ดูคู่มือ")
     });

   ESC-close: auto via modalManager.js (class .onb-overlay.open)
   ============================================================ */

window.OnboardingModal = (() => {
  const LS_PREFIX = 'a4s_onboarding_';
  let _state = null;   // { images, key, idx, dismissChecked, force }

  function _dismissedKey(key) { return `${LS_PREFIX}${key}_dismissed`; }

  function isDismissed(key) {
    try { return localStorage.getItem(_dismissedKey(key)) === '1'; }
    catch { return false; }
  }

  function setDismissed(key, val) {
    try {
      if (val) localStorage.setItem(_dismissedKey(key), '1');
      else localStorage.removeItem(_dismissedKey(key));
    } catch {}
  }

  function ensureDom() {
    if (document.getElementById('onbOverlay')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="onbOverlay" class="onb-overlay" role="dialog" aria-modal="true">
        <div class="onb-modal">
          <button class="onb-close" id="onbClose" title="ปิด">✕</button>
          <div class="onb-stage">
            <button class="onb-nav onb-prev" id="onbPrev" title="ย้อนกลับ">‹</button>
            <img class="onb-img" id="onbImg" alt="คู่มือการใช้งาน">
            <button class="onb-nav onb-next" id="onbNext" title="ถัดไป">›</button>
          </div>
          <div class="onb-footer">
            <div class="onb-dots" id="onbDots"></div>
            <div class="onb-counter" id="onbCounter">1 / 1</div>
            <label class="onb-checkbox">
              <input type="checkbox" id="onbDismissChk">
              <span>ไม่ต้องแสดงอีก</span>
            </label>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    injectCss();
    _wireEvents();
  }

  function injectCss() {
    if (document.getElementById('onbStyle')) return;
    const s = document.createElement('style');
    s.id = 'onbStyle';
    s.textContent = `
      .onb-overlay {
        position: fixed; inset: 0;
        background: rgba(15, 23, 42, 0.7);
        backdrop-filter: blur(4px);
        display: none; align-items: center; justify-content: center;
        z-index: 10001;
        opacity: 0; transition: opacity .2s;
        padding: 16px;
      }
      .onb-overlay.open { display: flex; opacity: 1; }
      .onb-modal {
        background: #fff;
        width: 480px; max-width: 100%;
        max-height: 92vh;
        border-radius: 18px;
        box-shadow: 0 20px 60px rgba(0,0,0,.35);
        display: flex; flex-direction: column;
        overflow: hidden;
        transform: scale(.92) translateY(10px);
        transition: transform .25s ease;
        position: relative;
      }
      .onb-overlay.open .onb-modal { transform: scale(1) translateY(0); }
      .onb-close {
        position: absolute; top: 8px; right: 10px;
        width: 32px; height: 32px;
        border: none; border-radius: 50%;
        background: rgba(0,0,0,.45); color: #fff;
        font-size: 16px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        z-index: 2;
        transition: background .15s;
      }
      .onb-close:hover { background: rgba(0,0,0,.7); }
      .onb-stage {
        position: relative;
        background: #f8fafc;
        display: flex; align-items: center; justify-content: center;
        min-height: 240px;
        flex: 1;
        overflow: hidden;
      }
      .onb-img {
        max-width: 100%; max-height: 70vh;
        display: block;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
      }
      .onb-nav {
        position: absolute;
        top: 50%; transform: translateY(-50%);
        width: 42px; height: 42px;
        border: none; border-radius: 50%;
        background: rgba(255,255,255,.92);
        color: #1e293b;
        font-size: 28px; line-height: 1;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.18);
        display: flex; align-items: center; justify-content: center;
        transition: background .15s, transform .1s;
        z-index: 2;
      }
      .onb-nav:hover { background: #fff; }
      .onb-nav:active { transform: translateY(-50%) scale(.94); }
      .onb-nav:disabled { opacity: .3; cursor: not-allowed; }
      .onb-prev { left: 10px; }
      .onb-next { right: 10px; }
      .onb-footer {
        background: #fff;
        padding: 12px 16px;
        border-top: 1px solid #e2e8f0;
        display: flex; flex-direction: column; align-items: center;
        gap: 8px;
      }
      .onb-dots {
        display: flex; gap: 6px;
        justify-content: center;
      }
      .onb-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: #cbd5e1;
        cursor: pointer;
        transition: background .15s, transform .15s;
      }
      .onb-dot:hover { transform: scale(1.3); }
      .onb-dot.active { background: #16a34a; width: 22px; border-radius: 4px; }
      .onb-counter {
        font-size: 12px; color: #64748b;
        font-family: 'IBM Plex Mono', monospace;
      }
      .onb-checkbox {
        display: flex; align-items: center; gap: 8px;
        cursor: pointer;
        font-size: 14px; color: #475569;
        user-select: none;
        padding: 4px 8px;
      }
      .onb-checkbox input { cursor: pointer; width: 16px; height: 16px; accent-color: #16a34a; }

      /* Mobile */
      @media (max-width: 480px) {
        .onb-overlay { padding: 8px; }
        .onb-nav { width: 36px; height: 36px; font-size: 22px; }
        .onb-prev { left: 6px; }
        .onb-next { right: 6px; }
        .onb-close { top: 6px; right: 6px; }
      }
    `;
    document.head.appendChild(s);
  }

  function _wireEvents() {
    document.getElementById('onbClose').addEventListener('click', close);
    document.getElementById('onbPrev').addEventListener('click', prev);
    document.getElementById('onbNext').addEventListener('click', next);
    document.getElementById('onbDismissChk').addEventListener('change', (e) => {
      if (_state) _state.dismissChecked = e.target.checked;
    });
    // Click outside → close
    document.getElementById('onbOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'onbOverlay') close();
    });
    // Arrow key navigation
    document.addEventListener('keydown', (e) => {
      const overlay = document.getElementById('onbOverlay');
      if (!overlay?.classList.contains('open')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    });
    // Swipe (touch) — basic horizontal swipe detection
    let touchStartX = 0;
    const stage = document.querySelector('.onb-stage');
    if (stage) {
      stage.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
      stage.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) < 40) return;
        if (dx > 0) prev(); else next();
      }, { passive: true });
    }
  }

  function _renderSlide() {
    if (!_state) return;
    const img = document.getElementById('onbImg');
    const cur = _state.images[_state.idx];
    img.src = cur;
    document.getElementById('onbCounter').textContent =
      `${_state.idx + 1} / ${_state.images.length}`;
    document.getElementById('onbPrev').disabled = _state.idx === 0;
    document.getElementById('onbNext').disabled = _state.idx === _state.images.length - 1;
    // Dots
    const dots = document.getElementById('onbDots');
    dots.innerHTML = _state.images.map((_, i) =>
      `<div class="onb-dot ${i === _state.idx ? 'active' : ''}" data-idx="${i}"></div>`
    ).join('');
    dots.querySelectorAll('.onb-dot').forEach(d => {
      d.addEventListener('click', () => {
        _state.idx = parseInt(d.dataset.idx, 10);
        _renderSlide();
      });
    });
  }

  function prev() {
    if (!_state || _state.idx === 0) return;
    _state.idx--;
    _renderSlide();
  }

  function next() {
    if (!_state || _state.idx === _state.images.length - 1) return;
    _state.idx++;
    _renderSlide();
  }

  function show(opts = {}) {
    const { key = 'default', images = [], force = false } = opts;
    if (!images.length) return;
    if (!force && isDismissed(key)) return;

    ensureDom();
    _state = { key, images, idx: 0, dismissChecked: false, force };
    document.getElementById('onbDismissChk').checked = false;
    _renderSlide();
    // Preload all images in background
    images.forEach(src => { const i = new Image(); i.src = src; });
    requestAnimationFrame(() => {
      document.getElementById('onbOverlay').classList.add('open');
    });
  }

  function close() {
    if (!_state) return;
    if (_state.dismissChecked) setDismissed(_state.key, true);
    document.getElementById('onbOverlay').classList.remove('open');
    _state = null;
  }

  // Manual reset (สำหรับ debug หรือปุ่ม "รีเซ็ตคู่มือ" ใน admin)
  function reset(key) {
    setDismissed(key, false);
  }

  return { show, close, isDismissed, reset };
})();
