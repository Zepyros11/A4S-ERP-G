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
    tb.innerHTML = `<tr class="r-card-plain"><td colspan="6" class="empty-state"><div class="empty-icon">🔔</div><div class="empty-text">ยังไม่มีกฎ — กด "เพิ่มกฎ" ด้านบน</div></td></tr>`;
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
        <td class="col-center r-card-corner"><input type="checkbox" ${checked} onchange="window.toggleSelect(${r.id}, this.checked)"></td>
        <td class="r-card-title"><strong>${escapeHtml(r.rule_name)}</strong></td>
        <td data-label="Trigger"><span class="br-trigger-chip">${escapeHtml(trig)}</span></td>
        <td data-label="ส่งหา">${chips} <span style="font-size:12.5px;color:var(--text2)">${escapeHtml(targetText)}</span></td>
        <td class="col-center" data-label="เปิด">
          <label class="br-toggle"><input type="checkbox" ${r.is_active ? "checked" : ""} onchange="window.toggleActive(${r.id}, this.checked)"><span class="br-toggle-s"></span></label>
        </td>
        <td class="col-center" data-label="จัดการ">
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

/* ── Trigger manager moved to its own page (bell-triggers.html) ──
   ปุ่ม ⚙️ ลิงก์ไปหน้านั้น · ตอนกลับมา (window focus) รีโหลด triggers ให้ dropdown สด */
window.addEventListener("focus", async () => {
  try {
    await loadTriggers();
    renderTable();
    if (document.getElementById("ruleOverlay").classList.contains("open")) {
      const cur = document.getElementById("fTrigger").value;
      populateTriggers(cur);
      if (cur) document.getElementById("fTrigger").value = cur;
      onTriggerChange();
    }
  } catch (_) { /* เงียบ */ }
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

document.addEventListener("DOMContentLoaded", init);
