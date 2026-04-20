/* ============================================================
   event-qr-designer.js — QR Code designer (per-event + presets)
   ------------------------------------------------------------
   URL params:
     ?event_id=123  → load + save QR style for this event
     (no param)     → standalone preset manager (no save-to-event button)
   ============================================================ */

const qs = new URLSearchParams(location.search);
const EVENT_ID = qs.get("event_id") || qs.get("event") || "";

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

let currentCfg = null;
let currentEvent = null;
let qrInstance = null;
let presets = [];
let activePresetId = null;

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(on) {
  document.getElementById("loadingOverlay")?.classList.toggle("active", on);
}

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  showLoading(true);
  try {
    // 1) โหลด event ถ้ามี
    if (EVENT_ID) {
      try {
        const rows = await sbGet(
          `events?event_id=eq.${encodeURIComponent(EVENT_ID)}&select=event_id,event_name,qr_style_config&limit=1`,
        );
        currentEvent = rows?.[0];
        if (currentEvent) {
          document.getElementById("qdEventChip").textContent = currentEvent.event_name || `Event ${EVENT_ID}`;
          document.getElementById("qdEventChip").style.display = "inline-block";
          document.getElementById("qdSaveBtn").style.display = "inline-block";
          document.getElementById("qdSubtitle").textContent =
            `กำหนด QR style สำหรับ "${currentEvent.event_name}" โดยเฉพาะ — หากยังไม่บันทึกจะใช้ preset default`;
        }
      } catch (e) { console.warn("load event fail:", e); }
    }

    // 2) โหลด config ปัจจุบัน (event override ถ้ามี, ไม่งั้น default preset, ไม่งั้น hard default)
    currentCfg = currentEvent?.qr_style_config
      || (await window.QRDesigner.getEffectiveConfig(EVENT_ID));
    applyCfgToControls(currentCfg);

    // 3) Render QR
    await renderPreview();

    // 4) โหลด presets
    await loadPresets();

    // 5) Bind events
    bindControls();
  } catch (e) {
    console.error(e);
    showToast("เริ่มต้นไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
});

/* ── Render preview ── */
async function renderPreview() {
  const wrap = document.getElementById("qdQrWrap");
  const payload = document.getElementById("qdCustomPayload").value
    || document.getElementById("qdPayload").textContent;
  document.getElementById("qdPayload").textContent = payload;
  try {
    const result = await window.QRDesigner.renderQR(wrap, payload, currentCfg);
    qrInstance = result;
  } catch (e) {
    wrap.innerHTML = `<div style="padding:30px;color:#dc2626;">${e.message}</div>`;
  }
}

async function updatePreviewOnly() {
  if (!qrInstance) return renderPreview();
  const payload = document.getElementById("qdCustomPayload").value || "SAMPLE";
  document.getElementById("qdPayload").textContent = payload;
  try {
    qrInstance.updateConfig(currentCfg);
    qrInstance.updatePayload(payload);
  } catch (e) {
    // fallback: full re-render
    await renderPreview();
  }
}

/* ── Apply config → form controls ── */
function applyCfgToControls(cfg) {
  const g = (id) => document.getElementById(id);
  const dots = cfg.dotsOptions || {};
  const bg = cfg.backgroundOptions || {};
  const cs = cfg.cornersSquareOptions || {};
  const cd = cfg.cornersDotOptions || {};
  const img = cfg.imageOptions || {};
  g("qdDotType").value = dots.type || "rounded";
  g("qdDotColor").value = dots.color || "#06c755";
  g("qdDotColorHex").value = dots.color || "#06c755";
  g("qdBgColor").value = bg.color || "#ffffff";
  g("qdBgColorHex").value = bg.color || "#ffffff";
  g("qdCornerType").value = cs.type || "extra-rounded";
  g("qdCornerColor").value = cs.color || "#065f46";
  g("qdCornerColorHex").value = cs.color || "#065f46";
  g("qdCornerDotType").value = cd.type || "dot";
  g("qdCornerDotColor").value = cd.color || "#06c755";
  g("qdCornerDotColorHex").value = cd.color || "#06c755";
  g("qdUseLogo").checked = cfg.useLogo !== false;
  g("qdLogoSize").value = img.imageSize ?? 0.38;
  g("qdLogoMargin").value = img.margin ?? 8;
  g("qdSize").value = cfg.width || 300;
  g("qdErrorLevel").value = cfg.qrOptions?.errorCorrectionLevel || "H";
}

/* ── Read controls → build config ── */
function readControls() {
  const g = (id) => document.getElementById(id);
  return {
    width: parseInt(g("qdSize").value, 10) || 300,
    height: parseInt(g("qdSize").value, 10) || 300,
    margin: 10,
    qrOptions: { errorCorrectionLevel: g("qdErrorLevel").value },
    dotsOptions: { type: g("qdDotType").value, color: g("qdDotColor").value },
    backgroundOptions: { color: g("qdBgColor").value },
    cornersSquareOptions: { type: g("qdCornerType").value, color: g("qdCornerColor").value },
    cornersDotOptions: { type: g("qdCornerDotType").value, color: g("qdCornerDotColor").value },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: parseFloat(g("qdLogoSize").value) || 0.38,
      margin: parseInt(g("qdLogoMargin").value, 10) || 0,
      crossOrigin: "anonymous",
    },
    useLogo: g("qdUseLogo").checked,
  };
}

function bindControls() {
  const syncColor = (colorId, hexId) => {
    const c = document.getElementById(colorId);
    const h = document.getElementById(hexId);
    c.addEventListener("input", () => { h.value = c.value; onCtlChange(); });
    h.addEventListener("input", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(h.value)) { c.value = h.value; onCtlChange(); }
    });
  };
  syncColor("qdDotColor", "qdDotColorHex");
  syncColor("qdBgColor", "qdBgColorHex");
  syncColor("qdCornerColor", "qdCornerColorHex");
  syncColor("qdCornerDotColor", "qdCornerDotColorHex");

  [
    "qdDotType", "qdCornerType", "qdCornerDotType", "qdUseLogo",
    "qdLogoSize", "qdLogoMargin", "qdSize", "qdErrorLevel", "qdCustomPayload",
  ].forEach((id) => {
    document.getElementById(id).addEventListener("change", onCtlChange);
    document.getElementById(id).addEventListener("input", onCtlChange);
  });
}

let _ctlDebounce = null;
function onCtlChange() {
  currentCfg = readControls();
  activePresetId = null; // จะ deselect preset เมื่อแก้มือ
  markActivePreset();
  clearTimeout(_ctlDebounce);
  _ctlDebounce = setTimeout(updatePreviewOnly, 150);
}

/* ── Presets list ── */
async function loadPresets() {
  try {
    presets = await window.QRDesigner.listPresets();
    renderPresets();
  } catch (e) {
    document.getElementById("qdPresetList").innerHTML =
      `<div class="qd-empty">❌ โหลดไม่ได้: ${e.message}</div>`;
  }
}

function renderPresets() {
  const list = document.getElementById("qdPresetList");
  if (!presets.length) {
    list.innerHTML = `<div class="qd-empty">ยังไม่มี preset</div>`;
    return;
  }
  list.innerHTML = presets.map((p) => {
    const isSys = p.is_system;
    const isDef = p.is_default;
    const isActive = activePresetId === p.id;
    return `<div class="qd-preset-item ${isActive ? "active" : ""}" onclick="applyPreset(${p.id})">
      <div class="qd-preset-name">
        ${p.name}
        ${isSys ? '<span class="qd-sys">system</span>' : ""}
        ${isDef ? '<span class="qd-def">default</span>' : ""}
      </div>
      ${p.description ? `<div class="qd-preset-desc">${p.description}</div>` : ""}
      <div class="qd-preset-actions" onclick="event.stopPropagation()">
        ${!isDef ? `<button class="qd-preset-mini-btn" onclick="setDefaultPreset(${p.id})">ตั้ง default</button>` : ""}
        ${!isSys ? `<button class="qd-preset-mini-btn" onclick="editPreset(${p.id})">แก้ไข</button>` : ""}
        ${!isSys ? `<button class="qd-preset-mini-btn danger" onclick="deletePreset(${p.id})">ลบ</button>` : ""}
      </div>
    </div>`;
  }).join("");
}

function markActivePreset() {
  document.querySelectorAll(".qd-preset-item").forEach((el, i) => {
    el.classList.toggle("active", presets[i]?.id === activePresetId);
  });
}

window.applyPreset = async function (id) {
  const p = presets.find((x) => x.id === id);
  if (!p) return;
  currentCfg = { ...p.config };
  activePresetId = id;
  applyCfgToControls(currentCfg);
  markActivePreset();
  await updatePreviewOnly();
  showToast(`ใช้ preset "${p.name}"`, "success");
};

window.setDefaultPreset = async function (id) {
  try {
    await window.QRDesigner.setDefaultPreset(id);
    await loadPresets();
    markActivePreset();
    showToast("ตั้ง default แล้ว", "success");
  } catch (e) { showToast("ไม่สำเร็จ: " + e.message, "error"); }
};

window.deletePreset = async function (id) {
  const p = presets.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`ลบ preset "${p.name}"?`)) return;
  try {
    await window.QRDesigner.deletePreset(id);
    await loadPresets();
    showToast("ลบแล้ว", "success");
  } catch (e) { showToast("ลบไม่ได้: " + e.message, "error"); }
};

window.editPreset = function (id) {
  const p = presets.find((x) => x.id === id);
  if (!p) return;
  document.getElementById("qdPresetModalTitle").textContent = "แก้ไข Preset";
  document.getElementById("qdPresetEditId").value = id;
  document.getElementById("qdPresetName").value = p.name;
  document.getElementById("qdPresetDesc").value = p.description || "";
  document.getElementById("qdPresetDefault").checked = !!p.is_default;
  document.getElementById("qdPresetModal").classList.add("open");
};

window.openNewPresetModal = function () {
  document.getElementById("qdPresetModalTitle").textContent = "บันทึกเป็น Preset ใหม่";
  document.getElementById("qdPresetEditId").value = "";
  document.getElementById("qdPresetName").value = "";
  document.getElementById("qdPresetDesc").value = "";
  document.getElementById("qdPresetDefault").checked = false;
  document.getElementById("qdPresetModal").classList.add("open");
};

window.closePresetModal = function () {
  document.getElementById("qdPresetModal").classList.remove("open");
};

window.savePreset = async function () {
  const name = document.getElementById("qdPresetName").value.trim();
  if (!name) return showToast("กรุณากรอกชื่อ preset", "warning");
  const id = document.getElementById("qdPresetEditId").value;
  const description = document.getElementById("qdPresetDesc").value.trim();
  const is_default = document.getElementById("qdPresetDefault").checked;
  showLoading(true);
  try {
    const savedId = await window.QRDesigner.savePreset({
      id: id ? Number(id) : null,
      name,
      description,
      config: currentCfg,
      is_default,
    });
    if (is_default && savedId) {
      await window.QRDesigner.setDefaultPreset(savedId);
    }
    closePresetModal();
    await loadPresets();
    showToast(id ? "แก้ไข preset แล้ว" : "สร้าง preset ใหม่แล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ── Save to event ── */
window.saveToEvent = async function () {
  if (!EVENT_ID) return;
  showLoading(true);
  try {
    await window.QRDesigner.saveEventConfig(EVENT_ID, currentCfg);
    showToast(`บันทึก QR ของ "${currentEvent?.event_name || EVENT_ID}" แล้ว`, "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ── Download / Print ── */
window.downloadQR = function (ext) {
  if (!qrInstance) return;
  const payload = document.getElementById("qdCustomPayload").value || "qr";
  const safeName = `qr-${String(payload).replace(/[^a-z0-9-_]/gi, "_")}`;
  try {
    qrInstance.download(safeName, ext);
  } catch (e) {
    showToast("ดาวน์โหลดไม่ได้: " + e.message, "error");
  }
};

window.printQR = function () {
  const wrap = document.getElementById("qdQrWrap");
  if (!wrap) return;
  const canvas = wrap.querySelector("canvas");
  const svg = wrap.querySelector("svg");
  const dataUrl = canvas ? canvas.toDataURL("image/png") : null;
  const html = dataUrl
    ? `<img src="${dataUrl}" style="max-width:80vw;" />`
    : (svg ? svg.outerHTML : "");
  const w = window.open("", "_blank", "width=500,height=600");
  w.document.write(`<!doctype html><html><head><title>QR Print</title>
    <style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;}</style>
    </head><body>${html}
    <script>setTimeout(()=>{window.print();},300);<\/script>
    </body></html>`);
  w.document.close();
};
