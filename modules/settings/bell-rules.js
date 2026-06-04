/* ============================================================
   Settings — Bell (in-app) Notification Rules CRUD
   ------------------------------------------------------------
   กฎกระดิ่งในแอป (user_notifications) แยกอิสระจาก LINE
   อ่าน/เขียน bell_notification_rules (sql/127)
   trigger metadata ใช้ notification_triggers ร่วมกับ LINE (sql/067)
   ============================================================ */

// ── Supabase helper ───────────────────────────────────────
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

function session() {
  try {
    const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// {{key}} → payload[key] (missing → '')
function renderTpl(tpl, payload) {
  if (!tpl) return "";
  return String(tpl).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => {
    const v = payload?.[k];
    return v == null ? "" : String(v);
  });
}

// ── State ─────────────────────────────────────────────────
let TRIGGERS = {};          // trigger_key → { label, kind, placeholders, sample, description, is_active }
let allRules = [];
let allUsers = [];
let allRoles = [];
let allGroups = [];
let editingId = null;
let activeTargetTab = "role";                              // view ปัจจุบัน (role|group|user) — ไม่ใช่ชนิด target
let editingTargets = { roles: [], groups: [], users: [] }; // mixed target — เลือกได้หลายชนิดพร้อมกัน
let expandedRoles = new Set();                             // role ที่กางดูรายชื่ออยู่ (คงสภาพข้าม re-render)
let selectedIds = new Set();

// แปลง rule → {roles,groups,users} (รองรับ targets ใหม่ + legacy target_type/value)
function targetsOf(rule) {
  if (rule && rule.targets && typeof rule.targets === "object" && !Array.isArray(rule.targets)) {
    return {
      roles:  Array.isArray(rule.targets.roles)  ? [...rule.targets.roles]  : [],
      groups: Array.isArray(rule.targets.groups) ? [...rule.targets.groups] : [],
      users:  Array.isArray(rule.targets.users)  ? [...rule.targets.users]  : [],
    };
  }
  const vals = Array.isArray(rule?.target_value) ? rule.target_value : [];
  return {
    roles:  rule?.target_type === "role"  ? [...vals] : [],
    groups: rule?.target_type === "group" ? [...vals] : [],
    users:  rule?.target_type === "user"  ? [...vals] : [],
  };
}
function userName(id) {
  const u = allUsers.find((x) => x.user_id === id);
  return u ? (u.full_name || u.username) : `#${id}`;
}
function targetSummaryText(rule, max = 3) {
  const t = targetsOf(rule);
  const items = [...t.roles, ...t.groups.map((g) => "👥" + g), ...t.users.map(userName)];
  if (!items.length) return "—";
  return items.slice(0, max).join(", ") + (items.length > max ? ` +${items.length - max}` : "");
}
window._brField = "body";   // ฟิลด์ล่าสุดที่ focus (title|body) สำหรับแทรก placeholder

// ── Init ──────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    await Promise.all([loadTriggers(), loadRules(), loadUsers()]);
    renderTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadTriggers() {
  // เฉพาะ on_status (instant) — กระดิ่งยังไม่รองรับ scheduled
  const rows = (await sbFetch("notification_triggers?select=*&kind=eq.on_status&order=sort_order.asc")) || [];
  const map = {};
  for (const r of rows) {
    map[r.trigger_key] = {
      label:        r.label,
      kind:         r.kind,
      placeholders: Array.isArray(r.placeholders) ? r.placeholders : [],
      sample:       r.sample && typeof r.sample === "object" ? r.sample : {},
      description:  r.description || "",
      is_active:    r.is_active !== false,
      is_builtin:   r.is_builtin === true,
      sort_order:   r.sort_order ?? 100,
    };
  }
  TRIGGERS = map;
}

async function loadRules() {
  allRules = (await sbFetch("bell_notification_rules?select=*&order=id.desc")) || [];
}

async function loadUsers() {
  allUsers = (await sbFetch("users?select=user_id,username,full_name,role,notification_groups,is_active&is_active=eq.true&order=full_name.asc")) || [];
  const r = new Set(), g = new Set();
  for (const u of allUsers) {
    if (u.role) r.add(u.role);
    (u.notification_groups || []).forEach((x) => g.add(x));
  }
  allRoles = [...r].sort();
  allGroups = [...g].sort();
}

// ── Render table ──────────────────────────────────────────
function renderTable() {
  const tb = document.getElementById("tableBody");
  const validIds = new Set(allRules.map((r) => r.id));
  for (const id of [...selectedIds]) if (!validIds.has(id)) selectedIds.delete(id);

  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const rows = allRules.filter((r) => !q || (r.rule_name || "").toLowerCase().includes(q));

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" class="empty-state"><div class="empty-icon">🔔</div><div class="empty-text">ยังไม่มีกฎ — กด "เพิ่มกฎ" ด้านบน</div></td></tr>`;
    updateBulkBar();
    return;
  }
  tb.innerHTML = rows.map((r) => {
    const trig = TRIGGERS[r.trigger_key]?.label || r.trigger_key;
    const t = targetsOf(r);
    const chips = [
      t.roles.length  ? `<span class="br-target-type-chip">role ${t.roles.length}</span>`   : "",
      t.groups.length ? `<span class="br-target-type-chip">group ${t.groups.length}</span>` : "",
      t.users.length  ? `<span class="br-target-type-chip">user ${t.users.length}</span>`   : "",
    ].join("") || `<span class="br-target-type-chip">—</span>`;
    const targetText = targetSummaryText(r);
    const checked = selectedIds.has(r.id) ? "checked" : "";
    return `
      <tr>
        <td class="col-center"><input type="checkbox" ${checked} onchange="window.toggleSelect(${r.id}, this.checked)"></td>
        <td><strong>${escapeHtml(r.rule_name)}</strong></td>
        <td><span class="br-trigger-chip">${escapeHtml(trig)}</span></td>
        <td>${chips} <span style="font-size:12.5px;color:var(--text2)">${escapeHtml(targetText)}</span></td>
        <td class="col-center">
          <label class="br-toggle"><input type="checkbox" ${r.is_active ? "checked" : ""} onchange="window.toggleActive(${r.id}, this.checked)"><span class="br-toggle-s"></span></label>
        </td>
        <td class="col-center">
          <button class="btn-icon" title="แก้ไข" onclick="window.openRuleModal(${r.id})">✏️</button>
          <button class="btn-icon danger" title="ลบ" onclick="window.deleteRule(${r.id})">🗑️</button>
        </td>
      </tr>`;
  }).join("");
  updateBulkBar();
}

function filterTable() { renderTable(); }

// ── Bulk select ───────────────────────────────────────────
function toggleSelect(id, on) { on ? selectedIds.add(id) : selectedIds.delete(id); updateBulkBar(); }
function toggleAll(cb) {
  selectedIds.clear();
  if (cb.checked) allRules.forEach((r) => selectedIds.add(r.id));
  renderTable();
}
function updateBulkBar() {
  const btn = document.getElementById("btnDeleteSelected");
  const all = document.getElementById("checkAll");
  const n = selectedIds.size;
  if (btn) btn.style.display = n > 0 ? "inline-flex" : "none";
  if (btn) btn.textContent = `🗑️ ลบที่เลือก (${n})`;
  if (all) {
    all.checked = n > 0 && n === allRules.length;
    all.indeterminate = n > 0 && n < allRules.length;
  }
}
async function bulkDelete() {
  const ids = [...selectedIds];
  if (!ids.length) return;
  const ok = await window.ConfirmModal.open({
    title: `ลบ ${ids.length} กฎที่เลือก?`,
    message: `จะลบกฎกระดิ่งทั้งหมด ${ids.length} รายการ — กู้คืนไม่ได้`,
    confirmText: "ลบทั้งหมด", danger: true,
  });
  if (!ok) return;
  try {
    await sbFetch(`bell_notification_rules?id=in.(${ids.join(",")})`, { method: "DELETE" });
    showToast(`ลบแล้ว ${ids.length} กฎ`, "success");
    selectedIds.clear();
    await loadRules();
    renderTable();
  } catch (e) { showToast("ลบไม่สำเร็จ: " + e.message, "error"); }
}

async function toggleActive(id, on) {
  try {
    await sbFetch(`bell_notification_rules?id=eq.${id}`, { method: "PATCH", body: { is_active: on } });
    const r = allRules.find((x) => x.id === id);
    if (r) r.is_active = on;
    showToast(on ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว", "success");
  } catch (e) { showToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error"); }
}

async function deleteRule(id) {
  const r = allRules.find((x) => x.id === id);
  const ok = await window.ConfirmModal.open({
    title: "ลบกฎแจ้งเตือน?",
    message: `ลบกฎ "${r?.rule_name || "#" + id}" — กู้คืนไม่ได้`,
    confirmText: "ลบ", danger: true,
  });
  if (!ok) return;
  try {
    await sbFetch(`bell_notification_rules?id=eq.${id}`, { method: "DELETE" });
    showToast("ลบแล้ว", "success");
    await loadRules();
    renderTable();
  } catch (e) { showToast("ลบไม่สำเร็จ: " + e.message, "error"); }
}

// ── Modal ─────────────────────────────────────────────────
function populateTriggers(currentKey) {
  const sel = document.getElementById("fTrigger");
  const entries = Object.entries(TRIGGERS)
    .filter(([k, v]) => v.is_active || k === currentKey)
    .sort((a, b) => (a[1].sort_order ?? 100) - (b[1].sort_order ?? 100));
  let html = entries.map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join("");
  if (currentKey && !TRIGGERS[currentKey]) {
    html = `<option value="${escapeAttr(currentKey)}">⚠️ ${escapeHtml(currentKey)} (ไม่อยู่ในระบบ)</option>` + html;
  }
  sel.innerHTML = html;
}

function openRuleModal(id) {
  editingId = id;
  const rule = id ? allRules.find((r) => r.id === id) : null;
  document.getElementById("ruleModalTitle").textContent = rule ? "แก้ไขกฎ" : "เพิ่มกฎแจ้งเตือนกระดิ่ง";
  document.getElementById("fName").value = rule?.rule_name || "";
  const wantKey = rule?.trigger_key || Object.keys(TRIGGERS).find((k) => TRIGGERS[k].is_active);
  populateTriggers(wantKey);
  document.getElementById("fTrigger").value = wantKey || "";
  document.getElementById("fTitle").value = rule?.title_template || "";
  document.getElementById("fBody").value = rule?.body_template || "";
  document.getElementById("fLink").value = rule?.link_url || "";
  document.getElementById("fActive").checked = rule ? !!rule.is_active : true;
  document.getElementById("fPreview").classList.remove("show");

  editingTargets = targetsOf(rule);
  activeTargetTab = "role";
  expandedRoles = new Set();

  document.querySelectorAll("#fTargetType .br-radio").forEach((el) => {
    const t = el.dataset.type;
    el.classList.toggle("checked", t === activeTargetTab);
    el.querySelector("input").checked = t === activeTargetTab;
    el.onclick = () => {
      activeTargetTab = t;
      document.querySelectorAll("#fTargetType .br-radio").forEach((x) => {
        x.classList.toggle("checked", x.dataset.type === t);
        x.querySelector("input").checked = x.dataset.type === t;
      });
      renderTargetPicker();
    };
  });

  renderTargetPicker();
  onTriggerChange();
  document.getElementById("ruleOverlay").classList.add("open");
}

function closeRuleModal(e) {
  if (e && e.target.id !== "ruleOverlay") return;
  document.getElementById("ruleOverlay").classList.remove("open");
  editingId = null;
}

function onTriggerChange() {
  const tk = document.getElementById("fTrigger").value;
  const meta = TRIGGERS[tk];
  document.getElementById("fTriggerDesc").textContent = meta?.description || "";
  const bar = document.getElementById("fPlaceholders");
  if (!meta || !meta.placeholders.length) { bar.innerHTML = ""; return; }
  bar.innerHTML = `<span class="br-hint" style="width:100%;margin:0 0 2px">คลิกเพื่อแทรกตัวแปร →</span>` +
    meta.placeholders.map((p) => `<span class="br-ph" onclick="window.insertPlaceholder('${escapeAttr(p)}')">{{${escapeHtml(p)}}}</span>`).join("");
}

function insertPlaceholder(name) {
  const id = window._brField === "title" ? "fTitle" : "fBody";
  const ta = document.getElementById(id);
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + `{{${name}}}` + ta.value.slice(end);
  ta.focus();
  const pos = start + name.length + 4;
  ta.setSelectionRange(pos, pos);
}

function togglePreview() {
  const tk = document.getElementById("fTrigger").value;
  const sample = TRIGGERS[tk]?.sample || {};
  const title = renderTpl(document.getElementById("fTitle").value, sample) || `🔔 ${TRIGGERS[tk]?.label || tk}`;
  const body = renderTpl(document.getElementById("fBody").value, sample);
  const el = document.getElementById("fPreview");
  el.innerHTML = `<div class="br-pv-title">${escapeHtml(title)}</div>${escapeHtml(body) || "(ว่าง)"}`;
  el.classList.toggle("show");
}

// ── Target picker (mixed: role + group + user พร้อมกัน) ────
function buildTargetSummary() {
  const chips = [];
  editingTargets.roles.forEach((r) =>
    chips.push(`<span class="br-chip br-chip-role">🎭 ${escapeHtml(r)}<span class="br-chip-x" onclick="window.removeTarget('role','${escapeAttr(r)}')">×</span></span>`));
  editingTargets.groups.forEach((g) =>
    chips.push(`<span class="br-chip br-chip-group">👥 ${escapeHtml(g)}<span class="br-chip-x" onclick="window.removeTarget('group','${escapeAttr(g)}')">×</span></span>`));
  editingTargets.users.forEach((id) =>
    chips.push(`<span class="br-chip br-chip-user">👤 ${escapeHtml(userName(id))}<span class="br-chip-x" onclick="window.removeTarget('user',${id})">×</span></span>`));
  return chips.length
    ? `<div class="br-summary">${chips.join("")}</div>`
    : `<div class="br-summary br-summary-empty">ยังไม่ได้เลือกผู้รับ — เลือกได้ผสมทั้ง Role / Group / รายคน</div>`;
}

function renderTargetPicker() {
  const wrap = document.getElementById("fTargetPicker");
  const hint = document.getElementById("fTargetHint");
  const summary = buildTargetSummary();

  if (activeTargetTab === "role") {
    hint.textContent = "ติ๊ก Role = ทั้ง role · กด ▸ กางเพื่อติ๊กรายคน (ผสมกันได้)";
    const body = !allRoles.length
      ? `<div class="br-hint">ยังไม่มี role ในระบบ</div>`
      : `<div class="br-picker">` + allRoles.map((r) => {
          const members = allUsers.filter((u) => u.role === r);
          const roleCk = editingTargets.roles.includes(r) ? "checked" : "";
          const open = expandedRoles.has(r);
          const sub = members.length
            ? members.map((u) => {
                const uck = (editingTargets.roles.includes(r) || editingTargets.users.includes(u.user_id)) ? "checked" : "";
                const dis = editingTargets.roles.includes(r) ? "disabled" : "";
                return `<label class="br-pick-item br-sub-pick"><input type="checkbox" value="${u.user_id}" ${uck} ${dis} onchange="window.toggleUserVal(parseInt(this.value), this.checked)"><span>${escapeHtml(u.full_name || u.username)}</span></label>`;
              }).join("") + (editingTargets.roles.includes(r) ? `<div class="br-sub-item" style="color:var(--text3)">— รวมทั้ง role แล้ว —</div>` : "")
            : `<div class="br-sub-item" style="color:var(--text3)">— ไม่มีสมาชิก —</div>`;
          return `<div class="br-role-block">
            <div class="br-role-row">
              <label class="br-pick-item" style="flex:1"><input type="checkbox" value="${escapeAttr(r)}" ${roleCk} onchange="window.toggleRoleVal(this.value, this.checked)"><span>${escapeHtml(r)}</span><span class="br-pick-meta">${members.length} คน</span></label>
              <button type="button" class="br-caret" onclick="window.toggleRoleExpand('${escapeAttr(r)}')">${open ? "▾" : "▸"}</button>
            </div>
            <div class="br-sub" style="display:${open ? "block" : "none"}">${sub}</div>
          </div>`;
        }).join("") + `</div>`;
    wrap.innerHTML = summary + body;
  } else {
    hint.innerHTML = `เลือก Group หรือพิมพ์เพิ่ม — จัดการกลุ่มที่หน้า <a href="./staff-groups.html">👥 กลุ่มพนักงาน</a>`;
    wrap.innerHTML = summary + `<div class="br-tags" id="fTags"></div>`;
    renderTags();
  }
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
  const arr = kind === "role" ? editingTargets.roles : kind === "group" ? editingTargets.groups : editingTargets.users;
  const i = arr.indexOf(val);
  if (i !== -1) arr.splice(i, 1);
  renderTargetPicker();
}

// group tags
function renderTags() {
  const wrap = document.getElementById("fTags");
  if (!wrap) return;
  wrap.innerHTML = editingTargets.groups.map((g, i) =>
    `<span class="br-tag">${escapeHtml(g)}<span class="br-tag-x" onclick="window.removeTag(${i})">×</span></span>`
  ).join("") +
  `<input type="text" class="br-tags-input" id="fTagInput" placeholder="พิมพ์ชื่อกลุ่ม + Enter" list="brGroupList" onkeydown="window.onTagKey(event)" autocomplete="off">` +
  `<datalist id="brGroupList">${allGroups.filter((g) => !editingTargets.groups.includes(g)).map((g) => `<option value="${escapeAttr(g)}">`).join("")}</datalist>`;
}
function removeTag(i) {
  editingTargets.groups.splice(i, 1);
  renderTargetPicker();
  setTimeout(() => document.getElementById("fTagInput")?.focus(), 0);
}
function onTagKey(ev) {
  if (ev.key !== "Enter" && ev.key !== ",") return;
  ev.preventDefault();
  const v = ev.target.value.trim();
  if (!v) return;
  if (!editingTargets.groups.includes(v)) editingTargets.groups.push(v);
  renderTargetPicker();
  setTimeout(() => document.getElementById("fTagInput")?.focus(), 0);
}

// ── Save ──────────────────────────────────────────────────
async function saveRule() {
  const name = document.getElementById("fName").value.trim();
  const trigger = document.getElementById("fTrigger").value;
  const title = document.getElementById("fTitle").value.trim();
  const body = document.getElementById("fBody").value.trim();
  const link = document.getElementById("fLink").value.trim();
  const isActive = document.getElementById("fActive").checked;

  if (!name) return showToast("กรุณาใส่ชื่อกฎ", "error");
  if (!trigger) return showToast("กรุณาเลือก trigger", "error");
  const totalTargets = editingTargets.roles.length + editingTargets.groups.length + editingTargets.users.length;
  if (!totalTargets) return showToast("กรุณาเลือกผู้รับอย่างน้อย 1", "error");
  if (!body) return showToast("กรุณาใส่เนื้อหา", "error");

  // legacy primary (เผื่อ reader เก่า) — ใช้ชนิดแรกที่มีค่า · ข้อมูลจริงอยู่ใน targets
  let pType = null, pVals = [];
  if (editingTargets.roles.length)       { pType = "role";  pVals = editingTargets.roles; }
  else if (editingTargets.groups.length) { pType = "group"; pVals = editingTargets.groups; }
  else if (editingTargets.users.length)  { pType = "user";  pVals = editingTargets.users; }

  const payload = {
    rule_name: name,
    trigger_key: trigger,
    targets: { roles: editingTargets.roles, groups: editingTargets.groups, users: editingTargets.users },
    target_type: pType,
    target_value: pVals,
    title_template: title || null,
    body_template: body,
    link_url: link || null,
    is_active: isActive,
  };
  const btn = document.getElementById("btnSave");
  btn.disabled = true;
  try {
    if (editingId) await sbFetch(`bell_notification_rules?id=eq.${editingId}`, { method: "PATCH", body: payload });
    else await sbFetch(`bell_notification_rules`, { method: "POST", body: payload });
    document.getElementById("ruleOverlay").classList.remove("open");
    editingId = null;
    showToast("บันทึกแล้ว", "success");
    await loadRules();
    renderTable();
  } catch (e) { showToast("บันทึกไม่สำเร็จ: " + e.message, "error"); }
  finally { btn.disabled = false; }
}

// ── Test to me (เขียนกระดิ่งเข้าบัญชีตัวเอง) ───────────────
async function testToMe() {
  const me = session();
  if (!me?.user_id) return showToast("กรุณา login ก่อน", "error");
  const tk = document.getElementById("fTrigger").value;
  const body = document.getElementById("fBody").value.trim();
  if (!body) return showToast("ใส่เนื้อหาก่อน", "error");
  const sample = TRIGGERS[tk]?.sample || {};
  const title = renderTpl(document.getElementById("fTitle").value, sample) || `🔔 ${TRIGGERS[tk]?.label || tk}`;
  const link = document.getElementById("fLink").value.trim() || null;
  const btn = document.getElementById("btnTestMe");
  btn.disabled = true;
  try {
    await sbFetch("user_notifications", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        user_id: me.user_id,
        rule_id: null,
        trigger_key: tk,
        title: `🧪 [ทดสอบ] ${title}`,
        body: renderTpl(body, sample),
        link_url: link,
        payload_ref: null,
      },
    });
    showToast("ส่งกระดิ่งทดสอบแล้ว → ดูที่ 🔔 (รอ ~30 วิ หรือ refresh)", "success");
  } catch (e) { showToast("ทดสอบไม่สำเร็จ: " + e.message, "error"); }
  finally { btn.disabled = false; }
}

/* ============================================================
   Trigger Manager (nested modal) — CRUD notification_triggers
   เขียน DB ตรง + auto-gen SQL/โค้ดยิงให้ก็อป (in-context CRUD)
   ============================================================ */
let trigEditKey = null;   // null = สร้างใหม่ · ไม่ใช่ null = แก้ key นี้
let trigPH = [];          // placeholders ระหว่างแก้ไข
let _trigSQL = "";        // โค้ดล่าสุดสำหรับปุ่มก็อป
let _trigSnippet = "";

function openTriggerMgr() {
  showTrigListView();
  document.getElementById("trigCode").innerHTML = "";
  renderTriggerList();
  document.getElementById("trigOverlay").classList.add("open");
}
function closeTriggerMgr() {
  document.getElementById("trigOverlay").classList.remove("open");
  syncRuleDropdown();
}
// sync dropdown ในฟอร์มกฎ (ถ้าเปิดอยู่) ให้สะท้อนเหตุการณ์ที่เพิ่ง CRUD — คงค่าที่เลือกไว้
function syncRuleDropdown() {
  if (!document.getElementById("ruleOverlay").classList.contains("open")) return;
  const cur = document.getElementById("fTrigger").value;
  populateTriggers(cur);
  if (cur) document.getElementById("fTrigger").value = cur;
  onTriggerChange();
}

function showTrigListView() {
  document.getElementById("trigListView").style.display = "";
  document.getElementById("trigListFooter").style.display = "";
  document.getElementById("trigFormView").style.display = "none";
  document.getElementById("trigFormFooter").style.display = "none";
}
function showTrigFormView() {
  document.getElementById("trigListView").style.display = "none";
  document.getElementById("trigListFooter").style.display = "none";
  document.getElementById("trigFormView").style.display = "";
  document.getElementById("trigFormFooter").style.display = "";
}

function renderTriggerList() {
  const wrap = document.getElementById("trigList");
  const entries = Object.entries(TRIGGERS).sort((a, b) => (a[1].sort_order ?? 100) - (b[1].sort_order ?? 100));
  if (!entries.length) {
    wrap.innerHTML = `<div class="trig-empty">ยังไม่มีเหตุการณ์ — กด "＋ เพิ่มเหตุการณ์"</div>`;
    return;
  }
  wrap.innerHTML = entries.map(([k, m]) => {
    const badges = [
      m.is_builtin ? `<span class="trig-badge lock">🔒 builtin</span>` : "",
      !m.is_active ? `<span class="trig-badge off">ปิด</span>` : "",
    ].join("");
    const delBtn = m.is_builtin
      ? `<button class="btn-icon" title="builtin ลบไม่ได้ (ผูกกับโค้ด)" disabled style="opacity:.35">🗑️</button>`
      : `<button class="btn-icon danger" title="ลบ" onclick="window.deleteTrigger('${escapeAttr(k)}')">🗑️</button>`;
    return `
      <div class="trig-card ${m.is_active ? "" : "off"}">
        <div class="trig-main">
          <div class="trig-label">${escapeHtml(m.label)}</div>
          <div class="trig-meta"><span class="br-trigger-chip">${escapeHtml(k)}</span>${badges}</div>
          ${m.description ? `<div class="trig-desc">${escapeHtml(m.description)}</div>` : ""}
        </div>
        <div class="trig-acts">
          <button class="btn-icon" title="แก้ไข" onclick="window.openTrigForm('${escapeAttr(k)}')">✏️</button>
          <button class="btn-icon" title="โค้ดสำหรับโปรแกรมเมอร์" onclick="window.showTrigCode('${escapeAttr(k)}')">&lt;/&gt;</button>
          ${delBtn}
        </div>
      </div>`;
  }).join("");
}

function openTrigForm(key) {
  trigEditKey = key;
  const m = key ? TRIGGERS[key] : null;
  document.getElementById("trigModalTitle").textContent = key ? "✏️ แก้ไขเหตุการณ์" : "＋ เพิ่มเหตุการณ์";
  document.getElementById("tLabel").value = m?.label || "";
  const keyInput = document.getElementById("tKey");
  keyInput.value = key || "custom.";
  keyInput.readOnly = !!key;
  keyInput.style.opacity = key ? ".6" : "1";
  keyInput.dataset.touched = key ? "1" : "";   // แก้ไข=ล็อก · สร้างใหม่=ให้ auto-suggest จาก label ได้
  trigPH = m ? [...m.placeholders] : [];
  document.getElementById("tSample").value = JSON.stringify(m?.sample || {}, null, 2);
  document.getElementById("tDesc").value = m?.description || "";
  document.getElementById("tSort").value = m?.sort_order ?? 100;
  document.getElementById("tActive").checked = m ? m.is_active : true;
  renderTrigPH();
  renderPHRef();
  showTrigFormView();
  if (!key) setTimeout(() => document.getElementById("tLabel").focus(), 0);
}
function cancelTrigForm() {
  showTrigListView();
}

// auto-suggest key จาก label (เฉพาะตอนสร้างใหม่ + ผู้ใช้ยังไม่แก้ key เอง)
function onTrigLabelInput() {
  const keyInput = document.getElementById("tKey");
  if (trigEditKey) return;                       // แก้ไข = key ล็อก
  if (keyInput.dataset.touched === "1") return;  // ผู้ใช้พิมพ์ key เองแล้ว → ไม่ทับ
  const slug = slugifyKey(document.getElementById("tLabel").value);
  keyInput.value = slug ? `custom.${slug}` : "custom.";
}
// ทำ ascii slug จาก label (อังกฤษ/ตัวเลข) — ภาษาไทยจะถูกข้าม ผู้ใช้พิมพ์เองได้
function slugifyKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ── placeholder tag input ──
function renderTrigPH() {
  const wrap = document.getElementById("tPHWrap");
  wrap.innerHTML = trigPH.map((p, i) =>
    `<span class="trig-ph-tag">${escapeHtml(p)}<span class="trig-ph-x" onclick="window.removeTrigPH(${i})">×</span></span>`
  ).join("") +
    `<input type="text" class="trig-ph-input" id="tPHInput" placeholder="พิมพ์ชื่อตัวแปร + Enter" spellcheck="false" onkeydown="window.onTrigPHKey(event)" autocomplete="off">`;
}
function onTrigPHKey(ev) {
  if (ev.key === "Backspace" && !ev.target.value && trigPH.length) {
    trigPH.pop(); renderTrigPH(); renderPHRef(); focusPHInput(); syncTrigSample(); return;
  }
  if (ev.key !== "Enter" && ev.key !== "," && ev.key !== " ") return;
  ev.preventDefault();
  const raw = ev.target.value.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (!raw) return;
  if (!trigPH.includes(raw)) trigPH.push(raw);
  renderTrigPH(); renderPHRef(); focusPHInput(); syncTrigSample();
}
function removeTrigPH(i) {
  trigPH.splice(i, 1);
  renderTrigPH(); renderPHRef(); focusPHInput(); syncTrigSample();
}
function focusPHInput() { setTimeout(() => document.getElementById("tPHInput")?.focus(), 0); }

// คลังตัวแปร — รวมตัวแปรของทุกเหตุการณ์ที่มีอยู่ (จัดกลุ่มตามเหตุการณ์ ≈ module)
// ช่วยให้ผู้ใช้ไม่ต้องเดาชื่อตัวแปรเอง — คลิกเพื่อเพิ่มเข้า trigger ที่กำลังสร้าง
function renderPHRef() {
  const ref = document.getElementById("tPHRef");
  if (!ref) return;
  const entries = Object.entries(TRIGGERS)
    .filter(([k, m]) => k !== trigEditKey && m.placeholders.length)
    .sort((a, b) => (a[1].sort_order ?? 100) - (b[1].sort_order ?? 100));
  if (!entries.length) {
    ref.innerHTML = `<div class="br-hint">ยังไม่มีเหตุการณ์อื่นให้อ้างอิง — ตัวแปรของเหตุการณ์ใหม่ๆ โปรแกรมเมอร์เป็นคนกำหนดตอนเขียนโค้ดยิง</div>`;
    return;
  }
  ref.innerHTML = entries.map(([k, m]) => `
    <div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;margin-bottom:5px">${escapeHtml(m.label)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${m.placeholders.map((p) => {
          const has = trigPH.includes(p);
          return `<span class="br-ph" style="${has ? "opacity:.35;pointer-events:none" : ""}" title="${has ? "เพิ่มแล้ว" : "คลิกเพื่อเพิ่ม"}" onclick="window.addPHFromRef('${escapeAttr(p)}')">${escapeHtml(p)}</span>`;
        }).join("")}
      </div>
    </div>`).join("");
}
function addPHFromRef(name) {
  if (!trigPH.includes(name)) trigPH.push(name);
  renderTrigPH(); renderPHRef(); syncTrigSample();
}

// อัปเดต sample JSON ให้ตรง placeholders (เก็บค่าที่พิมพ์ไว้แล้ว, ตัวใหม่ = "")
function syncTrigSample() {
  let cur = {};
  try { cur = JSON.parse(document.getElementById("tSample").value || "{}"); } catch (_) { cur = {}; }
  const next = {};
  for (const p of trigPH) next[p] = cur[p] != null ? cur[p] : "";
  document.getElementById("tSample").value = JSON.stringify(next, null, 2);
}
function regenTrigSample() {
  const next = {};
  for (const p of trigPH) next[p] = "ตัวอย่าง";
  document.getElementById("tSample").value = JSON.stringify(next, null, 2);
}

// ── save ──
async function saveTrigger() {
  const label = document.getElementById("tLabel").value.trim();
  const key = document.getElementById("tKey").value.trim();
  const desc = document.getElementById("tDesc").value.trim();
  const sort = parseInt(document.getElementById("tSort").value, 10);
  const isActive = document.getElementById("tActive").checked;

  if (!label) return showToast("กรุณาใส่ชื่อเหตุการณ์", "error");
  if (!trigEditKey) {
    if (!key || key === "custom.") return showToast("กรุณาใส่รหัสเหตุการณ์ (key)", "error");
    if (!/^[a-z0-9]+([._][a-z0-9]+)*$/.test(key)) return showToast("key ต้องเป็นตัวพิมพ์เล็ก/ตัวเลข/จุด/ขีดล่าง เช่น custom.trip_created", "error");
    if (TRIGGERS[key]) return showToast(`มี key "${key}" อยู่แล้ว`, "error");
  }
  let sample;
  try {
    sample = JSON.parse(document.getElementById("tSample").value || "{}");
    if (typeof sample !== "object" || Array.isArray(sample)) throw new Error();
  } catch (_) {
    return showToast("ตัวอย่างข้อมูล (Sample) ไม่ใช่ JSON ที่ถูกต้อง", "error");
  }

  const btn = document.getElementById("btnSaveTrig");
  btn.disabled = true;
  try {
    if (trigEditKey) {
      // แก้ไข — ไม่แตะ trigger_key / is_builtin / kind
      await sbFetch(`notification_triggers?trigger_key=eq.${encodeURIComponent(trigEditKey)}`, {
        method: "PATCH",
        body: { label, placeholders: trigPH, sample, description: desc || null, sort_order: isNaN(sort) ? 100 : sort, is_active: isActive },
      });
    } else {
      await sbFetch("notification_triggers", {
        method: "POST",
        body: {
          trigger_key: key, label, kind: "on_status", anchor: null,
          placeholders: trigPH, sample, description: desc || null,
          is_builtin: false, is_active: isActive, sort_order: isNaN(sort) ? 100 : sort,
        },
      });
    }
    const savedKey = trigEditKey || key;
    await loadTriggers();
    showTrigListView();
    renderTriggerList();
    showTrigCode(savedKey);  // โชว์ SQL + โค้ดยิงทันที
    syncRuleDropdown();      // sync dropdown ในฟอร์มกฎทันที (เผื่อปิดด้วย ESC)
    showToast("บันทึกเหตุการณ์แล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function deleteTrigger(key) {
  const m = TRIGGERS[key];
  if (m?.is_builtin) return showToast("เหตุการณ์ builtin ลบไม่ได้ (ผูกกับโค้ด)", "error");
  const used = allRules.filter((r) => r.trigger_key === key);
  const warn = used.length
    ? `\n\n⚠️ มี ${used.length} กฎใช้เหตุการณ์นี้อยู่ — กฎจะยังอยู่แต่จะ "หลุด" (ตั้งใหม่ไม่ได้จนกว่าจะสร้าง key เดิมคืน)`
    : "";
  const ok = await window.ConfirmModal.open({
    title: "ลบเหตุการณ์นี้?",
    message: `ลบ "${m?.label || key}" (${key}) — กู้คืนไม่ได้${warn}`,
    confirmText: "ลบ", danger: true,
  });
  if (!ok) return;
  try {
    await sbFetch(`notification_triggers?trigger_key=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
    await loadTriggers();
    renderTriggerList();
    document.getElementById("trigCode").innerHTML = "";
    showToast("ลบแล้ว", "success");
  } catch (e) { showToast("ลบไม่สำเร็จ: " + e.message, "error"); }
}

// ── auto-gen SQL + โค้ดยิง ──
function sqlStr(s) { return "'" + String(s ?? "").replace(/'/g, "''") + "'"; }
function genTriggerSQL(key, m) {
  const arr = m.placeholders.length
    ? `ARRAY[${m.placeholders.map((p) => sqlStr(p)).join(", ")}]`
    : "ARRAY[]::TEXT[]";
  const sampleSql = sqlStr(JSON.stringify(m.sample || {})) + "::jsonb";
  return `INSERT INTO notification_triggers
  (trigger_key, label, kind, placeholders, sample, description, is_builtin, sort_order)
VALUES (
  ${sqlStr(key)}, ${sqlStr(m.label)}, 'on_status',
  ${arr},
  ${sampleSql},
  ${sqlStr(m.description || "")}, false, ${m.sort_order ?? 100}
)
ON CONFLICT (trigger_key) DO UPDATE SET
  label        = EXCLUDED.label,
  placeholders = EXCLUDED.placeholders,
  sample       = EXCLUDED.sample,
  description  = EXCLUDED.description,
  is_active    = EXCLUDED.is_active,
  sort_order   = EXCLUDED.sort_order;

NOTIFY pgrst, 'reload schema';`;
}
function genFireSnippet(key, m) {
  if (!m.placeholders.length) return `window.Notify?.notifyBell('${key}', {});`;
  const lines = m.placeholders.map((p) => `  ${p}: /* ค่า ${p} */,`).join("\n");
  return `window.Notify?.notifyBell('${key}', {\n${lines}\n});`;
}

function showTrigCode(key) {
  const m = TRIGGERS[key];
  if (!m) return;
  _trigSQL = genTriggerSQL(key, m);
  _trigSnippet = genFireSnippet(key, m);
  const box = document.getElementById("trigCode");
  box.innerHTML = `
    <div class="trig-code">
      <div class="trig-code-hd">
        🗄️ SQL สำหรับ DB — <span style="font-weight:400;color:var(--text3)">${escapeHtml(key)}</span>
        <button class="btn btn-ghost" onclick="window.copyTrigCode('sql')">📋 ก็อป SQL</button>
      </div>
      <pre>${escapeHtml(_trigSQL)}</pre>
      <details>
        <summary>&lt;/&gt; โค้ดยิงสำหรับโปรแกรมเมอร์ (ขั้นที่ทำให้กระดิ่งเด้งจริง)</summary>
        <div class="trig-code-hd" style="border-top:none">
          แปะตรงจุดที่เหตุการณ์เกิด
          <button class="btn btn-ghost" onclick="window.copyTrigCode('snippet')">📋 ก็อปโค้ด</button>
        </div>
        <pre>${escapeHtml(_trigSnippet)}</pre>
      </details>
    </div>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function copyTrigCode(which) {
  const txt = which === "sql" ? _trigSQL : _trigSnippet;
  try {
    await navigator.clipboard.writeText(txt);
    showToast("ก็อปแล้ว", "success");
  } catch (_) {
    showToast("ก็อปไม่สำเร็จ — เลือกข้อความแล้วกด Ctrl+C", "error");
  }
}

// mark ว่าผู้ใช้พิมพ์ key เอง (กัน auto-suggest ทับ)
document.addEventListener("DOMContentLoaded", () => {
  const k = document.getElementById("tKey");
  if (k) k.addEventListener("input", () => { k.dataset.touched = "1"; });
});

// ── Helpers ───────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function showLoading(on) { const el = document.getElementById("loadingOverlay"); if (el) el.style.display = on ? "flex" : "none"; }
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
window.bulkDelete = bulkDelete;
window.toggleActive = toggleActive;
window.toggleSelect = toggleSelect;
window.toggleAll = toggleAll;
window.filterTable = filterTable;
window.onTriggerChange = onTriggerChange;
window.insertPlaceholder = insertPlaceholder;
window.togglePreview = togglePreview;
window.toggleRoleVal = toggleRoleVal;
window.toggleUserVal = toggleUserVal;
window.removeTarget = removeTarget;
window.toggleRoleExpand = toggleRoleExpand;
window.removeTag = removeTag;
window.onTagKey = onTagKey;
window.testToMe = testToMe;
// trigger manager
window.openTriggerMgr = openTriggerMgr;
window.closeTriggerMgr = closeTriggerMgr;
window.openTrigForm = openTrigForm;
window.cancelTrigForm = cancelTrigForm;
window.onTrigLabelInput = onTrigLabelInput;
window.onTrigPHKey = onTrigPHKey;
window.removeTrigPH = removeTrigPH;
window.addPHFromRef = addPHFromRef;
window.regenTrigSample = regenTrigSample;
window.saveTrigger = saveTrigger;
window.deleteTrigger = deleteTrigger;
window.showTrigCode = showTrigCode;
window.copyTrigCode = copyTrigCode;

document.addEventListener("DOMContentLoaded", init);
