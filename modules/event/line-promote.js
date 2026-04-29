/* ============================================================
   line-promote.js — LINE Promote Scheduler (per event)
   --------------------------------------------------------------
   - 1 event → up to N posts (D-7/3/2/1/0 หรือ manual)
   - target_type = 'group' (LINE group) — default
   - cron at ai-proxy/server.js → /cron/line-promote
============================================================ */

// ── Supabase helpers ──────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function fetchEvents() {
  // โหลดเฉพาะ event ตั้งแต่ 30 วันก่อนถึงอนาคต (promote ใช้กับ event ที่ยังไม่ผ่าน)
  // + limit 500 เพื่อกัน statement timeout บน Supabase
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return (
    sbFetch(
      "events",
      `?select=event_id,event_name,event_code,event_date,end_date,start_time,end_time,location&event_date=gte.${since}&order=event_date.asc&limit=500`,
    ) || []
  );
}

async function fetchLineGroups(includeInactive = false) {
  const filter = includeInactive ? "" : "&is_active=eq.true";
  return (
    sbFetch(
      "line_groups",
      `?select=*${filter}&order=is_default.desc,is_active.desc,group_name.asc`,
    ) || []
  );
}

async function fetchPosts(eventId) {
  return (
    sbFetch(
      "line_scheduled_posts",
      `?event_id=eq.${eventId}&select=*&order=scheduled_at.asc`,
    ) || []
  );
}

// ── STATE ─────────────────────────────────────────────────
let allEvents = [];
let allGroups = [];
let allPosts = [];
let currentEventId = null;
let currentEvent = null;
let editingId = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    // โหลด events (จำเป็น) + line_groups (ไม่ต้องบล็อก ถ้า migration 051 ยังไม่รันก็ปล่อยว่างได้)
    allEvents = await fetchEvents();
    allGroups = await fetchLineGroups().catch((e) => {
      console.warn("fetchLineGroups failed:", e.message);
      showToast("ยังไม่มีตาราง line_groups — รัน migration 051 ก่อน", "error");
      return [];
    });
    populateEventSelect();

    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id");
    if (urlEventId) {
      document.getElementById("eventSelect").value = urlEventId;
      await loadEvent(parseInt(urlEventId));
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
  bindFilterListeners();
}

function populateEventSelect() {
  const sel = document.getElementById("eventSelect");
  sel.innerHTML = '<option value="">-- เลือกกิจกรรม --</option>';
  allEvents.forEach((e) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${e.event_id}">[${e.event_code || ""}] ${escapeHtml(e.event_name)}</option>`,
    ),
  );
}

// ── EVENT CHANGE ──────────────────────────────────────────
window.onEventChange = async function () {
  const val = document.getElementById("eventSelect").value;
  if (!val) {
    showSections(false);
    return;
  }
  await loadEvent(parseInt(val));
};

async function loadEvent(eventId) {
  currentEventId = eventId;
  currentEvent = allEvents.find((e) => e.event_id === eventId) || null;
  showLoading(true);
  try {
    allPosts = await fetchPosts(eventId);
    showSections(true);
    renderEventHeader();
    updateStats();
    renderTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function showSections(show) {
  document.getElementById("lpContent").style.display = show ? "block" : "none";
  document.getElementById("noEventState").style.display = show ? "none" : "block";
  document.getElementById("lpActionBtns").style.display = show ? "block" : "none";
}

function renderEventHeader() {
  const el = document.getElementById("lpEventHeader");
  if (!el || !currentEvent) return;
  const dateStr = formatDMY(currentEvent.event_date);
  const time = (currentEvent.start_time || "").slice(0, 5);
  const meta = [
    dateStr ? `📅 ${dateStr}` : "",
    time ? `🕐 ${time}` : "",
    currentEvent.location ? `📍 ${escapeHtml(currentEvent.location)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  el.innerHTML = `
    <div class="lp-evt-icon">📢</div>
    <div class="lp-evt-info">
      <div class="lp-evt-name">${escapeHtml(currentEvent.event_name || "")}</div>
      <div class="lp-evt-meta">${meta}</div>
    </div>
    <div class="lp-evt-count">${allPosts.length} โพสต์</div>
  `;
}

function updateStats() {
  const total = allPosts.length;
  const sched = allPosts.filter((p) => p.status === "SCHEDULED").length;
  const sent = allPosts.filter((p) => p.status === "SENT").length;
  const fail = allPosts.filter((p) => p.status === "FAILED").length;
  setText("lpStatTotal", total);
  setText("lpStatScheduled", sched);
  setText("lpStatSent", sent);
  setText("lpStatFailed", fail);
  setText("lpCount", `${total} โพสต์`);
}

function renderTable() {
  const tbody = document.getElementById("lpTableBody");
  if (!tbody) return;
  const search = (document.getElementById("lpSearchInput")?.value || "").toLowerCase();
  const stat = document.getElementById("lpFilterStatus")?.value || "";

  const list = allPosts.filter((p) => {
    if (search && !(p.message_text || "").toLowerCase().includes(search)) return false;
    if (stat && p.status !== stat) return false;
    return true;
  });

  document.getElementById("lpCount").textContent = `${list.length} โพสต์`;

  if (!list.length) {
    const totalPosts = allPosts.length;
    const showAutoCreate = totalPosts === 0 && !!currentEvent?.event_date;
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <div class="empty-text">ยังไม่มีโพสต์${totalPosts > 0 ? "ที่ตรงเงื่อนไข filter" : ""}</div>
        ${showAutoCreate ? `
          <button class="btn btn-primary" data-perm="line_promote_create"
            style="margin-top:14px"
            onclick="window.autoCreateLpPosts()">
            ⚡ สร้างกำหนดการอัตโนมัติ (D-7, D-3, D-2, D-1)
          </button>
          <div style="font-size:11px;color:var(--text3);margin-top:6px">
            จะสร้าง 4 โพสต์ที่ 09:00 น. (เวลาไทย) — แก้ไขได้ภายหลัง
          </div>
        ` : ""}
      </div></td></tr>`;
    if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
    return;
  }

  tbody.innerHTML = list
    .map((p) => {
      const grp = allGroups.find((g) => g.group_id === p.target_id);
      const groupLabel = grp
        ? escapeHtml(grp.group_name || grp.group_id.slice(0, 10) + "…")
        : p.target_type === "broadcast"
          ? "📣 ทุกคน"
          : p.target_id
            ? `<span style="color:var(--text3)">${p.target_id.slice(0, 10)}…</span>`
            : "—";
      const canEdit = p.status === "SCHEDULED" || p.status === "DRAFT";
      const canCancel = p.status === "SCHEDULED";
      return `<tr>
        <td class="col-center">${ddayBadge(p.promote_offset)}</td>
        <td><div class="lp-msg-cell">${escapeHtml(p.message_text || "")}</div></td>
        <td class="col-center" style="font-size:12px">${groupLabel}</td>
        <td class="col-center" style="font-size:12px">${formatDateTime(p.scheduled_at)}</td>
        <td class="col-center"><span class="lp-status-badge lpstat-${p.status}">${statusLabel(p.status)}</span></td>
        <td class="col-center">
          <div class="action-group">
            ${canEdit ? `<button class="btn-icon" data-perm="line_promote_edit" onclick="window.openLpModal(${p.id})" title="แก้ไข">✏️</button>` : ""}
            ${canCancel ? `<button class="btn-icon danger" data-perm="line_promote_cancel" onclick="window.cancelLpPost(${p.id})" title="ยกเลิก">🚫</button>` : ""}
            ${p.status === "FAILED" ? `<button class="btn-icon" data-perm="line_promote_edit" onclick="window.retryLpPost(${p.id})" title="ลองใหม่">🔄</button>` : ""}
          </div>
        </td>
      </tr>`;
    })
    .join("");

  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
}

function ddayBadge(offset) {
  if (offset == null) return `<span class="lp-dday-badge lp-dday-manual">manual</span>`;
  const cls = offset === 0 ? "lp-dday-0" :
              offset === 1 ? "lp-dday-1" :
              offset === 2 ? "lp-dday-2" :
              offset === 3 ? "lp-dday-3" :
              offset === 7 ? "lp-dday-7" : "";
  const txt = offset === 0 ? "D-day" : `D-${offset}`;
  return `<span class="lp-dday-badge ${cls}">${txt}</span>`;
}

function statusLabel(s) {
  return (
    {
      DRAFT: "📝 Draft",
      SCHEDULED: "📅 รอส่ง",
      SENT: "✅ ส่งแล้ว",
      FAILED: "❌ ล้มเหลว",
      CANCELLED: "🚫 ยกเลิก",
    }[s] || s || "—"
  );
}

function bindFilterListeners() {
  document.getElementById("lpSearchInput")?.addEventListener("input", renderTable);
  document.getElementById("lpFilterStatus")?.addEventListener("change", renderTable);
}

// ── Modal ─────────────────────────────────────────────────
window.openLpModal = function (id = null) {
  if (!allGroups.length) {
    showToast("ยังไม่มีกลุ่ม LINE — เชิญบอท @949bctau เข้ากลุ่มก่อน", "error");
    return;
  }
  editingId = id;

  document.getElementById("lpModalTitle").textContent = id ? "✏️ แก้ไขโพสต์ LINE" : "📅 สร้างโพสต์ LINE";
  document.getElementById("fLpId").value = id || "";

  // populate groups
  const grpSel = document.getElementById("fLpGroup");
  const defaultGrp = allGroups.find((g) => g.is_default) || allGroups[0];
  grpSel.innerHTML = allGroups
    .map((g) => {
      const tag = g.is_default ? " ⭐" : "";
      const name = g.group_name || g.group_id.slice(0, 10) + "…";
      return `<option value="${escapeHtml(g.group_id)}">${escapeHtml(name)}${tag}</option>`;
    })
    .join("");
  grpSel.value = defaultGrp?.group_id || "";

  // defaults: D-1 at 09:00
  document.getElementById("fLpOffset").value = "1";
  document.getElementById("fLpTime").value = "09:00";
  document.getElementById("fLpMessage").value = "";

  if (id) {
    const p = allPosts.find((x) => x.id === id);
    if (p) {
      grpSel.value = p.target_id || "";
      document.getElementById("fLpOffset").value = p.promote_offset != null ? String(p.promote_offset) : "";
      document.getElementById("fLpMessage").value = p.message_text || "";
      const sched = new Date(p.scheduled_at);
      document.getElementById("fLpDate").value = toBkkDateStr(sched);
      document.getElementById("fLpTime").value = toBkkTimeStr(sched);
    }
  } else {
    // for new posts → date defaults from D-1 of event_date
    syncDateFromOffset();
  }

  updateDayHint();
  lpUpdateCharCount();
  document.getElementById("lpModalOverlay").classList.add("open");
};

window.closeLpModal = function () {
  document.getElementById("lpModalOverlay").classList.remove("open");
  editingId = null;
};

window.lpUpdateCharCount = function () {
  const len = (document.getElementById("fLpMessage").value || "").length;
  const el = document.getElementById("fLpCharCount");
  if (el) el.textContent = `${len} ตัวอักษร`;
};

// auto-sync date when offset changes
document.addEventListener("change", (e) => {
  if (e.target.id === "fLpOffset") {
    syncDateFromOffset();
    updateDayHint();
  }
  if (e.target.id === "fLpDate") updateDayHint();
});

function syncDateFromOffset() {
  if (!currentEvent?.event_date) return;
  const offsetStr = document.getElementById("fLpOffset").value;
  if (offsetStr === "") return;
  const offset = parseInt(offsetStr, 10);
  const eventDate = parseYMD(currentEvent.event_date);
  if (!eventDate) return;
  const target = new Date(eventDate);
  target.setDate(target.getDate() - offset);
  document.getElementById("fLpDate").value = toBkkDateStr(target);
}

function updateDayHint() {
  const hint = document.getElementById("lpDayHint");
  if (!hint || !currentEvent?.event_date) return;
  const dateStr = document.getElementById("fLpDate").value;
  if (!dateStr) {
    hint.textContent = "";
    return;
  }
  const eventDate = parseYMD(currentEvent.event_date);
  const sendDate = parseYMD(dateStr);
  if (!eventDate || !sendDate) return;
  const diffMs = eventDate - sendDate;
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays > 0) {
    hint.textContent = `📅 ก่อนวันงาน ${diffDays} วัน (Event: ${formatDMY(currentEvent.event_date)})`;
  } else if (diffDays === 0) {
    hint.textContent = `🔥 วันงาน (${formatDMY(currentEvent.event_date)})`;
  } else {
    hint.textContent = `⚠️ หลังวันงานแล้ว ${Math.abs(diffDays)} วัน`;
  }
}

// ── Save / Schedule ───────────────────────────────────────
window.saveLpPost = async function () {
  const message = document.getElementById("fLpMessage").value.trim();
  if (!message) return showToast("กรุณาใส่ข้อความ", "error");
  if (message.length > 5000) return showToast("ข้อความเกิน 5000 ตัวอักษร", "error");

  const groupId = document.getElementById("fLpGroup").value;
  if (!groupId) return showToast("กรุณาเลือกกลุ่ม LINE", "error");

  const dateStr = document.getElementById("fLpDate").value;
  const timeStr = document.getElementById("fLpTime").value;
  if (!dateStr || !timeStr) return showToast("กรุณาเลือกวันเวลา", "error");

  const offsetStr = document.getElementById("fLpOffset").value;
  const promote_offset = offsetStr === "" ? null : parseInt(offsetStr, 10);

  const scheduled_at = `${dateStr}T${timeStr}:00+07:00`;

  const grp = allGroups.find((g) => g.group_id === groupId);
  const channel_id = grp?.channel_id || null;

  const session = (() => {
    try {
      return JSON.parse(localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session") || "{}");
    } catch { return {}; }
  })();

  const btn = document.getElementById("btnSaveLp");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบันทึก...";
  showLoading(true);

  try {
    const body = {
      event_id: currentEventId,
      target_type: "group",
      target_id: groupId,
      channel_id,
      promote_offset,
      message_text: message,
      scheduled_at,
      status: "SCHEDULED",
    };

    if (editingId) {
      await sbFetch("line_scheduled_posts", `?id=eq.${editingId}`, {
        method: "PATCH",
        body,
      });
      showToast("แก้ไขโพสต์แล้ว", "success");
    } else {
      body.created_by = session?.user_id || null;
      await sbFetch("line_scheduled_posts", "", { method: "POST", body });
      showToast("schedule โพสต์ LINE แล้ว 📅", "success");
    }
    window.closeLpModal();
    allPosts = await fetchPosts(currentEventId);
    renderEventHeader();
    updateStats();
    renderTable();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📅 บันทึก";
    showLoading(false);
  }
};

// ── Groups Management Modal ───────────────────────────────
let _allGroupsIncludingInactive = [];
window.openGroupsModal = async function () {
  showLoading(true);
  try {
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    renderGroupsList();
    document.getElementById("groupsModalOverlay").classList.add("open");
  } catch (e) {
    showToast("โหลดกลุ่มไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.closeGroupsModal = function () {
  document.getElementById("groupsModalOverlay").classList.remove("open");
};

function renderGroupsList() {
  const box = document.getElementById("groupsList");
  if (!box) return;
  const list = _allGroupsIncludingInactive;
  if (!list.length) {
    box.innerHTML = `<div class="empty-state" style="padding:30px">
      <div class="empty-icon">👥</div>
      <div class="empty-text">ยังไม่มีกลุ่ม LINE — เชิญบอท @949bctau เข้ากลุ่มก่อน</div>
    </div>`;
    return;
  }
  box.innerHTML = list
    .map((g) => {
      const joined = g.joined_at
        ? new Date(g.joined_at).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" })
        : "—";
      return `<div class="lp-group-row ${g.is_default ? "is-default" : ""} ${!g.is_active ? "is-inactive" : ""}">
        <div class="lp-group-info">
          <input type="text" class="form-input lp-group-name-input"
            value="${escapeHtml(g.group_name || "")}"
            placeholder="ตั้งชื่อกลุ่ม..."
            onchange="window.renameGroup(${g.id}, this.value)" />
          <div class="lp-group-meta">
            <code>${escapeHtml(g.group_id.slice(0, 16))}…</code>
            · เข้าเมื่อ ${joined}
            ${g.is_active ? "" : ' · <span style="color:var(--danger)">inactive</span>'}
          </div>
        </div>
        <div class="lp-group-actions">
          ${g.is_default
            ? `<span class="lp-default-badge">⭐ default</span>`
            : `<button class="btn-icon" title="ตั้งเป็น default" onclick="window.setDefaultGroup(${g.id})">⭐</button>`}
          <button class="btn-icon ${g.is_active ? "" : "btn-icon-dim"}" title="${g.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}" onclick="window.toggleGroupActive(${g.id}, ${!g.is_active})">${g.is_active ? "🔕" : "🔔"}</button>
        </div>
      </div>`;
    })
    .join("");
}

window.renameGroup = async function (id, name) {
  try {
    await sbFetch("line_groups", `?id=eq.${id}`, {
      method: "PATCH",
      body: { group_name: name.trim() || null },
    });
    showToast("เปลี่ยนชื่อแล้ว", "success");
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    renderGroupsList();
  } catch (e) {
    showToast("เปลี่ยนชื่อไม่ได้: " + e.message, "error");
  }
};

window.setDefaultGroup = async function (id) {
  showLoading(true);
  try {
    // unset existing defaults ก่อน
    await sbFetch("line_groups", `?is_default=eq.true`, {
      method: "PATCH",
      body: { is_default: false },
    });
    // set new default
    await sbFetch("line_groups", `?id=eq.${id}`, {
      method: "PATCH",
      body: { is_default: true },
    });
    showToast("ตั้งเป็น default แล้ว ⭐", "success");
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    renderGroupsList();
  } catch (e) {
    showToast("ตั้ง default ไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.runLpDiag = async function () {
  const out = document.getElementById("lpDiagOutput");
  if (!out) return;
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  out.style.display = "block";
  out.textContent = "⏳ กำลังตรวจสอบ...\n(ครั้งแรกอาจรอ ~30s ถ้า Render หลับอยู่)";

  if (!proxyBase) {
    out.textContent = "❌ ยังไม่ได้ตั้ง erp_proxy_url ใน localStorage\n→ ไปที่หน้า Settings ตั้งค่า Proxy URL ก่อน";
    return;
  }

  try {
    const r = await fetch(`${proxyBase}/line/diag`, { cache: "no-store" });
    const data = await r.json();
    let txt = "";
    txt += `🕐 Server time: ${data.server_time}\n\n`;

    txt += "📦 Environment Variables (Render):\n";
    for (const [k, v] of Object.entries(data.env || {})) {
      txt += `  ${v ? "✅" : "❌"} ${k}\n`;
    }
    txt += "\n";

    txt += "🗄️  Database Tables:\n";
    for (const [name, info] of Object.entries(data.tables || {})) {
      txt += `  ${info.exists ? "✅" : "❌"} ${name}`;
      if (info.exists) txt += ` (${info.rows} row visible)\n`;
      else txt += ` — ${info.error || "?"}\n${info.hint ? "      💡 " + info.hint + "\n" : ""}`;
    }
    txt += "\n";

    txt += `🚦 Ready for webhook insert: ${data.ready_for_webhook_insert ? "✅ YES" : "❌ NO"}\n`;
    txt += `🚦 Ready for cron send:      ${data.ready_for_cron_send ? "✅ YES" : "❌ NO"}\n`;

    if (data.issues?.length) {
      txt += "\n⚠️  Issues to fix:\n";
      data.issues.forEach((i) => { txt += `  • ${i}\n`; });
    }

    out.textContent = txt;
  } catch (e) {
    out.textContent = `❌ ติดต่อ proxy ไม่ได้: ${e.message}\n\nProxy URL: ${proxyBase}\n\nเช็ค:\n  • Render service อยู่หรือไม่ (เปิด ${proxyBase}/ ในแท็บใหม่)\n  • erp_proxy_url ใน localStorage ถูกต้องไหม`;
  }
};

window.manualAddGroup = async function () {
  const gid = document.getElementById("fManualGroupId").value.trim();
  const gname = document.getElementById("fManualGroupName").value.trim();
  if (!gid) return showToast("กรุณาใส่ groupId", "error");
  if (!/^[CR][a-f0-9]{32}$/i.test(gid)) {
    return showToast("groupId ต้องเป็นรูปแบบ Cxxxxxx... (33 ตัวอักษร)", "error");
  }
  showLoading(true);
  try {
    await sbFetch("line_groups", "", {
      method: "POST",
      body: {
        group_id: gid,
        group_name: gname || null,
        is_active: true,
        joined_at: new Date().toISOString(),
      },
    });
    showToast("เพิ่มกลุ่มแล้ว ✅", "success");
    document.getElementById("fManualGroupId").value = "";
    document.getElementById("fManualGroupName").value = "";
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    renderGroupsList();
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("duplicate") || msg.includes("23505")) {
      showToast("groupId นี้มีอยู่แล้ว", "error");
    } else {
      showToast("เพิ่มไม่สำเร็จ: " + msg, "error");
    }
  }
  showLoading(false);
};

window.toggleGroupActive = async function (id, makeActive) {
  try {
    await sbFetch("line_groups", `?id=eq.${id}`, {
      method: "PATCH",
      body: { is_active: makeActive },
    });
    showToast(makeActive ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว", "success");
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    renderGroupsList();
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่ได้: " + e.message, "error");
  }
};

// ── Auto-create D-7/3/2/1 posts for current event ─────────
window.autoCreateLpPosts = async function () {
  if (!currentEvent || !currentEvent.event_date) {
    return showToast("ไม่พบข้อมูล event", "error");
  }
  if (!allGroups.length) {
    return showToast("ยังไม่มีกลุ่ม LINE — เชิญบอท @949bctau เข้ากลุ่มก่อน", "error");
  }
  const defaultGroup = allGroups.find((g) => g.is_default) || allGroups[0];

  const session = (() => {
    try {
      return JSON.parse(localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session") || "{}");
    } catch { return {}; }
  })();

  const eventName = currentEvent.event_name || "";
  const eventDateStr = formatDMY(currentEvent.event_date);
  const startTime = (currentEvent.start_time || "").slice(0, 5);
  const location = currentEvent.location || "";
  const meta = [
    eventDateStr ? `📅 ${eventDateStr}` : "",
    startTime ? `🕐 ${startTime}` : "",
    location ? `📍 ${location}` : "",
  ].filter(Boolean).join("\n");

  const templates = {
    7: `📢 ขอประชาสัมพันธ์กิจกรรม\n\n🎯 ${eventName}\n\n${meta}\n\n⏰ เหลืออีก 7 วัน — เตรียมตัวให้พร้อม!`,
    3: `🔔 อีก 3 วันก่อนถึงวันงาน!\n\n🎯 ${eventName}\n\n${meta}\n\n👉 อย่าลืมจัดเตรียมข้อมูลและเอกสารที่เกี่ยวข้อง`,
    2: `⚡ อีก 2 วัน!\n\n🎯 ${eventName}\n\n${meta}\n\n💪 เตรียมตัวให้พร้อมนะคะ`,
    1: `🚨 พรุ่งนี้แล้ว! D-1\n\n🎯 ${eventName}\n\n${meta}\n\n✅ Check-in 30 นาทีก่อนเริ่ม\n📝 เตรียมเอกสาร/อุปกรณ์ครบพร้อม`,
  };

  const eventDate = parseYMD(currentEvent.event_date);
  if (!eventDate) return showToast("วันที่งานไม่ถูกต้อง", "error");

  const rows = [7, 3, 2, 1].map((offset) => {
    const d = new Date(eventDate);
    d.setDate(d.getDate() - offset);
    return {
      event_id: currentEventId,
      target_type: "group",
      target_id: defaultGroup.group_id,
      channel_id: defaultGroup.channel_id || null,
      promote_offset: offset,
      message_text: templates[offset],
      scheduled_at: `${toBkkDateStr(d)}T09:00:00+07:00`,
      status: "SCHEDULED",
      created_by: session?.user_id || null,
    };
  });

  showLoading(true);
  try {
    await sbFetch("line_scheduled_posts", "", { method: "POST", body: rows });
    showToast("สร้างกำหนดการ 4 รายการ (D-7/3/2/1) แล้ว 📢", "success");
    allPosts = await fetchPosts(currentEventId);
    renderEventHeader();
    updateStats();
    renderTable();
  } catch (e) {
    showToast("สร้างไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── Cancel ────────────────────────────────────────────────
window.cancelLpPost = function (id) {
  const row = allPosts.find((x) => x.id === id);
  if (!row) return;
  DeleteModal.open(`ต้องการยกเลิกโพสต์ LINE นี้หรือไม่?`, async () => {
    showLoading(true);
    try {
      await sbFetch("line_scheduled_posts", `?id=eq.${id}`, {
        method: "PATCH",
        body: { status: "CANCELLED" },
      });
      showToast("ยกเลิกโพสต์แล้ว", "success");
      allPosts = await fetchPosts(currentEventId);
      updateStats();
      renderTable();
    } catch (e) {
      showToast("ยกเลิกไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── Retry (reset FAILED → SCHEDULED) ──────────────────────
window.retryLpPost = async function (id) {
  showLoading(true);
  try {
    await sbFetch("line_scheduled_posts", `?id=eq.${id}`, {
      method: "PATCH",
      body: { status: "SCHEDULED", error_message: null },
    });
    showToast("ส่งกลับเข้า queue แล้ว", "success");
    allPosts = await fetchPosts(currentEventId);
    updateStats();
    renderTable();
  } catch (e) {
    showToast("ลองใหม่ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── HELPERS ───────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function parseYMD(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}
function toBkkDateStr(d) {
  return d.toLocaleDateString("sv", { timeZone: "Asia/Bangkok" });
}
function toBkkTimeStr(d) {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function formatDMY(ymd) {
  if (!ymd) return "—";
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
