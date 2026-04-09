/* ============================================================
   media-schedule.js — Controller for Media Schedule page
============================================================ */

// ── API ───────────────────────────────────────────────────
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
  return (
    sbFetch(
      "events",
      "?select=event_id,event_name,event_code&order=event_date.desc",
    ) || []
  );
}
async function fetchMediaList(eventId) {
  return (
    sbFetch("event_media", `?event_id=eq.${eventId}&order=created_at.asc`) || []
  );
}
async function fetchUsers() {
  return (
    sbFetch(
      "users",
      "?select=user_id,full_name&is_active=eq.true&order=full_name",
    ) || []
  );
}
async function createMedia(data) {
  const res = await sbFetch("event_media", "", { method: "POST", body: data });
  return res?.[0];
}
async function updateMedia(id, data) {
  return sbFetch("event_media", `?media_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}
async function removeMedia(id) {
  return sbFetch("event_media", `?media_id=eq.${id}`, { method: "DELETE" });
}

async function uploadMediaFile(eventId, file) {
  const { url, key } = getSB();
  const ext = file.name.split(".").pop().toLowerCase();
  const name = `media_${eventId}_${Date.now()}.${ext}`;
  const path = `media/${name}`;

  const res = await fetch(`${url}/storage/v1/object/event-files/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Upload failed");
  }
  return `${url}/storage/v1/object/public/event-files/${path}`;
}

// ── STATE ─────────────────────────────────────────────────
let allEvents = [];
let allUsers = [];
let currentEventId = null;
let allMedia = [];
let editingMedId = null;
let pendingFile = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    [allEvents, allUsers] = await Promise.all([fetchEvents(), fetchUsers()]);
    populateEventSelect();
    populateUserFilter();

    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id");
    if (urlEventId) {
      document.getElementById("eventSelect").value = urlEventId;
      await loadMedia(parseInt(urlEventId));
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterTable);
  document
    .getElementById("filterType")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterStatus")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterAssigned")
    ?.addEventListener("change", filterTable);
}

function populateEventSelect() {
  const sel = document.getElementById("eventSelect");
  sel.innerHTML = '<option value="">-- เลือกกิจกรรม --</option>';
  allEvents.forEach((e) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${e.event_id}">[${e.event_code}] ${e.event_name}</option>`,
    ),
  );
}

function populateUserFilter() {
  const sel = document.getElementById("filterAssigned");
  const fSel = document.getElementById("fMedAssigned");
  const opts = allUsers
    .map((u) => `<option value="${u.user_id}">${u.full_name}</option>`)
    .join("");
  if (sel) sel.insertAdjacentHTML("beforeend", opts);
  if (fSel) fSel.insertAdjacentHTML("beforeend", opts);
}

// ── EVENT CHANGE ──────────────────────────────────────────
window.onEventChange = async function () {
  const val = document.getElementById("eventSelect").value;
  if (!val) {
    showSections(false);
    return;
  }
  await loadMedia(parseInt(val));
};

async function loadMedia(eventId) {
  currentEventId = eventId;
  showLoading(true);
  try {
    allMedia = (await fetchMediaList(eventId)) || [];
    showSections(true);
    updateStats();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function showSections(show) {
  ["medStatsSection", "medToolbar", "medTableSection"].forEach((id) => {
    document.getElementById(id).style.display = show ? "block" : "none";
  });
  document.getElementById("noEventState").style.display = show
    ? "none"
    : "block";
  document.getElementById("mediaActionBtns").style.display = show
    ? "block"
    : "none";
}

// ── STATS + PROGRESS ──────────────────────────────────────
function updateStats() {
  const today = new Date().toLocaleDateString("sv", {
    timeZone: "Asia/Bangkok",
  });
  const total = allMedia.length;
  const done = allMedia.filter((m) => m.status === "DONE").length;
  const inprog = allMedia.filter((m) => m.status === "INPROGRESS").length;
  const overdue = allMedia.filter(
    (m) =>
      m.due_date &&
      m.due_date < today &&
      m.status !== "DONE" &&
      m.status !== "CANCELLED",
  ).length;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statDone").textContent = done;
  document.getElementById("statInprogress").textContent = inprog;
  document.getElementById("statOverdue").textContent = overdue;

  const activeTasks = allMedia.filter((m) => m.status !== "CANCELLED").length;
  const pct = activeTasks ? Math.round((done / activeTasks) * 100) : 0;
  document.getElementById("progressPct").textContent = `${pct}%`;
  const bar = document.getElementById("progressBar");
  bar.style.width = `${pct}%`;
  bar.className = `med-progress-bar${pct === 100 ? " done" : pct >= 80 ? " over80" : ""}`;
}

// ── FILTER + RENDER ───────────────────────────────────────
function filterTable() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const type = document.getElementById("filterType")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";
  const assigned = document.getElementById("filterAssigned")?.value || "";

  const filtered = allMedia.filter((m) => {
    const assignedUser = allUsers.find((u) => u.user_id === m.assigned_to);
    const matchSearch =
      !search ||
      (m.title || "").toLowerCase().includes(search) ||
      (assignedUser?.full_name || "").toLowerCase().includes(search);
    const matchType = !type || m.media_type === type;
    const matchStatus = !status || m.status === status;
    const matchAssigned = !assigned || String(m.assigned_to) === assigned;
    return matchSearch && matchType && matchStatus && matchAssigned;
  });

  renderTable(filtered);
}

function renderTable(list) {
  const tbody = document.getElementById("medTableBody");
  const countEl = document.getElementById("medCount");
  if (countEl) countEl.textContent = `${list.length} งาน`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-text">ไม่พบรายการ</div>
      </div></td></tr>`;
    return;
  }

  const today = new Date().toLocaleDateString("sv", {
    timeZone: "Asia/Bangkok",
  });

  tbody.innerHTML = list
    .map((m) => {
      const assignedUser = allUsers.find((u) => u.user_id === m.assigned_to);
      const dueCls = !m.due_date
        ? ""
        : m.due_date < today && m.status !== "DONE"
          ? "due-overdue"
          : m.due_date === today
            ? "due-today"
            : "due-normal";

      return `<tr>
      <td>
        <div style="font-weight:600">${m.title}</div>
        ${
          m.detail
            ? `<div style="font-size:11px;color:var(--text3);
              max-width:240px;white-space:nowrap;overflow:hidden;
              text-overflow:ellipsis">${m.detail}</div>`
            : ""
        }
      </td>
      <td class="col-center">
        <span class="media-type-badge mtype-${m.media_type || "OTHER"}">
          ${mediaTypeLabel(m.media_type)}
        </span>
      </td>
      <td class="col-center" style="font-size:13px">
        ${assignedUser ? assignedUser.full_name : '<span style="color:var(--text3)">—</span>'}
      </td>
      <td class="col-center">
        <span class="font-size:13px ${dueCls}">
          ${m.due_date ? formatDate(m.due_date) : "—"}
        </span>
        ${
          dueCls === "due-overdue"
            ? `<div style="font-size:10px;color:#dc2626">⚠ เกิน deadline</div>`
            : ""
        }
      </td>
      <td class="col-center">
        <select class="form-input" style="font-size:12px;padding:3px 6px;width:auto"
          onchange="window.updateMediaStatus(${m.media_id}, this.value)">
          ${["TODO", "INPROGRESS", "DONE", "CANCELLED"]
            .map(
              (s) =>
                `<option value="${s}" ${m.status === s ? "selected" : ""}>
              ${statusLabel(s)}</option>`,
            )
            .join("")}
        </select>
      </td>
      <td class="col-center">
        ${
          m.file_url
            ? `<a class="file-link" href="${m.file_url}" target="_blank">
              📎 ดูไฟล์</a>`
            : '<span style="color:var(--text3);font-size:12px">—</span>'
        }
      </td>
      <td style="text-align:center">
        <div class="action-group">
          <button class="btn-icon"
            onclick="window.openMedModal(${m.media_id})">✏️</button>
          <button class="btn-icon danger"
            onclick="window.deleteMedia(${m.media_id})">🗑</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// ── INLINE STATUS UPDATE ──────────────────────────────────
window.updateMediaStatus = async function (id, status) {
  try {
    await updateMedia(id, { status });
    const m = allMedia.find((x) => x.media_id === id);
    if (m) m.status = status;
    updateStats();
    showToast("อัปเดตสถานะแล้ว", "success");
  } catch (e) {
    showToast("อัปเดตไม่สำเร็จ: " + e.message, "error");
    filterTable(); // revert UI
  }
};

// ── MODAL ─────────────────────────────────────────────────
window.openMedModal = function (id = null) {
  editingMedId = id;
  pendingFile = null;
  document.getElementById("medModalTitle").textContent = id
    ? "✏️ แก้ไขงาน Media"
    : "🎬 เพิ่มงาน Media";

  ["fMedId", "fMedTitle", "fMedDetail", "fMedDueDate", "fMedFileUrl"].forEach(
    (f) => (document.getElementById(f).value = ""),
  );
  document.getElementById("fMedType").value = "PHOTO";
  document.getElementById("fMedStatus").value = "TODO";
  document.getElementById("fMedAssigned").value = "";
  document.getElementById("fMedFile").value = "";
  document.getElementById("fMedFileInfo").style.display = "none";

  if (id) {
    const m = allMedia.find((x) => x.media_id === id);
    if (m) {
      document.getElementById("fMedId").value = m.media_id;
      document.getElementById("fMedTitle").value = m.title || "";
      document.getElementById("fMedType").value = m.media_type || "PHOTO";
      document.getElementById("fMedStatus").value = m.status || "TODO";
      document.getElementById("fMedDetail").value = m.detail || "";
      document.getElementById("fMedDueDate").value = m.due_date || "";
      document.getElementById("fMedAssigned").value = m.assigned_to || "";
      document.getElementById("fMedFileUrl").value = m.file_url || "";
      if (m.file_url) {
        const info = document.getElementById("fMedFileInfo");
        info.style.display = "block";
        info.textContent = "📎 ไฟล์ปัจจุบัน: " + m.file_url.split("/").pop();
      }
    }
  }
  document.getElementById("medModalOverlay").classList.add("open");
};

window.closeMedModal = function () {
  document.getElementById("medModalOverlay").classList.remove("open");
  editingMedId = null;
  pendingFile = null;
};

window.handleMedFileChange = function (input) {
  const file = input.files?.[0];
  if (!file) return;
  pendingFile = file;
  const info = document.getElementById("fMedFileInfo");
  info.style.display = "block";
  info.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
};

window.saveMedia = async function () {
  const title = document.getElementById("fMedTitle").value.trim();
  if (!title) {
    showToast("กรุณาระบุชื่องาน", "error");
    return;
  }

  const btn = document.getElementById("btnSaveMed");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบันทึก...";
  showLoading(true);

  try {
    let fileUrl = document.getElementById("fMedFileUrl").value || null;

    if (pendingFile) {
      fileUrl = await uploadMediaFile(currentEventId, pendingFile);
    }

    const payload = {
      event_id: currentEventId,
      title,
      media_type: document.getElementById("fMedType").value,
      status: document.getElementById("fMedStatus").value,
      detail: document.getElementById("fMedDetail").value || null,
      due_date: document.getElementById("fMedDueDate").value || null,
      assigned_to:
        parseInt(document.getElementById("fMedAssigned").value) || null,
      file_url: fileUrl,
    };

    if (editingMedId) {
      await updateMedia(editingMedId, payload);
      showToast("แก้ไขงาน Media แล้ว", "success");
    } else {
      await createMedia(payload);
      showToast("เพิ่มงาน Media แล้ว 🎬", "success");
    }

    window.closeMedModal();
    allMedia = await fetchMediaList(currentEventId);
    updateStats();
    filterTable();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }

  btn.disabled = false;
  btn.textContent = "💾 บันทึก";
  showLoading(false);
};

// ── DELETE ────────────────────────────────────────────────
window.deleteMedia = function (id) {
  const m = allMedia.find((x) => x.media_id === id);
  if (!m) return;
  DeleteModal.open(`ต้องการลบงาน "${m.title}" หรือไม่?`, async () => {
    showLoading(true);
    try {
      await removeMedia(id);
      showToast("ลบงาน Media แล้ว", "success");
      allMedia = await fetchMediaList(currentEventId);
      updateStats();
      filterTable();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── HELPERS ───────────────────────────────────────────────
function mediaTypeLabel(t) {
  return (
    {
      PHOTO: "📷 Photo",
      VIDEO: "🎥 Video",
      GRAPHIC: "🎨 Graphic",
      LIVE: "🔴 Live",
      DOCUMENT: "📄 Document",
      OTHER: "📁 Other",
    }[t] ||
    t ||
    "—"
  );
}
function statusLabel(s) {
  return (
    {
      TODO: "📋 Todo",
      INPROGRESS: "⚡ In Progress",
      DONE: "✅ Done",
      CANCELLED: "❌ Cancelled",
    }[s] ||
    s ||
    "—"
  );
}
function formatDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
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
