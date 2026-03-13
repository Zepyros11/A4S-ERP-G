/* ============================================================
   event-log.js — Controller for Event Log page
============================================================ */

import {
  fetchEventById,
  fetchEventLogs,
  fetchUsers,
  createEventLog,
} from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let eventId = null;
let eventData = null;
let allUsers = [];
let attachFile = null;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  const params = new URLSearchParams(window.location.search);
  eventId = params.get("id") ? parseInt(params.get("id")) : null;

  if (!eventId) {
    showToast("ไม่พบ Event ID", "error");
    return;
  }

  await loadAll();
  startAutoRefresh();
}

async function loadAll() {
  showLoading(true);
  try {
    const [evt, usrs, logs] = await Promise.all([
      fetchEventById(eventId),
      fetchUsers(),
      fetchEventLogs(eventId),
    ]);
    eventData = evt;
    allUsers = usrs || [];

    renderInfoCard();
    renderLogs(logs);
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── RENDER INFO CARD ───────────────────────────────────────
function renderInfoCard() {
  if (!eventData) return;
  const e = eventData;
  const user = allUsers.find((u) => u.user_id === e.assigned_to);

  // Poster
  document.getElementById("logPoster").innerHTML = e.poster_url
    ? `<img src="${e.poster_url}" alt="${e.event_name}">`
    : `<span style="font-size:48px; opacity:0.3;">🗓️</span>`;

  document.getElementById("logEventName").textContent = e.event_name || "—";
  document.getElementById("logEventCode").textContent = e.event_code || "";
  document.getElementById("pageSubtitle").textContent = e.event_code || "";

  document.getElementById("logStatus").innerHTML =
    `<span class="event-status-badge status-${e.status}">
      ${statusLabel(e.status)}
    </span>`;
  document.getElementById("logType").innerHTML =
    `<span class="event-type-badge type-${e.event_type}">
      ${typeLabel(e.event_type)}
    </span>`;

  document.getElementById("logDate").textContent =
    formatDate(e.event_date) +
    (e.end_date && e.end_date !== e.event_date
      ? ` — ${formatDate(e.end_date)}`
      : "");

  document.getElementById("logTime").textContent =
    e.start_time && e.end_time
      ? `${e.start_time.slice(0, 5)} — ${e.end_time.slice(0, 5)} น.`
      : "—";

  document.getElementById("logLocation").textContent = e.location || "—";
  document.getElementById("logAssignee").textContent = user
    ? user.full_name
    : "—";

  // ปุ่มแก้ไข
  document.getElementById("btnEditEvent").onclick = () =>
    (window.location.href = `./event-form.html?id=${e.event_id}`);
}

// ── RENDER LOGS ────────────────────────────────────────────
function renderLogs(logs) {
  const timeline = document.getElementById("logTimeline");
  const countEl = document.getElementById("logCount");

  if (countEl) countEl.textContent = `${logs.length} รายการ`;

  if (!logs.length) {
    timeline.innerHTML = `
      <div class="log-empty">
        <div style="font-size:32px;">💬</div>
        <div>ยังไม่มี Log กิจกรรม</div>
      </div>`;
    return;
  }

  timeline.innerHTML = logs
    .map((log) => {
      const user = allUsers.find((u) => u.user_id === log.user_id);
      const name = user?.full_name || log.users?.full_name || "ไม่ทราบชื่อ";
      const initials = name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

      const attachHtml = log.attachment_url
        ? `<a class="log-attachment"
            href="${log.attachment_url}" target="_blank">
           📎 ดูไฟล์แนบ
         </a>`
        : "";

      return `
      <div class="log-item">
        <div class="log-avatar">${initials}</div>
        <div class="log-bubble">
          <div class="log-bubble-header">
            <span class="log-bubble-name">${name}</span>
            <span class="log-type-badge logtype-${log.log_type}">
              ${logTypeLabel(log.log_type)}
            </span>
            <span class="log-bubble-time">${timeAgo(log.created_at)}</span>
          </div>
          <div class="log-bubble-msg">${escapeHtml(log.message)}</div>
          ${attachHtml}
        </div>
      </div>`;
    })
    .join("");

  // scroll to bottom
  timeline.scrollTop = timeline.scrollHeight;
}

// ── ATTACH FILE ────────────────────────────────────────────
window.handleAttach = function (input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกิน 10MB", "error");
    return;
  }
  attachFile = file;
  document.getElementById("attachName").textContent = `📎 ${file.name}`;
};

// ── SUBMIT LOG ─────────────────────────────────────────────
window.submitLog = async function () {
  const message = document.getElementById("logMessage").value.trim();
  const logType = document.getElementById("logType").value;

  if (!message) {
    showToast("กรุณาพิมพ์ข้อความก่อนส่ง", "error");
    return;
  }

  // ดึง user_id จาก session
  const session = JSON.parse(
    localStorage.getItem("erp_session") ||
      sessionStorage.getItem("erp_session") ||
      "{}",
  );
  const userId = session?.user_id;
  if (!userId) {
    showToast("กรุณา Login ก่อน", "error");
    return;
  }

  showLoading(true);
  try {
    // Upload attachment ถ้ามี
    let attachUrl = null;
    if (attachFile) {
      const { url, key } = getSB();
      const ext = attachFile.name.split(".").pop();
      const fileName = `${eventId}_${Date.now()}.${ext}`;
      const res = await fetch(
        `${url}/storage/v1/object/event-files/documents/${fileName}`,
        {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": attachFile.type,
            "x-upsert": "true",
          },
          body: attachFile,
        },
      );
      if (res.ok) {
        attachUrl = `${url}/storage/v1/object/public/event-files/documents/${fileName}`;
      }
    }

    // Save log
    await createEventLog({
      event_id: eventId,
      user_id: userId,
      log_type: logType,
      message: message,
      attachment_url: attachUrl,
    });

    // Reset input
    document.getElementById("logMessage").value = "";
    document.getElementById("attachName").textContent = "";
    document.getElementById("logAttach").value = "";
    attachFile = null;

    showToast("ส่งข้อความแล้ว", "success");

    // Reload logs
    const logs = await fetchEventLogs(eventId);
    renderLogs(logs);
  } catch (err) {
    showToast("ส่งไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};

// ── AUTO REFRESH ───────────────────────────────────────────
function startAutoRefresh() {
  // refresh logs ทุก 30 วินาที
  setInterval(async () => {
    try {
      const logs = await fetchEventLogs(eventId);
      renderLogs(logs);
    } catch (_) {}
  }, 30000);
}

// ── HELPERS ────────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

function formatDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const months = [
    "",
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
  ];
  return `${parseInt(day)} ${months[parseInt(m)]} ${parseInt(y) + 543}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return "เมื่อกี้";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชม. ที่แล้ว`;
  return `${Math.floor(diff / 86400)} วันที่แล้ว`;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function logTypeLabel(t) {
  return (
    {
      UPDATE: "📢 อัปเดต",
      NOTE: "📝 หมายเหตุ",
      REQUEST: "🙏 ขอความช่วยเหลือ",
      ISSUE: "⚠️ แจ้งปัญหา",
    }[t] || t
  );
}

function typeLabel(t) {
  return (
    {
      BOOTH: "🏪 ออกบูธ",
      MEETING: "👥 ประชุม",
      ONLINE: "💻 Online",
      HYBRID: "🔀 Hybrid",
      CONFERENCE: "🎤 Conference",
      OTHER: "📌 อื่นๆ",
    }[t] || t
  );
}

function statusLabel(s) {
  return (
    {
      DRAFT: "📝 Draft",
      CONFIRMED: "✅ Confirmed",
      ONGOING: "▶️ Ongoing",
      DONE: "🏁 Done",
      CANCELLED: "❌ Cancelled",
    }[s] || s
  );
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

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
