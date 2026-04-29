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
            const tag = g.is_default ? " ⭐" : "";
            const name = g.group_name || g.group_id.slice(0, 10) + "…";
            return `<option value="${escapeHtml(g.group_id)}">${escapeHtml(name)}${tag}</option>`;
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
    if (!allGroups.length) {
      _allGroupsIncludingInactive = await fetchLineGroups(true);
      allGroups = _allGroupsIncludingInactive.filter((g) => g.is_active);
    }
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

function renderEvtGroupsCheckList() {
  const box = document.getElementById("evtGroupsCheckList");
  if (!box) return;
  if (!allGroups.length) {
    box.innerHTML = `<div class="empty-state" style="padding:30px">
      <div class="empty-icon">👥</div>
      <div class="empty-text">ยังไม่มีกลุ่ม LINE — เปิด "จัดการกลุ่ม" เพื่อเพิ่มกลุ่มก่อน</div>
    </div>`;
    return;
  }
  box.innerHTML = allGroups
    .map((g) => {
      const checked = _evtSelectedGroupIds.has(g.group_id);
      const name = g.group_name || "(ยังไม่ตั้งชื่อ)";
      return `<label class="lp-grp-check-row ${checked ? "checked" : ""}">
        <input type="checkbox" ${checked ? "checked" : ""}
          onchange="window.toggleEvtGroupCheck('${escapeHtml(g.group_id)}', this.checked, this)" />
        <div class="lp-grp-check-info">
          <div class="lp-grp-check-name">
            ${escapeHtml(name)}
            ${g.is_default ? `<span class="lp-grp-default-badge">⭐ DEFAULT</span>` : ""}
          </div>
          <div class="lp-grp-check-meta">${escapeHtml(g.group_id.slice(0, 20))}…</div>
        </div>
      </label>`;
    })
    .join("");
}

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
    await sbFetch("events", `?event_id=eq.${currentEventId}`, {
      method: "PATCH",
      body: { line_group_ids: ids.length ? ids : null },
    });
    currentEvent.line_group_ids = ids.length ? ids : null;
    // also update cached row in allEvents
    const evIdx = allEvents.findIndex((e) => e.event_id === currentEventId);
    if (evIdx >= 0) allEvents[evIdx].line_group_ids = currentEvent.line_group_ids;
    showToast(`บันทึก ${ids.length} กลุ่มแล้ว ✅`, "success");
    renderEventHeader();
    window.closeEventGroupsModal();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 บันทึก";
    showLoading(false);
  }
};

// helper: หากลุ่มที่จะส่งสำหรับ event ปัจจุบัน — ใช้ event.line_group_ids ก่อน, fallback default
function _resolveTargetGroupsForEvent() {
  const ids = Array.isArray(currentEvent?.line_group_ids) ? currentEvent.line_group_ids : [];
  if (ids.length) {
    return allGroups.filter((g) => ids.includes(g.group_id));
  }
  const def = allGroups.find((g) => g.is_default);
  return def ? [def] : [];
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

window.closeTemplatesModal = function () {
  if (_tplDirty.size > 0) {
    if (!confirm(`มีการแก้ไข ${_tplDirty.size} รายการที่ยังไม่บันทึก — ปิดเลยหรือไม่?`)) return;
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
  // ใช้กลุ่มที่ผูกกับ event นี้ (multi-select) — ถ้ายังไม่ผูก → fallback default
  const targetGroups = _resolveTargetGroupsForEvent();
  if (!targetGroups.length) {
    return showToast('ยังไม่ได้เลือกกลุ่ม LINE — กดปุ่ม "📨 ส่งกลุ่ม LINE" บน event header เพื่อเลือก', "error");
  }

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

  // Replicate: สำหรับแต่ละ offset → 1 row ต่อ 1 group ที่ผูก
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
        message_text: templates[offset],
        scheduled_at,
        status: "SCHEDULED",
        created_by: session?.user_id || null,
      });
    }
  }

  showLoading(true);
  try {
    await sbFetch("line_scheduled_posts", "", { method: "POST", body: rows });
    showToast(`สร้างกำหนดการ ${rows.length} รายการ (4 D-day × ${targetGroups.length} กลุ่ม) แล้ว 📢`, "success");
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
