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
let pendingImage = null; // { file, dataUrl }

async function sb(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
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
    tbody.innerHTML = `<tr class="r-card-plain"><td colspan="7" class="sm-empty">
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
      <td class="r-card-corner">
        <input type="checkbox" class="sm-check"
          ${!linked ? "disabled" : ""}
          ${isSel ? "checked" : ""}
          onchange="toggleRow(${u.user_id}, this.checked)">
      </td>
      <td class="r-card-title">${renderAvatar(u)}</td>
      <td class="r-card-title">
        <div class="sm-name">${u.full_name || "—"}</div>
        ${u.line_display_name ? `<div style="font-size:11px;color:var(--text3);">${u.line_display_name}</div>` : ""}
      </td>
      <td data-label="Username"><span class="sm-username">${u.username || ""}</span></td>
      <td data-label="Role"><span class="sm-role-badge">${u.role || "—"}</span></td>
      <td data-label="LINE Name">${u.line_display_name || "<span class=\"sm-line-none\">—</span>"}</td>
      <td data-label="สถานะ">${linked
        ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
             <span class="sm-line-badge">💬 ${linkedDate || "ผูกแล้ว"}</span>
             <button class="sm-unlink-btn" title="ลบการเชื่อม LINE"
               onclick="unlinkUser(${u.user_id}, '${(u.full_name || u.username || "").replace(/'/g, "\\'")}')">
               ✕
             </button>
           </div>`
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

/* ── Image upload ── */
function handleImageSelect(file) {
  if (!file) return;
  if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
    return showToast("รองรับเฉพาะ JPG / PNG", "warning");
  }
  if (file.size > 10 * 1024 * 1024) {
    return showToast("รูปต้องไม่เกิน 10MB", "warning");
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    pendingImage = { file, dataUrl: e.target.result };
    document.getElementById("smImageZone").style.display = "none";
    document.getElementById("smImagePreview").style.display = "block";
    document.getElementById("smImagePreviewImg").src = e.target.result;
    const kb = file.size / 1024;
    const sizeText = kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(2)} MB`;
    document.getElementById("smImageName").textContent = `${file.name} · ${sizeText}`;
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  pendingImage = null;
  const input = document.getElementById("smImageInput");
  if (input) input.value = "";
  document.getElementById("smImageZone").style.display = "";
  document.getElementById("smImagePreview").style.display = "none";
}

// Generate a small preview JPEG via canvas (max 240px, quality 0.7) — guarantees ≤1MB for LINE
async function makeImagePreviewBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const MAX = 240;
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, MAX / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      cv.toBlob((b) => b ? resolve(b) : reject(new Error("preview gen failed")), "image/jpeg", 0.72);
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error("image load failed")); };
    img.src = objUrl;
  });
}

async function uploadToStorage(blob, ext) {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const name = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `staff-messaging/${yyyymmdd}/${name}`;
  // คงไว้ที่ Supabase โดยตั้งใจ — รูป LINE ไม่ใหญ่ + LINE fetch URL เอง เลี่ยงปัญหา Render cold-start
  const res = await fetch(`${SB_URL}/storage/v1/object/event-files/${path}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": blob.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: blob,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`อัพโหลดรูปไม่สำเร็จ (${res.status}): ${txt}`);
  }
  return `${SB_URL}/storage/v1/object/public/event-files/${path}`;
}

async function uploadImageForLine(file) {
  // Compress original ก่อน upload (resize 1600px + JPEG q0.82) ลด egress + ตรง LINE limit
  const fullBlob = window.ImageCompressor
    ? await window.ImageCompressor.compress(file)
    : file;
  const previewBlob = await makeImagePreviewBlob(file);
  const [originalUrl, previewUrl] = await Promise.all([
    uploadToStorage(fullBlob, "jpg"),
    uploadToStorage(previewBlob, "jpg"),
  ]);
  return { originalUrl, previewUrl };
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
  if (!msg && !pendingImage) return showToast("ยังไม่มีข้อความหรือรูปภาพ", "warning");
  const targets = getTargets();
  const names = targets.slice(0, 5).map((u) => u.full_name || u.username).join(", ");
  const more = targets.length > 5 ? ` และอีก ${targets.length - 5} คน` : "";
  const details = { "ส่งถึง": `${targets.length} คน`, "ผู้รับ": names + more || "-" };
  if (pendingImage) details["รูปภาพ"] = `${pendingImage.file.name}`;
  ConfirmModal.open({
    icon: "👁️",
    title: "พรีวิวข้อความ",
    tone: "primary",
    message: msg || "(ไม่มีข้อความ — ส่งเฉพาะรูปภาพ)",
    details,
    note: "นี่เป็นเพียงตัวอย่าง — กดปุ่ม 📤 ส่งข้อความ เพื่อส่งจริง",
    noteTone: "info",
    okText: "ปิด",
    hideCancel: true,
  });
}

async function sendMessages() {
  const msg = document.getElementById("smMessage").value.trim();
  if (!msg && !pendingImage) return showToast("กรุณากรอกข้อความ หรือเลือกรูปภาพ", "warning");
  if (!currentChannel) return showToast("ยังไม่ได้เลือก channel", "warning");

  const targets = getTargets();
  if (!targets.length) return showToast("ยังไม่ได้เลือกพนักงาน", "warning");

  const names = targets.slice(0, 5).map((u) => u.full_name || u.username).join(", ");
  const more = targets.length > 5 ? ` และอีก ${targets.length - 5} คน` : "";
  const details = {
    "จำนวน": `${targets.length} คน`,
    "ผู้รับ": names + more,
    "Channel": currentChannel?.channel_name || currentChannel?.name || "-",
  };
  if (pendingImage) details["รูปภาพ"] = pendingImage.file.name;
  const okConfirm = await ConfirmModal.open({
    icon: "📤",
    title: "ยืนยันส่งข้อความ",
    tone: "primary",
    message: pendingImage && msg
      ? "รูปภาพและข้อความจะถูกส่งผ่าน LINE OA ถึงพนักงานที่เลือกไว้"
      : pendingImage
        ? "รูปภาพจะถูกส่งผ่าน LINE OA ถึงพนักงานที่เลือกไว้"
        : "ข้อความจะถูกส่งผ่าน LINE OA ถึงพนักงานที่เลือกไว้",
    details,
    okText: "ส่งเลย",
    cancelText: "ยกเลิก",
  });
  if (!okConfirm) return;

  if (!window.ERPCrypto?.hasMasterKey()) {
    return showToast("ยังไม่ได้ตั้ง Master Key — ไปที่หน้าตั้งค่า", "error");
  }

  const btn = document.getElementById("smSendBtn");
  btn.disabled = true;
  showLoading(true);

  try {
    // Upload image once (if any), reuse URL across all batches
    const messages = [];
    if (pendingImage) {
      btn.innerHTML = "⏳ กำลังอัพโหลดรูป...";
      const { originalUrl, previewUrl } = await uploadImageForLine(pendingImage.file);
      messages.push({
        type: "image",
        originalContentUrl: originalUrl,
        previewImageUrl: previewUrl,
      });
    }
    if (msg) messages.push({ type: "text", text: msg });

    btn.innerHTML = "⏳ กำลังส่ง...";
    const userIds = targets.map((u) => u.line_user_id);
    const CHUNK = 500;
    let okCount = 0, fail = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const batch = userIds.slice(i, i + CHUNK);
      try {
        await window.LineAPI.multicast({
          channel: currentChannel,
          to: batch,
          messages,
        });
        okCount += batch.length;
      } catch (e) {
        console.error("multicast failed", e);
        fail += batch.length;
      }
    }
    if (fail === 0) {
      showToast(`✅ ส่งสำเร็จ ${okCount} คน`, "success");
      document.getElementById("smMessage").value = "";
      updateCharCount();
      clearImage();
      selectedIds.clear();
      renderTable();
      updateStats();
    } else {
      showToast(`ส่งสำเร็จ ${okCount} / ล้มเหลว ${fail}`, "warning");
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
  document.getElementById("smReportSearch").addEventListener("input", renderReportList);

  // Image upload wiring
  const zone = document.getElementById("smImageZone");
  const input = document.getElementById("smImageInput");
  if (zone && input) {
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", (e) => handleImageSelect(e.target.files?.[0]));
    ["dragenter", "dragover"].forEach((ev) => {
      zone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      zone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove("dragover");
      });
    });
    zone.addEventListener("drop", (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) handleImageSelect(f);
    });
  }

  loadStaff();
  loadChannels();
});

/* ── Staff list report modal ── */
let reportMode = "all"; // all | linked | selected

function openStaffReport(mode) {
  reportMode = mode;
  const titleEl = document.getElementById("smReportTitle");
  const iconEl = document.getElementById("smReportIcon");
  if (mode === "linked") {
    iconEl.textContent = "💬";
    titleEl.textContent = "พนักงานที่ผูก LINE แล้ว";
  } else if (mode === "selected") {
    iconEl.textContent = "✓";
    titleEl.textContent = "พนักงานที่เลือกไว้";
  } else {
    iconEl.textContent = "👥";
    titleEl.textContent = "พนักงานทั้งหมด";
  }
  document.getElementById("smReportSearch").value = "";
  renderReportList();
  document.getElementById("smReportModal").classList.add("open");
}

function closeStaffReport() {
  document.getElementById("smReportModal").classList.remove("open");
}

function getReportRows() {
  let rows = allStaff.slice();
  if (reportMode === "linked") rows = rows.filter((u) => u.line_user_id);
  else if (reportMode === "selected") rows = rows.filter((u) => selectedIds.has(u.user_id));
  const q = document.getElementById("smReportSearch").value.trim().toLowerCase();
  if (q) {
    rows = rows.filter((u) => {
      const hay = [u.full_name, u.username, u.line_display_name, u.role]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  return rows;
}

function renderReportList() {
  const rows = getReportRows();
  const listEl = document.getElementById("smReportList");
  document.getElementById("smReportCount").textContent = `${rows.length} คน`;

  if (!rows.length) {
    listEl.innerHTML = `<div class="sm-modal-empty">— ไม่พบรายชื่อ —</div>`;
    return;
  }

  listEl.innerHTML = rows.map((u, i) => {
    const linked = !!u.line_user_id;
    const role = u.role ? `<span class="sm-role-badge">${u.role}</span>` : "";
    const lineName = u.line_display_name ? ` · ${u.line_display_name}` : "";
    return `<div class="sm-modal-row">
      <span class="sm-modal-num">${i + 1}.</span>
      ${renderAvatar(u)}
      <div class="sm-modal-info">
        <div class="sm-modal-name">${u.full_name || "—"} ${role}</div>
        <div class="sm-modal-meta">${u.username || ""}${lineName}</div>
      </div>
      <span class="sm-modal-status ${linked ? "linked" : "unlinked"}">
        ${linked ? "💬 ผูกแล้ว" : "ยังไม่ผูก"}
      </span>
    </div>`;
  }).join("");
}

window.openStaffReport = openStaffReport;
window.closeStaffReport = closeStaffReport;

// Expose for inline onclick
async function unlinkUser(userId, displayName) {
  let ok = true;
  if (window.ConfirmModal?.open) {
    ok = await window.ConfirmModal.open({
      icon: "⚠️",
      title: "ลบการเชื่อม LINE?",
      tone: "danger",
      message: `${displayName || "พนักงาน"} จะไม่ได้รับข้อความผ่าน LINE อีกจนกว่าจะผูกใหม่ (พิมพ์ username ในแชท Bot)`,
      okText: "ลบการเชื่อม",
      cancelText: "ยกเลิก",
    });
  } else {
    ok = confirm(`ลบการเชื่อม LINE ของ ${displayName || userId}?`);
  }
  if (!ok) return;
  showLoading(true);
  try {
    await sbPatch(`users?user_id=eq.${encodeURIComponent(userId)}`, {
      line_user_id: null,
      line_display_name: null,
      line_picture_url: null,
      line_linked_at: null,
    });
    selectedIds.delete(userId);
    showToast(`ลบการเชื่อม LINE ของ ${displayName || userId} แล้ว`, "success");
    await loadStaff();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

window.toggleRow = toggleRow;
window.toggleAll = toggleAll;
window.sendMessages = sendMessages;
window.previewMessage = previewMessage;
window.loadStaff = loadStaff;
window.updateCharCount = updateCharCount;
window.unlinkUser = unlinkUser;
window.handleImageSelect = handleImageSelect;
window.clearImage = clearImage;
