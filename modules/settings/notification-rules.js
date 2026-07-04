/* ============================================================
   Settings — Notification Rules CRUD
   ============================================================ */

// TRIGGERS = runtime cache โหลดจากตาราง notification_triggers (sql/067)
// kind:
//   'on_status'  → event-driven — ฮุคใน browser ผ่าน Notify.evaluateRules
//   'scheduled'  → time-driven  — cron ใน ai-proxy ยิงทุก 15 นาที (ต้องมี anchor)
let TRIGGERS = {};

// ── Variable catalog (จัดกลุ่ม + คำอธิบาย สำหรับ Variable Picker modal) ──
// ตัวแปรไหนใช้ได้กับ trigger ใดๆ → ดูจาก TRIGGERS[key].placeholders ตอน render
const VAR_CATALOG = {
  event: {
    label: "📅 Event / กิจกรรม",
    desc: "ตัวแปรของ event (event.confirmed / event.scheduled)",
    vars: [
      ["event_code",      "รหัส event",                  "EVT-2026-05-001"],
      ["event_name",      "ชื่อ event",                  "Tech Summit 2026"],
      ["event_type",      "ประเภท (EVENT/COURSE/...)",   "EVENT"],
      ["event_date",      "วันที่จัด (DD/MM/YYYY)",       "15/05/2026"],
      ["end_date",        "วันสิ้นสุด (DD/MM/YYYY)",      "16/05/2026"],
      ["location",        "สถานที่",                     "Bangkok Convention Center"],
      ["dept",            "แผนกผู้จัด",                  "ทีมจัดงาน"],
      ["attendees_count", "จำนวนผู้เข้าร่วม",             "120"],
      ["start_time",      "เวลาเริ่ม (HH:MM)",            "09:00"],
      ["end_time",        "เวลาเลิก (HH:MM)",             "17:00"],
    ],
  },
  booking: {
    label: "🏢 Booking ห้องประชุม",
    desc: "ตัวแปรของ room booking (booking.approved / scheduled / before_start)",
    vars: [
      ["request_code",    "รหัสคำขอจอง",                  "RBKQ-2026-05-001"],
      ["room_name",       "ชื่อห้อง",                     "ห้องประชุมใหญ่"],
      ["place_name",      "สถานที่/อาคาร",                "ออฟฟิศ BKK"],
      ["booking_date",    "วันที่จอง (DD/MM/YYYY)",       "20/05/2026"],
      ["start_time",      "เวลาเริ่ม (HH:MM)",            "09:00"],
      ["end_time",        "เวลาเลิก (HH:MM หรือ ทั้งวัน)", "12:00"],
      ["booked_by_name",  "ผู้จอง",                       "วิชัย ตั้งใจ"],
      ["cs_name",         "CS ผู้รับผิดชอบ",              "น้องส้ม"],
    ],
  },
  ibd_member: {
    label: "🌍 IBD: ข้อมูลสมาชิก",
    desc: "ตัวแปรเกี่ยวกับสมาชิก IBD (complaint / ewallet / relocation)",
    vars: [
      ["member_name",      "ชื่อสมาชิก",                  "John Doe"],
      ["member_full_name", "ชื่อเต็มสมาชิก (ใช้ใน E-Wallet)", "John Doe"],
      ["member_code",      "รหัสสมาชิก",                  "M00012345"],
      ["whatsapp",         "WhatsApp",                    "+65 9123 4567"],
      ["whatsapp_used",    "WhatsApp ที่ใช้แจ้ง complaint", "+65 9123 4567"],
      ["email",            "อีเมล",                       "john@example.com"],
    ],
  },
  ibd_topic: {
    label: "🌍 IBD: รายละเอียดคำขอ",
    desc: "ตัวแปรเฉพาะแต่ละแบบฟอร์ม IBD",
    vars: [
      ["topic_label",         "หัวข้อ complaint",           "การเงิน"],
      ["branch_label",        "สาขาที่ติดต่อ",              "Singapore"],
      ["details_short",       "รายละเอียดย่อ (complaint)",  "ขอตรวจสอบยอดโบนัส..."],
      ["from_country_label",  "ประเทศต้นทาง (relocation)",  "Singapore"],
      ["to_country_label",    "ประเทศปลายทาง (relocation)", "Thailand"],
    ],
  },
  common: {
    label: "⚙️ ทั่วไป",
    desc: "ตัวแปรที่ใช้ได้หลาย trigger",
    vars: [
      ["approver",      "ผู้อนุมัติ (event.confirmed / booking.approved)", "ภพ (admin)"],
      ["submission_id", "ID ของ submission (IBD)",                       "1"],
    ],
  },
  daily_summary: {
    label: "📊 Daily Summary",
    desc: "ตัวแปรของ trigger สรุปงานรวมประจำวัน (daily.event_booking_summary)",
    vars: [
      ["date",               "วันที่สรุป (DD/MM/YYYY)",                          "03/05/2026"],
      ["total_events",       "จำนวน events (ตัวเลข)",                            "2"],
      ["total_bookings",     "จำนวน bookings (ตัวเลข)",                          "3"],
      ["event_count_text",   "ข้อความ '2 events' (ว่างถ้าไม่มี — เหมาะกับ inline)", "2 events"],
      ["booking_count_text", "ข้อความ '3 bookings' (ว่างถ้าไม่มี)",                "3 bookings"],
      ["event_list",         "รายการ events (multi-line bulleted)",              "• 09:00-12:00 | Tech Summit @ Hall A"],
      ["booking_list",       "รายการ bookings (multi-line bulleted)",            "• 09:00-10:00 | ห้องประชุมเล็ก (วิชัย)"],
    ],
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
let allLineGroups = []; // LINE chat groups (line_groups) — {group_id, group_name, category}
let editingId = null;
let activeTargetTab = "role";                              // view ปัจจุบัน (role|group|linegroup) — ไม่ใช่ชนิด target
let editingTargets = { roles: [], groups: [], users: [], line_groups: [] }; // mixed target — เลือกได้หลายชนิดพร้อมกัน
let expandedRoles = new Set();                             // role ที่กางดูรายชื่ออยู่
let editingSchedule = { offset_days: 0, offset_minutes: 0, time: "" };
let selectedRuleIds = new Set();

// แปลง rule → {roles,groups,users} (รองรับ targets ใหม่ + legacy target_type/value)
function targetsOf(rule) {
  if (rule && rule.targets && typeof rule.targets === "object" && !Array.isArray(rule.targets)) {
    return {
      roles:       Array.isArray(rule.targets.roles)       ? [...rule.targets.roles]       : [],
      groups:      Array.isArray(rule.targets.groups)      ? [...rule.targets.groups]      : [],
      users:       Array.isArray(rule.targets.users)       ? [...rule.targets.users]       : [],
      line_groups: Array.isArray(rule.targets.line_groups) ? [...rule.targets.line_groups] : [],
    };
  }
  const vals = Array.isArray(rule?.target_value) ? rule.target_value : [];
  return {
    roles:       rule?.target_type === "role"  ? [...vals] : [],
    groups:      rule?.target_type === "group" ? [...vals] : [],
    users:       rule?.target_type === "user"  ? [...vals] : [],
    line_groups: [],
  };
}
function userNameById(id) {
  const u = allUsers.find((x) => x.user_id === id);
  return u ? (u.full_name || u.username) : `#${id}`;
}
function lineGroupNameById(gid) {
  const g = allLineGroups.find((x) => x.group_id === gid);
  return g ? (g.group_name || gid) : gid;
}
function targetSummaryText(rule, max = 3) {
  const t = targetsOf(rule);
  const items = [
    ...t.roles,
    ...t.groups.map((g) => "👥" + g),
    ...t.users.map(userNameById),
    ...(t.line_groups || []).map((g) => "💬" + lineGroupNameById(g)),
  ];
  if (!items.length) return "—";
  return items.slice(0, max).join(", ") + (items.length > max ? ` +${items.length - max}` : "");
}

// ── Init ──────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    await Promise.all([loadTriggers(), loadRules(), loadChannels(), loadUsersAndRoles(), loadLineGroups()]);
    renderTable();
    populateTriggers();
    populateChannels();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadTriggers() {
  const rows = (await sbFetch("notification_triggers?select=*&order=sort_order.asc,trigger_key.asc")) || [];
  const map = {};
  for (const r of rows) {
    map[r.trigger_key] = {
      label:        r.label,
      kind:         r.kind,
      anchor:       r.anchor || undefined,
      placeholders: Array.isArray(r.placeholders) ? r.placeholders : [],
      sample:       r.sample && typeof r.sample === "object" ? r.sample : {},
      description:  r.description || "",
      is_builtin:   !!r.is_builtin,
      is_active:    r.is_active !== false,
      sort_order:   r.sort_order ?? 100,
    };
  }
  TRIGGERS = map;
}

async function loadRules() {
  allRules = (await sbFetch("notification_rules?select=*&order=id.desc")) || [];
}

async function loadChannels() {
  allChannels = (await sbFetch("line_channels?select=id,name,purpose,is_default,is_active&is_active=eq.true&order=purpose.asc,name.asc")) || [];
}

async function loadLineGroups() {
  allLineGroups = (await sbFetch("line_groups?select=group_id,group_name,category,is_active&is_active=eq.true&order=category.asc.nullslast,group_name.asc")) || [];
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
  // ตัด selection ที่ rule ถูกลบไปแล้วออก
  const validIds = new Set(allRules.map((r) => r.id));
  for (const id of [...selectedRuleIds]) if (!validIds.has(id)) selectedRuleIds.delete(id);

  if (!allRules.length) {
    tb.innerHTML = `<tr class="r-card-plain"><td colspan="7" class="nr-empty"><div class="nr-empty-icon">🔔</div>ยังไม่มีกฎ — กดปุ่ม "เพิ่มกฎ" ด้านบน</td></tr>`;
    updateBulkBar();
    return;
  }
  tb.innerHTML = allRules.map((r) => {
    const meta = TRIGGERS[r.trigger_key];
    const trig = meta?.label || r.trigger_key;
    const _t = targetsOf(r);
    const targetChips = [
      _t.roles.length        ? `<span class="nr-target-type">role ${_t.roles.length}</span>`         : "",
      _t.groups.length       ? `<span class="nr-target-type">group ${_t.groups.length}</span>`       : "",
      _t.users.length        ? `<span class="nr-target-type">user ${_t.users.length}</span>`         : "",
      _t.line_groups?.length ? `<span class="nr-target-type">💬 ${_t.line_groups.length}</span>`     : "",
    ].join("") || `<span class="nr-target-type">—</span>`;
    const targetText = targetSummaryText(r);
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
    const isChecked = selectedRuleIds.has(r.id) ? "checked" : "";
    return `
      <tr>
        <td class="nr-check-col r-card-corner"><input type="checkbox" ${isChecked} onchange="toggleSelectRule(${r.id}, this.checked)"></td>
        <td class="r-card-title"><div class="nr-name">${escapeHtml(r.rule_name)}</div></td>
        <td data-label="Trigger"><span class="nr-trigger-chip">${escapeHtml(trig)}</span>${schedBadge}</td>
        <td data-label="Target">
          ${targetChips}
          <span style="font-size:12.5px;color:var(--text2);">${escapeHtml(targetText)}</span>
        </td>
        <td data-label="Channel" style="font-size:12.5px;">${chText}</td>
        <td data-label="เปิด" style="text-align:center;">
          <label class="nr-toggle">
            <input type="checkbox" ${r.is_active ? "checked" : ""} onchange="toggleActive(${r.id}, this.checked)">
            <span class="nr-toggle-slider"></span>
          </label>
        </td>
        <td data-label="จัดการ">
          <div class="nr-row-actions">
            <button class="btn-icon" title="แก้ไข" onclick="openRuleModal(${r.id})">✏️</button>
            <button class="btn-icon btn-danger" title="ลบ" onclick="deleteRule(${r.id})">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  updateBulkBar();
}

// ── Bulk selection ────────────────────────────────────────
function toggleSelectRule(id, on) {
  if (on) selectedRuleIds.add(id); else selectedRuleIds.delete(id);
  updateBulkBar();
}

function toggleSelectAll(on) {
  selectedRuleIds.clear();
  if (on) allRules.forEach((r) => selectedRuleIds.add(r.id));
  // sync row checkboxes โดยไม่ต้อง re-render ทั้งตาราง
  document.querySelectorAll('#nrTbody .nr-check-col input[type="checkbox"]').forEach((cb) => {
    cb.checked = on;
  });
  updateBulkBar();
}

function clearBulkSelection() {
  selectedRuleIds.clear();
  document.querySelectorAll('#nrTbody .nr-check-col input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const all = document.getElementById("nrCheckAll");
  if (all) { all.checked = false; all.indeterminate = false; }
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById("nrBulkBar");
  const cnt = document.getElementById("nrBulkCount");
  const all = document.getElementById("nrCheckAll");
  const n = selectedRuleIds.size;
  if (bar) bar.classList.toggle("show", n > 0);
  if (cnt) cnt.textContent = `เลือก ${n} กฎ`;
  if (all) {
    all.checked = n > 0 && n === allRules.length;
    all.indeterminate = n > 0 && n < allRules.length;
  }
}

async function bulkDeleteRules() {
  const ids = [...selectedRuleIds];
  if (!ids.length) return;
  const ok = await window.ConfirmModal.open({
    title: `ลบ ${ids.length} กฎที่เลือก?`,
    message: `จะลบกฎทั้งหมด ${ids.length} รายการ — ไม่สามารถกู้คืนได้`,
    confirmText: "ลบทั้งหมด",
    danger: true,
  });
  if (!ok) return;
  try {
    // PostgREST: ใช้ in.(id1,id2,...) สำหรับลบหลายแถว
    await sbFetch(`notification_rules?id=in.(${ids.join(",")})`, { method: "DELETE" });
    showToast(`ลบแล้ว ${ids.length} กฎ`, "success");
    selectedRuleIds.clear();
    await loadRules();
    renderTable();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
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
function populateTriggers(currentKey) {
  const sel = document.getElementById("fTrigger");
  const entries = Object.entries(TRIGGERS)
    .filter(([k, v]) => v.is_active || k === currentKey)
    .sort((a, b) => (a[1].sort_order ?? 100) - (b[1].sort_order ?? 100));
  let html = entries
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}${v.is_active ? "" : " (ปิดใช้งาน)"}</option>`)
    .join("");
  // กรณี rule.trigger_key หายไปจาก triggers table (เช่นถูกลบ) → แสดง option warning เพื่อไม่ให้ค่าหาย
  if (currentKey && !TRIGGERS[currentKey]) {
    html = `<option value="${escapeAttr(currentKey)}">⚠️ ${escapeHtml(currentKey)} (trigger ไม่อยู่ในระบบแล้ว)</option>` + html;
  }
  sel.innerHTML = html;
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
  // re-populate dropdown แต่ละครั้งที่เปิด เผื่อ rule ใช้ trigger ที่ inactive/หายไป
  const wantKey = rule?.trigger_key || Object.keys(TRIGGERS).find((k) => TRIGGERS[k].is_active);
  populateTriggers(wantKey);
  document.getElementById("fTrigger").value = wantKey || "";
  document.getElementById("fChannel").value = rule?.channel_id || "";
  document.getElementById("fTemplate").value = rule?.message_template || "";
  document.getElementById("fActive").checked = rule ? !!rule.is_active : true;
  document.getElementById("fPreview").classList.remove("show");

  editingTargets = targetsOf(rule);
  activeTargetTab = "role";
  expandedRoles = new Set();
  editingSchedule = {
    offset_days:    rule?.schedule_offset_days ?? 0,
    offset_minutes: rule?.schedule_offset_minutes ?? 0,
    time:           rule?.schedule_time ? String(rule.schedule_time).slice(0, 5) : "",
  };

  // set tab (role/group) — view เท่านั้น ไม่ล้าง selection
  document.querySelectorAll("#fTargetTypeGroup .nr-radio").forEach((el) => {
    const t = el.dataset.type;
    el.classList.toggle("checked", t === activeTargetTab);
    const inp = el.querySelector("input");
    inp.checked = t === activeTargetTab;
    inp.onchange = () => {
      activeTargetTab = t;
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

  // แสดงเป็น category buttons แทน chips ของแต่ละ placeholder
  // user กดดูตัวแปรในหมวดได้ทุกหมวด ไม่ใช่แค่ที่ trigger รองรับ
  bar.innerHTML = Object.entries(VAR_CATALOG).map(([key, cat]) => {
    const supportedCount = cat.vars.filter(([n]) => meta.placeholders.includes(n)).length;
    const dim = supportedCount === 0 ? " nr-ph-cat-dim" : "";
    return `<button type="button" class="nr-ph-cat${dim}" onclick="openVarPicker('${key}')">
      ${escapeHtml(cat.label)}
      <span class="nr-ph-cat-count">${supportedCount}/${cat.vars.length}</span>
    </button>`;
  }).join("");

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
    const presets = [
      { v: 0,  label: "วันงาน" },
      { v: -1, label: "ก่อน 1 วัน" },
      { v: -3, label: "ก่อน 3 วัน" },
      { v: -7, label: "ก่อน 7 วัน" },
    ];
    const cur = editingSchedule.offset_days ?? 0;
    const isPreset = presets.some((p) => p.v === cur);

    box.innerHTML = `
      <div class="nr-field" style="margin-bottom:10px;">
        <label>เมื่อไหร่ *</label>
        <div class="nr-radio-group" id="fSchedDaysRadio">
          ${presets.map((p) => `
            <label class="nr-radio ${cur === p.v ? "checked" : ""}" data-val="${p.v}">
              <input type="radio" name="schedDays" ${cur === p.v ? "checked" : ""}>${p.label}
            </label>
          `).join("")}
          <label class="nr-radio ${!isPreset ? "checked" : ""}" data-val="custom">
            <input type="radio" name="schedDays" ${!isPreset ? "checked" : ""}>กำหนดเอง
          </label>
        </div>
        <input type="number" id="fSchedDays"
               value="${cur}"
               placeholder="เช่น -14, +1"
               style="margin-top:8px;max-width:200px;display:${isPreset ? "none" : "block"};"
               oninput="updateScheduleState()">
        <div class="nr-hint">ค่าลบ = ก่อนงาน · ค่าบวก = หลังงาน · <code>0</code> = วันงาน</div>
      </div>
      <div class="nr-field" style="margin-bottom:0;">
        <label>เวลา (HH:MM) *</label>
        <input type="time" id="fSchedTime" value="${editingSchedule.time || "09:00"}" oninput="updateScheduleState()">
        <div class="nr-hint">cron ยิงทุก 15 นาที — เลือก HH:MM ใดก็ได้</div>
      </div>`;

    // attach radio onchange
    document.querySelectorAll("#fSchedDaysRadio .nr-radio").forEach((el) => {
      const inp = el.querySelector("input");
      inp.onchange = () => onSchedDaysRadio(el.dataset.val);
    });
  }
  // sync state จาก default values
  updateScheduleState();
}

function onSchedDaysRadio(val) {
  const numInp = document.getElementById("fSchedDays");
  document.querySelectorAll("#fSchedDaysRadio .nr-radio").forEach((el) => {
    el.classList.toggle("checked", el.dataset.val === val);
  });
  if (val === "custom") {
    numInp.style.display = "block";
    numInp.focus();
    numInp.select();
  } else {
    numInp.style.display = "none";
    numInp.value = val;
  }
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

// ── Variable Picker (modal แสดงตัวแปรในหมวด + คำอธิบาย) ──
function openVarPicker(category) {
  const cat = VAR_CATALOG[category];
  if (!cat) return;
  const tk = document.getElementById("fTrigger").value;
  const meta = TRIGGERS[tk];
  const triggerVars = new Set(meta?.placeholders || []);
  const triggerLabel = meta?.label || tk || "—";

  document.getElementById("vpTitle").textContent = cat.label;
  document.getElementById("vpDesc").textContent = cat.desc;
  document.getElementById("vpTriggerName").textContent = triggerLabel;

  document.getElementById("vpBody").innerHTML = cat.vars.map(([name, desc, sample]) => {
    const supported = triggerVars.has(name);
    return `
      <div class="vp-item ${supported ? "vp-item-ok" : "vp-item-warn"}" onclick="pickVarFromPicker('${escapeAttr(name)}')">
        <div class="vp-item-head">
          <span class="vp-item-name">{{${escapeHtml(name)}}}</span>
          ${supported
            ? `<span class="vp-item-badge vp-ok">✅ ใช้ได้</span>`
            : `<span class="vp-item-badge vp-warn">⚠️ trigger นี้ไม่มี — render ว่าง</span>`}
        </div>
        <div class="vp-item-desc">${escapeHtml(desc)}</div>
        <div class="vp-item-sample">ตัวอย่าง: <code>${escapeHtml(sample)}</code></div>
      </div>
    `;
  }).join("");
  document.getElementById("vpModal").classList.add("open");
}

function closeVarPicker() {
  document.getElementById("vpModal").classList.remove("open");
}

function pickVarFromPicker(name) {
  insertPlaceholder(name);
  closeVarPicker();
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

// ── Target Picker (mixed: role + รายคน + group พร้อมกัน) ───
function buildSummaryInner() {
  const chips = [];
  editingTargets.roles.forEach((r) =>
    chips.push(`<span class="nr-chip nr-chip-role">🎭 ${escapeHtml(r)}<span class="nr-chip-x" onclick="removeTarget('role','${escapeAttr(r)}')">×</span></span>`));
  editingTargets.groups.forEach((g) =>
    chips.push(`<span class="nr-chip nr-chip-group">👥 ${escapeHtml(g)}<span class="nr-chip-x" onclick="removeTarget('group','${escapeAttr(g)}')">×</span></span>`));
  editingTargets.users.forEach((id) =>
    chips.push(`<span class="nr-chip nr-chip-user">👤 ${escapeHtml(userNameById(id))}<span class="nr-chip-x" onclick="removeTarget('user',${id})">×</span></span>`));
  (editingTargets.line_groups || []).forEach((gid) =>
    chips.push(`<span class="nr-chip nr-chip-group">💬 ${escapeHtml(lineGroupNameById(gid))}<span class="nr-chip-x" onclick="removeTarget('linegroup','${escapeAttr(gid)}')">×</span></span>`));
  return chips.length ? chips.join("") : `<span class="nr-summary-empty">ยังไม่ได้เลือกผู้รับ — ผสม Role / Group / รายคน / กลุ่มแชท LINE ได้</span>`;
}
function updateTargetSummary() {
  const el = document.getElementById("fTargetSummary");
  if (el) el.innerHTML = buildSummaryInner();
}
function renderTargetPicker() {
  const wrap = document.getElementById("fTargetPickerWrap");
  const hint = document.getElementById("fTargetHint");
  const summary = `<div class="nr-summary" id="fTargetSummary">${buildSummaryInner()}</div>`;

  if (activeTargetTab === "role") {
    hint.innerHTML = `ติ๊ก Role = ทั้ง role (คนที่ผูก LINE) · กด ▸ กางเพื่อติ๊กรายคน — ผสมกันได้`;
    const body = !allRoles.length
      ? `<div class="nr-hint">ยังไม่มี role ในระบบ</div>`
      : `<div class="nr-target-picker">` + allRoles.map((r) => {
          const members = allUsers.filter((u) => u.role === r);
          const linked = members.filter((u) => u.line_user_id).length;
          const roleSel = editingTargets.roles.includes(r);
          const open = expandedRoles.has(r);
          const sub = members.length
            ? members.map((u) => {
                const uck = (roleSel || editingTargets.users.includes(u.user_id)) ? "checked" : "";
                const dis = roleSel ? "disabled" : "";
                const noLine = u.line_user_id ? "" : ` <span style="color:var(--text3);font-size:11px">(ยังไม่ผูก LINE)</span>`;
                return `<label class="nr-pick-item nr-sub-pick"><input type="checkbox" value="${u.user_id}" ${uck} ${dis} onchange="toggleUserVal(parseInt(this.value), this.checked)"><span>${escapeHtml(u.full_name || u.username)}${noLine}</span></label>`;
              }).join("") + (roleSel ? `<div class="nr-sub-item" style="color:var(--text3)">— รวมทั้ง role แล้ว —</div>` : "")
            : `<div class="nr-sub-item" style="color:var(--text3)">— ไม่มีสมาชิก —</div>`;
          return `<div class="nr-role-block">
            <div class="nr-role-row">
              <label class="nr-pick-item" style="flex:1"><input type="checkbox" value="${escapeAttr(r)}" ${roleSel ? "checked" : ""} onchange="toggleRoleVal(this.value, this.checked)"><span>${escapeHtml(r)}</span><span class="nr-pick-meta">${linked} คน ✉️</span></label>
              <button type="button" class="nr-caret" onclick="toggleRoleExpand('${escapeAttr(r)}')">${open ? "▾" : "▸"}</button>
            </div>
            <div class="nr-sub" style="display:${open ? "block" : "none"}">${sub}</div>
          </div>`;
        }).join("") + `</div>`;
    wrap.innerHTML = summary + body;
  } else if (activeTargetTab === "linegroup") {
    hint.innerHTML = `ติ๊กกลุ่มแชท LINE ที่บอทอยู่ — ข้อความจะถูกส่งเข้ากลุ่มโดยตรง · จัดการกลุ่มที่หน้า <a href="../event/line-promote.html">💬 ตารางโพสต์ LINE</a>`;
    let body;
    if (!allLineGroups.length) {
      body = `<div class="nr-hint">ยังไม่มีกลุ่มแชท LINE — เชิญบอทเข้ากลุ่มก่อน (กลุ่มจะถูกบันทึกอัตโนมัติ)</div>`;
    } else {
      // จัดกลุ่มตาม category (แบบโมดัลหน้า line-promote)
      const byCat = new Map();
      for (const g of allLineGroups) {
        const cat = g.category || "อื่นๆ";
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(g);
      }
      body = `<div class="nr-target-picker">` + [...byCat.entries()].map(([cat, groups]) => {
        const items = groups.map((g) => {
          const sel = editingTargets.line_groups.includes(g.group_id);
          return `<label class="nr-pick-item"><input type="checkbox" value="${escapeAttr(g.group_id)}" ${sel ? "checked" : ""} onchange="toggleLineGroupVal(this.value, this.checked)"><span>${escapeHtml(g.group_name || g.group_id)}</span></label>`;
        }).join("");
        return `<div class="nr-role-block">
            <div class="nr-role-row"><span class="nr-pick-meta" style="font-weight:700">📁 ${escapeHtml(cat)}</span></div>
            <div class="nr-sub" style="display:block">${items}</div>
          </div>`;
      }).join("") + `</div>`;
    }
    wrap.innerHTML = summary + body;
  } else {
    hint.innerHTML = `เลือก Group หรือพิมพ์เพิ่ม — จัดการกลุ่มที่หน้า <a href="./staff-groups.html">👥 จัดการกลุ่มพนักงาน</a>`;
    wrap.innerHTML = summary + `<div class="nr-tags-wrap-outer">
      <div class="nr-tags-wrap" id="fTagsWrap"></div>
      <div class="nr-suggest" id="fTagSuggest"></div>
    </div>`;
    renderTags();
  }
}
function toggleLineGroupVal(gid, on) {
  const i = editingTargets.line_groups.indexOf(gid);
  if (on && i === -1) editingTargets.line_groups.push(gid);
  else if (!on && i !== -1) editingTargets.line_groups.splice(i, 1);
  renderTargetPicker();
}

function toggleRoleExpand(role) {
  if (expandedRoles.has(role)) expandedRoles.delete(role); else expandedRoles.add(role);
  renderTargetPicker();
}
function toggleRoleVal(role, on) {
  const i = editingTargets.roles.indexOf(role);
  if (on && i === -1) editingTargets.roles.push(role);
  else if (!on && i !== -1) editingTargets.roles.splice(i, 1);
  renderTargetPicker();
}
function toggleUserVal(id, on) {
  const i = editingTargets.users.indexOf(id);
  if (on && i === -1) editingTargets.users.push(id);
  else if (!on && i !== -1) editingTargets.users.splice(i, 1);
  renderTargetPicker();
}
function removeTarget(kind, val) {
  const arr = kind === "role" ? editingTargets.roles
            : kind === "group" ? editingTargets.groups
            : kind === "linegroup" ? editingTargets.line_groups
            : editingTargets.users;
  const i = arr.indexOf(val);
  if (i !== -1) arr.splice(i, 1);
  renderTargetPicker();
}

let _tagSuggestActive = -1;   // index ของ item ที่ highlight อยู่ (keyboard nav)

function renderTags() {
  const wrap = document.getElementById("fTagsWrap");
  if (!wrap) return;
  wrap.innerHTML = editingTargets.groups.map((g, i) =>
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
  editingTargets.groups.splice(i, 1);
  renderTags();
  updateTargetSummary();
}

function onTagInputChange(q) {
  const box = document.getElementById("fTagSuggest");
  if (!box) return;
  const ql = (q || "").trim().toLowerCase();
  // กรอง: ตรงกับ query + ยังไม่ถูกเลือก
  const matches = allGroups.filter((g) =>
    !editingTargets.groups.includes(g) && (ql === "" || g.toLowerCase().includes(ql))
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
  if (!editingTargets.groups.includes(val)) editingTargets.groups.push(val);
  renderTags();
  updateTargetSummary();
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
  if (!editingTargets.groups.includes(v)) editingTargets.groups.push(v);
  renderTags();
  updateTargetSummary();
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
  const totalTargets = editingTargets.roles.length + editingTargets.groups.length + editingTargets.users.length + editingTargets.line_groups.length;
  if (!totalTargets) return showToast("กรุณาเลือก target อย่างน้อย 1", "error");
  if (!tpl) return showToast("กรุณาใส่ข้อความ template", "error");

  const meta = TRIGGERS[trigger];
  const isScheduled = meta?.kind === "scheduled";

  // Validate scheduled fields
  if (isScheduled) {
    if (meta.anchor !== "booking_start_time" && !editingSchedule.time) {
      return showToast("กรุณาเลือกเวลา (HH:MM)", "error");
    }
  }

  // legacy primary (เผื่อ reader เก่า) — ชนิดแรกที่มีค่า · ข้อมูลจริงอยู่ใน targets
  let pType = null, pVals = [];
  if (editingTargets.roles.length)       { pType = "role";  pVals = editingTargets.roles; }
  else if (editingTargets.groups.length) { pType = "group"; pVals = editingTargets.groups; }
  else if (editingTargets.users.length)  { pType = "user";  pVals = editingTargets.users; }

  const payload = {
    rule_name: name,
    trigger_key: trigger,
    targets: { roles: editingTargets.roles, groups: editingTargets.groups, users: editingTargets.users, line_groups: editingTargets.line_groups },
    target_type: pType,
    target_value: pVals,
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

/* ============================================================
   Trigger Manager — CRUD สำหรับ notification_triggers
   ============================================================ */
let editingTrigKey = null;       // null = สร้างใหม่ · string = key เดิม (PK ห้ามแก้)
let editingTrigPlaceholders = []; // tag input state

function openTriggerManager() {
  renderTriggerTable();
  document.getElementById("trigModal").classList.add("open");
}

function closeTriggerManager() {
  document.getElementById("trigModal").classList.remove("open");
}

function renderTriggerTable() {
  const tb = document.getElementById("trigTbody");
  const list = Object.entries(TRIGGERS)
    .sort((a, b) => (a[1].sort_order ?? 100) - (b[1].sort_order ?? 100));
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="5" class="nr-empty"><div class="nr-empty-icon">⚡</div>ยังไม่มี trigger</td></tr>`;
    return;
  }
  tb.innerHTML = list.map(([k, t]) => {
    const ruleCnt = allRules.filter((r) => r.trigger_key === k).length;
    const builtin = t.is_builtin
      ? `<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:700;background:#e0e7ff;color:#3730a3;">BUILT-IN</span>`
      : "";
    const usage = ruleCnt
      ? `<span style="font-size:11px;color:var(--text3);margin-left:6px;">· ${ruleCnt} กฎใช้อยู่</span>`
      : "";
    const kindChip = t.kind === "scheduled"
      ? `<span style="display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:700;background:#fef3c7;color:#92400e;">⏰ scheduled</span>`
      : `<span style="display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:700;background:#dcfce7;color:#15803d;">⚡ on_status</span>`;
    return `
      <tr>
        <td>
          <div class="nr-name">${escapeHtml(t.label)}${builtin}</div>
          <div style="font-size:11.5px;color:var(--text3);font-family:'IBM Plex Mono',monospace;margin-top:2px;">${escapeHtml(k)}${usage}</div>
        </td>
        <td>${kindChip}</td>
        <td style="font-size:12px;font-family:'IBM Plex Mono',monospace;color:var(--text2);">${escapeHtml(t.anchor || "—")}</td>
        <td style="text-align:center;">
          <label class="nr-toggle">
            <input type="checkbox" ${t.is_active ? "checked" : ""} onchange="toggleTriggerActive('${escapeAttr(k)}', this.checked)">
            <span class="nr-toggle-slider"></span>
          </label>
        </td>
        <td>
          <div class="nr-row-actions">
            <button class="btn-icon" title="แก้ไข" onclick="openTriggerEditor('${escapeAttr(k)}')">✏️</button>
            ${t.is_builtin ? "" : `<button class="btn-icon btn-danger" title="ลบ" onclick="deleteTriggerByKey('${escapeAttr(k)}')">🗑️</button>`}
          </div>
        </td>
      </tr>`;
  }).join("");
}

async function toggleTriggerActive(key, on) {
  try {
    await sbFetch(`notification_triggers?trigger_key=eq.${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: { is_active: on },
    });
    if (TRIGGERS[key]) TRIGGERS[key].is_active = on;
    showToast(on ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว", "success");
    renderTriggerTable();
    populateTriggers();
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error");
  }
}

function openTriggerEditor(key) {
  editingTrigKey = key;
  const t = key ? TRIGGERS[key] : null;
  document.getElementById("trigEditTitle").textContent = key ? "แก้ไข Trigger" : "เพิ่ม Trigger";
  document.getElementById("tfKey").value = key || "";
  document.getElementById("tfKey").disabled = !!key;
  document.getElementById("tfLabel").value = t?.label || "";
  document.getElementById("tfKind").value = t?.kind || "on_status";
  document.getElementById("tfAnchor").value = t?.anchor || "event_date";
  document.getElementById("tfDesc").value = t?.description || "";
  document.getElementById("tfActive").checked = t ? !!t.is_active : true;
  document.getElementById("tfSample").value = t?.sample
    ? JSON.stringify(t.sample, null, 2)
    : "{\n  \n}";
  document.getElementById("tfSampleErr").style.display = "none";

  editingTrigPlaceholders = Array.isArray(t?.placeholders) ? [...t.placeholders] : [];
  renderTrigPhTags();
  onTrigKindChange();

  // built-in: ลบไม่ได้ + เตือน + lock kind/anchor (เพราะ code ผูกอยู่)
  const isBuiltin = !!t?.is_builtin;
  document.getElementById("tfBuiltinHint").style.display = isBuiltin ? "block" : "none";
  document.getElementById("tfDeleteBtn").style.display = (key && !isBuiltin) ? "inline-flex" : "none";
  document.getElementById("tfKind").disabled = isBuiltin;
  document.getElementById("tfAnchor").disabled = isBuiltin;

  document.getElementById("trigEditModal").classList.add("open");
}

function closeTriggerEditor() {
  document.getElementById("trigEditModal").classList.remove("open");
  editingTrigKey = null;
}

function onTrigKindChange() {
  const kind = document.getElementById("tfKind").value;
  document.getElementById("tfAnchorWrap").style.display = kind === "scheduled" ? "block" : "none";
}

function renderTrigPhTags() {
  const wrap = document.getElementById("tfPhWrap");
  if (!wrap) return;
  wrap.innerHTML = editingTrigPlaceholders.map((p, i) =>
    `<span class="nr-tag">${escapeHtml(p)}<span class="nr-tag-remove" onclick="removeTrigPh(${i})">×</span></span>`
  ).join("") +
  `<input type="text" class="nr-tags-input" id="tfPhInput"
          placeholder="พิมพ์ชื่อ placeholder แล้วกด Enter"
          onkeydown="onTrigPhKey(event)" autocomplete="off">`;
}

function removeTrigPh(i) {
  editingTrigPlaceholders.splice(i, 1);
  renderTrigPhTags();
  setTimeout(() => document.getElementById("tfPhInput")?.focus(), 0);
}

function onTrigPhKey(ev) {
  if (ev.key !== "Enter" && ev.key !== ",") return;
  ev.preventDefault();
  const v = ev.target.value.trim().replace(/[^a-zA-Z0-9_]/g, "");
  if (!v) return;
  if (!editingTrigPlaceholders.includes(v)) editingTrigPlaceholders.push(v);
  renderTrigPhTags();
  setTimeout(() => document.getElementById("tfPhInput")?.focus(), 0);
}

async function saveTrigger() {
  const key = document.getElementById("tfKey").value.trim();
  const label = document.getElementById("tfLabel").value.trim();
  const kind = document.getElementById("tfKind").value;
  const anchor = document.getElementById("tfAnchor").value;
  const desc = document.getElementById("tfDesc").value.trim();
  const isActive = document.getElementById("tfActive").checked;
  const sampleRaw = document.getElementById("tfSample").value.trim() || "{}";

  if (!key) return showToast("กรุณาใส่ Trigger Key", "error");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(key)) {
    return showToast("Key ต้องเป็นรูปแบบ module.action เช่น event.confirmed", "error");
  }
  if (!label) return showToast("กรุณาใส่ Label", "error");

  let sample;
  try {
    sample = JSON.parse(sampleRaw);
    if (typeof sample !== "object" || Array.isArray(sample) || sample === null) {
      throw new Error("ต้องเป็น object {}");
    }
    document.getElementById("tfSampleErr").style.display = "none";
  } catch (e) {
    const errEl = document.getElementById("tfSampleErr");
    errEl.textContent = "Sample JSON ไม่ถูกต้อง: " + e.message;
    errEl.style.display = "block";
    return;
  }

  const payload = {
    trigger_key:  key,
    label,
    kind,
    anchor:       kind === "scheduled" ? anchor : null,
    placeholders: editingTrigPlaceholders,
    sample,
    description:  desc || null,
    is_active:    isActive,
  };

  const btn = document.getElementById("tfSaveBtn");
  btn.disabled = true;
  try {
    if (editingTrigKey) {
      // PATCH (ไม่อนุญาตให้แก้ trigger_key)
      const { trigger_key, ...patch } = payload;
      await sbFetch(`notification_triggers?trigger_key=eq.${encodeURIComponent(editingTrigKey)}`, {
        method: "PATCH",
        body: patch,
      });
    } else {
      payload.is_builtin = false;
      payload.sort_order = 200; // custom triggers อยู่ท้าย
      await sbFetch(`notification_triggers`, { method: "POST", body: payload });
    }
    closeTriggerEditor();
    await loadTriggers();
    renderTriggerTable();
    populateTriggers();
    showToast("บันทึกแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function deleteTrigger() {
  if (!editingTrigKey) return;
  await deleteTriggerByKey(editingTrigKey, true);
}

async function deleteTriggerByKey(key, fromEditor = false) {
  const t = TRIGGERS[key];
  if (!t) return;
  if (t.is_builtin) {
    showToast("Built-in trigger ลบไม่ได้", "error");
    return;
  }
  const ruleCnt = allRules.filter((r) => r.trigger_key === key).length;
  const ok = await window.ConfirmModal.open({
    title: "ลบ Trigger?",
    message: ruleCnt
      ? `Trigger "${t.label}" ถูกใช้โดย ${ruleCnt} กฎ — ถ้าลบกฎเหล่านั้นจะใช้ trigger ที่ไม่มีอยู่ในระบบ\nยืนยันลบ?`
      : `ลบ trigger "${t.label}" — ไม่สามารถกู้คืนได้`,
    confirmText: "ลบ",
    danger: true,
  });
  if (!ok) return;
  try {
    await sbFetch(`notification_triggers?trigger_key=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
    if (fromEditor) closeTriggerEditor();
    await loadTriggers();
    renderTriggerTable();
    populateTriggers();
    showToast("ลบแล้ว", "success");
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
}

// ── Globals ───────────────────────────────────────────────
window.openRuleModal = openRuleModal;
window.closeRuleModal = closeRuleModal;
window.saveRule = saveRule;
window.deleteRule = deleteRule;
window.toggleActive = toggleActive;
window.toggleSelectRule = toggleSelectRule;
window.toggleSelectAll = toggleSelectAll;
window.clearBulkSelection = clearBulkSelection;
window.bulkDeleteRules = bulkDeleteRules;
window.openVarPicker = openVarPicker;
window.closeVarPicker = closeVarPicker;
window.pickVarFromPicker = pickVarFromPicker;
window.onTriggerChange = onTriggerChange;
window.insertPlaceholder = insertPlaceholder;
window.togglePreview = togglePreview;
window.toggleRoleVal = toggleRoleVal;
window.toggleUserVal = toggleUserVal;
window.removeTarget = removeTarget;
window.toggleRoleExpand = toggleRoleExpand;
window.removeTag = removeTag;
window.onTagInputKey = onTagInputKey;
window.onTagInputChange = onTagInputChange;
window.onTagInputBlur = onTagInputBlur;
window.pickTagSuggestion = pickTagSuggestion;
window.testSendRule = testSendRule;
window.updateScheduleState = updateScheduleState;

window.openTriggerManager = openTriggerManager;
window.closeTriggerManager = closeTriggerManager;
window.openTriggerEditor = openTriggerEditor;
window.closeTriggerEditor = closeTriggerEditor;
window.onTrigKindChange = onTrigKindChange;
window.removeTrigPh = removeTrigPh;
window.onTrigPhKey = onTrigPhKey;
window.saveTrigger = saveTrigger;
window.deleteTrigger = deleteTrigger;
window.deleteTriggerByKey = deleteTriggerByKey;
window.toggleTriggerActive = toggleTriggerActive;

document.addEventListener("DOMContentLoaded", init);
