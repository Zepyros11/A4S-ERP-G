/* ============================================================
   companyLogo.js — โลโก้บริษัทใช้ร่วมทุกหน้า (global helper)
   ------------------------------------------------------------
   ที่มา: หน้า "ตั้งค่าบริษัท" เก็บ URL โลโก้ใน app_settings
          (key = company_logo_url) + cache ลง localStorage
   จุดประสงค์: ทุกที่ที่เคย hardcode โลโก้ A4S → ดึงโลโก้บริษัทแทน
              โดยมี fallback เป็นโลโก้เดิมเสมอ (ยังไม่ตั้งค่า = เหมือนเดิม)

   API (global · window.CompanyLogo):
     .cached()            → URL ใน localStorage (sync · '' ถ้าไม่มี)
     .logoUrl(fallback)   → cached() ถ้ามี ไม่งั้น fallback
     .refresh()           → fetch จาก DB → update cache → คืน URL (async)
     .onReady(cb)         → เรียก cb(url) หลัง refresh เสร็จ (หรือทันทีถ้ามี cache)
   ============================================================ */
(function () {
  "use strict";
  const KEY = "company_logo_url";

  function cached() {
    try { return localStorage.getItem(KEY) || ""; } catch (_) { return ""; }
  }
  function logoUrl(fallback) {
    const u = cached();
    return (u && u.trim()) ? u : (fallback || "");
  }

  let _refreshing = null;
  async function refresh() {
    if (_refreshing) return _refreshing;
    _refreshing = (async () => {
      let url, key;
      try { url = localStorage.getItem("sb_url"); key = localStorage.getItem("sb_key"); } catch (_) {}
      if (!url || !key) return cached();
      try {
        const res = await fetch(
          `${url}/rest/v1/app_settings?select=value&key=eq.company_logo_url`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (!res.ok) return cached();
        const rows = await res.json();
        const v = rows && rows[0] ? rows[0].value : null;
        if (typeof v === "string") {
          try { localStorage.setItem(KEY, v); } catch (_) {}
          return v;
        }
      } catch (_) { /* offline / no creds → keep cache */ }
      return cached();
    })();
    try { return await _refreshing; } finally { _refreshing = null; }
  }

  // Run cb immediately with cache, then again with the fresh DB value.
  function onReady(cb) {
    if (typeof cb !== "function") return;
    const c = cached();
    if (c) cb(c);
    refresh().then(u => { if (u && u !== c) cb(u); });
  }

  window.CompanyLogo = { cached, logoUrl, refresh, onReady, KEY };
})();
