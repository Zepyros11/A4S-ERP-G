/* ============================================================
   Settings — Staff Groups (manage users.notification_groups)
   ============================================================ */

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
let allUsers = [];
let selectedIds = new Set();
let editingAddRow = null;  // user_id of row currently in "+ add" input mode

// ── Init ──────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    await loadUsers();
    populateFilters();
    renderTable();
    renderGroupSummary();
  } catch (e) {
    showToast("โหลดไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadUsers() {
  allUsers = (await sbFetch("users?select=user_id,username,full_name,role,line_user_id,line_display_name,notification_groups,is_active&is_active=eq.true&order=full_name.asc")) || [];
  // ensure notification_groups is always an array
  for (const u of allUsers) {
    if (!Array.isArray(u.notification_groups)) u.notification_groups = [];
  }
}

function getAllGroups() {
  const s = new Set();
  for (const u of allUsers) (u.notification_groups || []).forEach((g) => s.add(g));
  return [...s].sort();
}

function populateFilters() {
  const roles = [...new Set(allUsers.map((u) => u.role).filter(Boolean))].sort();
  document.getElementById("sgFilterRole").innerHTML =
    `<option value="">ทุก Role</option>` + roles.map((r) => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join("");
  refreshGroupFilters();
}

function refreshGroupFilters() {
  const groups = getAllGroups();
  document.getElementById("sgFilterGroup").innerHTML =
    `<option value="">ทุกกลุ่ม</option>` + groups.map((g) => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join("");
  document.getElementById("sgGroupList").innerHTML = groups.map((g) => `<option value="${escapeAttr(g)}">`).join("");
}

// ── Render ────────────────────────────────────────────────
function renderTable() {
  const tb = document.getElementById("sgTbody");
  const q = (document.getElementById("sgSearch")?.value || "").trim().toLowerCase();
  const fRole = document.getElementById("sgFilterRole")?.value || "";
  const fGroup = document.getElementById("sgFilterGroup")?.value || "";

  let rows = allUsers;
  if (fRole) rows = rows.filter((u) => u.role === fRole);
  if (fGroup) rows = rows.filter((u) => (u.notification_groups || []).includes(fGroup));
  if (q) {
    rows = rows.filter((u) => {
      const hay = `${u.full_name || ""} ${u.username || ""} ${(u.notification_groups || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" class="sg-empty"><div class="sg-empty-icon">🔍</div>ไม่พบพนักงาน</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map((u) => {
    const isSel = selectedIds.has(u.user_id);
    const tags = (u.notification_groups || []).map((g, i) =>
      `<span class="sg-tag">${escapeHtml(g)}<span class="sg-tag-remove" onclick="removeGroup(${u.user_id}, ${i})" title="ลบ">×</span></span>`
    ).join("");
    const addCtl = (editingAddRow === u.user_id)
      ? `<input type="text" class="sg-add-input" id="sgAddInput-${u.user_id}" placeholder="ชื่อกลุ่ม" list="sgGroupList" onkeydown="onAddKey(event, ${u.user_id})" onblur="cancelAdd(${u.user_id})" autofocus>`
      : `<button class="sg-add-btn" onclick="startAdd(${u.user_id})" title="เพิ่มกลุ่ม">+</button>`;
    const lineCell = u.line_user_id
      ? `<span class="sg-line">💬 ผูกแล้ว</span>`
      : `<span class="sg-line-none">ยังไม่ผูก</span>`;
    return `<tr class="${isSel ? "selected" : ""}">
      <td><input type="checkbox" class="sg-check" ${isSel ? "checked" : ""} onchange="toggleSelect(${u.user_id}, this.checked)"></td>
      <td><div class="sg-name">${escapeHtml(u.full_name || u.username || "—")}</div></td>
      <td><span class="sg-username">${escapeHtml(u.username || "")}</span></td>
      <td><span class="sg-role">${escapeHtml(u.role || "—")}</span></td>
      <td>${lineCell}</td>
      <td><div class="sg-tags-cell">${tags}${addCtl}</div></td>
    </tr>`;
  }).join("");

  if (editingAddRow != null) {
    setTimeout(() => document.getElementById(`sgAddInput-${editingAddRow}`)?.focus(), 0);
  }
}

function renderGroupSummary() {
  const groups = getAllGroups();
  const el = document.getElementById("sgGroupSummary");
  document.getElementById("sgGroupTotal").textContent = `${groups.length} กลุ่ม`;
  if (!groups.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center;padding:10px;">ยังไม่มีกลุ่ม — เพิ่มได้จากตารางด้านซ้าย</div>`;
    return;
  }
  el.innerHTML = groups.map((g) => {
    const cnt = allUsers.filter((u) => (u.notification_groups || []).includes(g)).length;
    return `<div class="sg-side-row">
      <span class="name">${escapeHtml(g)}</span>
      <span class="count">${cnt} คน</span>
    </div>`;
  }).join("");
}

// ── Selection ─────────────────────────────────────────────
function toggleSelect(id, on) {
  if (on) selectedIds.add(id); else selectedIds.delete(id);
  updateBulkBar();
  // Don't re-render whole table — just update row class
  const row = [...document.querySelectorAll("#sgTbody tr")].find((tr) =>
    tr.querySelector(`input[onchange*="toggleSelect(${id},"]`)
  );
  if (row) row.classList.toggle("selected", on);
}

function toggleAll(on) {
  document.querySelectorAll("#sgTbody input.sg-check").forEach((cb) => {
    const id = parseInt(cb.getAttribute("onchange").match(/toggleSelect\((\d+)/)?.[1], 10);
    if (!id) return;
    cb.checked = on;
    if (on) selectedIds.add(id); else selectedIds.delete(id);
  });
  updateBulkBar();
  renderTable();
}

function clearSelection() {
  selectedIds.clear();
  updateBulkBar();
  renderTable();
}

function updateBulkBar() {
  const n = selectedIds.size;
  const bar = document.getElementById("sgBulkBar");
  bar.style.display = n > 0 ? "flex" : "none";
  document.getElementById("sgBulkCount").textContent = n;
}

// ── Add / Remove group ────────────────────────────────────
function startAdd(userId) {
  editingAddRow = userId;
  renderTable();
}

function cancelAdd(userId) {
  // Delay to let click on suggestions register first
  setTimeout(() => {
    if (editingAddRow === userId) {
      editingAddRow = null;
      renderTable();
    }
  }, 200);
}

function onAddKey(ev, userId) {
  if (ev.key === "Escape") {
    editingAddRow = null;
    renderTable();
    return;
  }
  if (ev.key !== "Enter" && ev.key !== ",") return;
  ev.preventDefault();
  const val = ev.target.value.trim();
  if (!val) return;
  addGroupToUser(userId, val);
}

async function addGroupToUser(userId, group) {
  const u = allUsers.find((x) => x.user_id === userId);
  if (!u) return;
  if (!Array.isArray(u.notification_groups)) u.notification_groups = [];
  if (u.notification_groups.includes(group)) {
    showToast(`มีอยู่แล้ว: "${group}"`, "error");
    return;
  }
  const next = [...u.notification_groups, group];
  await persistGroups(userId, next);
  u.notification_groups = next;
  editingAddRow = null;
  renderTable();
  refreshGroupFilters();
  renderGroupSummary();
}

async function removeGroup(userId, idx) {
  const u = allUsers.find((x) => x.user_id === userId);
  if (!u || !Array.isArray(u.notification_groups)) return;
  const next = u.notification_groups.filter((_, i) => i !== idx);
  await persistGroups(userId, next);
  u.notification_groups = next;
  renderTable();
  refreshGroupFilters();
  renderGroupSummary();
}

async function persistGroups(userId, groups) {
  try {
    await sbFetch(`users?user_id=eq.${userId}`, {
      method: "PATCH",
      body: { notification_groups: groups },
    });
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    throw e;
  }
}

// ── Bulk ──────────────────────────────────────────────────
async function bulkAddGroup() {
  const grp = (document.getElementById("sgBulkGroup")?.value || "").trim();
  if (!grp) return showToast("ใส่ชื่อกลุ่ม", "error");
  if (!selectedIds.size) return;

  showLoading(true);
  let added = 0, skipped = 0, failed = 0;
  for (const uid of selectedIds) {
    const u = allUsers.find((x) => x.user_id === uid);
    if (!u) continue;
    if (!Array.isArray(u.notification_groups)) u.notification_groups = [];
    if (u.notification_groups.includes(grp)) { skipped++; continue; }
    const next = [...u.notification_groups, grp];
    try {
      await persistGroups(uid, next);
      u.notification_groups = next;
      added++;
    } catch { failed++; }
  }
  showLoading(false);

  document.getElementById("sgBulkGroup").value = "";
  selectedIds.clear();
  updateBulkBar();
  renderTable();
  refreshGroupFilters();
  renderGroupSummary();
  showToast(`เพิ่ม ${added} คน · ข้าม ${skipped}${failed ? ` · ล้มเหลว ${failed}` : ""}`, failed ? "error" : "success");
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
window.toggleSelect = toggleSelect;
window.toggleAll = toggleAll;
window.clearSelection = clearSelection;
window.startAdd = startAdd;
window.cancelAdd = cancelAdd;
window.onAddKey = onAddKey;
window.removeGroup = removeGroup;
window.bulkAddGroup = bulkAddGroup;
window.renderTable = renderTable;

document.addEventListener("DOMContentLoaded", init);
