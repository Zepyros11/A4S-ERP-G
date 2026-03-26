/* ============================================================
   topbar-calendar.js — Standalone Topbar Component
   path: js/components/navigation/topbar-calendar.js

   Usage (in any standalone page):
     <div id="calTopbarContainer"></div>
     <script src="PATH/topbar-calendar.js"></script>
     <script>
       CalTopbar.init({
         container: "calTopbarContainer",
         pageName:  "ปฏิทินกิจกรรม",
       });
     </script>

   หมายเหตุ: cssPath และ logoPath ไม่จำเป็นต้องส่งมา
   — JS จะ detect path ของตัวเองอัตโนมัติ
============================================================ */

const CalTopbar = (function () {
  // ── หา path ของ script นี้เอง ──
  // ทำงานได้ทั้ง Live Server (localhost) และ GitHub Pages
  function getSelfDir() {
    const scripts = document.querySelectorAll("script[src]");
    for (const s of scripts) {
      if (s.src.includes("topbar-calendar.js")) {
        // ตัด filename ออก เหลือแค่ directory
        return s.src.replace(/topbar-calendar\.js.*$/, "");
      }
    }
    return "";
  }

  function loadCSS(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function formatDateTH(date) {
    return date.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function render(opts) {
    const {
      container = "calTopbarContainer",
      pageName = "หน้าหลัก",
      cssPath = null, // ถ้าไม่ส่งมา จะ auto-detect
      logoPath = null, // ถ้าไม่ส่งมา จะ auto-detect
    } = opts || {};

    const selfDir = getSelfDir();

    // 1. Load CSS — ใช้ path ที่ส่งมา หรือ auto-detect จาก script location
    const resolvedCss = cssPath || selfDir + "topbar-calendar.css";
    loadCSS(resolvedCss);

    // 2. Logo path — ขึ้นไป 4 ระดับจาก navigation/ → root → assets/
    const resolvedLogo =
      logoPath || selfDir + "../../../../assets/images/logo.png";

    // 3. Build DOM
    const wrap = document.getElementById(container);
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="cal-topbar">
        <div class="cal-topbar-left">
          <img src="${resolvedLogo}" alt="A4S ERP" class="cal-topbar-logo"
               onerror="this.style.display='none'">
          <span class="cal-topbar-brand">A4S ERP</span>
          <span class="cal-topbar-sep">/</span>
          <span class="cal-topbar-page">${pageName}</span>
        </div>
        <div class="cal-topbar-right">
          <button class="cal-topbar-btn"
            onclick="window.location.href = './events-calendar.html'">
            Event Calendar
          </button>
          <button class="cal-topbar-btn"
            onclick="window.location.href = './event-poster-gallery-view.html'">
            Poster Gallery
          </button>
          <span class="cal-topbar-date" id="calTopbarDate"></span>
        </div>
      </div>
    `;

    // 4. Set date
    const dateEl = document.getElementById("calTopbarDate");
    if (dateEl) dateEl.textContent = formatDateTH(new Date());
  }

  return { init: render };
})();
