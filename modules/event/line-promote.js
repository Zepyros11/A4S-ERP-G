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
      `?select=event_id,event_name,event_code,event_date,end_date,start_time,end_time,location,line_group_ids&event_date=gte.${since}&order=event_date.asc&limit=500`,
    ) || []
  );
}

async function fetchLineGroups(includeInactive = false) {
  const filter = includeInactive ? "" : "&is_active=eq.true";
  return (
    sbFetch(
      "line_groups",
      `?select=*${filter}&order=is_active.desc,group_name.asc`,
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
let _selectedPostIds = new Set();   // bulk selection

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id");

    // ถ้าไม่มี event_id ใน URL → no-event state ไม่ต้องโหลด events
    if (!urlEventId) {
      showSections(false);
      // โหลด groups เผื่อกดปุ่ม "จัดการกลุ่ม"
      allGroups = await fetchLineGroups().catch(() => []);
      _allGroupsIncludingInactive = allGroups;
      showLoading(false);
      bindFilterListeners();
      return;
    }

    // โหลด event เดียวที่ต้องใช้ + groups
    const evtRow = await sbFetch(
      "events",
      `?event_id=eq.${parseInt(urlEventId)}&select=event_id,event_name,event_code,event_date,end_date,start_time,end_time,location,line_group_ids&limit=1`,
    );
    allEvents = evtRow || [];
    allGroups = await fetchLineGroups().catch((e) => {
      console.warn("fetchLineGroups failed:", e.message);
      showToast("ยังไม่มีตาราง line_groups — รัน migration 051 ก่อน", "error");
      return [];
    });
    _allGroupsIncludingInactive = allGroups;

    if (allEvents.length) {
      await loadEvent(parseInt(urlEventId));
    } else {
      showToast("ไม่พบ event ที่ระบุ", "error");
      showSections(false);
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
  bindFilterListeners();
}

async function loadEvent(eventId) {
  currentEventId = eventId;
  currentEvent = allEvents.find((e) => e.event_id === eventId) || null;
  _selectedPostIds.clear();
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
  const setDisplay = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.style.display = val;
  };
  setDisplay("lpContent", show ? "block" : "none");
  setDisplay("noEventState", show ? "none" : "block");
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

  // กลุ่มที่ event นี้ผูกอยู่ — แสดง count
  const evtGroupIds = Array.isArray(currentEvent.line_group_ids) ? currentEvent.line_group_ids : [];
  const groupCount = evtGroupIds.length;
  const groupBadge = groupCount > 0
    ? `<span class="lp-evt-group-badge">📨 ${groupCount} กลุ่ม</span>`
    : `<span class="lp-evt-group-badge lp-evt-group-badge-empty">📨 ยังไม่ผูกกลุ่ม</span>`;

  el.innerHTML = `
    <div class="lp-evt-icon">📢</div>
    <div class="lp-evt-info">
      <div class="lp-evt-name">${escapeHtml(currentEvent.event_name || "")}</div>
      <div class="lp-evt-meta">${meta}</div>
    </div>
    <button class="lp-evt-action-btn" data-perm="line_promote_edit" onclick="window.openEventGroupsModal()" title="เลือกกลุ่ม LINE ที่จะส่งโพสต์ promote">
      ${groupBadge}
      <span style="margin-left:6px">⚙️</span>
    </button>
    <div class="lp-evt-count">${allPosts.length} โพสต์</div>
    <button class="lp-evt-add-btn" data-perm="line_promote_create" onclick="window.openLpModal()" title="เพิ่มโพสต์ใหม่">
      ＋ เพิ่มโพสต์
    </button>
  `;
  if (window.AuthZ) window.AuthZ.applyDomPerms(el);
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
  const list = allPosts;
  document.getElementById("lpCount").textContent = `${list.length} โพสต์`;

  if (!list.length) {
    const totalPosts = allPosts.length;
    const showAutoCreate = totalPosts === 0 && !!currentEvent?.event_date;
    tbody.innerHTML = `<tr><td colspan="7">
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
    updateBulkBar();
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
      const checked = _selectedPostIds.has(p.id);
      return `<tr class="${checked ? "lp-row-selected" : ""}">
        <td class="col-center">
          <input type="checkbox" ${checked ? "checked" : ""}
            onchange="window.toggleLpRow(${p.id}, this.checked)" />
        </td>
        <td class="col-center">${ddayBadge(p.promote_offset)}</td>
        <td><div class="lp-msg-cell">${escapeHtml(p.message_text || "")}</div></td>
        <td class="col-center" style="font-size:12px">${groupLabel}</td>
        <td class="col-center" style="font-size:12px">${formatDateTime(p.scheduled_at)}</td>
        <td class="col-center"><span class="lp-status-badge lpstat-${p.status}">${statusLabel(p.status)}</span></td>
        <td class="col-center">
          <div class="action-group">
            ${p.status === "SCHEDULED" ? `<button class="btn-icon" data-perm="line_promote_edit" onclick="window.sendLpPostNow(${p.id})" title="ส่งทันที (ไม่รอ scheduled_at)">📤</button>` : ""}
            ${canEdit ? `<button class="btn-icon" data-perm="line_promote_edit" onclick="window.openLpModal(${p.id})" title="แก้ไข">✏️</button>` : ""}
            ${canCancel ? `<button class="btn-icon danger" data-perm="line_promote_cancel" onclick="window.cancelLpPost(${p.id})" title="ยกเลิก">🚫</button>` : ""}
            ${p.status === "FAILED" ? `<button class="btn-icon" data-perm="line_promote_edit" onclick="window.retryLpPost(${p.id})" title="ลองใหม่">🔄</button>` : ""}
            ${(p.status === "CANCELLED" || p.status === "SENT") ? `<button class="btn-icon" data-perm="line_promote_edit" onclick="window.cloneLpPost(${p.id})" title="สร้างซ้ำ (clone เป็นโพสต์ใหม่)">📋</button>` : ""}
            ${p.status === "CANCELLED" ? `<button class="btn-icon" data-perm="line_promote_edit" onclick="window.reactivateLpPost(${p.id})" title="ใช้งานใหม่ (กลับเป็น SCHEDULED)">↩️</button>` : ""}
            <button class="btn-icon danger" data-perm="line_promote_cancel" onclick="window.deleteLpPost(${p.id})" title="ลบทิ้งถาวร">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
  updateBulkBar();
}

// ── Bulk selection helpers ────────────────────────────────
function updateBulkBar() {
  const bar = document.getElementById("lpBulkBar");
  const count = _selectedPostIds.size;
  if (!bar) return;
  bar.style.display = count > 0 ? "flex" : "none";
  const cntEl = document.getElementById("lpBulkCount");
  if (cntEl) cntEl.textContent = count;
  // Update select-all state
  const selectAll = document.getElementById("lpSelectAll");
  if (selectAll) {
    const visibleIds = _getVisiblePostIds();
    if (!visibleIds.length) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    } else {
      const allChecked = visibleIds.every((id) => _selectedPostIds.has(id));
      const anyChecked = visibleIds.some((id) => _selectedPostIds.has(id));
      selectAll.checked = allChecked;
      selectAll.indeterminate = anyChecked && !allChecked;
    }
  }
}

function _getVisiblePostIds() {
  return allPosts.map((p) => p.id);
}

window.toggleLpRow = function (id, checked) {
  if (checked) _selectedPostIds.add(id);
  else _selectedPostIds.delete(id);
  // toggle row class
  const row = document.querySelector(`#lpTableBody tr td input[type="checkbox"]:checked`);
  document.querySelectorAll("#lpTableBody tr").forEach((tr) => {
    const cb = tr.querySelector('input[type="checkbox"]');
    if (cb) tr.classList.toggle("lp-row-selected", cb.checked);
  });
  updateBulkBar();
};

window.toggleSelectAllLp = function (checked) {
  const visibleIds = _getVisiblePostIds();
  if (checked) visibleIds.forEach((id) => _selectedPostIds.add(id));
  else visibleIds.forEach((id) => _selectedPostIds.delete(id));
  renderTable();
};

window.clearLpSelection = function () {
  _selectedPostIds.clear();
  renderTable();
};

window.bulkDelete = async function () {
  const ids = Array.from(_selectedPostIds);
  if (!ids.length) return;
  const ok = await ConfirmModal.open({
    title: `ลบ ${ids.length} โพสต์ทิ้งถาวร?`,
    message: "การกระทำนี้ไม่สามารถกู้คืนได้",
    icon: "🗑",
    okText: "ลบทั้งหมด",
    cancelText: "ยกเลิก",
    tone: "danger",
  });
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("line_scheduled_posts", `?id=in.(${ids.join(",")})`, { method: "DELETE" });
    showToast(`ลบ ${ids.length} โพสต์แล้ว 🗑`, "success");
    _selectedPostIds.clear();
    allPosts = await fetchPosts(currentEventId);
    updateStats();
    renderTable();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.bulkCancel = async function () {
  // เลือกเฉพาะที่ status=SCHEDULED
  const ids = Array.from(_selectedPostIds).filter((id) => {
    const p = allPosts.find((x) => x.id === id);
    return p?.status === "SCHEDULED";
  });
  if (!ids.length) return showToast("ไม่มีโพสต์ที่อยู่ในสถานะ รอส่ง ในรายการที่เลือก", "info");
  const ok = await ConfirmModal.open({
    title: `ยกเลิก ${ids.length} โพสต์?`,
    message: "เปลี่ยนสถานะเป็น CANCELLED — กลับมาใช้ใหม่ได้ภายหลัง",
    icon: "🚫",
    okText: "ยกเลิกทั้งหมด",
    cancelText: "ปิด",
    tone: "warning",
  });
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("line_scheduled_posts", `?id=in.(${ids.join(",")})`, {
      method: "PATCH",
      body: { status: "CANCELLED" },
    });
    showToast(`ยกเลิก ${ids.length} โพสต์แล้ว 🚫`, "success");
    _selectedPostIds.clear();
    allPosts = await fetchPosts(currentEventId);
    updateStats();
    renderTable();
  } catch (e) {
    showToast("ยกเลิกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.bulkSendNow = async function () {
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  if (!proxyBase) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  // เลือกเฉพาะที่ status=SCHEDULED
  const ids = Array.from(_selectedPostIds).filter((id) => {
    const p = allPosts.find((x) => x.id === id);
    return p?.status === "SCHEDULED";
  });
  if (!ids.length) return showToast("ไม่มีโพสต์ที่อยู่ในสถานะ รอส่ง ในรายการที่เลือก", "info");
  const ok = await ConfirmModal.open({
    title: `ส่ง ${ids.length} โพสต์ทันที?`,
    message: "ระบบจะ trigger cron — ส่งทุกโพสต์ที่เลือกเข้า LINE ทันที",
    icon: "📤",
    okText: "ส่งเลย",
    cancelText: "ยกเลิก",
    tone: "primary",
  });
  if (!ok) return;
  showLoading(true);
  let sent = 0, failed = 0;
  try {
    // ส่งทีละ post ผ่าน endpoint ใหม่ (กระทบเฉพาะที่เลือก ไม่ใช่ post อื่นใน event)
    for (const id of ids) {
      try {
        const r = await fetch(`${proxyBase}/line/send-scheduled-post`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await r.json().catch(() => ({}));
        if (data.status === "SENT") sent++;
        else failed++;
      } catch { failed++; }
    }
    showToast(`ส่ง ${sent} ✅ · ล้มเหลว ${failed} ❌`, failed > 0 ? "error" : "success");
    _selectedPostIds.clear();
    allPosts = await fetchPosts(currentEventId);
    updateStats();
    renderTable();
  } catch (e) {
    showToast("ส่งไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

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
  // search/filter ถูกเอาออกแล้ว — keep stub เผื่อมีคน call
}

// ── Modal ─────────────────────────────────────────────────
window.openLpModal = function (id = null) {
  if (!allGroups.length) {
    showToast("ยังไม่มีกลุ่ม LINE — เชิญบอท @949bctau เข้ากลุ่มก่อน", "error");
    return;
  }
  // ตอนสร้างใหม่ — บังคับให้ event ผูกกลุ่มก่อน
  if (!id) {
    const targets = _resolveTargetGroupsForEvent();
    if (!targets.length) {
      showToast('กรุณากด "📨 ส่งกลุ่ม LINE" เพื่อเลือกกลุ่มก่อนสร้างโพสต์', "error");
      window.openEventGroupsModal();
      return;
    }
  }
  editingId = id;

  document.getElementById("lpModalTitle").textContent = id ? "✏️ แก้ไขโพสต์ LINE" : `📅 สร้างโพสต์ LINE`;
  document.getElementById("fLpId").value = id || "";

  // Rebuild กลุ่ม section ใน modal ทุกครั้ง
  const grpRow = document.getElementById("fLpGroupRow");
  const targets = _resolveTargetGroupsForEvent();
  if (grpRow) {
    if (id) {
      // edit mode — dropdown เลือกกลุ่มเดียว
      grpRow.innerHTML = `
        <label class="form-label">กลุ่ม LINE <span style="color: var(--danger)">*</span></label>
        <select class="form-input" id="fLpGroup">
          ${allGroups.map((g) => {
            const name = g.group_name || g.group_id.slice(0, 10) + "…";
            return `<option value="${escapeHtml(g.group_id)}">${escapeHtml(name)}</option>`;
          }).join("")}
        </select>
      `;
    } else {
      // create mode — แสดงรายชื่อกลุ่มที่ event ผูก (replicate)
      const chips = targets
        .map((g) => `<span style="background:#06c755;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px;display:inline-block">${escapeHtml(g.group_name || g.group_id.slice(0, 10) + "…")}</span>`)
        .join("");
      grpRow.innerHTML = `
        <label class="form-label">📨 จะส่งเข้า ${targets.length} กลุ่ม (ผูกที่ event)</label>
        <div style="padding:10px 13px;background:#f0fdf4;border:1.5px solid #06c755;border-radius:10px;line-height:1.8">${chips}</div>
        <div class="lp-hint-sm">💡 แก้กลุ่มที่ผูก: ปุ่ม "📨 ส่งกลุ่ม LINE" บน event header</div>
        <input type="hidden" id="fLpGroup" value="" />
      `;
    }
  }

  // defaults: D-1 at 09:00
  document.getElementById("fLpOffset").value = "1";
  document.getElementById("fLpTime").value = "09:00";
  document.getElementById("fLpMessage").value = "";

  if (id) {
    const p = allPosts.find((x) => x.id === id);
    if (p) {
      // grpSel ต้อง query ใหม่ทุกครั้งเพราะ rebuilt จาก grpRow.innerHTML ด้านบน
      const grpSel = document.getElementById("fLpGroup");
      if (grpSel) grpSel.value = p.target_id || "";
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

  const dateStr = document.getElementById("fLpDate").value;
  const timeStr = document.getElementById("fLpTime").value;
  if (!dateStr || !timeStr) return showToast("กรุณาเลือกวันเวลา", "error");

  const offsetStr = document.getElementById("fLpOffset").value;
  const promote_offset = offsetStr === "" ? null : parseInt(offsetStr, 10);

  const scheduled_at = `${dateStr}T${timeStr}:00+07:00`;

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
    if (editingId) {
      // Edit mode — แก้ row เดียว target_id ตาม dropdown
      const groupId = document.getElementById("fLpGroup").value;
      if (!groupId) {
        showLoading(false);
        btn.disabled = false;
        btn.textContent = "📅 บันทึก";
        return showToast("กรุณาเลือกกลุ่ม LINE", "error");
      }
      const grp = allGroups.find((g) => g.group_id === groupId);
      await sbFetch("line_scheduled_posts", `?id=eq.${editingId}`, {
        method: "PATCH",
        body: {
          target_id: groupId,
          channel_id: grp?.channel_id || null,
          promote_offset,
          message_text: message,
          scheduled_at,
          status: "SCHEDULED",
        },
      });
      showToast("แก้ไขโพสต์แล้ว", "success");
    } else {
      // Create mode — replicate ตามกลุ่มที่ผูกกับ event
      const targets = _resolveTargetGroupsForEvent();
      if (!targets.length) {
        showLoading(false);
        btn.disabled = false;
        btn.textContent = "📅 บันทึก";
        return showToast('ยังไม่ได้เลือกกลุ่ม LINE สำหรับ event — กดปุ่ม "📨 ส่งกลุ่ม LINE" ก่อน', "error");
      }
      const rows = targets.map((grp) => ({
        event_id: currentEventId,
        target_type: "group",
        target_id: grp.group_id,
        channel_id: grp.channel_id || null,
        promote_offset,
        message_text: message,
        scheduled_at,
        status: "SCHEDULED",
        created_by: session?.user_id || null,
      }));
      await sbFetch("line_scheduled_posts", "", { method: "POST", body: rows });
      showToast(`schedule ${rows.length} โพสต์ (${targets.length} กลุ่ม) แล้ว 📅`, "success");
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

// ── Event-level Groups Modal (เลือกกลุ่ม LINE ที่ event จะส่งเข้า) ─
let _evtSelectedGroupIds = new Set();

window.openEventGroupsModal = async function () {
  if (!currentEvent) return showToast("กรุณาเลือก event ก่อน", "error");
  showLoading(true);
  try {
    // โหลดทุกกลุ่ม รวม inactive — เพื่อให้ user เห็น/uncheck กลุ่มที่ผูกไว้ก่อนหน้าได้
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    const current = Array.isArray(currentEvent.line_group_ids) ? currentEvent.line_group_ids : [];
    _evtSelectedGroupIds = new Set(current);
    renderEvtGroupsCheckList();
    document.getElementById("evtGroupsModalOverlay").classList.add("open");
  } catch (e) {
    showToast("โหลดกลุ่มไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.closeEventGroupsModal = function () {
  document.getElementById("evtGroupsModalOverlay").classList.remove("open");
};

let _collapsedEvtCategories = new Set();

function renderEvtGroupsCheckList() {
  const box = document.getElementById("evtGroupsCheckList");
  if (!box) return;

  const sourceList = _allGroupsIncludingInactive.length
    ? _allGroupsIncludingInactive
    : allGroups;

  if (!sourceList.length) {
    box.innerHTML = `<div class="empty-state" style="padding:30px">
      <div class="empty-icon">👥</div>
      <div class="empty-text">ยังไม่มีกลุ่ม LINE — เปิด "จัดการกลุ่ม" เพื่อเพิ่มกลุ่มก่อน</div>
    </div>`;
    return;
  }

  // Detect orphan group_ids — selected ids ที่ไม่เจอใน DB เลย (กลุ่มถูกลบไป)
  const knownIds = new Set(sourceList.map((g) => g.group_id));
  const orphanIds = [..._evtSelectedGroupIds].filter((id) => !knownIds.has(id));

  // Group by category
  const grouped = {};
  sourceList.forEach((g) => {
    const cat = g.category || "__uncategorized__";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(g);
  });
  if (orphanIds.length) {
    grouped["__orphan__"] = orphanIds.map((id) => ({
      group_id: id,
      group_name: "(กลุ่มถูกลบจากระบบแล้ว)",
      is_active: false,
      __orphan: true,
    }));
  }

  const sortedCats = Object.keys(grouped).sort((a, b) => {
    if (a === "__orphan__") return 1;
    if (b === "__orphan__") return -1;
    if (a === "__uncategorized__") return 1;
    if (b === "__uncategorized__") return -1;
    return a.localeCompare(b);
  });

  box.innerHTML = sortedCats
    .map((cat) => {
      const rows = grouped[cat];
      const isCollapsed = _collapsedEvtCategories.has(cat);
      const catLabel = cat === "__uncategorized__"
        ? "ไม่จัดหมวด"
        : cat === "__orphan__"
          ? "⚠️ กลุ่มที่ถูกลบ (uncheck เพื่อล้าง)"
          : cat;
      const catEmoji = cat === "__uncategorized__" ? "📂" : cat === "__orphan__" ? "❌" : "📁";
      // count selected in this category
      const selCount = rows.filter((g) => _evtSelectedGroupIds.has(g.group_id)).length;
      const allChecked = selCount === rows.length;
      const someChecked = selCount > 0 && !allChecked;
      return `<div class="lp-grp-section ${isCollapsed ? "collapsed" : ""}">
        <div class="lp-grp-section-hdr" style="cursor:default">
          <span class="lp-grp-section-arrow" onclick="window.toggleEvtCategory('${escapeHtml(cat)}')" style="cursor:pointer">▾</span>
          <span class="lp-grp-section-title" onclick="window.toggleEvtCategory('${escapeHtml(cat)}')" style="cursor:pointer">${catEmoji} ${escapeHtml(catLabel)}</span>
          <button class="lp-grp-cat-select-all" onclick="window.toggleEvtCategoryAll('${escapeHtml(cat)}', ${!allChecked})"
            title="${allChecked ? "ยกเลิกเลือกทั้งหมดในหมวดนี้" : "เลือกทั้งหมดในหมวดนี้"}">
            ${allChecked ? "☑ ทั้งหมด" : someChecked ? `◧ ${selCount}/${rows.length}` : "☐ เลือกทั้งหมด"}
          </button>
          <span class="lp-grp-section-count">${rows.length}</span>
        </div>
        <div class="lp-grp-section-body" style="padding:6px">
          ${rows.map(_renderEvtCheckRow).join("")}
        </div>
      </div>`;
    })
    .join("");
}

function _renderEvtCheckRow(g) {
  const checked = _evtSelectedGroupIds.has(g.group_id);
  const name = g.group_name || "(ยังไม่ตั้งชื่อ)";
  const statusBadge = g.__orphan
    ? `<span class="lp-grp-check-badge lp-grp-check-badge-orphan">orphan</span>`
    : !g.is_active
      ? `<span class="lp-grp-check-badge lp-grp-check-badge-inactive">inactive</span>`
      : "";
  const rowClass = `lp-grp-check-row ${checked ? "checked" : ""} ${!g.is_active || g.__orphan ? "is-inactive-row" : ""}`;
  return `<label class="${rowClass}">
    <input type="checkbox" ${checked ? "checked" : ""}
      onchange="window.toggleEvtGroupCheck('${escapeHtml(g.group_id)}', this.checked, this)" />
    <div class="lp-grp-check-info">
      <div class="lp-grp-check-name">${escapeHtml(name)} ${statusBadge}</div>
      <div class="lp-grp-check-meta">${escapeHtml(g.group_id.slice(0, 20))}…</div>
    </div>
  </label>`;
}

window.toggleEvtCategory = function (cat) {
  if (_collapsedEvtCategories.has(cat)) _collapsedEvtCategories.delete(cat);
  else _collapsedEvtCategories.add(cat);
  renderEvtGroupsCheckList();
};

window.toggleEvtCategoryAll = function (cat, checkAll) {
  const groupsInCat = allGroups.filter((g) => (g.category || "__uncategorized__") === cat);
  groupsInCat.forEach((g) => {
    if (checkAll) _evtSelectedGroupIds.add(g.group_id);
    else _evtSelectedGroupIds.delete(g.group_id);
  });
  renderEvtGroupsCheckList();
};

window.toggleEvtGroupCheck = function (groupId, checked, inputEl) {
  if (checked) _evtSelectedGroupIds.add(groupId);
  else _evtSelectedGroupIds.delete(groupId);
  // toggle row class
  const row = inputEl?.closest(".lp-grp-check-row");
  if (row) row.classList.toggle("checked", checked);
};

window.saveEventGroups = async function () {
  if (!currentEvent) return;
  const ids = Array.from(_evtSelectedGroupIds);
  const btn = document.getElementById("btnSaveEvtGroups");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบันทึก...";
  showLoading(true);
  try {
    // 1) Update events.line_group_ids
    await sbFetch("events", `?event_id=eq.${currentEventId}`, {
      method: "PATCH",
      body: { line_group_ids: ids.length ? ids : null },
    });
    currentEvent.line_group_ids = ids.length ? ids : null;
    const evIdx = allEvents.findIndex((e) => e.event_id === currentEventId);
    if (evIdx >= 0) allEvents[evIdx].line_group_ids = currentEvent.line_group_ids;

    // 2) Auto-sync SCHEDULED posts ของ event นี้ให้ตรงกับกลุ่มที่เลือก
    const syncResult = await _syncScheduledPostsToGroups(ids);

    console.log("[saveEventGroups] sync result:", syncResult);
    let msg = `บันทึก ${ids.length} กลุ่ม`;
    if (syncResult.scanned > 0) {
      msg += ` · scan ${syncResult.scanned} pending posts → เพิ่ม ${syncResult.added}, ลบ ${syncResult.removed}`;
    } else {
      msg += ` (ไม่มี pending posts ให้ migrate)`;
    }
    showToast(msg, "success");

    allPosts = await fetchPosts(currentEventId);
    renderEventHeader();
    updateStats();
    renderTable();
    window.closeEventGroupsModal();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 บันทึก";
    showLoading(false);
  }
};

// Sync scheduled posts ของ event ให้ตรงกับ target groups ใหม่
// Strategy:
//   1. Group posts ทั้งหมดเป็น "templates" (offset + time + message) ก่อนทำอะไร
//   2. สำหรับแต่ละ template — ดู groups ที่ยังไม่ครอบใน new ids → insert
//   3. ลบ posts ที่ target_id ไม่อยู่ใน new ids
async function _syncScheduledPostsToGroups(newGroupIds) {
  const result = { added: 0, removed: 0, moved: 0, scanned: 0 };
  if (!currentEventId) return result;

  // โหลด scheduled posts ของ event นี้ (เฉพาะ status=SCHEDULED — ไม่แตะ SENT/CANCELLED/FAILED)
  const scheduled = (await sbFetch(
    "line_scheduled_posts",
    `?event_id=eq.${currentEventId}&status=eq.SCHEDULED&select=*`,
  )) || [];
  result.scanned = scheduled.length;
  console.log(`[sync] scanned ${scheduled.length} SCHEDULED posts; new groups:`, newGroupIds);
  if (!scheduled.length) return result;

  const newIdsSet = new Set(newGroupIds);

  // Step 1: Group เป็น templates (ใช้ posts ทั้งหมดเพื่อ backup template ก่อนลบ)
  const templates = {};
  scheduled.forEach((p) => {
    const key = `${p.promote_offset == null ? "null" : p.promote_offset}|${p.scheduled_at}|${(p.message_text || "").slice(0, 200)}`;
    if (!templates[key]) {
      templates[key] = {
        promote_offset: p.promote_offset,
        scheduled_at: p.scheduled_at,
        message_text: p.message_text,
        existing_target_ids: new Set(),
      };
    }
    templates[key].existing_target_ids.add(p.target_id);
  });

  // Step 2: Insert posts ใหม่สำหรับ groups ที่ยังไม่ครอบในแต่ละ template
  const session = (() => {
    try {
      return JSON.parse(localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session") || "{}");
    } catch { return {}; }
  })();

  const newRows = [];
  for (const tpl of Object.values(templates)) {
    for (const gid of newGroupIds) {
      if (!tpl.existing_target_ids.has(gid)) {
        const grp = allGroups.find((g) => g.group_id === gid);
        newRows.push({
          event_id: currentEventId,
          target_type: "group",
          target_id: gid,
          channel_id: grp?.channel_id || null,
          promote_offset: tpl.promote_offset,
          message_text: tpl.message_text,
          scheduled_at: tpl.scheduled_at,
          status: "SCHEDULED",
          created_by: session?.user_id || null,
        });
      }
    }
  }
  if (newRows.length) {
    await sbFetch("line_scheduled_posts", "", { method: "POST", body: newRows });
    result.added = newRows.length;
  }

  // Step 3: ลบ posts ที่ target_id ไม่อยู่ใน newGroupIds (หลัง insert ใหม่แล้วเพื่อความปลอดภัย)
  const toDelete = scheduled.filter((p) => !newIdsSet.has(p.target_id));
  if (toDelete.length) {
    const ids = toDelete.map((p) => p.id).join(",");
    await sbFetch("line_scheduled_posts", `?id=in.(${ids})`, { method: "DELETE" });
    result.removed = toDelete.length;
  }

  return result;
}

// helper: หากลุ่มที่จะส่งสำหรับ event ปัจจุบัน — ต้องผูกกลุ่มที่ event ก่อน (ไม่มี default fallback)
function _resolveTargetGroupsForEvent() {
  const ids = Array.isArray(currentEvent?.line_group_ids) ? currentEvent.line_group_ids : [];
  if (!ids.length) return [];
  return allGroups.filter((g) => ids.includes(g.group_id));
}

// ── Reply Templates Modal ─────────────────────────────────
// แก้เฉพาะ template ที่เกี่ยวกับ group (1-on-1 chat templates อยู่หน้า settings/line-templates)
const TEMPLATE_META = {
  group_joined: {
    label: "🎉 บอทเข้ากลุ่มสำเร็จ",
    desc: "ตอบเมื่อบอทถูกเชิญเข้ากลุ่ม LINE ครั้งแรก",
    placeholders: [],
    priority: 1,
  },
};

let _allTemplates = [];   // [{ key, text, description, placeholders, ... }]
let _tplOriginal = {};    // key → original text
let _tplDirty = new Set();

window.openTemplatesModal = async function () {
  showLoading(true);
  try {
    const rows = await sbFetch("line_reply_templates", "?select=*&order=key.asc");
    const dbMap = {};
    (rows || []).forEach((r) => { dbMap[r.key] = r; });

    // รวม template จาก DB + meta ที่รู้จัก (ถ้า DB ยังไม่มี ให้แสดง row เปล่าให้แก้ได้)
    const knownKeys = Object.keys(TEMPLATE_META);
    _allTemplates = knownKeys.map((k) => {
      const fromDb = dbMap[k];
      const meta = TEMPLATE_META[k];
      return {
        key: k,
        text: fromDb?.text || "",
        description: fromDb?.description || meta.desc,
        label: meta.label,
        placeholders: meta.placeholders,
        priority: meta.priority,
        existsInDb: !!fromDb,
      };
    });
    _allTemplates.sort((a, b) => a.priority - b.priority);
    _tplOriginal = {};
    _allTemplates.forEach((t) => { _tplOriginal[t.key] = t.text; });
    _tplDirty.clear();

    renderTemplatesList();
    document.getElementById("templatesModalOverlay").classList.add("open");
  } catch (e) {
    showToast("โหลด template ไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.closeTemplatesModal = async function () {
  if (_tplDirty.size > 0) {
    const ok = await ConfirmModal.open({
      title: "ปิดโดยไม่บันทึก?",
      message: `มีการแก้ไข ${_tplDirty.size} รายการที่ยังไม่บันทึก`,
      icon: "⚠️",
      okText: "ปิดเลย",
      cancelText: "บันทึกก่อน",
      tone: "warning",
    });
    if (!ok) return;
  }
  document.getElementById("templatesModalOverlay").classList.remove("open");
};

function renderTemplatesList() {
  const box = document.getElementById("lpTemplatesList");
  if (!box) return;
  if (!_allTemplates.length) {
    box.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3)">ไม่มี template — รัน migration ก่อน</div>`;
    return;
  }
  box.innerHTML = _allTemplates
    .map((t) => {
      const isDirty = _tplDirty.has(t.key);
      const placeholderHtml = (t.placeholders || []).length
        ? `<div class="lp-tpl-placeholders">ใช้ตัวแปรได้: ${t.placeholders.map((p) => `<code>${escapeHtml(p)}</code>`).join("")}</div>`
        : "";
      return `<div class="lp-tpl-row ${isDirty ? "dirty" : ""}" data-key="${escapeHtml(t.key)}">
        <div class="lp-tpl-row-header">
          <span class="lp-tpl-key-badge">${escapeHtml(t.key)}</span>
          <span class="lp-tpl-desc">${escapeHtml(t.label || t.description || "")}</span>
          ${isDirty ? `<span class="lp-tpl-dirty-badge">✏️ แก้แล้ว</span>` : ""}
        </div>
        <textarea class="lp-tpl-textarea" rows="3"
          oninput="window.onTplChange('${escapeHtml(t.key)}', this.value)"
          placeholder="ใส่ข้อความ...">${escapeHtml(t.text)}</textarea>
        ${placeholderHtml}
      </div>`;
    })
    .join("");
}

window.onTplChange = function (key, newText) {
  const t = _allTemplates.find((x) => x.key === key);
  if (!t) return;
  t.text = newText;
  if (newText !== _tplOriginal[key]) _tplDirty.add(key);
  else _tplDirty.delete(key);
  // Update only the dirty badge (avoid full re-render which loses focus)
  const row = document.querySelector(`.lp-tpl-row[data-key="${cssEscape(key)}"]`);
  if (row) {
    row.classList.toggle("dirty", _tplDirty.has(key));
    let badge = row.querySelector(".lp-tpl-dirty-badge");
    if (_tplDirty.has(key) && !badge) {
      const hdr = row.querySelector(".lp-tpl-row-header");
      hdr.insertAdjacentHTML("beforeend", `<span class="lp-tpl-dirty-badge">✏️ แก้แล้ว</span>`);
    } else if (!_tplDirty.has(key) && badge) {
      badge.remove();
    }
  }
};

function cssEscape(s) {
  return String(s).replace(/[\\"]/g, "\\$&");
}

window.saveAllTemplates = async function () {
  if (_tplDirty.size === 0) {
    showToast("ไม่มีการเปลี่ยนแปลง", "info");
    return;
  }
  const btn = document.getElementById("btnSaveTpl");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบันทึก...";
  showLoading(true);

  try {
    for (const key of _tplDirty) {
      const t = _allTemplates.find((x) => x.key === key);
      if (!t) continue;
      if (t.existsInDb) {
        // PATCH
        await sbFetch("line_reply_templates", `?key=eq.${encodeURIComponent(key)}`, {
          method: "PATCH",
          body: { text: t.text },
        });
      } else {
        // INSERT
        await sbFetch("line_reply_templates", "", {
          method: "POST",
          body: {
            key,
            text: t.text,
            description: t.description || null,
            placeholders: t.placeholders || [],
          },
        });
        t.existsInDb = true;
      }
      _tplOriginal[key] = t.text;
    }
    _tplDirty.clear();

    // Force webhook reload cache
    const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
    if (proxyBase) {
      try {
        await fetch(`${proxyBase}/line/templates/reload`, { method: "POST" });
      } catch (e) {
        console.warn("reload templates cache failed:", e.message);
      }
    }

    showToast(`บันทึก ${_allTemplates.filter((t) => t.existsInDb).length} template แล้ว ✅`, "success");
    renderTemplatesList();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 บันทึกทั้งหมด";
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

// _collapsedCategories — track which sections are collapsed
let _collapsedCategories = new Set();

window.renderGroupsList = function () {
  const box = document.getElementById("groupsList");
  if (!box) return;
  const list = _allGroupsIncludingInactive;
  if (!list.length) {
    box.innerHTML = `<div class="empty-state" style="padding:30px">
      <div class="empty-icon">👥</div>
      <div class="empty-text">ยังไม่มีกลุ่ม LINE — เชิญบอท @949bctau เข้ากลุ่มก่อน</div>
    </div>`;
    _populateCategoryFilter([]);
    return;
  }

  // Collect categories
  const allCats = [...new Set(list.map((g) => g.category).filter(Boolean))].sort();
  _populateCategoryFilter(allCats);

  // Apply filters
  const searchEl = document.getElementById("lpGrpSearch");
  const catEl = document.getElementById("lpGrpCatFilter");
  const search = (searchEl?.value || "").toLowerCase().trim();
  const catFilter = catEl?.value || "";

  const filtered = list.filter((g) => {
    if (catFilter && (g.category || "") !== catFilter) return false;
    if (search) {
      const hay = [g.group_name, g.group_id, g.category].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="empty-state" style="padding:24px">
      <div class="empty-text" style="font-size:13px;color:var(--text3)">ไม่เจอกลุ่มที่ตรงเงื่อนไข</div>
    </div>`;
    return;
  }

  // Group by category
  const grouped = {};
  filtered.forEach((g) => {
    const cat = g.category || "__uncategorized__";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(g);
  });

  // Render sections
  const sortedCats = Object.keys(grouped).sort((a, b) => {
    if (a === "__uncategorized__") return 1;
    if (b === "__uncategorized__") return -1;
    return a.localeCompare(b);
  });

  box.innerHTML = sortedCats
    .map((cat) => {
      const rows = grouped[cat];
      const isCollapsed = _collapsedCategories.has(cat);
      const catLabel = cat === "__uncategorized__" ? "ไม่จัดหมวด" : cat;
      const catEmoji = cat === "__uncategorized__" ? "📂" : "📁";
      return `<div class="lp-grp-section ${isCollapsed ? "collapsed" : ""}">
        <div class="lp-grp-section-hdr" onclick="window.toggleCategory('${escapeHtml(cat)}')">
          <span class="lp-grp-section-arrow">▾</span>
          <span class="lp-grp-section-title">${catEmoji} ${escapeHtml(catLabel)}</span>
          <span class="lp-grp-section-count">${rows.length}</span>
        </div>
        <div class="lp-grp-section-body">
          ${rows.map(_renderGroupRow).join("")}
        </div>
      </div>`;
    })
    .join("");
};

function _populateCategoryFilter(cats) {
  const el = document.getElementById("lpGrpCatFilter");
  if (!el) return;
  const current = el.value;
  el.innerHTML =
    `<option value="">📁 ทุกหมวด</option>` +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  el.value = current;
}

window.toggleCategory = function (cat) {
  if (_collapsedCategories.has(cat)) _collapsedCategories.delete(cat);
  else _collapsedCategories.add(cat);
  window.renderGroupsList();
};

function _renderGroupRow(g) {
  const inactiveTip = g.is_active
    ? ""
    : ` · <span style="color:var(--danger)" title="บอทไม่อยู่ในกลุ่มแล้ว">inactive</span>`;
  const catChip = g.category
    ? `<span class="lp-grp-cat-chip" onclick="window.editGroupCategory(${g.id})" title="คลิกเพื่อเปลี่ยนหมวด">${escapeHtml(g.category)}</span>`
    : `<button class="lp-grp-cat-add" onclick="window.editGroupCategory(${g.id})" title="ตั้งหมวดหมู่">+ หมวด</button>`;
  return `<div class="lp-group-row ${!g.is_active ? "is-inactive" : ""}">
    <div class="lp-group-info">
      <div class="lp-group-row-line1">
        <input type="text" class="form-input lp-group-name-input"
          value="${escapeHtml(g.group_name || "")}"
          placeholder="ตั้งชื่อกลุ่ม..."
          onchange="window.renameGroup(${g.id}, this.value)" />
        ${catChip}
        <button class="btn-icon" title="ดึงชื่อจาก LINE"
          onclick="window.fetchGroupNameFromLine('${escapeHtml(g.group_id)}', ${g.id})">🔄</button>
        <button class="btn-icon ${g.is_active ? "" : "btn-icon-dim"}"
          title="${g.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}"
          onclick="window.toggleGroupActive(${g.id}, ${!g.is_active})">${g.is_active ? "🔕" : "🔔"}</button>
        <button class="btn-icon danger" title="ลบ"
          onclick="window.deleteGroup(${g.id}, '${escapeHtml(g.group_name || g.group_id.slice(0, 12))}')">🗑</button>
      </div>
      <div class="lp-group-meta">
        <code>${escapeHtml(g.group_id.slice(0, 16))}…</code>${inactiveTip}
      </div>
    </div>
  </div>`;
}

window.editGroupCategory = async function (id) {
  const grp = _allGroupsIncludingInactive.find((g) => g.id === id);
  if (!grp) return;
  const existing = [...new Set(_allGroupsIncludingInactive.map((g) => g.category).filter(Boolean))].sort();

  const ok = await ConfirmModal.open({
    title: "ตั้งหมวดหมู่กลุ่ม",
    message: grp.group_name || grp.group_id.slice(0, 16) + "…",
    icon: "📁",
    okText: "บันทึก",
    cancelText: "ยกเลิก",
    tone: "primary",
    note:
      `<div style="display:flex;flex-direction:column;gap:8px">` +
      (existing.length
        ? `<div style="font-size:12px;color:#475569">หมวดที่มีอยู่ — คลิกเพื่อเลือก:</div>
           <div style="display:flex;flex-wrap:wrap;gap:6px">
             ${existing.map((c) => `<button type="button" class="lp-grp-cat-chip" style="cursor:pointer"
                onclick="document.getElementById('catInput').value='${escapeHtml(c)}'">${escapeHtml(c)}</button>`).join("")}
             <button type="button" class="lp-grp-cat-chip" style="cursor:pointer;background:#fef3c7;color:#92400e"
                onclick="document.getElementById('catInput').value=''">ล้างหมวด</button>
           </div>`
        : "") +
      `<input type="text" id="catInput" class="form-input"
         value="${escapeHtml(grp.category || "")}"
         placeholder="พิมพ์ชื่อหมวด เช่น ลูกค้า / ทีมงาน / ผู้บริหาร"
         style="margin-top:4px" />` +
      `</div>`,
  });
  if (!ok) return;

  const newCat = (document.getElementById("catInput")?.value || "").trim() || null;
  showLoading(true);
  try {
    await sbFetch("line_groups", `?id=eq.${id}`, {
      method: "PATCH",
      body: { category: newCat },
    });
    showToast(newCat ? `ตั้งหมวด "${newCat}" แล้ว ✅` : "ล้างหมวดแล้ว", "success");
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    window.renderGroupsList();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.fetchAllGroupNames = async function () {
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  if (!proxyBase) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  const need = _allGroupsIncludingInactive.filter((g) => !g.group_name);
  if (!need.length) return showToast("ทุกกลุ่มมีชื่อแล้ว ✅", "info");

  showLoading(true);
  let ok = 0, fail = 0;
  for (const g of need) {
    try {
      const r = await fetch(`${proxyBase}/line/group-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: g.group_id }),
      });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        fail++;
        continue;
      }
      const data = await r.json();
      if (data.ok && data.groupName) {
        await sbFetch("line_groups", `?id=eq.${g.id}`, {
          method: "PATCH",
          body: { group_name: data.groupName },
        });
        ok++;
      } else {
        fail++;
      }
    } catch { fail++; }
  }
  showToast(`ดึงชื่อสำเร็จ ${ok}/${need.length} กลุ่ม${fail ? ` (ล้มเหลว ${fail})` : ""}`, ok ? "success" : "error");
  _allGroupsIncludingInactive = await fetchLineGroups(true);
  allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
  renderGroupsList();
  showLoading(false);
};

window.fetchGroupNameFromLine = async function (groupId, id) {
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  if (!proxyBase) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  showLoading(true);
  try {
    const r = await fetch(`${proxyBase}/line/group-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      showToast(`Endpoint ยังไม่พร้อม (${r.status}) — Render ยัง deploy ไม่เสร็จ?`, "error");
      return;
    }
    const data = await r.json();
    if (!data.ok || !data.groupName) {
      showToast(data.error || "ดึงชื่อไม่สำเร็จ", "error");
      return;
    }
    await sbFetch("line_groups", `?id=eq.${id}`, {
      method: "PATCH",
      body: { group_name: data.groupName },
    });
    showToast(`ดึงชื่อแล้ว: ${data.groupName} ✅`, "success");
    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    renderGroupsList();
  } catch (e) {
    showToast("ดึงชื่อไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

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

window.triggerCronNow = async function () {
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  if (!proxyBase) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  const out = document.getElementById("lpDiagOutput");
  if (out) out.textContent = "🚀 กำลัง trigger cron /cron/line-promote...\n(ครั้งแรกอาจรอ ~30s ถ้า Render หลับอยู่)";
  showLoading(true);
  try {
    const r = await fetch(`${proxyBase}/cron/line-promote`, { method: "POST" });
    const data = await r.json();
    let txt = `🚀 Cron triggered at ${new Date().toLocaleTimeString("th-TH")}\n\n`;
    txt += `📊 Summary:\n`;
    txt += `  Processed: ${data.processed ?? 0}\n`;
    txt += `  ✅ Sent:   ${data.sent ?? 0}\n`;
    txt += `  ❌ Failed: ${data.failed ?? 0}\n`;
    if (data.message) txt += `  💬 ${data.message}\n`;
    if (data.details?.length) {
      txt += `\n📋 Details:\n`;
      data.details.forEach((d) => {
        txt += `  • Post #${d.id} → ${d.target_type}/${(d.target_id || "").slice(0, 16)} → ${d.status}`;
        if (d.error) txt += ` (${d.error})`;
        txt += `\n`;
      });
    }
    if (out) out.textContent = txt;
    if (data.sent > 0) showToast(`ส่งแล้ว ${data.sent} โพสต์ ✅`, "success");
    else if (data.failed > 0) showToast(`ส่งล้มเหลว ${data.failed} โพสต์`, "error");
    else showToast("ไม่มีโพสต์ที่ถึงเวลาส่ง (scheduled_at > now+15min)", "info");

    // refresh posts list
    if (currentEventId) {
      allPosts = await fetchPosts(currentEventId);
      updateStats();
      renderTable();
    }
  } catch (e) {
    if (out) out.textContent = `❌ trigger cron ไม่สำเร็จ: ${e.message}`;
    showToast("ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.openDiagModal = function () {
  document.getElementById("diagModalOverlay").classList.add("open");
  // auto-run diagnostic เมื่อเปิด modal
  window.runLpDiag();
};

window.closeDiagModal = function () {
  document.getElementById("diagModalOverlay").classList.remove("open");
};

window.openDiagInNewTab = function () {
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  if (!proxyBase) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  window.open(`${proxyBase}/line/diag`, "_blank");
};

window.copyDiagOutput = async function () {
  const out = document.getElementById("lpDiagOutput");
  const txt = out?.textContent || "";
  if (!txt) return showToast("ยังไม่มีผลลัพธ์ — กดปุ่ม Diagnostic ก่อน", "error");
  try {
    await navigator.clipboard.writeText(txt);
    showToast("Copy แล้ว ✅", "success");
  } catch {
    showToast("Copy ไม่สำเร็จ", "error");
  }
};

window.runLpDiag = async function () {
  const out = document.getElementById("lpDiagOutput");
  if (!out) return;
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
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

window.deleteGroup = async function (id, name) {
  const grp = _allGroupsIncludingInactive.find((g) => g.id === id);
  if (!grp) return;
  const gid = grp.group_id;

  // เช็คผลกระทบก่อนลบ
  const [linkedPosts, linkedEvents] = await Promise.all([
    sbFetch("line_scheduled_posts", `?target_id=eq.${encodeURIComponent(gid)}&select=id,status&limit=500`).catch(() => []),
    sbFetch("events", `?line_group_ids=cs.%7B${encodeURIComponent(gid)}%7D&select=event_id,line_group_ids&limit=500`).catch(() => []),
  ]);

  const pendingCount = (linkedPosts || []).filter((p) => p.status === "SCHEDULED").length;
  const eventCount = (linkedEvents || []).length;

  let warningNote = "";
  const warns = [];
  if (eventCount > 0) warns.push(`📋 จะถอด groupId ออกจาก <b>${eventCount} event</b> ที่ผูกกลุ่มนี้ไว้`);
  if (pendingCount > 0) warns.push(`⚠️ มี <b>${pendingCount} โพสต์</b> ที่รอส่ง — จะถูกลบทิ้งด้วย`);
  if (warns.length) warningNote = warns.join("<br/>");

  const ok = await ConfirmModal.open({
    title: "ลบกลุ่มออกจากระบบ?",
    message: `กลุ่ม "${name}" จะถูกลบจาก ERP — ไม่กระทบกลุ่ม LINE จริง (บอทยังอยู่ในกลุ่มถ้ายังไม่ถูก kick)`,
    icon: "🗑",
    okText: "ลบกลุ่ม + cleanup",
    cancelText: "ยกเลิก",
    tone: "danger",
    note: warningNote || undefined,
  });
  if (!ok) return;

  showLoading(true);
  try {
    // 1) ลบ scheduled posts ที่ status=SCHEDULED ของกลุ่มนี้ (ไม่แตะ history SENT/CANCELLED)
    if (pendingCount > 0) {
      const ids = (linkedPosts || []).filter((p) => p.status === "SCHEDULED").map((p) => p.id);
      if (ids.length) {
        await sbFetch("line_scheduled_posts", `?id=in.(${ids.join(",")})`, { method: "DELETE" });
      }
    }

    // 2) ถอด groupId ออกจาก events.line_group_ids ของทุก event ที่มี
    for (const ev of (linkedEvents || [])) {
      const newIds = (ev.line_group_ids || []).filter((x) => x !== gid);
      await sbFetch("events", `?event_id=eq.${ev.event_id}`, {
        method: "PATCH",
        body: { line_group_ids: newIds.length ? newIds : null },
      });
      // อัพเดต cache ถ้าเป็น event ปัจจุบัน
      if (currentEvent && currentEvent.event_id === ev.event_id) {
        currentEvent.line_group_ids = newIds.length ? newIds : null;
      }
    }

    // 3) ลบ row group เอง
    await sbFetch("line_groups", `?id=eq.${id}`, { method: "DELETE" });

    let toastMsg = `ลบกลุ่ม "${name}" 🗑`;
    if (eventCount > 0 || pendingCount > 0) {
      toastMsg += ` · cleanup ${eventCount} event${pendingCount ? ` + ${pendingCount} posts` : ""}`;
    }
    showToast(toastMsg, "success");

    _allGroupsIncludingInactive = await fetchLineGroups(true);
    allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    renderGroupsList();

    // refresh event header + posts table ถ้าเปิด event อยู่
    if (currentEventId) {
      allPosts = await fetchPosts(currentEventId);
      renderEventHeader();
      updateStats();
      renderTable();
    }
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
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
// เปิด modal ให้ user กรอกข้อความก่อน
window.autoCreateLpPosts = function () {
  if (!currentEvent || !currentEvent.event_date) {
    return showToast("ไม่พบข้อมูล event", "error");
  }
  if (!allGroups.length) {
    return showToast("ยังไม่มีกลุ่ม LINE — เชิญบอท @949bctau เข้ากลุ่มก่อน", "error");
  }
  const targetGroups = _resolveTargetGroupsForEvent();
  if (!targetGroups.length) {
    return showToast('ยังไม่ได้เลือกกลุ่ม LINE — กดปุ่ม "📨 ส่งกลุ่ม LINE" บน event header เพื่อเลือก', "error");
  }

  // เคลียร์ + fill default
  document.getElementById("fAutoCreateMessage").value = _buildDefaultAutoCreateMessage();
  window.autoCreateUpdateCount();
  document.getElementById("autoCreateModalOverlay").classList.add("open");
};

window.closeAutoCreateModal = function () {
  document.getElementById("autoCreateModalOverlay").classList.remove("open");
};

window.autoCreateUpdateCount = function () {
  const len = (document.getElementById("fAutoCreateMessage").value || "").length;
  const el = document.getElementById("autoCreateCharCount");
  if (el) el.textContent = `${len} ตัวอักษร`;
};

window.fillAutoCreateDefault = function () {
  document.getElementById("fAutoCreateMessage").value = _buildDefaultAutoCreateMessage();
  window.autoCreateUpdateCount();
};

function _buildDefaultAutoCreateMessage() {
  const meta = [
    currentEvent?.event_date ? `📅 {{event_date}}` : "",
    (currentEvent?.start_time || "").trim() ? `🕐 {{start_time}}` : "",
    currentEvent?.location ? `📍 {{location}}` : "",
  ].filter(Boolean).join("\n");
  return `📢 ขอประชาสัมพันธ์กิจกรรม\n\n🎯 {{event_name}}\n\n${meta}\n\n⏰ เหลืออีก {{days_left}} วัน — เตรียมตัวให้พร้อม!`;
}

window.confirmAutoCreate = async function () {
  const message = document.getElementById("fAutoCreateMessage").value.trim();
  if (!message) return showToast("กรุณาใส่ข้อความ", "error");
  if (message.length > 5000) return showToast("ข้อความเกิน 5000 ตัวอักษร", "error");

  const targetGroups = _resolveTargetGroupsForEvent();
  if (!targetGroups.length) return showToast("ไม่มีกลุ่มที่ผูก", "error");

  const eventDate = parseYMD(currentEvent.event_date);
  if (!eventDate) return showToast("วันที่งานไม่ถูกต้อง", "error");

  const session = (() => {
    try {
      return JSON.parse(localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session") || "{}");
    } catch { return {}; }
  })();

  // Replicate: สำหรับแต่ละ offset (7,3,2,1) × 1 group → 1 row
  // ใช้ message เดียวกัน — placeholder จะ render ตอนส่งจริงผ่าน /cron/line-promote
  const rows = [];
  for (const offset of [7, 3, 2, 1]) {
    const d = new Date(eventDate);
    d.setDate(d.getDate() - offset);
    const scheduled_at = `${toBkkDateStr(d)}T09:00:00+07:00`;
    for (const grp of targetGroups) {
      rows.push({
        event_id: currentEventId,
        target_type: "group",
        target_id: grp.group_id,
        channel_id: grp.channel_id || null,
        promote_offset: offset,
        message_text: message,
        scheduled_at,
        status: "SCHEDULED",
        created_by: session?.user_id || null,
      });
    }
  }

  const btn = document.getElementById("btnConfirmAutoCreate");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังสร้าง...";
  showLoading(true);
  try {
    await sbFetch("line_scheduled_posts", "", { method: "POST", body: rows });
    showToast(`สร้าง ${rows.length} โพสต์ (4 D-day × ${targetGroups.length} กลุ่ม) แล้ว 📢`, "success");
    window.closeAutoCreateModal();
    allPosts = await fetchPosts(currentEventId);
    renderEventHeader();
    updateStats();
    renderTable();
  } catch (e) {
    showToast("สร้างไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ สร้าง 4 โพสต์";
    showLoading(false);
  }
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

// ── Clone — สร้าง post ใหม่จาก post เดิม (status SCHEDULED, scheduled_at = +1h) ─
window.cloneLpPost = async function (id) {
  const src = allPosts.find((x) => x.id === id);
  if (!src) return;
  const grp = allGroups.find((g) => g.group_id === src.target_id);
  const preview = (src.message_text || "").slice(0, 120);
  const ok = await ConfirmModal.open({
    title: "สร้างโพสต์ใหม่จากโพสต์นี้?",
    message: `Clone โพสต์เข้ากลุ่ม "${grp?.group_name || "—"}" + ตั้งเวลาส่ง = อีก 1 ชั่วโมงข้างหน้า`,
    icon: "📋",
    okText: "Clone",
    cancelText: "ยกเลิก",
    tone: "primary",
    note: `<b>ข้อความที่จะ clone:</b><br/><div style="white-space:pre-wrap;font-size:12px;color:#475569;margin-top:4px">${escapeHtml(preview)}${src.message_text?.length > 120 ? "…" : ""}</div>`,
  });
  if (!ok) return;
  showLoading(true);
  try {
    const session = (() => {
      try { return JSON.parse(localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session") || "{}"); }
      catch { return {}; }
    })();
    const newScheduled = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await sbFetch("line_scheduled_posts", "", {
      method: "POST",
      body: {
        event_id: src.event_id,
        target_type: src.target_type,
        target_id: src.target_id,
        channel_id: src.channel_id,
        promote_offset: null,
        message_text: src.message_text,
        scheduled_at: newScheduled,
        status: "SCHEDULED",
        created_by: session?.user_id || null,
      },
    });
    showToast("Clone โพสต์ใหม่แล้ว ✅", "success");
    allPosts = await fetchPosts(currentEventId);
    updateStats();
    renderTable();
  } catch (e) {
    showToast("Clone ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── Reactivate — ส่ง post ที่ CANCELLED กลับเป็น SCHEDULED ─
window.reactivateLpPost = async function (id) {
  const ok = await ConfirmModal.open({
    title: "ใช้งานโพสต์นี้ใหม่?",
    message: "เปลี่ยนสถานะจาก ยกเลิก → รอส่ง",
    icon: "↩️",
    okText: "ใช้งานใหม่",
    cancelText: "ยกเลิก",
    tone: "primary",
  });
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("line_scheduled_posts", `?id=eq.${id}`, {
      method: "PATCH",
      body: { status: "SCHEDULED", error_message: null },
    });
    showToast("กลับเป็น รอส่ง แล้ว ↩️", "success");
    allPosts = await fetchPosts(currentEventId);
    updateStats();
    renderTable();
  } catch (e) {
    showToast("ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── Delete — ลบทิ้งถาวร ─
window.deleteLpPost = function (id) {
  DeleteModal.open("ต้องการลบโพสต์นี้ทิ้งถาวรหรือไม่? (ไม่สามารถกู้คืนได้)", async () => {
    showLoading(true);
    try {
      await sbFetch("line_scheduled_posts", `?id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแล้ว 🗑", "success");
      allPosts = await fetchPosts(currentEventId);
      updateStats();
      renderTable();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── Send Now — บังคับส่ง post นี้ทันทีไม่รอ scheduled_at ─
window.sendLpPostNow = async function (id) {
  const proxyBase = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
  if (!proxyBase) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");

  const post = allPosts.find((x) => x.id === id);
  const grp = post && allGroups.find((g) => g.group_id === post.target_id);
  const preview = (post?.message_text || "").slice(0, 120);
  const ok = await ConfirmModal.open({
    title: "ส่งโพสต์นี้เข้า LINE ทันที?",
    message: `ส่งเข้ากลุ่ม "${grp?.group_name || "—"}" — ระบบจะ trigger cron ทันที`,
    icon: "📤",
    okText: "ส่งเลย",
    cancelText: "ยกเลิก",
    tone: "primary",
    note: post ? `<b>ข้อความที่จะส่ง:</b><br/><div style="white-space:pre-wrap;font-size:12px;color:#475569;margin-top:4px">${escapeHtml(preview)}${post.message_text?.length > 120 ? "…" : ""}</div>` : undefined,
  });
  if (!ok) return;

  showLoading(true);
  try {
    // ส่งเฉพาะ post นี้ — ไม่กระทบ post อื่นๆ
    const r = await fetch(`${proxyBase}/line/send-scheduled-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      showToast(`Endpoint ยังไม่พร้อม (${r.status}) — Render ยัง deploy ไม่เสร็จ?`, "error");
      return;
    }
    const data = await r.json();
    if (data.status === "SENT") showToast("ส่งแล้ว ✅", "success");
    else if (data.status === "FAILED") showToast(`ส่งล้มเหลว: ${data.error || "?"}`, "error");
    else showToast(data.error || "ไม่สำเร็จ", "error");

    allPosts = await fetchPosts(currentEventId);
    updateStats();
    renderTable();
  } catch (e) {
    showToast("ส่งไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
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
