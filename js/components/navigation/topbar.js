export function loadTopbar(title = "") {
  /* ---------------- CSS (inject ครั้งเดียว) ---------------- */

  if (!document.getElementById("topbar-style")) {
    const style = document.createElement("style");
    style.id = "topbar-style";

    style.textContent = `

.topbar{
  background:var(--accent);
  padding:0 32px;
  height:var(--topbar-h);
  display:flex;
  align-items:center;
  gap:16px;
  position:sticky;
  top:0;
  z-index:200;
  box-shadow:0 2px 8px rgba(0,0,0,0.15);
  flex-shrink:0;
}

.topbar-logo{
  font-size:15px;
  font-weight:700;
  color:#fff;
  display:flex;
  align-items:center;
  gap:6px;
}

.topbar-logo span{
  font-weight:800;
}

.topbar-sep{
  width:1px;
  height:20px;
  background:rgba(255,255,255,0.35);
}

.topbar-title{
  font-size:14px;
  color:#fff;
  font-weight:500;
}

.topbar-spacer{
  flex:1;
}

/* ── User Menu ── */
.topbar-user{
  position:relative;
}

.topbar-user-btn{
  display:flex;
  align-items:center;
  gap:8px;
  background:rgba(255,255,255,0.12);
  border:1px solid rgba(255,255,255,0.2);
  border-radius:24px;
  padding:5px 12px 5px 5px;
  cursor:pointer;
  transition:background 0.15s;
  color:#fff;
  font-family:inherit;
  font-size:13px;
}

.topbar-user-btn:hover{
  background:rgba(255,255,255,0.22);
}

.topbar-avatar{
  width:30px;
  height:30px;
  border-radius:50%;
  background:rgba(255,255,255,0.25);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:12px;
  font-weight:700;
  color:#fff;
  overflow:hidden;
  flex-shrink:0;
}

.topbar-avatar img{
  width:100%;
  height:100%;
  object-fit:cover;
}

.topbar-user-name{
  font-weight:500;
  max-width:140px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.topbar-user-caret{
  font-size:10px;
  opacity:0.7;
  transition:transform 0.2s;
}

.topbar-user-btn[aria-expanded="true"] .topbar-user-caret{
  transform:rotate(180deg);
}

/* Dropdown */
.topbar-dropdown{
  position:absolute;
  top:calc(100% + 8px);
  right:0;
  background:#fff;
  border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,0.15);
  min-width:200px;
  overflow:hidden;
  display:none;
  z-index:300;
  border:1px solid rgba(0,0,0,0.07);
}

.topbar-dropdown.open{
  display:block;
  animation:dropdownFadeIn 0.15s ease;
}

@keyframes dropdownFadeIn{
  from{opacity:0;transform:translateY(-6px)}
  to{opacity:1;transform:translateY(0)}
}

.topbar-dropdown-header{
  padding:12px 16px;
  border-bottom:1px solid #f0f0f0;
  display:flex;
  align-items:center;
  gap:10px;
}

.topbar-dropdown-avatar{
  width:38px;
  height:38px;
  border-radius:50%;
  background:var(--accent);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:14px;
  font-weight:700;
  color:#fff;
  overflow:hidden;
  flex-shrink:0;
}

.topbar-dropdown-avatar img{
  width:100%;
  height:100%;
  object-fit:cover;
}

.topbar-dropdown-info{
  flex:1;
  min-width:0;
}

.topbar-dropdown-fullname{
  font-size:13px;
  font-weight:600;
  color:#1a202c;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.topbar-dropdown-role{
  font-size:11px;
  color:#718096;
  margin-top:1px;
}

.topbar-dropdown-item{
  display:flex;
  align-items:center;
  gap:10px;
  padding:10px 16px;
  font-size:13px;
  color:#374151;
  cursor:pointer;
  text-decoration:none;
  transition:background 0.1s;
  border:none;
  background:none;
  width:100%;
  text-align:left;
  font-family:inherit;
}

.topbar-dropdown-item:hover{
  background:#f7f8fa;
  color:#111;
}

.topbar-dropdown-item.danger{
  color:#e53e3e;
}

.topbar-dropdown-item.danger:hover{
  background:#fff5f5;
}

.topbar-dropdown-divider{
  height:1px;
  background:#f0f0f0;
  margin:2px 0;
}

`;

    document.head.appendChild(style);
  }

  /* ---------------- User data from session ---------------- */
  let session = null;
  try {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    if (raw) session = JSON.parse(raw);
  } catch (_) {}

  // fetch fresh name from DB in background and update topbar if changed
  (async () => {
    try {
      const sbUrl = localStorage.getItem("sb_url") || "";
      const sbKey = localStorage.getItem("sb_key") || "";
      if (sbUrl && sbKey && session?.user_id) {
        const res = await fetch(
          `${sbUrl}/rest/v1/users?user_id=eq.${session.user_id}&select=full_name,username,role&limit=1`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        );
        const data = await res.json();
        if (data?.[0]) {
          const db = data[0];
          const freshName = db.full_name || db.username || "";
          if (freshName) {
            const nameEl = document.getElementById("topbarUserNameText");
            const ddNameEl = document.getElementById("topbarDropdownFullname");
            const avatarEl = document.getElementById("topbarAvatar");
            const ddAvatarEl = document.getElementById("topbarDropAvatar");
            const ini = freshName.split(" ").filter(Boolean).map(w => w[0].toUpperCase()).slice(0,2).join("");
            if (nameEl) nameEl.textContent = freshName;
            if (ddNameEl) ddNameEl.textContent = freshName;
            if (avatarEl) avatarEl.textContent = ini;
            if (ddAvatarEl) ddAvatarEl.textContent = ini;
          }
        }
      }
    } catch (_) {}
  })();

  const fullName = session
    ? `${session.first_name || ""} ${session.last_name || ""}`.trim() || session.username || "User"
    : "User";

  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");

  const roleLabel = session?.role || "";

  /* ---------------- HTML ---------------- */

  const container = document.querySelector(".topbar");

  if (!container) return;

  const html = `
<div class="topbar">
  <div class="topbar-logo">📦 <span>A4S</span>-ERP</div>
  <div class="topbar-sep"></div>
  <div class="topbar-title">${title}</div>
  <div class="topbar-spacer"></div>
  <div class="topbar-user" id="topbarUserWrap">
    <button class="topbar-user-btn" id="topbarUserBtn" onclick="window._topbarToggleUserMenu()" aria-expanded="false">
      <div class="topbar-avatar" id="topbarAvatar">${initials}</div>
      <span class="topbar-user-name" id="topbarUserNameText">${fullName}</span>
      <span class="topbar-user-caret">▼</span>
    </button>
    <div class="topbar-dropdown" id="topbarDropdown">
      <div class="topbar-dropdown-header">
        <div class="topbar-dropdown-avatar" id="topbarDropAvatar">${initials}</div>
        <div class="topbar-dropdown-info">
          <div class="topbar-dropdown-fullname" id="topbarDropdownFullname">${fullName}</div>
          ${roleLabel ? `<div class="topbar-dropdown-role">${roleLabel}</div>` : ""}
        </div>
      </div>
      <button class="topbar-dropdown-item" onclick="window._topbarGoSettings()">
        ⚙️ ตั้งค่าบัญชี
      </button>
      <div class="topbar-dropdown-divider"></div>
      <button class="topbar-dropdown-item danger" onclick="window.erpLogout()">
        🚪 ออกจากระบบ
      </button>
    </div>
  </div>
</div>
`;

  container.outerHTML = html;

  /* ---------------- Toggle logic ---------------- */
  window._topbarToggleUserMenu = function () {
    const dd = document.getElementById("topbarDropdown");
    const btn = document.getElementById("topbarUserBtn");
    if (!dd) return;
    const isOpen = dd.classList.toggle("open");
    if (btn) btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  };

  window._topbarGoSettings = function () {
    const depth = window.location.pathname.split("/").length - 2;
    const prefix = depth > 0 ? "../".repeat(depth) : "./";
    window.location.href = prefix + "modules/settings/settings.html";
  };

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("topbarUserWrap");
    const dd = document.getElementById("topbarDropdown");
    const btn = document.getElementById("topbarUserBtn");
    if (!wrap || !dd) return;
    if (!wrap.contains(e.target)) {
      dd.classList.remove("open");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
  }, { capture: true });
}
