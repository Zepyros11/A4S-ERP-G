/* ============================================================
   topbar-calendar.js — Standalone Topbar Component
   path: js/components/navigation/topbar-calendar.js

   Usage (in any standalone page):
     <div id="calTopbarContainer"></div>
     <script src="PATH/topbar-calendar.js"></script>
     <script>
       CalTopbar.init({
         container: "calTopbarContainer",
         cssPath: "PATH/topbar-calendar.css",
         pageName: "ปฏิทินกิจกรรม",
         logoPath: "PATH/assets/images/logo.png",
       });
     </script>
============================================================ */

const CalTopbar = (function () {
  function loadCSS(href) {
    // ป้องกัน load ซ้ำ
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
      logoPath = "",
      cssPath = "",
    } = opts || {};

    // 1. Load CSS
    if (cssPath) loadCSS(cssPath);

    // 2. Build DOM
    const wrap = document.getElementById(container);
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="cal-topbar">
        <div class="cal-topbar-left">
          ${
            logoPath
              ? `<img src="${logoPath}" alt="A4S ERP" class="cal-topbar-logo"
                    onerror="this.style.display='none'">`
              : ""
          }
          <span class="cal-topbar-brand">A4S ERP</span>
          <span class="cal-topbar-sep">/</span>
          <span class="cal-topbar-page">${pageName}</span>
        </div>
        <div class="cal-topbar-right">
          <span class="cal-topbar-date" id="calTopbarDate"></span>
        </div>
      </div>
    `;

    // 3. Set date
    const dateEl = document.getElementById("calTopbarDate");
    if (dateEl) dateEl.textContent = formatDateTH(new Date());
  }

  return { init: render };
})();
