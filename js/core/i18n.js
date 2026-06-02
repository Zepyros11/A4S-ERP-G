/* ============================================================
   i18n.js — ระบบ 2 ภาษา (ไทย/อังกฤษ) ส่วนกลางของ A4S-ERP
   ------------------------------------------------------------
   วิธีใช้ (ดู modules/trip/custom-report.* เป็นตัวอย่างนำร่อง):

   1) โหลดสคริปต์นี้ "ก่อน" page script + ก่อนไฟล์ *.lang.js
        <script src="../../js/core/i18n.js"></script>
        <script src="./custom-report.lang.js"></script>   // I18n.register({...})
        <script src="./custom-report.js"></script>

   2) ข้อความ static ใน HTML — ใส่ attribute:
        <h3 data-i18n="cr.pickCols">เลือกคอลัมน์</h3>          // textContent
        <input data-i18n-attr="placeholder:cr.search">         // attribute
        <span data-i18n-html="cr.note">...</span>              // innerHTML (ใช้เท่าที่จำเป็น)
      ค่าใน HTML = ภาษาไทย (fallback) ถ้า key ยังไม่ลง dictionary

   3) ข้อความที่ JS สร้างเอง (toast / label dynamic) — เรียก:
        I18n.t('cr.toast.saved')                 // คืน string ตามภาษาปัจจุบัน
        I18n.t('cr.col.code', fallbackThai)      // fallback ถ้าไม่มี key

   4) ปุ่มสลับภาษา — วาง element เปล่าไว้ แล้ว mount:
        <div id="langToggle"></div>
        I18n.mountToggle(document.getElementById('langToggle'));

   5) ให้ JS re-render เมื่อสลับภาษา:
        I18n.onChange(() => { renderEverything(); });

   ภาษา default = ไทย · จำค่าที่ผู้ใช้เลือกใน localStorage (ต่อ browser)
   ============================================================ */
(function (global) {
  "use strict";

  const STORE_KEY   = "erp_lang";
  const DEFAULT_LANG = "th";
  const SUPPORTED   = ["th", "en"];
  // ชื่อภาษาที่โชว์บนปุ่ม toggle (ไม่แปลตัวเอง)
  const LANG_LABEL  = { th: "ไทย", en: "EN" };

  let lang = (() => {
    let v;
    try { v = localStorage.getItem(STORE_KEY); } catch (e) { v = null; }
    return SUPPORTED.includes(v) ? v : DEFAULT_LANG;
  })();

  // dictionary: { key: { th: "...", en: "..." } }
  const dict = {};
  const listeners = [];

  // ── ลงทะเบียนคำแปล (เรียกจากไฟล์ *.lang.js) ──────────────
  function register(entries) {
    if (!entries) return;
    Object.assign(dict, entries);
  }

  // ── คืนคำแปลตามภาษาปัจจุบัน ──────────────────────────────
  // t(key)                      → คำแปลภาษาปัจจุบัน
  // t(key, "ไทย fallback")      → ใช้ fallback ถ้าไม่มี key
  // t(key, { n: 5, name: "x" }) → แทนที่ {n}/{name} ในข้อความ
  function t(key, opt) {
    const e = dict[key];
    let s;
    if (!e) s = (typeof opt === "string") ? opt : key;
    else if (e[lang] != null) s = e[lang];
    else if (e.th != null) s = e.th;   // ไทยเป็น fallback หลัก
    else s = (typeof opt === "string") ? opt : key;
    if (opt && typeof opt === "object") {
      s = String(s).replace(/\{(\w+)\}/g, (m, k) => (opt[k] != null ? opt[k] : m));
    }
    return s;
  }

  function getLang() { return lang; }
  function isRegistered(key) { return Object.prototype.hasOwnProperty.call(dict, key); }

  // ── สลับภาษา ─────────────────────────────────────────────
  function setLang(next) {
    if (!SUPPORTED.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    document.documentElement.setAttribute("lang", lang);
    apply();
    syncToggles();
    listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error("[i18n] onChange error", e); } });
  }
  function toggle() { setLang(lang === "th" ? "en" : "th"); }
  function onChange(fn) { if (typeof fn === "function") listeners.push(fn); }

  // ── แปะคำแปลลง DOM ───────────────────────────────────────
  function apply(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(el => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    // data-i18n-attr="placeholder:key; title:key"
    root.querySelectorAll("[data-i18n-attr]").forEach(el => {
      el.getAttribute("data-i18n-attr").split(";").forEach(pair => {
        const idx = pair.indexOf(":");
        if (idx < 0) return;
        const attr = pair.slice(0, idx).trim();
        const key  = pair.slice(idx + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  // ── ปุ่มสลับภาษา (segmented pill) ────────────────────────
  const _toggles = [];
  function mountToggle(target, opts) {
    if (!target) return null;
    injectToggleCss();
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "i18n-toggle" + (opts.variant === "light" ? " i18n-toggle--light" : "");
    SUPPORTED.forEach(code => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.lang = code;
      b.textContent = LANG_LABEL[code] || code.toUpperCase();
      b.title = code === "th" ? "ภาษาไทย" : "English";
      b.addEventListener("click", () => setLang(code));
      wrap.appendChild(b);
    });
    target.appendChild(wrap);
    _toggles.push(wrap);
    syncToggles();
    return wrap;
  }
  function syncToggles() {
    _toggles.forEach(w => {
      w.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", b.dataset.lang === lang);
      });
    });
  }

  let _cssDone = false;
  function injectToggleCss() {
    if (_cssDone) return;
    _cssDone = true;
    const css = `
      .i18n-toggle{display:inline-flex;align-items:center;gap:2px;padding:3px;
        border-radius:999px;background:rgba(255,255,255,.18);
        border:1px solid rgba(255,255,255,.4);vertical-align:middle;line-height:1}
      .i18n-toggle button{border:none;background:transparent;color:rgba(255,255,255,.9);
        font-family:inherit;font-size:12px;font-weight:700;padding:4px 11px;
        border-radius:999px;cursor:pointer;line-height:1;transition:.12s;white-space:nowrap}
      .i18n-toggle button:hover{color:#fff;background:rgba(255,255,255,.15)}
      .i18n-toggle button.active{background:#fff;color:var(--accent,#4b7d5e);
        box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
      /* variant สำหรับวางบนพื้นขาว/อ่อน */
      .i18n-toggle--light{background:var(--accent-pale,#eef4f0);border-color:var(--border,#e2e8f0)}
      .i18n-toggle--light button{color:var(--text2,#64748b)}
      .i18n-toggle--light button:hover{color:var(--text,#0f172a);background:rgba(0,0,0,.04)}
      .i18n-toggle--light button.active{background:var(--accent,#4b7d5e);color:#fff}
    `;
    const style = document.createElement("style");
    style.id = "i18n-toggle-css";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── boot: ตั้ง lang + แปะคำแปล static ครั้งแรก ───────────
  function boot() {
    document.documentElement.setAttribute("lang", lang);
    apply();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  global.I18n = {
    register, t, getLang, setLang, toggle, onChange, apply,
    mountToggle, isRegistered,
    SUPPORTED, DEFAULT_LANG,
  };
})(window);
