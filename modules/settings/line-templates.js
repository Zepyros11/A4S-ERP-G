/* ============================================================
   line-templates.js — แก้ไขข้อความตอบกลับของ LINE Bot
   ------------------------------------------------------------
   - อ่าน/เขียน ตาราง line_reply_templates (Supabase)
   - หลัง save เรียก `{proxy}/line/templates/reload` เพื่อ force webhook refresh cache
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";
const PROXY_URL = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");

let templates = [];       // [{ key, text, description, placeholders, updated_at }]
let original = {};        // key → original text (สำหรับ diff)
let dirty = new Set();    // keys ที่แก้แล้ว

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 3500);
}
function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.toggle("active", on);
}

async function sbGet(path) {
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
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

/* ── Load + render ── */
async function loadTemplates() {
  if (!SB_URL || !SB_KEY) {
    showToast("ยังไม่ได้ตั้งค่า Supabase", "error");
    return;
  }
  showLoading(true);
  try {
    const rows = await sbGet("line_reply_templates?select=*&order=key");
    templates = rows || [];
    original = {};
    dirty.clear();
    templates.forEach((t) => { original[t.key] = t.text || ""; });
    renderList();
    updateGlobalBar();
  } catch (e) {
    showToast("โหลด template ไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

function renderList() {
  const list = document.getElementById("tplList");
  if (!templates.length) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);">
      ยังไม่มี template — รัน SQL migration 031 ก่อน</div>`;
    return;
  }
  const ALL_PLACEHOLDERS = ["{name}", "{code}", "{username}", "{role}"];
  list.innerHTML = templates.map((t) => {
    const declared = new Set((t.placeholders || []).filter(Boolean));
    const phHtml = ALL_PLACEHOLDERS.map((p) => {
      const isDeclared = declared.has(p);
      const title = isDeclared
        ? `แทรก ${p} (ใช้ได้กับ template นี้)`
        : `แทรก ${p} (ไม่ใช่ placeholder มาตรฐานของ template นี้ — ใส่ได้แต่จะไม่ถูกแทนที่)`;
      return `<span class="tpl-ph ${isDeclared ? '' : 'tpl-ph-extra'}"
        title="${title}"
        onclick="insertPh('${t.key}','${p}')">${p}</span>`;
    }).join("");
    return `<div class="tpl-card" id="card-${t.key}">
      <div class="tpl-head">
        <div class="tpl-head-left">
          <span class="tpl-key">${t.key}</span>
          <span class="tpl-desc">${t.description || ""}</span>
        </div>
        <div class="tpl-placeholders">${phHtml}</div>
      </div>
      <div class="tpl-body">
        <textarea class="tpl-textarea" id="ta-${t.key}"
          oninput="onTextChange('${t.key}')">${t.text || ""}</textarea>
        <div class="tpl-meta">
          <span id="meta-${t.key}">${t.text?.length || 0} ตัวอักษร</span>
          <span id="status-${t.key}" class="tpl-saved">✓ บันทึกไว้แล้ว</span>
        </div>
        <div class="tpl-preview" id="preview-${t.key}"></div>
        <div class="tpl-actions">
          <button class="tpl-btn" onclick="togglePreview('${t.key}')">👁️ ดูตัวอย่าง</button>
          <button class="tpl-btn tpl-btn-danger" onclick="resetOne('${t.key}')">↺ ยกเลิก</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

function getText(key) {
  return document.getElementById(`ta-${key}`)?.value ?? "";
}
function setText(key, val) {
  const ta = document.getElementById(`ta-${key}`);
  if (ta) ta.value = val;
  onTextChange(key);
}

function onTextChange(key) {
  const curr = getText(key);
  const orig = original[key] || "";
  const meta = document.getElementById(`meta-${key}`);
  const status = document.getElementById(`status-${key}`);
  if (meta) meta.textContent = `${curr.length} ตัวอักษร`;
  const card = document.getElementById(`card-${key}`);
  if (curr !== orig) {
    dirty.add(key);
    if (status) { status.textContent = "มีการแก้ไข"; status.className = "tpl-dirty"; }
    card?.classList.add("dirty");
  } else {
    dirty.delete(key);
    if (status) { status.textContent = "✓ บันทึกไว้แล้ว"; status.className = "tpl-saved"; }
    card?.classList.remove("dirty");
  }
  // live-update preview ถ้าเปิดอยู่
  const prev = document.getElementById(`preview-${key}`);
  if (prev?.classList.contains("show")) renderPreview(key);
  updateGlobalBar();
}

function insertPh(key, ph) {
  const ta = document.getElementById(`ta-${key}`);
  if (!ta) return;
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, s) + ph + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + ph.length;
  onTextChange(key);
}

function renderPreview(key) {
  const prev = document.getElementById(`preview-${key}`);
  if (!prev) return;
  const sample = {
    name: "สมชาย ใจดี",
    code: "10271",
    username: "somchai",
    role: "Manager",
  };
  let out = getText(key);
  Object.entries(sample).forEach(([k, v]) => {
    out = out.split(`{${k}}`).join(v);
  });
  prev.innerHTML = `<div class="tpl-preview-hdr">Preview (ใช้ข้อมูลตัวอย่าง)</div>${
    out.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))
  }`;
}

function togglePreview(key) {
  const prev = document.getElementById(`preview-${key}`);
  if (!prev) return;
  if (prev.classList.contains("show")) {
    prev.classList.remove("show");
  } else {
    renderPreview(key);
    prev.classList.add("show");
  }
}

function resetOne(key) {
  setText(key, original[key] || "");
  showToast(`ยกเลิกการแก้ไข: ${key}`, "success");
}

async function reloadAll() {
  if (dirty.size > 0) {
    const ok = await ConfirmModal.open({
      icon: "⚠️",
      title: "ทิ้งการแก้ไข?",
      tone: "warning",
      message: `มี ${dirty.size} template ที่ยังไม่ได้บันทึก — โหลดใหม่จะสูญเสียการแก้ไขทั้งหมด`,
      okText: "ทิ้งและโหลดใหม่",
      cancelText: "ยกเลิก",
    });
    if (!ok) return;
  }
  loadTemplates();
}

function updateGlobalBar() {
  const bar = document.getElementById("globalBar");
  const status = document.getElementById("globalStatus");
  if (!bar) return;
  if (dirty.size === 0) {
    bar.style.display = "none";
  } else {
    bar.style.display = "flex";
    status.textContent = `มีการแก้ไข ${dirty.size} template — ยังไม่ได้บันทึก`;
  }
}

async function saveAll() {
  if (dirty.size === 0) return;
  const username = (window.ERP_USER?.username) || "unknown";
  showLoading(true);
  let ok = 0, fail = 0;
  for (const key of [...dirty]) {
    try {
      await sbPatch(
        `line_reply_templates?key=eq.${encodeURIComponent(key)}`,
        { text: getText(key), updated_by: username },
      );
      original[key] = getText(key);
      dirty.delete(key);
      const status = document.getElementById(`status-${key}`);
      if (status) { status.textContent = "✓ บันทึกแล้ว"; status.className = "tpl-saved"; }
      ok++;
    } catch (e) {
      console.error("save", key, e);
      fail++;
    }
  }
  showLoading(false);
  updateGlobalBar();

  // Force webhook to reload cache
  if (PROXY_URL && ok > 0) {
    try {
      await fetch(`${PROXY_URL}/line/templates/reload`, { method: "POST" });
    } catch (e) { console.warn("reload proxy cache fail:", e.message); }
  }

  if (fail === 0) showToast(`✅ บันทึกสำเร็จ ${ok} template`, "success");
  else showToast(`บันทึกสำเร็จ ${ok} / ล้มเหลว ${fail}`, "warning");
}

/* ── Warn on leave if dirty ── */
window.addEventListener("beforeunload", (e) => {
  if (dirty.size > 0) { e.preventDefault(); e.returnValue = ""; }
});

document.addEventListener("DOMContentLoaded", loadTemplates);

window.onTextChange = onTextChange;
window.insertPh = insertPh;
window.togglePreview = togglePreview;
window.resetOne = resetOne;
window.reloadAll = reloadAll;
window.saveAll = saveAll;
