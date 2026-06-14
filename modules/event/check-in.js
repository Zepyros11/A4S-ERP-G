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
let tagCategoriesByName = {}; // { tag_name: { detail, color, ... } } for current event
let qrScanner = null; // Html5Qrcode instance, null when stopped

// ── MULTI-DAY CHECK-IN (per-day) ──────────────────────────
// event หลายวัน (end_date > event_date) → เช็คอินลง "วันของวันนี้" ใน checkin_by_day (ไม่ทับวันอื่น)
// event 1 วัน → ใช้ checked_in/check_in_at เดิม
function ciIsMultiDay() {
  return !!(eventInfo && eventInfo.end_date && eventInfo.end_date > eventInfo.event_date);
}
function ciTodayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
function ciEventDays() {
  if (!eventInfo || !eventInfo.event_date) return [];
  const end = ciIsMultiDay() ? eventInfo.end_date : eventInfo.event_date;
  const [sy, sm, sd] = eventInfo.event_date.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const endDate = new Date(ey, em - 1, ed);
  const days = [];
  for (let guard = 0; cur <= endDate && guard < 60; guard++) {
    const mm = String(cur.getMonth() + 1).padStart(2, "0");
    const dd = String(cur.getDate()).padStart(2, "0");
    days.push(`${cur.getFullYear()}-${mm}-${dd}`);
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
// วันที่จะเช็คอิน = วันนี้ (ถ้าอยู่ในช่วงงาน) · ก่อนเริ่ม→วันแรก · หลังจบ→วันสุดท้าย
function ciTargetDay() {
  const days = ciEventDays();
  if (!days.length) return null;
  const today = ciTodayISO();
  if (days.includes(today)) return today;
  if (today < days[0]) return days[0];
  return days[days.length - 1];
}
function ciDayDone(a, day) {
  return !!(a && a.checkin_by_day && a.checkin_by_day[day]);
}
function ciRollup(map) {
  const keys = Object.keys(map || {});
  if (!keys.length) return { checked_in: false, check_in_at: null };
  const times = keys.map((k) => map[k]).filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
  return { checked_in: true, check_in_at: times[0] || null };
}
function ciFmtDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ── TAG-FLEX RESEND BLOCK (toggle) ────────────────────────
// ON  = check tag_notified_at flag → ส่งครั้งเดียว (default)
// OFF = ส่ง flex ทุกครั้งที่ check-in สำเร็จ
const TAG_RESEND_BLOCK_KEY = "ci_tag_resend_block";
function isTagResendBlocked() {
  const v = localStorage.getItem(TAG_RESEND_BLOCK_KEY);
  return v === null ? true : v === "1";
}
function _syncTagResendUi() {
  const input = document.getElementById("tagResendBlockInput");
  const label = document.getElementById("tagResendLabel");
  if (input) input.checked = isTagResendBlocked();
  if (label) label.textContent = isTagResendBlocked() ? "🏷️ กัน Flex ซ้ำ" : "🏷️ ส่ง Flex ทุกครั้ง";
}
window.onTagResendToggle = function (checked) {
  localStorage.setItem(TAG_RESEND_BLOCK_KEY, checked ? "1" : "0");
  _syncTagResendUi();
};

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
      `?event_id=eq.${eventId}&select=event_id,event_name,event_code,event_date,end_date,location,poster_url,line_channel_id&limit=1`,
    );
    eventInfo = rows?.[0];
    if (eventInfo) {
      document.getElementById("ciEventName").textContent = eventInfo.event_name;
      let _sub = eventInfo.location || "";
      if (ciIsMultiDay()) {
        const _days = ciEventDays();
        const _td = ciTargetDay();
        const _n = _days.indexOf(_td) + 1;
        _sub = (_sub ? _sub + " · " : "") + `📅 กำลังเช็คอินวันที่ ${_n} (${ciFmtDMY(_td)})`;
      }
      document.getElementById("ciEventSub").textContent = _sub;
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

  // Load event-scoped tag categories (for LINE flex detail) — degrade silently if table missing
  try {
    const cats = await sbFetch(
      "event_tag_categories",
      `?event_id=eq.${eventId}&select=tag_name,detail,color`,
    );
    tagCategoriesByName = {};
    (cats || []).forEach((c) => { tagCategoriesByName[c.tag_name] = c; });
  } catch (e) {
    console.warn("load tag categories:", e?.message || e);
    tagCategoriesByName = {};
  }

  // Sync tag-resend toggle UI from saved state
  _syncTagResendUi();

  // Start QR scanner (if library loaded)
  if (window.Html5Qrcode) {
    startCamera();
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

// ── CAMERA TOGGLE ─────────────────────────────────────────
function startCamera() {
  if (!window.Html5Qrcode) return;
  const reader = document.getElementById("qr-reader");
  if (reader) {
    reader.innerHTML = "";
    reader.classList.remove("hidden");
  }
  qrScanner = new Html5Qrcode("qr-reader");
  qrScanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decoded) => handleScan(decoded),
      () => {},
    )
    .catch((err) => {
      qrScanner = null;
      if (reader) {
        reader.innerHTML =
          `<div style="padding:30px;text-align:center;color:#94a3b8;font-size:13px">⚠️ เปิดกล้องไม่ได้ (${err.message || err}) — ใช้ช่องพิมพ์ด้านล่างแทน</div>`;
      }
    });
  _syncCameraToggleUi(true);
}

async function stopCamera() {
  if (!qrScanner) return;
  try {
    await qrScanner.stop();
    await qrScanner.clear();
  } catch (e) {
    console.warn("stop camera:", e?.message || e);
  }
  qrScanner = null;
  const reader = document.getElementById("qr-reader");
  if (reader) {
    reader.classList.add("hidden");
    reader.innerHTML = "";
  }
  _syncCameraToggleUi(false);
}

function _syncCameraToggleUi(on) {
  const btn = document.getElementById("ciCameraToggle");
  if (!btn) return;
  if (on) {
    btn.textContent = "⏸ ปิดกล้อง";
    btn.classList.remove("off");
  } else {
    btn.textContent = "▶ เปิดกล้อง";
    btn.classList.add("off");
  }
}

window.ciToggleCamera = function () {
  if (qrScanner) stopCamera();
  else startCamera();
};

window.ciManualCheckin = async function () {
  const code = document.getElementById("manualCode").value.trim();
  if (!code) return;
  document.getElementById("manualCode").value = "";
  await handleScan(code);
};

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
async function handleScan(scannedText) {
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
    const matches = await lookupAttendee(code);
    if (!matches.length) {
      setResult("error", "❌ ไม่พบในระบบ", `รหัส: ${code}`);
      return;
    }

    const inEvent = matches.filter((m) => m.event_id === eventId);
    if (!inEvent.length) {
      const a = matches[0];
      setResult(
        "error",
        "❌ ไม่ใช่ event นี้",
        `${a.name} ลงทะเบียนใน event อื่น`,
      );
      return;
    }

    let selected;
    if (inEvent.length === 1) {
      selected = [inEvent[0]];
    } else {
      // 2 rows = primary + co_applicant ใน event เดียวกัน → เปิด picker
      const wasCameraOn = !!qrScanner;
      if (wasCameraOn) await stopCamera();
      const pick = await showCheckinPersonPicker(inEvent);
      if (wasCameraOn) startCamera();
      if (!pick || !pick.length) {
        setResult("warn", "ยกเลิก", "ผู้ใช้ยกเลิกการเลือก");
        return;
      }
      selected = pick;
    }

    // Process all check-ins → split into newly-CI vs already-CI
    // หลายวัน: นับ "แล้ว/ยัง" และเขียน เฉพาะ "วันของวันนี้" · วันเดียว: ใช้ checked_in เดิม
    const targetDay = ciIsMultiDay() ? ciTargetDay() : null;
    const newlyCI = [];
    const alreadyCI = [];
    for (const a of selected) {
      const already = targetDay ? ciDayDone(a, targetDay) : a.checked_in;
      if (already) {
        alreadyCI.push(a);
        continue;
      }
      let body;
      if (targetDay) {
        const map = { ...(a.checkin_by_day || {}) };
        map[targetDay] = new Date().toISOString();
        const roll = ciRollup(map);
        body = { checkin_by_day: map, checked_in: roll.checked_in, check_in_at: roll.check_in_at };
      } else {
        body = { checked_in: true, check_in_at: new Date().toISOString() };
      }
      const res = await sbFetch(
        "event_attendees",
        `?attendee_id=eq.${a.attendee_id}`,
        {
          method: "PATCH",
          body,
        },
      );
      const updated = res?.[0] || a;
      newlyCI.push(updated);
      pushRecent(updated);
      notifyTagsOnCheckin(updated).catch((e) =>
        console.warn("notifyTagsOnCheckin:", e?.message || e),
      );
    }

    // Display: inline result + popup (single card if 1, side-by-side if multi)
    if (newlyCI.length === 0) {
      // ทุกคนเช็คอินไปแล้ว
      if (alreadyCI.length === 1) {
        setResultFromAttendee("warn", "⚠️ เช็คอินไปแล้ว", alreadyCI[0]);
      } else {
        setResult(
          "warn",
          `⚠️ เช็คอินไปแล้วทั้งหมด ${alreadyCI.length} คน`,
          alreadyCI.map((a) => a.name).join(" / "),
        );
      }
      return;
    }

    if (newlyCI.length === 1 && alreadyCI.length === 0) {
      setResultFromAttendee("success", "✅ Check-in สำเร็จ", newlyCI[0]);
    } else {
      const all = [...newlyCI, ...alreadyCI];
      setResult(
        "success",
        `✅ Check-in สำเร็จ ${newlyCI.length}/${all.length} คน`,
        all.map((a) => a.name).join(" / "),
      );
    }
    // Popup: ใหม่ + เก่า (เก่าจะมี chip เตือน)
    const popupList = [
      ...newlyCI.map((a) => ({ ...a, _already: false })),
      ...alreadyCI.map((a) => ({ ...a, _already: true })),
    ];
    showSuccessPopupMulti(popupList);
  } catch (e) {
    setResult("error", "❌ Error", e.message);
  }
}

// ── PERSON PICKER ─────────────────────────────────────────
// แสดง popup เลือกคนเมื่อ member_code มีทั้ง primary + co_applicant
// คืน Promise<attendee[]>: [primary] | [coapp] | [primary, coapp] | null
function showCheckinPersonPicker(rows) {
  return new Promise((resolve) => {
    const ov = document.getElementById("ppOverlay");
    if (!ov) { resolve(null); return; }

    // แยก primary / co_applicant
    const primary = rows.find((r) => r.person_role === "primary") || rows.find((r) => r.person_role !== "co_applicant");
    const coapp = rows.find((r) => r.person_role === "co_applicant");
    const pName = primary?.name || "—";
    const cName = coapp?.name || "—";
    const _td = ciIsMultiDay() ? ciTargetDay() : null;
    const pDone = _td ? ciDayDone(primary, _td) : !!primary?.checked_in;
    const cDone = _td ? ciDayDone(coapp, _td) : !!coapp?.checked_in;
    const bothDisabled = pDone && cDone;

    ov.innerHTML = `
      <div class="pp-card" role="document">
        <div class="pp-head">
          <div class="pp-title" id="ppTitle">เลือกผู้ที่จะ Check-in</div>
          <div class="pp-sub">รหัสนี้มี 2 รายชื่อ — เลือกคนที่จะเช็คอิน</div>
        </div>
        <div class="pp-body">
          ${primary ? `
          <button class="pp-opt" data-pick="primary" ${pDone ? "disabled" : ""}>
            <div class="pp-icon primary">👤</div>
            <div class="pp-info">
              <div class="pp-name">${escapeHtml(pName)}</div>
              <div class="pp-meta">
                <span class="pp-chip role-primary">👤 ผู้สมัคร</span>
                ${pDone ? '<span class="pp-chip done">✅ เช็คอินแล้ว</span>' : ""}
              </div>
            </div>
            <div class="pp-arrow">›</div>
          </button>` : ""}
          ${coapp ? `
          <button class="pp-opt" data-pick="co_applicant" ${cDone ? "disabled" : ""}>
            <div class="pp-icon coapp">👥</div>
            <div class="pp-info">
              <div class="pp-name">${escapeHtml(cName)}</div>
              <div class="pp-meta">
                <span class="pp-chip role-coapp">👥 ผู้สมัครร่วม</span>
                ${cDone ? '<span class="pp-chip done">✅ เช็คอินแล้ว</span>' : ""}
              </div>
            </div>
            <div class="pp-arrow">›</div>
          </button>` : ""}
          ${primary && coapp ? `
          <button class="pp-opt" data-pick="both" ${bothDisabled ? "disabled" : ""}>
            <div class="pp-icon both">👫</div>
            <div class="pp-info">
              <div class="pp-name">เช็คอินทั้ง 2 รายชื่อ</div>
              <div class="pp-meta">
                <span class="pp-chip role-primary">2 คน</span>
                ${bothDisabled ? '<span class="pp-chip warn">เช็คอินครบแล้ว</span>' : ""}
              </div>
            </div>
            <div class="pp-arrow">›</div>
          </button>` : ""}
        </div>
        <div class="pp-foot">
          <button type="button" class="pp-cancel" data-pick="cancel">ยกเลิก</button>
        </div>
      </div>`;
    ov.classList.add("open");

    const observer = new MutationObserver(() => {
      if (!ov.classList.contains("open")) close(null);
    });
    observer.observe(ov, { attributes: true, attributeFilter: ["class"] });

    const close = (result) => {
      observer.disconnect();
      ov.classList.remove("open");
      ov.removeEventListener("click", onClick);
      resolve(result);
    };
    const onClick = (e) => {
      const btn = e.target.closest("[data-pick]");
      if (btn) {
        if (btn.disabled) return;
        const v = btn.dataset.pick;
        if (v === "cancel") return close(null);
        if (v === "both") return close([primary, coapp].filter(Boolean));
        if (v === "primary") return close(primary ? [primary] : null);
        if (v === "co_applicant") return close(coapp ? [coapp] : null);
      }
      if (e.target === ov) close(null);
    };
    ov.addEventListener("click", onClick);
  });
}

// ── LINE TAG NOTIFICATION ─────────────────────────────────
// ส่ง flex รายการ tag ให้ attendee ตอน check-in สำเร็จ
// Guards: ต้องมี line_user_id + tags ไม่ว่าง + (toggle ON → tag_notified_at IS NULL)
async function notifyTagsOnCheckin(attendee) {
  if (!attendee?.line_user_id) return;
  const tags = Array.isArray(attendee.tags) ? attendee.tags.filter(Boolean) : [];
  if (!tags.length) return;
  // Block resend only when toggle ON (default). OFF = ส่งทุกครั้งที่ check-in
  if (isTagResendBlocked() && attendee.tag_notified_at) return;
  if (!window.LineAPI) return;
  try {
    const channel = await window.LineAPI.getChannelForEvent(eventInfo);
    if (!channel) return;
    const flex = buildCheckinTagFlex(attendee, eventInfo, tags);
    await window.LineAPI.push({
      channel,
      to: attendee.line_user_id,
      message: flex,
    });
    // Mark notified — กันส่งซ้ำตอน undo+re-checkin
    await sbFetch(
      "event_attendees",
      `?attendee_id=eq.${attendee.attendee_id}`,
      {
        method: "PATCH",
        body: { tag_notified_at: new Date().toISOString() },
      },
    );
  } catch (e) {
    console.warn("LINE tag flex push failed:", e?.message || e);
  }
}

function buildCheckinTagFlex(attendee, event, tags) {
  const eventName = event?.event_name || "งานกิจกรรม";
  const eventDate = event?.event_date ? formatThaiDate(event.event_date) : "";
  const name = attendee.name || attendee.member_code || "";
  const ticketNo = attendee.ticket_no || `ID-${attendee.attendee_id}`;

  // Each tag → box with name + (optional) detail from event_tag_categories
  const tagBoxes = tags.map((t) => {
    const cat = tagCategoriesByName[t];
    const detail = (cat?.detail || "").trim();
    const inner = [
      {
        type: "text",
        text: `🏷️  ${t}`,
        size: "sm",
        color: "#92400e",
        weight: "bold",
        wrap: true,
      },
    ];
    if (detail) {
      inner.push({
        type: "text",
        text: detail,
        size: "xs",
        color: "#78350f",
        wrap: true,
        margin: "sm",
      });
    }
    return {
      type: "box",
      layout: "vertical",
      paddingAll: "sm",
      cornerRadius: "md",
      backgroundColor: "#fef3c7",
      margin: "sm",
      contents: inner,
    };
  });

  const bubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      backgroundColor: "#10b981",
      contents: [
        {
          type: "text",
          text: "🎉 Check-in สำเร็จ",
          weight: "bold",
          size: "lg",
          color: "#ffffff",
        },
        {
          type: "text",
          text: eventName,
          size: "sm",
          color: "#d1fae5",
          margin: "xs",
          wrap: true,
        },
        ...(eventDate
          ? [
              {
                type: "text",
                text: `📅 ${eventDate}`,
                size: "xs",
                color: "#d1fae5",
                margin: "xs",
              },
            ]
          : []),
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents: [
        {
          type: "box",
          layout: "baseline",
          contents: [
            { type: "text", text: "👤", size: "sm", flex: 0 },
            {
              type: "text",
              text: ` ${name}`,
              size: "sm",
              color: "#0f172a",
              weight: "bold",
              margin: "sm",
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          contents: [
            { type: "text", text: "🎫", size: "sm", flex: 0 },
            {
              type: "text",
              text: ` ${ticketNo}`,
              size: "sm",
              color: "#1e40af",
              weight: "bold",
              margin: "sm",
            },
          ],
        },
        { type: "separator", margin: "md" },
        {
          type: "text",
          text: "📋 รายการของคุณ",
          weight: "bold",
          size: "sm",
          color: "#0f172a",
          margin: "md",
        },
        ...tagBoxes,
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "md",
      contents: [
        {
          type: "text",
          text: "📱 แสดงข้อความนี้ที่จุดรับเพื่อยืนยัน",
          size: "xs",
          color: "#6B7280",
          align: "center",
          wrap: true,
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: `🎉 Check-in สำเร็จ — ${eventName}`,
    contents: bubble,
  };
}

function formatThaiDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// คืน array ของ matches (อาจเป็น 0, 1, หรือ 2 rows) — caller ตัดสินใจเอง
// 2 rows เกิดเมื่อ member_code เดียวกันลง primary + co_applicant ใน event เดียวกัน
//
// QR payload formats ที่รองรับ:
//   ticket_no       (e.g. A4S-EVT-0001)         → ตรงกับ row เดียว
//   A4S-ATT-{N}     (legacy attendee_id link)    → ตรงกับ row เดียว
//   MC-{member_code} (shared QR ของคู่)          → ตรงกับ 1-2 rows ใน event นี้
async function lookupAttendee(code) {
  // Shared-pair QR: "MC-{member_code}" → ค้น member_code ใน event นี้ตรงๆ
  const mc = code.match(/^MC-(.+)$/);
  if (mc) {
    const memberCode = mc[1];
    const rows = await sbFetch(
      "event_attendees",
      `?member_code=eq.${encodeURIComponent(memberCode)}&event_id=eq.${eventId}&select=*&limit=5`,
    ).catch(() => []);
    return rows || [];
  }

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
      `?member_code=eq.${encodeURIComponent(code)}&event_id=eq.${eventId}&select=*&limit=5`,
    ).catch(() => []),
  ]);

  // De-dup โดยใช้ attendee_id (member_code ใน event นี้อาจซ้ำกับ global ที่ match ticket_no)
  const seen = new Set();
  const all = [];
  for (const r of [...(globalRows || []), ...(memberRows || [])]) {
    if (!r || seen.has(r.attendee_id)) continue;
    seen.add(r.attendee_id);
    all.push(r);
  }
  return all;
}

// Build award banner HTML — shows each tag chip + its detail lines
// (detail comes from event_tag_categories, multiline → one row per line)
//   headerOnly = true → just the inner content (banner wrapper provided by caller, e.g. #ciSuccessAward)
//   headerOnly = false → wrapped in .ci-award-banner
function buildAwardBannerHTML(tags, opts = {}) {
  if (!tags || !tags.length) return "";
  const items = tags
    .map((t) => {
      const cat = tagCategoriesByName[t] || {};
      const detail = String(cat.detail || "").trim();
      const lines = detail
        ? detail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        : [];
      const detailHTML = lines.length
        ? `<div class="ci-award-detail">${lines.map((l) => `<div>• ${escapeHtml(l)}</div>`).join("")}</div>`
        : "";
      return `<div class="ci-award-item">
        <span class="ci-award-tag">${escapeHtml(t)}</span>
        ${detailHTML}
      </div>`;
    })
    .join("");
  const inner = `🏆 รางวัล / กลุ่มพิเศษ<div class="ci-award-list">${items}</div>`;
  return opts.headerOnly ? inner : `<div class="ci-award-banner">${inner}</div>`;
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

  const awardBanner = buildAwardBannerHTML(a.tags || []);

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

function _buildSuccessCardHTML(a) {
  const already = !!a._already;
  const cardClass = already ? "ci-success-card is-already" : "ci-success-card";
  const title = already ? "⚠️ เช็คอินไปแล้ว" : "Check-in สำเร็จ";
  const checkIcon = already ? "!" : "✓";
  const name = (a.member_code ? `[${escapeHtml(a.member_code)}] ` : "") + escapeHtml(a.name || "");
  const ticket = a.ticket_no ? `🎫 ${escapeHtml(a.ticket_no)}` : "";

  const chips = [
    a.payment_status === "PAID"
      ? '<span class="ci-status-chip ok">💳 ชำระแล้ว</span>'
      : a.payment_status === "COMPLIMENTARY"
      ? '<span class="ci-status-chip ok">🎫 ฟรี</span>'
      : '<span class="ci-status-chip warn">⏳ ยังไม่ชำระ</span>',
    a.position_level
      ? `<span class="ci-status-chip" style="background:#fef3c7;color:#92400e">⭐ ${escapeHtml(a.position_level)}</span>`
      : "",
    a.person_role === "co_applicant"
      ? '<span class="ci-status-chip" style="background:#f3e8ff;color:#9333ea">👥 ผู้สมัครร่วม</span>'
      : "",
  ].filter(Boolean).join("");

  const tags = Array.isArray(a.tags) ? a.tags.filter(Boolean) : [];
  const awardHtml = tags.length
    ? `<div class="ci-success-award" style="display:block">${buildAwardBannerHTML(tags, { headerOnly: true })}</div>`
    : "";

  return `
    <div class="${cardClass}" onclick="event.stopPropagation()">
      <div class="ci-success-check">${checkIcon}</div>
      <div class="ci-success-title">${title}</div>
      <div class="ci-success-name">${name}</div>
      <div class="ci-success-meta">${ticket}</div>
      <div class="ci-success-chips">${chips}</div>
      ${awardHtml}
      <div class="ci-success-progress"></div>
    </div>`;
}

function showSuccessPopup(a) {
  showSuccessPopupMulti([a]);
}

function showSuccessPopupMulti(list) {
  const modal = document.getElementById("ciSuccessModal");
  if (!modal || !list?.length) return;

  const cardsHtml = list.map(_buildSuccessCardHTML).join("");
  modal.innerHTML = list.length > 1
    ? `<div class="ci-success-multi">${cardsHtml}</div>`
    : cardsHtml;

  modal.classList.add("open");
  try {
    if (navigator.vibrate) {
      navigator.vibrate(list.length > 1 ? [80, 60, 80] : 80);
    }
  } catch {}
}

window.ciCloseSuccess = function () {
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
