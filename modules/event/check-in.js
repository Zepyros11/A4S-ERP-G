/* ============================================================
   check-in.js — On-site QR scan + Check-in
============================================================ */

// ── SB FETCH ──────────────────────────────────────────────
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
    throw new Error(e.message || "API error");
  }
  return res.json().catch(() => null);
}

// ── STATE ─────────────────────────────────────────────────
let eventId = null;
let eventInfo = null;
let recentCheckins = []; // last 8
let lastScanAt = 0;
let lastScanText = "";

// ── INIT ──────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(window.location.search);
  eventId = parseInt(params.get("event_id") || params.get("event") || "");
  if (!eventId) {
    setResult("error", "❌ ไม่มี event_id", "กรุณาเข้าผ่านลิงก์ที่ถูกต้อง");
    return;
  }

  try {
    const rows = await sbFetch(
      "events",
      `?event_id=eq.${eventId}&select=event_id,event_name,event_code,event_date,location&limit=1`,
    );
    eventInfo = rows?.[0];
    if (eventInfo) {
      document.getElementById("ciEventName").textContent =
        `✅ ${eventInfo.event_name}`;
      document.getElementById("ciEventSub").textContent =
        `[${eventInfo.event_code}] ${eventInfo.location || ""}`;
    }
  } catch (e) {
    console.warn("load event:", e);
  }

  // Start QR scanner (if library loaded)
  if (window.Html5Qrcode) {
    const scanner = new Html5Qrcode("qr-reader");
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => handleScan(decoded),
        () => {},
      )
      .catch((err) => {
        document.getElementById("qr-reader").innerHTML =
          `<div style="padding:30px;text-align:center;color:#94a3b8;font-size:13px">⚠️ เปิดกล้องไม่ได้ (${err.message || err}) — ใช้ช่องพิมพ์ด้านล่างแทน</div>`;
      });
  } else {
    document.getElementById("qr-reader").innerHTML =
      `<div style="padding:30px;text-align:center;color:#94a3b8;font-size:13px">กำลังโหลด QR library...</div>`;
  }

  // Manual: Enter key
  const manualInput = document.getElementById("manualCode");
  manualInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      window.ciManualCheckin();
    }
  });
}

window.ciManualCheckin = async function () {
  const code = document.getElementById("manualCode").value.trim();
  if (!code) return;
  document.getElementById("manualCode").value = "";
  await handleScan(code);
};

// Debounce duplicate scans within 2 seconds
async function handleScan(scannedText) {
  const now = Date.now();
  if (scannedText === lastScanText && now - lastScanAt < 2000) return;
  lastScanText = scannedText;
  lastScanAt = now;

  const code = scannedText.trim();
  if (!code) return;

  setResult("warn", "🔍 กำลังค้นหา...", code);
  try {
    // Try ticket_no first, then member_code, then attendee_id
    let a = await lookupAttendee(code);
    if (!a) {
      setResult("error", "❌ ไม่พบในระบบ", `รหัส: ${code}`);
      return;
    }
    if (a.event_id !== eventId) {
      setResult(
        "error",
        "❌ ไม่ใช่ event นี้",
        `${a.name} ลงทะเบียนใน event อื่น`,
      );
      return;
    }

    if (a.checked_in) {
      setResultFromAttendee("warn", "⚠️ เช็คอินไปแล้ว", a);
      return;
    }

    // Mark checked_in
    const res = await sbFetch(
      "event_attendees",
      `?attendee_id=eq.${a.attendee_id}`,
      {
        method: "PATCH",
        body: { checked_in: true, check_in_at: new Date().toISOString() },
      },
    );
    const updated = res?.[0] || a;
    setResultFromAttendee("success", "✅ Check-in สำเร็จ", updated);
    pushRecent(updated);
  } catch (e) {
    setResult("error", "❌ Error", e.message);
  }
}

async function lookupAttendee(code) {
  // 1) Try ticket_no
  let rows = await sbFetch(
    "event_attendees",
    `?ticket_no=eq.${encodeURIComponent(code)}&select=*&limit=1`,
  );
  if (rows?.length) return rows[0];

  // 2) A4S-ATT-<id> format (fallback QR)
  const m = code.match(/^A4S-ATT-(\d+)$/);
  if (m) {
    rows = await sbFetch(
      "event_attendees",
      `?attendee_id=eq.${m[1]}&select=*&limit=1`,
    );
    if (rows?.length) return rows[0];
  }

  // 3) member_code within this event
  rows = await sbFetch(
    "event_attendees",
    `?member_code=eq.${encodeURIComponent(code)}&event_id=eq.${eventId}&select=*&limit=1`,
  );
  if (rows?.length) return rows[0];

  // 4) Try attendee_id raw
  if (/^\d+$/.test(code)) {
    rows = await sbFetch(
      "event_attendees",
      `?attendee_id=eq.${code}&select=*&limit=1`,
    );
    if (rows?.length) return rows[0];
  }

  return null;
}

function setResult(cls, title, detail) {
  const el = document.getElementById("ciResult");
  el.className = `ci-result ${cls}`;
  el.innerHTML = `
    <div class="ci-name">${escapeHtml(title)}</div>
    <div class="ci-meta">${escapeHtml(detail || "")}</div>`;
}

function setResultFromAttendee(cls, title, a) {
  const el = document.getElementById("ciResult");
  el.className = `ci-result ${cls}`;
  const statusChips = [
    a.payment_status === "PAID"
      ? '<span class="ci-status-chip ok">💳 ชำระแล้ว</span>'
      : a.payment_status === "COMPLIMENTARY"
      ? '<span class="ci-status-chip ok">🎫 ฟรี</span>'
      : '<span class="ci-status-chip warn">⏳ ยังไม่ชำระ</span>',
    a.position_level
      ? `<span class="ci-status-chip" style="background:#fef3c7;color:#92400e">⭐ ${escapeHtml(a.position_level)}</span>`
      : "",
  ].join("");

  const tags = a.tags || [];
  const awardBanner = tags.length
    ? `<div class="ci-award-banner">
         🏆 รางวัล / กลุ่มพิเศษ<br>
         ${tags.map((t) => `<span class="ci-award-tag">${escapeHtml(t)}</span>`).join("")}
       </div>`
    : "";

  el.innerHTML = `
    <div>${statusChips}</div>
    <div class="ci-name" style="margin-top:8px">${title}</div>
    <div class="ci-meta" style="font-size:16px;color:#0f172a;font-weight:700;margin-top:4px">
      ${a.member_code ? `[${escapeHtml(a.member_code)}] ` : ""}${escapeHtml(a.name)}
    </div>
    <div class="ci-meta">🎫 ${escapeHtml(a.ticket_no || "")}</div>
    ${awardBanner}
  `;
}

function pushRecent(a) {
  recentCheckins.unshift({
    name: a.name,
    memberCode: a.member_code,
    ticket: a.ticket_no,
    at: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
  if (recentCheckins.length > 8) recentCheckins.pop();
  renderRecent();
}

function renderRecent() {
  const box = document.getElementById("ciRecent");
  if (!recentCheckins.length) {
    box.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center;padding:8px">— ยังไม่มี —</div>`;
    return;
  }
  box.innerHTML = recentCheckins
    .map(
      (r) => `<div class="ci-recent-item">
      <div>
        <div class="ci-recent-name">${r.memberCode ? `[${escapeHtml(r.memberCode)}] ` : ""}${escapeHtml(r.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${escapeHtml(r.ticket || "")}</div>
      </div>
      <div class="ci-recent-time">${r.at}</div>
    </div>`,
    )
    .join("");
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
