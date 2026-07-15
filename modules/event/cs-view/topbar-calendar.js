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
    const p = (n) => String(n).padStart(2, "0");
    return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  async function render(opts) {
    const {
      container = "calTopbarContainer",
      pageName = "หน้าหลัก",
      cssPath = null,
      logoPath = null,
    } = opts || {};

    const selfDir = getSelfDir();
    const resolvedCss = cssPath || selfDir + "topbar-calendar.css";
    loadCSS(resolvedCss);
    // Company logo from "ตั้งค่าบริษัท" (cached) · falls back to passed logoPath / default asset
    let _logoFallback = logoPath || selfDir + "../../../../assets/images/logo.png";
    let resolvedLogo = _logoFallback;
    try { resolvedLogo = (localStorage.getItem("company_logo_url") || "").trim() || _logoFallback; } catch (_) {}

    // fetch fresh user data from DB
    const session = window.ERP_USER || {};
    let freshUser = session;
    try {
      const sbUrl = localStorage.getItem("sb_url") || "";
      const sbKey = localStorage.getItem("sb_key") || "";
      if (sbUrl && sbKey && session.user_id) {
        const res = await fetch(
          `${sbUrl}/rest/v1/users?user_id=eq.${session.user_id}&select=full_name,username,role&limit=1`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        );
        const data = await res.json();
        if (data && data[0]) freshUser = { ...session, ...data[0] };
      }
    } catch {}

    const wrap = document.getElementById(container);
    if (!wrap) return;

    const currentPage = window.location.pathname
      .split("/")
      .pop()
      .replace(".html", "");

    const user = freshUser;
    const fullName = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "User";
    const initial = fullName.charAt(0).toUpperCase();

    wrap.innerHTML = `
      <div class="cal-topbar">
        <div class="cal-topbar-left">
          <img src="${resolvedLogo}" alt="A4S ERP" class="cal-topbar-logo" onerror="this.onerror=null;this.src='${_logoFallback}'">
          <span class="cal-topbar-sep" style="width:1px;height:20px;background:#e2e8f0;display:inline-block;flex-shrink:0"></span>
          <span class="cal-topbar-page">${pageName}</span>
        </div>
        <div class="cal-topbar-nav">
          <button class="cal-topbar-btn ${currentPage === "events-calendar" ? "active" : ""}"
            onclick="window.location.href = './events-calendar.html'">
            Event Calendar
          </button>
          <button class="cal-topbar-btn ${currentPage === "event-poster-gallery-view" ? "active" : ""}"
            onclick="window.location.href = './event-poster-gallery-view.html'">
            Poster Gallery
          </button>
          <button class="cal-topbar-btn ${currentPage === "events-bookingRoom" ? "active" : ""}"
            onclick="window.location.href = './events-bookingRoom.html'">
            Meet Booking
          </button>
        </div>
        <div class="cal-topbar-right">
          <span class="cal-topbar-date" id="calTopbarDate"></span>
          <div class="cal-user-menu" id="calUserMenu">
            <button class="cal-user-btn" onclick="document.getElementById('calUserDropdown').classList.toggle('open')">
              <div class="cal-user-avatar">${initial}</div>
              <span class="cal-user-name">${fullName}</span>
              <span class="cal-user-caret">▾</span>
            </button>
            <div class="cal-user-dropdown" id="calUserDropdown">
              <div class="cal-user-dropdown-header">
                <div class="cal-user-avatar lg">${initial}</div>
                <div>
                  <div class="cal-dropdown-name">${fullName}</div>
                  <div class="cal-dropdown-role">${user.role || ""}</div>
                </div>
              </div>
              <div class="cal-dropdown-divider"></div>
              <button class="cal-dropdown-item danger" onclick="calLogoutConfirm()">
                <span>⎋</span> ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // close dropdown on outside click
    document.addEventListener("click", (e) => {
      const menu = document.getElementById("calUserMenu");
      if (menu && !menu.contains(e.target)) {
        document.getElementById("calUserDropdown")?.classList.remove("open");
      }
    });

    // inject logout modal
    if (!document.getElementById("calLogoutModal")) {
      const m = document.createElement("div");
      m.id = "calLogoutModal";
      m.innerHTML = `
        <div class="cal-modal-overlay" id="calLogoutOverlay" onclick="calLogoutClose()">
          <div class="cal-modal-box" onclick="event.stopPropagation()">
            <div class="cal-modal-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </div>
            <div class="cal-modal-title">ออกจากระบบ</div>
            <div class="cal-modal-msg">คุณต้องการออกจากระบบใช่หรือไม่?</div>
            <div class="cal-modal-actions">
              <button class="cal-modal-btn cancel" onclick="calLogoutClose()">ยกเลิก</button>
              <button class="cal-modal-btn danger" onclick="calLogoutDo()">ออกจากระบบ</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(m);
    }

    // Set date
    const dateEl = document.getElementById("calTopbarDate");
    if (dateEl) dateEl.textContent = formatDateTH(new Date());

    // ── วัดความสูง topbar จริง → เผยเป็น CSS var (--cal-topbar-h) ให้หน้า offset ได้เป๊ะ ──
    // มือถือ (≤767) topbar wrap เป็น 2 แถว ความสูงไม่คงที่ → หน้าอย่า hardcode
    // เฉพาะ ≤767 เท่านั้น (≥768 มี global zoom 0.65 ทำให้ getBoundingClientRect เพี้ยน → ปล่อยใช้ fallback)
    const bar = wrap.querySelector(".cal-topbar");
    if (bar) {
      const applyH = () => {
        if (window.innerWidth <= 767) {
          const h = Math.round(bar.getBoundingClientRect().height);
          // h>0 กัน race ตอน CSS topbar ยังโหลดไม่เสร็จ (จะวัดได้ 0/เพี้ยน) · +2 กัน sub-pixel
          if (h > 0) document.documentElement.style.setProperty("--cal-topbar-h", (h + 2) + "px");
        } else {
          document.documentElement.style.removeProperty("--cal-topbar-h");
        }
      };
      applyH();
      requestAnimationFrame(applyH);
      window.addEventListener("resize", applyH);
      window.addEventListener("load", applyH);
      if (window.ResizeObserver) new ResizeObserver(applyH).observe(bar);
      // วัดซ้ำหลังจาก CSS/ฟอนต์/โลโก้โหลดเสร็จ (topbar อาจสูงเปลี่ยน)
      setTimeout(applyH, 300);
      setTimeout(applyH, 900);
    }

  }

  return { init: render };
})();

function calLogoutConfirm() {
  document.getElementById("calUserDropdown")?.classList.remove("open");
  document.getElementById("calLogoutOverlay").style.display = "flex";
}
function calLogoutClose() {
  document.getElementById("calLogoutOverlay").style.display = "none";
}
function calLogoutDo() {
  localStorage.removeItem("erp_session");
  sessionStorage.removeItem("erp_session");
  window.location.replace("/login.html");
}
