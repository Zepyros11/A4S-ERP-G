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
      `?event_id=eq.${eventId}&select=event_id,event_name,event_code,event_date,location,poster_url&limit=1`,
    );
    eventInfo = rows?.[0];
    if (eventInfo) {
      document.getElementById("ciEventName").textContent = eventInfo.event_name;
      document.getElementById("ciEventSub").textContent = eventInfo.location || "";
      const posterEl = document.getElementById("ciHeroPoster");
      if (posterEl) {
        if (eventInfo.poster_url) {
          posterEl.innerHTML = `<img src="${eventInfo.poster_url}" alt="${eventInfo.event_name || ""}" />`;
          posterEl.style.display = "block";
        } else {
          posterEl.style.display = "none";
        }
      }
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

  // Manual: Enter key + force latin (strip Thai/non-ASCII, uppercase)
  const manualInput = document.getElementById("manualCode");
  // Prevent browser autofill (e.g. "Pob" from saved profile)
  manualInput.value = "";
  setTimeout(() => { manualInput.value = ""; }, 100);
  manualInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      window.ciManualCheckin();
    }
  });
  manualInput.addEventListener("input", (e) => {
    const v = e.target.value;
    const hasThai = /[\u0E00-\u0E7F]/.test(v);
    const cleaned = v.replace(/[^A-Za-z0-9\-]/g, "").toUpperCase();
    if (cleaned !== v) {
      e.target.value = cleaned;
      if (hasThai) {
        setResult(
          "error",
          "⚠️ Keyboard เป็นภาษาไทย",
          "เปลี่ยนเป็น EN ก่อนสแกน/พิมพ์ กด ~ หรือ Alt+Shift",
        );
      }
    }
  });
}

window.ciManualCheckin = async function () {
  const code = document.getElementById("manualCode").value.trim();
  if (!code) return;
  document.getElementById("manualCode").value = "";
  await handleScan(code, { requirePassword: true });
};

// ── MEMBER PASSWORD VERIFICATION (manual check-in only) ──
async function fetchMemberPasswordEnc(memberCode) {
  const rows = await sbFetch(
    "members",
    `?member_code=eq.${encodeURIComponent(memberCode)}&select=password_encrypted&limit=1`,
  ).catch(() => null);
  return rows?.[0]?.password_encrypted || null;
}

function requireMemberPassword(attendee) {
  return new Promise(async (resolve) => {
    const modal = document.getElementById("ciPinModal");
    const input = document.getElementById("ciPinInput");
    const err = document.getElementById("ciPinError");
    const title = document.getElementById("ciPinTitle");
    const hint = document.getElementById("ciPinHint");
    const submit = document.getElementById("ciPinSubmit");
    const cancel = document.getElementById("ciPinCancel");

    // No member_code → can't verify (e.g. guest attendee) → just allow
    if (!attendee.member_code) return resolve(true);

    // Check master key available
    if (!window.ERPCrypto || !ERPCrypto.hasMasterKey()) {
      alert("⚠️ ยังไม่ได้ตั้ง master key บนอุปกรณ์นี้ — ไปที่ตั้งค่าเพื่อกรอกก่อน");
      return resolve(false);
    }

    // Fetch encrypted password
    let enc = null;
    try {
      enc = await fetchMemberPasswordEnc(attendee.member_code);
    } catch {}

    // No password on record → allow (fallback)
    if (!enc) return resolve(true);

    // Decrypt
    let real = null;
    try {
      real = await ERPCrypto.decrypt(enc);
    } catch {
      alert("⚠️ ถอดรหัสไม่สำเร็จ — master key อาจผิด");
      return resolve(false);
    }
    if (!real) return resolve(true);

    title.textContent = "🔒 ยืนยันตัวตน";
    hint.innerHTML = `<div class="ci-pin-name">${escapeHtml(attendee.name || "")}</div><div class="ci-pin-sub">กรอกรหัสผ่านของคุณ</div>`;
    submit.textContent = "ยืนยัน";
    err.textContent = "";
    input.value = "";
    input.type = "password";
    modal.classList.add("open");
    setTimeout(() => input.focus(), 50);

    let attempts = 0;
    const cleanup = () => {
      modal.classList.remove("open");
      submit.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
    };
    const finish = (ok) => { cleanup(); resolve(ok); };

    const tryIt = () => {
      const v = input.value;
      if (!v) {
        err.textContent = "กรุณาใส่รหัสผ่าน";
        return;
      }
      if (v === real) {
        finish(true);
      } else {
        attempts++;
        err.textContent = `❌ รหัสผ่านไม่ถูกต้อง (${attempts}/3)`;
        input.value = "";
        input.focus();
        if (attempts >= 3) {
          setTimeout(() => finish(false), 600);
        }
      }
    };

    submit.onclick = tryIt;
    cancel.onclick = () => finish(false);
    input.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); tryIt(); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    };
  });
}

// ── SHARE REGISTER LINK ─────────────────────────────────
function buildRegisterUrl() {
  if (!eventId) return "";
  const base = `${location.origin}${location.pathname.replace(/check-in\.html.*$/, "register.html")}`;
  return `${base}?event=${eventId}`;
}

window.ciOpenShareLink = function () {
  const url = buildRegisterUrl();
  if (!url) {
    alert("ไม่มี event_id");
    return;
  }
  document.getElementById("shareLinkInput").value = url;

  const wrap = document.getElementById("shareQrCode");
  wrap.innerHTML = "";
  try {
    new QRCode(wrap, {
      text: url,
      width: 220,
      height: 220,
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    wrap.textContent = "QR library ยังไม่โหลด — รีเฟรชหน้าอีกครั้ง";
  }
  document.getElementById("shareModal").classList.add("open");
};

window.ciCloseShareLink = function () {
  document.getElementById("shareModal").classList.remove("open");
};

window.ciCopyShareLink = async function () {
  const input = document.getElementById("shareLinkInput");
  const url = input.value;
  try {
    await navigator.clipboard.writeText(url);
    showCopiedToast();
  } catch {
    input.select();
    document.execCommand("copy");
    showCopiedToast();
  }
};

function showCopiedToast() {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = "✅ คัดลอกลิงก์แล้ว";
  t.className = "toast toast-success show";
  setTimeout(() => { t.className = "toast"; }, 1800);
}

// Debounce duplicate scans within 2 seconds
async function handleScan(scannedText, opts = {}) {
  const now = Date.now();
  if (scannedText === lastScanText && now - lastScanAt < 2000) return;
  lastScanText = scannedText;
  lastScanAt = now;

  // Normalize: strip whitespace/zero-width, keep alphanumerics + dash, uppercase
  const raw = String(scannedText || "");
  const hasThai = /[\u0E00-\u0E7F]/.test(raw);
  const code = raw
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^A-Za-z0-9\-]/g, "")
    .toUpperCase();

  if (hasThai) {
    setResult(
      "error",
      "⚠️ Keyboard เป็นภาษาไทย",
      "เปลี่ยนเป็น EN ก่อนสแกน กด ~ หรือ Alt+Shift",
    );
    return;
  }
  if (!code) {
    setResult("error", "❌ ไม่สามารถอ่าน QR ได้", "");
    return;
  }

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

    // Verify member password for manual check-in
    if (opts.requirePassword) {
      const ok = await requireMemberPassword(a);
      if (!ok) {
        setResult("error", "❌ ยกเลิกการ check-in", "ยืนยันรหัสผ่านไม่สำเร็จ");
        // Reset debounce so same code can be retried immediately
        lastScanText = "";
        lastScanAt = 0;
        return;
      }
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
    showSuccessPopup(updated);
    pushRecent(updated);
  } catch (e) {
    setResult("error", "❌ Error", e.message);
  }
}

async function lookupAttendee(code) {
  // Combine ticket_no + attendee_id (from A4S-ATT-N or raw numeric) into one OR query.
  // member_code requires event filter so runs as a parallel second query.
  const conds = [`ticket_no.eq.${encodeURIComponent(code)}`];
  const m = code.match(/^A4S-ATT-(\d+)$/);
  if (m) conds.push(`attendee_id.eq.${m[1]}`);
  if (/^\d+$/.test(code)) conds.push(`attendee_id.eq.${code}`);

  const [globalRows, memberRows] = await Promise.all([
    sbFetch(
      "event_attendees",
      `?or=(${conds.join(",")})&select=*&limit=5`,
    ).catch(() => []),
    sbFetch(
      "event_attendees",
      `?member_code=eq.${encodeURIComponent(code)}&event_id=eq.${eventId}&select=*&limit=1`,
    ).catch(() => []),
  ]);

  const all = [...(globalRows || []), ...(memberRows || [])];
  if (all.length) {
    // Prefer the attendee registered for current event
    const inEvent = all.find((r) => r.event_id === eventId);
    return inEvent || all[0];
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

let _successCloseTimer = null;
function showSuccessPopup(a) {
  const modal = document.getElementById("ciSuccessModal");
  if (!modal) return;

  document.getElementById("ciSuccessName").textContent =
    (a.member_code ? `[${a.member_code}] ` : "") + (a.name || "");
  document.getElementById("ciSuccessTicket").textContent = a.ticket_no
    ? `🎫 ${a.ticket_no}`
    : "";

  const chips = [
    a.payment_status === "PAID"
      ? '<span class="ci-status-chip ok">💳 ชำระแล้ว</span>'
      : a.payment_status === "COMPLIMENTARY"
      ? '<span class="ci-status-chip ok">🎫 ฟรี</span>'
      : '<span class="ci-status-chip warn">⏳ ยังไม่ชำระ</span>',
    a.position_level
      ? `<span class="ci-status-chip" style="background:#fef3c7;color:#92400e">⭐ ${escapeHtml(a.position_level)}</span>`
      : "",
  ].join("");
  document.getElementById("ciSuccessChips").innerHTML = chips;

  const award = document.getElementById("ciSuccessAward");
  const tags = a.tags || [];
  if (tags.length) {
    award.innerHTML =
      `🏆 รางวัล / กลุ่มพิเศษ<br>` +
      tags.map((t) => `<span class="ci-award-tag">${escapeHtml(t)}</span>`).join("");
    award.style.display = "block";
  } else {
    award.style.display = "none";
  }

  // Restart progress animation
  const bar = modal.querySelector(".ci-success-progress");
  if (bar) {
    const clone = bar.cloneNode(true);
    bar.parentNode.replaceChild(clone, bar);
  }

  modal.classList.add("open");
  try {
    if (navigator.vibrate) navigator.vibrate(80);
  } catch {}

  clearTimeout(_successCloseTimer);
  _successCloseTimer = setTimeout(() => modal.classList.remove("open"), 2200);
}

window.ciCloseSuccess = function () {
  clearTimeout(_successCloseTimer);
  document.getElementById("ciSuccessModal")?.classList.remove("open");
};

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
