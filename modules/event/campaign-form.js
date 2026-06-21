/* ============================================================
   campaign-form.js — Campaign Review (create / edit form page)
   แยกออกจาก modal เดิมใน campaign-planning.js
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
    throw new Error(e.message || `Error ${res.status}`);
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

const BUCKET = "event-files";
const LIST_URL = "./campaign-planning.html";

// เงื่อนไขเริ่มต้น (prefill ตอนสร้างใหม่ — แก้ได้)
const DEFAULT_TERMS = [
  "ผู้เข้าร่วมกิจกรรมต้องส่งหลักฐานให้ครบถ้วนภายในระยะเวลาที่กำหนด",
  "การตัดสินของบริษัทถือเป็นที่สิ้นสุด",
  "บริษัทขอสงวนสิทธิ์ในการใช้ภาพ วิดีโอ และเนื้อหาที่ส่งเข้าร่วมกิจกรรมเพื่อการประชาสัมพันธ์ การตลาด และการเผยแพร่ผ่านสื่อต่าง ๆ ของบริษัทได้ตามความเหมาะสม โดยไม่ต้องแจ้งให้ทราบล่วงหน้า",
].join("\n");

// ── UI helpers ────────────────────────────────────────────
function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = on ? "flex" : "none";
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function genToken() {
  const raw =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return raw.replace(/-/g, "").slice(0, 20);
}

// ── STATE ─────────────────────────────────────────────────
let editingId = null;
let pendingMedia = []; // [{file?, url?, type:'image'|'video', name, isCover}]
let editToken = null;  // public_token ของแคมเปญที่กำลังแก้ (กัน gen ซ้ำ)
let rankMetric = "views"; // เก็บค่าเดิม (ฟิลด์เลือกถูกเอาออกจาก UI แล้ว — default views)
let platforms = ["tiktok", "instagram", "facebook"]; // เก็บค่าเดิม (ฟอร์มลงทะเบียนเป็นแบบมาตรฐานแล้ว)

// ── NAV ───────────────────────────────────────────────────
window.goBack = function () {
  location.href = LIST_URL;
};

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  setupMediaDnd();
  const id = +new URLSearchParams(location.search).get("edit");
  if (id) {
    showLoading(true);
    try {
      const rows = await sbFetch("campaigns", `?campaign_id=eq.${id}&select=*`);
      const camp = Array.isArray(rows) ? rows[0] : null;
      if (!camp) {
        showToast("ไม่พบแคมเปญที่ต้องการแก้ไข", "error");
        setTimeout(() => (location.href = LIST_URL), 1200);
        return;
      }
      fillForm(camp);
    } catch (e) {
      showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
    } finally {
      showLoading(false);
    }
  } else {
    fillForm(null);
  }
  setTimeout(() => document.getElementById("fName").focus(), 50);
}

function fillForm(camp) {
  editingId = camp?.campaign_id || null;
  pendingMedia = [];
  editToken = camp?.public_token || null;

  const heading = editingId ? "✏️ แก้ไขแคมเปญ" : "🚀 สร้างแคมเปญ";
  document.getElementById("cfTitle").textContent = heading;
  document.getElementById("cfCardTitle").textContent = "🚀 ข้อมูลแคมเปญ";
  document.title = (editingId ? "แก้ไขแคมเปญ" : "สร้างแคมเปญ") + " — A4S-ERP";

  document.getElementById("fId").value = editingId || "";
  document.getElementById("fName").value = camp?.name || "";
  document.getElementById("fDesc").value = camp?.description || "";
  document.getElementById("fStart").value = (camp?.start_date || "").slice(0, 10);
  document.getElementById("fEnd").value = (camp?.end_date || "").slice(0, 10);
  document.getElementById("fStatus").value = camp?.status || "DRAFT";
  rankMetric = camp?.rank_metric || "views";
  // ของรางวัลแยกช่องทาง × อันดับ 1–3
  const rw = (camp && camp.rewards && typeof camp.rewards === "object") ? camp.rewards : {};
  ["facebook", "tiktok", "ig"].forEach((c) => {
    const arr = Array.isArray(rw[c]) ? rw[c] : [];
    [1, 2, 3].forEach((n) => {
      document.getElementById(`fRw_${c}_${n}`).value = arr[n - 1] || "";
    });
  });
  // เงื่อนไข: สร้างใหม่ = prefill ค่า default · แก้ของเดิม = ใช้ค่าที่บันทึกไว้
  document.getElementById("fTerms").value = editingId ? (camp?.terms || "") : DEFAULT_TERMS;
  document.getElementById("fRegOpen").checked = camp ? !!camp.reg_open : true;

  platforms = Array.isArray(camp?.platforms) && camp.platforms.length
    ? camp.platforms
    : ["tiktok", "instagram", "facebook"];

  // media: existing url items
  pendingMedia = (camp?.media || []).map((m) => ({
    url: m.url,
    type: m.type || "image",
    name: m.name || "",
    isCover: camp?.cover_url && m.url === camp.cover_url,
  }));
  if (pendingMedia.length && !pendingMedia.some((m) => m.isCover)) {
    const firstImg = pendingMedia.find((m) => m.type === "image");
    if (firstImg) firstImg.isCover = true;
  }
  renderMediaGrid();
}

// ── MEDIA: 5-slot grid + drag & drop ──────────────────────
const MAX_MEDIA = 5;
let dragFromIdx = null; // index ที่กำลังลากเพื่อจัดเรียง (null = ไม่มี / กำลังลากไฟล์เข้า)

function renderMediaGrid() {
  const grid = document.getElementById("fMediaGrid");
  let html = pendingMedia
    .map((m, i) => {
      const src = m.url || (m.file ? URL.createObjectURL(m.file) : "");
      const inner =
        m.type === "video"
          ? `<video src="${src}" muted></video><span class="cmp-vid-tag">▶ วิดีโอ</span>`
          : `<img src="${src}" alt="" draggable="false" />`;
      const coverTag =
        m.type === "image"
          ? `<span class="cmp-cover-tag" style="cursor:pointer" title="ตั้งเป็นปก" onclick="window.setCover(${i})">${m.isCover ? "★ ปก" : "☆"}</span>`
          : "";
      return `<div class="cmp-media-item" draggable="true" data-idx="${i}">
        ${inner}${coverTag}
        <button class="cmp-media-remove" onclick="window.removeMedia(${i})">✕</button>
      </div>`;
    })
    .join("");
  // ช่องว่างให้ครบ 5 ช่อง
  for (let i = pendingMedia.length; i < MAX_MEDIA; i++) {
    html += `<div class="cmp-slot-empty" onclick="document.getElementById('fMediaFiles').click()">
      <span class="cmp-slot-plus">+</span><span class="cmp-slot-label">เพิ่มไฟล์</span>
    </div>`;
  }
  grid.innerHTML = html;
  document.getElementById("fMediaCount").textContent = `${pendingMedia.length}/${MAX_MEDIA}`;
}

function addFiles(files) {
  for (const file of [...files]) {
    if (pendingMedia.length >= MAX_MEDIA) {
      showToast(`สูงสุด ${MAX_MEDIA} ไฟล์`, "warning");
      break;
    }
    if (!/^(image|video)\//.test(file.type)) continue;
    const type = file.type.startsWith("video") ? "video" : "image";
    pendingMedia.push({ file, type, name: file.name, isCover: false });
  }
  if (!pendingMedia.some((m) => m.isCover)) {
    const f = pendingMedia.find((m) => m.type === "image");
    if (f) f.isCover = true;
  }
  renderMediaGrid();
}
function moveMedia(from, to) {
  if (from == null || to == null || from === to) return;
  if (from < 0 || from >= pendingMedia.length) return;
  to = Math.max(0, Math.min(to, pendingMedia.length - 1));
  const [m] = pendingMedia.splice(from, 1);
  pendingMedia.splice(to, 0, m);
  renderMediaGrid();
}

function setupMediaDnd() {
  const grid = document.getElementById("fMediaGrid");

  const isFileDrag = (e) =>
    e.dataTransfer && [...e.dataTransfer.types].includes("Files");

  ["dragenter", "dragover"].forEach((ev) =>
    grid.addEventListener(ev, (e) => {
      if (dragFromIdx !== null) {
        // จัดเรียงภายใน
        e.preventDefault();
        const item = e.target.closest(".cmp-media-item");
        grid.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
        if (item && +item.dataset.idx !== dragFromIdx) item.classList.add("drop-target");
        return;
      }
      if (isFileDrag(e)) {
        e.preventDefault();
        grid.classList.add("is-dragover");
      }
    }),
  );

  grid.addEventListener("dragleave", (e) => {
    if (!grid.contains(e.relatedTarget)) grid.classList.remove("is-dragover");
  });

  grid.addEventListener("drop", (e) => {
    // ลากไฟล์จากเครื่องเข้ามา
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      grid.classList.remove("is-dragover");
      addFiles(e.dataTransfer.files);
      return;
    }
    // จัดเรียงภายใน
    if (dragFromIdx !== null) {
      e.preventDefault();
      const item = e.target.closest(".cmp-media-item");
      const toIdx = item ? +item.dataset.idx : pendingMedia.length - 1;
      moveMedia(dragFromIdx, toIdx);
    }
  });

  grid.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".cmp-media-item");
    if (!item) return;
    dragFromIdx = +item.dataset.idx;
    item.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(dragFromIdx)); } catch {}
  });

  grid.addEventListener("dragend", () => {
    dragFromIdx = null;
    grid.classList.remove("is-dragover");
    grid.querySelectorAll(".is-dragging, .drop-target").forEach((el) =>
      el.classList.remove("is-dragging", "drop-target"),
    );
  });
}

window.setCover = function (i) {
  pendingMedia.forEach((m, idx) => (m.isCover = idx === i && m.type === "image"));
  renderMediaGrid();
};
window.removeMedia = function (i) {
  pendingMedia.splice(i, 1);
  if (pendingMedia.length && !pendingMedia.some((m) => m.isCover)) {
    const f = pendingMedia.find((m) => m.type === "image");
    if (f) f.isCover = true;
  }
  renderMediaGrid();
};
window.handleMediaFiles = function (input) {
  addFiles(input.files);
  input.value = "";
};

// ── REWARDS (แยกช่องทาง × อันดับ 1–3) ─────────────────────
function collectRewards() {
  const out = {};
  ["facebook", "tiktok", "ig"].forEach((c) => {
    const arr = [1, 2, 3].map((n) => (document.getElementById(`fRw_${c}_${n}`).value || "").trim());
    if (arr.some(Boolean)) out[c] = arr; // เก็บเฉพาะช่องทางที่มีรางวัลอย่างน้อย 1 อันดับ
  });
  return out;
}

// ── SAVE ──────────────────────────────────────────────────
window.saveCampaign = async function () {
  const name = document.getElementById("fName").value.trim();
  if (!name) return showToast("กรุณาใส่ชื่อแคมเปญ", "error");

  const btn = document.getElementById("btnSaveCamp");
  btn.disabled = true;
  showLoading(true);
  try {
    const { url, key } = getSB();
    const token = editToken || genToken();

    // upload pending files → url
    const media = [];
    let coverUrl = null;
    for (let i = 0; i < pendingMedia.length; i++) {
      const m = pendingMedia[i];
      let fileUrl = m.url;
      if (!fileUrl && m.file) {
        const safe = (m.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `campaigns/${token}/${Date.now()}_${i}_${safe}`;
        fileUrl = await window.ImageCompressor.uploadViaRest(url, key, BUCKET, path, m.file);
        if (!fileUrl) throw new Error(`อัปโหลดไฟล์ "${m.name}" ไม่สำเร็จ`);
      }
      media.push({ url: fileUrl, type: m.type, name: m.name || "" });
      if (m.isCover) coverUrl = fileUrl;
    }
    if (!coverUrl) {
      const firstImg = media.find((m) => m.type === "image");
      coverUrl = firstImg ? firstImg.url : null;
    }

    const payload = {
      name,
      description: document.getElementById("fDesc").value.trim() || null,
      start_date: document.getElementById("fStart").value || null,
      end_date: document.getElementById("fEnd").value || null,
      status: document.getElementById("fStatus").value,
      rank_metric: rankMetric,
      platforms,
      rewards: collectRewards(),
      terms: document.getElementById("fTerms").value.trim() || null,
      reg_open: document.getElementById("fRegOpen").checked,
      media,
      cover_url: coverUrl,
      public_token: token,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      await sbFetch("campaigns", `?campaign_id=eq.${editingId}`, { method: "PATCH", body: payload });
    } else {
      payload.created_by = localStorage.getItem("user_name") || localStorage.getItem("username") || null;
      await sbFetch("campaigns", "", { method: "POST", body: payload });
    }

    showToast("บันทึกแคมเปญแล้ว", "success");
    setTimeout(() => (location.href = LIST_URL), 600);
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    btn.disabled = false;
    showLoading(false);
  }
};

document.addEventListener("DOMContentLoaded", initPage);
