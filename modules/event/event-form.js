/* ============================================================
   event-form.js — Controller for Event Form page
============================================================ */

import {
  fetchEventById,
  fetchUsers,
  fetchEvents,
  fetchEventCategories,
  fetchPlaces,
  fetchAllPlaceRooms,
  createEvent,
  updateEvent,
  uploadEventPoster,
  createNotification,
  fetchEventTiers,
  createEventTier,
  updateEventTier,
  removeEventTier,
} from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let editId = null;
// posterFile และ posterUrl ใช้ผ่าน window._posterFile / window._posterUrl
// (set โดย plain script ใน HTML เพื่อแก้ ES Module timing issue)

// Ticket tiers state — array of tier objects (new rows have no tier_id)
let _ticketTiers = [];
// IDs ของ tier เดิมที่ถูกลบออก (ส่ง DELETE ตอน save)
let _deletedTierIds = [];

// ── FLATPICKR instances ────────────────────────────────────
let fpEventDate, fpEndDate;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  const params = new URLSearchParams(window.location.search);
  editId = params.get("id") ? parseInt(params.get("id")) : null;

  // Init flatpickr dd/mm/yyyy
  const fpOpts = { dateFormat: "d/m/Y", allowInput: true, parseDate: (dateStr) => {
    // support ISO format from DB (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    // support d/m/Y format
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split("/").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date(dateStr);
  }};
  fpEventDate = flatpickr("#fEventDate", fpOpts);
  fpEndDate = flatpickr("#fEndDate", fpOpts);

  await Promise.all([loadUsers(), loadEventCategories(), loadPlaces(), loadCourseSeries(), loadLineChannels()]);

  if (editId) {
    document.getElementById("pageTitle").textContent = "✏️ แก้ไขกิจกรรม";
    document.getElementById("pageSubtitle").textContent = `Event ID: ${editId}`;
    const btnSave = document.getElementById("btnSave") || document.getElementById("floatingSaveBtn");
    if (btnSave) btnSave.title = "บันทึกการแก้ไข";
    await loadEventData();
    await refreshQrStatus();
  } else {
    await autoGenerateCode();
  }
}

// ── QR Designer ────────────────────────────────────────────
async function refreshQrStatus() {
  const lbl = document.getElementById("qrStatusLbl");
  if (!lbl || !editId) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/events?event_id=eq.${editId}&select=qr_style_config&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const rows = await res.json();
    const hasCustom = !!(rows?.[0]?.qr_style_config);
    lbl.textContent = hasCustom
      ? "✅ event นี้มี QR style เฉพาะตัวแล้ว · กดเพื่อแก้ไข"
      : "ใช้ preset default · กดปุ่มเพื่อปรับแต่งเฉพาะ event นี้";
    lbl.style.color = hasCustom ? "#15803d" : "";
  } catch (e) { /* silent */ }
}

window.openQrDesigner = function () {
  if (!editId) {
    alert("กรุณาบันทึก event ก่อน แล้วกลับมากดปุ่มนี้อีกครั้ง\n(Designer ต้องมี event_id เพื่อบันทึก style)");
    return;
  }
  location.href = `event-qr-designer.html?event_id=${editId}`;
};

// ── LOAD USERS ─────────────────────────────────────────────
async function loadUsers() {
  try {
    const users = await fetchUsers();
    const sel = document.getElementById("fAssignedTo");
    users.forEach((u) => {
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${u.user_id}">${u.full_name}</option>`,
      );
    });

    // Default = user ที่ login อยู่ (ถ้ายังไม่ได้ set จาก editId)
    if (!editId) {
      const session = JSON.parse(
        localStorage.getItem("erp_session") ||
          sessionStorage.getItem("erp_session") ||
          "{}",
      );
      if (session?.user_id) {
        sel.value = session.user_id;
      }
    }
  } catch (e) {
    showToast("โหลดข้อมูลผู้ใช้ไม่ได้", "error");
  }
}
// ── LOAD PLACES ────────────────────────────────────────────
async function loadPlaces() {
  try {
    const [places, allRooms] = await Promise.all([fetchPlaces(), fetchAllPlaceRooms()]);
    const activePlaces = places.filter((p) => p.status === "ACTIVE");

    // group rooms by place_id
    const roomsByPlace = {};
    (allRooms || []).forEach((r) => {
      if (!roomsByPlace[r.place_id]) roomsByPlace[r.place_id] = [];
      roomsByPlace[r.place_id].push(r);
    });

    const input = document.getElementById("fLocation");
    const dropdown = document.getElementById("locationDropdown");
    if (!input || !dropdown) return;

    let confirmedValue = input.value || "";

    window._setConfirmedLocation = (v) => {
      confirmedValue = v || "";
      input.value = confirmedValue;
      updateClearBtn();
    };

    window._getConfirmedLocation = () => confirmedValue || null;

    function updateClearBtn() {
      const btn = document.getElementById("btnClearLocation");
      if (btn) btn.style.display = confirmedValue ? "block" : "none";
    }

    window._clearLocation = function () {
      confirmedValue = "";
      input.value = "";
      dropdown.style.display = "none";
      updateClearBtn();
    };

    function renderDropdown(keyword) {
      const kw = (keyword || "").toLowerCase();
      const filtered = activePlaces.filter((p) => {
        if (!kw) return true;
        if (p.place_name.toLowerCase().includes(kw)) return true;
        const pRooms = roomsByPlace[p.place_id] || [];
        return pRooms.some((r) => (r.room_name || "").toLowerCase().includes(kw));
      });

      if (!filtered.length) {
        dropdown.style.display = "none";
        return;
      }

      let html = "";
      filtered.forEach((p) => {
        const imgs = p.image_urls && p.image_urls.length ? p.image_urls
          : p.cover_image_url ? [p.cover_image_url] : [];
        const thumb = imgs[0]
          ? `<img src="${imgs[0]}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`
          : placeTypeIcon(p.place_type);

        const pRooms = roomsByPlace[p.place_id] || [];

        if (pRooms.length > 0) {
          // place header (not clickable)
          html += `
            <div class="ef-loc-header">
              <div class="ef-loc-icon">${thumb}</div>
              <div class="ef-loc-info">
                <div class="ef-loc-name" style="font-weight:800">${p.place_name}</div>
                ${p.address ? `<div class="ef-loc-addr">${p.address}</div>` : ""}
              </div>
            </div>`;
          // sub-rooms
          pRooms.forEach((r) => {
            html += `
              <div class="ef-loc-item ef-loc-subroom" data-name="${p.place_name} — ${r.room_name}">
                <div class="ef-loc-icon" style="font-size:16px">🚪</div>
                <div class="ef-loc-info">
                  <div class="ef-loc-name">${r.room_name}</div>
                </div>
                ${r.capacity ? `<div class="ef-loc-cap">👥 ${r.capacity}</div>` : ""}
              </div>`;
          });
        } else {
          // place without rooms (clickable directly)
          html += `
            <div class="ef-loc-item" data-name="${p.place_name}">
              <div class="ef-loc-icon">${thumb}</div>
              <div class="ef-loc-info">
                <div class="ef-loc-name">${p.place_name}</div>
                ${p.address ? `<div class="ef-loc-addr">${p.address}</div>` : ""}
              </div>
              ${p.capacity ? `<div class="ef-loc-cap">👥 ${p.capacity.toLocaleString()}</div>` : ""}
            </div>`;
        }
      });

      dropdown.innerHTML = html;
      dropdown.style.display = "block";

      dropdown.querySelectorAll(".ef-loc-item").forEach((el) => {
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          confirmedValue = el.dataset.name;
          input.value = confirmedValue;
          dropdown.style.display = "none";
          updateClearBtn();
        });
      });
    }

    input.addEventListener("focus", () => {
      input.select();
      // แสดง dropdown เฉพาะเมื่อพิมพ์แล้ว หรือมี <= 5 สถานที่
      if (activePlaces.length <= 5) {
        renderDropdown("");
      } else {
        dropdown.style.display = "none";
      }
    });
    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (q.length >= 1) {
        renderDropdown(q);
      } else {
        dropdown.style.display = "none";
      }
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        input.value = confirmedValue;
        dropdown.style.display = "none";
      }, 150);
    });

    updateClearBtn();
  } catch (e) {
    console.error("โหลดสถานที่ไม่ได้", e);
  }
}

function placeTypeIcon(type) {
  return (
    { HOTEL: "🏨", MEETING_ROOM: "🏢", RESTAURANT: "🍽", EVENT_SPACE: "🎤" }[
      type
    ] || "📍"
  );
}

// ── LOAD EVENT CATEGORIES ──────────────────────────────────
let holidayCatIds = [];

async function loadEventCategories() {
  try {
    const cats = await fetchEventCategories();
    const sel = document.getElementById("fEventType");
    // ล้าง option เดิมทิ้ง เหลือแค่ placeholder
    sel.innerHTML = `<option value="">— เลือกประเภทกิจกรรม —</option>`;
    cats.forEach((c) => {
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${c.event_category_id}">${c.icon || ""} ${c.category_name}</option>`,
      );
      // เก็บ ID หมวด "วันหยุดบริษัท" ไว้กรอง autocomplete
      if (c.category_name === "วันหยุดบริษัท") {
        holidayCatIds.push(c.event_category_id);
      }
    });
  } catch (e) {
    showToast("โหลดประเภทกิจกรรมไม่ได้", "error");
  }
}

// ── LOAD LINE CHANNELS ─────────────────────────────────────
async function loadLineChannels() {
  const sel = document.getElementById("fLineChannelId");
  if (!sel) return;
  try {
    const { url, key } = getSB();
    const r = await fetch(
      `${url}/rest/v1/line_channels?is_active=eq.true&order=is_default.desc,purpose.asc,id.asc&select=id,name,purpose,is_default`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) return;
    const rows = await r.json();
    sel.innerHTML =
      '<option value="">— ใช้ default ของระบบ —</option>' +
      rows.map(c => {
        const tag = c.is_default ? " ⭐" : "";
        return `<option value="${c.id}">[${c.purpose}] ${c.name}${tag}</option>`;
      }).join("");
  } catch (e) {
    console.warn("loadLineChannels:", e.message);
  }
}

// ── LOAD COURSE SERIES + LEVELS ────────────────────────────
let _allSeries = [];
let _allLevels = {};  // seriesId → [levels]

async function loadCourseSeries() {
  try {
    const { url, key } = getSB();
    const [sRes, lRes] = await Promise.all([
      fetch(`${url}/rest/v1/course_series?select=*&order=name.asc`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }),
      fetch(`${url}/rest/v1/course_levels?select=*&order=series_id,level_order.asc`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }),
    ]);
    _allSeries = sRes.ok ? await sRes.json() : [];
    const levels = lRes.ok ? await lRes.json() : [];
    _allLevels = {};
    for (const lv of levels) {
      if (!_allLevels[lv.series_id]) _allLevels[lv.series_id] = [];
      _allLevels[lv.series_id].push(lv);
    }
    const sel = document.getElementById('fSeries');
    sel.innerHTML = '<option value="">— ไม่ผูกหลักสูตร —</option>' +
      _allSeries.map(s => {
        const icon = (s.icon && !s.icon.includes(':')) ? s.icon : '📚';
        return `<option value="${s.id}">${icon} ${s.name}</option>`;
      }).join('');
  } catch (e) {
    console.warn('loadCourseSeries:', e.message);
  }
}

window.onSeriesChange = function () {
  const seriesId = document.getElementById('fSeries').value;
  const sel = document.getElementById('fLevel');
  if (!seriesId) {
    sel.innerHTML = '<option value="">— เลือก Series ก่อน —</option>';
    sel.disabled = true;
    return;
  }
  const levels = _allLevels[seriesId] || [];
  sel.innerHTML = '<option value="">— เลือก Level —</option>' +
    levels.map(lv => `<option value="${lv.id}">Lv.${lv.level_order}: ${lv.level_name}</option>`).join('');
  sel.disabled = false;
};

// ── LOAD EVENT DATA (กรณีแก้ไข) ────────────────────────────
async function loadEventData() {
  showLoading(true);
  try {
    const e = await fetchEventById(editId);
    if (!e) {
      showToast("ไม่พบข้อมูลกิจกรรม", "error");
      return;
    }

    document.getElementById("fEventName").value = e.event_name || "";
    document.getElementById("fEventCode").value = e.event_code || "";
    document.getElementById("fEventType").value = e.event_category_id || "";
    if (e.event_date) fpEventDate.setDate(e.event_date, true);
    if (e.end_date) fpEndDate.setDate(e.end_date, true);
    document.getElementById("fStartTime").value = e.start_time
      ? e.start_time.slice(0, 5)
      : "";
    document.getElementById("fEndTime").value = e.end_time
      ? e.end_time.slice(0, 5)
      : "";
    if (window._setConfirmedLocation) window._setConfirmedLocation(e.location || "");
    else document.getElementById("fLocation").value = e.location || "";
    document.getElementById("fMaxAttendees").value = e.max_attendees || "";
    document.getElementById("fPrice").value = e.price != null ? e.price : "";
    document.getElementById("fGraceDays").value = e.grace_days != null ? e.grace_days : "";
    document.getElementById("fAssignedTo").value = e.assigned_to || "";
    document.getElementById("fStatus").value = e.status || "DRAFT";
    document.getElementById("fDescription").value = e.description || "";

    // Registration toggles
    document.getElementById("fRegEnabled").checked = !!e.registration_enabled;
    document.getElementById("fMembersOnly").checked = !!e.members_only;

    // LINE channel (populated async — wait briefly if options not loaded yet)
    const lineSel = document.getElementById("fLineChannelId");
    if (lineSel) {
      if (e.line_channel_id != null) lineSel.value = String(e.line_channel_id);
    }

    // Series + Level
    if (e.series_id) {
      document.getElementById('fSeries').value = e.series_id;
      onSeriesChange();
      if (e.level_id) document.getElementById('fLevel').value = e.level_id;
    }

    // โหลดรูปภาพ — รองรับทั้ง image_urls (array) และ poster_url เดิม
    const imgUrls = Array.isArray(e.image_urls) && e.image_urls.length
      ? e.image_urls
      : (e.poster_url ? [e.poster_url] : []);
    window._imageUrls = [...imgUrls, ...new Array(5).fill(null)].slice(0, 5);
    window._imageFiles = new Array(5).fill(null);
    if (typeof window._renderImgGrid === "function") window._renderImgGrid();

    // โหลด ticket tiers
    await loadTicketTiers(editId);
  } catch (err) {
    showToast("โหลดข้อมูลไม่ได้: " + err.message, "error");
  }
  showLoading(false);
}

// ── AUTO GENERATE CODE ─────────────────────────────────────
async function autoGenerateCode() {
  const { url, key } = getSB();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `EVT-${yyyy}${mm}-`;

  const res = await fetch(
    `${url}/rest/v1/events?select=event_code&event_code=like.${prefix}*`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json();

  let maxSeq = 0;
  if (rows?.length) {
    rows.forEach((r) => {
      const n = parseInt((r.event_code || "").split("-").pop(), 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    });
  }

  const code = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
  document.getElementById("fEventCode").value = code;
  return code;
}

// ── TICKET TIERS ───────────────────────────────────────────
function makeEmptyTier() {
  return {
    tier_id: null,
    tier_name: "",
    price: 0,
    valid_from: "",   // YYYY-MM-DD (html date input value)
    valid_to: "",     // YYYY-MM-DD
    seat_limit: "",
  };
}

function isTierActiveToday(t) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const from = t.valid_from || null;
  const to = t.valid_to || null;
  if (from && today < from) return false;
  if (to && today > to) return false;
  return true;
}

function renderTiers() {
  const box = document.getElementById("tiersContainer");
  const emptyMsg = document.getElementById("tiersEmpty");
  if (!box) return;

  if (!_ticketTiers.length) {
    box.innerHTML = "";
    if (emptyMsg) emptyMsg.style.display = "block";
    return;
  }
  if (emptyMsg) emptyMsg.style.display = "none";

  box.innerHTML = _ticketTiers
    .map((t, i) => {
      const active = isTierActiveToday(t);
      return `<div class="tier-row ${active ? "tier-active" : ""}" data-idx="${i}">
        <div>
          <input type="text" placeholder="Early Bird"
            value="${escapeAttr(t.tier_name)}"
            oninput="window.onTierField(${i},'tier_name',this.value)">
          ${active ? '<span class="tier-badge-active">ACTIVE</span>' : ""}
        </div>
        <input type="number" min="0" step="0.01" placeholder="0.00"
          value="${t.price ?? ""}"
          oninput="window.onTierField(${i},'price',this.value)">
        <input type="date"
          value="${t.valid_from || ""}"
          oninput="window.onTierField(${i},'valid_from',this.value)">
        <input type="date"
          value="${t.valid_to || ""}"
          oninput="window.onTierField(${i},'valid_to',this.value)">
        <input type="number" min="0" placeholder="∞"
          value="${t.seat_limit ?? ""}"
          oninput="window.onTierField(${i},'seat_limit',this.value)">
        <button type="button" class="tier-remove-btn" title="ลบระดับนี้"
          onclick="window.removeTierRow(${i})">🗑</button>
      </div>`;
    })
    .join("");
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

window.addTierRow = function () {
  _ticketTiers.push(makeEmptyTier());
  renderTiers();
};

window.removeTierRow = function (idx) {
  const t = _ticketTiers[idx];
  if (!t) return;
  if (t.tier_id) _deletedTierIds.push(t.tier_id);
  _ticketTiers.splice(idx, 1);
  renderTiers();
};

window.onTierField = function (idx, field, value) {
  const t = _ticketTiers[idx];
  if (!t) return;
  t[field] = value;
  // ไม่ re-render ตอนพิมพ์ — จะเสีย focus; ACTIVE badge จะ sync ตอน add/remove row
};

async function loadTicketTiers(eventId) {
  try {
    const tiers = await fetchEventTiers(eventId);
    _ticketTiers = (tiers || []).map((t) => ({
      tier_id: t.tier_id,
      tier_name: t.tier_name || "",
      price: t.price ?? 0,
      valid_from: t.valid_from || "",
      valid_to: t.valid_to || "",
      seat_limit: t.seat_limit ?? "",
    }));
    _deletedTierIds = [];
    renderTiers();
  } catch (e) {
    console.warn("loadTicketTiers:", e);
  }
}

async function saveTicketTiers(eventId) {
  // 1) Delete removed tiers
  for (const id of _deletedTierIds) {
    try { await removeEventTier(id); } catch (e) { console.warn("remove tier:", e); }
  }
  _deletedTierIds = [];

  // 2) Update existing + create new
  for (let i = 0; i < _ticketTiers.length; i++) {
    const t = _ticketTiers[i];
    const name = (t.tier_name || "").trim();
    if (!name) continue; // skip blank rows silently

    const body = {
      event_id: eventId,
      tier_name: name,
      price: parseFloat(t.price) || 0,
      valid_from: t.valid_from || null,
      valid_to: t.valid_to || null,
      seat_limit: t.seat_limit === "" || t.seat_limit == null
        ? null
        : parseInt(t.seat_limit) || null,
      sort_order: i,
    };
    try {
      if (t.tier_id) {
        await updateEventTier(t.tier_id, body);
      } else {
        const created = await createEventTier(body);
        if (created?.tier_id) t.tier_id = created.tier_id;
      }
    } catch (e) {
      console.warn("save tier:", e);
      throw new Error("บันทึก tier ไม่สำเร็จ: " + e.message);
    }
  }
}

// ── VALIDATE ───────────────────────────────────────────────
function validate() {
  const name = document.getElementById("fEventName").value.trim();
  const type = document.getElementById("fEventType").value;
  const date = fpEventDate.selectedDates[0];

  if (!name) {
    showToast("กรุณาระบุชื่องาน", "error");
    return false;
  }
  if (!type) {
    showToast("กรุณาเลือกประเภทงาน", "error");
    return false;
  }
  if (!date) {
    showToast("กรุณาระบุวันที่เริ่มงาน", "error");
    return false;
  }

  const endDate = fpEndDate.selectedDates[0];
  if (endDate && endDate < date) {
    showToast("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม", "error");
    return false;
  }
  return true;
}

// ── SAVE ───────────────────────────────────────────────────
window._saveEventImpl = async function () {
  if (!validate()) return;

  showLoading(true);
  try {
    const payload = {
      event_name: document.getElementById("fEventName").value.trim(),
      event_code: document.getElementById("fEventCode").value.trim(),
      event_category_id:
        parseInt(document.getElementById("fEventType").value) || null,

      event_date: fpEventDate.selectedDates[0] ? fpEventDate.formatDate(fpEventDate.selectedDates[0], "Y-m-d") : "",
      end_date: fpEndDate.selectedDates[0] ? fpEndDate.formatDate(fpEndDate.selectedDates[0], "Y-m-d") : null,
      start_time: document.getElementById("fStartTime").value || null,
      end_time: document.getElementById("fEndTime").value || null,
      location: window._getConfirmedLocation ? window._getConfirmedLocation() : (document.getElementById("fLocation").value.trim() || null),
      max_attendees:
        parseInt(document.getElementById("fMaxAttendees").value) || 0,
      price: parseFloat(document.getElementById("fPrice").value) || 0,
      grace_days: (() => {
        const v = document.getElementById("fGraceDays").value.trim();
        return v === "" ? null : parseInt(v) || 0;
      })(),
      assigned_to:
        parseInt(document.getElementById("fAssignedTo").value) || null,
      status: document.getElementById("fStatus").value,
      description: document.getElementById("fDescription").value.trim() || null,
      series_id: document.getElementById("fSeries").value || null,
      level_id: document.getElementById("fLevel").value || null,
      registration_enabled: document.getElementById("fRegEnabled").checked,
      members_only: document.getElementById("fMembersOnly").checked,
      line_channel_id: (() => {
        const v = document.getElementById("fLineChannelId")?.value || "";
        return v ? parseInt(v) : null;
      })(),
    };

    let savedId = editId;
    if (editId) {
      await updateEvent(editId, payload);
    } else {
      const res = await createEvent(payload);
      savedId = res?.event_id;
    }

    // อัปโหลดรูปภาพใหม่ และรวม URLs
    const imageFiles = window._imageFiles || [];
    const imageUrls  = [...(window._imageUrls || [])];
    for (let i = 0; i < 5; i++) {
      if (imageFiles[i] && savedId) {
        imageUrls[i] = await uploadEventPoster(savedId, imageFiles[i]);
      }
    }
    const finalUrls = imageUrls.filter(Boolean);
    await updateEvent(savedId, {
      poster_url: finalUrls[0] || null,
      image_urls: finalUrls.length ? finalUrls : null,
    });

    // Save ticket tiers (diff-based)
    if (savedId) await saveTicketTiers(savedId);

    if (!editId && payload.assigned_to) {
      await createNotification({
        user_id: payload.assigned_to,
        module: "EVENT",
        ref_type: "EVENT",
        ref_id: savedId,
        title: "มีงานใหม่ได้รับมอบหมาย",
        message: `คุณได้รับมอบหมายให้ดูแลงาน "${payload.event_name}"`,
      }).catch(() => {});
    }

    showToast(editId ? "บันทึกการแก้ไขแล้ว" : "สร้างกิจกรรมแล้ว", "success");
    setTimeout(() => {
      window.location.href = "events-list.html";
    }, 1200);
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};

// ── UTILS ──────────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
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

// ── AUTOCOMPLETE EVENT NAME ─────────────────────────────────
let eventNameList = [];

async function loadEventNames() {
  try {
    const events = await fetchEvents();
    eventNameList = [
      ...new Set(
        events
          .filter((e) => !holidayCatIds.includes(e.event_category_id))
          .map((e) => e.event_name)
          .filter(Boolean)
      ),
    ];
  } catch (e) {
    console.error("โหลดชื่อ event ไม่ได้", e);
  }
}

function setupEventNameAutocomplete() {
  const input = document.getElementById("fEventName");
  const dropdown = document.getElementById("eventNameDropdown");

  function showDropdown() {
    const keyword = input.value.toLowerCase();
    const filtered = eventNameList.filter((name) =>
      name.toLowerCase().includes(keyword),
    );

    if (!filtered.length) {
      dropdown.style.display = "none";
      return;
    }

    dropdown.innerHTML = filtered
      .slice(0, 8)
      .map((name) => `<div class="ef-dropdown-item">${name}</div>`)
      .join("");

    dropdown.style.display = "block";

    dropdown.querySelectorAll(".ef-dropdown-item").forEach((el) => {
      el.onclick = () => {
        input.value = el.textContent;
        dropdown.style.display = "none";
      };
    });
  }

  input.addEventListener("focus", showDropdown);
  input.addEventListener("input", showDropdown);

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.style.display = "none";
    }
  });
}

// ── START ──────────────────────────────────────────────────
async function startPage() {
  await initPage();
  await loadEventNames();
  setupEventNameAutocomplete();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startPage);
} else {
  startPage();
}
