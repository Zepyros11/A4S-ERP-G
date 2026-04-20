/* ============================================================
   staff-messaging.js — ส่งข้อความ LINE ให้พนักงานภายในองค์กร
   ------------------------------------------------------------
   Data source:
     users.line_user_id  — primary LINE account ของพนักงาน
     (webhook จะ populate ผ่าน ai-proxy เมื่อพนักงานพิมพ์ username)
   Messaging:
     window.LineAPI.multicast / push
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

let allStaff = [];
let selectedIds = new Set();
let currentChannel = null;

async function sb(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.toggle("active", on);
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 3500);
}

function avatarText(name, username) {
  const src = (name || username || "?").trim();
  return src.charAt(0).toUpperCase();
}

function renderAvatar(u) {
  if (u.line_picture_url) {
    return `<span class="sm-avatar"><img src="${u.line_picture_url}" alt=""></span>`;
  }
  return `<span class="sm-avatar">${avatarText(u.full_name, u.username)}</span>`;
}

/* ── Load staff users ── */
async function loadStaff() {
  if (!SB_URL || !SB_KEY) {
    showToast("ยังไม่ได้ตั้งค่า Supabase", "error");
    return;
  }
  showLoading(true);
  try {
    const rows = await sb(
      "users?select=user_id,username,full_name,role,is_active,line_user_id,line_display_name,line_picture_url,line_linked_at&order=full_name",
    );
    allStaff = (rows || []).filter((u) => u.is_active !== false);
    populateRoleFilter();
    renderTable();
    updateStats();
  } catch (e) {
    showToast("โหลดรายชื่อพนักงานไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

function populateRoleFilter() {
  const sel = document.getElementById("smFilterRole");
  if (!sel) return;
  const roles = [...new Set(allStaff.map((u) => u.role).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">ทุก Role</option>' +
    roles.map((r) => `<option value="${r}">${r}</option>`).join("");
  sel.value = current;
}

function getFilteredStaff() {
  const q = document.getElementById("smSearchInput").value.trim().toLowerCase();
  const role = document.getElementById("smFilterRole").value;
  const linkedMode = document.getElementById("smFilterLinked").value;

  return allStaff.filter((u) => {
    if (role && u.role !== role) return false;
    if (linkedMode === "linked" && !u.line_user_id) return false;
    if (linkedMode === "unlinked" && u.line_user_id) return false;
    if (q) {
      const hay = [u.full_name, u.username, u.line_display_name, u.role]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderTable() {
  const tbody = document.getElementById("smTableBody");
  const rows = getFilteredStaff();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="sm-empty">
      <div class="sm-empty-icon">🔍</div>ไม่พบพนักงานตามเงื่อนไข</td></tr>`;
    updateTargetCount();
    return;
  }

  tbody.innerHTML = rows.map((u) => {
    const linked = !!u.line_user_id;
    const isSel = selectedIds.has(u.user_id);
    const linkedDate = u.line_linked_at && window.DateFmt
      ? window.DateFmt.formatDMY(u.line_linked_at)
      : "";
    return `<tr class="${isSel ? "selected" : ""} ${linked ? "" : "unlinked"}">
      <td>
        <input type="checkbox" class="sm-check"
          ${!linked ? "disabled" : ""}
          ${isSel ? "checked" : ""}
          onchange="toggleRow(${u.user_id}, this.checked)">
      </td>
      <td>${renderAvatar(u)}</td>
      <td>
        <div class="sm-name">${u.full_name || "—"}</div>
        ${u.line_display_name ? `<div style="font-size:11px;color:var(--text3);">${u.line_display_name}</div>` : ""}
      </td>
      <td><span class="sm-username">${u.username || ""}</span></td>
      <td><span class="sm-role-badge">${u.role || "—"}</span></td>
      <td>${u.line_display_name || "<span class=\"sm-line-none\">—</span>"}</td>
      <td>${linked
        ? `<span class="sm-line-badge">💬 ${linkedDate || "ผูกแล้ว"}</span>`
        : `<span class="sm-line-none">ยังไม่ผูก</span>`}</td>
    </tr>`;
  }).join("");

  syncCheckAll();
  updateTargetCount();
}

function updateStats() {
  const linked = allStaff.filter((u) => u.line_user_id).length;
  document.getElementById("smStatLinked").textContent = linked;
  document.getElementById("smStatTotal").textContent = allStaff.length;
  document.getElementById("smStatSelected").textContent = selectedIds.size;
}

function toggleRow(userId, on) {
  if (on) selectedIds.add(userId);
  else selectedIds.delete(userId);
  // re-render just the row class + stats/target
  const rows = getFilteredStaff();
  const tbody = document.getElementById("smTableBody");
  rows.forEach((u, idx) => {
    const tr = tbody.children[idx];
    if (!tr) return;
    if (u.user_id === userId) tr.classList.toggle("selected", on);
  });
  syncCheckAll();
  updateStats();
  updateTargetCount();
}

function toggleAll(on) {
  const rows = getFilteredStaff().filter((u) => u.line_user_id);
  if (on) rows.forEach((u) => selectedIds.add(u.user_id));
  else rows.forEach((u) => selectedIds.delete(u.user_id));
  renderTable();
  updateStats();
}

function syncCheckAll() {
  const rows = getFilteredStaff().filter((u) => u.line_user_id);
  const cb = document.getElementById("smCheckAll");
  if (!cb) return;
  if (rows.length === 0) { cb.checked = false; cb.indeterminate = false; return; }
  const selCount = rows.filter((u) => selectedIds.has(u.user_id)).length;
  cb.checked = selCount === rows.length;
  cb.indeterminate = selCount > 0 && selCount < rows.length;
}

function getTargets() {
  return allStaff.filter((u) => selectedIds.has(u.user_id) && u.line_user_id);
}

function updateTargetCount() {
  const n = getTargets().length;
  document.getElementById("smTargetCount").textContent = n;
  const note = document.getElementById("smTargetNote");
  if (note) {
    note.textContent = n === 0
      ? "(เลือกพนักงานที่ผูก LINE แล้วจากตาราง)"
      : `พร้อมส่งข้อความ`;
  }
  const btn = document.getElementById("smSendBtn");
  if (btn) btn.disabled = n === 0;
}

/* ── Channel load ── */
async function loadChannels() {
  try {
    const all = await window.LineAPI.listChannels({ force: true });
    const sel = document.getElementById("smChannel");
    if (!all.length) {
      sel.innerHTML = '<option value="">— ไม่มี channel ในระบบ —</option>';
      return;
    }
    // Prefer announcement → sync → event
    const sorted = [...all].sort((a, b) => {
      const pri = { announcement: 0, sync: 1, event: 2 };
      const pa = pri[a.purpose] ?? 9, pb = pri[b.purpose] ?? 9;
      if (pa !== pb) return pa - pb;
      return (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0);
    });
    sel.innerHTML = sorted.map((c) => {
      const badge = c.is_default ? " ★" : "";
      return `<option value="${c.id}">[${c.purpose}] ${c.name}${badge}</option>`;
    }).join("");
    sel.onchange = onChannelChange;
    sel.value = sorted[0].id;
    currentChannel = sorted[0];
  } catch (e) {
    showToast("โหลด channel ไม่ได้: " + e.message, "error");
  }
}

async function onChannelChange() {
  const id = document.getElementById("smChannel").value;
  if (!id) { currentChannel = null; return; }
  currentChannel = await window.LineAPI.getChannel(Number(id));
}

function updateCharCount() {
  const v = document.getElementById("smMessage").value;
  document.getElementById("smCharCount").textContent = v.length;
}

function previewMessage() {
  const msg = document.getElementById("smMessage").value.trim();
  if (!msg) return showToast("ยังไม่มีข้อความ", "warning");
  const targets = getTargets();
  const names = targets.slice(0, 5).map((u) => u.full_name || u.username).join(", ");
  const more = targets.length > 5 ? ` และอีก ${targets.length - 5} คน` : "";
  ConfirmModal.open({
    icon: "👁️",
    title: "พรีวิวข้อความ",
    tone: "primary",
    message: msg,
    details: { "ส่งถึง": `${targets.length} คน`, "ผู้รับ": names + more || "-" },
    note: "นี่เป็นเพียงตัวอย่าง — กดปุ่ม 📤 ส่งข้อความ เพื่อส่งจริง",
    noteTone: "info",
    okText: "ปิด",
    hideCancel: true,
  });
}

async function sendMessages() {
  const msg = document.getElementById("smMessage").value.trim();
  if (!msg) return showToast("กรุณากรอกข้อความ", "warning");
  if (!currentChannel) return showToast("ยังไม่ได้เลือก channel", "warning");

  const targets = getTargets();
  if (!targets.length) return showToast("ยังไม่ได้เลือกพนักงาน", "warning");

  const names = targets.slice(0, 5).map((u) => u.full_name || u.username).join(", ");
  const more = targets.length > 5 ? ` และอีก ${targets.length - 5} คน` : "";
  const ok = await ConfirmModal.open({
    icon: "📤",
    title: "ยืนยันส่งข้อความ",
    tone: "primary",
    message: "ข้อความจะถูกส่งผ่าน LINE OA ถึงพนักงานที่เลือกไว้",
    details: {
      "จำนวน": `${targets.length} คน`,
      "ผู้รับ": names + more,
      "Channel": currentChannel?.channel_name || "-",
    },
    okText: "ส่งเลย",
    cancelText: "ยกเลิก",
  });
  if (!ok) return;

  if (!window.ERPCrypto?.hasMasterKey()) {
    return showToast("ยังไม่ได้ตั้ง Master Key — ไปที่หน้าตั้งค่า", "error");
  }

  const btn = document.getElementById("smSendBtn");
  btn.disabled = true;
  btn.innerHTML = "⏳ กำลังส่ง...";
  showLoading(true);

  try {
    const userIds = targets.map((u) => u.line_user_id);
    // multicast supports up to 500 per call — chunk if needed
    const CHUNK = 500;
    let ok = 0, fail = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const batch = userIds.slice(i, i + CHUNK);
      try {
        await window.LineAPI.multicast({
          channel: currentChannel,
          to: batch,
          message: msg,
        });
        ok += batch.length;
      } catch (e) {
        console.error("multicast failed", e);
        fail += batch.length;
      }
    }
    if (fail === 0) {
      showToast(`✅ ส่งสำเร็จ ${ok} คน`, "success");
      document.getElementById("smMessage").value = "";
      updateCharCount();
      selectedIds.clear();
      renderTable();
      updateStats();
    } else {
      showToast(`ส่งสำเร็จ ${ok} / ล้มเหลว ${fail}`, "warning");
    }
  } catch (e) {
    showToast("ส่งไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "<span>📤</span> ส่งข้อความ";
    showLoading(false);
  }
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("smSearchInput").addEventListener("input", renderTable);
  document.getElementById("smFilterRole").addEventListener("change", renderTable);
  document.getElementById("smFilterLinked").addEventListener("change", renderTable);
  loadStaff();
  loadChannels();
});

// Expose for inline onclick
window.toggleRow = toggleRow;
window.toggleAll = toggleAll;
window.sendMessages = sendMessages;
window.previewMessage = previewMessage;
window.loadStaff = loadStaff;
window.updateCharCount = updateCharCount;
