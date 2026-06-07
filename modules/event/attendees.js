/* ============================================================
   attendees.js — Controller for Attendees page
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
  // Exclude "วันหยุดบริษัท" category events
  const [events, cats] = await Promise.all([
    sbFetch("events", "?select=event_id,event_name,event_code,max_attendees,event_category_id,price,event_date,start_time,end_time&order=event_date.desc"),
    sbFetch("event_categories", "?select=event_category_id,category_name"),
  ]);
  const holidayIds = (cats || []).filter(c => c.category_name === "วันหยุดบริษัท").map(c => c.event_category_id);
  return (events || []).filter(e => !holidayIds.includes(e.event_category_id));
}
async function fetchAttendees(eventId) {
  const rows = await sbFetch(
    "event_attendees",
    `?event_id=eq.${eventId}&order=created_at.asc`,
  ) || [];
  // Enrich with CURRENT primary line_user_id from members (latest LIFF login across ALL events)
  // This lets admin-added attendees (never went through LIFF) still receive LINE if their member linked on another event
  await _enrichWithMemberLineId(rows);
  return rows;
}

async function _enrichWithMemberLineId(attendees) {
  if (!attendees.length) return;
  const codes = [...new Set(attendees.map(a => a.member_code).filter(Boolean))];
  if (!codes.length) return;
  try {
    const inList = codes.map(c => encodeURIComponent(c)).join(",");
    const cols = "member_code,line_user_id,line_display_name,line_picture_url,line_linked_at,position_level,position,package";
    // Query both tables in parallel — test_members อาจยังไม่มี (degrade ถ้า error)
    const [mlmRows, testRows] = await Promise.all([
      sbFetch("members", `?member_code=in.(${inList})&select=${cols}`),
      sbFetch("test_members", `?member_code=in.(${inList})&select=${cols}`).catch(() => []),
    ]);
    const byCode = {};
    (mlmRows || []).forEach(r => { byCode[r.member_code] = r; });
    (testRows || []).forEach(r => { if (!byCode[r.member_code]) byCode[r.member_code] = r; });
    if (!Object.keys(byCode).length) return;
    attendees.forEach(a => {
      const m = byCode[a.member_code];
      if (!m) return;
      // Prefer members/test_members.line_user_id (latest); fallback to event_attendees value for legacy data
      if (m.line_user_id) {
        a.line_user_id = m.line_user_id;
        a.line_display_name = m.line_display_name || a.line_display_name;
        a.line_picture_url = m.line_picture_url || a.line_picture_url;
      }
      // Backfill position_level snapshot for legacy rows (fallback chain matches _autofillMemberInfo)
      if (!a.position_level || !String(a.position_level).trim()) {
        const pos = (m.position_level && String(m.position_level).trim())
          || (m.position && String(m.position).trim())
          || (m.package && String(m.package).trim())
          || "";
        if (pos) a.position_level = pos;
      }
    });
  } catch (e) {
    console.warn("enrich line_user_id:", e.message);
  }
}
async function fetchTiers(eventId) {
  try {
    const rows = await sbFetch(
      "event_ticket_tiers",
      `?event_id=eq.${eventId}&select=*&order=sort_order.asc,valid_from.asc.nullsfirst`,
    );
    return rows || [];
  } catch (e) {
    // Table may not exist yet — degrade gracefully (no tiers = use events.price)
    console.warn("fetchTiers:", e.message);
    return [];
  }
}
async function fetchDefaultGrace() {
  try {
    const rows = await sbFetch(
      "app_settings",
      "?key=eq.default_grace_days&select=value",
    );
    const v = parseInt(rows?.[0]?.value);
    return isNaN(v) ? 3 : v;
  } catch {
    return 3;
  }
}
async function uploadSlip(eventId, file) {
  const { url, key } = getSB();
  const path = `slips/${eventId}_${Date.now()}`;
  const publicUrl = await window.ImageCompressor.uploadViaRest(
    url, key, "event-files", path, file,
  );
  if (!publicUrl) throw new Error("Slip upload failed");
  return publicUrl;
}

/* Deterministic public URL for an attendee QR (no Date.now → re-upload OVERWRITES
   instead of creating orphans; cuts Storage Cached Egress dramatically). */
function _qrPublicUrl(url, eventId, attendeeId) {
  return `${url}/storage/v1/object/public/event-files/qr_${eventId}_${attendeeId}.png`;
}
async function uploadQrBlob(eventId, attendeeId, blob) {
  const { url, key } = getSB();
  const path = `qr_${eventId}_${attendeeId}.png`;
  const uploadUrl = `${url}/storage/v1/object/event-files/${path}`;
  console.log(`[QR upload] → ${path} (${Math.round(blob.size / 1024)}KB)`);
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: blob,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[QR upload FAIL ${res.status}]`, errText);
    throw new Error(`QR upload ${res.status}: ${errText.slice(0, 120)}`);
  }
  return _qrPublicUrl(url, eventId, attendeeId);
}

/* Render locked Neon Cyber styled QR → PNG Blob */
async function _renderStyledQrBlob(payload) {
  if (!window.QRDesigner) throw new Error("QRDesigner ยังไม่โหลด — refresh หน้า");
  const hidden = document.createElement("div");
  hidden.style.cssText = "position:absolute;left:-99999px;top:-99999px;pointer-events:none;";
  document.body.appendChild(hidden);
  try {
    const result = await window.QRDesigner.renderQR(hidden, payload);
    let blob = null;
    if (result?.instance?.getRawData) {
      try { blob = await result.instance.getRawData("png"); }
      catch (e) { console.warn("[QR getRawData fail]", e.message); }
    }
    if (!blob || blob.size < 500) {
      await new Promise((r) => setTimeout(r, 400));
      const canvas = hidden.querySelector("canvas");
      if (canvas) {
        blob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error("toBlob null")),
            "image/png",
          );
        });
      }
    }
    if (!blob || blob.size < 500) {
      throw new Error(`blob เล็กผิดปกติ (${blob?.size ?? 0} bytes)`);
    }
    console.log(`[QR render] payload=${payload} blob=${Math.round(blob.size/1024)}KB`);
    return blob;
  } finally {
    try { document.body.removeChild(hidden); } catch {}
  }
}

/* ── Pair detection / shared QR ────────────────────────────────────
   ถ้า attendee มีคู่ใน event เดียวกัน (member_code เดียวกัน, role ต่างกัน) →
   QR payload = "MC-{member_code}" → สแกนแล้ว check-in.js เปิด picker เลือกคน
   ไม่งั้นใช้ ticket_no ปกติ */
function _hasPairedSibling(attendee) {
  if (!attendee?.member_code || !attendee?.event_id) return false;
  return (allAttendees || []).some((a) =>
    a.attendee_id !== attendee.attendee_id &&
    a.event_id === attendee.event_id &&
    a.member_code === attendee.member_code
  );
}
function _getQrPayload(attendee) {
  if (attendee?.member_code && _hasPairedSibling(attendee)) {
    return `MC-${attendee.member_code}`;
  }
  return attendee?.ticket_no || `A4S-ATT-${attendee?.attendee_id ?? ""}`;
}
function _qrFileName(eventId, attendee, payload) {
  // Pair shares ONE file (qr_{eid}_pair_{code}.png) — render+upload ครั้งเดียวพอ
  if (payload?.startsWith("MC-")) {
    return `qr_${eventId}_pair_${attendee.member_code}.png`;
  }
  return `qr_${eventId}_${attendee.attendee_id}.png`;
}

/* Get styled QR image URL — checks Storage first (cross-session cache via
   deterministic filename) so we don't re-render+re-upload on every page load. */
const _qrUrlCache = new Map();  // key: `${event_id}:${payload}`
async function getStyledQrUrl(event, attendee) {
  const payload = _getQrPayload(attendee);
  const fileName = _qrFileName(event.event_id, attendee, payload);
  const key = `${event?.event_id}:${payload}`;
  if (_qrUrlCache.has(key)) return _qrUrlCache.get(key);
  const { url, key: sbKey } = getSB();
  const publicUrl = `${url}/storage/v1/object/public/event-files/${fileName}`;
  // HEAD-check existing file — small request vs full re-render+upload
  try {
    const head = await fetch(publicUrl, { method: "HEAD" });
    if (head.ok) {
      _qrUrlCache.set(key, publicUrl);
      return publicUrl;
    }
  } catch {}
  // Not in Storage → render + upload (first time only)
  const blob = await _renderStyledQrBlob(payload);
  const uploadUrl = `${url}/storage/v1/object/event-files/${fileName}`;
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "image/png", "x-upsert": "true" },
    body: blob,
  });
  if (!upRes.ok) {
    const errText = await upRes.text().catch(() => "");
    throw new Error(`QR upload ${upRes.status}: ${errText.slice(0, 120)}`);
  }
  _qrUrlCache.set(key, publicUrl);
  return publicUrl;
}
// Generate short event code from event_name (initials) — fallback to event_code tail / event_id
function getEventShortCode(ev) {
  if (!ev) return "";
  const name = (ev.event_name || "").trim();
  if (name) {
    const initials = name
      .split(/\s+/)
      .map((w) => {
        const clean = w.replace(/[^A-Za-z0-9\u0E00-\u0E7F]/g, "");
        return clean ? clean.charAt(0) : "";
      })
      .filter(Boolean)
      .join("")
      .toUpperCase();
    if (initials) return initials;
  }
  const parts = (ev.event_code || "").split("-");
  const tail = parts[parts.length - 1];
  return tail || String(ev.event_id || "");
}

async function generateTicketNo(eventId) {
  const { url, key } = getSB();
  const ev = currentEvent || allEvents.find((e) => e.event_id === eventId);
  const shortCode = getEventShortCode(ev) || String(eventId);
  const newPrefix = `A4S-${shortCode}-`;
  // Query ALL tickets with this prefix across ALL events (unique constraint is global,
  // so short-codes colliding between two events would produce duplicate ticket_no).
  const likeParam = encodeURIComponent(newPrefix + "*");
  const res = await fetch(
    `${url}/rest/v1/event_attendees?ticket_no=like.${likeParam}&select=ticket_no`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const raw  = res.ok ? await res.json().catch(() => []) : [];
  const rows = Array.isArray(raw) ? raw : [];
  let maxSeq = 0;
  rows.forEach((r) => {
    const parts = (r.ticket_no || "").split("-");
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  });
  return `${newPrefix}${String(maxSeq + 1).padStart(4, "0")}`;
}
async function createAttendee(data) {
  const res = await sbFetch("event_attendees", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}
async function updateAttendee(id, data) {
  return sbFetch("event_attendees", `?attendee_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}
async function removeAttendee(id) {
  return sbFetch("event_attendees", `?attendee_id=eq.${id}`, {
    method: "DELETE",
  });
}

// ── TAG CATEGORIES (event-scoped) ─────────────────────────
async function fetchTagCategories(eventId) {
  try {
    const rows = await sbFetch(
      "event_tag_categories",
      `?event_id=eq.${eventId}&select=*&order=sort_order.asc,tag_category_id.asc`,
    );
    return rows || [];
  } catch (e) {
    // Table may not exist yet (migration 043 not applied) — degrade gracefully
    console.warn("fetchTagCategories:", e.message);
    return [];
  }
}
async function createTagCategoryDB(data) {
  const res = await sbFetch("event_tag_categories", "", { method: "POST", body: data });
  return res?.[0];
}
async function updateTagCategoryDB(id, data) {
  return sbFetch("event_tag_categories", `?tag_category_id=eq.${id}`, { method: "PATCH", body: data });
}
async function deleteTagCategoryDB(id) {
  return sbFetch("event_tag_categories", `?tag_category_id=eq.${id}`, { method: "DELETE" });
}

// ── STATE ─────────────────────────────────────────────────
let allEvents = [];
let currentEventId = null;
let currentEvent = null;
let allAttendees = [];
let currentTiers = [];       // Tiers สำหรับ event ปัจจุบัน
let currentTiersById = {};   // lookup tier_id → tier
let currentTagCategories = []; // Tag categories สำหรับ event ปัจจุบัน
let defaultGraceDays = 3;    // จาก app_settings.default_grace_days
let _paymentModalAtt = null; // attendee object while modal open
let _qrModalAtt = null;      // attendee object while QR modal open
let selectedAttendeeIds = new Set(); // bulk-delete selection

// Tag-category modal local state
let _tagCatNewColor = "yellow";       // ปัจจุบันที่เลือกใน color picker
let _tagCatDeleting = null;           // category object ที่กำลังลบ
const TAG_COLOR_PRESETS = ["yellow", "blue", "green", "pink", "purple", "red", "gray"];

// Inline new rows (not yet saved)
let newRows = [];
let activeSearchRowId = null; // ID of new-row currently showing member suggest
let _searchKeyword = "";       // live keyword จาก new-row input (ใช้ filter ด้วย)
let _autoCheckin = false;      // โหมดหน้างาน: save แล้ว check-in ทันที

// ── DEADLINE / EXPIRED HELPERS ────────────────────────────
function getEventGraceDays() {
  const g = currentEvent?.grace_days;
  if (g == null || g === "" || isNaN(g)) return defaultGraceDays;
  return parseInt(g);
}
function computeDeadlineISO(graceDays) {
  const d = new Date();
  d.setDate(d.getDate() + (graceDays || 0));
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function isAttendeeExpired(a) {
  if (a.payment_status !== "UNPAID") return false;
  if (!a.payment_deadline) return false;
  const today = new Date().toISOString().slice(0, 10);
  return a.payment_deadline < today;
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.ceil((new Date(dateStr) - new Date(today)) / 86400000);
  return diff;
}
function formatDMYShort(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function formatDMY(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
// Check-in timestamp = event date + current time (so retroactive check-ins record as event day)
function buildCheckinTimestamp() {
  const now = new Date();
  const eventDate = currentEvent?.event_date;
  if (!eventDate) return now.toISOString();
  const [y, m, d] = eventDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  return dt.toISOString();
}
function buildEventHeroSubtitle(ev) {
  if (!ev) return "ลงทะเบียน · Check-in · ติดตามผู้เข้าร่วม";
  const parts = [];
  if (ev.event_date) parts.push(`📅 ${formatDMY(ev.event_date)}`);
  if (ev.start_time && ev.end_time) {
    parts.push(`🕐 ${String(ev.start_time).slice(0, 5)} — ${String(ev.end_time).slice(0, 5)} น.`);
  }
  parts.push("ลงทะเบียน · Check-in");
  return parts.join(" · ");
}

// หา tier ที่ active ณ วันนี้ — เลือกตาม sort_order น้อยสุดถ้ามี overlap
function getActiveTier() {
  if (!currentTiers?.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const match = currentTiers.filter((t) => {
    if (t.valid_from && today < t.valid_from) return false;
    if (t.valid_to && today > t.valid_to) return false;
    return true;
  });
  match.sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.tier_id - b.tier_id,
  );
  return match[0] || null;
}

// ราคาปัจจุบัน — tier ถ้ามี, fallback events.price
function getCurrentPrice() {
  const t = getActiveTier();
  if (t) return parseFloat(t.price || 0);
  return parseFloat(currentEvent?.price || 0);
}

function makeEmptyNewRow() {
  const evPrice = getCurrentPrice();
  return {
    id: "nr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    name: "",
    phone: "",
    memberCode: "",
    personRole: "",   // 'primary' | 'co_applicant' | 'guest' (set ตอนเลือกจาก dropdown)
    positionLevel: "",
    paymentStatus: evPrice > 0 ? "UNPAID" : "COMPLIMENTARY",
    prereq: null, // { ok, msg }
    saving: false,
  };
}
function ensureTrailingEmptyRow() {
  if (!newRows.length) { newRows = [makeEmptyNewRow()]; return; }
  const last = newRows[newRows.length - 1];
  if (last.name || last.phone || last.memberCode) {
    newRows.push(makeEmptyNewRow());
  }
}

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id") || params.get("event");

    // ไม่มี event_id ใน URL → no-event state เท่านั้น (เหมือน line-promote)
    if (!urlEventId) {
      showSections(false);
      showLoading(false);
      return;
    }

    defaultGraceDays = await fetchDefaultGrace();
    allEvents = (await fetchEvents()) || [];

    await loadAttendees(parseInt(urlEventId));
    const ev = allEvents.find(e => e.event_id === parseInt(urlEventId));
    if (ev) {
      const title = document.getElementById("heroTitle");
      if (title) {
        title.innerHTML = `👥 ${ev.event_name}`;
        title.style.fontSize = "24px";
      }
      const sub = document.getElementById("heroSubtitle");
      if (sub) sub.textContent = buildEventHeroSubtitle(ev);
    } else {
      showToast("ไม่พบ event ที่ระบุ", "error");
      showSections(false);
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  document
    .getElementById("filterCheckin")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterPayment")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterTag")
    ?.addEventListener("change", filterTable);

  // File input change → preview slip
  document
    .getElementById("paySlipFile")
    ?.addEventListener("change", _onSlipFileChange);
}

// populateEventSelect / onEventChange ถูกเอาออก —
// หน้านี้รับ event_id จาก URL parameter อย่างเดียว (เปิดผ่านปุ่ม 👥 ของ events-list)

async function loadAttendees(eventId) {
  currentEventId = eventId;
  currentEvent = allEvents.find((e) => e.event_id === eventId);
  const sub = document.getElementById("heroSubtitle");
  if (sub) sub.textContent = buildEventHeroSubtitle(currentEvent);
  showLoading(true);
  try {
    const [atts, tiers, tagCats] = await Promise.all([
      fetchAttendees(eventId),
      fetchTiers(eventId),
      fetchTagCategories(eventId),
      fetchEventFieldConfig(eventId).catch(() => {}),  // pre-warm config cache → spreadsheet header ถูกตั้งแต่ first render
    ]);
    allAttendees = atts || [];
    currentTiers = tiers || [];
    currentTiersById = {};
    currentTiers.forEach((t) => { currentTiersById[t.tier_id] = t; });
    currentTagCategories = tagCats || [];
    // Reset inline new-rows (ราคา default ขึ้นกับ active tier)
    newRows = [makeEmptyNewRow()];
    showSections(true);
    renderTierBanner();
    populateTagFilter();
    _loadAutoCheckinState();
    _applyPaymentVisibility();   // hide payment UI ถ้า event ไม่มีราคา
    updateStats();
    filterTable();
    // จับสายงาน (ไล่ MLM) แบบ async — เสร็จแล้ว re-render ให้สี/เรียงระดับ
    computeUplineMatches().then(() => {
      if (currentEventId === eventId) { updateStats(); filterTable(); }
    }).catch(e => console.warn("computeUplineMatches:", e.message));
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function showSections(show) {
  ["attStatsSection", "attStatusCards", "attToolbar", "attTableSection"].forEach((id) => {
    document.getElementById(id).style.display = show ? "" : "none";
  });
  document.getElementById("noEventState").style.display = show
    ? "none"
    : "block";
  document.getElementById("eventActionBtns").style.display = show
    ? "flex"
    : "none";
}

// ── TIER INFO BANNER ──────────────────────────────────────
function renderTierBanner() {
  const el = document.getElementById("tierInfoBanner");
  if (!el || !currentEvent) {
    if (el) { el.style.display = "none"; el.innerHTML = ""; }
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const fmt = (d) => (d ? d.split("-").reverse().join("/") : "");
  const daysTo = (d) => {
    if (!d) return null;
    return Math.ceil((new Date(d) - new Date(today)) / 86400000);
  };

  const active = getActiveTier();
  const effectiveGrace = getEventGraceDays();
  const soldCount = allAttendees.length;
  const maxCap = currentEvent.max_attendees || 0;

  const tierStatus = (t) => {
    if (t.valid_from && today < t.valid_from) return "upcoming";
    if (t.valid_to && today > t.valid_to) return "ended";
    return "active";
  };
  const statusBadge = {
    active: '<span class="tier-pill tier-pill-active">● ACTIVE</span>',
    upcoming: '<span class="tier-pill tier-pill-upcoming">⏭ UPCOMING</span>',
    ended: '<span class="tier-pill tier-pill-ended">✕ ENDED</span>',
  };

  const priceHdr = active
    ? `<b>${escapeHtml(active.tier_name)}</b> — <b style="color:#059669">฿${formatNum(active.price)}</b>`
    : currentTiers.length
    ? `<span style="color:#92400e">ไม่อยู่ในช่วง Tier — ใช้ราคามาตรฐาน <b>฿${formatNum(currentEvent.price || 0)}</b></span>`
    : `<b style="color:#059669">฿${formatNum(currentEvent.price || 0)}</b> <span style="color:var(--text3);font-size:11.5px">(ไม่มี Tier)</span>`;

  // Build cells ตามที่มีข้อมูลจริงเท่านั้น
  const hasPrice = (currentEvent.price || 0) > 0 || active;
  const hasCustomGrace = currentEvent.grace_days != null;
  const hasSeatLimit = maxCap > 0;

  const cells = [];
  if (hasPrice) {
    cells.push(`<div class="info-cell">
      <div class="info-label">💰 ราคาปัจจุบัน</div>
      <div class="info-value">${priceHdr}</div>
      ${active && active.valid_to ? `<div class="info-sub">สิ้นสุด ${fmt(active.valid_to)} · เหลืออีก ${daysTo(active.valid_to)} วัน</div>` : ""}
    </div>`);
  }
  if (hasCustomGrace) {
    cells.push(`<div class="info-cell">
      <div class="info-label">⏳ Grace Period</div>
      <div class="info-value">${effectiveGrace} วัน</div>
    </div>`);
  }
  if (hasSeatLimit) {
    cells.push(`<div class="info-cell">
      <div class="info-label">🎫 ที่นั่ง</div>
      <div class="info-value">${soldCount} / ${maxCap}</div>
      <div class="info-sub">เหลือ ${Math.max(0, maxCap - soldCount)} ที่</div>
    </div>`);
  }

  // ถ้าไม่มีข้อมูลเลยและไม่มี tier → ไม่แสดง panel
  if (!cells.length && !currentTiers.length) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  let html = `<div class="info-panel">`;
  if (cells.length) {
    html += `<div class="info-panel-grid" style="grid-template-columns:repeat(${cells.length},1fr)${currentTiers.length ? ";border-bottom:1px solid var(--border,#e2e8f0);padding-bottom:12px" : ";border:none;padding:0"}">${cells.join("")}</div>`;
  }

  if (currentTiers.length) {
    html += `<div class="info-tier-list">
      <div class="info-tier-hdr">🎟️ ระดับราคาทั้งหมด (${currentTiers.length})</div>
      <div class="info-tier-rows">`;
    currentTiers.forEach((t) => {
      const s = tierStatus(t);
      const soldInTier = allAttendees.filter((a) => a.tier_id === t.tier_id).length;
      const seatInfo = t.seat_limit
        ? ` · <span style="color:${soldInTier >= t.seat_limit ? "#991b1b" : "var(--text3)"}">${soldInTier}/${t.seat_limit} ที่</span>`
        : soldInTier
        ? ` · <span style="color:var(--text3)">${soldInTier} คน</span>`
        : "";
      const dateRange =
        (t.valid_from ? fmt(t.valid_from) : "—") +
        " → " +
        (t.valid_to ? fmt(t.valid_to) : "—");
      html += `<div class="info-tier-row ${s === "active" ? "is-active" : ""}">
        <div class="info-tier-left">
          ${statusBadge[s]}
          <b>${escapeHtml(t.tier_name)}</b>
          <span class="info-tier-price">฿${formatNum(t.price)}</span>
        </div>
        <div class="info-tier-right">${dateRange}${seatInfo}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  html += `</div>`;
  el.innerHTML = html;
  el.style.display = "block";
}

// ── STATS ─────────────────────────────────────────────────
function updateStats() {
  const total = allAttendees.length;
  const checkedIn = allAttendees.filter((a) => a.checked_in).length;
  const paid = allAttendees.filter((a) => a.payment_status === "PAID").length;
  const revenue = allAttendees
    .filter((a) => a.payment_status === "PAID")
    .reduce((sum, a) => sum + parseFloat(a.paid_amount || 0), 0);

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statCheckedIn").textContent = checkedIn;
  document.getElementById("statNotCheckedIn").textContent = total - checkedIn;
  document.getElementById("statPaid").textContent = paid;
  document.getElementById("statRevenue").textContent = formatNum(revenue);

  // ── Status cards ──
  // สายงาน — แยกผู้ลงทะเบียน (ทั้งหมด) กับ ผู้เข้างาน (check-in)
  const uplineGroups = {};   // สาย → จำนวนผู้ลงทะเบียน
  const uplineCheckin = {};  // สาย → จำนวนผู้เข้างาน (check-in)
  let matchedUpline = 0;     // ผู้ลงทะเบียนที่จับสายได้
  let matchedCheckin = 0;    // ผู้เข้างานที่จับสายได้
  allAttendees.forEach((a) => {
    const m = _uplineMatchFor(a);
    if (m) {
      matchedUpline++;
      const k = m.nickname || m.name;
      uplineGroups[k] = (uplineGroups[k] || 0) + 1;
      if (a.checked_in) { matchedCheckin++; uplineCheckin[k] = (uplineCheckin[k] || 0) + 1; }
    }
  });
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  // card 1 — จำนวนผู้ลงทะเบียนตามสายงาน
  setTxt("scUplineReg", matchedUpline);
  setTxt("scUplineSub", `${Object.keys(uplineGroups).length} สาย`);
  // card 2 — จำนวนผู้เข้างานตามสายงาน
  setTxt("scAttendLine", matchedCheckin);
  setTxt("scAttendSub", `${Object.keys(uplineCheckin).length} สาย · มาจริง ${total ? Math.round((checkedIn / total) * 100) : 0}%`);
  // card 3 — เทียบ ลงทะเบียน vs เข้างาน ตามสายงาน
  const lineKeys = Object.keys(uplineGroups);
  const fullLines = lineKeys.filter((k) => (uplineCheckin[k] || 0) >= uplineGroups[k]).length;
  setTxt("scLineRate", `${matchedUpline ? Math.round((matchedCheckin / matchedUpline) * 100) : 0}%`);
  setTxt("scLineRateSub", `ลงทะเบียน ${matchedUpline} → เข้างาน ${matchedCheckin} คน · ${fullLines}/${lineKeys.length} สาย`);
  // การชำระเงิน
  const unpaid = allAttendees.filter((a) => a.payment_status !== "PAID" && a.payment_status !== "COMPLIMENTARY").length;
  setTxt("scPaid", paid);
  setTxt("scUnpaid", unpaid);
  setTxt("scPaySub", revenue ? `รายรับ ฿${formatNum(revenue)}` : "—");
}

// ── STAT REPORT POPUP ─────────────────────────────────────
// เปิดเมื่อกด stat card 5 อัน — แสดง summary + breakdown + รายชื่อตามมุมมอง
let _statReportContext = null; // { type, title, rows, summary, headers } — ใช้สำหรับ CSV/print

function _payMethodLabel(m) {
  return ({
    slip_kbank: "🏦 K+ (กสิกร โอน)",
    slip_ktb: "🏦 KTB (กรุงไทย โอน)",
    cash: "💵 เงินสด",
    credit_card: "💳 Credit Card",
  }[m] || m || "—");
}

function _attTierName(a) {
  return a.tier_id && currentTiersById[a.tier_id]
    ? currentTiersById[a.tier_id].tier_name
    : "";
}

function _payStatusBadge(a) {
  if (a.payment_status === "PAID") return "💳 ชำระแล้ว";
  if (a.payment_status === "COMPLIMENTARY") return "🎫 ฟรี / ยกเว้น";
  if (isAttendeeExpired(a)) return "⌛ เกิน grace";
  return "⏳ ยังไม่ชำระ";
}

function _renderBreakdownRows(map, total) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return `<div class="sr-empty" style="padding:14px">— ไม่มีข้อมูล —</div>`;
  }
  return entries
    .map(([label, count]) => {
      const pct = total ? Math.round((count / total) * 100) : 0;
      return `<div class="sr-bd-row">
        <div class="sr-bd-label">${escapeHtml(label)}</div>
        <div class="sr-bd-bar"><span style="width:${pct}%"></span></div>
        <div class="sr-bd-count"><span class="sr-num">${count}</span> <span class="sr-pct">(${pct}%)</span></div>
      </div>`;
    })
    .join("");
}

function _attendeeListRows(list, opts = {}) {
  const { showCheckinTime = false, showPaidInfo = false } = opts;
  if (!list.length) {
    return `<div class="sr-empty">— ไม่มีรายการ —</div>`;
  }
  const head = `<div class="sr-list-row is-head">
    <div class="sr-no">#</div>
    <div>ชื่อ / รหัส</div>
    <div>🎫 Ticket</div>
    <div>📱 เบอร์โทร</div>
    <div>${showCheckinTime ? "⏱ เช็คอิน" : showPaidInfo ? "💰 ชำระ" : "สถานะ"}</div>
  </div>`;
  const body = list
    .map((a, i) => {
      const tier = _attTierName(a);
      const right = showCheckinTime
        ? (a.checked_in_at ? formatDateTime(a.checked_in_at) : "—")
        : showPaidInfo
        ? `${_payMethodLabel(a.payment_method)} · ฿${formatNum(a.paid_amount || 0)}${a.paid_at ? `<br><span style="font-size:11px;color:var(--text3)">${formatDateTime(a.paid_at)}</span>` : ""}`
        : _payStatusBadge(a);
      return `<div class="sr-list-row">
        <div class="sr-no">${i + 1}</div>
        <div class="sr-name" title="${escapeHtml(a.name || "")}">
          ${escapeHtml(a.name || "—")}
          <small>${escapeHtml(a.member_code || "")}${tier ? ` · ${escapeHtml(tier)}` : ""}</small>
        </div>
        <div class="sr-meta sr-meta-hide-sm">${escapeHtml(a.ticket_no || "—")}</div>
        <div class="sr-meta sr-meta-hide-sm">${escapeHtml(a.phone || "—")}</div>
        <div class="sr-meta">${right}</div>
      </div>`;
    })
    .join("");
  return head + body;
}

function _buildStatReport(type) {
  const total = allAttendees.length;
  const checkedIn = allAttendees.filter((a) => a.checked_in);
  const pending = allAttendees.filter((a) => !a.checked_in);
  const paid = allAttendees.filter((a) => a.payment_status === "PAID");
  const evName = currentEvent?.event_name || "—";

  if (type === "total") {
    // Breakdown ตาม Tier + ตาม role + check-in/payment summary
    const byTier = {};
    const byRole = {};
    allAttendees.forEach((a) => {
      const t = _attTierName(a) || "— ไม่มี tier —";
      byTier[t] = (byTier[t] || 0) + 1;
      const r = a.role || "—";
      byRole[r] = (byRole[r] || 0) + 1;
    });
    const summary = [
      { label: "ลงทะเบียน", value: total },
      { label: "Check-in แล้ว", value: checkedIn.length, sub: total ? `${Math.round((checkedIn.length / total) * 100)}%` : "0%", accent: true },
      { label: "ยังไม่ Check-in", value: pending.length },
      { label: "ชำระแล้ว", value: paid.length, sub: total ? `${Math.round((paid.length / total) * 100)}%` : "0%" },
      { label: "ฟรี / ยกเว้น", value: allAttendees.filter((a) => a.payment_status === "COMPLIMENTARY").length },
      { label: "ยังไม่ชำระ", value: allAttendees.filter((a) => a.payment_status === "UNPAID").length },
    ];
    return {
      title: `👥 รายงานลงทะเบียน — ${evName}`,
      summary,
      sections: [
        { title: "🎟️ แยกตาม Tier", count: Object.keys(byTier).length, html: `<div class="sr-breakdown">${_renderBreakdownRows(byTier, total)}</div>` },
        { title: "⭐ แยกตามตำแหน่ง", count: Object.keys(byRole).length, html: `<div class="sr-breakdown">${_renderBreakdownRows(byRole, total)}</div>` },
      ],
      list: allAttendees,
      listMode: "default",
    };
  }

  if (type === "checkin") {
    const sorted = [...checkedIn].sort((a, b) => {
      const ta = a.checked_in_at ? new Date(a.checked_in_at).getTime() : 0;
      const tb = b.checked_in_at ? new Date(b.checked_in_at).getTime() : 0;
      return tb - ta;
    });
    const summary = [
      { label: "Check-in แล้ว", value: checkedIn.length, accent: true },
      { label: "จากทั้งหมด", value: total, sub: total ? `${Math.round((checkedIn.length / total) * 100)}%` : "0%" },
    ];
    return {
      title: `✅ รายงาน Check-in — ${evName}`,
      summary,
      sections: [],
      list: sorted,
      listMode: "checkin",
    };
  }

  if (type === "pending") {
    const sorted = [...pending].sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
    const byPay = {};
    pending.forEach((a) => {
      const k = isAttendeeExpired(a) ? "⌛ เกิน grace" : a.payment_status === "PAID" ? "💳 ชำระแล้ว" : a.payment_status === "COMPLIMENTARY" ? "🎫 ฟรี / ยกเว้น" : "⏳ ยังไม่ชำระ";
      byPay[k] = (byPay[k] || 0) + 1;
    });
    const summary = [
      { label: "ยังไม่ Check-in", value: pending.length, accent: true },
      { label: "จากทั้งหมด", value: total, sub: total ? `${Math.round((pending.length / total) * 100)}%` : "0%" },
    ];
    return {
      title: `⏳ ยังไม่ Check-in — ${evName}`,
      summary,
      sections: [
        { title: "💰 แยกตามสถานะการชำระ", count: Object.keys(byPay).length, html: `<div class="sr-breakdown">${_renderBreakdownRows(byPay, pending.length)}</div>` },
      ],
      list: sorted,
      listMode: "default",
    };
  }

  if (type === "paid") {
    const sorted = [...paid].sort((a, b) => {
      const ta = a.paid_at ? new Date(a.paid_at).getTime() : 0;
      const tb = b.paid_at ? new Date(b.paid_at).getTime() : 0;
      return tb - ta;
    });
    const byMethod = {};
    let revenueByMethod = {};
    paid.forEach((a) => {
      const k = _payMethodLabel(a.payment_method);
      byMethod[k] = (byMethod[k] || 0) + 1;
      revenueByMethod[k] = (revenueByMethod[k] || 0) + parseFloat(a.paid_amount || 0);
    });
    const totalRev = paid.reduce((s, a) => s + parseFloat(a.paid_amount || 0), 0);
    const summary = [
      { label: "ชำระแล้ว", value: paid.length, accent: true },
      { label: "รายรับรวม", value: `฿${formatNum(totalRev)}` },
      { label: "เฉลี่ย/คน", value: paid.length ? `฿${formatNum(totalRev / paid.length)}` : "฿0.00" },
    ];
    return {
      title: `💳 รายงานการชำระเงิน — ${evName}`,
      summary,
      sections: [
        { title: "💰 แยกตามวิธีชำระ (จำนวนคน)", count: Object.keys(byMethod).length, html: `<div class="sr-breakdown">${_renderBreakdownRows(byMethod, paid.length)}</div>` },
      ],
      list: sorted,
      listMode: "paid",
    };
  }

  if (type === "revenue") {
    const revenueByMethod = {};
    const revenueByTier = {};
    let totalRev = 0;
    paid.forEach((a) => {
      const amt = parseFloat(a.paid_amount || 0);
      totalRev += amt;
      const m = _payMethodLabel(a.payment_method);
      revenueByMethod[m] = (revenueByMethod[m] || 0) + amt;
      const t = _attTierName(a) || "— ไม่มี tier —";
      revenueByTier[t] = (revenueByTier[t] || 0) + amt;
    });
    const renderMoneyRows = (map) => {
      const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return `<div class="sr-empty" style="padding:14px">— ไม่มีรายรับ —</div>`;
      return entries
        .map(([label, amt]) => {
          const pct = totalRev ? Math.round((amt / totalRev) * 100) : 0;
          return `<div class="sr-bd-row">
            <div class="sr-bd-label">${escapeHtml(label)}</div>
            <div class="sr-bd-bar"><span style="width:${pct}%"></span></div>
            <div class="sr-bd-count">฿${formatNum(amt)} <span style="color:var(--text3);font-weight:500">(${pct}%)</span></div>
          </div>`;
        })
        .join("");
    };
    const summary = [
      { label: "รายรับรวม", value: `฿${formatNum(totalRev)}`, accent: true },
      { label: "จำนวนใบ", value: paid.length },
      { label: "เฉลี่ย/คน", value: paid.length ? `฿${formatNum(totalRev / paid.length)}` : "฿0.00" },
    ];
    const sortedPaid = [...paid].sort((a, b) => parseFloat(b.paid_amount || 0) - parseFloat(a.paid_amount || 0));
    return {
      title: `💰 รายงานรายรับ — ${evName}`,
      summary,
      sections: [
        { title: "🏦 แยกตามวิธีชำระ", count: Object.keys(revenueByMethod).length, html: `<div class="sr-breakdown">${renderMoneyRows(revenueByMethod)}</div>` },
        { title: "🎟️ แยกตาม Tier", count: Object.keys(revenueByTier).length, html: `<div class="sr-breakdown">${renderMoneyRows(revenueByTier)}</div>` },
      ],
      list: sortedPaid,
      listMode: "paid",
    };
  }

  if (type === "upline") {
    const byUpline = {};
    let matched = 0;
    allAttendees.forEach((a) => {
      const m = _uplineMatchFor(a);
      if (m) {
        matched++;
        const k = m.nickname || m.name;
        byUpline[k] = (byUpline[k] || 0) + 1;
      } else {
        byUpline["— ไม่มีสายงาน —"] = (byUpline["— ไม่มีสายงาน —"] || 0) + 1;
      }
    });
    const summary = [
      { label: "มีสายงาน", value: matched, accent: true, sub: total ? `${Math.round((matched / total) * 100)}%` : "0%" },
      { label: "จำนวนสาย", value: Object.keys(byUpline).filter((k) => k !== "— ไม่มีสายงาน —").length },
      { label: "ไม่มีสายงาน", value: total - matched },
    ];
    return {
      title: `🌿 รายงานตามสายงาน — ${evName}`,
      summary,
      sections: [
        { title: "🌿 แยกตามหัวหน้าทีม", count: Object.keys(byUpline).length, html: `<div class="sr-breakdown">${_renderBreakdownRows(byUpline, total)}</div>` },
      ],
      list: [],
      listMode: "default",
      hideList: true,
    };
  }

  if (type === "upline_checkin") {
    const byUpline = {};
    let matched = 0;
    checkedIn.forEach((a) => {
      const m = _uplineMatchFor(a);
      if (m) {
        matched++;
        const k = m.nickname || m.name;
        byUpline[k] = (byUpline[k] || 0) + 1;
      } else {
        byUpline["— ไม่มีสายงาน —"] = (byUpline["— ไม่มีสายงาน —"] || 0) + 1;
      }
    });
    const summary = [
      { label: "ผู้เข้างาน (มีสายงาน)", value: matched, accent: true, sub: checkedIn.length ? `${Math.round((matched / checkedIn.length) * 100)}%` : "0%" },
      { label: "จำนวนสาย", value: Object.keys(byUpline).filter((k) => k !== "— ไม่มีสายงาน —").length },
      { label: "เข้างานทั้งหมด", value: checkedIn.length },
    ];
    return {
      title: `🌿 ผู้เข้างานตามสายงาน — ${evName}`,
      summary,
      sections: [
        { title: "🌿 แยกตามหัวหน้าทีม (เฉพาะมาจริง)", count: Object.keys(byUpline).length, html: `<div class="sr-breakdown">${_renderBreakdownRows(byUpline, checkedIn.length)}</div>` },
      ],
      list: checkedIn,
      listMode: "checkin",
    };
  }

  if (type === "upline_compare") {
    const reg = {};   // สาย → ลงทะเบียน
    const att = {};   // สาย → เข้างาน
    allAttendees.forEach((a) => {
      const m = _uplineMatchFor(a);
      const k = m ? (m.nickname || m.name) : "— ไม่มีสายงาน —";
      reg[k] = (reg[k] || 0) + 1;
      if (a.checked_in) att[k] = (att[k] || 0) + 1;
    });
    const keys = Object.keys(reg).sort((a, b) => reg[b] - reg[a]);
    const lineKeys = keys.filter((k) => k !== "— ไม่มีสายงาน —");
    const matchedReg = allAttendees.filter((a) => _uplineMatchFor(a)).length;
    const matchedAtt = checkedIn.filter((a) => _uplineMatchFor(a)).length;
    const fullLines = lineKeys.filter((k) => (att[k] || 0) >= reg[k]).length;
    const rowsHtml = keys.map((k) => {
      const r = reg[k] || 0, c = att[k] || 0;
      const pct = r ? Math.round((c / r) * 100) : 0;
      return `<div class="sr-bd-row">
        <div class="sr-bd-label">${escapeHtml(k)}</div>
        <div class="sr-bd-bar"><span style="width:${pct}%"></span></div>
        <div class="sr-bd-count"><span class="sr-num">${c}/${r}</span> <span class="sr-pct">(${pct}%)</span></div>
      </div>`;
    }).join("") || `<div class="sr-empty" style="padding:14px">— ไม่มีข้อมูล —</div>`;
    const summary = [
      { label: "อัตราเข้างาน", value: `${matchedReg ? Math.round((matchedAtt / matchedReg) * 100) : 0}%`, accent: true, sub: `${matchedAtt}/${matchedReg} คน` },
      { label: "ครบทั้งสาย", value: `${fullLines}/${lineKeys.length}`, sub: "สาย" },
      { label: "จำนวนสาย", value: lineKeys.length },
    ];
    return {
      title: `🌿 เทียบลงทะเบียน / เข้างาน ตามสายงาน — ${evName}`,
      summary,
      sections: [
        { title: "🌿 เข้างาน / ลงทะเบียน แต่ละสาย", count: keys.length, html: `<div class="sr-breakdown">${rowsHtml}</div>` },
      ],
      list: [],
      listMode: "default",
      hideList: true,
    };
  }

  if (type === "attendance") {
    const byStatus = { "✅ มาจริง (Check-in)": checkedIn.length, "⏳ ยังไม่มา": pending.length };
    const summary = [
      { label: "ลงทะเบียน", value: total, accent: true },
      { label: "มาจริง", value: checkedIn.length, sub: total ? `${Math.round((checkedIn.length / total) * 100)}%` : "0%" },
      { label: "ยังไม่มา", value: pending.length },
    ];
    return {
      title: `👥 ลงทะเบียน / มาจริง — ${evName}`,
      summary,
      sections: [
        { title: "📊 สัดส่วนการมา", count: 2, html: `<div class="sr-breakdown">${_renderBreakdownRows(byStatus, total)}</div>` },
      ],
      list: allAttendees,
      listMode: "default",
    };
  }

  if (type === "payment") {
    const unpaidList = allAttendees.filter((a) => a.payment_status !== "PAID" && a.payment_status !== "COMPLIMENTARY");
    const byStatus = {};
    allAttendees.forEach((a) => { const k = _payStatusBadge(a); byStatus[k] = (byStatus[k] || 0) + 1; });
    const totalRev = paid.reduce((s, a) => s + parseFloat(a.paid_amount || 0), 0);
    const summary = [
      { label: "ชำระแล้ว", value: paid.length, accent: true, sub: total ? `${Math.round((paid.length / total) * 100)}%` : "0%" },
      { label: "ยังไม่ชำระ", value: unpaidList.length },
      { label: "รายรับรวม", value: `฿${formatNum(totalRev)}` },
    ];
    return {
      title: `💰 รายงานการชำระเงิน — ${evName}`,
      summary,
      sections: [
        { title: "💰 แยกตามสถานะ", count: Object.keys(byStatus).length, html: `<div class="sr-breakdown">${_renderBreakdownRows(byStatus, total)}</div>` },
      ],
      list: [...unpaidList, ...paid],
      listMode: "paid",
    };
  }

  return { title: "—", summary: [], sections: [], list: [], listMode: "default" };
}

window.openStatReport = function (type) {
  if (!allAttendees.length && type !== "total") {
    showToast("ยังไม่มีข้อมูลผู้ลงทะเบียน", "info");
    return;
  }
  const report = _buildStatReport(type);
  _statReportContext = { type, ...report };

  document.getElementById("statReportTitle").textContent = report.title;

  const summaryHtml = `<div class="sr-summary">
    ${report.summary
      .map((c) => `<div class="sr-summary-cell ${c.accent ? "is-accent" : ""}">
        <div class="sr-lbl">${escapeHtml(c.label)}</div>
        <div class="sr-val">${typeof c.value === "number" ? c.value.toLocaleString("th-TH") : c.value}</div>
        ${c.sub ? `<div class="sr-sub">${escapeHtml(c.sub)}</div>` : ""}
      </div>`)
      .join("")}
  </div>`;

  const sectionsHtml = report.sections
    .map((s) => `<div>
      <div class="sr-section-title">${s.title}<span class="sr-section-count">(${s.count})</span></div>
      ${s.html}
    </div>`)
    .join("");

  const listOpts =
    report.listMode === "checkin" ? { showCheckinTime: true } :
    report.listMode === "paid" ? { showPaidInfo: true } : {};
  const listHtml = report.hideList ? "" : `<div>
    <div class="sr-section-title">📋 รายชื่อ <span class="sr-section-count">(${report.list.length} คน)</span></div>
    <div class="sr-list">${_attendeeListRows(report.list, listOpts)}</div>
  </div>`;

  document.getElementById("statReportBody").innerHTML = summaryHtml + sectionsHtml + listHtml;
  document.getElementById("statReportModal").classList.add("open");
};

window.closeStatReport = function () {
  document.getElementById("statReportModal").classList.remove("open");
  _statReportContext = null;
};

window.printStatReport = function () {
  if (!_statReportContext) return;
  window.print();
};

window.exportStatReportCSV = function () {
  const ctx = _statReportContext;
  if (!ctx) return;
  const list = ctx.list || [];
  const cols = ["ลำดับ", "ชื่อ", "รหัสสมาชิก", "ตำแหน่ง", "Ticket", "เบอร์โทร", "Tier", "Check-in", "เวลาเช็คอิน", "สถานะชำระ", "วิธีชำระ", "จำนวนเงิน", "วันที่ชำระ"];
  const csvRows = [cols.join(",")];
  list.forEach((a, i) => {
    const row = [
      i + 1,
      a.name || "",
      a.member_code || "",
      a.role || "",
      a.ticket_no || "",
      a.phone || "",
      _attTierName(a),
      a.checked_in ? "ใช่" : "ไม่",
      a.checked_in_at ? formatDateTime(a.checked_in_at) : "",
      a.payment_status === "PAID" ? "ชำระแล้ว" : a.payment_status === "COMPLIMENTARY" ? "ฟรี/ยกเว้น" : isAttendeeExpired(a) ? "เกิน grace" : "ยังไม่ชำระ",
      a.payment_method ? _payMethodLabel(a.payment_method) : "",
      parseFloat(a.paid_amount || 0).toFixed(2),
      a.paid_at ? formatDateTime(a.paid_at) : "",
    ];
    csvRows.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  });
  const blob = new Blob(["﻿" + csvRows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const evCode = currentEvent?.event_code || "event";
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `report-${ctx.type}-${evCode}-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// ── FILTER + RENDER ───────────────────────────────────────
function filterTable() {
  const search = (_searchKeyword || "").toLowerCase();
  const checkin = document.getElementById("filterCheckin")?.value || "";
  const payment = document.getElementById("filterPayment")?.value || "";
  const tagFilter = document.getElementById("filterTag")?.value || "";

  const filtered = allAttendees.filter((a) => {
    const matchSearch =
      !search ||
      (a.name || "").toLowerCase().includes(search) ||
      (a.phone || "").toLowerCase().includes(search) ||
      (a.member_code || "").toLowerCase().includes(search) ||
      (a.ticket_no || "").toLowerCase().includes(search) ||
      (a.extra_fields?.referrer_code || "").toLowerCase().includes(search) ||
      (a.extra_fields?.referrer_name || "").toLowerCase().includes(search) ||
      (a.tags || []).some((t) => (t || "").toLowerCase().includes(search));
    const matchCheckin = !checkin || String(a.checked_in) === checkin;
    const matchPayment =
      !payment ||
      (payment === "EXPIRED"
        ? isAttendeeExpired(a)
        : a.payment_status === payment);
    const matchTag = !tagFilter || (a.tags || []).includes(tagFilter);
    return matchSearch && matchCheckin && matchPayment && matchTag;
  });

  renderTable(_sortByUplineLevel(filtered));
}

function renderTable(list) {
  const tbody = document.getElementById("attTableBody");
  const countEl = document.getElementById("attCount");
  if (countEl) countEl.textContent = `${list.length} คน`;

  ensureTrailingEmptyRow();
  rebuildTableHeader();   // ensure header matches current event config
  _applyTemplateGate();   // banner บังคับเลือก template ถ้ายังไม่เลือก

  const newRowsHtml = newRows.map(renderNewRowSpreadsheet).join("");
  tbody.innerHTML = newRowsHtml + _buildSavedRowsHtml(list);
  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
  updateBulkUI();
}

function _buildSavedRowsHtml(list) {
  const colCount = getActiveColumns().length;
  return list.length
    ? list.map((a, i) => renderSavedRowSpreadsheet(a, i + 1)).join("")
    : `<tr class="empty-state-row"><td colspan="${colCount}"><div class="empty-state" style="padding:20px">
        <div class="empty-icon" style="font-size:28px">👥</div>
        <div class="empty-text" style="font-size:12px">ยังไม่มีผู้เข้าร่วมที่ตรง — พิมพ์ที่แถวบนเพื่อเพิ่ม</div>
      </div></td></tr>`;
}

// Re-render เฉพาะ saved rows ไม่แตะ new-row → ไม่เสีย focus ตอนพิมพ์
function renderSavedRowsOnly(list) {
  const tbody = document.getElementById("attTableBody");
  if (!tbody) return;
  // ลบ saved-row + empty-state-row ทั้งหมด
  tbody
    .querySelectorAll("tr.saved-row, tr.empty-state-row")
    .forEach((tr) => tr.remove());
  tbody.insertAdjacentHTML("beforeend", _buildSavedRowsHtml(list));
  const countEl = document.getElementById("attCount");
  if (countEl) countEl.textContent = `${list.length} คน`;
  updateBulkUI();
}

// filter + update เฉพาะ saved rows (ใช้ตอนพิมพ์ใน new-row)
function filterTableSavedOnly() {
  const search = (_searchKeyword || "").toLowerCase();
  const checkin = document.getElementById("filterCheckin")?.value || "";
  const payment = document.getElementById("filterPayment")?.value || "";
  const tagFilter = document.getElementById("filterTag")?.value || "";

  const filtered = allAttendees.filter((a) => {
    const matchSearch =
      !search ||
      (a.name || "").toLowerCase().includes(search) ||
      (a.phone || "").toLowerCase().includes(search) ||
      (a.member_code || "").toLowerCase().includes(search) ||
      (a.ticket_no || "").toLowerCase().includes(search) ||
      (a.extra_fields?.referrer_code || "").toLowerCase().includes(search) ||
      (a.extra_fields?.referrer_name || "").toLowerCase().includes(search) ||
      (a.tags || []).some((t) => (t || "").toLowerCase().includes(search));
    const matchCheckin = !checkin || String(a.checked_in) === checkin;
    const matchPayment =
      !payment ||
      (payment === "EXPIRED"
        ? isAttendeeExpired(a)
        : a.payment_status === payment);
    const matchTag = !tagFilter || (a.tags || []).includes(tagFilter);
    return matchSearch && matchCheckin && matchPayment && matchTag;
  });
  renderSavedRowsOnly(_sortByUplineLevel(filtered));
}

// ── SPREADSHEET ROW RENDERERS ──────────────────────────────
// adaptive cells ตาม getActiveColumns() · เป็น render path เดียวของหน้านี้

function renderSavedRowSpreadsheet(a, seq) {
  const expired = isAttendeeExpired(a);
  const displayPayStatus = expired ? "EXPIRED" : (a.payment_status || "COMPLIMENTARY");
  const tierName = a.tier_id && currentTiersById[a.tier_id]
    ? currentTiersById[a.tier_id].tier_name
    : null;
  const isSelected = selectedAttendeeIds.has(a.attendee_id);
  const cols = getActiveColumns();
  const cells = cols.map(c => _renderSavedCellSpread(c, a, seq, displayPayStatus, tierName, isSelected)).join("");
  return `<tr class="saved-row${isSelected ? " row-selected" : ""}" data-aid="${a.attendee_id}">${cells}</tr>`;
}

function _renderSavedCellSpread(col, a, seq, payStatus, tierName, isSelected) {
  const tdOpen = `<td class="${col.align === "center" ? "col-center" : ""}">`;
  // base columns
  switch (col.key) {
    case "check":
      return `${tdOpen}<input type="checkbox" class="att-row-check" data-aid="${a.attendee_id}" ${isSelected ? "checked" : ""}
        onclick="event.stopPropagation();window.toggleSelectAttendee(${a.attendee_id}, this.checked)"
        style="cursor:pointer;width:16px;height:16px"></td>`;
    case "num":
      return `${tdOpen}<span style="font-family:'IBM Plex Mono',monospace;color:var(--text3);font-size:11.5px">${seq}</span></td>`;
    case "name":
      return `<td>
        <div class="cell-name-wrap" data-field="name" onclick="window.startEditCell(${a.attendee_id},'name',this)">
          <div style="font-weight:600;cursor:text" title="คลิกเพื่อแก้ไขชื่อ">
            ${a.member_code
              ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;background:#1e40af;color:#fff;padding:2px 7px;border-radius:10px;font-weight:700;margin-right:6px">${escapeHtml(a.member_code)}</span>`
              : `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:10px;font-weight:700;margin-right:6px;border:1px solid #fcd34d" title="ยังไม่ใช่สมาชิก">👤 Guest</span>`
            }${escapeHtml(a.name)}
          </div>
          ${renderTagsInline(a, a.person_role === "co_applicant" ? `<span style="font-size:10px;color:#9333ea;background:#f3e8ff;padding:1px 7px;border-radius:10px;font-weight:700;white-space:nowrap" title="ผู้สมัครร่วมจากรหัสเดียวกัน">👥 ผู้สมัครร่วม</span>` : "")}
        </div>
      </td>`;
    case "payment":
      return `${tdOpen}<span class="pay-badge pay-${payStatus}"
        onclick="window.startEditCell(${a.attendee_id},'payment_status',this)"
        style="cursor:pointer" title="คลิกเพื่อบันทึกการชำระ">
        ${payLabel(payStatus)}
      </span>
      ${parseFloat(a.paid_amount || 0) > 0 ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">฿${formatNum(a.paid_amount)}</div>` : ""}
      ${tierName ? `<div class="tier-chip" title="ราคาที่ lock ตอนลงทะเบียน">🎟️ ${escapeHtml(tierName)}</div>` : ""}
      ${a.payment_method ? `<div class="tier-chip" style="background:#dbeafe;color:#1e40af" title="วิธีชำระ">${paymentMethodIcon(a.payment_method)}</div>` : ""}
      ${renderDeadlineChip(a)}</td>`;
    case "checkin":
      return `${tdOpen}<button class="btn-checkin ${a.checked_in ? "undo-checkin" : "do-checkin"}"
        onclick="window.toggleCheckin(${a.attendee_id}, ${a.checked_in})">
        ${a.checked_in ? "✅" : "⬜"}
      </button>
      ${a.check_in_at ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${formatDateTime(a.check_in_at)}</div>` : ""}</td>`;
    case "actions":
      return `${tdOpen}<div style="display:inline-flex;gap:4px;align-items:center">
        <button class="btn-qr" onclick="window.openQrModal(${a.attendee_id})" title="ดู QR">🎫</button>
        <button class="btn-icon danger" onclick="window.deleteAttendee(${a.attendee_id})" title="ลบ">🗑</button>
      </div></td>`;
  }
  // field:<key> — คลิกแก้ inline ได้ (ฟิลด์ที่แก้ได้)
  if (col.key.startsWith("field:")) {
    const fkey = col.key.slice(6);
    const td = _FIELD_EDIT[fkey]
      ? `<td class="${col.align === "center" ? "col-center" : ""} att-edit-cell" title="คลิกเพื่อแก้ไข" onclick="window.editFieldCell(${a.attendee_id},'${fkey}',this)">`
      : tdOpen;
    return _renderFieldCellSpread(fkey, a, td);
  }
  // custom:<key> — text value จาก extra_fields (คลิกแก้ inline)
  if (col.key.startsWith("custom:")) {
    const ckey = col.key.slice(7);
    const cf = (_getActiveFieldConfig().custom_fields || []).find(c => c.key === ckey);
    const ftype = cf?.ftype || "text";
    const v = a.extra_fields && typeof a.extra_fields === "object" ? a.extra_fields[ckey] : null;
    const inner = v ? `<span style="font-size:11.5px;color:#0f172a">${escapeHtml(String(v))}</span>` : `<span class="att-empty">·</span>`;
    return `<td class="${col.align === "center" ? "col-center" : ""} att-edit-cell" title="คลิกเพื่อแก้ไข"
      onclick="window.editCustomCell(${a.attendee_id},'${escapeHtml(ckey)}','${ftype}',this)">${inner}</td>`;
  }
  // qual:<key> — คลิกสลับ ✓/✗/— (autosave)
  if (col.key.startsWith("qual:")) {
    const qkey = col.key.slice(5);
    const td = `<td class="${col.align === "center" ? "col-center" : ""} att-edit-cell" title="คลิกสลับ ✓ / ✗ / —" onclick="window.toggleQualCell(${a.attendee_id},'${escapeHtml(qkey)}')">`;
    return _renderQualCellSpread(qkey, a, td);
  }
  return `${tdOpen}—</td>`;
}

function _renderFieldCellSpread(fkey, a, tdOpen) {
  const empty = `${tdOpen}<span class="att-empty">·</span></td>`;
  switch (fkey) {
    case "position":
      return a.position_level
        ? `${tdOpen}<span class="cell-member-pos">⭐ ${escapeHtml(a.position_level)}</span></td>`
        : empty;
    case "phone":
      return a.phone
        ? `${tdOpen}<span class="cell-phone">${escapeHtml(a.phone)}</span></td>`
        : empty;
    case "upline": {
      const m = _uplineMatchFor(a);
      if (m) {
        const txt = m.nickname || m.name || a.upline_name_text || "";
        return `${tdOpen}<span class="att-upline-lv" style="background:${escapeHtml(m.color || "#e0e7ff")}" title="${escapeHtml(txt)}">🌿 ${escapeHtml(txt)}</span></td>`;
      }
      return a.upline_name_text
        ? `${tdOpen}<span style="font-size:11.5px;color:#3730a3;background:#e0e7ff;padding:2px 8px;border-radius:5px;font-weight:600">🌿 ${escapeHtml(a.upline_name_text)}</span></td>`
        : empty;
    }
    case "referrer": {
      const rc = a.extra_fields?.referrer_code;
      const rn = a.extra_fields?.referrer_name;
      if (!rc && !rn) return empty;
      const label = rc && rn ? `${escapeHtml(rc)} · ${escapeHtml(rn)}` : escapeHtml(rc || rn);
      return `${tdOpen}<span style="font-size:11.5px;color:#92400e;background:#fef3c7;padding:2px 8px;border-radius:5px;font-weight:600" title="${escapeHtml(rn || rc)}">🤝 ${label}</span></td>`;
    }
    case "cs_staff":
      return a.cs_staff
        ? `${tdOpen}<span style="font-size:11.5px;color:#7c2d12;background:#fed7aa;padding:2px 8px;border-radius:5px;font-weight:600">${escapeHtml(a.cs_staff)}</span></td>`
        : empty;
    case "line_name":
      return a.line_name_reported
        ? `${tdOpen}<span style="font-size:11.5px;color:#065f46">💬 ${escapeHtml(a.line_name_reported)}</span></td>`
        : empty;
    case "fb_page_name":
      return a.fb_page_name
        ? `${tdOpen}<span style="font-size:11.5px;color:#1e3a8a">📘 ${escapeHtml(a.fb_page_name)}</span></td>`
        : empty;
    case "had_attended":
      if (a.had_attended_before === true)
        return `${tdOpen}<span style="font-size:11px;color:#065f46;background:#d1fae5;padding:2px 8px;border-radius:5px;font-weight:700">↻ เคย</span></td>`;
      if (a.had_attended_before === false)
        return `${tdOpen}<span style="font-size:11px;color:#7f1d1d;background:#fee2e2;padding:2px 8px;border-radius:5px;font-weight:700">★ ใหม่</span></td>`;
      return empty;
    case "note":
      if (!a.attendee_note) return empty;
      const noteShort = a.attendee_note.length > 22 ? a.attendee_note.slice(0, 22) + "…" : a.attendee_note;
      return `${tdOpen}<span style="font-size:11px;color:#475569;font-style:italic" title="${escapeHtml(a.attendee_note)}">${escapeHtml(noteShort)}</span></td>`;
    default:
      return empty;
  }
}

function _renderQualCellSpread(qkey, a, tdOpen) {
  const v = a.extra_fields && typeof a.extra_fields === "object" ? a.extra_fields[qkey] : undefined;
  if (v === true)
    return `${tdOpen}<span style="font-size:14px;color:#15803d;font-weight:700">✓</span></td>`;
  if (v === false)
    return `${tdOpen}<span style="font-size:14px;color:#b91c1c">✗</span></td>`;
  return `${tdOpen}<span style="color:var(--text3);font-size:11px">—</span></td>`;
}

function renderNewRowSpreadsheet(r) {
  const cols = getActiveColumns();
  // ใช้ colspan ครอบทุกคอลัมน์ตรงกลาง (หลัง check + #) เว้น 4 ตัวท้าย: ticket, payment, checkin, actions
  // → search input ครอบกว้างให้พิมพ์ง่าย
  const colCount = cols.length;
  const trailingCols = ["payment", "checkin", "actions"];
  const trailingCount = cols.filter(c => trailingCols.includes(c.key)).length;
  const headCount = cols[1]?.key === "num" ? 2 : 1;   // check + (#)
  const searchSpan = colCount - headCount - trailingCount;
  const codeChip = r.memberCode
    ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;background:#1e40af;color:#fff;padding:2px 7px;border-radius:10px;font-weight:700;white-space:nowrap">${escapeHtml(r.memberCode)}</span>`
    : "";
  const posBadge = r.positionLevel
    ? `<span style="font-size:10px;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:4px;font-weight:700;white-space:nowrap">⭐ ${escapeHtml(r.positionLevel)}</span>`
    : "";
  const phoneBadge = r.phone ? `<span class="cell-phone" style="font-size:11px">${escapeHtml(r.phone)}</span>` : "";

  const hasPayment = cols.some(c => c.key === "payment");
  return `<tr class="new-row" data-nrid="${r.id}">
    <td class="col-center"><span class="att-empty">·</span></td>
    ${cols[1]?.key === "num" ? `<td class="col-center"><span class="att-empty">·</span></td>` : ""}
    <td colspan="${searchSpan}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap">
        ${codeChip}
        <input class="inline-input" placeholder="🔍 พิมพ์รหัส/ชื่อ — เพื่อเพิ่ม หรือ filter รายการด้านล่าง" autocomplete="off"
          value="${escapeHtml(r.name)}"
          oninput="window.onNewRowNameInput('${r.id}', this.value)"
          onkeydown="window.onNewRowKey(event, '${r.id}')"
          onfocus="window.onNewRowFocus('${r.id}')"
          data-role="search"
          style="flex:1;min-width:200px">
        ${posBadge}
        ${phoneBadge}
      </div>
    </td>
    ${hasPayment ? `<td class="col-center">
      <select class="inline-select" onchange="window.onNewRowPayment('${r.id}', this.value)">
        <option value="UNPAID" ${r.paymentStatus === "UNPAID" ? "selected" : ""}>⏳ ยังไม่ชำระ</option>
        <option value="PAID" ${r.paymentStatus === "PAID" ? "selected" : ""}>💳 ชำระแล้ว</option>
        <option value="COMPLIMENTARY" ${r.paymentStatus === "COMPLIMENTARY" ? "selected" : ""}>🎫 ฟรี</option>
      </select>
    </td>` : ""}
    <td class="col-center"><span class="att-empty">·</span></td>
    <td class="col-center">
      <button class="inline-save-btn" data-perm="attendee_register" ${!r.name || r.saving ? "disabled" : ""} onclick="window.saveNewRow('${r.id}')">
        ${r.saving ? "⏳" : "💾"}
      </button>
    </td>
  </tr>`;
}

function paymentMethodIcon(m) {
  return {
    slip_kbank: "🏦 K+",
    slip_ktb: "🏦 KTB",
    cash: "💵 เงินสด",
    credit_card: "💳 CC",
  }[m] || m;
}

function renderDeadlineChip(a) {
  if (a.payment_status !== "UNPAID" || !a.payment_deadline) return "";
  const d = daysUntil(a.payment_deadline);
  if (d == null) return "";
  const cls = d < 0 ? "expired" : d <= 1 ? "near" : "ok";
  const icon = d < 0 ? "⌛" : "⏳";
  const label = d < 0
    ? `เกิน ${Math.abs(d)} วัน`
    : d === 0
    ? "วันนี้"
    : `อีก ${d} วัน`;
  return `<div class="deadline-chip ${cls}" title="ครบกำหนด ${formatDMYShort(a.payment_deadline)}">${icon} ${label}</div>`;
}

function _tagColorClass(name) {
  const cat = currentTagCategories.find((c) => c.tag_name === name);
  const color = cat?.color || "yellow";
  return TAG_COLOR_PRESETS.includes(color) ? `tag-color-${color}` : "tag-color-yellow";
}

function renderTagsInline(a, prefixHtml = "") {
  const tags = a.tags || [];
  const chips = tags
    .map(
      (t) => `<span class="tag-chip ${_tagColorClass(t)}">${escapeHtml(t)}<span class="tag-chip-remove"
        onclick="event.stopPropagation();window.removeAttendeeTag(${a.attendee_id},'${escapeJS(t)}')">✕</span></span>`,
    )
    .join("");
  return `<div class="tag-chips" onclick="event.stopPropagation()">
    ${prefixHtml}
    ${chips}
    <button class="tag-chip" style="background:#e2e8f0;color:#475569;border:none;cursor:pointer;font-size:10px"
      onclick="event.stopPropagation();window.openTagPicker(${a.attendee_id}, this)">+ tag</button>
  </div>`;
}
function escapeJS(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── CHECK-IN TOGGLE ───────────────────────────────────────
window.toggleCheckin = async function (id, isCheckedIn) {
  showLoading(true);
  try {
    const ts = !isCheckedIn ? buildCheckinTimestamp() : null;
    await updateAttendee(id, {
      checked_in: !isCheckedIn,
      check_in_at: ts,
    });
    const a = allAttendees.find((x) => x.attendee_id === id);
    if (a) {
      a.checked_in = !isCheckedIn;
      a.check_in_at = ts;
    }
    updateStats();
    filterTable();
    showToast(
      !isCheckedIn ? "Check-in สำเร็จ ✅" : "ยกเลิก Check-in แล้ว",
      "success",
    );
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  }
  showLoading(false);
};

// ── INLINE NEW-ROW HANDLERS ───────────────────────────────
function _findRow(id) { return newRows.find(r => r.id === id); }

window.onNewRowNameInput = function (id, val) {
  const r = _findRow(id); if (!r) return;
  r.name = val;
  activeSearchRowId = id;
  // ใช้ input นี้เป็น filter ของรายชื่อด้านล่างด้วย
  _searchKeyword = val || "";
  // If member is already linked, skip member search — user is just tweaking the display name
  if (!r.memberCode) {
    window.searchMember(val, id);
  }
  // Update saved-rows filter ทันที (ไม่แตะ new-row → ไม่เสีย focus)
  filterTableSavedOnly();
  // ❌ เลิก auto-add trailing empty row ตอนพิมพ์ (กันแถวซ้อนดูสับสน)
  //   → trailing row ใหม่จะถูกเพิ่มเฉพาะตอน save สำเร็จ (saveNewRow / saveAttendeeForm)
  _updateSaveBtn(id);
};

// Insert เฉพาะ trailing empty row ที่เพิ่มล่าสุด ไปต่อท้าย new-rows (ไม่แตะของเดิม)
function _appendLastNewRow() {
  const tbody = document.getElementById("attTableBody");
  if (!tbody) return;
  const last = newRows[newRows.length - 1];
  if (!last) return;
  const html = renderNewRowSpreadsheet(last);
  // Insert ก่อน saved-row ตัวแรก (หรือ empty-state-row)
  const firstSavedOrEmpty = tbody.querySelector("tr.saved-row, tr.empty-state-row");
  if (firstSavedOrEmpty) {
    firstSavedOrEmpty.insertAdjacentHTML("beforebegin", html);
  } else {
    tbody.insertAdjacentHTML("beforeend", html);
  }
  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
}

window.onNewRowPayment = function (id, val) {
  const r = _findRow(id); if (!r) return;
  r.paymentStatus = val;
};

window.onNewRowFocus = function (id) {
  activeSearchRowId = id;
};

window.onNewRowKey = function (ev, id) {
  // Delegate arrow/enter/escape to member-suggest handler if dropdown is open
  const sug = document.getElementById("memberSuggest");
  const open = sug && sug.style.display !== "none" && _lastMemberResults.length;
  if (open && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === "Escape")) {
    window._onMemberSearchKey(ev);
    return;
  }
  if (ev.key === "Enter") {
    ev.preventDefault();
    window.saveNewRow(id);
  }
};

window.clearNewRowMember = function (id) {
  const r = _findRow(id); if (!r) return;
  r.memberCode = "";
  r.personRole = "";
  r.positionLevel = "";
  r.name = "";
  r.phone = "";
  r.prereq = null;
  filterTable();
};

function _updateSaveBtn(id) {
  const btn = document.querySelector(`tr[data-nrid="${id}"] .inline-save-btn`);
  const r = _findRow(id); if (!btn || !r) return;
  btn.disabled = !r.name || r.saving;
}

// Called from selectMember when user picks from dropdown
function _applyMemberToRow(rowId, code, role, name, phone, positionLevel) {
  const r = _findRow(rowId); if (!r) return;
  r.memberCode = code;
  r.personRole = role || "primary";
  r.name = name || "";
  r.phone = phone || "";
  r.positionLevel = positionLevel || "";
  r.prereq = null;
  // Pre-check prerequisite
  _checkPrereqForRow(r);
  filterTable();
}

async function _checkPrereqForRow(r) {
  if (!r.memberCode || !currentEventId) return;
  try {
    const { url, key } = getSB();
    const h = { apikey: key, Authorization: `Bearer ${key}` };
    const evRes = await fetch(`${url}/rest/v1/events?select=series_id,level_id&event_id=eq.${currentEventId}`, { headers: h });
    const ev = (await evRes.json())[0];
    if (!ev?.series_id || !ev?.level_id) return;
    const lvRes = await fetch(`${url}/rest/v1/course_levels?select=*&id=eq.${ev.level_id}`, { headers: h });
    const level = (await lvRes.json())[0];
    if (!level?.prerequisite_level_id) return;
    const prRes = await fetch(`${url}/rest/v1/course_levels?select=level_name&id=eq.${level.prerequisite_level_id}`, { headers: h });
    const prereqLevel = (await prRes.json())[0];
    const aRes = await fetch(`${url}/rest/v1/event_attendees?select=event_id&member_code=eq.${r.memberCode}&checked_in=eq.true`, { headers: h });
    const attended = await aRes.json();
    let passed = false;
    if (attended?.length) {
      const ids = attended.map(a => a.event_id).join(",");
      const evCheck = await fetch(`${url}/rest/v1/events?select=event_id&series_id=eq.${ev.series_id}&level_id=eq.${level.prerequisite_level_id}&event_id=in.(${ids})`, { headers: h });
      passed = (await evCheck.json()).length > 0;
    }
    r.prereq = {
      ok: passed,
      msg: passed
        ? `ผ่าน ${prereqLevel?.level_name || "level ก่อนหน้า"} แล้ว`
        : `ต้องเรียน ${prereqLevel?.level_name || "level ก่อนหน้า"} ก่อน`,
    };
    filterTable();
  } catch (e) { console.warn("prereq:", e); }
}

window.saveNewRow = async function (id) {
  const r = _findRow(id); if (!r) return;
  let name = (r.name || "").trim();
  if (!name) { showToast("กรุณาระบุชื่อ", "error"); return; }
  if (r.saving) return;
  // บังคับเลือก template ก่อนเพิ่ม (template-first)
  if (await _requireTemplateOrPrompt()) return;
  r.saving = true; _updateSaveBtn(id);

  // Auto-link member if user typed a code but didn't pick from dropdown
  // (View อาจคืน 1-2 rows: primary + co_applicant — auto-pick primary; co-applicant ต้องเลือกจาก dropdown)
  if (!r.memberCode && /^\d{3,10}$/.test(name)) {
    try {
      const { url, key } = getSB();
      const res = await fetch(
        `${url}/rest/v1/member_persons?select=member_code,person_role,person_name,phone,position_level&member_code=eq.${encodeURIComponent(name)}&order=person_role`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        // Prefer primary; fall back to whichever row exists
        const m = rows?.find(x => x.person_role === "primary") || rows?.[0];
        if (m) {
          r.memberCode = m.member_code;
          r.personRole = m.person_role || "primary";
          r.name = m.person_name || name;
          r.phone = m.phone || r.phone || "";
          r.positionLevel = m.position_level || "";
          name = r.name;
        }
      }
    } catch (e) { console.warn("auto-link:", e); }
  }

  // Duplicate check up-front → กันลงซ้ำเฉพาะ (รหัส + role) เดียวกัน
  // (รหัสเดียวกันลง primary + co_applicant ได้ = 2 คน)
  if (r.memberCode) {
    const role = r.personRole || "primary";
    const dup = allAttendees.find(a => a.member_code === r.memberCode && (a.person_role || "primary") === role);
    if (dup) {
      const roleLabel = role === "co_applicant" ? " (ผู้สมัครร่วม)" : "";
      showToast(`❌ สมาชิก ${r.memberCode}${roleLabel} (${dup.name}) ลงทะเบียนแล้ว — Ticket: ${dup.ticket_no || "—"}`, "error");
      r.memberCode = ""; r.personRole = ""; r.name = ""; r.phone = "";
      r.positionLevel = ""; r.prereq = null; r.saving = false;
      filterTable();
      requestAnimationFrame(() => {
        const input = document.querySelector(`tr[data-nrid="${id}"] input[data-role="search"]`);
        input?.focus();
      });
      return;
    }
  }

  try {
    const activeTier = getActiveTier();
    const price = getCurrentPrice();
    const grace = getEventGraceDays();
    const needsPayment = r.paymentStatus === "UNPAID";
    const payload = {
      event_id: currentEventId,
      name,
      phone: r.phone || null,
      position_level: r.positionLevel || null,
      paid_amount: price,
      payment_status: r.paymentStatus,
      member_code: r.memberCode || null,
      person_role: r.memberCode ? (r.personRole || "primary") : "guest",
      tier_id: activeTier?.tier_id || null,
      payment_deadline: needsPayment ? computeDeadlineISO(grace) : null,
      checked_in: _autoCheckin ? true : false,
      check_in_at: _autoCheckin ? buildCheckinTimestamp() : null,
    };
    const blocked = await _enforceRegistration(payload);
    if (blocked) { r.saving = false; _updateSaveBtn(id); return; }
    payload.ticket_no = await generateTicketNo(currentEventId);
    await createAttendee(payload);
    showToast("เพิ่มผู้เข้าร่วมแล้ว 👤", "success");
    // Remove this row from newRows, then ensure trailing empty
    newRows = newRows.filter(x => x.id !== id);
    ensureTrailingEmptyRow();
    allAttendees = await fetchAttendees(currentEventId);
    _searchKeyword = ""; // เคลียร์ filter หลัง save
    populateTagFilter();
    updateStats();
    filterTable();   // แสดงแถวทันที — ไม่รอ MLM walk
    // สี/เรียงระดับสายงานตามมาเบื้องหลัง (ไม่บล็อกการแสดงผล)
    computeUplineMatches().then(() => { if (currentEventId) { updateStats(); filterTable(); } }).catch(() => {});
    // Focus first empty new row's search input
    requestAnimationFrame(() => {
      const input = document.querySelector("tr.new-row input[data-role='search']");
      input?.focus();
    });
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    r.saving = false;
    _updateSaveBtn(id);
  }
};

// ── INLINE CELL EDIT (saved rows) ─────────────────────────
window.startEditCell = function (attId, field, cellEl) {
  const a = allAttendees.find(x => x.attendee_id === attId);
  if (!a) return;
  if (cellEl.querySelector("input,select")) return; // already editing

  // Payment cell → open full modal (method, slip, ref)
  if (field === "payment_status") {
    window.openPaymentModal(attId);
    return;
  }

  const current = a[field] || "";
  {
    const inp = document.createElement("input");
    inp.className = "inline-input";
    inp.value = current;
    inp.placeholder = field === "phone" ? "0XX-XXX-XXXX" : "ชื่อ";
    const save = async () => {
      const v = inp.value.trim();
      if (v === (current || "").trim()) { filterTable(); return; }
      if (field === "name" && !v) { showToast("ชื่อห้ามว่าง", "error"); filterTable(); return; }
      await _patchAttendee(attId, { [field]: v || null });
    };
    inp.onblur = save;
    inp.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      else if (e.key === "Escape") { filterTable(); }
    };
    cellEl.innerHTML = "";
    cellEl.appendChild(inp);
    inp.focus();
    inp.select();
  }
};

// map ฟิลด์ที่แก้ inline ได้ → DB column + ชนิด input (upline=auto ไม่ให้แก้)
const _FIELD_EDIT = {
  phone:        { col: "phone",              type: "text", ph: "0XX-XXX-XXXX" },
  position:     { col: "position_level",     type: "text", ph: "SD, DM, DR..." },
  cs_staff:     { col: "cs_staff",           type: "text", ph: "CS" },
  line_name:    { col: "line_name_reported", type: "text", ph: "ชื่อไลน์" },
  fb_page_name: { col: "fb_page_name",       type: "text", ph: "ชื่อเพจ FB" },
  note:         { col: "attendee_note",      type: "text", ph: "หมายเหตุ" },
  had_attended: { col: "had_attended_before", type: "tristate" },
  referrer:     { type: "referrer" },
};

// แก้ฟิลด์มาตรฐาน inline (autosave)
window.editFieldCell = function (attId, fkey, tdEl) {
  const a = allAttendees.find(x => x.attendee_id === attId);
  if (!a || tdEl.querySelector("input,select")) return;
  const def = _FIELD_EDIT[fkey];
  if (!def) return;

  if (def.type === "tristate") {
    const sel = document.createElement("select");
    sel.className = "inline-input";
    sel.innerHTML = `<option value="">—</option><option value="true">↻ เคย</option><option value="false">★ ใหม่</option>`;
    sel.value = a.had_attended_before === true ? "true" : a.had_attended_before === false ? "false" : "";
    sel.onchange = () => _patchAttendee(attId, { had_attended_before: sel.value === "true" ? true : sel.value === "false" ? false : null });
    sel.onblur = () => { if (document.body.contains(sel)) filterTable(); };
    tdEl.innerHTML = ""; tdEl.appendChild(sel); sel.focus();
    return;
  }

  if (def.type === "referrer") {
    const inp = document.createElement("input");
    inp.className = "inline-input"; inp.placeholder = "รหัสผู้แนะนำ";
    inp.value = a.extra_fields?.referrer_code || "";
    inp.onblur = async () => {
      const code = inp.value.trim();
      if (code === (a.extra_fields?.referrer_code || "")) { filterTable(); return; }
      if (!code) { await _patchAttendeeExtra(attId, { referrer_code: null, referrer_name: null }); return; }
      const name = await _lookupMemberName(code);
      await _patchAttendeeExtra(attId, { referrer_code: code, referrer_name: name || code });
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } else if (e.key === "Escape") filterTable(); };
    tdEl.innerHTML = ""; tdEl.appendChild(inp); inp.focus(); inp.select();
    return;
  }

  const inp = document.createElement("input");
  inp.className = "inline-input"; inp.type = "text";
  inp.value = a[def.col] || ""; inp.placeholder = def.ph || "";
  inp.onblur = async () => {
    const v = inp.value.trim();
    if (v === (a[def.col] || "").trim()) { filterTable(); return; }
    await _patchAttendee(attId, { [def.col]: v || null });
  };
  inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } else if (e.key === "Escape") filterTable(); };
  tdEl.innerHTML = ""; tdEl.appendChild(inp); inp.focus(); inp.select();
};

// แก้ custom field (extra_fields) inline (autosave)
window.editCustomCell = function (attId, key, ftype, tdEl) {
  const a = allAttendees.find(x => x.attendee_id === attId);
  if (!a || tdEl.querySelector("input")) return;
  const inp = document.createElement("input");
  inp.className = "inline-input";
  inp.type = ftype === "date" ? "date" : ftype === "number" ? "number" : "text";
  inp.value = a.extra_fields?.[key] ?? "";
  inp.onblur = async () => {
    const v = inp.value.trim();
    if (v === String(a.extra_fields?.[key] ?? "")) { filterTable(); return; }
    await _patchAttendeeExtra(attId, { [key]: v || null });
  };
  inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } else if (e.key === "Escape") filterTable(); };
  tdEl.innerHTML = ""; tdEl.appendChild(inp); inp.focus(); inp.select();
};

// สลับค่า qualification: — → ✓ → ✗ → — (autosave)
window.toggleQualCell = function (attId, qkey) {
  const a = allAttendees.find(x => x.attendee_id === attId);
  if (!a) return;
  const cur = a.extra_fields?.[qkey];
  const next = cur === undefined || cur === null ? true : cur === true ? false : null;
  _patchAttendeeExtra(attId, { [qkey]: next });
};

// patch extra_fields (merge + ลบ key ที่ค่าว่าง)
async function _patchAttendeeExtra(id, patch) {
  const a = allAttendees.find(x => x.attendee_id === id);
  if (!a) return;
  const merged = { ...(a.extra_fields || {}) };
  Object.entries(patch).forEach(([k, v]) => { if (v === null || v === "") delete merged[k]; else merged[k] = v; });
  try {
    await updateAttendee(id, { extra_fields: merged });
    a.extra_fields = merged;
    updateStats();
    filterTable();
    showToast("บันทึกแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    filterTable();
  }
}

async function _patchAttendee(id, patch) {
  try {
    await updateAttendee(id, patch);
    const a = allAttendees.find(x => x.attendee_id === id);
    if (a) Object.assign(a, patch);
    updateStats();
    filterTable();
    showToast("บันทึกแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    filterTable();
  }
}

// ── DELETE ────────────────────────────────────────────────
window.deleteAttendee = function (id) {
  const a = allAttendees.find((x) => x.attendee_id === id);
  if (!a) return;
  DeleteModal.open(`ต้องการลบ "${a.name}" ออกจากรายชื่อหรือไม่?`, async () => {
    showLoading(true);
    try {
      await removeAttendee(id);
      showToast("ลบผู้เข้าร่วมแล้ว", "success");
      allAttendees = await fetchAttendees(currentEventId);
      updateStats();
      filterTable();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── BULK SELECT / DELETE ──────────────────────────────────
function _visibleAttendeeIds() {
  return [...document.querySelectorAll('.att-row-check[data-aid]')]
    .map((el) => parseInt(el.dataset.aid));
}
function updateBulkUI() {
  // Drop ids no longer present in current list
  const presentIds = new Set(allAttendees.map((a) => a.attendee_id));
  [...selectedAttendeeIds].forEach((id) => { if (!presentIds.has(id)) selectedAttendeeIds.delete(id); });

  const btn = document.getElementById("btnBulkDelete");
  const cnt = document.getElementById("bulkDeleteCount");
  const n = selectedAttendeeIds.size;
  if (btn) btn.style.display = n > 0 ? "inline-flex" : "none";
  if (cnt) cnt.textContent = n;

  // Sync select-all checkbox state vs currently visible rows
  const sa = document.getElementById("selectAllAttendees");
  if (sa) {
    const visible = _visibleAttendeeIds();
    const allSelected = visible.length > 0 && visible.every((id) => selectedAttendeeIds.has(id));
    const someSelected = visible.some((id) => selectedAttendeeIds.has(id));
    sa.checked = allSelected;
    sa.indeterminate = !allSelected && someSelected;
  }
}
window.toggleSelectAttendee = function (id, checked) {
  if (checked) selectedAttendeeIds.add(id);
  else selectedAttendeeIds.delete(id);
  const tr = document.querySelector(`tr.saved-row[data-aid="${id}"]`);
  if (tr) tr.classList.toggle("row-selected", checked);
  updateBulkUI();
};
window.toggleSelectAll = function (checked) {
  _visibleAttendeeIds().forEach((id) => {
    if (checked) selectedAttendeeIds.add(id);
    else selectedAttendeeIds.delete(id);
  });
  document.querySelectorAll(".att-row-check").forEach((el) => {
    el.checked = checked;
    const tr = el.closest("tr.saved-row");
    if (tr) tr.classList.toggle("row-selected", checked);
  });
  updateBulkUI();
};
window.bulkDeleteSelected = function () {
  const ids = [...selectedAttendeeIds];
  if (!ids.length) return;
  const names = ids
    .map((id) => allAttendees.find((a) => a.attendee_id === id)?.name)
    .filter(Boolean);
  const preview = names.slice(0, 3).join(", ") + (names.length > 3 ? ` และอีก ${names.length - 3} คน` : "");
  DeleteModal.open(`ต้องการลบ ${ids.length} คน ออกจากรายชื่อหรือไม่?\n${preview}`, async () => {
    showLoading(true);
    try {
      await Promise.all(ids.map((id) => removeAttendee(id)));
      selectedAttendeeIds.clear();
      showToast(`ลบผู้เข้าร่วม ${ids.length} คน แล้ว`, "success");
      allAttendees = await fetchAttendees(currentEventId);
      updateStats();
      filterTable();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── EXPORT CSV ────────────────────────────────────────────
// ── EXPORT MENU TOGGLE ────────────────────────────────────
window._toggleExportMenu = function (ev) {
  ev?.stopPropagation();
  const menu = document.getElementById("attExportMenu");
  if (!menu) return;
  menu.classList.toggle("open");
};
window._exportPick = function (kind) {
  document.getElementById("attExportMenu")?.classList.remove("open");
  if (kind === "xlsx")  window.exportAttendeesXLSX();
  else if (kind === "pdf")   window.exportAttendeesPDF();
  else if (kind === "print") window.exportAttendeesPrint();
};
// Click outside → close menu
document.addEventListener("click", (e) => {
  if (e.target.closest(".att-export-wrap")) return;
  document.getElementById("attExportMenu")?.classList.remove("open");
});

// ── EXPORT: shared data builder ───────────────────────────
// Returns { ev, title1, dateLine, cols, data, firstQualIdx, lastQualIdx, hasQuals }
async function _buildExportData() {
  const ev = currentEvent || allEvents.find(e => e.event_id === currentEventId) || {};
  const cfg = await fetchEventFieldConfig(currentEventId).catch(() => DEFAULT_FIELD_CONFIG);
  const order = (Array.isArray(cfg.field_order) ? cfg.field_order : DEFAULT_FIELD_ORDER)
    .filter(k => _fieldShowsAsColumn(cfg.fields?.[k]));
  const tailKeys = order.filter(k => k === "cs_staff" || k === "note");
  const midKeys  = order.filter(k => k !== "cs_staff" && k !== "note");
  const quals = (Array.isArray(cfg.qualifications) ? cfg.qualifications : []);
  const customFields = (Array.isArray(cfg.custom_fields) ? cfg.custom_fields : []);
  const stdLabel = (key) => cfg.fields?.[key]?.label || FIELD_LABELS[key] || key;

  const cols = [];
  cols.push({ kind: "index", label: "ลำดับ" });
  cols.push({ kind: "code",  label: "รหัส" });
  cols.push({ kind: "name",  label: "ชื่อ-นามสกุล" });
  midKeys.forEach(k => cols.push({ kind: "std", key: k, label: stdLabel(k) }));
  quals.forEach(q => cols.push({ kind: "qual", key: q.key, label: q.label || q.key }));
  customFields.forEach(c => cols.push({ kind: "custom", key: c.key, label: c.label || c.key }));
  tailKeys.forEach(k => cols.push({ kind: "std", key: k, label: stdLabel(k) }));

  const weekdays = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
  const months   = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  let dateLine = "";
  if (ev.event_date) {
    const d = new Date(ev.event_date + "T00:00:00");
    if (!isNaN(d)) {
      dateLine = `วัน${weekdays[d.getDay()]}ที่ ${String(d.getDate()).padStart(2,"0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
  }
  const title1 = `รายชื่อผู้เรียนคอร์ส ${ev.event_name || ""}`.trim();

  const firstQualIdx = cols.findIndex(c => c.kind === "qual");
  let lastQualIdx = -1;
  for (let i = cols.length - 1; i >= 0; i--) { if (cols[i].kind === "qual") { lastQualIdx = i; break; } }
  const hasQuals = firstQualIdx !== -1;

  const data = allAttendees.map((a, idx) => cols.map(c => {
    switch (c.kind) {
      case "index": return idx + 1;
      case "code":  return a.member_code || "";
      case "name":  return a.name || "";
      case "std": {
        switch (c.key) {
          case "phone":        return a.phone || "";
          case "position":     return a.position_level || "";
          case "upline":       return a.upline_name_text || "";
          case "referrer": {
            const rc = a.extra_fields?.referrer_code || "";
            const rn = a.extra_fields?.referrer_name || "";
            return rc && rn ? `${rc} · ${rn}` : (rc || rn);
          }
          case "cs_staff":     return a.cs_staff || "";
          case "line_name":    return a.line_name_reported || "";
          case "fb_page_name": return a.fb_page_name || "";
          case "had_attended":
            return a.had_attended_before === true ? "เคย"
                 : a.had_attended_before === false ? "ยังไม่เคย" : "";
          case "note":         return a.attendee_note || "";
          default:             return "";
        }
      }
      case "qual": {
        const v = a.extra_fields?.[c.key];
        return v === true ? "TRUE" : v === false ? "FALSE" : "";
      }
      case "custom":
        return a.extra_fields?.[c.key] || "";
      default: return "";
    }
  }));

  return { ev, title1, dateLine, cols, data, firstQualIdx, lastQualIdx, hasQuals };
}

// ── EXPORT → XLSX ─────────────────────────────────────────
window.exportAttendeesXLSX = async function () {
  if (typeof XLSX === "undefined") {
    showToast("Library โหลดไม่สำเร็จ — refresh แล้วลองใหม่", "error");
    return;
  }
  if (!allAttendees.length) {
    showToast("ไม่มีข้อมูลให้ Export", "error");
    return;
  }

  const { ev, title1, dateLine, cols, data, firstQualIdx, lastQualIdx, hasQuals } = await _buildExportData();

  const headerA = cols.map((c, i) => c.kind === "qual" ? (i === firstQualIdx ? "คุณสมบัติ" : "") : c.label);
  const headerB = cols.map(c => c.kind === "qual" ? c.label : "");

  const aoa = [
    [title1],   // row 1
    [dateLine], // row 2
    [],         // row 3 blank
    headerA,    // row 4
  ];
  if (hasQuals) aoa.push(headerB);
  data.forEach(r => aoa.push(r));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastColIdx = cols.length - 1;
  const headerEndRow = hasQuals ? 4 : 3;     // 0-indexed: row 4 + 5 if quals, else row 4
  const dataStartRow = headerEndRow + 1;
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColIdx } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColIdx } },
  ];
  if (hasQuals) {
    merges.push({ s: { r: 3, c: firstQualIdx }, e: { r: 3, c: lastQualIdx } });
    cols.forEach((c, i) => {
      if (c.kind !== "qual") merges.push({ s: { r: 3, c: i }, e: { r: 4, c: i } });
    });
  }
  ws["!merges"] = merges;

  ws["!cols"] = cols.map(c => {
    switch (c.kind) {
      case "index":  return { wch: 6 };
      case "code":   return { wch: 10 };
      case "name":   return { wch: 28 };
      case "qual":   return { wch: 24 };
      case "custom": return { wch: 18 };
      case "std":
        if (c.key === "note") return { wch: 24 };
        if (c.key === "phone") return { wch: 14 };
        if (c.key === "upline") return { wch: 14 };
        if (c.key === "referrer") return { wch: 22 };
        if (c.key === "cs_staff") return { wch: 10 };
        return { wch: 14 };
      default: return { wch: 12 };
    }
  });

  // Row heights — title rows + header rows ให้สูงขึ้นนิด
  ws["!rows"] = [
    { hpt: 26 },                  // row 1 title
    { hpt: 20 },                  // row 2 date
    { hpt: 6 },                   // row 3 blank
    { hpt: hasQuals ? 32 : 22 },  // row 4 header
  ];
  if (hasQuals) ws["!rows"].push({ hpt: 40 }); // row 5 sub-header (qual labels — มักยาว → wrap)

  // ── Cell styles (ต้องการ xlsx-js-style) ─────────────────
  const border = {
    top:    { style: "thin", color: { rgb: "94A3B8" } },
    bottom: { style: "thin", color: { rgb: "94A3B8" } },
    left:   { style: "thin", color: { rgb: "94A3B8" } },
    right:  { style: "thin", color: { rgb: "94A3B8" } },
  };
  const sCenter = { horizontal: "center", vertical: "center", wrapText: true };
  const sLeft   = { horizontal: "left",   vertical: "center", wrapText: true };

  const styleTitle1 = {
    font: { name: "Sarabun", sz: 16, bold: true, color: { rgb: "064E3B" } },
    alignment: sCenter,
    fill: { fgColor: { rgb: "D1FAE5" } }, // sage green pale
  };
  const styleTitle2 = {
    font: { name: "Sarabun", sz: 12, bold: true, color: { rgb: "065F46" } },
    alignment: sCenter,
    fill: { fgColor: { rgb: "ECFDF5" } },
  };
  const styleHeader = {
    font: { name: "Sarabun", sz: 11, bold: true, color: { rgb: "064E3B" } },
    alignment: sCenter,
    fill: { fgColor: { rgb: "A7F3D0" } }, // sage green
    border,
  };
  const styleHeaderQualGroup = {
    font: { name: "Sarabun", sz: 12, bold: true, color: { rgb: "064E3B" } },
    alignment: sCenter,
    fill: { fgColor: { rgb: "6EE7B7" } }, // sage stronger
    border,
  };
  const styleData = (align) => ({
    font: { name: "Sarabun", sz: 11, color: { rgb: "0F172A" } },
    alignment: { horizontal: align, vertical: "center", wrapText: align === "left" },
    border,
  });
  const styleQualTrue = {
    font: { name: "Sarabun", sz: 10.5, bold: true, color: { rgb: "15803D" } },
    alignment: sCenter,
    border,
  };
  const styleQualFalse = {
    font: { name: "Sarabun", sz: 10.5, bold: true, color: { rgb: "B91C1C" } },
    alignment: sCenter,
    border,
  };

  // Apply Title row 1 + 2
  const setCell = (r, c, v, s) => {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!ws[ref]) ws[ref] = { t: "s", v: v ?? "" };
    if (s) ws[ref].s = s;
  };
  setCell(0, 0, title1, styleTitle1);
  setCell(1, 0, dateLine, styleTitle2);

  // Apply header styles
  cols.forEach((c, i) => {
    const isQual = c.kind === "qual";
    const row3v = ws[XLSX.utils.encode_cell({ r: 3, c: i })]?.v ?? "";
    // Row 4 (index 3) — group label "คุณสมบัติ" for first qual, otherwise std header
    if (isQual && i === firstQualIdx) {
      setCell(3, i, "คุณสมบัติ", styleHeaderQualGroup);
    } else {
      setCell(3, i, row3v, styleHeader);
    }
    // Row 5 (index 4) — sub-header (qual labels for qual cols)
    if (hasQuals) {
      const v5 = isQual ? c.label : (ws[XLSX.utils.encode_cell({ r: 4, c: i })]?.v ?? "");
      setCell(4, i, v5, styleHeader);
    }
  });

  // Apply data row styles
  data.forEach((row, ri) => {
    const r = dataStartRow + ri;
    row.forEach((v, ci) => {
      const c = cols[ci];
      let style;
      if (c.kind === "qual") {
        style = v === "TRUE" ? styleQualTrue : v === "FALSE" ? styleQualFalse : styleData("center");
      } else if (c.kind === "index" || c.kind === "code") {
        style = styleData("center");
      } else if (c.kind === "std" && (c.key === "phone" || c.key === "cs_staff" || c.key === "position")) {
        style = styleData("center");
      } else {
        style = styleData("left");
      }
      setCell(r, ci, v, style);
    });
  });

  // Freeze panes — header lock when scrolling
  ws["!freeze"] = { xSplit: 0, ySplit: dataStartRow };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "ผู้เข้าร่วม");
  XLSX.writeFile(wb, _buildExportFilename(ev, "xlsx"));
  showToast(`Export Excel สำเร็จ (${allAttendees.length} คน) 📥`, "success");
};

// ── filename: "{event_name} {DD-MM-YYYY} {HH-MM}.{ext}" ─────
function _buildExportFilename(ev, ext) {
  // sanitize: เอาอักษรที่ Windows ห้ามออก ( < > : " / \ | ? * ) แทนด้วย space
  const safeName = String(ev?.event_name || `event${currentEventId || ""}`)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let datePart = "";
  if (ev?.event_date) {
    const d = new Date(ev.event_date + "T00:00:00");
    if (!isNaN(d)) {
      datePart = `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`;
    }
  }
  let timePart = "";
  if (ev?.start_time) {
    timePart = String(ev.start_time).slice(0, 5).replace(":", "-"); // HH:MM → HH-MM
  }
  return [safeName, datePart, timePart].filter(Boolean).join(" ") + "." + ext;
}

// ── EXPORT → printable HTML (PDF / Print) ─────────────────
async function _openPrintableReport(autoPrint) {
  if (!allAttendees.length) {
    showToast("ไม่มีข้อมูลให้ Export", "error");
    return;
  }
  const { ev, title1, dateLine, cols, data, firstQualIdx, lastQualIdx, hasQuals } = await _buildExportData();

  // Build colgroup
  const colWidth = (c) => {
    switch (c.kind) {
      case "index":  return "40px";
      case "code":   return "70px";
      case "name":   return "180px";
      case "qual":   return "auto";
      case "custom": return "120px";
      case "std":
        if (c.key === "note") return "160px";
        if (c.key === "phone") return "100px";
        if (c.key === "upline") return "100px";
        if (c.key === "referrer") return "150px";
        if (c.key === "cs_staff") return "70px";
        return "90px";
      default: return "auto";
    }
  };
  const colgroupHtml = cols.map(c => `<col style="width:${colWidth(c)}">`).join("");

  // Header rows
  let headerHtml = "";
  if (hasQuals) {
    const rowA = cols.map((c, i) => {
      if (c.kind === "qual") {
        if (i === firstQualIdx) {
          const span = lastQualIdx - firstQualIdx + 1;
          return `<th colspan="${span}">คุณสมบัติ</th>`;
        }
        return "";
      }
      return `<th rowspan="2">${escapeHtml(c.label)}</th>`;
    }).join("");
    const rowB = cols.filter(c => c.kind === "qual")
      .map(c => `<th>${escapeHtml(c.label)}</th>`).join("");
    headerHtml = `<tr>${rowA}</tr><tr>${rowB}</tr>`;
  } else {
    headerHtml = `<tr>${cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  }

  const bodyHtml = data.map(r => {
    return `<tr>${r.map((v, i) => {
      const c = cols[i];
      let cls = "";
      let txt = String(v ?? "");
      if (c.kind === "qual") {
        if (v === "TRUE")  { cls = "qv-true";  txt = "✓"; }
        else if (v === "FALSE") { cls = "qv-false"; txt = "✕"; }
        else txt = "";
      }
      if (c.kind === "index" || c.kind === "code" || c.kind === "qual" || c.kind === "custom") cls += " ta-c";
      return `<td class="${cls.trim()}">${escapeHtml(txt)}</td>`;
    }).join("")}</tr>`;
  }).join("");

  const sheetTitle = `${title1} — ${dateLine}`;
  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>${escapeHtml(sheetTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Sarabun","Noto Sans Thai",sans-serif; color:#0f172a; margin:0; padding:14px 18px; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; font-weight: 700; }
  h2 { font-size: 13px; text-align: center; margin: 0 0 14px; font-weight: 500; color:#475569; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
  th, td { border: 1px solid #94a3b8; padding: 5px 6px; vertical-align: middle; word-break: break-word; }
  thead th { background: #d1fae5; color:#064e3b; font-weight: 700; text-align: center; font-size: 11px; line-height: 1.25; }
  tbody td { font-size: 11.5px; }
  tbody tr:nth-child(even) td { background:#f8fafc; }
  .ta-c { text-align: center; }
  .qv-true  { color:#15803d; font-weight: 600; }
  .qv-false { color:#b91c1c; font-weight: 600; }
  .toolbar { position: sticky; top: 0; background:#fff; padding: 8px 0 14px; display:flex; gap:8px; justify-content:flex-end; border-bottom:1px solid #e2e8f0; margin-bottom:14px; }
  .toolbar button { padding:7px 14px; border-radius:6px; border:1px solid #94a3b8; background:#fff; cursor:pointer; font-family:inherit; font-size:12px; font-weight:600; }
  .toolbar button.primary { background:#0f766e; color:#fff; border-color:#0f766e; }
  @media print {
    .toolbar { display:none; }
    body { padding: 0; }
    h1 { font-size: 14px; }
    h2 { font-size: 11px; margin-bottom: 8px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">🖨️ พิมพ์ / Save as PDF</button>
    <button onclick="window.close()">ปิด</button>
  </div>
  <h1>${escapeHtml(title1)}</h1>
  <h2>${escapeHtml(dateLine)}</h2>
  <table>
    <colgroup>${colgroupHtml}</colgroup>
    <thead>${headerHtml}</thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  <script>
    ${autoPrint ? "window.addEventListener('load', () => setTimeout(() => window.print(), 300));" : ""}
  </script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=1200,height=800");
  if (!w) {
    showToast("เบราว์เซอร์บล็อก popup — อนุญาต popup สำหรับหน้านี้ก่อน", "error");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

window.exportAttendeesPDF = async function () {
  await _openPrintableReport(true); // auto-trigger print dialog (user เลือก Save as PDF)
  showToast("เปิดหน้าพิมพ์/บันทึก PDF · เลือก 'Save as PDF' ใน dialog", "info");
};
window.exportAttendeesPrint = async function () {
  await _openPrintableReport(true);
  showToast("เปิดหน้าพิมพ์ — เลือกเครื่องพิมพ์ใน dialog 🖨️", "info");
};

// Keep legacy CSV export for compat (called nowhere now but window-exposed)
window.exportCSV = function () {
  if (!allAttendees.length) {
    showToast("ไม่มีข้อมูลให้ Export", "error");
    return;
  }
  const headers = [
    "Ticket No",
    "ชื่อ",
    "อีเมล",
    "โทร",
    "รหัสสมาชิก",
    "ตำแหน่งสูงสุด",
    "ชำระ",
    "ยอด(฿)",
    "Check-in",
    "เวลา Check-in",
  ];
  const rows = allAttendees.map((a) => [
    a.ticket_no || "",
    a.name || "",
    a.email || "",
    a.phone || "",
    a.member_code || "",
    a.position_level || "",
    payLabel(a.payment_status),
    a.paid_amount || 0,
    a.checked_in ? "Yes" : "No",
    a.check_in_at ? formatDateTime(a.check_in_at) : "",
  ]);

  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ev = allEvents.find((e) => e.event_id === currentEventId);
  a.href = url;
  a.download = `attendees_${ev?.event_code || currentEventId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Export CSV สำเร็จ 📥", "success");
};

// ── HELPERS ───────────────────────────────────────────────
function payLabel(s) {
  return (
    {
      PAID: "💳 ชำระแล้ว",
      UNPAID: "⏳ ยังไม่ชำระ",
      EXPIRED: "⌛ เกินกำหนด",
      COMPLIMENTARY: "🎫 ฟรี / ยกเว้น",
    }[s] ||
    s ||
    "—"
  );
}
function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function formatDateTime(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

// ── ENFORCE REGISTRATION RULES ──────────────────────────────
let _currentEvent = null;

async function _loadCurrentEvent() {
  if (_currentEvent && _currentEvent.event_id === currentEventId) return _currentEvent;
  try {
    const rows = await sbFetch("events", `?event_id=eq.${currentEventId}&select=*&limit=1`);
    _currentEvent = rows?.[0] || null;
  } catch { _currentEvent = null; }
  return _currentEvent;
}

async function _enforceRegistration(payload) {
  const ev = await _loadCurrentEvent();
  if (!ev) return false;

  // 1. Check max_attendees
  if (ev.max_attendees && ev.max_attendees > 0) {
    const currentCount = allAttendees.length;
    if (currentCount >= ev.max_attendees) {
      showToast(`❌ เต็มแล้ว — จำกัด ${ev.max_attendees} คน (ลงทะเบียนแล้ว ${currentCount})`, "error");
      return true;
    }
  }

  // 1b. Check tier seat_limit (ถ้ามี tier_id + tier กำหนด limit)
  if (payload.tier_id) {
    const tier = currentTiersById[payload.tier_id];
    if (tier?.seat_limit && tier.seat_limit > 0) {
      const usedInTier = allAttendees.filter((a) => a.tier_id === tier.tier_id).length;
      if (usedInTier >= tier.seat_limit) {
        showToast(`❌ Tier "${tier.tier_name}" เต็มแล้ว (${tier.seat_limit} ที่นั่ง)`, "error");
        return true;
      }
    }
  }

  // 2. Check members_only
  if (ev.members_only && !payload.member_code) {
    showToast("❌ Event นี้สำหรับสมาชิก A4S เท่านั้น — กรุณาเลือกสมาชิกก่อน", "error");
    return true;
  }

  // 2.5 Check duplicate member registration (same event, same member_code + person_role)
  // (รหัสเดียวกันลง primary + co_applicant ได้ = 2 คน)
  if (payload.member_code) {
    const role = payload.person_role || "primary";
    const dup = allAttendees.find(a => a.member_code === payload.member_code && (a.person_role || "primary") === role);
    if (dup) {
      const roleLabel = role === "co_applicant" ? " (ผู้สมัครร่วม)" : "";
      showToast(`❌ สมาชิก ${payload.member_code}${roleLabel} (${dup.name}) ลงทะเบียนแล้ว — Ticket: ${dup.ticket_no || "—"}`, "error");
      return true;
    }
  }

  // 3. Check prerequisite (if member selected + event has series/level)
  if (payload.member_code && ev.series_id && ev.level_id) {
    try {
      const { url, key } = getSB();
      const h = { apikey: key, Authorization: `Bearer ${key}` };

      // Get level → prerequisite
      const lvRes = await fetch(`${url}/rest/v1/course_levels?select=*&id=eq.${ev.level_id}`, { headers: h });
      const lvRows = lvRes.ok ? await lvRes.json() : [];
      const level = lvRows[0];

      if (level?.prerequisite_level_id) {
        // Get prerequisite level name
        const prRes = await fetch(`${url}/rest/v1/course_levels?select=*&id=eq.${level.prerequisite_level_id}`, { headers: h });
        const prereqLevel = (prRes.ok ? await prRes.json() : [])[0];

        // Check if member passed prerequisite
        const attRes = await fetch(`${url}/rest/v1/event_attendees?select=attendee_id,event_id&member_code=eq.${payload.member_code}&checked_in=eq.true`, { headers: h });
        const attended = attRes.ok ? await attRes.json() : [];

        let passed = false;
        if (attended.length) {
          const eventIds = attended.map(a => a.event_id).join(',');
          const evCheck = await fetch(`${url}/rest/v1/events?select=event_id&series_id=eq.${ev.series_id}&level_id=eq.${level.prerequisite_level_id}&event_id=in.(${eventIds})`, { headers: h });
          passed = (evCheck.ok ? await evCheck.json() : []).length > 0;
        }

        if (!passed) {
          showToast(`❌ ยังไม่ผ่าน prerequisite — ต้องเรียน ${prereqLevel?.level_name || 'level ก่อนหน้า'} ก่อน`, "error");
          return true;
        }
      }
    } catch (e) {
      console.warn('prereq check:', e);
    }
  }

  return false; // not blocked
}

// ── MEMBER SEARCH + PREREQUISITE CHECK ─────────────────────
let _memberSearchTimer = null;
let _memberSearchAbort = null;   // cancel in-flight request when user types more

let _lastMemberResults = [];
let _pendingPartner = null;   // คู่ผู้สมัครร่วม → จะ trigger เปิด form ต่อหลัง primary save
let _memberHighlight = 0;

function _positionSuggestUnderActiveRow() {
  if (!activeSearchRowId) return;
  const input = document.querySelector(`tr[data-nrid="${activeSearchRowId}"] input[data-role="search"]`);
  const sug = document.getElementById("memberSuggest");
  if (!input || !sug) return;
  const rect = input.getBoundingClientRect();
  // กว้างพอให้ชื่อยาวๆ + role chip + ตำแหน่ง + ประเทศ ไม่ตก/ไม่ wrap
  const desiredWidth = Math.max(rect.width, 520);
  // กันล้นขอบขวา viewport
  const maxWidth = Math.min(desiredWidth, window.innerWidth - rect.left - 16);
  sug.style.top = (rect.bottom + window.scrollY + 2) + "px";
  sug.style.left = (rect.left + window.scrollX) + "px";
  sug.style.width = maxWidth + "px";
}

window.searchMember = function (q, rowId) {
  if (rowId) activeSearchRowId = rowId;
  clearTimeout(_memberSearchTimer);
  // cancel any in-flight request — กัน race condition + กัน response เก่าทับ state ใหม่
  if (_memberSearchAbort) { try { _memberSearchAbort.abort(); } catch {} }
  const sug = document.getElementById("memberSuggest");
  q = (q || "").trim();
  if (!q) { sug.style.display = "none"; _lastMemberResults = []; return; }

  // Show loading state
  sug.innerHTML = '<div style="padding:10px 12px;color:var(--text3,#94a3b8);font-size:12px">🔍 กำลังค้นหา...</div>';
  sug.style.display = "block";
  _positionSuggestUnderActiveRow();

  _memberSearchTimer = setTimeout(async () => {
    // Strip SQL ilike wildcards + PostgREST reserved chars → safe value
    // ก่อนหน้านี้ strip แค่ ,()*  → ตอนนี้ strip %, _, \ ด้วย กัน ilike pattern confuse
    const esc = q.replace(/[,()*%_\\]/g, '');
    if (!esc) {
      sug.innerHTML = '<div style="padding:10px 12px;color:var(--text3);font-size:12px">พิมพ์ตัวอักษรหรือเลขรหัส</div>';
      return;
    }
    const isDigits = /^\d+$/.test(esc);
    const { url, key } = getSB();
    // ⭐ ทุกค่าใน URL ต้อง encodeURIComponent (กัน space/Thai/พิเศษ → 500)
    const filter = isDigits
      ? `member_code=eq.${encodeURIComponent(esc)}`
      : `person_name=ilike.${encodeURIComponent('*' + esc + '*')}`;
    const apiUrl = `${url}/rest/v1/member_persons?select=member_code,person_role,person_name,phone,country_code,position_level,is_company&${filter}&limit=12&order=member_code,person_role`;
    const opts = { headers: { apikey: key, Authorization: `Bearer ${key}` } };

    // ── Retry on 500 (server timeout) — ลองสูงสุด 2 ครั้ง ─────────
    const tryOnce = async (attempt) => {
      _memberSearchAbort = new AbortController();
      const res = await fetch(apiUrl, { ...opts, signal: _memberSearchAbort.signal });
      if (res.ok) return res;
      if (res.status >= 500 && attempt < 2) {
        const errText = await res.text().catch(() => '');
        console.warn(`searchMember 500 (attempt ${attempt}):`, errText);
        await new Promise(r => setTimeout(r, 300));   // brief backoff
        return tryOnce(attempt + 1);
      }
      const errText = await res.text().catch(() => '');
      console.warn('searchMember API error:', res.status, errText);
      throw new Error(`${res.status}`);
    };

    try {
      const res = await tryOnce(1);
      const rows = await res.json();
      _memberSearchAbort = null;
      if (!rows || !rows.length) {
        _lastMemberResults = [];
        sug.innerHTML = `
          <div style="padding:10px 12px;color:var(--text3,#94a3b8);font-size:12px;border-bottom:1px solid #e2e8f0">ไม่พบสมาชิก</div>
          ${_guestAddRowHtml()}
        `;
        return;
      }
      _lastMemberResults = rows;
      _memberHighlight = 0;
      _renderMemberSuggest();
    } catch (e) {
      if (e.name === "AbortError") return;   // user typed more → silent
      const msg = /^\d+$/.test(e.message || "")
        ? `เซิร์ฟเวอร์ตอบช้า (${e.message}) — ลองพิมพ์ใหม่อีกครั้ง`
        : (e.message || 'error');
      sug.innerHTML = `
        <div style="padding:10px 12px;color:#dc2626;font-size:12px;border-bottom:1px solid #e2e8f0">⚠️ ${escapeHtml(msg)}</div>
        ${_guestAddRowHtml()}
      `;
    }
  }, 280);
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Detect pair: 2 results, same member_code, primary + co_applicant
function _detectPairFromResults(results) {
  if (!results || results.length !== 2) return null;
  const [a, b] = results;
  if (a.member_code !== b.member_code) return null;
  const primary = results.find((r) => r.person_role !== "co_applicant");
  const coapp = results.find((r) => r.person_role === "co_applicant");
  if (!primary || !coapp) return null;
  return { primary, coapp, code: a.member_code };
}

function _renderMemberSuggest() {
  const sug = document.getElementById("memberSuggest");
  if (!_lastMemberResults.length) { sug.style.display = "none"; return; }
  _positionSuggestUnderActiveRow();
  const rowsHtml = _lastMemberResults.map((m, i) => {
    const name = m.person_name || '—';
    const safeName = escapeHtml(name).replace(/'/g, "&#39;");
    const role = m.person_role || 'primary';
    const hl = i === _memberHighlight;
    const bg = hl ? '#dbeafe' : 'transparent';
    const roleChip = role === 'co_applicant'
      ? `<span style="font-size:10.5px;color:#9333ea;background:#f3e8ff;padding:1px 6px;border-radius:4px;font-weight:700" title="ผู้สมัครร่วม">👥 ผู้สมัครร่วม</span>`
      : (m.is_company
          ? `<span style="font-size:10.5px;color:#1e40af;background:#dbeafe;padding:1px 6px;border-radius:4px;font-weight:700" title="บุคคลธรรมดาของบริษัท">🏢 บุคคลธรรมดา</span>`
          : '');
    return `<div data-idx="${i}" onclick="selectMember('${m.member_code}','${role}','${safeName}','${m.phone||''}','${m.position_level||''}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border,#e2e8f0);font-size:12.5px;transition:background .1s;display:flex;align-items:center;gap:8px;background:${bg}" onmouseover="window._setMemberHL(${i})" onmouseout="">
      <span style="font-family:'IBM Plex Mono',monospace;color:#1e40af;font-weight:700;background:#dbeafe;padding:2px 7px;border-radius:5px;font-size:11.5px">${m.member_code}</span>
      <span style="flex:1;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</span>
      ${roleChip}
      ${m.position_level ? `<span style="font-size:10.5px;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:4px;font-weight:700">⭐ ${escapeHtml(m.position_level)}</span>` : ''}
      ${m.country_code ? `<span style="font-size:10.5px;color:var(--text3,#94a3b8);background:#f1f5f9;padding:1px 6px;border-radius:4px">${m.country_code}</span>` : ''}
    </div>`;
  }).join('');

  // ถ้าเป็นคู่ (primary + co_applicant ใน member_code เดียวกัน) → เพิ่มแถว "เพิ่มทั้ง 2 คน"
  const pair = _detectPairFromResults(_lastMemberResults);
  const pairRow = pair
    ? `<div onclick="window.selectBothMembers()" style="padding:11px 12px;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:8px;background:linear-gradient(90deg,#eef2ff,#f3e8ff);border-top:2px solid #c7d2fe;font-weight:700;color:#4338ca" onmouseover="this.style.background='linear-gradient(90deg,#dbeafe,#e9d5ff)'" onmouseout="this.style.background='linear-gradient(90deg,#eef2ff,#f3e8ff)'">
      <span style="font-size:18px">👫</span>
      <span style="flex:1">เพิ่มทั้ง 2 คน — QR ใช้ร่วมกัน</span>
      <span style="font-size:10.5px;color:#6366f1;background:#fff;padding:2px 7px;border-radius:5px;border:1px solid #c7d2fe">2 รายการ</span>
    </div>`
    : '';

  // เจอสมาชิก → ไม่ต้องขึ้นปุ่ม "เพิ่ม guest" (ลด clutter · user จะเลือกจากผลที่พบ)
  sug.innerHTML = rowsHtml + pairRow;
  sug.style.display = "block";
}

// Footer row: "➕ เพิ่มผู้เรียนใหม่ (ยังไม่ใช่สมาชิก)" → opens guest form modal
function _guestAddRowHtml() {
  return `<div onclick="window.openGuestFormFromSearch(window._activeSearchRowIdForGuest())"
    style="padding:11px 12px;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:8px;background:linear-gradient(90deg,#fef3c7,#fde68a);border-top:2px solid #fcd34d;font-weight:700;color:#78350f"
    onmouseover="this.style.background='linear-gradient(90deg,#fde68a,#fcd34d)'"
    onmouseout="this.style.background='linear-gradient(90deg,#fef3c7,#fde68a)'">
    <span style="font-size:16px">➕</span>
    <span style="flex:1">เพิ่มผู้เรียนใหม่ (ยังไม่ใช่สมาชิก)</span>
    <span style="font-size:10.5px;color:#92400e;background:#fff;padding:2px 7px;border-radius:5px;border:1px solid #fcd34d">guest</span>
  </div>`;
}

// Expose activeSearchRowId for onclick handler (avoid quoting issues in template)
window._activeSearchRowIdForGuest = function () { return activeSearchRowId; };

window._setMemberHL = function (i) {
  _memberHighlight = i;
  // Update background ตรงๆ ไม่ re-render (กัน DOM ถูกทำลายระหว่าง mousedown→mouseup → click หลุด)
  const sug = document.getElementById("memberSuggest");
  if (!sug) return;
  sug.querySelectorAll("[data-idx]").forEach(el => {
    el.style.background = (parseInt(el.dataset.idx, 10) === i) ? '#dbeafe' : 'transparent';
  });
};

window._onMemberSearchKey = function (ev) {
  const sug = document.getElementById("memberSuggest");
  const open = sug && sug.style.display !== "none" && _lastMemberResults.length;
  if (ev.key === "Escape") {
    if (open) { ev.preventDefault(); sug.style.display = "none"; }
    return;
  }
  if (!open) return;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    _memberHighlight = (_memberHighlight + 1) % _lastMemberResults.length;
    _renderMemberSuggest();
    _scrollHighlightIntoView();
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    _memberHighlight = (_memberHighlight - 1 + _lastMemberResults.length) % _lastMemberResults.length;
    _renderMemberSuggest();
    _scrollHighlightIntoView();
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    ev.stopPropagation();
    const m = _lastMemberResults[_memberHighlight];
    if (m) {
      const name = m.person_name || '—';
      window.selectMember(m.member_code, m.person_role || 'primary', name, m.phone || '', m.position_level || '');
    }
  }
};

function _scrollHighlightIntoView() {
  const sug = document.getElementById("memberSuggest");
  const el = sug?.querySelector(`[data-idx="${_memberHighlight}"]`);
  if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}

window.selectMember = function (code, role, name, phone, positionLevel) {
  document.getElementById("memberSuggest").style.display = "none";
  _lastMemberResults = [];
  if (!activeSearchRowId) return;
  const rowId = activeSearchRowId;
  const r0 = role || "primary";

  // Duplicate check ก่อนเพิ่ม
  const dup = allAttendees.find(a =>
    a.member_code === code && (a.person_role || "primary") === r0
  );
  if (dup) {
    const roleLabel = (r0 === "co_applicant") ? " (ผู้สมัครร่วม)" : "";
    showToast(`❌ สมาชิก ${code}${roleLabel} (${dup.name}) ลงทะเบียนแล้ว — Ticket: ${dup.ticket_no || "—"}`, "error");
    return;
  }

  // ⚡ เพิ่มลงตารางทันที (inline) — ไม่เปิด popup ฟอร์ม
  const r = _findRow(rowId);
  if (!r) return;
  r.memberCode    = code;
  r.personRole    = r0;
  r.name          = name;
  r.phone         = phone || "";
  r.positionLevel = positionLevel || "";
  window.saveNewRow(rowId);
};

// เพิ่มผู้เข้าร่วมหลายคนลงตารางตรงๆ (inline · ไม่เปิด popup) — ใช้กับ selectMember/selectBothMembers
async function _quickAddMembers(members, paymentStatus, sourceRowId) {
  if (!members.length) return;
  if (await _requireTemplateOrPrompt()) return;
  const activeTier = getActiveTier();
  const price = getCurrentPrice();
  const grace = getEventGraceDays();
  const needsPayment = (paymentStatus || "UNPAID") === "UNPAID";
  let added = 0;
  try {
    for (const mb of members) {
      const payload = {
        event_id: currentEventId,
        name: mb.name,
        phone: mb.phone || null,
        position_level: mb.positionLevel || null,
        paid_amount: price,
        payment_status: paymentStatus || "UNPAID",
        member_code: mb.memberCode || null,
        person_role: mb.memberCode ? (mb.personRole || "primary") : "guest",
        tier_id: activeTier?.tier_id || null,
        payment_deadline: needsPayment ? computeDeadlineISO(grace) : null,
        checked_in: _autoCheckin ? true : false,
        check_in_at: _autoCheckin ? buildCheckinTimestamp() : null,
      };
      const blocked = await _enforceRegistration(payload);
      if (blocked) break;
      payload.ticket_no = await generateTicketNo(currentEventId);
      await createAttendee(payload);
      added++;
    }
    if (added) showToast(`เพิ่มแล้ว ${added} คน 👥`, "success");
    if (sourceRowId) newRows = newRows.filter(x => x.id !== sourceRowId);
    ensureTrailingEmptyRow();
    allAttendees = await fetchAttendees(currentEventId);
    _searchKeyword = "";
    populateTagFilter();
    updateStats();
    filterTable();   // แสดงทันที
    computeUplineMatches().then(() => { if (currentEventId) { updateStats(); filterTable(); } }).catch(() => {});
    requestAnimationFrame(() => {
      const input = document.querySelector("tr.new-row input[data-role='search']");
      input?.focus();
    });
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + (e.message || e), "error");
  }
}

// เพิ่มทั้ง primary + co_applicant ที่ใช้ member_code เดียวกัน — QR ใช้ร่วมกัน (เพิ่มลงตารางตรงๆ)
window.selectBothMembers = function () {
  const pair = _detectPairFromResults(_lastMemberResults);
  if (!pair || !activeSearchRowId) return;
  document.getElementById("memberSuggest").style.display = "none";
  _lastMemberResults = [];

  const { primary, coapp } = pair;
  const rowId = activeSearchRowId;
  const r = _findRow(rowId);
  const paymentStatus = r?.paymentStatus || "UNPAID";

  // Duplicate check ทั้ง 2 คนล่วงหน้า — กันให้กรอก primary เสร็จแล้วเจอ coapp ซ้ำ
  const dupPrim = allAttendees.find(a =>
    a.member_code === primary.member_code && (a.person_role || "primary") === "primary"
  );
  if (dupPrim) {
    showToast(`❌ สมาชิก ${primary.member_code} (${dupPrim.name}) ลงทะเบียนแล้ว — Ticket: ${dupPrim.ticket_no || "—"}`, "error");
    return;
  }
  const dupCo = allAttendees.find(a =>
    a.member_code === coapp.member_code && (a.person_role || "primary") === "co_applicant"
  );
  if (dupCo) {
    showToast(`❌ ผู้สมัครร่วม ${coapp.member_code} (${dupCo.name}) ลงทะเบียนแล้ว — Ticket: ${dupCo.ticket_no || "—"}`, "error");
    return;
  }

  // เพิ่มทั้งคู่ลงตารางตรงๆ (ไม่เปิด popup) — QR ใช้ร่วมกันอัตโนมัติจาก member_code เดียวกัน
  _quickAddMembers([
    { memberCode: primary.member_code, personRole: "primary",
      name: primary.person_name || "", phone: primary.phone || "", positionLevel: primary.position_level || "" },
    { memberCode: coapp.member_code, personRole: "co_applicant",
      name: coapp.person_name || "", phone: coapp.phone || "", positionLevel: coapp.position_level || "" },
  ], paymentStatus, rowId);
};

// Close member suggest on click outside any new-row search input
document.addEventListener("click", (e) => {
  const sug = document.getElementById("memberSuggest");
  if (!sug) return;
  if (e.target.closest("#memberSuggest")) return;
  if (e.target.matches("tr.new-row input[data-role='search']")) return;
  sug.style.display = "none";
});

// Reposition dropdown on scroll/resize
window.addEventListener("scroll", () => {
  const sug = document.getElementById("memberSuggest");
  if (sug && sug.style.display !== "none") _positionSuggestUnderActiveRow();
}, true);
window.addEventListener("resize", () => {
  const sug = document.getElementById("memberSuggest");
  if (sug && sug.style.display !== "none") _positionSuggestUnderActiveRow();
});

// ============================================================
// ── TAG CATEGORIES + ATTENDEE TAGS ─────────────────────────
// Categories = master list per event (event_tag_categories table)
// Attendee tags = subset of category names (text[] บน event_attendees.tags)
// ============================================================
function populateTagFilter() {
  // Category-based filter dropdown (รวม category ที่ attendee อาจไม่ใช้แล้ว)
  const sel = document.getElementById("filterTag");
  if (!sel) return;
  const current = sel.value;
  const opts = currentTagCategories
    .map((c) => `<option value="${escapeHtml(c.tag_name)}">${escapeHtml(c.tag_name)}</option>`)
    .join("");
  sel.innerHTML = '<option value="">🏷️ ทุก tag</option>' + opts;
  if (current && currentTagCategories.some((c) => c.tag_name === current)) {
    sel.value = current;
  }
}

window.removeAttendeeTag = async function (attendeeId, tag) {
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  if (!a) return;
  const next = (a.tags || []).filter((t) => t !== tag);
  try {
    await updateAttendee(attendeeId, { tags: next.length ? next : null });
    a.tags = next;
    filterTable();
    showToast(`- tag "${tag}"`, "success");
  } catch (e) {
    showToast("ลบ tag ไม่สำเร็จ: " + e.message, "error");
  }
};

// ── TAG PICKER POPOVER (เลือกจาก categories ของ event) ────
let _tagPickerAttId = null;
window.openTagPicker = function (attendeeId, anchorEl) {
  const pop = document.getElementById("tagPickerPopover");
  if (!pop) return;
  _tagPickerAttId = attendeeId;
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  const used = new Set(a?.tags || []);
  const list = document.getElementById("tagPickerList");
  const empty = document.getElementById("tagPickerEmpty");
  if (!currentTagCategories.length) {
    list.innerHTML = "";
    empty.style.display = "block";
  } else {
    empty.style.display = "none";
    list.innerHTML = currentTagCategories
      .map((c) => {
        const disabled = used.has(c.tag_name);
        const colorCls = `tag-color-${TAG_COLOR_PRESETS.includes(c.color) ? c.color : "yellow"}`;
        const detail = (c.detail || "").trim();
        return `<div class="tag-picker-item ${disabled ? "disabled" : ""}"
          data-name="${escapeHtml(c.tag_name)}"
          data-detail="${escapeHtml(detail)}"
          ${disabled ? "" : `onclick="window.pickTagFromCategory('${escapeJS(c.tag_name)}')"`}
          onmouseenter="window._showTagPickerSide(this)">
          <span class="tag-cat-preview ${colorCls}">${escapeHtml(c.tag_name)}</span>
          ${disabled ? '<span style="font-size:10px;color:var(--text3);margin-left:auto">มีแล้ว</span>' : ""}
          ${detail ? '<span class="tag-picker-info" title="มีรายละเอียด">ℹ️</span>' : ""}
        </div>`;
      })
      .join("");
    // Reset side panel
    _resetTagPickerSide();
  }
  // Position popover under anchor
  const rect = anchorEl.getBoundingClientRect();
  pop.style.display = "block";
  pop.style.top = (window.scrollY + rect.bottom + 4) + "px";
  pop.style.left = (window.scrollX + rect.left) + "px";
  // Close on outside click — remove any prior listener first to avoid stacking
  document.removeEventListener("click", _tagPickerOutside, true);
  setTimeout(() => document.addEventListener("click", _tagPickerOutside, true), 0);
};
function _tagPickerOutside(e) {
  const pop = document.getElementById("tagPickerPopover");
  if (!pop) return;
  if (!pop.contains(e.target)) {
    pop.style.display = "none";
    document.removeEventListener("click", _tagPickerOutside, true);
  }
}
function _resetTagPickerSide() {
  const hdr = document.getElementById("tagPickerSideHdr");
  const body = document.getElementById("tagPickerSideBody");
  if (hdr) hdr.textContent = "รายละเอียด";
  if (body) {
    body.textContent = "— hover ที่ tag เพื่อดูรายละเอียด —";
    body.classList.add("empty");
  }
}
window._showTagPickerSide = function (el) {
  const name = el.getAttribute("data-name") || "";
  const detail = el.getAttribute("data-detail") || "";
  const hdr = document.getElementById("tagPickerSideHdr");
  const body = document.getElementById("tagPickerSideBody");
  if (hdr) hdr.textContent = name || "รายละเอียด";
  if (body) {
    if (detail) {
      body.textContent = detail;
      body.classList.remove("empty");
    } else {
      body.textContent = "ยังไม่มีรายละเอียดสำหรับ tag นี้";
      body.classList.add("empty");
    }
  }
};

window.pickTagFromCategory = async function (tagName) {
  const id = _tagPickerAttId;
  document.getElementById("tagPickerPopover").style.display = "none";
  if (!id) return;
  const a = allAttendees.find((x) => x.attendee_id === id);
  if (!a) return;
  const current = a.tags || [];
  if (current.includes(tagName)) return;
  const next = [...current, tagName];
  try {
    await updateAttendee(id, { tags: next });
    a.tags = next;
    filterTable();
    showToast(`+ tag "${tagName}" 🏷️`, "success");
  } catch (e) {
    showToast("เพิ่ม tag ไม่สำเร็จ: " + e.message, "error");
  }
};
window.closeTagPickerAndOpenManage = function () {
  document.getElementById("tagPickerPopover").style.display = "none";
  window.openTagCategoriesModal();
};

// ── TAG CATEGORIES — MANAGEMENT MODAL ─────────────────────
window.openTagCategoriesModal = function () {
  if (!currentEventId) {
    showToast("เลือกกิจกรรมก่อน", "error");
    return;
  }
  const m = document.getElementById("tagCatModal");
  if (!m) return;
  document.getElementById("tagCatEventName").textContent =
    currentEvent ? `· ${currentEvent.event_name}` : "";
  document.getElementById("tagCatNewName").value = "";
  const detailEl = document.getElementById("tagCatNewDetail");
  if (detailEl) detailEl.value = "";
  _tagCatNewColor = "yellow";
  _renderTagCatColorPicker();
  _renderTagCatList();
  m.classList.add("open");
};
window.closeTagCategoriesModal = function () {
  document.getElementById("tagCatModal")?.classList.remove("open");
};

function _renderTagCatColorPicker() {
  const wrap = document.getElementById("tagCatColorPicker");
  if (!wrap) return;
  wrap.innerHTML = TAG_COLOR_PRESETS.map((c) =>
    `<div class="tag-color-swatch sw-${c} ${c === _tagCatNewColor ? "selected" : ""}"
       title="${c}" onclick="window.pickTagCatNewColor('${c}')"></div>`,
  ).join("");
}
window.pickTagCatNewColor = function (c) {
  _tagCatNewColor = c;
  _renderTagCatColorPicker();
};

function _tagCatUsageCount(name) {
  return allAttendees.filter((a) => (a.tags || []).includes(name)).length;
}

function _renderTagCatList() {
  const wrap = document.getElementById("tagCatList");
  const countEl = document.getElementById("tagCatCount");
  if (!wrap) return;
  countEl.textContent = currentTagCategories.length;
  if (!currentTagCategories.length) {
    wrap.innerHTML = `<div class="tag-cat-empty">ยังไม่มีหมวด — เพิ่มหมวดแรกที่ช่องด้านบน</div>`;
    return;
  }
  wrap.innerHTML = currentTagCategories
    .map((c) => {
      const colorCls = `tag-color-${TAG_COLOR_PRESETS.includes(c.color) ? c.color : "yellow"}`;
      const used = _tagCatUsageCount(c.tag_name);
      const swatches = TAG_COLOR_PRESETS.map((p) =>
        `<div class="tag-color-swatch sw-${p} ${p === c.color ? "selected" : ""}"
          title="${p}" onclick="window.changeTagCatColor(${c.tag_category_id},'${p}')"></div>`,
      ).join("");
      const detailPreview = (c.detail || "").trim()
        ? escapeHtml(c.detail.length > 60 ? c.detail.slice(0, 60) + "…" : c.detail)
        : '<span style="color:var(--text3);font-style:italic">ยังไม่มีรายละเอียด</span>';
      return `<div class="tag-cat-item-wrap">
        <div class="tag-cat-item">
          <span class="tag-cat-preview ${colorCls}" data-cat-id="${c.tag_category_id}">${escapeHtml(c.tag_name)}</span>
          <span class="tag-cat-usage">${used} คน</span>
          <div class="tag-color-picker" style="gap:3px">${swatches}</div>
          <div class="tag-cat-actions">
            <button class="tag-cat-btn" onclick="window.toggleTagCatDetail(${c.tag_category_id})" title="แก้รายละเอียด">📝</button>
            <button class="tag-cat-btn" onclick="window.renameTagCat(${c.tag_category_id})" title="เปลี่ยนชื่อ">✏️</button>
            <button class="tag-cat-btn danger" onclick="window.askDeleteTagCat(${c.tag_category_id})" title="ลบ">🗑</button>
          </div>
        </div>
        <div class="tag-cat-detail-preview" id="tagCatDetailPrev_${c.tag_category_id}">${detailPreview}</div>
        <div class="tag-cat-detail-edit" id="tagCatDetailEdit_${c.tag_category_id}" style="display:none">
          <textarea class="form-input" id="tagCatDetailInput_${c.tag_category_id}" rows="3" maxlength="800"
            placeholder="รายละเอียดที่ส่งทาง LINE ตอน check-in"
            style="width:100%;padding:7px 10px;font-size:12.5px;line-height:1.5;resize:vertical">${escapeHtml(c.detail || "")}</textarea>
          <div class="tag-cat-detail-btns">
            <button class="tag-cat-detail-btn cancel" onclick="window.cancelTagCatDetailEdit(${c.tag_category_id})">ยกเลิก</button>
            <button class="tag-cat-detail-btn save" onclick="window.saveTagCatDetail(${c.tag_category_id})">💾 บันทึก</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

window.toggleTagCatDetail = function (id) {
  const prev = document.getElementById(`tagCatDetailPrev_${id}`);
  const edit = document.getElementById(`tagCatDetailEdit_${id}`);
  if (!prev || !edit) return;
  const opening = edit.style.display === "none";
  prev.style.display = opening ? "none" : "block";
  edit.style.display = opening ? "block" : "none";
  if (opening) {
    const input = document.getElementById(`tagCatDetailInput_${id}`);
    input?.focus();
  }
};

window.cancelTagCatDetailEdit = function (id) {
  const cat = currentTagCategories.find((c) => c.tag_category_id === id);
  const input = document.getElementById(`tagCatDetailInput_${id}`);
  if (input && cat) input.value = cat.detail || "";
  window.toggleTagCatDetail(id);
};

window.saveTagCatDetail = async function (id) {
  const cat = currentTagCategories.find((c) => c.tag_category_id === id);
  if (!cat) return;
  const input = document.getElementById(`tagCatDetailInput_${id}`);
  if (!input) return;
  const detail = input.value || "";
  if ((detail || "") === (cat.detail || "")) {
    window.toggleTagCatDetail(id);
    return;
  }
  try {
    await updateTagCategoryDB(id, { detail: detail.trim() ? detail : null });
    cat.detail = detail.trim() ? detail : null;
    _renderTagCatList();
    showToast(`บันทึกรายละเอียด "${cat.tag_name}" แล้ว`, "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

window.createTagCategory = async function () {
  const input = document.getElementById("tagCatNewName");
  const detailEl = document.getElementById("tagCatNewDetail");
  const name = (input.value || "").trim();
  if (!name) { showToast("ใส่ชื่อหมวดก่อน", "error"); return; }
  if (currentTagCategories.some((c) => c.tag_name === name)) {
    showToast("มีหมวดนี้อยู่แล้ว", "error");
    return;
  }
  const detailRaw = detailEl ? detailEl.value : "";
  const detail = detailRaw.trim() ? detailRaw : null;
  try {
    const row = await createTagCategoryDB({
      event_id: currentEventId,
      tag_name: name,
      color: _tagCatNewColor,
      detail,
      sort_order: currentTagCategories.length,
    });
    if (row) currentTagCategories.push(row);
    input.value = "";
    if (detailEl) detailEl.value = "";
    _renderTagCatList();
    populateTagFilter();
    showToast(`+ หมวด "${name}" 🏷️`, "success");
  } catch (e) {
    showToast("สร้างหมวดไม่สำเร็จ: " + e.message, "error");
  }
};

window.changeTagCatColor = async function (id, color) {
  const cat = currentTagCategories.find((c) => c.tag_category_id === id);
  if (!cat || cat.color === color) return;
  try {
    await updateTagCategoryDB(id, { color });
    cat.color = color;
    _renderTagCatList();
    filterTable();
  } catch (e) {
    showToast("เปลี่ยนสีไม่สำเร็จ: " + e.message, "error");
  }
};

window.renameTagCat = function (id) {
  // Replace the chip with an inline input; commit on Enter/blur, cancel on Esc
  const cat = currentTagCategories.find((c) => c.tag_category_id === id);
  if (!cat) return;
  const wrap = document.getElementById("tagCatList");
  if (!wrap) return;
  const chip = wrap.querySelector(`.tag-cat-preview[data-cat-id="${id}"]`);
  if (!chip || chip.querySelector("input")) return;

  const original = cat.tag_name;
  // Approximate chip width by current text length so input doesn't collapse to nothing
  const minChars = Math.max(original.length, 12);
  chip.innerHTML = `<input type="text" value="${escapeHtml(original)}" maxlength="40"
    style="width:${minChars}ch;border:none;outline:none;background:transparent;
    font:inherit;color:inherit;padding:0">`;
  const input = chip.querySelector("input");
  input.focus();
  input.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const name = (input.value || "").trim();
    if (!name || name === original) {
      _renderTagCatList();
      return;
    }
    if (currentTagCategories.some((c) => c.tag_name === name)) {
      showToast("ชื่อนี้มีหมวดอยู่แล้ว", "error");
      _renderTagCatList();
      return;
    }
    showLoading(true);
    try {
      await updateTagCategoryDB(id, { tag_name: name });
      cat.tag_name = name;
      const affected = allAttendees.filter((a) => (a.tags || []).includes(original));
      for (const a of affected) {
        const nextTags = a.tags.map((t) => (t === original ? name : t));
        await updateAttendee(a.attendee_id, { tags: nextTags });
        a.tags = nextTags;
      }
      _renderTagCatList();
      populateTagFilter();
      filterTable();
      showToast(`เปลี่ยนชื่อ → "${name}"`, "success");
    } catch (e) {
      showToast("เปลี่ยนชื่อไม่สำเร็จ: " + e.message, "error");
      _renderTagCatList();
    }
    showLoading(false);
  };
  const cancel = () => { if (!done) { done = true; _renderTagCatList(); } };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
};

window.askDeleteTagCat = function (id) {
  const cat = currentTagCategories.find((c) => c.tag_category_id === id);
  if (!cat) return;
  _tagCatDeleting = cat;

  const usage = allAttendees.filter((a) => (a.tags || []).includes(cat.tag_name));
  document.getElementById("tagCatDeleteHeader").innerHTML =
    `จะลบหมวด <b>"${escapeHtml(cat.tag_name)}"</b> ออกจากกิจกรรมนี้`;

  const usageBox = document.getElementById("tagCatDeleteUsageBox");
  const actionWrap = document.getElementById("tagCatDeleteActionWrap");
  const replaceOpt = document.getElementById("tagCatDeleteReplaceOpt");
  const replaceSel = document.getElementById("tagCatDeleteReplaceSel");

  if (usage.length) {
    usageBox.style.display = "block";
    document.getElementById("tagCatDeleteUsageCount").textContent = usage.length;
    document.getElementById("tagCatDeleteUsageList").innerHTML = usage
      .map((a) => `• ${escapeHtml(a.name || "—")}${a.member_code ? ` <span style="color:#92400e">(${escapeHtml(a.member_code)})</span>` : ""}`)
      .join("<br>");
    actionWrap.style.display = "block";

    // Build replace dropdown (categories อื่นๆ)
    const others = currentTagCategories.filter((c) => c.tag_category_id !== cat.tag_category_id);
    if (others.length) {
      replaceOpt.style.display = "block";
      replaceSel.innerHTML =
        '<option value="">-- เลือก tag ทดแทน --</option>' +
        others.map((c) => `<option value="${escapeHtml(c.tag_name)}">${escapeHtml(c.tag_name)}</option>`).join("");
    } else {
      replaceOpt.style.display = "none";
    }
    // Reset radio + show/hide replace select
    document.querySelectorAll('input[name="tagCatDeleteAction"]').forEach((r) => {
      r.checked = r.value === "clear";
      r.onchange = () => {
        replaceSel.style.display = (document.querySelector('input[name="tagCatDeleteAction"]:checked')?.value === "replace") ? "block" : "none";
      };
    });
    replaceSel.style.display = "none";
  } else {
    usageBox.style.display = "none";
    actionWrap.style.display = "none";
  }

  document.getElementById("tagCatDeleteModal").classList.add("open");
};

window.closeTagCatDeleteModal = function () {
  document.getElementById("tagCatDeleteModal")?.classList.remove("open");
  _tagCatDeleting = null;
};

window.confirmTagCatDelete = async function () {
  const cat = _tagCatDeleting;
  if (!cat) return;
  const oldName = cat.tag_name;
  const usage = allAttendees.filter((a) => (a.tags || []).includes(oldName));

  let action = "clear";
  let replaceWith = "";
  if (usage.length) {
    action = document.querySelector('input[name="tagCatDeleteAction"]:checked')?.value || "clear";
    if (action === "replace") {
      replaceWith = document.getElementById("tagCatDeleteReplaceSel").value;
      if (!replaceWith) {
        showToast("เลือก tag ทดแทนก่อน", "error");
        return;
      }
    }
  }

  showLoading(true);
  try {
    // 1) Update each affected attendee's tags
    for (const a of usage) {
      let next;
      if (action === "replace") {
        next = a.tags.map((t) => (t === oldName ? replaceWith : t));
        // Dedupe (กรณี attendee มี replaceWith อยู่แล้ว)
        next = [...new Set(next)];
      } else {
        next = a.tags.filter((t) => t !== oldName);
      }
      await updateAttendee(a.attendee_id, { tags: next.length ? next : null });
      a.tags = next;
    }
    // 2) Delete the category itself
    await deleteTagCategoryDB(cat.tag_category_id);
    currentTagCategories = currentTagCategories.filter((c) => c.tag_category_id !== cat.tag_category_id);

    window.closeTagCatDeleteModal();
    _renderTagCatList();
    populateTagFilter();
    filterTable();
    showToast(`ลบหมวด "${oldName}" แล้ว`, "success");
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ============================================================
// ── PAYMENT MODAL ─────────────────────────────────────────
// ============================================================
window.openPaymentModal = function (attendeeId) {
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  if (!a) return;
  _paymentModalAtt = a;

  const infoEl = document.getElementById("payAttendeeInfo");
  const tierName =
    a.tier_id && currentTiersById[a.tier_id]
      ? currentTiersById[a.tier_id].tier_name
      : null;
  const deadlineStr = a.payment_deadline ? formatDMYShort(a.payment_deadline) : "—";
  infoEl.innerHTML = `
    <div><b>${escapeHtml(a.name)}</b> ${a.member_code ? `· ${escapeHtml(a.member_code)}` : ""}</div>
    <div>🎫 Ticket: <b>${a.ticket_no || "—"}</b> · ราคา <b>฿${formatNum(a.paid_amount)}</b>${tierName ? ` · Tier <b>${escapeHtml(tierName)}</b>` : ""}</div>
    <div>⏳ Deadline: <b>${deadlineStr}</b></div>`;

  // Preset fields from attendee
  document.querySelectorAll('input[name="payStatus"]').forEach((el) => {
    el.checked = el.value === (a.payment_status || "UNPAID");
  });
  document.querySelectorAll('input[name="payMethod"]').forEach((el) => {
    el.checked = el.value === a.payment_method;
  });
  document.getElementById("payRef").value = a.payment_ref || "";
  const preview = document.getElementById("paySlipPreview");
  preview.innerHTML = a.slip_url
    ? `<a href="${a.slip_url}" target="_blank"><img src="${a.slip_url}" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--border)"></a>`
    : "";
  document.getElementById("paySlipFile").value = "";

  _syncPayMethodBlocks();
  document.querySelectorAll('input[name="payStatus"]').forEach((el) => {
    el.onchange = _syncPayMethodBlocks;
  });
  document.querySelectorAll('input[name="payMethod"]').forEach((el) => {
    el.onchange = _syncPayMethodBlocks;
  });

  document.getElementById("paymentModal").classList.add("open");
};

window.closePaymentModal = function () {
  document.getElementById("paymentModal").classList.remove("open");
  _paymentModalAtt = null;
};

function _syncPayMethodBlocks() {
  const status =
    document.querySelector('input[name="payStatus"]:checked')?.value ||
    "UNPAID";
  const method =
    document.querySelector('input[name="payMethod"]:checked')?.value || "";
  const needsMethod = status === "PAID";
  const isSlip = method === "slip_kbank" || method === "slip_ktb";
  document.getElementById("payMethodBlock").style.display = needsMethod
    ? "flex"
    : "none";
  document.getElementById("paySlipBlock").style.display =
    needsMethod && isSlip ? "flex" : "none";
  document.getElementById("payRefBlock").style.display = needsMethod
    ? "flex"
    : "none";
}

let _pendingSlipFile = null;
function _onSlipFileChange(ev) {
  const f = ev.target.files?.[0];
  _pendingSlipFile = f || null;
  const preview = document.getElementById("paySlipPreview");
  if (!f) {
    preview.innerHTML = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    preview.innerHTML = `<img src="${reader.result}" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--border)">`;
  };
  reader.readAsDataURL(f);
}

window.savePayment = async function () {
  if (!_paymentModalAtt) return;
  const a = _paymentModalAtt;
  const status =
    document.querySelector('input[name="payStatus"]:checked')?.value || "UNPAID";
  const method =
    document.querySelector('input[name="payMethod"]:checked')?.value || null;
  const ref = document.getElementById("payRef").value.trim() || null;

  if (status === "PAID" && !method) {
    showToast("กรุณาเลือกช่องทางการชำระ", "error");
    return;
  }

  showLoading(true);
  try {
    // Upload slip ถ้ามี file + method เป็น slip
    let slipUrl = a.slip_url || null;
    if (_pendingSlipFile && (method === "slip_kbank" || method === "slip_ktb")) {
      slipUrl = await uploadSlip(currentEventId, _pendingSlipFile);
      _pendingSlipFile = null;
    }

    const session = JSON.parse(
      localStorage.getItem("erp_session") ||
        sessionStorage.getItem("erp_session") ||
        "{}",
    );

    const patch = {
      payment_status: status,
      payment_method: status === "PAID" ? method : null,
      payment_ref: status === "PAID" ? ref : null,
      slip_url: status === "PAID" && (method === "slip_kbank" || method === "slip_ktb")
        ? slipUrl
        : null,
      paid_at: status === "PAID" ? new Date().toISOString() : null,
      verified_by: status === "PAID" ? session?.user_id || null : null,
      // Clear deadline when PAID or COMPLIMENTARY
      payment_deadline: status === "UNPAID" ? a.payment_deadline : null,
    };

    await updateAttendee(a.attendee_id, patch);
    Object.assign(a, patch);
    showToast("บันทึกการชำระแล้ว 💰", "success");
    window.closePaymentModal();
    updateStats();
    filterTable();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ============================================================
// ── QR MODAL ──────────────────────────────────────────────
// ============================================================
window.openQrModal = function (attendeeId) {
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  if (!a) return;
  _qrModalAtt = a;

  const qrPayload = _getQrPayload(a);
  const isPair = qrPayload.startsWith("MC-");
  const pairBadge = isPair
    ? `<div class="qr-pair-badge" style="margin-top:6px;display:inline-block;padding:3px 10px;background:#f3e8ff;color:#9333ea;border-radius:6px;font-size:11px;font-weight:700">👫 QR ใช้ร่วมกับผู้สมัครร่วม</div>`
    : "";
  document.getElementById("qrInfo").innerHTML = `
    <div class="qr-name">${escapeHtml(a.name)}</div>
    ${a.member_code ? `<div class="qr-member">${escapeHtml(a.member_code)}</div>` : ""}
    ${currentEvent?.event_name ? `<div class="qr-event">${escapeHtml(currentEvent.event_name)}</div>` : ""}
    ${pairBadge}`;
  document.getElementById("qrTicketNo").textContent = a.ticket_no || `ID-${a.attendee_id}`;

  // QR payload = ticket_no (หรือ MC-{member_code} ถ้ามีคู่ → ขึ้น picker ตอน scan)
  const wrap = document.getElementById("qrCodeWrap");
  wrap.innerHTML = "";
  try {
    new QRCode(wrap, {
      text: qrPayload,
      width: 200,
      height: 200,
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    wrap.textContent = "QR library ยังไม่โหลด — รีเฟรชหน้าอีกครั้ง";
  }

  document.getElementById("qrModal").classList.add("open");
};

window.closeQrModal = function () {
  document.getElementById("qrModal").classList.remove("open");
  _qrModalAtt = null;
};

window.printQr = function () {
  window.print();
};

// ============================================================
// ── BULK MESSAGE MODAL ────────────────────────────────────
// ============================================================
window.openCheckinPage = function () {
  if (!currentEventId) return;
  window.open(`check-in.html?event_id=${currentEventId}`, "_blank");
};

// ── SHARE REGISTER LINK (LIFF + plain URL) ─────────────────
function _buildPlainRegisterUrl() {
  if (!currentEventId) return "";
  // Prefer channel's LIFF endpoint if set (เผื่อ deploy บน domain อื่น), fallback to current origin
  const base = `${location.origin}${location.pathname.replace(/attendees\.html.*$/, "register.html")}`;
  return `${base}?event=${currentEventId}`;
}

function _buildLiffUrl(liffId) {
  if (!liffId || !currentEventId) return "";
  return `https://liff.line.me/${liffId}?event=${currentEventId}`;
}

window.openShareRegisterModal = async function () {
  if (!currentEventId || !currentEvent) {
    showToast("เลือก event ก่อน", "error");
    return;
  }

  // Resolve channel (per-event or default) to get liff_id + endpoint
  let channel = null;
  try {
    if (window.LineAPI) {
      channel = await window.LineAPI.getChannelForEvent(currentEvent);
    }
  } catch (e) {
    console.warn("get channel:", e.message);
  }

  const liffId = channel?.liff_id || null;
  const liffUrl = _buildLiffUrl(liffId);
  const plainUrl = channel?.liff_endpoint
    ? `${channel.liff_endpoint.replace(/\/+$/, "").replace(/\?.*$/, "")}?event=${currentEventId}`
    : _buildPlainRegisterUrl();

  // Fill modal
  document.getElementById("shareRegEventName").textContent = currentEvent.event_name || "Event";
  document.getElementById("shareRegEventSub").textContent =
    `[${currentEvent.event_code || ""}] ${currentEvent.location || ""}`;
  document.getElementById("shareRegLiffInput").value = liffUrl || "— ไม่มี LIFF (ตั้งค่าใน channel ก่อน)";
  document.getElementById("shareRegPlainInput").value = plainUrl;

  // Build QR — use Plain URL (LIFF doesn't work until channel is Published)
  const qrWrap = document.getElementById("shareRegQrWrap");
  qrWrap.innerHTML = "";
  try {
    new QRCode(qrWrap, {
      text: plainUrl,
      width: 220,
      height: 220,
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    qrWrap.textContent = "QR library ยังไม่โหลด — refresh หน้า";
  }

  // Disable copy button if no LIFF
  const liffBtn = document.querySelector('#shareRegLiffInput + button');
  if (liffBtn) liffBtn.disabled = !liffUrl;

  document.getElementById("shareRegisterModal").classList.add("open");
};

window.closeShareRegisterModal = function () {
  document.getElementById("shareRegisterModal").classList.remove("open");
};

window.copyShareRegisterUrl = async function (type) {
  const id = type === "liff" ? "shareRegLiffInput" : "shareRegPlainInput";
  const input = document.getElementById(id);
  const url = input.value;
  if (!url || url.startsWith("—")) { showToast("ไม่มี URL ให้ copy", "error"); return; }
  try {
    await navigator.clipboard.writeText(url);
    showToast(`✅ คัดลอก ${type === "liff" ? "LIFF" : "Plain"} URL แล้ว`, "success");
  } catch {
    input.select();
    document.execCommand("copy");
    showToast(`✅ คัดลอกแล้ว`, "success");
  }
};

// ── ADAPTIVE COLUMN SYSTEM (Spreadsheet mode — only mode) ──
// Header + rows show columns ตาม event field config + qualifications แบบ adaptive

const FIELD_COL_DEFS = {
  position:     { label: "⭐ ตำแหน่ง",         width: 90,  align: "center" },
  phone:        { label: "📱 เบอร์โทร",        width: 120, align: "center" },
  upline:       { label: "🌿 สายงาน",          width: 110, align: "center" },
  referrer:     { label: "🤝 ผู้แนะนำ",        width: 150, align: "center" },
  cs_staff:     { label: "👤 CS",              width: 70,  align: "center" },
  line_name:    { label: "💬 ชื่อไลน์",        width: 130, align: "center" },
  fb_page_name: { label: "📘 เพจ FB",          width: 140, align: "center" },
  had_attended: { label: "↻ เคยเรียน",         width: 90,  align: "center" },
  note:         { label: "📝 หมายเหตุ",        width: 140, align: "center" },
};
// icon prefix per core field (ใช้กับ label override → คง icon เดิมไว้)
const FIELD_ICONS = {
  position: "⭐", phone: "📱", upline: "🌿", referrer: "🤝", cs_staff: "👤",
  line_name: "💬", fb_page_name: "📘", had_attended: "↻", note: "📝",
};
function _colIcon(key) { return FIELD_ICONS[key] ? FIELD_ICONS[key] + " " : ""; }

// Get currently effective field config (cached per event)
function _getActiveFieldConfig() {
  if (_eventConfigCache && _eventConfigCache.eventId === currentEventId) {
    return _eventConfigCache.config;
  }
  // cache ยังไม่พร้อม → คืน config ว่าง (อย่า flash 9 คอลัมน์ default)
  return EMPTY_FIELD_CONFIG;
}

// event มีการชำระเงินมั้ย — ถ้าไม่มี (free event) → ซ่อน column "ชำระ"
function _eventHasPayment() {
  const price = getCurrentPrice();
  if (price > 0) return true;
  if (Array.isArray(currentTiers) && currentTiers.some(t => parseFloat(t.price || 0) > 0)) return true;
  return false;
}

// ซ่อน/แสดง UI เกี่ยวกับ payment ทั่วทั้งหน้า (filter pills, stat cards, tier banner)
function _applyPaymentVisibility() {
  const has = _eventHasPayment();
  // filter pills "💰 ชำระ"
  const payFilterGroup = document.getElementById("filterPillsPayment")?.closest(".att-tt-group");
  if (payFilterGroup) payFilterGroup.style.display = has ? "" : "none";
  // stat cards
  const statPaid    = document.querySelector(".att-stat.sc-paid");
  const statRevenue = document.querySelector(".att-stat.sc-revenue");
  if (statPaid)    statPaid.style.display    = has ? "" : "none";
  if (statRevenue) statRevenue.style.display = has ? "" : "none";
  // status card "การชำระเงิน" — ซ่อนถ้า event ฟรี
  const payCard = document.querySelector(".att-scard.sc-pay");
  if (payCard) payCard.style.display = has ? "" : "none";
  // tier banner — เผื่อ event ไม่มี tier + ไม่มีราคา
  const tierBanner = document.getElementById("tierInfoBanner");
  if (tierBanner && !has) tierBanner.style.display = "none";
}

// แสดงเป็น column ในตาราง? — fallback: ถ้าไม่กำหนด → ใช้ show (backward compat)
function _fieldShowsAsColumn(fcfg) {
  if (!fcfg) return true;
  if (fcfg.column !== undefined) return fcfg.column !== false;
  return fcfg.show !== false;
}

// รีเฟรชคอลัมน์ให้ตรงกับ template/config ล่าสุด — คอลัมน์ยึดตามเทมเพลต
window.refreshColumnsFromTemplate = async function () {
  if (!currentEventId) { showToast("เลือกกิจกรรมก่อน", "error"); return; }
  try {
    await _fetchDefaultTemplate(true);      // bust default-template cache (เผื่อแก้ที่ default)
    _invalidateEventConfigCache();          // ดึง config/template ใหม่สด
    const info = await getEventConfigInfo(currentEventId);
    // event มีการตั้งค่าฟิลด์เฉพาะงาน (override) ทับ template → ถามก่อนล้างให้ใช้ตาม template
    if (info.source === "override") {
      const ok = await window.ConfirmModal.open({
        icon: "🔄",
        title: "รีเฟรชคอลัมน์ตามเทมเพลต",
        message: "งานนี้มีการตั้งค่าฟิลด์เฉพาะงาน (override) อยู่ — รีเฟรชจะล้าง override แล้วใช้คอลัมน์ตามเทมเพลตล่าสุด ดำเนินการต่อไหม?",
        okText: "ใช้ตามเทมเพลต",
        cancelText: "ยกเลิก",
        tone: "primary",
      });
      if (!ok) return;
      await sbFetch("events", `?event_id=eq.${currentEventId}`, {
        method: "PATCH", body: { attendee_field_config: {} },
      });
      _invalidateEventConfigCache();
      await getEventConfigInfo(currentEventId);
    }
    rebuildTableHeader();
    filterTable();
    showToast("รีเฟรชคอลัมน์ตามเทมเพลตแล้ว 🔄", "success");
  } catch (e) {
    showToast("รีเฟรชไม่ได้: " + (e.message || e), "error");
  }
};

function getActiveColumns() {
  const cols = [
    { key: "check", label: `<input type="checkbox" id="selectAllAttendees" onchange="window.toggleSelectAll(this.checked)" style="cursor:pointer;width:16px;height:16px">`, width: 36, align: "center" },
    { key: "num",  label: "#", width: 40, align: "center" },
    { key: "name", label: "🔍 รหัส / ชื่อ", width: 220 },
  ];
  const cfg = _getActiveFieldConfig();
  const order = Array.isArray(cfg.field_order) && cfg.field_order.length
    ? cfg.field_order
    : Object.keys(FIELD_COL_DEFS);
  order.forEach(fkey => {
    if (!FIELD_COL_DEFS[fkey]) return;
    // คอลัมน์ยึดตาม config/template เป็นหลัก (ตัด/แสดงตามที่ template กำหนด)
    if (_fieldShowsAsColumn(cfg.fields?.[fkey])) {
      cols.push({ key: "field:" + fkey, label: _colIcon(fkey) + _getFieldLabel(fkey, cfg), width: FIELD_COL_DEFS[fkey].width, align: "center" });
    }
  });
  // Custom text fields → คอลัมน์ตามที่ admin เพิ่ม
  (cfg.custom_fields || []).forEach(cf => {
    cols.push({ key: "custom:" + cf.key, label: `📝 ${cf.label}`, width: 130, align: "center" });
  });
  (cfg.qualifications || []).forEach(q => {
    cols.push({ key: "qual:" + q.key, label: `✓ ${q.label}`, width: 95, align: "center", small: true });
  });
  if (_eventHasPayment()) {
    cols.push({ key: "payment", label: "💰 ชำระ",     width: 130, align: "center" });
  }
  cols.push({ key: "checkin", label: "✅ Check-in", width: 90,  align: "center" });
  cols.push({ key: "actions", label: "จัดการ",     width: 130, align: "center" });
  return cols;
}

function rebuildTableHeader() {
  const tr = document.getElementById("attTableHead");
  if (!tr) return;
  const cols = getActiveColumns();
  tr.innerHTML = cols.map(c => {
    const alignClass = c.align === "center" ? "col-center" : "";
    const extra = c.small ? ";font-size:10.5px;line-height:1.25" : "";
    return `<th class="${alignClass}" style="min-width:${c.width}px${extra}" title="${c.small ? (typeof c.label === 'string' ? c.label.replace(/^✓ /, '') : '') : ''}">${c.label}</th>`;
  }).join("");
  _rebuildTableGroupHeader(cols);
}

// map: item key → ชื่อฟิลด์ (block title) สำหรับ group header แถวบน
function _getColGroupTitles() {
  const info = (_eventConfigCache && _eventConfigCache.eventId === currentEventId) ? _eventConfigCache : null;
  const blocks = info && Array.isArray(info.blocks) ? info.blocks : [];
  const keyToTitle = {};   // std/custom/qual key → block title
  let nameTitle = null;    // block ที่มี core "name" → ครอบคอลัมน์ค้นหา/ชื่อ
  blocks.forEach(b => {
    (b.items || []).forEach(it => {
      if (!it || !it.type) return;
      if (it.type === "core" && it.key === "name") nameTitle = b.title || "";
      else if (it.key) keyToTitle[it.key] = b.title || "";
    });
  });
  return { keyToTitle, nameTitle };
}

// แถวหัวตารางบนสุด — โชว์ชื่อฟิลด์ (block) ครอบช่วงคอลัมน์ของมัน
function _rebuildTableGroupHeader(cols) {
  const gtr = document.getElementById("attTableGroupHead");
  if (!gtr) return;
  const { keyToTitle, nameTitle } = _getColGroupTitles();
  const groupOf = (c) => {
    if (c.key === "name") return nameTitle || null;
    if (c.key.startsWith("field:"))  return keyToTitle[c.key.slice(6)] || null;
    if (c.key.startsWith("custom:")) return keyToTitle[c.key.slice(7)] || null;
    if (c.key.startsWith("qual:"))   return keyToTitle[c.key.slice(5)] || null;
    return null;
  };
  if (!cols.some(c => groupOf(c))) { gtr.innerHTML = ""; gtr.style.display = "none"; return; }
  gtr.style.display = "";
  let html = "", i = 0;
  while (i < cols.length) {
    const g = groupOf(cols[i]);
    let span = 1;
    while (i + span < cols.length && groupOf(cols[i + span]) === g) span++;
    html += g
      ? `<th colspan="${span}" class="col-center att-grp-th">${escapeHtml(g)}</th>`
      : `<th colspan="${span}" class="att-grp-empty"></th>`;
    i += span;
  }
  gtr.innerHTML = html;
}

// event ยังไม่เลือก template (source="none") → โชว์ banner บังคับเลือก
function _isNoTemplate() {
  return !!(_eventConfigCache
    && _eventConfigCache.eventId === currentEventId
    && _eventConfigCache.source === "none");
}

function _applyTemplateGate() {
  const banner = document.getElementById("noTemplateBanner");
  if (!banner) return;
  if (_isNoTemplate()) {
    banner.style.display = "";
    banner.innerHTML = `
      <div class="antb-ico">📋</div>
      <div class="antb-text">
        <div class="antb-title">ยังไม่มี Default template</div>
        <div class="antb-sub">ตั้งค่า Default template 1 อันที่หน้าเทมเพลต (กดปุ่ม ⭐) เพื่อใช้เป็นฟอร์มกลางทุกงาน — หรือเลือกเทมเพลตเฉพาะให้งานนี้</div>
      </div>
      <button class="antb-btn" onclick="window.open('./attendee-templates.html','_blank')">📋 ไปหน้าเทมเพลต</button>
      <button class="antb-btn" style="background:linear-gradient(135deg,#475569,#64748b)" onclick="window.openFieldConfigModal()">⚙️ เลือกเฉพาะงานนี้</button>`;
  } else {
    banner.style.display = "none";
    banner.innerHTML = "";
  }
}

// บังคับเลือก template ก่อนเพิ่มผู้เข้าร่วม — คืน true = ถูกบล็อก
async function _requireTemplateOrPrompt() {
  if (!currentEventId) return false;
  const info = await getEventConfigInfo(currentEventId);
  if (info.source === "none") {
    showToast("⚠️ ยังไม่มี Default template — ตั้งค่าก่อนเพิ่มผู้เข้าร่วม", "error");
    window.openFieldConfigModal();
    return true;
  }
  return false;
}

// ── AUTO CHECK-IN TOGGLE ──────────────────────────────────
// Global setting (1 key ใช้ทุก event) — default ON
const AUTOCHECKIN_KEY = "autoCheckin_default";

function _loadAutoCheckinState() {
  const saved = localStorage.getItem(AUTOCHECKIN_KEY);
  _autoCheckin = saved === null ? true : saved === "1";
  const input = document.getElementById("autoCheckinInput");
  if (input) input.checked = _autoCheckin;
  _syncAutoCheckinUi();
}

function _syncAutoCheckinUi() {
  const label = document.getElementById("autoCheckinLabel");
  if (label) label.textContent = _autoCheckin ? "⚡ โหมดหน้างาน: ON" : "⚡ โหมดหน้างาน";
}

window.onAutoCheckinToggle = function (checked) {
  _autoCheckin = !!checked;
  localStorage.setItem(AUTOCHECKIN_KEY, _autoCheckin ? "1" : "0");
  _syncAutoCheckinUi();
  showToast(
    _autoCheckin ? "โหมดหน้างาน: ON — save แล้ว check-in ทันที (ทุก event)" : "โหมดหน้างาน: OFF (ทุก event)",
    _autoCheckin ? "success" : "info",
  );
};

window.openBulkMsgModal = function () {
  _refreshBulkMsgTags();
  // Load last template from localStorage (per event)
  const key = `bulkMsgTpl_${currentEventId}`;
  const saved = localStorage.getItem(key) || "";
  document.getElementById("bulkMsgTpl").value = saved;
  document.getElementById("bulkMsgTagFilter").value = "__ALL__";
  window.onBulkMsgFilterChange();
  document.getElementById("bulkMsgModal").classList.add("open");
};

window.closeBulkMsgModal = function () {
  document.getElementById("bulkMsgModal").classList.remove("open");
};

function _refreshBulkMsgTags() {
  const sel = document.getElementById("bulkMsgTagFilter");
  if (!sel) return;
  // Keep 3 system options, append tag options
  const systemOpts = `
    <option value="__ALL__">👥 ทุกคน</option>
    <option value="__UNPAID__">⏳ ยังไม่ชำระ</option>
    <option value="__EXPIRED__">⌛ เกิน grace period</option>`;
  const allTags = new Set();
  allAttendees.forEach((a) => (a.tags || []).forEach((t) => allTags.add(t)));
  const tagOpts = [...allTags]
    .sort()
    .map((t) => `<option value="tag:${escapeHtml(t)}">🏷️ ${escapeHtml(t)}</option>`)
    .join("");
  sel.innerHTML = systemOpts + tagOpts;
}

function _bulkMsgTargets() {
  const val = document.getElementById("bulkMsgTagFilter").value;
  if (val === "__ALL__") return allAttendees;
  if (val === "__UNPAID__")
    return allAttendees.filter((a) => a.payment_status === "UNPAID");
  if (val === "__EXPIRED__") return allAttendees.filter(isAttendeeExpired);
  if (val.startsWith("tag:")) {
    const tag = val.slice(4);
    return allAttendees.filter((a) => (a.tags || []).includes(tag));
  }
  return [];
}

function _fillBulkTemplate(tpl, a) {
  const tierName =
    a.tier_id && currentTiersById[a.tier_id]
      ? currentTiersById[a.tier_id].tier_name
      : "";
  return String(tpl || "")
    .replace(/\{ชื่อ\}/g, a.name || "")
    .replace(/\{รหัส\}/g, a.member_code || "")
    .replace(/\{ตำแหน่ง\}/g, a.position_level || "")
    .replace(/\{ราคา\}/g, formatNum(a.paid_amount || 0))
    .replace(/\{tier\}/g, tierName)
    .replace(/\{deadline\}/g, a.payment_deadline ? formatDMYShort(a.payment_deadline) : "—")
    .replace(/\{ticket\}/g, a.ticket_no || "");
}

window.insertBulkPh = function (ph) {
  const ta = document.getElementById("bulkMsgTpl");
  if (!ta) return;
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, s) + ph + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + ph.length;
  window.onBulkMsgTplChange();
};

window.onBulkMsgFilterChange = function () {
  const targets = _bulkMsgTargets();
  document.getElementById("bulkMsgCount").textContent =
    `จะส่งถึง ${targets.length} คน`;
  const linkedCount = targets.filter(a => a.line_user_id).length;
  const el = document.getElementById("bulkLineLinked");
  if (el) el.textContent = `${linkedCount} / ${targets.length}`;
  const pushBtn = document.getElementById("btnBulkLinePush");
  if (pushBtn) pushBtn.disabled = linkedCount === 0;
  const flexBtn = document.getElementById("btnBulkTicketFlex");
  if (flexBtn) flexBtn.disabled = linkedCount === 0;
  window.onBulkMsgTplChange();
};

window.onBulkMsgTplChange = function () {
  const tpl = document.getElementById("bulkMsgTpl").value;
  // Persist per event
  if (currentEventId) {
    localStorage.setItem(`bulkMsgTpl_${currentEventId}`, tpl);
  }
  const targets = _bulkMsgTargets();
  const sample = targets[0];
  const preview = document.getElementById("bulkMsgPreview");
  if (!tpl.trim()) {
    preview.textContent = "— พิมพ์ข้อความด้านบนเพื่อดูตัวอย่าง —";
    return;
  }
  if (!sample) {
    preview.textContent = "(ไม่มีคนตรงกับ filter นี้)";
    return;
  }
  preview.textContent = _fillBulkTemplate(tpl, sample);
};

window.copyBulkMessages = async function () {
  const tpl = document.getElementById("bulkMsgTpl").value.trim();
  if (!tpl) {
    showToast("กรุณาพิมพ์ข้อความ", "error");
    return;
  }
  const targets = _bulkMsgTargets();
  if (!targets.length) {
    showToast("ไม่มีคนตรงกับ filter", "error");
    return;
  }
  const messages = targets
    .map((a) => {
      const phone = a.phone ? ` (📱 ${a.phone})` : "";
      return `─── ${a.name}${phone} ───\n${_fillBulkTemplate(tpl, a)}`;
    })
    .join("\n\n");
  try {
    await navigator.clipboard.writeText(messages);
    showToast(`Copy แล้ว ${targets.length} ข้อความ 📋`, "success");
  } catch (e) {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = messages;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast(`Copy แล้ว ${targets.length} ข้อความ 📋`, "success");
  }
};

// ── Build Flex ticket message ────────────────────────────────
function _qrImageUrl(text) {
  // Use qrserver.com as a free QR-image service (no auth, HTTPS, served directly)
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=20&data=${encodeURIComponent(text)}`;
}

function _fmtDateTH(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

/* Detect image natural dimensions (for matching LINE Flex aspectRatio) */
async function _detectPosterAspectRatio(posterUrl, fallback = "1.91:1") {
  if (!posterUrl) return fallback;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return resolve(fallback);
      // LINE accepts fractional ratios like "0.67:1" but also raw "W:H"
      resolve(`${w}:${h}`);
    };
    img.onerror = () => resolve(fallback);
    img.src = posterUrl;
  });
}

function buildTicketFlex(event, attendee, qrUrlOverride, posterAspectRatio) {
  const poster = (event?.image_urls?.[0]) || event?.poster_url || "";
  const ticketNo = attendee.ticket_no || `A4S-${event?.event_id || ""}-${attendee.attendee_id}`;
  // Use styled QR if pre-generated, else fallback to plain QR service
  const qrUrl = qrUrlOverride || _qrImageUrl(ticketNo);
  const heroAspect = posterAspectRatio || "1:1";
  const eventName = event?.event_name || "Event";
  const dateText = _fmtDateTH(event?.event_date);
  const timeText = (event?.start_time && event?.end_time)
    ? `${event.start_time.slice(0, 5)} — ${event.end_time.slice(0, 5)} น.`
    : "";
  const loc = event?.location || "";
  const memberCode = attendee.member_code ? `[${attendee.member_code}] ` : "";

  // Layout (3-section sketch):
  //   [Hero Poster]         ← large, 1:1 square
  //   ─── separator ───
  //   [Event detail]        ← name + attendee + date + location
  //   [QR Code box]         ← bordered box with ticket_no
  const bubble = {
    type: "bubble",
    size: "kilo",
    ...(poster ? {
      hero: {
        type: "image",
        url: poster,
        size: "full",
        aspectRatio: heroAspect,
        aspectMode: "fit",         // show whole poster (no cropping)
        backgroundColor: "#0f172a", // letterbox color if aspect mismatches
      },
    } : {}),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "lg",
      contents: [
        // ── Event detail ──
        { type: "text", text: eventName, weight: "bold", size: "xl", wrap: true, color: "#0f172a" },
        {
          type: "box", layout: "vertical", spacing: "sm", margin: "md",
          contents: [
            {
              type: "box", layout: "baseline", spacing: "sm",
              contents: [
                { type: "text", text: "👤", size: "sm", flex: 1 },
                { type: "text", text: `${memberCode}${attendee.name || ""}`, size: "sm", flex: 10, weight: "bold", wrap: true, color: "#0f172a" },
              ],
            },
            ...(dateText ? [{
              type: "box", layout: "baseline", spacing: "sm",
              contents: [
                { type: "text", text: "📅", size: "sm", flex: 1 },
                { type: "text", text: dateText + (timeText ? `  ·  ${timeText}` : ""), size: "sm", flex: 10, color: "#334155" },
              ],
            }] : []),
            ...(loc ? [{
              type: "box", layout: "baseline", spacing: "sm",
              contents: [
                { type: "text", text: "📍", size: "sm", flex: 1 },
                { type: "text", text: loc, size: "sm", flex: 10, color: "#334155", wrap: true },
              ],
            }] : []),
          ],
        },
        // ── QR Code box (bordered, prominent) ──
        {
          type: "box", layout: "vertical", margin: "xl",
          borderWidth: "2px", borderColor: "#0f172a", cornerRadius: "md", paddingAll: "lg",
          backgroundColor: "#ffffff",
          contents: [
            {
              type: "image",
              url: qrUrl,
              aspectMode: "fit",
              aspectRatio: "1:1",
              size: "full",
            },
            { type: "text", text: ticketNo, align: "center", weight: "bold", size: "xl", color: "#0f172a", margin: "lg" },
          ],
        },
      ],
    },
    footer: {
      type: "box", layout: "vertical", paddingAll: "md",
      contents: [
        { type: "text", text: "📱 แสดง QR นี้ที่หน้างานเพื่อ check-in", size: "xs", color: "#6B7280", align: "center" },
      ],
    },
  };

  return {
    type: "flex",
    altText: `🎫 Ticket: ${ticketNo} — ${eventName}`,
    contents: bubble,
  };
}

// ── Send Ticket Flex to each attendee (personalized) ──────────
window.sendBulkTicketFlex = async function () {
  if (!window.LineAPI) { showToast("LINE module ยังไม่โหลด — refresh หน้า", "error"); return; }
  if (!window.ERPCrypto?.hasMasterKey()) { showToast("ตั้ง Master Key ในหน้า settings ก่อน", "error"); return; }

  const targets = _bulkMsgTargets().filter(a => a.line_user_id);
  if (!targets.length) { showToast("ไม่มีคนที่เชื่อม LINE", "error"); return; }

  const ok = await (window.ConfirmModal
    ? window.ConfirmModal.open({
        icon: "🎫",
        title: "ส่ง Ticket (Flex) ผ่าน LINE OA",
        message: `จะส่งบัตร + QR ให้ ${targets.length} คน — ยืนยัน?`,
        okText: "ส่งบัตร",
        cancelText: "ยกเลิก",
        tone: "primary",
      })
    : Promise.resolve(confirm(`ส่ง Ticket Flex ให้ ${targets.length} คน?`)));
  if (!ok) return;

  const btn = document.getElementById("btnBulkTicketFlex");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = `⏳ 0/${targets.length}`;

  try {
    const channel = await window.LineAPI.getChannelForEvent(currentEvent);
    if (!channel) throw new Error("ไม่พบ LINE channel");

    // currentEvent is loaded with a trimmed column list (no poster_url).
    // Fetch the full row once so Flex hero can use the poster image.
    let fullEvent = currentEvent;
    try {
      const { url, key } = getSB();
      const r = await fetch(
        `${url}/rest/v1/events?event_id=eq.${currentEventId}&select=*&limit=1`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      );
      const rows = await r.json();
      if (rows?.[0]) fullEvent = { ...currentEvent, ...rows[0] };
    } catch (e) { console.warn("load full event fail:", e.message); }

    // Detect poster aspect ratio once (so Flex hero shows entire poster without cropping)
    const posterUrl = fullEvent.poster_url
      || (Array.isArray(fullEvent.image_urls) ? fullEvent.image_urls[0] : null);
    const posterAspect = await _detectPosterAspectRatio(posterUrl);
    console.log("[poster aspect]", posterAspect);

    // Pre-generate styled QR images (upload to Supabase) before building Flex
    btn.textContent = `⏳ QR 0/${targets.length}`;
    const sendTargets = [];
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i];
      let qrUrl;
      try {
        qrUrl = await getStyledQrUrl(fullEvent, a);
      } catch (e) {
        console.warn("styled QR fail for", a.attendee_id, e.message);
        qrUrl = null;  // buildTicketFlex will fallback to plain service
      }
      sendTargets.push({
        userId: a.line_user_id,
        message: buildTicketFlex(fullEvent, a, qrUrl, posterAspect),
      });
      btn.textContent = `⏳ QR ${i + 1}/${targets.length}`;
    }

    const result = await window.LineAPI.sendPersonalized({
      channel,
      targets: sendTargets,
      onProgress: ({ done, total }) => { btn.textContent = `⏳ ส่ง ${done}/${total}`; },
    });

    if (result.fail === 0) {
      showToast(`✅ ส่งบัตรสำเร็จ ${result.ok}/${targets.length} คน`, "success");
    } else {
      showToast(`⚠️ สำเร็จ ${result.ok} · ล้มเหลว ${result.fail} — ดู console`, "error");
      console.warn("LINE flex errors:", result.errors);
    }
  } catch (e) {
    showToast("ส่งไม่ได้: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ── Build flex for "ส่ง Text" — wrap personalized text in green bubble ──
function _buildBulkTextFlex(event, attendee, messageText) {
  const eventName = event?.event_name || "งานกิจกรรม";
  const dateText = event?.event_date ? _fmtDateTH(event.event_date) : "";
  const name = attendee.name || attendee.member_code || "";

  const headerContents = [
    {
      type: "text",
      text: "📢 ข้อความถึงคุณ",
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
  ];
  if (dateText) {
    headerContents.push({
      type: "text",
      text: `📅 ${dateText}`,
      size: "xs",
      color: "#d1fae5",
      margin: "xs",
    });
  }

  const bubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      backgroundColor: "#06c755",
      contents: headerContents,
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
        { type: "separator", margin: "md" },
        {
          type: "text",
          text: messageText,
          size: "sm",
          color: "#0f172a",
          wrap: true,
          margin: "md",
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: `📢 ${eventName} — ${messageText.slice(0, 40)}`,
    contents: bubble,
  };
}

// ── Send via LINE OA (per-user push) ─────────────────────────
window.sendBulkLinePush = async function () {
  const tpl = document.getElementById("bulkMsgTpl").value.trim();
  if (!tpl) { showToast("กรุณาพิมพ์ข้อความ", "error"); return; }
  if (!window.LineAPI) { showToast("LINE module ยังไม่โหลด — refresh หน้า", "error"); return; }
  if (!window.ERPCrypto?.hasMasterKey()) { showToast("ตั้ง Master Key ในหน้า settings ก่อน", "error"); return; }

  const targets = _bulkMsgTargets().filter(a => a.line_user_id);
  if (!targets.length) { showToast("ไม่มีคนที่เชื่อม LINE", "error"); return; }

  const btn = document.getElementById("btnBulkLinePush");
  const ok = await (window.ConfirmModal
    ? window.ConfirmModal.open({
        icon: "📱",
        title: "ส่งข้อความผ่าน LINE OA",
        message: `จะส่งให้ ${targets.length} คนที่เชื่อม LINE แล้ว — ยืนยัน?`,
        okText: "ส่งเลย",
        cancelText: "ยกเลิก",
        tone: "success",
      })
    : Promise.resolve(confirm(`ส่งข้อความผ่าน LINE OA ให้ ${targets.length} คน?`)));
  if (!ok) return;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = `⏳ 0/${targets.length}`;

  try {
    // Resolve channel for this event
    const channel = await window.LineAPI.getChannelForEvent(currentEvent);
    if (!channel) throw new Error("ไม่พบ LINE channel — ตั้งค่าในหน้า settings");

    const sendTargets = targets.map(a => ({
      userId: a.line_user_id,
      message: _buildBulkTextFlex(currentEvent, a, _fillBulkTemplate(tpl, a)),
    }));

    const result = await window.LineAPI.sendPersonalized({
      channel,
      targets: sendTargets,
      onProgress: ({ done, total, ok, fail }) => {
        btn.textContent = `⏳ ${done}/${total}`;
      },
    });

    if (result.fail === 0) {
      showToast(`✅ ส่งสำเร็จ ${result.ok}/${targets.length} คน`, "success");
    } else {
      showToast(`⚠️ สำเร็จ ${result.ok} · ล้มเหลว ${result.fail} คน — ดู console`, "error");
      console.warn("LINE push errors:", result.errors);
    }
  } catch (e) {
    showToast("ส่งไม่ได้: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ── Send tag detail per attendee (FLEX) ─────────────────────
// สำหรับคนที่ถูก filter อยู่ใน bulk modal: ส่ง flex bubble ที่มี detail ของ tag ที่ตัวเองมี
// คนติดหลาย tag = หลาย box ใน 1 bubble (สีตาม category)
// คนไม่มี tag / tag ไม่มี detail / ไม่มี LINE = skip
const FLEX_TAG_COLORS = {
  yellow: { bg: "#fef3c7", title: "#92400e", body: "#78350f" },
  blue:   { bg: "#dbeafe", title: "#1e40af", body: "#1e3a8a" },
  green:  { bg: "#d1fae5", title: "#047857", body: "#065f46" },
  pink:   { bg: "#fce7f3", title: "#be185d", body: "#9d174d" },
  purple: { bg: "#ede9fe", title: "#6d28d9", body: "#5b21b6" },
  red:    { bg: "#fee2e2", title: "#b91c1c", body: "#991b1b" },
  gray:   { bg: "#e2e8f0", title: "#475569", body: "#334155" },
};

function _buildTagDetailFlex(event, attendee, taggedItems) {
  const eventName = event?.event_name || "งานกิจกรรม";
  const dateText = event?.event_date ? _fmtDateTH(event.event_date) : "";
  const name = attendee.name || attendee.member_code || "";

  const tagBoxes = taggedItems.map((it) => {
    const c = FLEX_TAG_COLORS[it.color] || FLEX_TAG_COLORS.yellow;
    return {
      type: "box",
      layout: "vertical",
      margin: "md",
      paddingAll: "md",
      cornerRadius: "lg",
      backgroundColor: c.bg,
      contents: [
        {
          type: "text",
          text: `🏷️  ${it.name}`,
          weight: "bold",
          size: "sm",
          color: c.title,
          wrap: true,
        },
        {
          type: "text",
          text: it.detail,
          size: "xs",
          color: c.body,
          wrap: true,
          margin: "sm",
        },
      ],
    };
  });

  const headerContents = [
    {
      type: "text",
      text: "🏷️ ข้อมูลกิจกรรม",
      weight: "bold",
      size: "lg",
      color: "#ffffff",
    },
    {
      type: "text",
      text: eventName,
      size: "sm",
      color: "#e9d5ff",
      margin: "xs",
      wrap: true,
    },
  ];
  if (dateText) {
    headerContents.push({
      type: "text",
      text: `📅 ${dateText}`,
      size: "xs",
      color: "#e9d5ff",
      margin: "xs",
    });
  }

  const bubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      backgroundColor: "#7c3aed",
      contents: headerContents,
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
    altText: `🏷️ ${eventName} — ${taggedItems.map((t) => t.name).join(", ")}`,
    contents: bubble,
  };
}

window.sendBulkLineTagDetail = async function () {
  if (!window.LineAPI) { showToast("LINE module ยังไม่โหลด — refresh หน้า", "error"); return; }
  if (!window.ERPCrypto?.hasMasterKey()) { showToast("ตั้ง Master Key ในหน้า settings ก่อน", "error"); return; }
  if (!currentTagCategories.length) {
    showToast("ยังไม่มีหมวด Tag ใน event นี้", "error");
    return;
  }

  // Build category lookup: tag_name → { detail, color }
  const catByTag = {};
  currentTagCategories.forEach((c) => {
    const d = (c.detail || "").trim();
    if (d) {
      catByTag[c.tag_name] = {
        detail: d,
        color: TAG_COLOR_PRESETS.includes(c.color) ? c.color : "yellow",
      };
    }
  });
  if (!Object.keys(catByTag).length) {
    showToast("ยังไม่มีหมวด Tag ที่กรอกรายละเอียดไว้", "error");
    return;
  }

  // For each filtered attendee with LINE: build flex from their tags' details
  const pool = _bulkMsgTargets().filter((a) => a.line_user_id);
  const targets = [];
  let skipNoTag = 0, skipNoDetail = 0;
  pool.forEach((a) => {
    const tags = (a.tags || []).filter(Boolean);
    if (!tags.length) { skipNoTag++; return; }
    const items = tags
      .map((t) => catByTag[t] ? { name: t, ...catByTag[t] } : null)
      .filter(Boolean);
    if (!items.length) { skipNoDetail++; return; }
    targets.push({
      userId: a.line_user_id,
      message: _buildTagDetailFlex(currentEvent, a, items),
    });
  });

  if (!targets.length) {
    showToast("ไม่มีคนเข้าเงื่อนไข (ต้องมี LINE + tag ที่มี detail)", "error");
    return;
  }

  const ok = await (window.ConfirmModal
    ? window.ConfirmModal.open({
        icon: "🏷️",
        title: "ส่งข้อความ Tag (Flex)",
        message: `แต่ละคนจะได้ flex บัตรเฉพาะของตัวเองตาม tag ที่มี`,
        details: {
          "ส่งให้": `${targets.length} คน`,
          "ไม่มี tag": `${skipNoTag} คน (skip)`,
          "tag ไม่มี detail": `${skipNoDetail} คน (skip)`,
        },
        okText: "ส่งเลย",
        cancelText: "ยกเลิก",
        tone: "primary",
      })
    : Promise.resolve(confirm(`ส่ง flex tag detail ให้ ${targets.length} คน?`)));
  if (!ok) return;

  const btn = document.getElementById("btnBulkTagDetail");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = `⏳ 0/${targets.length}`;

  try {
    const channel = await window.LineAPI.getChannelForEvent(currentEvent);
    if (!channel) throw new Error("ไม่พบ LINE channel — ตั้งค่าในหน้า settings");

    const result = await window.LineAPI.sendPersonalized({
      channel,
      targets,
      onProgress: ({ done, total }) => { btn.textContent = `⏳ ${done}/${total}`; },
    });

    if (result.fail === 0) {
      showToast(`✅ ส่งสำเร็จ ${result.ok}/${targets.length} คน`, "success");
    } else {
      showToast(`⚠️ สำเร็จ ${result.ok} · ล้มเหลว ${result.fail} — ดู console`, "error");
      console.warn("LINE tag-detail flex errors:", result.errors);
    }
  } catch (e) {
    showToast("ส่งไม่ได้: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ═══════════════════════════════════════════════════════════
// AUTO-REFRESH — poll Supabase ทุก 20 วิ + เมื่อ tab โฟกัสกลับมา
// ข้ามการ refresh ถ้าผู้ใช้กำลังแก้ไข/เปิด modal/save ค้าง
// ═══════════════════════════════════════════════════════════
const AUTO_REFRESH_MS = 20000;
let _autoRefreshTimer = null;
let _refreshInFlight = false;

function startAutoRefresh() {
  if (_autoRefreshTimer) return;
  _autoRefreshTimer = setInterval(refreshAttendeesSilent, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshAttendeesSilent();
  });
  window.addEventListener("focus", refreshAttendeesSilent);
}

function _isUserBusy() {
  // 1) Any modal/overlay open → skip
  if (document.querySelector('[class*="-overlay"].open, [class*="-overlay"].show')) return true;
  // 2) User typing in a new-row (ยังไม่กด save)
  if (newRows.some((r) => r.name || r.phone || r.memberCode || r.saving)) return true;
  // 3) Focused input inside the saved-rows table (filter/edit)
  const act = document.activeElement;
  if (act && act.tagName === "INPUT" && act.closest("tbody")) return true;
  return false;
}

function _snapshotAttendees(arr) {
  return (arr || [])
    .map((a) =>
      [
        a.attendee_id,
        a.name || "",
        a.ticket_no || "",
        a.member_code || "",
        a.phone || "",
        a.payment_status || "",
        a.paid_amount || 0,
        a.position_level || "",
        a.checked_in ? 1 : 0,
        a.check_in_at || "",
        (a.tags || []).join("|"),
      ].join("¦"),
    )
    .join("‖");
}

async function refreshAttendeesSilent() {
  if (!currentEventId) return;
  if (_refreshInFlight) return;
  if (document.visibilityState === "hidden") return;
  if (_isUserBusy()) return;

  _refreshInFlight = true;
  try {
    const fresh = await fetchAttendees(currentEventId);
    if (!fresh) return;
    if (_snapshotAttendees(fresh) === _snapshotAttendees(allAttendees)) return;
    // Re-check busy before clobbering (user may have started editing mid-fetch)
    if (_isUserBusy()) return;

    const prevCheckedCount = allAttendees.filter((a) => a.checked_in).length;
    allAttendees = fresh;
    populateTagFilter();
    updateStats();
    filterTable();

    const newCheckedCount = fresh.filter((a) => a.checked_in).length;
    if (newCheckedCount > prevCheckedCount) {
      showToast(`🔄 มีคน check-in เพิ่ม (+${newCheckedCount - prevCheckedCount})`, "success");
    }
  } catch (e) {
    console.warn("auto-refresh failed:", e.message || e);
  } finally {
    _refreshInFlight = false;
  }
}

// ============================================================
// ── FLEXIBLE ATTENDEE FORM (guest + member edit) ────────────
// ── + UPLINE MASTER CRUD (in-context) ──────────────────────
// ============================================================
let _uplinesCache = null;      // [{id, name, sort_order, is_active}]
let _csStaffCache = null;      // distinct cs_staff values from current event
let _csDeptUsersCache = null;  // [{full_name}] — users in CS department (cached)
let _csStaffHighlight = -1;    // keyboard navigation index
let _attFormState = {          // current modal session
  mode: "new",                 // "new" | "edit"
  attId: null,
  memberCode: "",
  personRole: "",
  paymentStatus: "UNPAID",     // carried forward when creating from search row
};

// Async: fetch ข้อมูลสมาชิก (ตำแหน่ง + เบอร์โทร) จาก members + test_members → ใส่ใน form
//   Position priority: position_level (สูงสุด) → position (ปัจจุบัน) → package
//   ทับค่าเฉพาะถ้า fetch เจอ + รหัสยังตรงกัน (กัน race ตอน user สลับสมาชิก)
async function _autofillMemberInfo(memberCode) {
  try {
    const cols = "position_level,position,package,phone";
    const code = encodeURIComponent(memberCode);
    const [mlm, test] = await Promise.all([
      sbFetch("members",      `?member_code=eq.${code}&select=${cols}`).catch(() => []),
      sbFetch("test_members", `?member_code=eq.${code}&select=${cols}`).catch(() => []),
    ]);
    const m = (mlm && mlm[0]) || (test && test[0]);
    if (!m) { console.warn("autofill: no member row for", memberCode); return; }
    // race guard — user อาจสลับสมาชิกระหว่างรอ fetch
    const codeInp = document.getElementById("attFormMemberCode");
    if (codeInp?.value !== memberCode) return;

    // ── ตำแหน่ง ──
    const pos = (m.position_level && String(m.position_level).trim())
      || (m.position && String(m.position).trim())
      || (m.package && String(m.package).trim())
      || "";
    if (pos) {
      const posInp = document.getElementById("attFormPos");
      if (posInp) posInp.value = pos;
    } else {
      console.warn("autofill: member", memberCode, "has empty position_level/position/package");
    }

    // ── เบอร์โทร ── เติมเฉพาะถ้า field ยังว่าง (ไม่ทับค่าที่ search dropdown ส่งมา)
    if (m.phone && String(m.phone).trim()) {
      const phoneInp = document.getElementById("attFormPhone");
      if (phoneInp && !phoneInp.value.trim()) {
        phoneInp.value = String(m.phone).trim();
      }
    }
  } catch (e) {
    console.warn("autofill member info:", e.message);
  }
}

// Async: traverse upline chain หา SVP คนแรก (ใกล้สุด) → match upline_leaders → auto-select dropdown
//   max depth 20 levels (สูงพอสำหรับ MLM ทั่วไป)
async function _autofillMemberUpline(memberCode) {
  try {
    const svp = await _findNearestSVPUpline(memberCode);
    if (!svp) {
      console.warn("autofill upline: no SVP found in chain for", memberCode);
      return;
    }
    const uplines = await fetchUplines();
    let match = null;
    // 1) exact match by member_code (ถ้า upline_leaders มี link)
    if (svp.member_code) {
      match = uplines.find(u => u.member_code === svp.member_code);
    }
    // 2) fuzzy match by name (ชื่อ SVP มีคำที่ตรงกับ upline_leaders.name)
    if (!match) {
      const svpName = (svp.full_name || svp.member_name || "").trim().toLowerCase();
      if (svpName) {
        match = uplines.find(u => {
          const un = (u.name || "").trim().toLowerCase();
          if (!un) return false;
          return svpName.includes(un) || un.includes(svpName);
        });
      }
    }
    if (!match) {
      console.warn("autofill upline: SVP", svp.full_name || svp.member_code, "ไม่ตรงกับ upline_leaders ใดๆ");
      return;
    }
    const sel = document.getElementById("attFormUpline");
    const codeInp = document.getElementById("attFormMemberCode");
    if (sel && codeInp?.value === memberCode && !sel.value) {
      sel.value = String(match.id);
    }
  } catch (e) {
    console.warn("autofill member upline:", e.message);
  }
}

// Walk **sponsor_code** chain (ผังแนะนำ — "สายงาน") หา SVP ที่ใกล้สุด — ลึกสูงสุด 20 ระดับ
//   ⚠️ ไม่ใช่ upline_code (Binary tree — ตำแหน่งซ้าย/ขวา) เพราะ "สายงาน" คือสาย sponsor
async function _findNearestSVPUpline(memberCode, maxDepth = 20) {
  // Start: ดึง sponsor_code ของสมาชิก (ไม่นับ member เองว่าเป็น SVP)
  const startRows = await sbFetch(
    "members",
    `?member_code=eq.${encodeURIComponent(memberCode)}&select=sponsor_code`
  ).catch(() => []);
  let current = startRows?.[0]?.sponsor_code;
  if (!current) return null;
  for (let i = 0; i < maxDepth; i++) {
    const rows = await sbFetch(
      "members",
      `?member_code=eq.${encodeURIComponent(current)}&select=member_code,full_name,member_name,position_level,sponsor_code`
    ).catch(() => []);
    const m = rows?.[0];
    if (!m) return null;
    if (m.position_level === "SVP") return m;
    if (!m.sponsor_code || m.sponsor_code === current) return null;  // กัน loop
    current = m.sponsor_code;
  }
  return null;
}

// แสดงสายงานอัตโนมัติในฟอร์ม (ไล่สาย MLM ตาม config upline_levels) — read-only chip ใต้ dropdown
async function _autofillUplineLevelDisplay(memberCode) {
  const box = document.getElementById("attFormUplineAuto");
  _attFormState.uplineAutoName = null;
  if (!box) return;
  const code = String(memberCode || "").trim();
  if (!code) { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "";
  box.className = "aff-upline-auto searching";
  box.textContent = "⏳ ตรวจสายงานอัตโนมัติ…";
  let match = null;
  try { match = await _detectUplineLevel(code); } catch (e) { console.warn("autofill upline level:", e.message); }
  // race guard — user อาจสลับสมาชิกระหว่างรอ
  const codeInp = document.getElementById("attFormMemberCode");
  if (codeInp && codeInp.value !== code) return;
  if (match) {
    const label = match.nickname ? `${match.name} (${match.nickname})` : match.name;
    _attFormState.uplineAutoName = match.nickname || match.name;
    box.className = "aff-upline-auto found";
    box.innerHTML = `<span class="aff-upline-auto-chip" style="background:${escapeHtml(match.color || "#e0e7ff")}">🌿 ${escapeHtml(label)} · ระดับ ${match.level}</span>
      <span class="aff-upline-auto-hint">ตรวจอัตโนมัติจากสายงาน (รหัสสมาชิก)</span>`;
  } else {
    box.className = "aff-upline-auto none";
    box.innerHTML = `<span class="aff-upline-auto-hint">— ไม่พบสายงานในระบบตามรหัสสมาชิก —</span>`;
  }
}

// ชื่อสั้นของ user ปัจจุบัน (สำหรับ default CS field)
// Priority:
//   1. ตัวอักษรไทยใน full_name / first_name / last_name (เช่น "Admin ภพ" → "ภพ")
//   2. first_name (ถ้าไม่มีไทย)
//   3. คำแรกของ full_name
//   4. username
function _getCurrentUserShortName() {
  const u = window.ERP_USER;
  if (!u) return "";
  const candidates = [u.full_name, u.first_name, u.last_name, u.nickname].filter(Boolean);
  // 1) หาส่วนภาษาไทยใน fields ใดๆ → ใช้ก่อน
  for (const s of candidates) {
    const thaiMatch = String(s).match(/[฀-๿]+/g);
    if (thaiMatch && thaiMatch.length) {
      return thaiMatch.join("").trim();
    }
  }
  // 2) ไม่มีไทย → fallback ตามเดิม
  if (u.first_name && u.first_name.trim()) return u.first_name.trim();
  if (u.full_name && u.full_name.trim()) {
    const parts = u.full_name.trim().split(/\s+/);
    return parts[0] || "";
  }
  return u.username || "";
}

async function fetchUplines() {
  if (_uplinesCache) return _uplinesCache;
  try {
    const rows = await sbFetch(
      "upline_leaders",
      "?select=id,name,member_code,sort_order,is_active&order=sort_order.asc,name.asc"
    );
    _uplinesCache = rows || [];
  } catch (e) {
    console.warn("fetchUplines:", e.message);
    _uplinesCache = [];
  }
  return _uplinesCache;
}

function _invalidateUplinesCache() { _uplinesCache = null; }

/* ============================================================
   🌿 ตั้งค่าสายงาน (Upline Levels) — config กลางใน app_settings
   - value = JSON array; index 0 → ระดับ 1 (priority สูงสุด)
   - แต่ละระดับ: { color, leaders:[{code,name}] }
   - จับสายด้วยการไล่ members.sponsor_code ขึ้นไปจาก member_code ของผู้เข้าร่วม
   ============================================================ */
let _uplineLevelsCache = undefined;   // undefined=ยังไม่โหลด · array=config
let _uplineMatchByCode = {};          // member_code → { level, color, name } (ต่อ event ปัจจุบัน)
let _sponsorCache = {};               // member_code → sponsor_code (session cache · กัน query ซ้ำตอนไล่สาย)

async function fetchUplineLevels(force) {
  if (_uplineLevelsCache !== undefined && !force) return _uplineLevelsCache;
  try {
    const rows = await sbFetch("app_settings", "?key=eq.upline_levels&select=value");
    const raw = rows?.[0]?.value;
    const parsed = raw ? JSON.parse(raw) : [];
    _uplineLevelsCache = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("fetchUplineLevels:", e.message);
    _uplineLevelsCache = [];
  }
  return _uplineLevelsCache;
}

async function saveUplineLevels(levels) {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/app_settings?on_conflict=key`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ key: "upline_levels", value: JSON.stringify(levels || []) }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "บันทึกไม่ได้");
  }
  _uplineLevelsCache = Array.isArray(levels) ? levels : [];
}

// ไล่สาย MLM: member_code → members.sponsor_code ขึ้นไป จับ leader code ของแต่ละระดับ
// (ระดับเลขน้อยชนะเมื่อพบหลายระดับในสายเดียวกัน → ระดับ 1 มาก่อน)
// code → { level, color, name, nickname } จาก config (ระดับน้อย = priority สูง · เจอซ้ำใช้ครั้งแรก)
function _buildLeaderLevelMap(levels) {
  const map = {};
  (levels || []).forEach((lv, idx) => {
    (lv?.leaders || []).forEach((ld, lidx) => {
      const code = String(ld?.code || "").trim();
      if (code && !map[code]) {
        map[code] = { level: idx + 1, order: lidx, color: ld.color || _colorFromCode(code), name: ld.name || code, nickname: ld.nickname || "" };
      }
    });
  });
  return map;
}

// ตรวจสายงานของรหัสเดียว — ไล่ members.sponsor_code ขึ้นไป คืน match ระดับดีสุด (เลขน้อยสุด) หรือ null
async function _detectUplineLevel(memberCode) {
  const code0 = String(memberCode || "").trim();
  if (!code0) return null;
  const leaderLevel = _buildLeaderLevelMap(await fetchUplineLevels());
  if (!Object.keys(leaderLevel).length) return null;
  let cur = code0, steps = 0, best = null;
  const seen = new Set();
  const MAX_DEPTH = 60;
  while (cur && !seen.has(cur) && steps < MAX_DEPTH) {
    seen.add(cur); steps++;
    const hit = leaderLevel[cur];
    if (hit && (!best || hit.level < best.level)) best = hit;
    if (best && best.level === 1) break;   // ดีสุดแล้ว ไม่ต้องไล่ต่อ
    if (!(cur in _sponsorCache)) {
      try {
        const rows = await sbFetch("members", `?member_code=eq.${encodeURIComponent(cur)}&select=sponsor_code&limit=1`);
        _sponsorCache[cur] = rows?.[0]?.sponsor_code ? String(rows[0].sponsor_code).trim() : null;
      } catch (e) { break; }
    }
    cur = _sponsorCache[cur];
  }
  return best;
}

async function computeUplineMatches() {
  _uplineMatchByCode = {};
  const levels = await fetchUplineLevels(true);   // ดึงสดเสมอ — กัน config ค้าง (สี/ระดับล่าสุด)
  if (!levels || !levels.length) return;

  const leaderLevel = _buildLeaderLevelMap(levels);
  if (!Object.keys(leaderLevel).length) return;

  const startCodes = [...new Set((allAttendees || [])
    .map(a => String(a.member_code || "").trim()).filter(Boolean))];
  if (!startCodes.length) return;

  // BFS ขึ้น tree แบบ batched — เก็บใน _sponsorCache (session) เพื่อไม่ query ซ้ำเวลาเพิ่มคนใหม่
  let frontier = startCodes.filter(c => !(c in _sponsorCache));
  const MAX_DEPTH = 60;
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const need = [...new Set(frontier.filter(c => !(c in _sponsorCache)))];
    if (!need.length) break;
    const inList = need.map(c => encodeURIComponent(c)).join(",");
    let rows = [];
    try {
      rows = await sbFetch("members", `?member_code=in.(${inList})&select=member_code,sponsor_code`) || [];
    } catch (e) {
      console.warn("computeUplineMatches members:", e.message);
      break;
    }
    const found = {};
    rows.forEach(r => {
      const code = String(r.member_code || "").trim();
      found[code] = r.sponsor_code ? String(r.sponsor_code).trim() : null;
    });
    // code ที่ query แล้วไม่เจอ row → cache เป็น null กันไล่ซ้ำ
    need.forEach(c => { _sponsorCache[c] = (c in found) ? found[c] : null; });
    frontier = need.map(c => _sponsorCache[c]).filter(sp => sp && !(sp in _sponsorCache));
  }

  // walk ขึ้นจากแต่ละ attendee เก็บระดับที่ดีที่สุด (เลขน้อยสุด)
  startCodes.forEach(code => {
    let cur = code, steps = 0, best = null;
    const seen = new Set();
    while (cur && !seen.has(cur) && steps < MAX_DEPTH) {
      seen.add(cur); steps++;
      const hit = leaderLevel[cur];
      if (hit && (!best || hit.level < best.level)) best = hit;
      cur = _sponsorCache[cur] || null;
    }
    if (best) _uplineMatchByCode[code] = best;
  });
}

function _uplineMatchFor(a) {
  const code = String(a?.member_code || "").trim();
  return code ? _uplineMatchByCode[code] : null;
}

// เรียงสายงาน: ระดับล่างสุด (เลขมากสุด) บนสุด → ในระดับเรียงตามลำดับรหัสหัวหน้าทีม → ไม่จับสายไว้ท้าย
function _sortByUplineLevel(list) {
  if (!Object.keys(_uplineMatchByCode).length) return list;
  return list
    .map((a, i) => {
      const m = _uplineMatchFor(a);
      return { a, i, lv: m ? m.level : -1, ord: m ? m.order : 0 };
    })
    .sort((x, y) => (y.lv - x.lv) || (x.ord - y.ord) || (x.i - y.i))
    .map(o => o.a);
}

/* ── 🌿 ตั้งค่าสายงาน — Modal ──────────────────────────────── */
const UL_LEVEL_COLORS = ["#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#a5f3fc", "#bfdbfe", "#ddd6fe", "#fbcfe8"];
let _ulDraft = [];   // working copy: [{ color, leaders:[{code,name,nickname,color}] }]

function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
// สีเฉดอ่อนคงที่จากรหัส (deterministic) — คนเดียวกันได้สีเดิมเสมอ + ป็อปอัป/ตารางตรงกันโดยไม่ต้อง save
function _colorFromCode(code) {
  const s = String(code || "");
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return _hslToHex(h, 72, 88);
}

window.openUplineLevelsModal = function () {
  const m = document.getElementById("uplineLevelsModal");
  if (!m) return;
  fetchUplineLevels(true).then(levels => {
    _ulDraft = (Array.isArray(levels) ? levels : []).map(lv => ({
      color: lv.color || "#e0e7ff",
      leaders: (lv.leaders || []).map(ld => ({
        code: String(ld.code || "").trim(), name: ld.name || "", nickname: ld.nickname || "",
        color: ld.color || _colorFromCode(ld.code),   // เก่ายังไม่มีสีรายคน → derive จากรหัส (ตรงกับตาราง)
      })),
    }));
    _renderUplineLevels();
    m.classList.add("open");
  }).catch(e => showToast("โหลดค่าสายงานไม่ได้: " + e.message, "error"));
};

window.closeUplineLevelsModal = function (ev) {
  if (ev && ev.target !== ev.currentTarget) return;
  document.getElementById("uplineLevelsModal")?.classList.remove("open");
};

window.addUplineLevel = function () {
  _ulDraft.push({ color: UL_LEVEL_COLORS[_ulDraft.length % UL_LEVEL_COLORS.length], leaders: [] });
  _renderUplineLevels();
};

window.removeUplineLevel = function (idx) {
  _ulDraft.splice(idx, 1);
  _renderUplineLevels();
};

window.setUplineLevelColor = function (idx, color) {
  if (_ulDraft[idx]) _ulDraft[idx].color = color;
  _renderUplineLevels();
};

window.removeUplineLeader = function (levelIdx, leaderIdx) {
  _ulDraft[levelIdx]?.leaders.splice(leaderIdx, 1);
  _renderUplineLevels();
};

// ชื่อเล่น (กรอกเอง) — อัปเดต draft โดยไม่ re-render (กันเสีย focus ระหว่างพิมพ์)
window.setUplineLeaderNick = function (levelIdx, leaderIdx, val) {
  const ld = _ulDraft[levelIdx]?.leaders?.[leaderIdx];
  if (ld) ld.nickname = (val || "").trim();
};

// สีประจำคน (สุ่มอ่อน · แก้ได้) — ใช้เป็นพื้นหลังช่อง "สายงาน" ในตาราง
window.setUplineLeaderColor = function (levelIdx, leaderIdx, val) {
  const ld = _ulDraft[levelIdx]?.leaders?.[leaderIdx];
  if (ld) ld.color = val;
};

// lookup ชื่อสมาชิกจากรหัส (cache กันยิงซ้ำ)
const _ulNameCache = {};
let _ulPreviewTimer = null;
async function _lookupMemberName(code) {
  code = String(code || "").trim();
  if (!code) return "";
  if (code in _ulNameCache) return _ulNameCache[code];
  let name = "";
  try {
    const rows = await sbFetch("members",
      `?member_code=eq.${encodeURIComponent(code)}&select=full_name,member_name&limit=1`);
    const mb = rows?.[0];
    if (mb) name = (mb.full_name || mb.member_name || "").trim();
  } catch (e) { console.warn("_lookupMemberName:", e.message); }
  _ulNameCache[code] = name;
  return name;
}

// แสดงชื่อทันทีขณะพิมพ์รหัส (debounce)
window.previewUplineLeader = function (idx, val) {
  const prev = document.getElementById(`ulLeaderPreview_${idx}`);
  if (!prev) return;
  const code = (val || "").trim();
  if (!code) { prev.textContent = ""; prev.className = "ul-leader-preview"; return; }
  prev.textContent = "⏳ กำลังค้นหา…";
  prev.className = "ul-leader-preview searching";
  clearTimeout(_ulPreviewTimer);
  _ulPreviewTimer = setTimeout(async () => {
    const name = await _lookupMemberName(code);
    const input = document.getElementById(`ulLeaderInput_${idx}`);
    if (!input || input.value.trim() !== code) return;   // value เปลี่ยนระหว่างรอ → ทิ้ง
    if (name) { prev.textContent = `✓ ${name}`; prev.className = "ul-leader-preview found"; }
    else { prev.textContent = "✕ ไม่พบสมาชิกรหัสนี้"; prev.className = "ul-leader-preview notfound"; }
  }, 300);
};

window.addUplineLeader = async function (idx) {
  const input = document.getElementById(`ulLeaderInput_${idx}`);
  if (!input || !_ulDraft[idx]) return;
  const code = (input.value || "").trim();
  if (!code) return;
  if ((_ulDraft[idx].leaders || []).some(l => String(l.code).trim() === code)) {
    showToast("รหัสนี้มีอยู่แล้วในระดับนี้", "error");
    return;
  }
  const name = await _lookupMemberName(code);
  _ulDraft[idx].leaders = _ulDraft[idx].leaders || [];
  _ulDraft[idx].leaders.push({ code, name, nickname: "", color: _colorFromCode(code) });
  input.value = "";
  _renderUplineLevels();
  document.getElementById(`ulLeaderInput_${idx}`)?.focus();
  if (!name) showToast(`เพิ่มรหัส ${code} แล้ว — ไม่พบชื่อสมาชิกของรหัสนี้`, "error");
};

window.saveUplineLevelsModal = async function () {
  // ตัดระดับที่ไม่มี leader เลย + normalize
  const clean = _ulDraft
    .map(lv => ({
      color: lv.color || "#e0e7ff",
      leaders: (lv.leaders || [])
        .filter(l => String(l.code || "").trim())
        .map(l => ({ code: String(l.code).trim(), name: l.name || "", nickname: (l.nickname || "").trim(), color: l.color || _colorFromCode(l.code) })),
    }))
    .filter(lv => lv.leaders.length);
  try {
    await saveUplineLevels(clean);
    showToast("บันทึกค่าสายงานแล้ว", "success");
    window.closeUplineLevelsModal();
    await computeUplineMatches();   // recompute ด้วย config ใหม่
    filterTable();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
};

function _renderUplineLevels() {
  const wrap = document.getElementById("uplineLevelsList");
  if (!wrap) return;
  if (!_ulDraft.length) {
    wrap.innerHTML = `<div class="ul-empty">ยังไม่มีระดับ — กด "เพิ่มระดับ" เพื่อเริ่ม</div>`;
    return;
  }
  wrap.innerHTML = _ulDraft.map((lv, i) => {
    const color = lv.color || "#e0e7ff";
    const rows = (lv.leaders || []).map((ld, j) => `
      <tr>
        <td class="ul-tcode"><span class="ul-leader-code">${escapeHtml(ld.code || "")}</span></td>
        <td class="ul-tname">${ld.name ? escapeHtml(ld.name) : `<span class="ul-tdim">— ไม่พบในระบบ —</span>`}</td>
        <td class="ul-tnick"><input type="text" class="ul-nick-input" value="${escapeHtml(ld.nickname || "")}"
          placeholder="ชื่อเล่น" maxlength="40" onchange="window.setUplineLeaderNick(${i},${j},this.value)"></td>
        <td class="ul-tcolor"><input type="color" class="ul-color-dot" value="${escapeHtml(ld.color || "#e0e7ff")}"
          title="สีประจำคนนี้ (พื้นหลังช่องสายงาน)" onchange="window.setUplineLeaderColor(${i},${j},this.value)"></td>
        <td class="ul-tdel"><button onclick="window.removeUplineLeader(${i},${j})" title="ลบรหัสนี้">✕</button></td>
      </tr>`).join("");
    const table = (lv.leaders || []).length
      ? `<table class="ul-leader-table">
           <thead><tr><th>รหัส</th><th>ชื่อ <small>(จากระบบ)</small></th><th>ชื่อเล่น <small>(กรอกเอง)</small></th><th>สี</th><th></th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      : `<div class="ul-leaders-empty">ยังไม่มีรหัสหัวหน้าทีม</div>`;
    return `
    <div class="ul-level-card" style="border-left:5px solid ${escapeHtml(color)}">
      <div class="ul-level-hdr">
        <span class="ul-level-badge" style="background:${escapeHtml(color)}">ระดับ ${i + 1}</span>
        <label class="ul-color-lbl">สี
          <input type="color" value="${escapeHtml(color)}" onchange="window.setUplineLevelColor(${i}, this.value)">
        </label>
        <span class="ul-flex-spacer"></span>
        <button class="ul-del-level" onclick="window.removeUplineLevel(${i})" title="ลบระดับนี้">🗑 ลบระดับ</button>
      </div>
      <div class="ul-leaders">${table}</div>
      <div class="ul-add-leader">
        <input type="text" id="ulLeaderInput_${i}" class="form-input" placeholder="ใส่รหัสสมาชิกหัวหน้าทีม แล้ว Enter"
          oninput="window.previewUplineLeader(${i}, this.value)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();window.addUplineLeader(${i})}">
        <button onclick="window.addUplineLeader(${i})">+ เพิ่มรหัส</button>
      </div>
      <div id="ulLeaderPreview_${i}" class="ul-leader-preview"></div>
    </div>`;
  }).join("");
}

// Build set of distinct CS-staff values from currently-loaded attendees (= legacy/free-text)
function _refreshCsStaffDatalist() {
  const set = new Set();
  (allAttendees || []).forEach(a => { if (a.cs_staff) set.add(a.cs_staff); });
  _csStaffCache = [...set].sort();
}

// Fetch users in CS department — cached
// 2-tier strategy:
//   1) users.department = "CS" (newer pattern)
//   2) fallback: role prefix "CS" via role_configs (เผื่อ users ยังไม่ได้ migrate dept code)
async function _loadCsDeptUsers() {
  if (Array.isArray(_csDeptUsersCache)) return _csDeptUsersCache;
  const collected = new Map(); // full_name → true (dedup)
  try {
    // Tier 1 — by department column
    const byDept = await sbFetch(
      "users",
      `?select=full_name,is_active,department&department=eq.CS&order=full_name.asc`
    );
    (byDept || []).forEach(r => {
      if (r.is_active === false) return;
      const n = (r.full_name || "").trim();
      if (n) collected.set(n, true);
    });
    console.info("[CS-staff] tier1 (dept=CS):", byDept?.length || 0);
  } catch (e) {
    console.warn("[CS-staff] tier1 failed:", e.message);
  }
  try {
    // Tier 2 — by role prefix (CS*) via role_configs
    const cfgs = await sbFetch(
      "role_configs",
      `?select=role_key,label`
    );
    const csKeys = (cfgs || [])
      .filter(c => /^CS/i.test(c.role_key || "") || /^CS/i.test(c.label || ""))
      .map(c => c.role_key)
      .filter(Boolean);
    if (csKeys.length) {
      const inList = csKeys.map(k => encodeURIComponent(k)).join(",");
      const byRole = await sbFetch(
        "users",
        `?select=full_name,is_active,role&role=in.(${inList})&order=full_name.asc`
      );
      (byRole || []).forEach(r => {
        if (r.is_active === false) return;
        const n = (r.full_name || "").trim();
        if (n) collected.set(n, true);
      });
      console.info("[CS-staff] tier2 (role in", csKeys, "):", byRole?.length || 0);
    }
  } catch (e) {
    console.warn("[CS-staff] tier2 failed:", e.message);
  }
  _csDeptUsersCache = [...collected.keys()].sort((a, b) => a.localeCompare(b, "th"));
  console.info("[CS-staff] final cache:", _csDeptUsersCache);
  return _csDeptUsersCache;
}
function _invalidateCsDeptUsersCache() { _csDeptUsersCache = null; }

// Combine dept users (primary) + legacy values (fallback) without duplicates
function _csStaffCombined() {
  const dept = (_csDeptUsersCache || []).slice();
  const legacy = (_csStaffCache || []).filter(v => !dept.includes(v));
  return { dept, legacy };
}

function _renderCsSuggest(q) {
  const box = document.getElementById("csStaffSuggest");
  if (!box) return;
  const needle = (q || "").trim().toLowerCase();
  const { dept, legacy } = _csStaffCombined();
  const filterFn = v => !needle || v.toLowerCase().includes(needle);
  const deptM = dept.filter(filterFn);
  const legacyM = legacy.filter(filterFn);
  let html = "";
  if (deptM.length) {
    html += `<div class="cs-group-label">👤 พนักงานแผนก CS</div>`;
    html += deptM.map((v, i) => _csItemHtml(v, "dept", i)).join("");
  }
  if (legacyM.length) {
    html += `<div class="cs-group-label">📜 ใช้ในอีเวนต์อื่น</div>`;
    html += legacyM.map((v, i) => _csItemHtml(v, "legacy", deptM.length + i)).join("");
  }
  if (!deptM.length && !legacyM.length) {
    html = `<div class="cs-empty">ไม่มีรายชื่อตรงกับ "${escapeHtml(q || "")}" — พิมพ์เพื่อบันทึกแบบกำหนดเอง</div>`;
  }
  box.innerHTML = html;
  box.style.display = "block";
  _csStaffHighlight = -1;
}

function _csItemHtml(name, kind, idx) {
  const safe = escapeHtml(name).replace(/'/g, "&#39;");
  const tag = kind === "dept"
    ? `<span class="cs-tag">CS</span>`
    : `<span class="cs-tag legacy">เก่า</span>`;
  return `<div class="cs-item" data-idx="${idx}" data-val="${safe}"
    onmousedown="event.preventDefault();window._csStaffSelect('${safe}')"
    onmouseover="window._csStaffSetHL(${idx})">
    <span class="cs-icon">${kind === "dept" ? "👤" : "🕘"}</span>
    <span class="cs-name">${escapeHtml(name)}</span>
    ${tag}
  </div>`;
}

window._csStaffShow = function () {
  // Lazy-load CS dept users on first focus (cached after that)
  _loadCsDeptUsers().then(() => {
    const inp = document.getElementById("attFormCs");
    _renderCsSuggest(inp?.value || "");
  });
};
window._csStaffFilter = function () {
  const inp = document.getElementById("attFormCs");
  _renderCsSuggest(inp?.value || "");
};
window._csStaffBlur = function () {
  // Delay to allow click on suggestion to register first
  setTimeout(() => {
    const box = document.getElementById("csStaffSuggest");
    if (box) box.style.display = "none";
  }, 150);
};
window._csStaffSelect = function (name) {
  const inp = document.getElementById("attFormCs");
  if (inp) inp.value = name;
  const box = document.getElementById("csStaffSuggest");
  if (box) box.style.display = "none";
};
window._csStaffSetHL = function (idx) {
  _csStaffHighlight = idx;
  const box = document.getElementById("csStaffSuggest");
  if (!box) return;
  box.querySelectorAll(".cs-item").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.idx) === idx);
  });
};
window._csStaffKey = function (ev) {
  const box = document.getElementById("csStaffSuggest");
  if (!box || box.style.display === "none") return;
  const items = [...box.querySelectorAll(".cs-item")];
  if (!items.length) return;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    const next = Math.min(items.length - 1, _csStaffHighlight + 1);
    window._csStaffSetHL(next);
    items[next]?.scrollIntoView({ block: "nearest" });
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    const next = Math.max(0, _csStaffHighlight - 1);
    window._csStaffSetHL(next);
    items[next]?.scrollIntoView({ block: "nearest" });
  } else if (ev.key === "Enter") {
    if (_csStaffHighlight >= 0 && items[_csStaffHighlight]) {
      ev.preventDefault();
      window._csStaffSelect(items[_csStaffHighlight].dataset.val);
    }
  } else if (ev.key === "Escape") {
    box.style.display = "none";
  }
};

// ── Event field config ─────────────────────────────────────
// Default = all fields shown, none required (except upline & name)
// field_order = ลำดับ column ในตาราง spreadsheet · drag-reorder ใน config modal
const DEFAULT_FIELD_ORDER = ["phone", "position", "upline", "referrer", "cs_staff", "line_name", "fb_page_name", "had_attended", "note"];
// show   = แสดงในฟอร์ม add/edit หลังบ้าน (back-office)
// column = แสดงเป็น column ในตาราง attendees (ปรับแยกได้)
// column undefined → fallback ใช้ค่า show (backward compat กับ config เดิม)
const DEFAULT_FIELD_CONFIG = {
  fields: {
    phone:        { show: true,  required: false, column: true  },
    position:     { show: true,  required: false, column: true  },
    upline:       { show: true,  required: true,  column: true  },
    referrer:     { show: true,  required: false, column: true  },
    cs_staff:     { show: true,  required: false, column: true  },
    line_name:    { show: true,  required: false, column: true  },
    fb_page_name: { show: true,  required: false, column: true  },
    had_attended: { show: true,  required: false, column: true  },
    note:         { show: true,  required: false, column: true  },
  },
  field_order: DEFAULT_FIELD_ORDER.slice(),
  hidden_keys: [],
  custom_fields: [],
  qualifications: [],
};

// ใช้เมื่อ "ไม่มี Default template เลย" (และ event ไม่ได้เลือก/override)
// → ตารางเหลือแค่คอลัมน์หลัก (ชื่อ/ชำระ/check-in/จัดการ) + banner ให้ไปตั้ง Default
// (กันไม่ให้ dump 9 คอลัมน์ default ออกมาเป็นช่องว่างเกะกะแบบเดิม)
const EMPTY_FIELD_CONFIG = {
  fields: {},
  field_order: [],
  hidden_keys: [],
  custom_fields: [],
  qualifications: [],
};

let _eventConfigCache = null;   // { eventId, config, source, templateId, templateName }

// Default template (ฟอร์มกลางที่ใช้กับทุกงาน) — cache ทั้งหน้า
// undefined = ยังไม่ได้ดึง · null = ไม่มี default · object = { id, name, config }
let _defaultTemplateCache = undefined;
async function _fetchDefaultTemplate(force) {
  if (_defaultTemplateCache !== undefined && !force) return _defaultTemplateCache;
  try {
    const rows = await sbFetch(
      "attendee_form_templates",
      "?is_default=eq.true&is_active=eq.true&select=id,name,config&limit=1"
    );
    _defaultTemplateCache = rows?.[0] || null;
  } catch (e) {
    console.warn("_fetchDefaultTemplate:", e.message);
    _defaultTemplateCache = null;
  }
  return _defaultTemplateCache;
}

// Resolve effective config (hybrid: override > template ของ event > Default template > none)
async function fetchEventFieldConfig(eventId) {
  if (_eventConfigCache && _eventConfigCache.eventId === eventId) return _eventConfigCache.config;
  const info = await _resolveFieldConfigInfo(eventId);
  _eventConfigCache = { eventId, ...info };
  return info.config;
}

// Returns { config, source, templateId, templateName, override, templateConfig }
//   source = "override" | "template" | "default"
async function _resolveFieldConfigInfo(eventId) {
  let override = null;
  let templateId = null;
  let templateName = null;
  let templateConfig = null;
  try {
    const rows = await sbFetch(
      "events",
      `?event_id=eq.${eventId}&select=attendee_field_config,template_id`
    );
    override = rows?.[0]?.attendee_field_config;
    templateId = rows?.[0]?.template_id || null;
  } catch (e) {
    console.warn("_resolveFieldConfigInfo:", e.message);
  }
  if (templateId) {
    try {
      const trows = await sbFetch(
        "attendee_form_templates",
        `?id=eq.${templateId}&select=name,config`
      );
      templateName = trows?.[0]?.name || null;
      templateConfig = trows?.[0]?.config || null;
    } catch (e) {
      console.warn("_resolveFieldConfigInfo template:", e.message);
    }
  }
  const hasOverride = override && typeof override === "object" && Object.keys(override).length > 0;
  let config, source, rawConfig = null;
  if (hasOverride) {
    config = _mergeFieldConfig(override);
    source = "override";
    rawConfig = override;
  } else if (templateConfig) {
    config = _mergeFieldConfig(templateConfig);
    source = "template";
    rawConfig = templateConfig;
  } else {
    // ไม่มี override + event ไม่ได้เลือก template → ใช้ Default template (ฟอร์มกลาง)
    const def = await _fetchDefaultTemplate();
    if (def && def.config) {
      config = _mergeFieldConfig(def.config);
      source = "default";
      templateName = def.name;       // ชื่อ default (ใช้ใน banner) — ไม่ set templateId เพราะ event ไม่ได้ link
      templateConfig = def.config;
      rawConfig = def.config;
    } else {
      // ไม่มี Default template เลย → ตารางว่าง + banner ให้ไปตั้งค่า
      config = EMPTY_FIELD_CONFIG;
      source = "none";
    }
  }
  // blocks (layout ฟอร์ม) — derive จาก raw config (ใช้ blocks ถ้ามี ไม่งั้นแปลงจาก flat)
  const blocks = (source === "none" || !window.AttendeeFields)
    ? []
    : window.AttendeeFields.ensureBlocks(rawConfig);
  return { config, source, templateId, templateName, override, templateConfig, blocks };
}

function _invalidateEventConfigCache() { _eventConfigCache = null; }

async function getEventConfigInfo(eventId) {
  if (_eventConfigCache && _eventConfigCache.eventId === eventId) return _eventConfigCache;
  const info = await _resolveFieldConfigInfo(eventId);
  _eventConfigCache = { eventId, ...info };
  return _eventConfigCache;
}

function _mergeFieldConfig(custom) {
  if (!custom || typeof custom !== "object") return DEFAULT_FIELD_CONFIG;
  const fields = {};
  // deep-clone defaults (กันแก้ object เดิม)
  Object.keys(DEFAULT_FIELD_CONFIG.fields).forEach(k => {
    fields[k] = { ...DEFAULT_FIELD_CONFIG.fields[k] };
  });
  if (custom.fields && typeof custom.fields === "object") {
    Object.keys(custom.fields).forEach(k => {
      fields[k] = { ...(fields[k] || {}), ...custom.fields[k] };
    });
  }
  // hidden_keys[] — มาตรฐานที่ผู้ใช้กดลบไว้ (กัน auto-restore)
  const hidden_keys = Array.isArray(custom.hidden_keys)
    ? custom.hidden_keys.filter(k => DEFAULT_FIELD_ORDER.includes(k))
    : [];
  // บังคับ show:false สำหรับ hidden_keys → form/table จะซ่อนทันที
  hidden_keys.forEach(k => {
    fields[k] = { ...(fields[k] || {}), show: false, required: false };
  });
  // column ตาม show เป็นค่าเริ่มต้น — ยกเว้น custom กำหนด column มาเอง (override จากโมดอล ⚙️)
  // → กันคอลัมน์ว่าง: ฟิลด์ที่ template ปิด (show:false) หรือ hidden_keys จะไม่โผล่เป็นคอลัมน์
  Object.keys(fields).forEach(k => {
    const cf = custom.fields && custom.fields[k];
    const explicitCol = cf && Object.prototype.hasOwnProperty.call(cf, "column");
    if (!explicitCol) fields[k].column = fields[k].show !== false;
  });
  // field_order
  const customOrder = Array.isArray(custom.field_order) ? custom.field_order.slice() : null;
  let field_order = customOrder || DEFAULT_FIELD_ORDER.slice();
  DEFAULT_FIELD_ORDER.forEach(k => {
    if (!field_order.includes(k) && !hidden_keys.includes(k)) field_order.push(k);
  });
  field_order = field_order.filter(k => DEFAULT_FIELD_ORDER.includes(k) && !hidden_keys.includes(k));
  // custom_fields[] — text fields เก็บค่าใน extra_fields JSONB
  const custom_fields = Array.isArray(custom.custom_fields)
    ? custom.custom_fields.filter(cf => cf && cf.key && cf.label)
    : [];
  const qualifications = Array.isArray(custom.qualifications) ? custom.qualifications : [];
  return { fields, field_order, hidden_keys, custom_fields, qualifications };
}

// label ของ core field — รองรับ override จาก config
function _getFieldLabel(key, cfg) {
  return (cfg?.fields?.[key]?.label) || FIELD_LABELS[key] || key;
}

// ── ATTENDEE FORM MODAL ────────────────────────────────────
window.openAttendeeForm = async function (opts = {}) {
  const mode = opts.attId ? "edit" : "new";
  // บังคับเลือก template ก่อน "เพิ่มใหม่" (แก้ของเดิมยังทำได้ปกติ)
  if (mode === "new" && await _requireTemplateOrPrompt()) return;
  _attFormState = {
    mode,
    attId: opts.attId || null,
    memberCode: opts.memberCode || "",
    personRole: opts.personRole || (opts.memberCode ? "primary" : "guest"),
    paymentStatus: opts.paymentStatus || "UNPAID",
    _sourceRowId: opts._sourceRowId || null,
  };

  // Title
  const title = document.getElementById("attFormTitle");
  if (mode === "edit") {
    title.textContent = opts.memberCode ? "✏️ แก้ไขข้อมูลสมาชิก" : "✏️ แก้ไขข้อมูลผู้เรียน";
  } else {
    title.textContent = opts.memberCode ? "➕ ลงทะเบียนสมาชิก — กรอกข้อมูลเพิ่ม" : "➕ ลงทะเบียนผู้เรียนใหม่ (ยังไม่ใช่สมาชิก)";
  }

  // Member banner — CSS .aff-member-banner คุม style
  const banner = document.getElementById("attFormMemberBanner");
  if (opts.memberCode) {
    const roleChip = (_attFormState.personRole === "co_applicant")
      ? '<span style="background:#f3e8ff;color:#9333ea;padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;margin-left:6px">👥 ผู้สมัครร่วม</span>'
      : '';
    banner.innerHTML = `<span style="font-size:18px">🧑</span><span>สมาชิกรหัส <b>${escapeHtml(opts.memberCode)}</b>${roleChip}</span>`;
    banner.style.display = "flex";
  } else {
    banner.style.display = "none";
  }

  // Load uplines + render dropdown
  const uplines = await fetchUplines();
  const uplineSel = document.getElementById("attFormUpline");
  uplineSel.innerHTML = '<option value="">— เลือกสายงาน —</option>' +
    uplines.filter(u => u.is_active).map(u =>
      `<option value="${u.id}">${escapeHtml(u.name)}</option>`
    ).join("");

  // Load event field config (blocks) → render ฟอร์มเป็น block
  const _cfgInfo = await getEventConfigInfo(currentEventId);
  _renderFormBlocks(_cfgInfo.blocks, opts.extra_fields || {}, opts);

  // CS staff: legacy distinct values + pre-warm CS-dept users (fire-and-forget)
  _refreshCsStaffDatalist();
  _loadCsDeptUsers();

  // Fill form values
  document.getElementById("attFormAttId").value     = opts.attId || "";
  document.getElementById("attFormMemberCode").value = opts.memberCode || "";
  document.getElementById("attFormPersonRole").value = _attFormState.personRole;
  document.getElementById("attFormName").value      = opts.name || "";
  document.getElementById("attFormPhone").value     = opts.phone || "";
  document.getElementById("attFormPos").value       = opts.position_level || "";
  // ถ้าเป็นสมาชิก → autofill ตำแหน่ง + เบอร์โทร + สายงาน (parallel async)
  if (opts.memberCode && mode === "new") {
    _autofillMemberInfo(opts.memberCode);
    _autofillMemberUpline(opts.memberCode);
  }
  document.getElementById("attFormUpline").value    = opts.upline_id || "";
  // สายงานอัตโนมัติ (ตาม config upline_levels) — แสดงทั้ง new + edit ถ้าเป็นสมาชิก
  _autofillUplineLevelDisplay(opts.memberCode || "");
  // CS staff default: ถ้า edit → ใช้ค่าเดิม · ถ้าสร้างใหม่ + ไม่ระบุ → ใช้ชื่อ user ที่ login
  document.getElementById("attFormCs").value        = opts.cs_staff != null
    ? opts.cs_staff
    : (mode === "new" ? _getCurrentUserShortName() : "");
  document.getElementById("attFormLineName").value  = opts.line_name_reported || "";
  document.getElementById("attFormFbPage").value    = opts.fb_page_name || "";
  document.getElementById("attFormNote").value      = opts.attendee_note || "";

  // Referrer (เก็บใน extra_fields.referrer_code / referrer_name)
  const refCodeInit = opts.extra_fields?.referrer_code || "";
  const refNameInit = opts.extra_fields?.referrer_name || "";
  document.getElementById("attFormReferrerCode").value = refCodeInit;
  const refStatusEl = document.getElementById("attFormReferrerStatus");
  if (refStatusEl) {
    refStatusEl.style.color = refNameInit ? "#065f46" : "#64748b";
    refStatusEl.textContent = refNameInit ? `✅ ${refNameInit}` : "";
  }
  _attFormReferrerCache = (refCodeInit && refNameInit)
    ? { code: refCodeInit, name: refNameInit }
    : null;

  // had_attended radio
  const hadVal = opts.had_attended_before === true ? "true"
               : opts.had_attended_before === false ? "false" : "";
  document.querySelectorAll('input[name="attFormHadAttended"]').forEach(r => {
    r.checked = (r.value === hadVal);
  });

  // Open
  document.getElementById("attendeeFormOverlay").classList.add("open");
  requestAnimationFrame(() => document.getElementById("attFormName")?.focus());
};

// ── Referrer lookup (debounced) + cache for save ──
let _attFormReferrerCache = null;     // { code, name } when valid
let _attFormReferrerTimer = null;

window._attFormReferrerInput = function () {
  clearTimeout(_attFormReferrerTimer);
  _attFormReferrerCache = null;
  const v = document.getElementById("attFormReferrerCode").value.trim();
  const st = document.getElementById("attFormReferrerStatus");
  if (!v) { if (st) { st.textContent = ""; st.style.color = "#64748b"; } return; }
  if (st) { st.textContent = "⏳ กำลังตรวจสอบ..."; st.style.color = "#94a3b8"; }
  _attFormReferrerTimer = setTimeout(() => window._attFormReferrerLookup(false), 350);
};

window._attFormReferrerLookup = async function (forceOnBlur) {
  const code = document.getElementById("attFormReferrerCode").value.trim();
  const st = document.getElementById("attFormReferrerStatus");
  if (!code) { _attFormReferrerCache = null; if (st) { st.textContent = ""; st.style.color = "#64748b"; } return null; }
  // ถ้า cache ตรง + ไม่ใช่ blur → skip
  if (!forceOnBlur && _attFormReferrerCache?.code === code) return _attFormReferrerCache;
  try {
    let rows = await sbFetch("members", `?member_code=eq.${encodeURIComponent(code)}&select=member_code,member_name,full_name&limit=1`);
    if (!rows?.length) {
      rows = await sbFetch("test_members", `?member_code=eq.${encodeURIComponent(code)}&select=member_code,member_name,full_name&limit=1`).catch(() => []);
    }
    if (!rows?.length) {
      _attFormReferrerCache = null;
      if (st) { st.textContent = "❌ ไม่พบรหัสผู้แนะนำนี้"; st.style.color = "#dc2626"; }
      return null;
    }
    const r = rows[0];
    const name = r.full_name || r.member_name || r.member_code;
    _attFormReferrerCache = { code: r.member_code, name };
    if (st) { st.textContent = `✅ ${name}`; st.style.color = "#065f46"; }
    // Auto-fill สายงาน ถ้า referrer link กับ upline_leader โดยตรง
    _attFormFillUplineFromReferrer(r.member_code).catch(e => console.warn("upline auto-fill:", e?.message || e));
    return _attFormReferrerCache;
  } catch (e) {
    _attFormReferrerCache = null;
    if (st) { st.textContent = "⚠️ ตรวจสอบไม่ได้ ลองใหม่"; st.style.color = "#dc2626"; }
    return null;
  }
};

// Auto-fill สายงาน dropdown จาก referrer code (direct match กับ upline_leaders.member_code)
async function _attFormFillUplineFromReferrer(referrerCode) {
  if (!referrerCode) return;
  const sel = document.getElementById("attFormUpline");
  if (!sel) return;
  let rows;
  try {
    rows = await sbFetch("upline_leaders", `?member_code=eq.${encodeURIComponent(referrerCode)}&is_active=eq.true&select=id,name&limit=1`);
  } catch (e) {
    console.warn("upline_leaders lookup:", e.message);
    return;
  }
  if (!rows?.length) return;   // referrer ไม่ใช่ upline_leader → ปล่อยว่าง
  const ul = rows[0];
  // ถ้า dropdown ยังไม่มี option นี้ (cache เก่า) → refresh
  if (!sel.querySelector(`option[value="${ul.id}"]`)) {
    await _refreshUplineDropdownInForm();
  }
  sel.value = String(ul.id);
}

// map std key → { wrapId, labelId, defaultLabel } (DOM ในฟอร์ม)
const _STD_FORM_MAP = {
  phone:        { wrap: "attFormPhoneWrap",        label: "attFormPhoneLabel",        def: "เบอร์โทร" },
  position:     { wrap: "attFormPosWrap",          label: "attFormPosLabel",          def: "ตำแหน่ง" },
  upline:       { wrap: "attFormUplineWrap",       label: "attFormUplineLabel",       def: "สายงาน" },
  referrer:     { wrap: "attFormReferrerWrap",     label: "attFormReferrerLabel",     def: "ผู้แนะนำ" },
  cs_staff:     { wrap: "attFormCsWrap",           label: "attFormCsLabel",           def: "CS" },
  line_name:    { wrap: "attFormLineWrap",         label: "attFormLineLabel",         def: "ชื่อไลน์ที่แจ้ง" },
  fb_page_name: { wrap: "attFormFbWrap",           label: "attFormFbLabel",           def: "ชื่อเพจ Facebook" },
  had_attended: { wrap: "attFormHadAttendedWrap",  label: "attFormHadAttendedLabel",  def: "เคยเรียนคอร์สนี้แล้วหรือไม่" },
  note:         { wrap: "attFormNoteWrap",         label: "attFormNoteLabel",         def: "หมายเหตุ" },
};

// render ฟอร์มลงทะเบียนเป็น block ตาม template — ย้าย std wrap จาก pool เข้า block + สร้าง custom/check
function _renderFormBlocks(blocks, extraFields, opts) {
  const host = document.getElementById("attFormBlocks");
  const pool = document.getElementById("attFormFieldPool");
  if (!host || !pool) return;
  // reset: คืน wrap ทั้งหมดกลับ pool + ซ่อน
  const poolIds = ["attFormNameWrap", ...Object.values(_STD_FORM_MAP).map(m => m.wrap)];
  poolIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = "none"; if (el.parentElement !== pool) pool.appendChild(el); }
  });
  host.innerHTML = "";

  let list = Array.isArray(blocks) ? blocks.slice() : [];
  // safety: ต้องมี name เสมอ
  const hasName = list.some(b => (b.items || []).some(it => it.type === "core" && it.key === "name"));
  if (!hasName) list.unshift({ id: "_dflt", title: "ข้อมูลผู้เรียน", items: [{ type: "core", key: "name" }] });

  list.forEach(b => {
    const sec = document.createElement("div");
    sec.className = "aff-block";
    if (b.title) {
      const t = document.createElement("div");
      t.className = "aff-block-title";
      t.textContent = b.title;
      sec.appendChild(t);
    }
    const body = document.createElement("div");
    body.className = "aff-block-body";
    sec.appendChild(body);
    (b.items || []).forEach(it => {
      if (!it || !it.type) return;
      if (it.type === "core" && it.key === "name") {
        const w = document.getElementById("attFormNameWrap");
        if (w) { w.style.display = ""; body.appendChild(w); }
      } else if (it.type === "core" && it.key === "member_code") {
        // ระบบ — รหัสสมาชิกแสดงใน member banner ด้านบนแล้ว (ไม่ render ซ้ำในบล็อก)
      } else if (it.type === "std") {
        const m = _STD_FORM_MAP[it.key]; if (!m) return;
        const w = document.getElementById(m.wrap); if (!w) return;
        w.style.display = "";
        body.appendChild(w);
        const lblEl = document.getElementById(m.label);
        if (lblEl) {
          const lbl = it.label || m.def;
          lblEl.innerHTML = it.required ? `${escapeHtml(lbl)} <span class="req">*</span>` : escapeHtml(lbl);
        }
        if (it.key === "had_attended" || it.key === "note") w.classList.add("aff-full-row");
      } else if (it.type === "text" || it.type === "date" || it.type === "number") {
        body.appendChild(_buildCustomFieldNode(it, extraFields));
      } else if (it.type === "check") {
        body.appendChild(_buildCheckFieldNode(it, extraFields));
      }
    });
    if (body.children.length) host.appendChild(sec);
  });
}

function _buildCustomFieldNode(it, extraFields) {
  const d = document.createElement("div");
  d.className = "form-group";
  const inputType = it.type === "date" ? "date" : (it.type === "number" ? "number" : "text");
  const raw = extraFields && extraFields[it.key] != null ? String(extraFields[it.key]) : "";
  d.innerHTML = `<label class="form-label">${escapeHtml(it.label || it.key)}${it.required ? ' <span class="req">*</span>' : ''}</label>
    <input class="form-control" type="${inputType}" data-custom-key="${escapeHtml(it.key)}" value="${escapeHtml(raw)}" autocomplete="off">`;
  return d;
}

function _buildCheckFieldNode(it, extraFields) {
  const d = document.createElement("div");
  d.className = "form-group aff-full-row";
  const checked = extraFields && extraFields[it.key] === true ? "checked" : "";
  d.innerHTML = `<label class="aff-check-item"><input type="checkbox" data-qual-key="${escapeHtml(it.key)}" ${checked}><span>${escapeHtml(it.label || it.key)}</span></label>`;
  return d;
}

function _applyFieldConfigToForm(cfg) {
  // (legacy — ไม่ใช้แล้ว · เก็บไว้กัน reference เก่า) map key → { wrapId, labelId, defaultLabel }
  const map = {
    phone:        { wrap: "attFormPhoneWrap",        label: "attFormPhoneLabel",        def: "เบอร์โทร" },
    position:     { wrap: "attFormPosWrap",          label: "attFormPosLabel",          def: "ตำแหน่ง" },
    upline:       { wrap: "attFormUplineWrap",       label: "attFormUplineLabel",       def: "สายงาน" },
    referrer:     { wrap: "attFormReferrerWrap",     label: "attFormReferrerLabel",     def: "ผู้แนะนำ" },
    cs_staff:     { wrap: "attFormCsWrap",           label: "attFormCsLabel",           def: "CS" },
    line_name:    { wrap: "attFormLineWrap",         label: "attFormLineLabel",         def: "ชื่อไลน์ที่แจ้ง" },
    fb_page_name: { wrap: "attFormFbWrap",           label: "attFormFbLabel",           def: "ชื่อเพจ Facebook" },
    had_attended: { wrap: "attFormHadAttendedWrap",  label: "attFormHadAttendedLabel",  def: "เคยเรียนคอร์สนี้แล้วหรือไม่" },
    note:         { wrap: "attFormNoteWrap",         label: "attFormNoteLabel",         def: "หมายเหตุ" },
  };
  const order = Array.isArray(cfg.field_order) ? cfg.field_order : DEFAULT_FIELD_ORDER;
  // hide every standard field by default, then show + ordered ตาม field_order
  Object.entries(map).forEach(([key, m]) => {
    const wrap = document.getElementById(m.wrap);
    if (!wrap) return;
    const show = cfg.fields?.[key]?.show !== false;
    wrap.style.display = show ? "" : "none";
    // ลำดับใน grid: key ที่อยู่ใน field_order ใช้ index นั้น · ที่ไม่อยู่ → ปลายแถว
    const idx = order.indexOf(key);
    wrap.style.order = String(idx >= 0 ? idx : 999);
    // label override + required marker
    const lblEl = document.getElementById(m.label);
    if (lblEl) {
      const lbl = cfg.fields?.[key]?.label || m.def;
      const req = cfg.fields?.[key]?.required === true;
      lblEl.innerHTML = req ? `${escapeHtml(lbl)} <span class="req">*</span>` : escapeHtml(lbl);
    }
  });
}

function _renderQualifications(quals, extraFields, customFields) {
  const wrap = document.getElementById("attFormQualWrap");
  const list = document.getElementById("attFormQualList");
  if (!wrap || !list) return;
  const configList = Array.isArray(quals) ? quals : [];
  const configKeys = new Set(configList.map(q => q.key));
  // custom_fields keys อยู่ใน extra_fields เหมือนกัน → ต้องไม่นับเป็น "legacy qualification"
  const customKeys = new Set((Array.isArray(customFields) ? customFields : []).map(c => c.key));
  // Union: keys from extra_fields ที่ไม่อยู่ใน qualifications config + ไม่ใช่ custom field → legacy
  const extraOnlyKeys = Object.keys(extraFields || {}).filter(k =>
    !configKeys.has(k) && !customKeys.has(k) && typeof extraFields[k] === "boolean"
  );
  const allEntries = [
    ...configList.map(q => ({ key: q.key, label: q.label || q.key, legacy: false })),
    ...extraOnlyKeys.map(k => ({ key: k, label: k + " (เดิม)", legacy: true })),
  ];
  if (!allEntries.length) {
    wrap.style.display = "none";
    list.innerHTML = "";
    return;
  }
  wrap.style.display = "";
  list.innerHTML = allEntries.map(e => {
    const checked = extraFields?.[e.key] === true ? "checked" : "";
    const cls = e.legacy ? "aff-qual-item legacy" : "aff-qual-item";
    return `<label class="${cls}">
      <input type="checkbox" data-qual-key="${escapeHtml(e.key)}" ${checked} onchange="window._attFormQualSyncAll()">
      <span>${escapeHtml(e.label)}</span>
    </label>`;
  }).join("");
  window._attFormQualSyncAll();
}

// ── คุณสมบัติ "ทั้งหมด" master checkbox ──────────────────
window._attFormQualToggleAll = function (checked) {
  const list = document.getElementById("attFormQualList");
  if (!list) return;
  list.querySelectorAll('input[type="checkbox"][data-qual-key]').forEach(cb => {
    cb.checked = checked;
  });
  const all = document.getElementById("attFormQualAll");
  if (all) { all.indeterminate = false; all.checked = checked; }
};
window._attFormQualSyncAll = function () {
  const list = document.getElementById("attFormQualList");
  const all = document.getElementById("attFormQualAll");
  if (!list || !all) return;
  const boxes = [...list.querySelectorAll('input[type="checkbox"][data-qual-key]')];
  if (!boxes.length) { all.checked = false; all.indeterminate = false; return; }
  const onCount = boxes.filter(b => b.checked).length;
  all.checked = onCount === boxes.length;
  all.indeterminate = onCount > 0 && onCount < boxes.length;
};

// Render custom text-field inputs ใน Attendee Form Modal
function _renderCustomFieldInputs(customFields, extraFields) {
  const wrap = document.getElementById("attFormCustomWrap");
  const container = document.getElementById("attFormCustomFields");
  if (!wrap || !container) return;
  const list = Array.isArray(customFields) ? customFields : [];
  if (!list.length) {
    wrap.style.display = "none";
    container.innerHTML = "";
    return;
  }
  wrap.style.display = "";
  container.innerHTML = list.map(cf => {
    const val = extraFields?.[cf.key] != null ? String(extraFields[cf.key]) : "";
    return `<div class="form-group">
      <label class="form-label">${escapeHtml(cf.label)}</label>
      <input class="form-control" data-custom-key="${escapeHtml(cf.key)}" value="${escapeHtml(val)}" autocomplete="off">
    </div>`;
  }).join("");
}

window.closeAttendeeForm = function () {
  document.getElementById("attendeeFormOverlay").classList.remove("open");
  // หากผู้ใช้ยกเลิก/ปิดระหว่าง flow "เพิ่มทั้ง 2 คน" → ทิ้ง partner pending
  if (_pendingPartner) {
    _pendingPartner = null;
    showToast("ยกเลิกการเพิ่มทั้ง 2 คน", "info");
  }
};

window.saveAttendeeForm = async function () {
  const name = document.getElementById("attFormName").value.trim();
  if (!name) { showToast("กรุณาระบุชื่อ-นามสกุล", "error"); return; }

  const cfg = await fetchEventFieldConfig(currentEventId);
  const uplineId = document.getElementById("attFormUpline").value || null;
  const uplineAutoName = _attFormState.uplineAutoName || null;   // สายงานอัตโนมัติ (จาก config upline_levels)
  if (cfg.fields.upline?.required && !uplineId && !uplineAutoName) {
    showToast("กรุณาเลือกสายงาน", "error");
    return;
  }

  const uplineRow = uplineId ? (_uplinesCache || []).find(u => String(u.id) === String(uplineId)) : null;

  // ── Referrer: validate + ensure cache matches input ──
  const refCodeInput = document.getElementById("attFormReferrerCode").value.trim();
  if (cfg.fields.referrer?.required && !refCodeInput) {
    showToast("กรุณาระบุรหัสผู้แนะนำ", "error");
    document.getElementById("attFormReferrerCode")?.focus();
    return;
  }
  let referrerData = null;
  if (refCodeInput) {
    if (_attFormReferrerCache?.code !== refCodeInput) {
      // user พิมพ์ใหม่แต่ยังไม่ได้ blur — re-lookup
      referrerData = await window._attFormReferrerLookup(true);
    } else {
      referrerData = _attFormReferrerCache;
    }
    if (!referrerData) {
      showToast("❌ ไม่พบรหัสผู้แนะนำในระบบ", "error");
      document.getElementById("attFormReferrerCode")?.focus();
      return;
    }
  }

  // Collect qualifications (boolean) + custom fields (text) → รวมใน extra_fields เดียวกัน
  // (อยู่ในบล็อก #attFormBlocks ตาม template)
  const quals = {};
  document.querySelectorAll('#attFormBlocks input[data-qual-key]').forEach(cb => {
    quals[cb.dataset.qualKey] = cb.checked;
  });
  document.querySelectorAll('#attFormBlocks input[data-custom-key]').forEach(inp => {
    const v = inp.value.trim();
    if (v) quals[inp.dataset.customKey] = v;
  });
  if (referrerData) {
    quals.referrer_code = referrerData.code;
    quals.referrer_name = referrerData.name;
  }

  const hadVal = document.querySelector('input[name="attFormHadAttended"]:checked')?.value;
  const had_attended_before = hadVal === "true" ? true : hadVal === "false" ? false : null;

  const payload = {
    name,
    phone:               document.getElementById("attFormPhone").value.trim() || null,
    position_level:      document.getElementById("attFormPos").value.trim() || null,
    upline_id:           uplineId,
    upline_name_text:    uplineRow?.name || uplineAutoName || null,
    cs_staff:            document.getElementById("attFormCs").value.trim() || null,
    line_name_reported:  document.getElementById("attFormLineName").value.trim() || null,
    fb_page_name:        document.getElementById("attFormFbPage").value.trim() || null,
    had_attended_before,
    attendee_note:       document.getElementById("attFormNote").value.trim() || null,
    extra_fields:        quals,
  };

  try {
    if (_attFormState.mode === "edit" && _attFormState.attId) {
      await updateAttendee(_attFormState.attId, payload);
      showToast("บันทึกข้อมูลแล้ว ✏️", "success");
    } else {
      // New attendee — merge with event/payment fields
      const activeTier = getActiveTier();
      const price = getCurrentPrice();
      const grace = getEventGraceDays();
      const needsPayment = _attFormState.paymentStatus === "UNPAID";
      const fullPayload = {
        ...payload,
        event_id:        currentEventId,
        paid_amount:     price,
        payment_status:  _attFormState.paymentStatus,
        member_code:     _attFormState.memberCode || null,
        person_role:     _attFormState.memberCode ? (_attFormState.personRole || "primary") : "guest",
        tier_id:         activeTier?.tier_id || null,
        payment_deadline: needsPayment ? computeDeadlineISO(grace) : null,
        checked_in:      _autoCheckin ? true : false,
        check_in_at:     _autoCheckin ? buildCheckinTimestamp() : null,
      };
      const blocked = await _enforceRegistration(fullPayload);
      if (blocked) return;
      fullPayload.ticket_no = await generateTicketNo(currentEventId);
      await createAttendee(fullPayload);
      showToast(_attFormState.memberCode ? "เพิ่มสมาชิกแล้ว 👤" : "เพิ่มผู้เรียนใหม่แล้ว 👤", "success");

      // Remove the originating new-row (if came from search row) + ensure trailing
      newRows = newRows.filter(r => r.id !== _attFormState._sourceRowId);
      ensureTrailingEmptyRow();
      _searchKeyword = "";
    }

    allAttendees = await fetchAttendees(currentEventId);
    populateTagFilter();
    updateStats();
    filterTable();   // แสดงทันที
    computeUplineMatches().then(() => { if (currentEventId) { updateStats(); filterTable(); } }).catch(() => {});
    // อ่าน pending partner ก่อน close (close จะ clear ถ้ายังตั้งอยู่)
    const partner = (_attFormState.mode === "new") ? _pendingPartner : null;
    _pendingPartner = null; // กัน close trigger ยกเลิก-toast
    window.closeAttendeeForm();
    if (partner) {
      showToast("👥 ขั้นที่ 2/2 — กรอกข้อมูลผู้สมัครร่วม", "info");
      setTimeout(() => window.openAttendeeForm(partner), 220);
    }
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + (e.message || e), "error");
  }
};

// ── UPLINE MASTER CRUD ─────────────────────────────────────
window.openUplineManage = async function () {
  document.getElementById("uplineManageOverlay").classList.add("open");
  await _renderUplineMgrList();
  requestAnimationFrame(() => document.getElementById("newUplineName")?.focus());
};

window.closeUplineManage = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("uplineManageOverlay").classList.remove("open");
  // Re-render upline dropdown in form (might have new/removed entries)
  _refreshUplineDropdownInForm();
};

async function _renderUplineMgrList() {
  const list = document.getElementById("uplineMgrList");
  if (!list) return;
  const uplines = await fetchUplines();
  if (!uplines.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:12.5px">ยังไม่มีสายงาน — เพิ่มด้านบน</div>';
    return;
  }
  list.innerHTML = uplines.map((u, idx) => `
    <div class="upl-item" data-uid="${u.id}" draggable="true"
      ondragstart="window._uplDragStart(event, ${idx})"
      ondragover="window._uplDragOver(event)"
      ondragleave="window._uplDragLeave(event)"
      ondrop="window._uplDrop(event, ${idx})"
      ondragend="window._uplDragEnd(event)">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
      <span class="upl-name${u.is_active ? '' : ' inactive'}">${escapeHtml(u.name)}</span>
      <input type="text" class="upl-code-input" value="${escapeHtml(u.member_code || '')}" placeholder="รหัสสมาชิก"
        onblur="window.updateUplineMemberCode(${u.id}, this.value)">
      <button class="upl-btn ${u.is_active ? 'upl-btn-toggle-on' : 'upl-btn-toggle-off'}"
        title="${u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}"
        onclick="window.toggleUpline(${u.id}, ${!u.is_active})">
        ${u.is_active ? '● เปิด' : '○ ปิด'}
      </button>
      <button class="upl-btn upl-btn-delete" title="ลบ"
        onclick="window.deleteUpline(${u.id}, '${escapeJS(u.name)}')">🗑</button>
    </div>
  `).join("");
}

// ── Drag-reorder upline_leaders → persist sort_order ───────
let _uplDragIdx = null;
window._uplDragStart = function (ev, idx) {
  _uplDragIdx = idx;
  ev.dataTransfer.effectAllowed = "move";
  ev.currentTarget.classList.add("dragging");
};
window._uplDragOver = function (ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "move";
  ev.currentTarget.classList.add("drag-over");
};
window._uplDragLeave = function (ev) {
  ev.currentTarget.classList.remove("drag-over");
};
window._uplDragEnd = function (ev) {
  ev.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".upl-item.drag-over").forEach(el => el.classList.remove("drag-over"));
  _uplDragIdx = null;
};
window._uplDrop = async function (ev, targetIdx) {
  ev.preventDefault();
  ev.currentTarget.classList.remove("drag-over");
  if (_uplDragIdx == null || _uplDragIdx === targetIdx) return;
  const arr = _uplinesCache;
  if (!Array.isArray(arr)) return;
  const [moved] = arr.splice(_uplDragIdx, 1);
  arr.splice(targetIdx, 0, moved);
  _uplDragIdx = null;
  await _renderUplineMgrList();   // re-render ทันที (optimistic)
  // persist sort_order ใหม่ทุกแถว (sequential 10, 20, 30, ...)
  try {
    await Promise.all(arr.map((u, idx) => {
      const newOrder = (idx + 1) * 10;
      if (u.sort_order === newOrder) return Promise.resolve();
      u.sort_order = newOrder;
      return sbFetch("upline_leaders", `?id=eq.${u.id}`, {
        method: "PATCH", body: { sort_order: newOrder },
      });
    }));
    showToast("จัดลำดับสายงานแล้ว", "success");
  } catch (e) {
    showToast("บันทึกลำดับไม่สำเร็จ: " + e.message, "error");
    _invalidateUplinesCache();
    await _renderUplineMgrList();
  }
};

window.addUpline = async function () {
  const inp = document.getElementById("newUplineName");
  const codeInp = document.getElementById("newUplineCode");
  const name = inp.value.trim();
  const memberCode = codeInp.value.trim() || null;
  if (!name) { inp.focus(); return; }
  try {
    await sbFetch("upline_leaders", "", {
      method: "POST",
      body: { name, member_code: memberCode, sort_order: 1000 },
    });
    inp.value = "";
    codeInp.value = "";
    _invalidateUplinesCache();
    await _renderUplineMgrList();
    showToast(`เพิ่มสายงาน "${name}" แล้ว`, "success");
  } catch (e) {
    if (/duplicate|unique/i.test(e.message || "")) {
      showToast(`มีสายงาน "${name}" อยู่แล้ว`, "warn");
    } else {
      showToast("เพิ่มไม่สำเร็จ: " + e.message, "error");
    }
  }
};

window.updateUplineMemberCode = async function (id, value) {
  const code = (value || "").trim() || null;
  try {
    await sbFetch("upline_leaders", `?id=eq.${id}`, {
      method: "PATCH",
      body: { member_code: code },
    });
    _invalidateUplinesCache();
    showToast(code ? `Link รหัส ${code} แล้ว` : "ลบ link รหัสแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

window.toggleUpline = async function (id, makeActive) {
  try {
    await sbFetch("upline_leaders", `?id=eq.${id}`, {
      method: "PATCH",
      body: { is_active: makeActive },
    });
    _invalidateUplinesCache();
    await _renderUplineMgrList();
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error");
  }
};

window.deleteUpline = async function (id, name) {
  if (!confirm(`ลบสายงาน "${name}"?\n\n— แถวที่อ้างถึงจะคงชื่อไว้ (snapshot) แต่ link จะหาย`)) return;
  try {
    await sbFetch("upline_leaders", `?id=eq.${id}`, { method: "DELETE" });
    _invalidateUplinesCache();
    await _renderUplineMgrList();
    showToast(`ลบสายงาน "${name}" แล้ว`, "success");
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
};

async function _refreshUplineDropdownInForm() {
  const sel = document.getElementById("attFormUpline");
  if (!sel || !document.getElementById("attendeeFormOverlay").classList.contains("open")) return;
  const current = sel.value;
  const uplines = await fetchUplines();
  sel.innerHTML = '<option value="">— เลือกสายงาน —</option>' +
    uplines.filter(u => u.is_active).map(u =>
      `<option value="${u.id}">${escapeHtml(u.name)}</option>`
    ).join("");
  sel.value = current;
}

// ── FIELD CONFIG MODAL (per-event) ─────────────────────────
let _fcDraft = null;      // working copy { fields, qualifications }
let _fcInfo = null;       // resolved config info { source, templateId, templateName, templateConfig, ... }
let _fcUseTemplate = false;  // toggle state: true → save will CLEAR override (use template sync)

const FIELD_LABELS = {
  phone:        "เบอร์โทร",
  position:     "ตำแหน่ง",
  upline:       "สายงาน",
  referrer:     "ผู้แนะนำ",
  cs_staff:     "CS",
  line_name:    "ชื่อไลน์ที่แจ้ง",
  fb_page_name: "ชื่อเพจ Facebook",
  had_attended: "เคยเรียน/ไม่เคยเรียน",
  note:         "หมายเหตุ",
};

window.openFieldConfigModal = async function () {
  if (!currentEventId) { showToast("เลือก event ก่อน", "error"); return; }
  _fcInfo = await getEventConfigInfo(currentEventId);
  _fcDraft = JSON.parse(JSON.stringify(_fcInfo.config));
  _fcUseTemplate = (_fcInfo.source === "template");
  await _fcLoadTemplateOptions();
  _renderFcSourceBanner();
  _renderFcFields();
  _renderFcCustomFields();
  _renderFcQuals();
  document.getElementById("fieldConfigOverlay").classList.add("open");
};

async function _fcLoadTemplateOptions() {
  const sel = document.getElementById("fcTemplateSelect");
  if (!sel) return;
  try {
    const rows = await sbFetch(
      "attendee_form_templates",
      "?select=id,name,description,is_active&is_active=eq.true&order=sort_order.asc"
    );
    sel.innerHTML = '<option value="">— ใช้ Default (ฟอร์มกลางทุกงาน) —</option>' +
      (rows || []).map(t => `<option value="${t.id}">📋 ${escapeHtml(t.name)}</option>`).join("");
    sel.value = _fcInfo?.templateId ? String(_fcInfo.templateId) : "";
  } catch (e) {
    console.warn("_fcLoadTemplateOptions:", e.message);
  }
}

// Link/unlink template โดยตรงจาก Field Config Modal
window._fcOnTemplateChange = async function (newTemplateId) {
  if (!currentEventId) return;
  const id = newTemplateId ? parseInt(newTemplateId) : null;
  try {
    await sbFetch("events", `?event_id=eq.${currentEventId}`, {
      method: "PATCH",
      body: { template_id: id },
    });
    _invalidateEventConfigCache();
    // Re-fetch + re-render modal state
    _fcInfo = await getEventConfigInfo(currentEventId);
    // ถ้าไม่มี override → ใช้ draft ตาม template ใหม่
    if (_fcInfo.source !== "override") {
      _fcDraft = JSON.parse(JSON.stringify(_fcInfo.config));
      _fcUseTemplate = (_fcInfo.source === "template");
    }
    _renderFcSourceBanner();
    _renderFcFields();
    _renderFcCustomFields();
    _renderFcQuals();
    showToast(id ? "ผูก template แล้ว 🔗" : "ใช้ Default (ฟอร์มกลาง) แล้ว ⭐", "success");
    // ปรับ column layout ของตาราง (เผื่อ qualifications เปลี่ยน)
    filterTable();
  } catch (e) {
    showToast("ผูก template ไม่สำเร็จ: " + e.message, "error");
  }
};

function _renderFcSourceBanner() {
  const banner = document.getElementById("fcSourceBanner");
  const toggleBox = document.getElementById("fcOverrideToggle");
  const cb = document.getElementById("fcUseTemplate");
  const hint = document.getElementById("fcOverrideHint");
  if (!banner || !_fcInfo) return;
  const { source, templateName } = _fcInfo;
  if (source === "override") {
    banner.style.background = "#fffbeb";
    banner.style.border = "1px solid #fcd34d";
    banner.style.color = "#78350f";
    banner.innerHTML = templateName
      ? `⚡ <b>Override mode</b> — event นี้แก้ฟิลด์เอง (template: <i>${escapeHtml(templateName)}</i> ไม่ propagate)`
      : `⚡ <b>Custom config</b> — event นี้ไม่ผูก template`;
  } else if (source === "template") {
    banner.style.background = "#dcfce7";
    banner.style.border = "1px solid #86efac";
    banner.style.color = "#14532d";
    banner.innerHTML = `🔗 <b>Linked</b> — sync จาก template "<b>${escapeHtml(templateName)}</b>" · แก้ template → propagate มาที่ event นี้`;
  } else if (source === "default") {
    banner.style.background = "#fffbeb";
    banner.style.border = "1px solid #fcd34d";
    banner.style.color = "#92400e";
    banner.innerHTML = `⭐ <b>ใช้ Default</b> — ฟอร์มกลาง${templateName ? ` "<b>${escapeHtml(templateName)}</b>"` : ""} ที่ใช้กับทุกงาน · เลือก template ด้านบนถ้างานนี้ต้องการฟอร์มเฉพาะ`;
  } else {
    banner.style.background = "#fef2f2";
    banner.style.border = "1px solid #fecaca";
    banner.style.color = "#991b1b";
    banner.innerHTML = `⚠️ <b>ยังไม่มี Default template</b> — ตารางจะว่าง · ตั้งค่า Default ที่หน้าเทมเพลต (⭐) หรือเลือก template ให้งานนี้ 👆`;
  }

  if (_fcInfo.templateId) {
    toggleBox.style.display = "";
    cb.checked = _fcUseTemplate;
    hint.textContent = _fcUseTemplate
      ? `บันทึก = ล้าง override · ฟอร์มจะใช้ template "${_fcInfo.templateName}" สด`
      : `บันทึก = เซฟค่าด้านล่างเป็น override · template จะไม่ propagate ในอนาคต`;
  } else {
    toggleBox.style.display = "none";
  }
}

window._fcOnUseTemplateToggle = function (val) {
  _fcUseTemplate = val;
  if (val && _fcInfo?.templateConfig) {
    // Revert draft → template config
    _fcDraft = _mergeFieldConfig(_fcInfo.templateConfig);
    _renderFcFields();
    _renderFcCustomFields();
    _renderFcQuals();
  }
  _renderFcSourceBanner();
};

window.closeFieldConfigModal = function (ev) {
  if (ev && ev.target && !ev.target.classList?.contains("modal-overlay")) return;
  document.getElementById("fieldConfigOverlay").classList.remove("open");
  _fcDraft = null;
  _fcInfo = null;
  _fcUseTemplate = false;
};

function _renderFcFields() {
  const grid = document.getElementById("fcFieldsGrid");
  if (!grid || !_fcDraft) return;
  if (!Array.isArray(_fcDraft.field_order)) _fcDraft.field_order = [];
  if (!Array.isArray(_fcDraft.hidden_keys)) _fcDraft.hidden_keys = [];
  // ถ้า field_order ว่าง + ยังไม่มี hidden_keys เลย → fallback กลับเป็น default (กันเปิด modal แล้วว่างเปล่าจาก config เก่า)
  if (!_fcDraft.field_order.length && !_fcDraft.hidden_keys.length) {
    _fcDraft.field_order = DEFAULT_FIELD_ORDER.slice();
  }
  const order = _fcDraft.field_order;
  // Column-first layout: 1 ลง → 2 ลง → ... → ขวา (ครึ่งบน คอลัมน์ซ้าย, ครึ่งล่าง คอลัมน์ขวา)
  const rowsCount = Math.max(1, Math.ceil(order.length / 2));
  grid.style.gridTemplateRows = `repeat(${rowsCount}, auto)`;
  grid.style.gridAutoFlow = "column";
  if (!order.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:14px;text-align:center;color:var(--text3);font-size:12px">ลบฟิลด์มาตรฐานออกหมดแล้ว — คืนค่าได้ที่ "ฟิลด์ที่ซ่อน" ด้านล่าง</div>';
  } else {
    grid.innerHTML = order.map((key, idx) => {
      if (!FIELD_LABELS[key]) return "";
      const f = _fcDraft.fields[key] || {};
      const show = f.show !== false;
      const col = _fieldShowsAsColumn(f);
      const req = f.required === true;
      const lbl = _getFieldLabel(key, _fcDraft);
      return `<div class="drag-row" draggable="true" data-list="field" data-idx="${idx}"
        ondragstart="window._fcDragStart(event, 'field', ${idx})"
        ondragover="window._fcDragOver(event)"
        ondragleave="window._fcDragLeave(event)"
        ondrop="window._fcDrop(event, 'field', ${idx})"
        ondragend="window._fcDragEnd(event)">
        <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
        <span class="drag-num">${idx + 1}.</span>
        <label class="drag-row-main" title="แสดงในฟอร์มลงทะเบียน">
          <input type="checkbox" ${show ? "checked" : ""} onchange="window._fcToggleShow('${key}', this.checked)">
          <span class="${show ? '' : 'inactive'}">${escapeHtml(lbl)}</span>
        </label>
        <button class="drag-row-edit" title="แก้ไขชื่อหัวข้อ" onclick="window._fcRenameField('${key}')">✏️</button>
        <label class="drag-row-col" title="แสดงเป็น column ในตาราง attendees">
          <input type="checkbox" ${col ? "checked" : ""} onchange="window._fcToggleColumn('${key}', this.checked)">
          📊 ตาราง
        </label>
        <label class="drag-row-req">
          <input type="checkbox" ${req ? "checked" : ""} ${show ? "" : "disabled"} onchange="window._fcToggleReq('${key}', this.checked)">
          บังคับ*
        </label>
        <button class="drag-row-del" title="ลบฟิลด์นี้ (คืนค่าได้ภายหลัง)" onclick="window._fcRemoveStandardField('${key}')">🗑</button>
      </div>`;
    }).join("");
  }
  _renderFcHiddenFields();
}

function _renderFcHiddenFields() {
  const box = document.getElementById("fcHiddenFieldsBox");
  if (!box) return;
  const hidden = Array.isArray(_fcDraft?.hidden_keys) ? _fcDraft.hidden_keys : [];
  if (!hidden.length) { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "";
  box.innerHTML = `
    <div style="font-size:11px;color:#64748b;margin-bottom:6px">🗑 ฟิลด์ที่ซ่อน <span style="color:var(--text3)">— กดเพื่อคืนค่ากลับ</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${hidden.map(k => `
        <button type="button" class="fc-hidden-chip" onclick="window._fcRestoreStandardField('${k}')" title="คืนค่าฟิลด์นี้">
          ↺ ${escapeHtml(FIELD_LABELS[k] || k)}
        </button>
      `).join("")}
    </div>`;
}

window._fcRemoveStandardField = function (key) {
  if (!_fcDraft) return;
  _fcMarkDirty();
  if (!Array.isArray(_fcDraft.hidden_keys)) _fcDraft.hidden_keys = [];
  if (!_fcDraft.hidden_keys.includes(key)) _fcDraft.hidden_keys.push(key);
  _fcDraft.field_order = (_fcDraft.field_order || []).filter(k => k !== key);
  _renderFcFields();
};

window._fcRestoreStandardField = function (key) {
  if (!_fcDraft) return;
  _fcMarkDirty();
  _fcDraft.hidden_keys = (_fcDraft.hidden_keys || []).filter(k => k !== key);
  if (!Array.isArray(_fcDraft.field_order)) _fcDraft.field_order = [];
  if (!_fcDraft.field_order.includes(key)) _fcDraft.field_order.push(key);
  _renderFcFields();
};

window._fcRenameField = function (key) {
  const current = _getFieldLabel(key, _fcDraft);
  const next = prompt(`แก้ไขชื่อหัวข้อ "${current}":`, current);
  if (next == null) return;
  const trimmed = next.trim();
  _fcMarkDirty();
  if (!_fcDraft.fields[key]) _fcDraft.fields[key] = {};
  // ถ้าตั้งเหมือน default → ลบ override ออก (เก็บ config สะอาด)
  if (!trimmed || trimmed === FIELD_LABELS[key]) {
    delete _fcDraft.fields[key].label;
  } else {
    _fcDraft.fields[key].label = trimmed;
  }
  _renderFcFields();
};

// ── Custom text fields (เก็บค่าใน extra_fields JSONB) ──────
function _renderFcCustomFields() {
  const list = document.getElementById("fcCustomList");
  if (!list || !_fcDraft) return;
  if (!Array.isArray(_fcDraft.custom_fields)) _fcDraft.custom_fields = [];
  if (!_fcDraft.custom_fields.length) {
    list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text3);font-size:12px">ยังไม่มีฟิลด์เพิ่มเติม — เพิ่มด้านบน</div>';
    return;
  }
  list.innerHTML = _fcDraft.custom_fields.map((cf, i) => `
    <div class="drag-row" draggable="true" data-list="custom" data-idx="${i}"
      ondragstart="window._fcDragStart(event, 'custom', ${i})"
      ondragover="window._fcDragOver(event)"
      ondragleave="window._fcDragLeave(event)"
      ondrop="window._fcDrop(event, 'custom', ${i})"
      ondragend="window._fcDragEnd(event)">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
      <span class="drag-num">${i + 1}.</span>
      <span class="drag-row-label">${escapeHtml(cf.label)}</span>
      <span class="drag-row-key" title="key">${escapeHtml(cf.key)}</span>
      <button class="drag-row-edit" title="แก้ไขชื่อ" onclick="window._fcRenameCustom(${i})">✏️</button>
      <button class="drag-row-del" title="ลบ" onclick="window._fcRemoveCustom(${i})">🗑</button>
    </div>
  `).join("");
}

window.addCustomField = function () {
  const inp = document.getElementById("fcNewCustomLabel");
  const label = inp.value.trim();
  if (!label) { inp.focus(); return; }
  _fcMarkDirty();
  const baseKey = "cf_" + label.toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]/gu, "").replace(/\s+/g, "_").slice(0, 36);
  let key = baseKey;
  const used = new Set((_fcDraft.custom_fields || []).map(c => c.key));
  let n = 2;
  while (used.has(key)) key = `${baseKey}_${n++}`;
  if (!Array.isArray(_fcDraft.custom_fields)) _fcDraft.custom_fields = [];
  _fcDraft.custom_fields.push({ key, label });
  inp.value = "";
  _renderFcCustomFields();
};

window._fcRenameCustom = function (idx) {
  const cf = _fcDraft.custom_fields[idx];
  if (!cf) return;
  const next = prompt(`แก้ไขชื่อฟิลด์ "${cf.label}":`, cf.label);
  if (next == null || !next.trim()) return;
  _fcMarkDirty();
  cf.label = next.trim();
  _renderFcCustomFields();
};

window._fcRemoveCustom = function (idx) {
  _fcMarkDirty();
  _fcDraft.custom_fields.splice(idx, 1);
  _renderFcCustomFields();
};

function _fcMarkDirty() {
  if (_fcUseTemplate && _fcInfo?.templateId) {
    _fcUseTemplate = false;
    _renderFcSourceBanner();
  }
}
window._fcToggleShow = function (key, val) {
  _fcMarkDirty();
  if (!_fcDraft.fields[key]) _fcDraft.fields[key] = {};
  _fcDraft.fields[key].show = val;
  if (!val) _fcDraft.fields[key].required = false;
  _renderFcFields();
};
window._fcToggleReq = function (key, val) {
  _fcMarkDirty();
  if (!_fcDraft.fields[key]) _fcDraft.fields[key] = {};
  _fcDraft.fields[key].required = val;
};
window._fcToggleColumn = function (key, val) {
  _fcMarkDirty();
  if (!_fcDraft.fields[key]) _fcDraft.fields[key] = {};
  _fcDraft.fields[key].column = val;
  _renderFcFields();
};

function _renderFcQuals() {
  const list = document.getElementById("fcQualList");
  if (!list || !_fcDraft) return;
  if (!_fcDraft.qualifications.length) {
    list.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">ยังไม่มี checklist — เพิ่มด้านบน</div>';
    return;
  }
  list.innerHTML = _fcDraft.qualifications.map((q, i) => `
    <div class="drag-row" draggable="true" data-list="qual" data-idx="${i}"
      ondragstart="window._fcDragStart(event, 'qual', ${i})"
      ondragover="window._fcDragOver(event)"
      ondragleave="window._fcDragLeave(event)"
      ondrop="window._fcDrop(event, 'qual', ${i})"
      ondragend="window._fcDragEnd(event)">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⋮⋮</span>
      <span class="drag-num">${i + 1}.</span>
      <span class="drag-row-label">${escapeHtml(q.label)}</span>
      <span class="drag-row-key" title="key">${escapeHtml(q.key)}</span>
      <button class="drag-row-del" onclick="window.removeQualification(${i})" title="ลบ">🗑</button>
    </div>
  `).join("");
}

// ── Drag-and-drop handlers (Field Config Modal) ────────────
let _fcDragSrc = null;
window._fcDragStart = function (ev, listType, idx) {
  _fcDragSrc = { listType, idx };
  ev.dataTransfer.effectAllowed = "move";
  try { ev.dataTransfer.setData("text/plain", String(idx)); } catch {}
  ev.currentTarget.classList.add("dragging");
};
window._fcDragOver = function (ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "move";
  ev.currentTarget.classList.add("drag-over");
};
window._fcDragLeave = function (ev) {
  ev.currentTarget.classList.remove("drag-over");
};
window._fcDragEnd = function (ev) {
  ev.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".drag-row.drag-over").forEach(el => el.classList.remove("drag-over"));
  _fcDragSrc = null;
};
window._fcDrop = function (ev, listType, targetIdx) {
  ev.preventDefault();
  ev.currentTarget.classList.remove("drag-over");
  if (!_fcDragSrc || _fcDragSrc.listType !== listType) return;
  const srcIdx = _fcDragSrc.idx;
  if (srcIdx === targetIdx) return;
  _fcMarkDirty();
  const arr = listType === "field" ? _fcDraft.field_order
            : listType === "custom" ? _fcDraft.custom_fields
            : _fcDraft.qualifications;
  const [moved] = arr.splice(srcIdx, 1);
  arr.splice(targetIdx, 0, moved);
  _fcDragSrc = null;
  if (listType === "field") _renderFcFields();
  else if (listType === "custom") _renderFcCustomFields();
  else _renderFcQuals();
};

window.addQualification = function () {
  const inp = document.getElementById("fcNewQualLabel");
  const label = inp.value.trim();
  if (!label) { inp.focus(); return; }
  _fcMarkDirty();
  // generate key from label (slugify Thai/EN → strip punctuation, replace space _)
  const baseKey = label.toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]/gu, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  let key = baseKey || `q${Date.now()}`;
  // dedupe
  let n = 2;
  const used = new Set(_fcDraft.qualifications.map(q => q.key));
  while (used.has(key)) { key = `${baseKey}_${n++}`; }
  _fcDraft.qualifications.push({ key, label });
  inp.value = "";
  _renderFcQuals();
};

window.removeQualification = function (idx) {
  _fcMarkDirty();
  _fcDraft.qualifications.splice(idx, 1);
  _renderFcQuals();
};

window.saveFieldConfig = async function () {
  if (!_fcDraft || !currentEventId) return;
  // If template is linked AND toggle "ใช้ตาม template" is ON → clear override (= {})
  // Otherwise → save _fcDraft as override
  const useTemplate = _fcInfo?.templateId && _fcUseTemplate;
  const body = { attendee_field_config: useTemplate ? {} : _fcDraft };
  try {
    await sbFetch("events", `?event_id=eq.${currentEventId}`, {
      method: "PATCH",
      body,
    });
    _invalidateEventConfigCache();
    // Pre-warm cache เพื่อให้ Spreadsheet mode rebuild header ด้วยข้อมูลใหม่
    await fetchEventFieldConfig(currentEventId).catch(() => {});
    showToast(useTemplate ? "ล้าง override · sync template แล้ว 🔗" : "บันทึก override แล้ว ⚡", "success");
    window.closeFieldConfigModal();
    // ถ้า spreadsheet mode → re-render เพื่อให้ column layout sync
    filterTable();   // re-render เพื่อให้ column layout sync กับ config ใหม่
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

// ── PUBLIC ENTRY: open form from search row "+ ผู้เรียนใหม่" ──
window.openGuestFormFromSearch = function (rowId) {
  // Hide member-suggest dropdown first
  const sug = document.getElementById("memberSuggest");
  if (sug) sug.style.display = "none";
  _lastMemberResults = [];

  const r = _findRow(rowId);
  const prefillName = (r?.name || "").trim();
  // If looks like a digit-only string → don't prefill (user was searching for member code)
  const looksLikeCode = /^\d{3,10}$/.test(prefillName);
  window.openAttendeeForm({
    name: looksLikeCode ? "" : prefillName,
    paymentStatus: r?.paymentStatus || "UNPAID",
    _sourceRowId: rowId,
  });
};

// ── PUBLIC ENTRY: open form to edit a saved attendee ──
window.openAttendeeEdit = function (attId) {
  const a = allAttendees.find(x => x.attendee_id === attId);
  if (!a) { showToast("ไม่พบรายการ", "error"); return; }
  window.openAttendeeForm({
    attId: a.attendee_id,
    memberCode: a.member_code || "",
    personRole: a.person_role || "guest",
    name: a.name,
    phone: a.phone,
    position_level: a.position_level,
    upline_id: a.upline_id,
    cs_staff: a.cs_staff,
    line_name_reported: a.line_name_reported,
    fb_page_name: a.fb_page_name,
    had_attended_before: a.had_attended_before,
    attendee_note: a.attendee_note,
    extra_fields: a.extra_fields || {},
    paymentStatus: a.payment_status,
  });
};

// ============================================================
// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initPage().then(startAutoRefresh));
} else {
  initPage().then(startAutoRefresh);
}
