/* ============================================================
   Settings — Notification Rules CRUD
   ============================================================ */

// kind:
//   'on_status'  → event-driven (trigger ตอน status เปลี่ยน) — ใช้ฮุคใน browser ผ่าน Notify.evaluateRules
//   'scheduled'  → time-driven  (cron ใน ai-proxy ยิงทุก 15 นาที) ต้องตั้ง schedule_anchor + schedule_*
const TRIGGERS = {
  "event.confirmed": {
    label: "📌 Event ยืนยัน (CONFIRMED)",
    kind: "on_status",
    placeholders: ["event_code", "event_name", "event_type", "event_date", "end_date", "location", "dept", "attendees_count", "request_code", "approver"],
    sample: {
      event_code:      "EVT-2026-05-001",
      event_name:      "Tech Summit 2026",
      event_type:      "EVENT",
      event_date:      "15/05/2026",
      end_date:        "16/05/2026",
      location:        "Bangkok Convention Center",
      dept:            "ทีมจัดงาน",
      attendees_count: 120,
      request_code:    "REQ-2026-05-001",
      approver:        "ภพ (admin)",
    },
  },
  "booking.approved": {
    label: "🏢 จองห้องประชุมอนุมัติ",
    kind: "on_status",
    placeholders: ["room_name", "place_name", "booking_date", "start_time", "end_time", "booked_by_name", "cs_name", "request_code", "approver"],
    sample: {
      room_name:      "ห้องประชุมใหญ่",
      place_name:     "ออฟฟิศ BKK",
      booking_date:   "20/05/2026",
      start_time:     "09:00",
      end_time:       "12:00",
      booked_by_name: "วิชัย ตั้งใจ",
      cs_name:        "น้องส้ม",
      request_code:   "RBKQ-2026-05-001",
      approver:       "ภพ (admin)",
    },
  },
  "event.scheduled": {
    label: "⏰ Event — แจ้งตามเวลา (cron)",
    kind: "scheduled",
    anchor: "event_date",
    placeholders: ["event_code", "event_name", "event_type", "event_date", "end_date", "location", "attendees_count", "start_time", "end_time"],
    sample: {
      event_code:      "EVT-2026-05-001",
      event_name:      "Tech Summit 2026",
      event_type:      "EVENT",
      event_date:      "15/05/2026",
      end_date:        "16/05/2026",
      location:        "Bangkok Convention Center",
      attendees_count: 120,
      start_time:      "09:00",
      end_time:        "17:00",
    },
  },
  "booking.scheduled": {
    label: "⏰ Booking — แจ้งตามเวลา (cron)",
    kind: "scheduled",
    anchor: "booking_date",
    placeholders: ["request_code", "room_name", "place_name", "booking_date", "start_time", "end_time", "booked_by_name", "cs_name"],
    sample: {
      request_code:   "RBKQ-2026-05-001",
      room_name:      "ห้องประชุมใหญ่",
      place_name:     "ออฟฟิศ BKK",
      booking_date:   "20/05/2026",
      start_time:     "09:00",
      end_time:       "12:00",
      booked_by_name: "วิชัย ตั้งใจ",
      cs_name:        "น้องส้ม",
    },
  },
  "booking.before_start": {
    label: "⏰ Booking — ก่อนเริ่ม N นาที",
    kind: "scheduled",
    anchor: "booking_start_time",
    placeholders: ["request_code", "room_name", "place_name", "booking_date", "start_time", "end_time", "booked_by_name", "cs_name"],
    sample: {
      request_code:   "RBKQ-2026-05-001",
      room_name:      "ห้องประชุมใหญ่",
      place_name:     "ออฟฟิศ BKK",
      booking_date:   "20/05/2026",
      start_time:     "09:00",
      end_time:       "12:00",
      booked_by_name: "วิชัย ตั้งใจ",
      cs_name:        "น้องส้ม",
    },
  },
};

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(path, opts = {}) {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.method && opts.method !== "GET" ? "return=representation" : undefined,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// ── State ─────────────────────────────────────────────────
let allRules = [];
let allChannels = [];
let allUsers = [];      // for user-target picker
let allRoles = [];      // distinct roles
let allGroups = [];     // distinct group names
let editingId = null;
let editingTargetType = "role";
let editingTargetValues = [];
let editingSchedule = { offset_days: 0, offset_minutes: 0, time: "" };

// ── Init ──────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    await Promise.all([loadRules(), loadChannels(), loadUsersAndRoles()]);
    renderTable();
    populateTriggers();
    populateChannels();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadRules() {
  allRules = (await sbFetch("notification_rules?select=*&order=id.desc")) || [];
}

async function loadChannels() {
  allChannels = (await sbFetch("line_channels?select=id,name,purpose,is_default,is_active&is_active=eq.true&order=purpose.asc,name.asc")) || [];
}

async function loadUsersAndRoles() {
  allUsers = (await sbFetch("users?select=user_id,username,full_name,role,line_user_id,line_display_name,notification_groups,is_active&is_active=eq.true&order=full_name.asc")) || [];
  // distinct roles
  const r = new Set();
  const g = new Set();
  for (const u of allUsers) {
    if (u.role) r.add(u.role);
    (u.notification_groups || []).forEach((x) => g.add(x));
  }
  allRoles = [...r].sort();
  allGroups = [...g].sort();
}

// ── Render table ──────────────────────────────────────────
function renderTable() {
  const tb = document.getElementById("nrTbody");
  if (!allRules.length) {
    tb.innerHTML = `<tr><td colspan="6" class="nr-empty"><div class="nr-empty-icon">🔔</div>ยังไม่มีกฎ — กดปุ่ม "เพิ่มกฎ" ด้านบน</td></tr>`;
    return;
  }
  tb.innerHTML = allRules.map((r) => {
    const meta = TRIGGERS[r.trigger_key];
    const trig = meta?.label || r.trigger_key;
    const targetVals = Array.isArray(r.target_value) ? r.target_value : [];
    const targetText = targetVals.slice(0, 3).map((v) => {
      if (r.target_type === "user") {
        const u = allUsers.find((x) => x.user_id === v);
        return u ? (u.full_name || u.username) : `#${v}`;
      }
      return v;
    }).join(", ") + (targetVals.length > 3 ? ` +${targetVals.length - 3}` : "");
    const ch = allChannels.find((c) => c.id === r.channel_id);
    const chText = ch ? ch.name : `<span style="color:var(--text3)">default</span>`;
    let schedBadge = "";
    if (r.schedule_anchor) {
      const d = r.schedule_offset_days ?? 0;
      const t = r.schedule_time ? String(r.schedule_time).slice(0, 5) : "";
      const m = r.schedule_offset_minutes ?? 0;
      let info = "";
      if (r.schedule_anchor === "booking_start_time") {
        info = m < 0 ? `ก่อนเริ่ม ${Math.abs(m)} นาที` : `ตอนเริ่ม +${m}`;
      } else {
        const dayPhrase = d === 0 ? "วันงาน" : (d < 0 ? `ก่อน ${Math.abs(d)}d` : `+${d}d`);
        info = `${dayPhrase} · ${t}`;
      }
      schedBadge = `<span style="display:inline-block;margin-left:6px;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:700;background:#fef3c7;color:#92400e;">⏰ ${info}</span>`;
    }
    return `
      <tr>
        <td><div class="nr-name">${escapeHtml(r.rule_name)}</div></td>
        <td><span class="nr-trigger-chip">${escapeHtml(trig)}</span>${schedBadge}</td>
        <td>
          <span class="nr-target-type">${r.target_type}</span>
          <span style="font-size:12.5px;color:var(--text2);">${escapeHtml(targetText) || "—"}</span>
        </td>
        <td style="font-size:12.5px;">${chText}</td>
        <td style="text-align:center;">
          <label class="nr-toggle">
            <input type="checkbox" ${r.is_active ? "checked" : ""} onchange="toggleActive(${r.id}, this.checked)">
            <span class="nr-toggle-slider"></span>
          </label>
        </td>
        <td>
          <div class="nr-row-actions">
            <button class="btn-icon" title="แก้ไข" onclick="openRuleModal(${r.id})">✏️</button>
            <button class="btn-icon btn-danger" title="ลบ" onclick="deleteRule(${r.id})">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function toggleActive(id, on) {
  try {
    await sbFetch(`notification_rules?id=eq.${id}`, {
      method: "PATCH",
      body: { is_active: on },
    });
    const r = allRules.find((x) => x.id === id);
    if (r) r.is_active = on;
    showToast(on ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว", "success");
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error");
  }
}

async function deleteRule(id) {
  const r = allRules.find((x) => x.id === id);
  const name = r?.rule_name || `#${id}`;
  const ok = await window.ConfirmModal.open({
    title: "ลบกฎแจ้งเตือน?",
    message: `ลบกฎ "${name}" ไม่สามารถกู้คืนได้`,
    confirmText: "ลบ",
    danger: true,
  });
  if (!ok) return;
  try {
    await sbFetch(`notification_rules?id=eq.${id}`, { method: "DELETE" });
    showToast("ลบแล้ว", "success");
    await loadRules();
    renderTable();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
}

// ── Modal: open / close ───────────────────────────────────
function populateTriggers() {
  const sel = document.getElementById("fTrigger");
  sel.innerHTML = Object.entries(TRIGGERS)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
    .join("");
}

function populateChannels() {
  const sel = document.getElementById("fChannel");
  sel.innerHTML = `<option value="">— ใช้ default (announcement) —</option>` +
    allChannels.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (${c.purpose})</option>`).join("");
}

function openRuleModal(id) {
  editingId = id;
  const rule = id ? allRules.find((r) => r.id === id) : null;
  document.getElementById("nrModalTitle").textContent = rule ? "แก้ไขกฎ" : "เพิ่มกฎแจ้งเตือน";
  document.getElementById("fRuleName").value = rule?.rule_name || "";
  document.getElementById("fTrigger").value = rule?.trigger_key || Object.keys(TRIGGERS)[0];
  document.getElementById("fChannel").value = rule?.channel_id || "";
  document.getElementById("fTemplate").value = rule?.message_template || "";
  document.getElementById("fActive").checked = rule ? !!rule.is_active : true;
  document.getElementById("fPreview").classList.remove("show");

  editingTargetType = rule?.target_type || "role";
  editingTargetValues = Array.isArray(rule?.target_value) ? [...rule.target_value] : [];
  editingSchedule = {
    offset_days:    rule?.schedule_offset_days ?? 0,
    offset_minutes: rule?.schedule_offset_minutes ?? 0,
    time:           rule?.schedule_time ? String(rule.schedule_time).slice(0, 5) : "",
  };

  // set radio
  document.querySelectorAll("#fTargetTypeGroup .nr-radio").forEach((el) => {
    const t = el.dataset.type;
    el.classList.toggle("checked", t === editingTargetType);
    const inp = el.querySelector("input");
    inp.checked = t === editingTargetType;
    inp.onchange = () => {
      editingTargetType = t;
      editingTargetValues = [];
      document.querySelectorAll("#fTargetTypeGroup .nr-radio").forEach((x) => x.classList.toggle("checked", x.dataset.type === t));
      renderTargetPicker();
    };
  });

  renderTargetPicker();
  onTriggerChange();
  document.getElementById("nrModal").classList.add("open");
}

function closeRuleModal() {
  document.getElementById("nrModal").classList.remove("open");
  editingId = null;
}

function onTriggerChange() {
  const tk = document.getElementById("fTrigger").value;
  const meta = TRIGGERS[tk];
  const bar = document.getElementById("fPlaceholders");
  if (!meta) { bar.innerHTML = ""; return; }
  bar.innerHTML = meta.placeholders.map((p) =>
    `<span class="nr-ph" onclick="insertPlaceholder('${p}')">{{${p}}}</span>`
  ).join("");

  // โชว์/ซ่อน schedule fields ตาม trigger.kind
  const wrap = document.getElementById("fScheduleWrap");
  const chHint = document.getElementById("fChannelHint");
  if (meta.kind === "scheduled") {
    wrap.style.display = "block";
    chHint.style.display = "block";
    renderScheduleFields(meta);
  } else {
    wrap.style.display = "none";
    chHint.style.display = "none";
  }
}

function renderScheduleFields(meta) {
  const box = document.getElementById("fScheduleFields");
  if (meta.anchor === "booking_start_time") {
    box.innerHTML = `
      <div class="nr-row-2">
        <div class="nr-field" style="margin-bottom:0;">
          <label>Offset นาที (ก่อน start_time) *</label>
          <input type="number" id="fSchedMin" value="${editingSchedule.offset_minutes ?? -30}" oninput="updateScheduleState()">
          <div class="nr-hint">ลบ = ก่อนเริ่ม · เช่น <code>-30</code> = ก่อนเริ่ม 30 นาที</div>
        </div>
        <div class="nr-field" style="margin-bottom:0;">
          <label>Offset วัน</label>
          <input type="number" id="fSchedDays" value="${editingSchedule.offset_days ?? 0}" oninput="updateScheduleState()">
          <div class="nr-hint">ปกติ <code>0</code> (ถ้าจะ "เตือนเมื่อวานก่อน" ใช้ <code>-1</code>)</div>
        </div>
      </div>`;
  } else {
    // event_date / booking_date
    box.innerHTML = `
      <div class="nr-row-2">
        <div class="nr-field" style="margin-bottom:0;">
          <label>Offset วัน *</label>
          <input type="number" id="fSchedDays" value="${editingSchedule.offset_days ?? 0}" oninput="updateScheduleState()">
          <div class="nr-hint"><code>0</code> = วันงาน · <code>-1</code> = ล่วงหน้า 1 วัน · <code>-7</code> = ล่วงหน้า 7 วัน</div>
        </div>
        <div class="nr-field" style="margin-bottom:0;">
          <label>เวลา (HH:MM) *</label>
          <input type="time" id="fSchedTime" value="${editingSchedule.time || "09:00"}" oninput="updateScheduleState()">
          <div class="nr-hint">cron ยิงทุก 15 นาที — เลือก HH:MM ใดก็ได้</div>
        </div>
      </div>`;
  }
  // sync state จาก default values
  updateScheduleState();
}

function updateScheduleState() {
  const tk = document.getElementById("fTrigger").value;
  const meta = TRIGGERS[tk];
  if (!meta || meta.kind !== "scheduled") return;
  const days = parseInt(document.getElementById("fSchedDays")?.value, 10);
  editingSchedule.offset_days = isNaN(days) ? 0 : days;
  if (meta.anchor === "booking_start_time") {
    const m = parseInt(document.getElementById("fSchedMin")?.value, 10);
    editingSchedule.offset_minutes = isNaN(m) ? 0 : m;
    editingSchedule.time = "";
  } else {
    editingSchedule.time = document.getElementById("fSchedTime")?.value || "";
    editingSchedule.offset_minutes = 0;
  }
  renderSchedulePreview(meta);
}

function renderSchedulePreview(meta) {
  const el = document.getElementById("fSchedulePreview");
  if (!el) return;
  const d = editingSchedule.offset_days || 0;
  const t = editingSchedule.time || "";
  const m = editingSchedule.offset_minutes || 0;

  let txt = "";
  if (meta.anchor === "event_date") {
    const phrase = d === 0 ? "ในวันงาน" : (d < 0 ? `ล่วงหน้า ${Math.abs(d)} วัน` : `หลังงาน ${d} วัน`);
    txt = `📅 ส่ง <b>${phrase}</b> เวลา <b>${t || "??:??"}</b> น. — สำหรับทุก event ที่ <b>status=CONFIRMED</b>`;
  } else if (meta.anchor === "booking_date") {
    const phrase = d === 0 ? "ในวันจอง" : (d < 0 ? `ล่วงหน้า ${Math.abs(d)} วัน` : `หลังจอง ${d} วัน`);
    txt = `📅 ส่ง <b>${phrase}</b> เวลา <b>${t || "??:??"}</b> น. — สำหรับทุก booking ที่ <b>status=APPROVED</b>`;
  } else if (meta.anchor === "booking_start_time") {
    const phrase = m < 0 ? `ก่อนเริ่ม <b>${Math.abs(m)} นาที</b>` : (m > 0 ? `หลังเริ่ม <b>${m} นาที</b>` : `ตอนเริ่ม`);
    const dayPhrase = d === 0 ? "วันนั้น" : (d < 0 ? `${Math.abs(d)} วันก่อน` : `${d} วันหลัง`);
    txt = `⏱ ส่ง ${phrase} ของแต่ละ booking (${dayPhrase})`;
  }
  el.innerHTML = txt;
}

function insertPlaceholder(name) {
  const ta = document.getElementById("fTemplate");
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  ta.value = before + `{{${name}}}` + after;
  ta.focus();
  const pos = before.length + name.length + 4;
  ta.setSelectionRange(pos, pos);
}

function togglePreview() {
  const tk = document.getElementById("fTrigger").value;
  const tpl = document.getElementById("fTemplate").value;
  const sample = TRIGGERS[tk]?.sample || {};
  const rendered = window.Notify.renderTemplate(tpl, sample);
  const el = document.getElementById("fPreview");
  el.textContent = rendered || "(ว่าง)";
  el.classList.toggle("show");
}

// ── Target Picker ─────────────────────────────────────────
function renderTargetPicker() {
  const wrap = document.getElementById("fTargetPickerWrap");
  const hint = document.getElementById("fTargetHint");

  if (editingTargetType === "role") {
    hint.innerHTML = `เลือก Role ที่จะได้รับการแจ้งเตือน — ระบบจะส่งให้พนักงานทุกคนใน Role นั้นที่ผูก LINE แล้ว`;
    if (!allRoles.length) {
      wrap.innerHTML = `<div class="nr-hint">ยังไม่มี role ในระบบ</div>`;
      return;
    }
    wrap.innerHTML = `<div class="nr-target-picker">` +
      allRoles.map((r) => {
        const cnt = allUsers.filter((u) => u.role === r && u.line_user_id).length;
        const checked = editingTargetValues.includes(r) ? "checked" : "";
        return `<label class="nr-pick-item">
          <input type="checkbox" value="${escapeAttr(r)}" ${checked} onchange="toggleTargetVal(this.value, this.checked)">
          <span>${escapeHtml(r)}</span>
          <span class="nr-pick-meta">${cnt} คน ✉️</span>
        </label>`;
      }).join("") + `</div>`;
  } else if (editingTargetType === "group") {
    hint.innerHTML = `เลือก Group หรือพิมพ์เพิ่ม — จัดการกลุ่มที่หน้า <a href="./staff-groups.html">👥 จัดการกลุ่มพนักงาน</a>`;
    wrap.innerHTML = `<div class="nr-tags-wrap-outer">
      <div class="nr-tags-wrap" id="fTagsWrap"></div>
      <div class="nr-suggest" id="fTagSuggest"></div>
    </div>`;
    renderTags();
  } else if (editingTargetType === "user") {
    hint.innerHTML = `เลือกพนักงานเฉพาะคน — แสดงเฉพาะคนที่ผูก LINE แล้ว 🟢`;
    const linkedFirst = [...allUsers].sort((a, b) =>
      (b.line_user_id ? 1 : 0) - (a.line_user_id ? 1 : 0)
    );
    wrap.innerHTML = `
      <input type="text" placeholder="🔍 ค้นหาชื่อ..." style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-family:inherit;font-size:13px;" oninput="filterUserPicker(this.value)">
      <div class="nr-target-picker" id="fUserPickList">` +
      linkedFirst.map((u) => {
        const checked = editingTargetValues.includes(u.user_id) ? "checked" : "";
        const lineDot = u.line_user_id ? `<span class="nr-pick-line" title="ผูก LINE แล้ว"></span>` : "";
        return `<label class="nr-pick-item" data-name="${escapeAttr((u.full_name || u.username || "").toLowerCase())}">
          <input type="checkbox" value="${u.user_id}" ${checked} onchange="toggleTargetVal(parseInt(this.value), this.checked)">
          <span>${escapeHtml(u.full_name || u.username)}${lineDot}</span>
          <span class="nr-pick-meta">${escapeHtml(u.role || "")}</span>
        </label>`;
      }).join("") + `</div>`;
  }
}

function filterUserPicker(q) {
  const ql = (q || "").trim().toLowerCase();
  document.querySelectorAll("#fUserPickList .nr-pick-item").forEach((el) => {
    el.style.display = !ql || el.dataset.name.includes(ql) ? "" : "none";
  });
}

function toggleTargetVal(val, on) {
  const idx = editingTargetValues.indexOf(val);
  if (on && idx === -1) editingTargetValues.push(val);
  else if (!on && idx !== -1) editingTargetValues.splice(idx, 1);
}

let _tagSuggestActive = -1;   // index ของ item ที่ highlight อยู่ (keyboard nav)

function renderTags() {
  const wrap = document.getElementById("fTagsWrap");
  if (!wrap) return;
  wrap.innerHTML = editingTargetValues.map((g, i) =>
    `<span class="nr-tag">${escapeHtml(g)}<span class="nr-tag-remove" onclick="removeTag(${i})">×</span></span>`
  ).join("") +
  `<input type="text" class="nr-tags-input" placeholder="พิมพ์ชื่อกลุ่มแล้วกด Enter"
          id="fTagInput"
          oninput="onTagInputChange(this.value)"
          onkeydown="onTagInputKey(event)"
          onfocus="onTagInputChange(this.value)"
          onblur="onTagInputBlur()"
          autocomplete="off">`;
}

function removeTag(i) {
  editingTargetValues.splice(i, 1);
  renderTags();
}

function onTagInputChange(q) {
  const box = document.getElementById("fTagSuggest");
  if (!box) return;
  const ql = (q || "").trim().toLowerCase();
  // กรอง: ตรงกับ query + ยังไม่ถูกเลือก
  const matches = allGroups.filter((g) =>
    !editingTargetValues.includes(g) && (ql === "" || g.toLowerCase().includes(ql))
  );
  _tagSuggestActive = -1;
  if (!matches.length && ql === "") {
    box.innerHTML = `<div class="nr-suggest-empty">ยังไม่มีกลุ่ม — พิมพ์สร้างใหม่ได้</div>`;
  } else if (!matches.length) {
    box.innerHTML =
      `<div class="nr-suggest-empty">ไม่พบ "${escapeHtml(q)}" — กด Enter เพื่อสร้างใหม่</div>`;
  } else {
    const cntFor = (g) => {
      // ใน context นี้ allUsers อาจยังไม่โหลด — ถ้าไม่มีให้ข้าม count
      if (!Array.isArray(allUsers)) return "";
      const n = allUsers.filter((u) => (u.notification_groups || []).includes(g)).length;
      return n ? `${n} คน` : "";
    };
    box.innerHTML = matches.slice(0, 50).map((g, i) =>
      `<div class="nr-suggest-item" data-idx="${i}" data-val="${escapeAttr(g)}"
            onmousedown="event.preventDefault()"
            onclick="pickTagSuggestion('${escapeAttr(g)}')">
        <span>${escapeHtml(g)}</span>
        <span class="meta">${cntFor(g)}</span>
      </div>`
    ).join("") + `<div class="nr-suggest-hint"><kbd>↑↓</kbd> เลือก · <kbd>Enter</kbd> ยืนยัน · <kbd>Esc</kbd> ปิด</div>`;
  }
  box.classList.add("open");
}

function onTagInputBlur() {
  // delay เพื่อให้ click บน suggestion register ก่อน
  setTimeout(() => {
    const box = document.getElementById("fTagSuggest");
    if (box) box.classList.remove("open");
  }, 150);
}

function pickTagSuggestion(val) {
  if (!editingTargetValues.includes(val)) editingTargetValues.push(val);
  renderTags();
  setTimeout(() => {
    const inp = document.getElementById("fTagInput");
    if (inp) inp.focus();
  }, 0);
}

function _setActiveSuggest(delta) {
  const items = document.querySelectorAll("#fTagSuggest .nr-suggest-item");
  if (!items.length) return;
  _tagSuggestActive = Math.max(0, Math.min(items.length - 1, _tagSuggestActive + delta));
  items.forEach((el, i) => el.classList.toggle("active", i === _tagSuggestActive));
  items[_tagSuggestActive]?.scrollIntoView({ block: "nearest" });
}

function onTagInputKey(ev) {
  const box = document.getElementById("fTagSuggest");
  if (ev.key === "ArrowDown") { ev.preventDefault(); _setActiveSuggest(_tagSuggestActive < 0 ? 1 : 1); return; }
  if (ev.key === "ArrowUp")   { ev.preventDefault(); _setActiveSuggest(-1); return; }
  if (ev.key === "Escape")    { if (box) box.classList.remove("open"); return; }
  if (ev.key !== "Enter" && ev.key !== ",") return;
  ev.preventDefault();

  // ถ้า highlight suggestion อยู่ → ใช้ค่านั้น
  const items = document.querySelectorAll("#fTagSuggest .nr-suggest-item");
  if (_tagSuggestActive >= 0 && items[_tagSuggestActive]) {
    pickTagSuggestion(items[_tagSuggestActive].dataset.val);
    return;
  }

  // ไม่ได้เลือก suggestion → ใช้ค่าที่พิมพ์
  const v = ev.target.value.trim();
  if (!v) return;
  if (!editingTargetValues.includes(v)) editingTargetValues.push(v);
  renderTags();
  setTimeout(() => document.getElementById("fTagInput")?.focus(), 0);
}

// ── Save ──────────────────────────────────────────────────
async function saveRule() {
  const name = document.getElementById("fRuleName").value.trim();
  const trigger = document.getElementById("fTrigger").value;
  const channelIdRaw = document.getElementById("fChannel").value;
  const channelId = channelIdRaw ? parseInt(channelIdRaw, 10) : null;
  const tpl = document.getElementById("fTemplate").value.trim();
  const isActive = document.getElementById("fActive").checked;

  if (!name) return showToast("กรุณาใส่ชื่อกฎ", "error");
  if (!trigger) return showToast("กรุณาเลือก trigger", "error");
  if (!editingTargetValues.length) return showToast("กรุณาเลือก target อย่างน้อย 1", "error");
  if (!tpl) return showToast("กรุณาใส่ข้อความ template", "error");

  const meta = TRIGGERS[trigger];
  const isScheduled = meta?.kind === "scheduled";

  // Validate scheduled fields
  if (isScheduled) {
    if (meta.anchor !== "booking_start_time" && !editingSchedule.time) {
      return showToast("กรุณาเลือกเวลา (HH:MM)", "error");
    }
  }

  const payload = {
    rule_name: name,
    trigger_key: trigger,
    target_type: editingTargetType,
    target_value: editingTargetValues,
    channel_id: channelId,
    message_template: tpl,
    is_active: isActive,
    // schedule fields — set เฉพาะ scheduled, ถ้าไม่ใช่ให้เคลียร์ทุกตัว
    schedule_anchor:          isScheduled ? meta.anchor : null,
    schedule_offset_days:     isScheduled ? (editingSchedule.offset_days || 0) : 0,
    schedule_offset_minutes:  isScheduled ? (editingSchedule.offset_minutes || 0) : 0,
    schedule_time:            (isScheduled && meta.anchor !== "booking_start_time" && editingSchedule.time)
                                ? editingSchedule.time
                                : null,
  };

  const btn = document.getElementById("nrSaveBtn");
  btn.disabled = true;
  try {
    if (editingId) {
      await sbFetch(`notification_rules?id=eq.${editingId}`, { method: "PATCH", body: payload });
    } else {
      await sbFetch(`notification_rules`, { method: "POST", body: payload });
    }
    closeRuleModal();
    showToast("บันทึกแล้ว", "success");
    await loadRules();
    renderTable();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// ── Test send (ส่งให้ตัวเอง ด้วย sample data) ─────────────
async function testSendRule() {
  const btn = document.getElementById("nrTestBtn");
  const trigger = document.getElementById("fTrigger").value;
  const tpl = (document.getElementById("fTemplate").value || "").trim();
  const channelIdRaw = document.getElementById("fChannel").value;

  if (!trigger || !TRIGGERS[trigger]) return showToast("เลือก trigger ก่อน", "error");
  if (!tpl) return showToast("ใส่ข้อความ template ก่อน", "error");

  // 1) หา user ปัจจุบัน + line_user_id
  let me = null;
  try {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    me = raw ? JSON.parse(raw) : null;
  } catch (_) {}
  if (!me?.user_id) return showToast("กรุณา login ก่อน", "error");

  btn.disabled = true;
  btn.textContent = "⏳ กำลังส่ง...";
  try {
    const rows = await sbFetch(`users?user_id=eq.${me.user_id}&select=user_id,full_name,line_user_id`);
    const meRow = Array.isArray(rows) ? rows[0] : null;
    if (!meRow?.line_user_id) {
      throw new Error("คุณยังไม่ผูก LINE — พิมพ์ username ในแชท Bot ก่อน");
    }

    // 2) Resolve channel (rule.channel_id → default announcement)
    let channel = null;
    if (channelIdRaw) channel = await window.LineAPI.getChannel(parseInt(channelIdRaw, 10));
    if (!channel) channel = await window.LineAPI.getDefaultChannel("announcement");
    if (!channel) throw new Error("ไม่มี channel announcement — ตั้งค่าที่ LINE Channels ก่อน");

    // 3) Render + prefix [ทดสอบ]
    const sample = TRIGGERS[trigger].sample || {};
    const rendered = window.Notify.renderTemplate(tpl, sample);
    const msg = `🧪 [ทดสอบ]\n${"─".repeat(20)}\n${rendered}`;

    // 4) Send push
    await window.LineAPI.push({ channel, to: meRow.line_user_id, message: msg });
    showToast(`ส่งทดสอบแล้ว → ตรวจ LINE ของคุณ (${meRow.full_name || meRow.user_id})`, "success");
  } catch (e) {
    showToast("ส่งไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🧪 ทดสอบส่ง (หาฉัน)";
  }
}

// ── Helpers ───────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = on ? "flex" : "none";
}
function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast toast-" + (type === "error" ? "error" : "success");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

// ── Globals ───────────────────────────────────────────────
window.openRuleModal = openRuleModal;
window.closeRuleModal = closeRuleModal;
window.saveRule = saveRule;
window.deleteRule = deleteRule;
window.toggleActive = toggleActive;
window.onTriggerChange = onTriggerChange;
window.insertPlaceholder = insertPlaceholder;
window.togglePreview = togglePreview;
window.toggleTargetVal = toggleTargetVal;
window.removeTag = removeTag;
window.onTagInputKey = onTagInputKey;
window.onTagInputChange = onTagInputChange;
window.onTagInputBlur = onTagInputBlur;
window.pickTagSuggestion = pickTagSuggestion;
window.filterUserPicker = filterUserPicker;
window.testSendRule = testSendRule;
window.updateScheduleState = updateScheduleState;

document.addEventListener("DOMContentLoaded", init);
