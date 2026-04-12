/* ============================================================
   iconPicker.js — Reusable Icon Picker with Search (Iconify)
   ============================================================
   Usage:
     import { openIconPicker } from "../../js/components/ui/iconPicker.js";

     openIconPicker({
       current: "fluent-emoji-flat:crown",   // current selected icon
       onPick: (icon) => {                   // callback when icon is selected
         console.log("picked:", icon);
       },
       anchor: buttonElement,                // optional: position near this element
     });
============================================================ */

const DEFAULT_ICONS = [
  "fluent-emoji-flat:bust-in-silhouette",
  "fluent-emoji-flat:busts-in-silhouette",
  "fluent-emoji-flat:crown",
  "fluent-emoji-flat:shield",
  "fluent-emoji-flat:key",
  "fluent-emoji-flat:locked",
  "fluent-emoji-flat:wrench",
  "fluent-emoji-flat:hammer",
  "fluent-emoji-flat:gear",
  "fluent-emoji-flat:briefcase",
  "fluent-emoji-flat:clipboard",
  "fluent-emoji-flat:chart-increasing",
  "fluent-emoji-flat:trophy",
  "fluent-emoji-flat:star",
  "fluent-emoji-flat:rocket",
  "fluent-emoji-flat:direct-hit",
  "fluent-emoji-flat:department-store",
  "fluent-emoji-flat:delivery-truck",
  "fluent-emoji-flat:package",
  "fluent-emoji-flat:receipt",
  "fluent-emoji-flat:bell",
  "fluent-emoji-flat:light-bulb",
  "fluent-emoji-flat:house",
  "fluent-emoji-flat:office-building",
  "fluent-emoji-flat:hotel",
  "fluent-emoji-flat:fork-and-knife",
  "fluent-emoji-flat:microphone",
  "fluent-emoji-flat:calendar",
  "fluent-emoji-flat:money-bag",
  "fluent-emoji-flat:globe-showing-asia-australia",
];

let _pickerEl = null;
let _onPick = null;
let _current = "";
let _searchTimer = null;

function renderIcon(icon, size = 20) {
  if (!icon) return "❓";
  if (typeof icon === "string" && icon.includes(":")) {
    const isColorful = /^(fluent-emoji|twemoji|noto|emojione|openmoji)/.test(icon);
    const colorQS = isColorful ? "" : "?color=%23334155";
    return `<img src="https://api.iconify.design/${icon}.svg${colorQS}" width="${size}" height="${size}" style="vertical-align:middle;display:inline-block" alt="" loading="lazy" />`;
  }
  return `<span style="font-size:${size}px;line-height:1">${icon}</span>`;
}

function buildPicker() {
  if (_pickerEl) return _pickerEl;

  const el = document.createElement("div");
  el.id = "iconPickerModal";
  el.className = "ip-overlay";
  el.innerHTML = `
    <div class="ip-modal">
      <div class="ip-header">
        <strong>เลือก Icon</strong>
        <button class="btn-icon-sm ip-close" type="button">✕</button>
      </div>
      <div class="ip-search-wrap">
        <input class="ef-input ip-search" placeholder="🔍 ค้นหาไอคอน (เช่น user, home, star)..." />
      </div>
      <div class="ip-grid" id="ipGrid"></div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector(".ip-close").addEventListener("click", closePicker);
  el.addEventListener("click", (e) => { if (e.target === el) closePicker(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.classList.contains("show")) closePicker();
  });

  el.querySelector(".ip-search").addEventListener("input", (e) => {
    const q = e.target.value.trim();
    clearTimeout(_searchTimer);
    if (!q) { renderGrid(DEFAULT_ICONS); return; }
    _searchTimer = setTimeout(async () => {
      renderGrid([], true);
      try {
        const res = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=96&prefix=fluent-emoji-flat`);
        const data = await res.json();
        renderGrid(data.icons || []);
      } catch {
        renderGrid([]);
      }
    }, 300);
  });

  _pickerEl = el;
  return el;
}

function renderGrid(icons, loading = false) {
  const grid = document.getElementById("ipGrid");
  if (!grid) return;
  if (loading) {
    grid.innerHTML = `<div class="ip-empty">⏳ กำลังค้นหา...</div>`;
    return;
  }
  if (!icons.length) {
    grid.innerHTML = `<div class="ip-empty">ไม่พบไอคอน ลองคำอื่น</div>`;
    return;
  }
  grid.innerHTML = icons.map((ic) => {
    const html = renderIcon(ic, 22);
    const sel = ic === _current ? " ip-selected" : "";
    return `<div class="ip-opt${sel}" title="${ic}" data-icon="${ic}">${html}</div>`;
  }).join("");

  grid.querySelectorAll(".ip-opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      _current = opt.dataset.icon;
      if (_onPick) _onPick(_current);
      closePicker();
    });
  });
}

function closePicker() {
  if (_pickerEl) _pickerEl.classList.remove("show");
}

export function openIconPicker({ current = "", onPick = null } = {}) {
  const el = buildPicker();
  _current = current;
  _onPick = onPick;
  el.querySelector(".ip-search").value = "";
  renderGrid(DEFAULT_ICONS);
  el.classList.add("show");
  setTimeout(() => el.querySelector(".ip-search").focus(), 100);
}

export { renderIcon };

/* ── inject CSS once ── */
if (!document.getElementById("ip-style")) {
  const s = document.createElement("style");
  s.id = "ip-style";
  s.textContent = `
    .ip-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1100;align-items:center;justify-content:center}
    .ip-overlay.show{display:flex}
    .ip-modal{background:var(--surface,#fff);border-radius:16px;width:420px;max-width:95vw;max-height:75vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
    .ip-header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border,#e2e8f0);font-size:15px}
    .ip-search-wrap{padding:12px 18px 8px}
    .ip-search{width:100%;box-sizing:border-box}
    .ip-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;padding:8px 18px 18px;overflow-y:auto;flex:1}
    .ip-opt{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:10px;cursor:pointer;border:2px solid transparent;transition:all .15s}
    .ip-opt:hover{background:rgba(99,102,241,0.08);border-color:#c7d2fe}
    .ip-opt.ip-selected{background:#eef2ff;border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,0.2)}
    .ip-empty{grid-column:1/-1;text-align:center;padding:24px;color:var(--text3,#94a3b8);font-size:13px}
    .btn-icon-sm{width:26px;height:26px;border:1px solid var(--border,#e2e8f0);border-radius:6px;background:var(--surface,#fff);color:var(--text3,#94a3b8);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:all .15s}
    .btn-icon-sm:hover{background:#fee2e2;border-color:#ef4444;color:#ef4444}
  `;
  document.head.appendChild(s);
}
