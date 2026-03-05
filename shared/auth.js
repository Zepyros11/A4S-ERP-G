// ============================================================
// A4S-ERP — Auth Guard
// วิธีใช้: ใส่ <script src="../../shared/auth.js"></script>
//          ก่อน sidebar.js ในทุกหน้าที่ต้องการป้องกัน
// ============================================================

(function () {
  // ── 1. อ่าน Session ──────────────────────────────────────
  function getSession() {
    // ลอง localStorage ก่อน (remember me), แล้ว sessionStorage
    const local = localStorage.getItem("erp_session");
    const session = sessionStorage.getItem("erp_session");
    if (local) return JSON.parse(local);
    if (session) return JSON.parse(session);
    return null;
  }

  const session = getSession();

  // ── 2. ถ้าไม่มี session → redirect ไป login ──────────────
  if (!session) {
    // จำ URL ที่ผู้ใช้พยายามเข้า เพื่อ redirect กลับหลัง login
    sessionStorage.setItem("erp_redirect", window.location.pathname);
    window.location.replace("../../login.html");
    throw new Error("Not authenticated"); // หยุด script ที่เหลือ
  }

  // ── 3. เปิดให้ page อื่นเข้าถึง session ได้ ─────────────
  window.ERP_USER = session;

  // ── 4. Logout function ───────────────────────────────────
  window.erpLogout = function () {
    if (!confirm("ออกจากระบบ?")) return;
    localStorage.removeItem("erp_session");
    sessionStorage.removeItem("erp_session");
    window.location.replace("../../login.html");
  };

  // ── 5. Inject User chip ใน Topbar (รอ DOM) ──────────────
  // sidebar.js จะ inject topbar ทีหลัง เราต้องรอ
  function injectUserChip() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;

    // ถ้า chip มีแล้วข้ามไป
    if (document.getElementById("erp-user-chip")) return;

    const ROLE_LABEL = {
      ADMIN: "👑",
      MANAGER: "🏢",
      WAREHOUSE: "🏭",
      SALES: "💰",
      VIEWER: "👁",
    };

    const chip = document.createElement("div");
    chip.id = "erp-user-chip";
    chip.style.cssText = `
      margin-left:auto; display:flex; align-items:center; gap:10px;
    `;
    chip.innerHTML = `
      <style>
        .erp-chip-wrap { display:flex; align-items:center; gap:8px; position:relative; }
        .erp-avatar {
          width:32px; height:32px; border-radius:50%;
          background:rgba(255,255,255,.18);
          border:2px solid rgba(255,255,255,.3);
          display:flex; align-items:center; justify-content:center;
          font-size:13px; font-weight:700; color:#fff;
          cursor:pointer; user-select:none;
          transition:all .18s;
          font-family:'Sarabun',sans-serif;
        }
        .erp-avatar:hover { background:rgba(255,255,255,.28); }
        .erp-user-name { font-size:13px; color:rgba(255,255,255,.9); font-family:'Sarabun',sans-serif; white-space:nowrap; }
        .erp-user-role { font-size:10px; color:rgba(255,255,255,.55); font-family:'Sarabun',sans-serif; }
        .erp-dropdown {
          position:absolute; top:calc(100% + 10px); right:0;
          background:#fff; border-radius:10px; min-width:200px;
          box-shadow:0 8px 32px rgba(0,0,0,.18); border:1px solid #e4e8ef;
          overflow:hidden; z-index:500;
          display:none; animation:dropIn .18s ease;
        }
        .erp-dropdown.open { display:block; }
        @keyframes dropIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .erp-drop-header { padding:14px 16px; background:#f8f9fb; border-bottom:1px solid #e4e8ef; }
        .erp-drop-name { font-size:14px; font-weight:600; color:#111827; }
        .erp-drop-meta { font-size:11px; color:#9ca3af; margin-top:2px; font-family:'IBM Plex Mono',monospace; }
        .erp-drop-item {
          display:flex; align-items:center; gap:10px;
          padding:11px 16px; font-size:13.5px; font-family:'Sarabun',sans-serif;
          color:#374151; cursor:pointer; transition:background .12s; text-decoration:none;
        }
        .erp-drop-item:hover { background:#f0f2f5; }
        .erp-drop-divider { height:1px; background:#e4e8ef; }
        .erp-drop-item.danger { color:#9b1c1c; }
        .erp-drop-item.danger:hover { background:#fde8e8; }
      </style>

      <div class="erp-chip-wrap" id="erpChipWrap">
        <div style="text-align:right">
          <div class="erp-user-name">${session.first_name} ${session.last_name}</div>
          <div class="erp-user-role">${ROLE_LABEL[session.role] || "👤"} ${session.role}</div>
        </div>
        <div class="erp-avatar" onclick="toggleUserMenu()" id="erpAvatar">
          ${(session.first_name[0] || "?").toUpperCase()}${(session.last_name?.[0] || "").toUpperCase()}
        </div>

        <div class="erp-dropdown" id="erpDropdown">
          <div class="erp-drop-header">
            <div class="erp-drop-name">${session.first_name} ${session.last_name}</div>
            <div class="erp-drop-meta">@${session.username} · ${session.role}</div>
          </div>
          <a class="erp-drop-item" href="/modules/settings/settings.html">⚙️ ตั้งค่าระบบ</a>
          <div class="erp-drop-divider"></div>
          <div class="erp-drop-item danger" onclick="erpLogout()">🚪 ออกจากระบบ</div>
        </div>
      </div>
    `;

    // ลบ topbar-actions เดิม (ถ้ามี) แล้วใส่ chip แทน
    const existingActions = topbar.querySelector(".topbar-actions");
    if (existingActions) {
      // ย้าย actions ไปอยู่ก่อน chip
      chip.insertBefore(existingActions, chip.firstChild);
    }
    topbar.appendChild(chip);
  }

  // Toggle dropdown
  window.toggleUserMenu = function () {
    const dd = document.getElementById("erpDropdown");
    if (dd) dd.classList.toggle("open");
  };

  // ปิด dropdown เมื่อคลิกที่อื่น
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("erpChipWrap");
    if (wrap && !wrap.contains(e.target)) {
      const dd = document.getElementById("erpDropdown");
      if (dd) dd.classList.remove("open");
    }
  });

  // รอ topbar ถูก inject โดย sidebar.js
  const observer = new MutationObserver(() => {
    if (document.querySelector(".topbar")) {
      injectUserChip();
      // รอ sidebar inject topbar-actions ด้วย
      setTimeout(injectUserChip, 100);
      observer.disconnect();
    }
  });

  // ลอง inject ทันทีก่อน (กรณี topbar มีอยู่แล้ว)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectUserChip();
      setTimeout(injectUserChip, 150);
    });
  } else {
    injectUserChip();
    setTimeout(injectUserChip, 150);
  }

  observer.observe(document.body, { childList: true, subtree: true });
})();
