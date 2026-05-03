const BASE_PATH = window.location.hostname.includes("github.io")
  ? "/" + window.location.pathname.split("/")[1]
  : "";

export function loadTopbar(title = "", options = {}) {
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

/* ── Action Links ── */
.topbar-actions{
  display:flex;
  align-items:center;
  gap:8px;
  margin-right:4px;
}

.topbar-action{
  display:inline-flex;
  align-items:center;
  gap:6px;
  background:rgba(255,255,255,0.12);
  border:1px solid rgba(255,255,255,0.2);
  border-radius:20px;
  padding:6px 14px;
  color:#fff;
  font-size:13px;
  font-weight:500;
  text-decoration:none;
  font-family:inherit;
  cursor:pointer;
  transition:background 0.15s;
}

.topbar-action:hover{
  background:rgba(255,255,255,0.22);
  color:#fff;
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

/* ── Bell (notification) ── */
.topbar-bell{
  position:relative;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:36px;
  height:36px;
  border-radius:50%;
  background:rgba(255,255,255,0.12);
  border:1px solid rgba(255,255,255,0.2);
  cursor:pointer;
  color:#fff;
  font-size:16px;
  transition:background 0.15s;
  font-family:inherit;
}
.topbar-bell:hover{ background:rgba(255,255,255,0.22); }
.topbar-bell-badge{
  position:absolute;
  top:-2px;
  right:-2px;
  min-width:18px;
  height:18px;
  padding:0 5px;
  border-radius:9px;
  background:#ef4444;
  color:#fff;
  font-size:10px;
  font-weight:700;
  display:none;
  align-items:center;
  justify-content:center;
  border:1.5px solid var(--accent);
  box-sizing:content-box;
}
.topbar-bell-badge.show{ display:inline-flex; }
.topbar-bell-dd{
  position:absolute;
  top:calc(100% + 8px);
  right:0;
  width:380px;
  max-height:520px;
  background:#fff;
  border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,0.15);
  display:none;
  z-index:300;
  border:1px solid rgba(0,0,0,0.07);
  flex-direction:column;
  overflow:hidden;
}
.topbar-bell-dd.open{ display:flex; animation:dropdownFadeIn 0.15s ease; }
.topbar-bell-head{
  padding:12px 16px;
  border-bottom:1px solid #f0f0f0;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-shrink:0;
}
.topbar-bell-head-title{ font-size:14px; font-weight:600; color:#1a202c; }
.topbar-bell-head-link{
  font-size:11px;
  color:var(--accent);
  cursor:pointer;
  border:none;
  background:none;
  padding:2px 6px;
  border-radius:4px;
  font-family:inherit;
}
.topbar-bell-head-link:hover{ background:#f0f9ff; text-decoration:underline; }
.topbar-bell-list{
  flex:1;
  overflow-y:auto;
  min-height:80px;
}
.topbar-bell-item{
  padding:10px 16px;
  border-bottom:1px solid #f7f8fa;
  cursor:pointer;
  transition:background 0.1s;
  display:flex;
  flex-direction:column;
  gap:4px;
}
.topbar-bell-item:last-child{ border-bottom:none; }
.topbar-bell-item:hover{ background:#f7f8fa; }
.topbar-bell-item.unread{ background:#eff6ff; }
.topbar-bell-item.unread:hover{ background:#dbeafe; }
.topbar-bell-item-title{ font-size:12.5px; font-weight:500; color:#1a202c; line-height:1.4; }
.topbar-bell-item.unread .topbar-bell-item-title{ font-weight:600; }
.topbar-bell-item-time{ font-size:10.5px; color:#718096; }
.topbar-bell-empty{
  padding:32px 16px;
  text-align:center;
  color:#a0aec0;
  font-size:12.5px;
}
.topbar-bell-foot{
  padding:8px;
  border-top:1px solid #f0f0f0;
  text-align:center;
  flex-shrink:0;
}
.topbar-bell-foot a{
  display:inline-block;
  padding:6px 12px;
  font-size:12px;
  color:var(--accent);
  text-decoration:none;
  font-weight:500;
}
.topbar-bell-foot a:hover{ text-decoration:underline; }

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

  /* ---------------- Action Links ---------------- */
  // Global action: Event Calendar (gated by evt_calendar_view perm)
  const canSeeCalendar = window.AuthZ
    ? window.AuthZ.hasPerm("evt_calendar_view")
    : true;
  const defaultActions = options.skipDefaults || !canSeeCalendar
    ? []
    : [
        {
          label: "Event Calendar",
          icon: "📅",
          href: `${BASE_PATH}/modules/event/cs-view/events-calendar.html`,
          target: "_blank",
          title: "เปิดปฏิทินกิจกรรม",
        },
      ];
  const customActions = Array.isArray(options.actions) ? options.actions : [];
  const actions = [...defaultActions, ...customActions];
  const actionsHtml = actions.length
    ? `<div class="topbar-actions">${actions
        .map((a) => {
          const target = a.target ? ` target="${a.target}"` : "";
          const title = a.title ? ` title="${a.title}"` : "";
          const icon = a.icon ? `<span>${a.icon}</span>` : "";
          const label = a.label || "";
          return `<a class="topbar-action" href="${a.href}"${target}${title}>${icon}${label}</a>`;
        })
        .join("")}</div>`
    : "";

  /* ---------------- HTML ---------------- */

  const container = document.querySelector(".topbar");

  if (!container) return;

  const html = `
<div class="topbar">
  <div class="topbar-logo"><img src="${BASE_PATH}/assets/logo/logo-a4s.png" alt="A4S" style="height:28px;vertical-align:middle;"> <span>A4S</span> -ERP</div>
  <div class="topbar-sep"></div>
  <div class="topbar-title">${title}</div>
  <div class="topbar-spacer"></div>
  ${actionsHtml}
  ${session?.user_id ? `
  <div class="topbar-bell-wrap" id="topbarBellWrap" style="position:relative">
    <button class="topbar-bell" id="topbarBellBtn" onclick="window._topbarToggleBell()" title="แจ้งเตือน">
      🔔
      <span class="topbar-bell-badge" id="topbarBellBadge">0</span>
    </button>
    <div class="topbar-bell-dd" id="topbarBellDd">
      <div class="topbar-bell-head">
        <span class="topbar-bell-head-title">🔔 แจ้งเตือน</span>
        <button class="topbar-bell-head-link" onclick="window._topbarMarkAllRead()">อ่านทั้งหมด</button>
      </div>
      <div class="topbar-bell-list" id="topbarBellList">
        <div class="topbar-bell-empty">กำลังโหลด...</div>
      </div>
      <div class="topbar-bell-foot">
        <a href="${BASE_PATH}/modules/notifications/notifications.html">ดูทั้งหมด →</a>
      </div>
    </div>
  </div>` : ''}
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
    const host = window.location.hostname;
    const BASE_PATH = host.includes("github.io")
      ? "/" + window.location.pathname.split("/")[1]
      : "";
    window.location.href = BASE_PATH + "/modules/account/account.html";
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
    // close bell dropdown too
    const bellWrap = document.getElementById("topbarBellWrap");
    const bellDd   = document.getElementById("topbarBellDd");
    if (bellWrap && bellDd && !bellWrap.contains(e.target)) {
      bellDd.classList.remove("open");
    }
  }, { capture: true });

  /* ============================================================
     Notification Bell — polling + dropdown render + mark read
     ============================================================ */
  if (session?.user_id) _initBell(session.user_id);
}

/* ── Bell logic (top-level so it can poll across reloads) ── */
function _initBell(userId) {
  const sbUrl = localStorage.getItem("sb_url") || "";
  const sbKey = localStorage.getItem("sb_key") || "";
  if (!sbUrl || !sbKey) return;

  const POLL_MS = 30000;   // poll every 30s
  const LIST_LIMIT = 15;
  const BASE_PATH = window.location.hostname.includes("github.io")
    ? "/" + window.location.pathname.split("/")[1]
    : "";

  /* ── Notification sound ──
     ลำดับความสำคัญ:
       1. ไฟล์ custom ถ้ามี (assets/sounds/notification.mp3 หรือ override ผ่าน localStorage)
       2. fallback → Web Audio synth (สังเคราะห์เสียง ไม่ต้องมีไฟล์)
     Browser autoplay policy: AudioContext/HTMLAudio ต้องผูกกับ user gesture
     จึงผูก lazy-init ใน first click/keydown */
  const SOUND_FILE = localStorage.getItem("erp_notif_sound_path")
                  || `${BASE_PATH}/assets/sounds/notification.mp3`;
  let _audioCtx = null;
  let _soundFileEl = null;     // <audio> element (lazy)
  let _soundFileReady = false; // โหลดสำเร็จแล้ว
  function _initAudio() {
    if (_audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) _audioCtx = new Ctx();
    } catch (_) {}
    // ลองโหลดไฟล์ custom — ถ้าไม่มีก็ fallback ไป synth
    try {
      _soundFileEl = new Audio(SOUND_FILE);
      _soundFileEl.preload = "auto";
      _soundFileEl.addEventListener("canplaythrough", () => { _soundFileReady = true; }, { once: true });
      _soundFileEl.addEventListener("error", () => { _soundFileEl = null; }, { once: true });
    } catch (_) {}
  }
  document.addEventListener("click", _initAudio, { once: true, capture: true });
  document.addEventListener("keydown", _initAudio, { once: true, capture: true });

  // expose สำหรับทดสอบ — เปิด console แล้วเรียก: window._erpTestNotifSound()
  window._erpTestNotifSound = () => _playNotifSound();

  function _playNotifSound() {
    // ปิดเสียงได้: localStorage.setItem('erp_notif_mute','1')
    if (localStorage.getItem("erp_notif_mute") === "1") return;

    // 1) ใช้ไฟล์ custom ถ้าโหลดสำเร็จ
    if (_soundFileEl && _soundFileReady) {
      try {
        _soundFileEl.currentTime = 0;
        const vol = parseFloat(localStorage.getItem("erp_notif_sound_volume") || "1");
        _soundFileEl.volume = Math.max(0, Math.min(1, vol));
        _soundFileEl.play().catch(() => {}); // กัน promise warning
        return;
      } catch (_) { /* fallback */ }
    }

    // 2) fallback → synth two-tone "ding-dong"
    try {
      if (!_audioCtx) return; // ยังไม่เคย interact — เงียบไว้
      if (_audioCtx.state === "suspended") _audioCtx.resume();
      const now = _audioCtx.currentTime;
      const tones = [
        { freq: 880, start: 0,    dur: 0.18 },
        { freq: 660, start: 0.16, dur: 0.30 },
      ];
      for (const t of tones) {
        const osc  = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = t.freq;
        gain.gain.setValueAtTime(0, now + t.start);
        gain.gain.linearRampToValueAtTime(0.18, now + t.start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.dur);
        osc.connect(gain);
        gain.connect(_audioCtx.destination);
        osc.start(now + t.start);
        osc.stop(now + t.start + t.dur);
      }
    } catch (_) {}
  }

  // -1 = ยังไม่เคยโหลด (จะไม่เล่นเสียงรอบแรก)
  let _lastUnreadCount = -1;

  async function _sb(path, opts = {}) {
    return fetch(`${sbUrl}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
  }

  // ลบ in-app notification ที่ "row ต้นทางถูกลบไปแล้ว" (orphan)
  // เกิดจาก notification เก่าก่อน cascade-delete หรือมีคนลบ row นอก ERP
  const ORPHAN_MAP = {
    "ibd.relocation.created": "ibd_relocation_requests",
    "ibd.complaint.created":  "ibd_complaints",
    "ibd.ewallet.created":    "ibd_ewallet_requests",
  };
  let _orphanCleanupRan = false;
  async function cleanupOrphans() {
    try {
      const triggerList = Object.keys(ORPHAN_MAP).join(",");
      const res = await _sb(
        `user_notifications?select=id,trigger_key,payload_ref&user_id=eq.${userId}&trigger_key=in.(${triggerList})&order=created_at.desc&limit=200`
      );
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) return false;

      const buckets = {};
      for (const r of rows) {
        const sid = r.payload_ref?.submission_id;
        if (sid == null) continue;
        const tbl = ORPHAN_MAP[r.trigger_key];
        if (!tbl) continue;
        (buckets[tbl] ||= []).push({ notifId: r.id, sid });
      }

      const orphanIds = [];
      for (const [tbl, items] of Object.entries(buckets)) {
        const sids = [...new Set(items.map(x => x.sid))];
        if (!sids.length) continue;
        const res2 = await _sb(`${tbl}?id=in.(${sids.join(",")})&select=id`);
        const existing = new Set((await res2.json()).map(x => x.id));
        for (const it of items) {
          if (!existing.has(it.sid)) orphanIds.push(it.notifId);
        }
      }

      if (orphanIds.length) {
        await _sb(`user_notifications?id=in.(${orphanIds.join(",")})`, { method: "DELETE" });
        return true;
      }
      return false;
    } catch (_) { return false; }
  }

  async function loadCount() {
    try {
      const res = await _sb(
        `user_notifications?select=id&user_id=eq.${userId}&read_at=is.null&limit=1`,
        { headers: { Prefer: "count=exact" } }
      );
      const total = +(res.headers.get("content-range") || "0/0").split("/")[1] || 0;

      // เล่นเสียงเมื่อ unread เพิ่มขึ้น (ข้ามรอบแรกเพื่อกัน beep ตอนโหลดหน้า)
      if (_lastUnreadCount >= 0 && total > _lastUnreadCount) {
        _playNotifSound();
      }
      _lastUnreadCount = total;

      const badge = document.getElementById("topbarBellBadge");
      if (!badge) return;
      if (total > 0) {
        badge.textContent = total > 99 ? "99+" : String(total);
        badge.classList.add("show");
      } else {
        badge.classList.remove("show");
      }
    } catch (_) { /* silent */ }
  }

  async function loadList() {
    const list = document.getElementById("topbarBellList");
    if (!list) return;
    try {
      // เช็ค orphan ก่อนแสดง — ถ้ามีลบแล้ว refresh badge ด้วย
      const cleaned = await cleanupOrphans();
      if (cleaned) loadCount();
      const res = await _sb(
        `user_notifications?select=id,trigger_key,title,link_url,payload_ref,read_at,created_at&user_id=eq.${userId}&order=created_at.desc&limit=${LIST_LIMIT}`
      );
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) {
        list.innerHTML = `<div class="topbar-bell-empty">ยังไม่มีแจ้งเตือน</div>`;
        return;
      }
      list.innerHTML = rows.map(r => {
        const unread = !r.read_at ? "unread" : "";
        const t = _fmtRelTime(r.created_at);
        const safeTitle = String(r.title || "—").replace(/[<>&"']/g, c => ({
          "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
        }[c]));
        return `<div class="topbar-bell-item ${unread}" onclick="window._topbarOpenNotif(${r.id}, '${(r.link_url || "").replace(/'/g, "\\'")}')">
          <div class="topbar-bell-item-title">${safeTitle}</div>
          <div class="topbar-bell-item-time">${t}</div>
        </div>`;
      }).join("");
    } catch (e) {
      list.innerHTML = `<div class="topbar-bell-empty">โหลดไม่สำเร็จ</div>`;
    }
  }

  function _fmtRelTime(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)   return "เมื่อสักครู่";
    if (m < 60)  return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h} ชม.ที่แล้ว`;
    const d = Math.floor(h / 24);
    if (d < 7)   return `${d} วันที่แล้ว`;
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bangkok"
      });
    } catch { return iso; }
  }

  window._topbarToggleBell = function () {
    const dd = document.getElementById("topbarBellDd");
    if (!dd) return;
    const isOpen = dd.classList.toggle("open");
    if (isOpen) loadList();
  };

  window._topbarOpenNotif = async function (id, linkUrl) {
    // mark as read first so the badge reflects the change after navigation
    try {
      await _sb(`user_notifications?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
    } catch (_) {}
    if (linkUrl) {
      window.location.href = BASE_PATH + linkUrl;
    } else {
      loadCount(); loadList();
    }
  };

  window._topbarMarkAllRead = async function () {
    try {
      await _sb(`user_notifications?user_id=eq.${userId}&read_at=is.null`, {
        method: "PATCH",
        body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
      loadCount(); loadList();
    } catch (_) {}
  };

  // initial load + interval polling
  // ทำ orphan cleanup ครั้งเดียวตอน init เพื่อให้ badge แรกถูกต้อง
  (async () => {
    if (!_orphanCleanupRan) {
      _orphanCleanupRan = true;
      await cleanupOrphans();
    }
    loadCount();
  })();
  setInterval(loadCount, POLL_MS);
}
