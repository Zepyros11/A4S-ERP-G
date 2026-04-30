// ============================================================
// A4S-ERP — LINE Promote Cron Keepalive
// ------------------------------------------------------------
// GitHub Actions scheduled workflows ใน free tier โดน throttle จน
// gap กว่า 1 ชั่วโมงระหว่างรอบ (verified 2026-04-30)
// → script นี้ piggyback บน user activity: ทุก 5 นาทีที่มีคนเปิด ERP
//   ตรวจว่ามี post ครบเวลาแล้วยังไม่ส่งหรือไม่ ถ้ามีก็ยิง POST ไป
//   /cron/line-promote ของ Render proxy
//
// Server-side มี throttle 30s ป้องกัน stampede เมื่อหลาย tab เปิดพร้อมกัน
// ============================================================

(function () {
  const PING_EVERY_MS    = 5 * 60 * 1000;   // 5 minutes between checks
  const STARTUP_DELAY_MS = 5 * 1000;        // wait 5s after page load (don't slow first paint)
  const LAST_PING_KEY    = "lp_last_cron_ping_at";
  const MIN_GAP_MS       = 4 * 60 * 1000;   // never ping more than once per 4 min per browser

  function getProxyBase() {
    return (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  }
  function getSbUrl() {
    return (localStorage.getItem("sb_url") || "").replace(/\/+$/, "");
  }
  function getSbKey() {
    return localStorage.getItem("sb_key") || "";
  }
  function isLoggedIn() {
    return !!(localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session"));
  }

  async function checkAndPing() {
    if (!isLoggedIn()) return;
    const proxy = getProxyBase();
    const sbUrl = getSbUrl();
    const sbKey = getSbKey();
    if (!proxy || !sbUrl || !sbKey) return;

    // Cross-tab throttle via localStorage
    const last = parseInt(localStorage.getItem(LAST_PING_KEY) || "0", 10);
    if (Date.now() - last < MIN_GAP_MS) return;

    try {
      // Light query: any SCHEDULED post overdue?
      const nowIso = new Date().toISOString();
      const url = `${sbUrl}/rest/v1/line_scheduled_posts`
        + `?status=eq.SCHEDULED`
        + `&scheduled_at=lte.${encodeURIComponent(nowIso)}`
        + `&select=id&limit=1`;
      const r = await fetch(url, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      });
      if (!r.ok) return;
      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length === 0) return; // no overdue → silent

      // Fire cron tick (don't await; let it run in background)
      localStorage.setItem(LAST_PING_KEY, String(Date.now()));
      console.log("[lineCronPing] overdue posts detected → firing /cron/line-promote");
      fetch(`${proxy}/cron/line-promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (data?.throttled) console.log("[lineCronPing] server throttled (ok)");
          else if (data?.sent != null) console.log(`[lineCronPing] tick: sent=${data.sent} failed=${data.failed}`);
        })
        .catch((e) => console.warn("[lineCronPing] ping failed:", e.message));
    } catch (e) {
      // Silent — keepalive must never break the page
    }
  }

  function start() {
    setTimeout(checkAndPing, STARTUP_DELAY_MS);
    setInterval(checkAndPing, PING_EVERY_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
