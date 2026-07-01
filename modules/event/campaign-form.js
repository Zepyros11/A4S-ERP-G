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
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// ── STATE ─────────────────────────────────────────────────
let editingId = null;
let editToken = null;  // public_token ของแคมเปญที่กำลังแก้ (กัน gen ซ้ำ)
let regFields = [];    // ฟิลด์กำหนดเองของฟอร์มลงทะเบียน → campaigns.register_fields
// ของรางวัล per-channel: { mode:'ranked'|'topn', metric, channels:{<key>:{enabled,tiers:[{rank_from,rank_to,min_value,prize}]}} }
let rewardMeta = {
  mode: "ranked", metric: ["likes"], combine_channels: false,
  channels: {
    facebook: { enabled: false, tiers: [] },
    tiktok: { enabled: false, tiers: [] },
    ig: { enabled: false, tiers: [] },
    all: { enabled: true, tiers: [] }, // pseudo-channel: รางวัลตอน "รวมยอดทุกช่องทาง"
  },
};
let platforms = ["tiktok", "instagram", "facebook"]; // เก็บค่าเดิม (ฟอร์มลงทะเบียนเป็นแบบมาตรฐานแล้ว)

// ── NAV ───────────────────────────────────────────────────
window.goBack = function () {
  location.href = LIST_URL;
};

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  mediaMgr.setup();
  rulesMgr.setup();
  setupRegFieldsDnd();
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
  // ของรางวัล per-channel (รองรับ format เดิม)
  rewardMeta = normalizeRewards(camp?.rewards, camp?.rank_metric);
  renderRewards(); // updateRewardModeUI ตั้งค่า checkbox metric/channel ให้เอง
  // เงื่อนไข: สร้างใหม่ = prefill ค่า default · แก้ของเดิม = ใช้ค่าที่บันทึกไว้
  document.getElementById("fTerms").value = editingId ? (camp?.terms || "") : DEFAULT_TERMS;
  document.getElementById("fRegOpen").checked = camp ? !!camp.reg_open : true;

  platforms = Array.isArray(camp?.platforms) && camp.platforms.length
    ? camp.platforms
    : ["tiktok", "instagram", "facebook"];

  // สื่อโปรโมต: existing url items
  mediaMgr.setItems(
    (camp?.media || []).map((m) => ({
      url: m.url,
      type: m.type || "image",
      name: m.name || "",
      isCover: camp?.cover_url && m.url === camp.cover_url,
    })),
  );

  // ข้อกำหนด Campaign: รูป + ข้อความ
  rulesMgr.setItems(
    (camp?.requirements_images || []).map((m) => ({
      url: m.url,
      type: "image",
      name: m.name || "",
      isCover: false,
    })),
  );
  document.getElementById("fRulesText").value = camp?.requirements_text || "";

  // ฟิลด์กำหนดเองของฟอร์มลงทะเบียน
  regFields = Array.isArray(camp?.register_fields)
    ? camp.register_fields.map((f) => ({
        id: f.id || "f_" + genToken().slice(0, 8),
        label: f.label || "",
        type: f.type || "text",
        required: !!f.required,
        options: Array.isArray(f.options) ? f.options : [],
      }))
    : [];
  renderRegFields();
}

// ── MEDIA: reusable slot-grid + drag & drop (factory) ─────
// ใช้ซ้ำได้หลายกริด (สื่อโปรโมต ≤5 / รูปข้อกำหนด ≤10) — event delegation
// ไม่ผูก global handler (กัน collision) · imagesOnly/allowCover ปรับได้ต่อกริด
function createMediaManager({ gridId, fileInputId, countId, max, imagesOnly = false, allowCover = false, emptyLabel = "เพิ่มไฟล์" }) {
  let items = []; // [{file?, url?, type:'image'|'video', name, isCover}]
  let dragFromIdx = null;
  const $grid = () => document.getElementById(gridId);

  function ensureCover() {
    if (!allowCover) return;
    if (items.length && !items.some((m) => m.isCover)) {
      const f = items.find((m) => m.type === "image");
      if (f) f.isCover = true;
    }
  }

  function render() {
    const grid = $grid();
    if (!grid) return;
    let html = items
      .map((m, i) => {
        const src = m.url || (m.file ? URL.createObjectURL(m.file) : "");
        const inner =
          m.type === "video"
            ? `<video src="${src}" muted></video><span class="cmp-vid-tag">▶ วิดีโอ</span>`
            : `<img src="${src}" alt="" draggable="false" />`;
        const coverTag =
          allowCover && m.type === "image"
            ? `<span class="cmp-cover-tag" style="cursor:pointer" title="ตั้งเป็นปก" data-act="cover" data-idx="${i}">${m.isCover ? "★ ปก" : "☆"}</span>`
            : "";
        return `<div class="cmp-media-item" draggable="true" data-idx="${i}">
          ${inner}${coverTag}
          <button class="cmp-media-remove" data-act="remove" data-idx="${i}">✕</button>
        </div>`;
      })
      .join("");
    for (let i = items.length; i < max; i++) {
      html += `<div class="cmp-slot-empty" data-act="add">
        <span class="cmp-slot-plus">+</span><span class="cmp-slot-label">${emptyLabel}</span>
      </div>`;
    }
    grid.innerHTML = html;
    const cnt = document.getElementById(countId);
    if (cnt) cnt.textContent = `${items.length}/${max}`;
  }

  function addFiles(files) {
    for (const file of [...files]) {
      if (items.length >= max) {
        showToast(`สูงสุด ${max} ไฟล์`, "warning");
        break;
      }
      const isImg = /^image\//.test(file.type);
      const isVid = /^video\//.test(file.type);
      if (imagesOnly ? !isImg : !(isImg || isVid)) continue;
      items.push({ file, type: isVid ? "video" : "image", name: file.name, isCover: false });
    }
    ensureCover();
    render();
  }

  function move(from, to) {
    if (from == null || to == null || from === to) return;
    if (from < 0 || from >= items.length) return;
    to = Math.max(0, Math.min(to, items.length - 1));
    const [m] = items.splice(from, 1);
    items.splice(to, 0, m);
    render();
  }

  function setup() {
    const grid = $grid();
    if (!grid) return;
    const fileInput = document.getElementById(fileInputId);
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        addFiles(fileInput.files);
        fileInput.value = "";
      });
    }

    // คลิก (event delegation): + เพิ่มไฟล์ / ✕ ลบ / ☆ ตั้งปก
    grid.addEventListener("click", (e) => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const act = el.dataset.act;
      if (act === "add") {
        if (fileInput) fileInput.click();
      } else if (act === "remove") {
        items.splice(+el.dataset.idx, 1);
        ensureCover();
        render();
      } else if (act === "cover") {
        const i = +el.dataset.idx;
        items.forEach((m, idx) => (m.isCover = idx === i && m.type === "image"));
        render();
      }
    });

    const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");

    ["dragenter", "dragover"].forEach((ev) =>
      grid.addEventListener(ev, (e) => {
        if (dragFromIdx !== null) {
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
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        grid.classList.remove("is-dragover");
        addFiles(e.dataTransfer.files);
        return;
      }
      if (dragFromIdx !== null) {
        e.preventDefault();
        const item = e.target.closest(".cmp-media-item");
        const toIdx = item ? +item.dataset.idx : items.length - 1;
        move(dragFromIdx, toIdx);
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

  return {
    setup,
    render,
    setItems(arr) { items = arr || []; ensureCover(); render(); },
    getItems() { return items; },
  };
}

// สื่อโปรโมต (≤5 · รูป+วิดีโอ · มีปก) / รูปข้อกำหนด (≤10 · รูปอย่างเดียว · ไม่มีปก)
const mediaMgr = createMediaManager({
  gridId: "fMediaGrid", fileInputId: "fMediaFiles", countId: "fMediaCount",
  max: 5, imagesOnly: false, allowCover: true,
});
const rulesMgr = createMediaManager({
  gridId: "fRulesGrid", fileInputId: "fRulesFiles", countId: "fRulesCount",
  max: 10, imagesOnly: true, allowCover: false, emptyLabel: "เพิ่มรูป",
});

// ── REWARDS (per-channel · 2 รูปแบบ: ranked=ต่างกันแต่ละอันดับ / topn=เดียวกัน N คน) ──
const RW_METRIC_KEYS = ["views", "likes", "comments", "shares"]; // เลือกได้หลายเมตริก
const RW_METRIC_LABEL = { views: "ยอดวิว", likes: "ยอดไลค์", comments: "คอมเมนต์", shares: "แชร์", engagement: "การมีส่วนร่วม" };
// metric เก็บเป็น array → label รวมด้วย "+" (รองรับ string เดิม)
function metricArr(m) {
  if (Array.isArray(m)) return m.filter((k) => RW_METRIC_KEYS.includes(k));
  if (m === "engagement") return ["likes", "comments", "shares"];
  if (RW_METRIC_KEYS.includes(m)) return [m];
  return [];
}
function metricUnitLabel(m) {
  const arr = metricArr(m);
  return arr.length ? arr.map((k) => RW_METRIC_LABEL[k]).join(" + ") : "ยอด";
}
// แปลง metric array → ค่า rank_metric เดียว (ตาม CHECK constraint: views/likes/engagement)
function deriveRankMetric(arr) {
  const a = metricArr(arr);
  if (!a.length) return "likes";
  if (a.length === 1 && a[0] === "views") return "views";
  if (a.length === 1 && a[0] === "likes") return "likes";
  return "engagement";
}
const RW_CHANS = [
  { key: "facebook", label: "Facebook",  ic: "../../assets/icons/facebook.png" },
  { key: "tiktok",   label: "TikTok",    ic: "../../assets/icons/tiktok.png" },
  { key: "ig",       label: "Instagram", ic: "../../assets/icons/instagram.png" },
];
function newTier(from = 1, to = from) {
  return { rank_from: from, rank_to: to, min_value: null, prize: "", prize_img: null };
}
function emptyChannels() {
  return {
    facebook: { enabled: false, tiers: [] },
    tiktok: { enabled: false, tiers: [] },
    ig: { enabled: false, tiers: [] },
    all: { enabled: true, tiers: [] },
  };
}
function mapTiers(arr) {
  return (Array.isArray(arr) ? arr : []).map((t) => ({
    rank_from: +t.rank_from || 1,
    rank_to: +t.rank_to || +t.rank_from || 1,
    min_value: t.min_value == null || t.min_value === "" ? null : +t.min_value,
    prize: t.prize || "",
    prize_img: typeof t.prize_img === "string" ? t.prize_img : null,
  }));
}
// รูปของรางวัล (File ที่เพิ่งเลือก / url เดิม) → thumbnail หรือปุ่ม 📷
function tierImgHtml(chanKey, i, t) {
  const src = t.prize_img instanceof File ? URL.createObjectURL(t.prize_img)
    : (typeof t.prize_img === "string" ? t.prize_img : "");
  if (src) {
    return `<div class="rw-prize-img has" title="เปลี่ยนรูป" onclick="window.pickRwImg('${chanKey}',${i})">
      <img src="${src}" alt="" />
      <button type="button" class="rw-img-rm" title="ลบรูป" onclick="event.stopPropagation();window.rmRwImg('${chanKey}',${i})">✕</button>
    </div>`;
  }
  return `<div class="rw-prize-img" title="แนบรูปของรางวัล" onclick="window.pickRwImg('${chanKey}',${i})">📷</div>`;
}

// แปลง rewards จาก DB → per-channel (รองรับ format เดิม: flat tiers / {facebook:[...]})
function normalizeRewards(raw, rankMetric) {
  // metric เริ่มต้นจาก rewards.metric (array/string) → fallback rank_metric เดิม
  const out = { mode: "ranked", metric: ["likes"], combine_channels: false, channels: emptyChannels() };
  if (!raw || typeof raw !== "object") {
    const fb = metricArr(rankMetric);
    if (fb.length) out.metric = fb;
    return out;
  }
  const m = metricArr(raw.metric);
  out.metric = m.length ? m : (metricArr(rankMetric).length ? metricArr(rankMetric) : ["likes"]);
  out.combine_channels = !!raw.combine_channels;
  if (raw.mode === "topn" || raw.mode === "ranked") out.mode = raw.mode;

  if (raw.channels && typeof raw.channels === "object") {
    RW_CHANS.forEach((c) => {
      const ch = raw.channels[c.key];
      if (ch && typeof ch === "object") out.channels[c.key] = { enabled: !!ch.enabled, tiers: mapTiers(ch.tiers) };
    });
    if (raw.channels.all && typeof raw.channels.all === "object")
      out.channels.all = { enabled: true, tiers: mapTiers(raw.channels.all.tiers) };
    return out;
  }
  if (Array.isArray(raw.tiers)) {
    // format กลาง (flat tiers) → ใส่ทุกช่องทาง
    const tiers = mapTiers(raw.tiers);
    out.mode = (tiers.length <= 1 && tiers[0] && (tiers[0].rank_to > tiers[0].rank_from || tiers[0].min_value != null)) ? "topn" : "ranked";
    RW_CHANS.forEach((c) => { out.channels[c.key] = { enabled: tiers.length > 0, tiers: tiers.map((t) => ({ ...t })) }; });
    return out;
  }
  // format เดิม {facebook:[r1,r2,r3]}
  RW_CHANS.forEach((c) => {
    if (Array.isArray(raw[c.key])) {
      const tiers = raw[c.key]
        .map((v, i) => ({ rank_from: i + 1, rank_to: i + 1, min_value: null, prize: v || "" }))
        .filter((t) => t.prize);
      out.channels[c.key] = { enabled: tiers.length > 0, tiers };
    }
  });
  out.mode = "ranked";
  return out;
}

function updateRewardModeUI() {
  document.querySelectorAll("#rwModeToggle .rw-mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === rewardMeta.mode));
  const combineOn = !!rewardMeta.combine_channels;
  const hint = document.getElementById("rwModeHint");
  if (hint) hint.textContent = rewardMeta.mode === "topn"
    ? (combineOn
        ? "กำหนดจำนวนคนที่ได้รางวัลจากยอดรวมทุกช่องทาง (เช่น 10 คนแรก) + ตั้งเงื่อนไขขั้นต่ำได้ (เช่น ยอดรวม ≥ 50)"
        : "กำหนดจำนวนคนที่ได้รางวัล (เช่น 10 คนแรก) — ทุกคนได้รางวัลเดียวกัน + ตั้งเงื่อนไขขั้นต่ำได้")
    : (combineOn
        ? "แต่ละอันดับ (1, 2, 3, …) ของยอดรวมทุกช่องทาง ได้รางวัลต่างกัน — กด ＋ เพิ่มอันดับ"
        : "แต่ละอันดับ (1, 2, 3, …) ได้รางวัลต่างกัน — กด ＋ เพิ่มอันดับ ในแต่ละช่องทาง");
  // ปรับ label ปุ่ม ranked: รวมช่องทาง → ไม่ได้ "แยกช่องทาง"
  const rankedBtn = document.getElementById("rwModeRankedBtn");
  if (rankedBtn) rankedBtn.textContent = combineOn ? "🪜 อันดับรางวัล (ยอดรวม)" : "🪜 อันดับรางวัล แยกช่องทาง";
  RW_CHANS.forEach((c) => {
    const chk = document.querySelector(`#rwChanPick input[data-chan="${c.key}"]`);
    if (chk) chk.checked = !!rewardMeta.channels[c.key].enabled;
  });
  const ms = metricArr(rewardMeta.metric);
  document.querySelectorAll("#rwMetricPick input[data-metric]").forEach((chk) => {
    chk.checked = ms.includes(chk.dataset.metric);
  });
  const combine = document.getElementById("rwCombine");
  if (combine) combine.checked = !!rewardMeta.combine_channels;
}

// สลับ UI ระหว่างโหมด per-channel กับ "รวมยอดทุกช่องทาง"
function updateCombineUI() {
  const on = !!rewardMeta.combine_channels;
  const pickWrap = document.getElementById("rwChanPickWrap");
  const combinedLabel = document.getElementById("rwCombinedLabel");
  if (pickWrap) pickWrap.style.display = on ? "none" : "";
  if (combinedLabel) combinedLabel.style.display = on ? "" : "none";
}

let activeChan = null; // ช่องทางที่กำลังเปิดดู (แท็บ)
function renderRewards() {
  const wrap = document.getElementById("rwChannels");
  if (!wrap) return;
  updateRewardModeUI();
  updateCombineUI();
  // รวมยอดทุกช่องทาง → รางวัลชุดเดียว (ตัดสินจากยอดรวม) ไม่มีแท็บช่องทาง
  if (rewardMeta.combine_channels) {
    if (!rewardMeta.channels.all) rewardMeta.channels.all = { enabled: true, tiers: [] };
    if (!rewardMeta.channels.all.tiers.length) rewardMeta.channels.all.tiers = [newTier(1, 1)];
    wrap.innerHTML = renderChannelCard({ key: "all" });
    return;
  }
  const enabled = RW_CHANS.filter((c) => rewardMeta.channels[c.key].enabled);
  if (!enabled.length) {
    wrap.innerHTML = `<div class="rw-empty">เลือกช่องทางด้านบนเพื่อกรอกของรางวัล</div>`;
    return;
  }
  // active ต้องเป็นช่องที่เปิดอยู่เสมอ
  if (!activeChan || !rewardMeta.channels[activeChan] || !rewardMeta.channels[activeChan].enabled)
    activeChan = enabled[0].key;
  const tabs = enabled
    .map((c) => `<button type="button" class="rw-chan-tab${c.key === activeChan ? " active" : ""}"
        onclick="window.switchRwChannel('${c.key}')"><img class="soc-ic" src="${c.ic}" alt="" /> ${c.label}</button>`)
    .join("");
  const active = enabled.find((c) => c.key === activeChan);
  wrap.innerHTML = `<div class="rw-chan-tabs">${tabs}</div>${renderChannelCard(active)}`;
}
window.switchRwChannel = function (key) {
  if (key === activeChan) return;
  syncRewardsFromDom(); // เก็บค่าที่พิมพ์ในแท็บปัจจุบันก่อนสลับ
  activeChan = key;
  renderRewards();
};
function renderChannelCard(c) {
  const ch = rewardMeta.channels[c.key];
  const unit = metricUnitLabel(rewardMeta.metric) + (rewardMeta.combine_channels ? " (รวมทุกช่องทาง)" : "");
  let body;
  if (rewardMeta.mode === "topn") {
    const t = ch.tiers[0] || newTier(1, 1);
    ch.tiers = [t];
    body = `
      <label class="rw-lbl">จำนวนคนที่ได้รางวัล</label>
      <div class="rw-min">Top <input type="number" min="1" class="form-control" data-chan="${c.key}" data-f="rank_to" value="${escHtml(t.rank_to)}" /> คนแรก</div>
      <label class="rw-lbl">เงื่อนไขขั้นต่ำ (เว้นว่าง = ไม่มี)</label>
      <div class="rw-min">${unit} ≥ <input type="number" min="0" class="form-control" data-chan="${c.key}" data-f="min_value" value="${t.min_value == null ? "" : escHtml(t.min_value)}" placeholder="—" /></div>
      <label class="rw-lbl">ของรางวัล</label>
      <textarea class="form-control" data-chan="${c.key}" data-f="prize" rows="2" placeholder="เช่น ลูกเทนนิสสกรีนโลโก้ 4BODY + สกรีนชื่อ">${escHtml(t.prize)}</textarea>
      <label class="rw-lbl">รูปของรางวัล (แนบได้ 1 รูป)</label>
      <div class="rw-prize-big">${tierImgHtml(c.key, 0, t)}</div>`;
  } else {
    if (!ch.tiers.length) ch.tiers = [newTier(1, 1)];
    const rows = ch.tiers
      .map((t, i) => `
        <div class="rw-tier rw-tier-row" data-chan="${c.key}" data-idx="${i}">
          <span class="rw-tier-no">${["🥇", "🥈", "🥉"][i] || "🏅"} อันดับ ${i + 1}</span>
          <input class="form-control" data-chan="${c.key}" data-idx="${i}" data-f="prize" value="${escHtml(t.prize)}" placeholder="ของรางวัลอันดับ ${i + 1}" />
          ${tierImgHtml(c.key, i, t)}
          <button type="button" class="rw-tier-del" title="ลบอันดับนี้" onclick="window.removeRewardTier('${c.key}',${i})">🗑</button>
        </div>`)
      .join("");
    body = `${rows}<button type="button" class="btn btn-secondary btn-sm rw-add-tier" style="margin-top:6px" onclick="window.addRewardTier('${c.key}')">＋ เพิ่มอันดับ</button>`;
  }
  return `<div class="rw-chan-card">
    ${body}
  </div>`;
}

function syncRewardsFromDom() {
  const ms = [...document.querySelectorAll("#rwMetricPick input[data-metric]:checked")].map((c) => c.dataset.metric);
  rewardMeta.metric = ms.length ? ms : ["likes"]; // อย่างน้อย 1 เมตริก
  const wrap = document.getElementById("rwChannels");
  if (!wrap) return;
  // มีการ์ดที่แสดงอยู่ทีละใบ (แท็บ per-channel หรือการ์ดรวม "all") → sync เฉพาะใบที่เห็น
  const anchor = wrap.querySelector(".rw-chan-card [data-chan]");
  if (!anchor) return;
  const key = anchor.dataset.chan;
  const ch = rewardMeta.channels[key];
  if (!ch) return;
  const card = anchor.closest(".rw-chan-card");
  const prev = ch.tiers; // เก็บ prize_img เดิม (File/url) ไว้ตาม index
  if (rewardMeta.mode === "topn") {
    const get = (f) => card.querySelector(`[data-chan="${key}"][data-f="${f}"]`);
    const n = Math.max(1, +get("rank_to").value || 1);
    const mv = get("min_value").value.trim();
    ch.tiers = [{ rank_from: 1, rank_to: n, min_value: mv === "" ? null : +mv, prize: get("prize").value, prize_img: prev[0] ? prev[0].prize_img : null }];
  } else {
    ch.tiers = [...card.querySelectorAll(`.rw-tier[data-chan="${key}"]`)].map((box, i) => ({
      rank_from: i + 1, rank_to: i + 1, min_value: null,
      prize: box.querySelector('[data-f="prize"]').value,
      prize_img: prev[i] ? prev[i].prize_img : null,
    }));
  }
}

window.toggleRwChannel = function (key, checked) {
  syncRewardsFromDom();
  rewardMeta.channels[key].enabled = checked;
  if (checked) {
    if (!rewardMeta.channels[key].tiers.length) rewardMeta.channels[key].tiers = [newTier(1, 1)];
    activeChan = key; // เปิดแท็บที่เพิ่งเลือกให้เลย
  }
  renderRewards();
};
window.setRewardMode = function (mode) {
  if (mode === rewardMeta.mode) return;
  syncRewardsFromDom();
  rewardMeta.mode = mode;
  [...RW_CHANS.map((c) => ({ key: c.key })), { key: "all" }].forEach((c) => {
    const ch = rewardMeta.channels[c.key];
    if (!ch) return;
    if (mode === "topn") {
      const first = ch.tiers[0];
      ch.tiers = [first ? { ...first, rank_from: 1, rank_to: Math.max(1, first.rank_to || 1) } : newTier(1, 1)];
    } else {
      if (!ch.tiers.length) ch.tiers = [newTier(1, 1)];
      else ch.tiers = ch.tiers.map((t, i) => ({ ...t, rank_from: i + 1, rank_to: i + 1, min_value: null }));
    }
  });
  renderRewards();
};
window.onRwMetricChange = function () {
  syncRewardsFromDom();
  renderRewards();
};
window.onRwCombineChange = function (checked) {
  syncRewardsFromDom(); // เก็บค่าที่พิมพ์ไว้ก่อนสลับโหมด
  rewardMeta.combine_channels = !!checked;
  renderRewards();
};
window.addRewardTier = function (key) {
  syncRewardsFromDom();
  rewardMeta.channels[key].tiers.push(newTier(rewardMeta.channels[key].tiers.length + 1));
  renderRewards();
};
window.removeRewardTier = function (key, i) {
  syncRewardsFromDom();
  rewardMeta.channels[key].tiers.splice(i, 1);
  renderRewards();
};

// รูปของรางวัล — ใช้ file input กลางตัวเดียว + จำ target ที่กำลังเลือก
let _rwImgTarget = null;
window.pickRwImg = function (chan, i) {
  _rwImgTarget = { chan, i };
  document.getElementById("rwImgFile").click();
};
window.onRwImgPicked = function (input) {
  const f = input.files && input.files[0];
  input.value = "";
  if (!f || !_rwImgTarget) return;
  syncRewardsFromDom(); // เก็บค่าที่พิมพ์ไว้ก่อน re-render
  const { chan, i } = _rwImgTarget;
  const t = rewardMeta.channels[chan] && rewardMeta.channels[chan].tiers[i];
  if (t) t.prize_img = f;
  _rwImgTarget = null;
  renderRewards();
};
window.rmRwImg = function (chan, i) {
  syncRewardsFromDom();
  const t = rewardMeta.channels[chan] && rewardMeta.channels[chan].tiers[i];
  if (t) t.prize_img = null;
  renderRewards();
};

// upload รูปของรางวัลที่เป็น File → url (เรียกใน saveCampaign ก่อน collectRewards)
async function uploadRewardImages(url, key, token) {
  // รวม pseudo-channel "all" (รางวัลตอนเปิด "รวมยอดทุกช่องทาง") ด้วย
  for (const c of [...RW_CHANS, { key: "all", label: "รวมทุกช่องทาง" }]) {
    const ch = rewardMeta.channels[c.key];
    if (!ch || !ch.enabled) continue;
    for (let i = 0; i < ch.tiers.length; i++) {
      const t = ch.tiers[i];
      if (t.prize_img instanceof File) {
        const safe = (t.prize_img.name || "prize").replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `campaigns/${token}/reward_${c.key}_${i}_${Date.now()}_${safe}`;
        const u = await window.ImageCompressor.uploadViaRest(url, key, BUCKET, path, t.prize_img);
        if (!u) throw new Error(`อัปโหลดรูปรางวัล ${c.label} ไม่สำเร็จ`);
        t.prize_img = u;
      }
    }
  }
}

function collectRewards() {
  syncRewardsFromDom();
  const channels = {};
  const cleanTiers = (arr) => (arr || [])
    .map((t) => ({
      rank_from: t.rank_from, rank_to: Math.max(t.rank_from, t.rank_to),
      min_value: t.min_value, prize: (t.prize || "").trim(),
      prize_img: typeof t.prize_img === "string" ? t.prize_img : null,
    }))
    .filter((t) => t.prize || t.prize_img);
  // เก็บ per-channel ไว้เสมอ (สลับปิด combine แล้วค่าไม่หาย)
  RW_CHANS.forEach((c) => {
    const ch = rewardMeta.channels[c.key];
    if (!ch.enabled) return;
    const tiers = cleanTiers(ch.tiers);
    if (tiers.length) channels[c.key] = { enabled: true, tiers };
  });
  // รางวัลรวม (ใช้ตอนเปิด "รวมยอดทุกช่องทาง")
  const allTiers = cleanTiers(rewardMeta.channels.all && rewardMeta.channels.all.tiers);
  if (allTiers.length) channels.all = { enabled: true, tiers: allTiers };
  return { mode: rewardMeta.mode, metric: rewardMeta.metric, combine_channels: !!rewardMeta.combine_channels, channels };
}

// ── FIELD BUILDER (ฟอร์มลงทะเบียน · ฟิลด์กำหนดเอง) ─────────
const FLD_TYPE_LABEL = {
  text: "ข้อความสั้น", textarea: "ข้อความยาว",
  dropdown: "ดรอปดาวน์", radio: "ตัวเลือก", checkbox: "ช่องติ๊ก",
};
const FLD_CHOICE_TYPES = ["dropdown", "radio", "checkbox"];

function renderRegFields() {
  const wrap = document.getElementById("regFieldsList");
  if (!wrap) return;
  if (!regFields.length) {
    wrap.innerHTML = `<div class="rf-empty">ยังไม่มีฟิลด์กำหนดเอง — กด “＋ เพิ่มฟิลด์” เพื่อสร้างคำถามเพิ่ม</div>`;
    return;
  }
  wrap.innerHTML = regFields
    .map((f, i) => `
      <div class="rf-row rf-custom" draggable="true" data-idx="${i}">
        <span class="rf-handle" title="ลากเพื่อจัดลำดับ">⠿</span>
        <span class="rf-label">${escHtml(f.label)}</span>
        <span class="rf-type">${FLD_TYPE_LABEL[f.type] || f.type}</span>
        <span class="rf-req ${f.required ? "on" : ""}">${f.required ? "จำเป็น" : "ไม่บังคับ"}</span>
        <span class="rf-actions">
          <button type="button" class="btn-icon" title="แก้ไข" onclick="window.openFieldModal(${i})">✏️</button>
          <button type="button" class="btn-icon" title="ลบ" onclick="window.removeField(${i})">🗑</button>
        </span>
      </div>`)
    .join("");
}

window.openFieldModal = function (idx = null) {
  const f = idx != null ? regFields[idx] : null;
  document.getElementById("fieldModalTitle").textContent = f ? "✏️ แก้ไขฟิลด์" : "➕ เพิ่มฟิลด์";
  document.getElementById("fldIdx").value = idx != null ? idx : "";
  document.getElementById("fldLabel").value = f?.label || "";
  document.getElementById("fldType").value = f?.type || "text";
  document.getElementById("fldRequired").checked = !!f?.required;
  document.getElementById("fldOptions").value = (f?.options || []).join("\n");
  window.onFieldTypeChange();
  document.getElementById("fieldModal").classList.add("open");
  setTimeout(() => document.getElementById("fldLabel").focus(), 50);
};
window.closeFieldModal = function () {
  document.getElementById("fieldModal").classList.remove("open");
};
window.onFieldTypeChange = function () {
  const t = document.getElementById("fldType").value;
  document.getElementById("fldOptionsWrap").style.display = FLD_CHOICE_TYPES.includes(t) ? "" : "none";
};
window.saveField = function () {
  const label = document.getElementById("fldLabel").value.trim();
  if (!label) return showToast("กรุณาใส่ชื่อฟิลด์", "error");
  const type = document.getElementById("fldType").value;
  const required = document.getElementById("fldRequired").checked;
  let options = [];
  if (FLD_CHOICE_TYPES.includes(type)) {
    options = document.getElementById("fldOptions").value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!options.length) return showToast("กรุณาใส่ตัวเลือกอย่างน้อย 1 รายการ", "error");
  }
  const idxRaw = document.getElementById("fldIdx").value;
  const editing = idxRaw !== "";
  const field = {
    id: editing ? regFields[+idxRaw].id : "f_" + genToken().slice(0, 8),
    label, type, required, options,
  };
  if (editing) regFields[+idxRaw] = field;
  else regFields.push(field);
  renderRegFields();
  window.closeFieldModal();
};
window.removeField = function (idx) {
  regFields.splice(idx, 1);
  renderRegFields();
};

function setupRegFieldsDnd() {
  const list = document.getElementById("regFieldsList");
  if (!list) return;
  let from = null;
  list.addEventListener("dragstart", (e) => {
    const r = e.target.closest(".rf-custom");
    if (!r) return;
    from = +r.dataset.idx;
    r.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  list.addEventListener("dragover", (e) => {
    if (from == null) return;
    e.preventDefault();
    const r = e.target.closest(".rf-custom");
    list.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    if (r && +r.dataset.idx !== from) r.classList.add("drop-target");
  });
  list.addEventListener("drop", (e) => {
    if (from == null) return;
    e.preventDefault();
    const r = e.target.closest(".rf-custom");
    const to = r ? +r.dataset.idx : regFields.length - 1;
    if (to != null && from !== to) {
      const [m] = regFields.splice(from, 1);
      regFields.splice(to, 0, m);
      renderRegFields();
    }
    from = null;
  });
  list.addEventListener("dragend", () => {
    from = null;
    list.querySelectorAll(".is-dragging, .drop-target").forEach((el) =>
      el.classList.remove("is-dragging", "drop-target"));
  });
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

    // upload สื่อโปรโมต → url
    const media = [];
    let coverUrl = null;
    const promoItems = mediaMgr.getItems();
    for (let i = 0; i < promoItems.length; i++) {
      const m = promoItems[i];
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

    // upload รูปข้อกำหนด → url (สูงสุด 10)
    const requirementsImages = [];
    const ruleItems = rulesMgr.getItems();
    for (let i = 0; i < ruleItems.length; i++) {
      const m = ruleItems[i];
      let fileUrl = m.url;
      if (!fileUrl && m.file) {
        const safe = (m.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `campaigns/${token}/req_${Date.now()}_${i}_${safe}`;
        fileUrl = await window.ImageCompressor.uploadViaRest(url, key, BUCKET, path, m.file);
        if (!fileUrl) throw new Error(`อัปโหลดรูปข้อกำหนด "${m.name}" ไม่สำเร็จ`);
      }
      requirementsImages.push({ url: fileUrl, name: m.name || "" });
    }

    // upload รูปของรางวัล (File → url) ก่อน collectRewards
    syncRewardsFromDom();
    await uploadRewardImages(url, key, token);

    const payload = {
      name,
      description: document.getElementById("fDesc").value.trim() || null,
      start_date: document.getElementById("fStart").value || null,
      end_date: document.getElementById("fEnd").value || null,
      status: document.getElementById("fStatus").value,
      rank_metric: deriveRankMetric([...document.querySelectorAll("#rwMetricPick input[data-metric]:checked")].map((c) => c.dataset.metric)), // map เมตริกที่เลือก → leaderboard default
      platforms,
      rewards: collectRewards(),
      terms: document.getElementById("fTerms").value.trim() || null,
      reg_open: document.getElementById("fRegOpen").checked,
      register_fields: regFields,
      requirements_images: requirementsImages,
      requirements_text: document.getElementById("fRulesText").value.trim() || null,
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
