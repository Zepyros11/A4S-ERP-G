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
let currentPosterUrl = null;
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
          `events?event_id=eq.${encodeURIComponent(EVENT_ID)}&select=event_id,event_name,qr_style_config,poster_url,image_urls&limit=1`,
        );
        currentEvent = rows?.[0];
        if (currentEvent) {
          currentPosterUrl = currentEvent.poster_url
            || (Array.isArray(currentEvent.image_urls) ? currentEvent.image_urls[0] : null)
            || null;
          document.getElementById("qdEventChip").textContent = currentEvent.event_name || `Event ${EVENT_ID}`;
          document.getElementById("qdEventChip").style.display = "inline-block";
          document.getElementById("qdSaveBtn").style.display = "inline-block";
          document.getElementById("qdSubtitle").textContent =
            `กำหนด QR style สำหรับ "${currentEvent.event_name}" โดยเฉพาะ — หากยังไม่บันทึกจะใช้ preset default`;
          // Update poster section hint
          const hint = document.getElementById("qdPosterEventHint");
          if (hint) {
            hint.textContent = currentPosterUrl
              ? "(ใช้ poster จาก event นี้)"
              : "(event นี้ยังไม่มี poster)";
          }
        }
      } catch (e) { console.warn("load event fail:", e); }
    } else {
      // Standalone — no event; user can upload a test poster for preview
      const hint = document.getElementById("qdPosterEventHint");
      if (hint) hint.textContent = "(ไม่มี event — อัปโหลดรูปเพื่อทดสอบ preview)";
    }

    // 2) โหลด config ปัจจุบัน (event override ถ้ามี, ไม่งั้น default preset, ไม่งั้น hard default)
    currentCfg = currentEvent?.qr_style_config
      || (await window.QRDesigner.getEffectiveConfig(EVENT_ID));
    applyCfgToControls(currentCfg);

    // 3) Render QR
    await renderPreview();

    // 4) โหลด presets
    await loadPresets();

    // 5) โหลด event picker
    await loadEventPicker();

    // 6) Bind events
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
    const result = await window.QRDesigner.renderQR(wrap, payload, currentCfg, {
      posterUrl: currentPosterUrl,
    });
    qrInstance = result;
  } catch (e) {
    wrap.innerHTML = `<div style="padding:30px;color:#dc2626;">${e.message}</div>`;
  }
}

async function updatePreviewOnly() {
  // Always full re-render — qr-code-styling's .update() merges config,
  // causing stale fields (gradient, image, etc.) to leak between previews.
  // Full re-render is only ~50-100ms with 150ms debounce on user input.
  return renderPreview();
}

/* ── Apply config → form controls ── */
function applyCfgToControls(cfg) {
  const g = (id) => document.getElementById(id);
  const dots = cfg.dotsOptions || {};
  const bg = cfg.backgroundOptions || {};
  const cs = cfg.cornersSquareOptions || {};
  const cd = cfg.cornersDotOptions || {};
  const img = cfg.imageOptions || {};
  const pb = cfg.posterBackground || {};
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
  // Poster background
  const useP = !!pb.enabled;
  g("qdUsePoster").checked = useP;
  g("qdPosterCtls").style.display = useP ? "" : "none";
  g("qdPosterOpacity").value = pb.opacity ?? 1;
  g("qdPosterScale").value = pb.scale ?? 1;
  g("qdPosterOffsetX").value = pb.offsetX ?? 0;
  g("qdPosterOffsetY").value = pb.offsetY ?? 0;
  g("qdPosterFit").value = pb.fit || "cover";
  g("qdPosterPadding").value = pb.padding ?? 40;
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
    posterBackground: {
      enabled: g("qdUsePoster").checked,
      opacity: parseFloat(g("qdPosterOpacity").value) || 0,
      scale: parseFloat(g("qdPosterScale").value) || 1,
      offsetX: parseFloat(g("qdPosterOffsetX").value) || 0,
      offsetY: parseFloat(g("qdPosterOffsetY").value) || 0,
      fit: g("qdPosterFit").value || "cover",
      padding: parseInt(g("qdPosterPadding").value, 10) || 0,
    },
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
    "qdPosterOpacity", "qdPosterScale", "qdPosterOffsetX", "qdPosterOffsetY", "qdPosterFit", "qdPosterPadding",
  ].forEach((id) => {
    document.getElementById(id).addEventListener("change", onCtlChange);
    document.getElementById(id).addEventListener("input", onCtlChange);
  });

  // Toggle poster bg — also show/hide poster controls panel
  document.getElementById("qdUsePoster").addEventListener("change", (e) => {
    document.getElementById("qdPosterCtls").style.display = e.target.checked ? "" : "none";
    // If user turns on but no poster yet → prompt to upload
    if (e.target.checked && !currentPosterUrl) {
      document.getElementById("qdPosterUpload").click();
    }
    onCtlChange();
  });

  // File upload — for standalone mode or overriding event poster
  document.getElementById("qdPosterUpload").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("กรุณาเลือกไฟล์รูปภาพ", "warning");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      currentPosterUrl = reader.result;
      document.getElementById("qdPosterUploadLbl").textContent =
        `✅ ${file.name} · คลิกเพื่อเปลี่ยน`;
      // auto-enable toggle
      const toggle = document.getElementById("qdUsePoster");
      if (!toggle.checked) {
        toggle.checked = true;
        document.getElementById("qdPosterCtls").style.display = "";
      }
      onCtlChange();
    };
    reader.readAsDataURL(file);
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
    // Auto-detect which preset matches current config (for initial highlight)
    if (activePresetId == null && currentCfg) {
      const match = presets.find(
        (p) => _cfgEquals(p.config, currentCfg),
      );
      if (match) activePresetId = match.id;
      else if (!currentEvent?.qr_style_config) {
        // Event hasn't overridden → default preset is being used
        const def = presets.find((p) => p.is_default);
        if (def) activePresetId = def.id;
      }
    }
    renderPresets();
  } catch (e) {
    document.getElementById("qdPresetList").innerHTML =
      `<div class="qd-empty">❌ โหลดไม่ได้: ${e.message}</div>`;
  }
}

function _cfgEquals(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
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
  // Deep clone + merge with default to guarantee fresh config
  // (prevents stale gradient/options from previous preset leaking via qr-code-styling's internal merge)
  currentCfg = window.QRDesigner.mergeConfig(
    window.QRDesigner.getDefaultConfig(),
    JSON.parse(JSON.stringify(p.config)),
  );
  activePresetId = id;
  applyCfgToControls(currentCfg);
  markActivePreset();
  // Force full re-render (not updateConfig) — qr-code-styling's update() merges,
  // so old fields like dotsOptions.gradient can persist when switching presets
  await renderPreview();
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

/* ── Event picker (bulk-select target event to save to) ── */
async function loadEventPicker() {
  const sel = document.getElementById("qdEventPicker");
  if (!sel) return;
  try {
    const rows = await sbGet(
      "events?select=event_id,event_name,event_date,qr_style_config&order=event_date.desc&limit=200",
    );
    // Preserve first option (placeholder)
    sel.innerHTML = '<option value="">— เลือก event ที่จะบันทึก —</option>';
    (rows || []).forEach((r) => {
      const hasStyle = r.qr_style_config ? " 🎨" : "";
      const opt = document.createElement("option");
      opt.value = r.event_id;
      opt.textContent = `${r.event_name}${hasStyle}`;
      opt.dataset.eventName = r.event_name;
      opt.dataset.posterUrl = r.poster_url || "";
      sel.appendChild(opt);
    });
    if (EVENT_ID) sel.value = EVENT_ID;
  } catch (e) {
    console.warn("loadEventPicker:", e.message);
  }
}

window.onEventPickerChange = async function () {
  const sel = document.getElementById("qdEventPicker");
  const btn = document.getElementById("qdSaveBtn");
  const chip = document.getElementById("qdEventChip");
  const val = sel.value;
  if (!val) {
    btn.style.display = "none";
    chip.style.display = "none";
    currentEvent = null;
    currentPosterUrl = null;
    return;
  }
  // Load selected event's poster_url + existing qr_style_config
  try {
    const rows = await sbGet(
      `events?event_id=eq.${encodeURIComponent(val)}&select=event_id,event_name,poster_url,image_urls,qr_style_config&limit=1`,
    );
    currentEvent = rows?.[0];
    if (currentEvent) {
      currentPosterUrl = currentEvent.poster_url
        || (Array.isArray(currentEvent.image_urls) ? currentEvent.image_urls[0] : null)
        || null;
      chip.textContent = currentEvent.event_name;
      chip.style.display = "inline-block";
      btn.style.display = "inline-block";
      // Update poster section hint
      const hint = document.getElementById("qdPosterEventHint");
      if (hint) {
        hint.textContent = currentPosterUrl
          ? `(ใช้ poster จาก "${currentEvent.event_name}")`
          : `(event "${currentEvent.event_name}" ยังไม่มี poster)`;
      }
      // re-render to pick up new poster
      await renderPreview();
    }
  } catch (e) {
    showToast("โหลด event ไม่สำเร็จ: " + e.message, "error");
  }
};

/* ── Save to event ── */
window.saveToEvent = async function () {
  const targetId = document.getElementById("qdEventPicker")?.value || EVENT_ID;
  if (!targetId) {
    showToast("กรุณาเลือก event ก่อนบันทึก", "warning");
    return;
  }
  showLoading(true);
  try {
    await window.QRDesigner.saveEventConfig(targetId, currentCfg);
    const name = currentEvent?.event_name || `Event ${targetId}`;
    showToast(`บันทึก QR ของ "${name}" แล้ว`, "success");
    // Refresh picker to show 🎨 marker
    await loadEventPicker();
    document.getElementById("qdEventPicker").value = targetId;
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
