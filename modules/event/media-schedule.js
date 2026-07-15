/* ============================================================
   media-schedule.js — FB Post Scheduler (per event)
============================================================ */

// ── Supabase helpers ──────────────────────────────────────
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
  return (
    sbFetch(
      "events",
      "?select=event_id,event_name,event_code&order=event_date.desc",
    ) || []
  );
}

// ── STATE ─────────────────────────────────────────────────
let allEvents = [];
let currentEventId = null;
let allFbPages = [];
let allFbPosts = [];
let editingFbId = null;
let pendingFbFiles = [];

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    allEvents = await fetchEvents();
    populateEventSelect();

    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id");
    if (urlEventId) {
      document.getElementById("eventSelect").value = urlEventId;
      await loadEvent(parseInt(urlEventId));
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  bindFbFilterListeners();
}

function populateEventSelect() {
  const sel = document.getElementById("eventSelect");
  sel.innerHTML = '<option value="">-- เลือกกิจกรรม --</option>';
  allEvents.forEach((e) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${e.event_id}">[${e.event_code}] ${e.event_name}</option>`,
    ),
  );
}

// ── EVENT CHANGE ──────────────────────────────────────────
window.onEventChange = async function () {
  const val = document.getElementById("eventSelect").value;
  if (!val) {
    showSections(false);
    return;
  }
  await loadEvent(parseInt(val));
};

async function loadEvent(eventId) {
  currentEventId = eventId;
  showLoading(true);
  try {
    const [pages, posts] = await Promise.all([
      window.FbApi ? window.FbApi.loadPages() : Promise.resolve([]),
      window.FbApi
        ? window.FbApi.listScheduledPosts({ event_id: eventId })
        : Promise.resolve([]),
    ]);
    allFbPages = pages || [];
    allFbPosts = posts || [];
    showSections(true);
    populateFbPageFilters();
    updateFbStats();
    renderFbTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function showSections(show) {
  document.getElementById("fbContent").style.display = show ? "block" : "none";
  document.getElementById("noEventState").style.display = show ? "none" : "block";
  document.getElementById("mediaActionBtns").style.display = show ? "block" : "none";
}

// ===========================================================
// FB SCHEDULE
// ===========================================================

function populateFbPageFilters() {
  const filterSel = document.getElementById("fbFilterPage");
  const modalSel = document.getElementById("fFbPage");
  const opts = allFbPages
    .map((p) => `<option value="${p.id}">${escapeHtml(p.page_name)}</option>`)
    .join("");
  if (filterSel) {
    filterSel.innerHTML = `<option value="">🧿 ทุกเพจ</option>${opts}`;
  }
  if (modalSel) {
    modalSel.innerHTML = opts || `<option value="">— ยังไม่มีเพจที่ตั้งค่า —</option>`;
  }
}

function updateFbStats() {
  const total = allFbPosts.length;
  const sched = allFbPosts.filter((p) => p.status === "SCHEDULED").length;
  const pub = allFbPosts.filter((p) => p.status === "PUBLISHED").length;
  const fail = allFbPosts.filter((p) => p.status === "FAILED").length;
  setText("fbStatTotal", total);
  setText("fbStatScheduled", sched);
  setText("fbStatPublished", pub);
  setText("fbStatFailed", fail);
  setText("fbCount", `${total} โพสต์`);
}

function renderFbTable() {
  const tbody = document.getElementById("fbTableBody");
  if (!tbody) return;
  const search = (document.getElementById("fbSearchInput")?.value || "").toLowerCase();
  const stat = document.getElementById("fbFilterStatus")?.value || "";
  const pageFilter = document.getElementById("fbFilterPage")?.value || "";

  const list = allFbPosts.filter((p) => {
    if (search && !(p.caption || "").toLowerCase().includes(search)) return false;
    if (stat && p.status !== stat) return false;
    if (pageFilter && String(p.fb_page_id) !== pageFilter) return false;
    return true;
  });

  document.getElementById("fbCount").textContent = `${list.length} โพสต์`;

  if (!list.length) {
    tbody.innerHTML = `<tr class="r-card-plain"><td colspan="6">
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <div class="empty-text">ยังไม่มีโพสต์</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((p) => {
      const page = allFbPages.find((x) => x.id === p.fb_page_id);
      const mediaCount = (p.media_urls || []).length;
      const canEdit = p.status === "SCHEDULED";
      return `<tr>
        <td class="r-card-title"><div class="fb-caption-cell">${escapeHtml(p.caption || "")}</div></td>
        <td class="col-center" data-label="เพจ" style="font-size:12px">${page ? escapeHtml(page.page_name) : "—"}</td>
        <td class="col-center" data-label="รูป/วิดีโอ" style="font-size:12px">${mediaCount > 0 ? `📎 ${mediaCount}` : "—"}</td>
        <td class="col-center" data-label="เวลาเผยแพร่" style="font-size:12px">${formatDateTime(p.scheduled_at)}</td>
        <td class="col-center" data-label="สถานะ"><span class="fb-status-badge fbstat-${p.status}">${fbStatusLabel(p.status)}</span></td>
        <td class="col-center" data-label="จัดการ">
          <div class="action-group">
            ${
              p.fb_post_url || p.fb_published_id
                ? `<a class="btn-icon" target="_blank"
                    href="${p.fb_post_url || `https://www.facebook.com/${p.fb_published_id}`}"
                    title="ดูบน FB">🔗</a>`
                : ""
            }
            ${canEdit ? `<button class="btn-icon" data-perm="media_fb_edit" onclick="window.openFbModal(${p.id})" title="แก้ไข">✏️</button>` : ""}
            ${canEdit ? `<button class="btn-icon danger" data-perm="media_fb_cancel" onclick="window.cancelFbPost(${p.id})" title="ยกเลิก">🚫</button>` : ""}
          </div>
        </td>
      </tr>`;
    })
    .join("");

  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
}

function bindFbFilterListeners() {
  document.getElementById("fbSearchInput")?.addEventListener("input", renderFbTable);
  document.getElementById("fbFilterStatus")?.addEventListener("change", renderFbTable);
  document.getElementById("fbFilterPage")?.addEventListener("change", renderFbTable);
}

// ── Modal ─────────────────────────────────────────────────
window.openFbModal = function (id = null) {
  if (!allFbPages.length) {
    showToast("ยังไม่มีเพจที่ตั้งค่าใน fb_pages", "error");
    return;
  }
  editingFbId = id;
  pendingFbFiles = [];

  document.getElementById("fbModalTitle").textContent = id ? "✏️ แก้ไขโพสต์ FB" : "📅 สร้างโพสต์ FB";
  document.getElementById("fFbId").value = id || "";
  document.getElementById("fFbCaption").value = "";
  document.getElementById("fFbLink").value = "";
  document.getElementById("fFbFiles").value = "";
  document.getElementById("fFbFilesPreview").innerHTML = "";

  // Default scheduled = +1 hour, on the hour mark
  const now = new Date(Date.now() + 60 * 60 * 1000);
  now.setSeconds(0, 0);
  document.getElementById("fFbDate").value = toBkkDateStr(now);
  document.getElementById("fFbTime").value = toBkkTimeStr(now);

  if (id) {
    const p = allFbPosts.find((x) => x.id === id);
    if (p) {
      document.getElementById("fFbCaption").value = p.caption || "";
      document.getElementById("fFbLink").value = p.link_url || "";
      const sched = new Date(p.scheduled_at);
      document.getElementById("fFbDate").value = toBkkDateStr(sched);
      document.getElementById("fFbTime").value = toBkkTimeStr(sched);
      const pageSel = document.getElementById("fFbPage");
      if (pageSel) pageSel.value = String(p.fb_page_id);
      if ((p.media_urls || []).length) {
        document.getElementById("fFbFilesPreview").innerHTML =
          (p.media_urls || [])
            .map((u) => `<div class="fb-file-item"><img src="${u}" /></div>`)
            .join("") +
          `<div class="fb-file-item" style="font-size:10px;text-align:center;padding:4px">FB ไม่ให้แก้ไฟล์หลัง schedule</div>`;
      }
    }
  }

  fbUpdateCharCount();
  document.getElementById("fbModalOverlay").classList.add("open");
};

window.closeFbModal = function () {
  document.getElementById("fbModalOverlay").classList.remove("open");
  editingFbId = null;
  pendingFbFiles = [];
};

window.fbUpdateCharCount = function () {
  const len = (document.getElementById("fFbCaption").value || "").length;
  document.getElementById("fFbCharCount").textContent = `${len} ตัวอักษร`;
};

// ── File handling ─────────────────────────────────────────
window.handleFbFilesChange = function (input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  pendingFbFiles = pendingFbFiles.concat(files);
  renderFbFilePreview();
  input.value = "";
};

function renderFbFilePreview() {
  const wrap = document.getElementById("fFbFilesPreview");
  wrap.innerHTML = pendingFbFiles
    .map((f, idx) => {
      const isVideo = f.type.startsWith("video/");
      const url = URL.createObjectURL(f);
      return `<div class="fb-file-item">
        ${isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}" />`}
        <button class="fb-file-remove" onclick="window.removeFbFile(${idx})">✕</button>
        <div class="fb-file-name">${escapeHtml(f.name)}</div>
      </div>`;
    })
    .join("");
}

window.removeFbFile = function (idx) {
  pendingFbFiles.splice(idx, 1);
  renderFbFilePreview();
};

async function uploadFbFile(eventId, file) {
  const { url, key } = getSB();
  const rand = Math.random().toString(36).slice(2, 8);
  // ImageCompressor.uploadViaRest จะ compress ถ้าเป็นรูป, ส่งดิบ ๆ ถ้าเป็นวิดีโอ
  const path = `fb-posts/${eventId}/fb_${Date.now()}_${rand}`;
  const publicUrl = await window.ImageCompressor.uploadViaRest(
    url, key, "event-files", path, file,
  );
  if (!publicUrl) throw new Error("Upload failed");
  return publicUrl;
}

// ── Save / Schedule ───────────────────────────────────────
window.saveFbPost = async function () {
  const caption = document.getElementById("fFbCaption").value.trim();
  if (!caption) return showToast("กรุณาใส่ caption", "error");

  const fb_page_id = parseInt(document.getElementById("fFbPage").value);
  if (!fb_page_id) return showToast("กรุณาเลือกเพจ", "error");

  const dateStr = document.getElementById("fFbDate").value;
  const timeStr = document.getElementById("fFbTime").value;
  if (!dateStr || !timeStr) return showToast("กรุณาเลือกวันเวลา", "error");

  // Treat input as Bangkok TZ (UTC+7)
  const scheduled_at = `${dateStr}T${timeStr}:00+07:00`;
  const link_url = document.getElementById("fFbLink").value.trim() || null;

  const btn = document.getElementById("btnSaveFb");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบันทึก...";
  showLoading(true);

  try {
    if (editingFbId) {
      const row = allFbPosts.find((x) => x.id === editingFbId);
      await window.FbApi.editAndSave(row, { caption, scheduled_at });
      showToast("แก้ไขโพสต์แล้ว", "success");
    } else {
      let media_urls = [];
      if (pendingFbFiles.length) {
        for (const f of pendingFbFiles) {
          const u = await uploadFbFile(currentEventId, f);
          media_urls.push(u);
        }
      }

      await window.FbApi.scheduleAndSave({
        fb_page_id,
        event_id: currentEventId,
        caption,
        media_urls,
        link_url,
        scheduled_at,
        created_by: window.ERP_USER?.user_id || null,
      });
      showToast("schedule โพสต์ FB แล้ว 📅", "success");
    }
    window.closeFbModal();
    allFbPosts = await window.FbApi.listScheduledPosts({ event_id: currentEventId });
    updateFbStats();
    renderFbTable();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📅 Schedule";
    showLoading(false);
  }
};

// ── Cancel ────────────────────────────────────────────────
window.cancelFbPost = function (id) {
  const row = allFbPosts.find((x) => x.id === id);
  if (!row) return;
  DeleteModal.open(`ต้องการยกเลิก schedule โพสต์นี้หรือไม่?`, async () => {
    showLoading(true);
    try {
      await window.FbApi.cancelAndSave(row);
      showToast("ยกเลิก schedule แล้ว", "success");
      allFbPosts = await window.FbApi.listScheduledPosts({ event_id: currentEventId });
      updateFbStats();
      renderFbTable();
    } catch (e) {
      showToast("ยกเลิกไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── HELPERS ───────────────────────────────────────────────
function fbStatusLabel(s) {
  return (
    {
      DRAFT: "📝 Draft",
      SCHEDULED: "📅 Scheduled",
      PUBLISHED: "✅ Published",
      FAILED: "❌ Failed",
      CANCELLED: "🚫 Cancelled",
    }[s] || s || "—"
  );
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function toBkkDateStr(d) {
  return d.toLocaleDateString("sv", { timeZone: "Asia/Bangkok" });
}
function toBkkTimeStr(d) {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  } catch { return String(iso).slice(0, 16).replace("T", " "); }
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

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
