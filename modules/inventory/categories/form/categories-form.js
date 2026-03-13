/* =====================================================
   categories-form.js
   Form Controller — Category Modal
===================================================== */

/* ================================
   STATE
================================ */

let selectedEmoji = "📦";
let selectedColor = "#0f4c75";
let skuSegments = [{ label: "", locked: false }];

/* ================================
   CONSTANTS
================================ */

const EMOJIS = [
  // เทคโนโลยี / อุปกรณ์
  "📦",
  "🖥️",
  "📱",
  "🖨️",
  "📷",
  "⌨️",
  "🖱️",
  "💾",
  "📡",
  "🔋",
  "🔌",
  "📺",
  "⌚",
  "🎮",
  "🎧",
  // เครื่องมือ / อุตสาหกรรม
  "🔧",
  "🔩",
  "🪛",
  "🔨",
  "⚙️",
  "🧰",
  "🏗️",
  "🔬",
  "🧲",
  "⚡",
  "💡",
  "🔦",
  "🪝",
  "🪜",
  "🛠️",
  // เกษตร / อาหาร / ธรรมชาติ
  "🌾",
  "🌿",
  "🪴",
  "🌱",
  "🍎",
  "🥦",
  "🌽",
  "🐄",
  "🚜",
  "🌻",
  "🍃",
  "🫘",
  "🥬",
  "🌳",
  "🐓",
  // สุขภาพ / ความงาม
  "💊",
  "🧪",
  "💉",
  "🩺",
  "🧴",
  "💄",
  "🪥",
  "🧼",
  "💅",
  "🌸",
  "🫧",
  "🩹",
  "🧬",
  "🏥",
  "🫀",
  // เสื้อผ้า / แฟชั่น
  "👕",
  "👗",
  "👔",
  "👒",
  "👟",
  "👜",
  "🧣",
  "🧤",
  "🧥",
  "👑",
  "💎",
  "🕶️",
  "🧢",
  "👠",
  "🎀",
  // รางวัล / ของที่ระลึก
  "🏆",
  "🥇",
  "🎖️",
  "🎗️",
  "🏅",
  "🌟",
  "⭐",
  "🎁",
  "🎊",
  "🎉",
  "🪙",
  "🔖",
  "🎯",
  "🪄",
  "🎪",
  // เอกสาร / สำนักงาน
  "📄",
  "📁",
  "📂",
  "📋",
  "📊",
  "📈",
  "📝",
  "✏️",
  "🖊️",
  "📎",
  "📌",
  "📏",
  "📐",
  "🗂️",
  "📑",
  // การตลาด
  "📰",
  "🗞️",
  "📣",
  "📢",
  "🪧",
  "🎬",
  "🖼️",
  "🗓️",
  "💬",
  "📩",
  "📬",
  "🏷️",
  "🔍",
  "📲",
  "📮",
  // ของใช้ในบ้าน
  "🏠",
  "🛋️",
  "🪑",
  "🛏️",
  "🚿",
  "🍳",
  "🥄",
  "🔑",
  "🪞",
  "🕯️",
  "🧺",
  "🪣",
  "🚪",
  "🪟",
  "🧹",
  // การเงิน
  "💳",
  "💰",
  "💵",
  "🏦",
  "🧾",
  "💱",
  "🏧",
  "📉",
  "💹",
  "🤝",
  "📜",
  "🗃️",
  "💼",
  // โลจิสติกส์
  "🚗",
  "🚚",
  "✈️",
  "🚢",
  "🛵",
  "🚲",
  "🚁",
  "🚉",
  "⛽",
  "🛞",
  "🗺️",
  "📍",
  "🚦",
  "🛣️",
];

const COLORS = [
  // เข้ม
  "#0f4c75",
  "#057a55",
  "#9b1c1c",
  "#92400e",
  "#6d28d9",
  "#0e7490",
  "#1d4ed8",
  "#be185d",
  "#374151",
  "#b45309",
  // Pastel
  "#93c5fd",
  "#6ee7b7",
  "#fca5a5",
  "#fdba74",
  "#c4b5fd",
  "#67e8f9",
  "#86efac",
  "#f9a8d4",
  "#fde68a",
  "#a5b4fc",
  "#bfdbfe",
  "#bbf7d0",
  "#fecaca",
  "#fed7aa",
  "#ddd6fe",
  "#cffafe",
  "#dcfce7",
  "#fce7f3",
  "#fef9c3",
  "#e0e7ff",
];

/* ================================
   OPEN / CLOSE MODAL
================================ */

export function openCategoryModal(data = null) {
  const modal = document.getElementById("categoryModal");
  if (!modal) return;

  /* reset state */
  selectedEmoji = data?.icon || "📦";
  selectedColor = data?.color || "#0f4c75";

  /* fill fields */
  document.getElementById("categoryModalTitle").textContent = data
    ? "แก้ไขหมวดหมู่"
    : "เพิ่มหมวดหมู่ใหม่";

  document.getElementById("categoryEditId").value = data?.category_id || "";
  document.getElementById("categoryName").value = data?.category_name || "";
  document.getElementById("categoryDesc").value = data?.description || "";

  /* SKU */
  const labels = data?.sku_labels || {};
  document.getElementById("skuPrefix").value = labels.prefix || "";

  skuSegments = labels.segments?.length
    ? labels.segments.map((s) =>
        typeof s === "string" ? { label: s, locked: false } : s,
      )
    : [{ label: "", locked: false }];

  buildPickers();
  renderSegments();
  updateCategoryPreview();

  modal.classList.add("open");
}

export function closeCategoryModal() {
  document.getElementById("categoryModal")?.classList.remove("open");
}

/* expose ให้ onclick ใน HTML ใช้ได้ */
window.closeCategoryModal = closeCategoryModal;

/* ================================
   EMOJI + COLOR PICKERS
================================ */

function buildPickers() {
  /* Emoji */
  document.getElementById("emojiPicker").innerHTML = EMOJIS.map(
    (e) => `<div
      class="emoji-opt ${e === selectedEmoji ? "selected" : ""}"
      onclick="selectEmoji('${e}')">${e}</div>`,
  ).join("");

  /* Color */
  document.getElementById("colorPicker").innerHTML = COLORS.map(
    (c) => `<div
      class="color-opt ${c === selectedColor ? "selected" : ""}"
      style="background:${c}"
      onclick="selectColor('${c}')"></div>`,
  ).join("");
}

window.selectEmoji = function (e) {
  selectedEmoji = e;
  buildPickers();
  updateCategoryPreview();
};

window.selectColor = function (c) {
  selectedColor = c;
  buildPickers();
  updateCategoryPreview();
};

/* ================================
   PREVIEW CARD
================================ */

window.updateCategoryPreview = function () {
  const name = document.getElementById("categoryName")?.value || "ชื่อหมวดหมู่";
  const desc = document.getElementById("categoryDesc")?.value || "—";
  const icon = document.getElementById("prevIcon");
  const pName = document.getElementById("prevName");
  const pDesc = document.getElementById("prevDesc");

  if (icon) {
    icon.textContent = selectedEmoji;
    icon.style.background = selectedColor + "22";
    icon.style.color = selectedColor;
  }
  if (pName) {
    pName.textContent = name;
  }
  if (pDesc) {
    pDesc.textContent = desc;
  }
};

/* ================================
   SKU SEGMENTS
================================ */

window.addSegment = function () {
  syncSegmentInputs();
  if (skuSegments.length >= 6) {
    showFormToast("เพิ่มได้สูงสุด 6 ช่อง", "warning");
    return;
  }
  skuSegments.push({ label: "", locked: false });
  renderSegments();
};

window.removeSegment = function (i) {
  if (skuSegments.length <= 1) return;
  skuSegments.splice(i, 1);
  renderSegments();
};

window.toggleLock = function (i) {
  syncSegmentInputs();
  skuSegments[i].locked = !skuSegments[i].locked;
  renderSegments();
};

window.updateSegment = function (i, val) {
  skuSegments[i].label = val;
  updateSkuPreview();
};

function renderSegments() {
  const wrap = document.getElementById("segmentContainer");
  if (!wrap) return;

  wrap.innerHTML = "";

  skuSegments.forEach((seg, i) => {
    const label = seg.label || "";
    const locked = seg.locked || false;

    const row = document.createElement("div");
    row.className = "form-group";
    row.innerHTML = `
      <label class="form-label">ช่อง ${i + 2}</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input
          class="form-control"
          value="${label}"
          placeholder="เช่น Type / Color / Size"
          oninput="updateSegment(${i}, this.value)"
        />
        <button type="button" class="btn-icon" onclick="toggleLock(${i})" title="ล็อค Segment">
          ${locked ? "🔒" : "🔓"}
        </button>
        ${
          i === 0
            ? ""
            : `
          <button class="btn-icon danger" onclick="removeSegment(${i})">🗑</button>
        `
        }
      </div>
    `;
    wrap.appendChild(row);
  });

  updateSkuPreview();
}

/* ================================
   SKU PREVIEW
================================ */

window.updateSkuPreview = function () {
  syncSegmentInputs();

  const prefix = (
    document.getElementById("skuPrefix")?.value || "XXX"
  ).toUpperCase();

  const segPreview = skuSegments.map((s) => `[${s.label || "?"}]`).join("-");

  const segExample = skuSegments
    .map((s) => (s.label || "X").substring(0, 4).toUpperCase())
    .join("-");

  const prev = document.getElementById("skuPreview");
  const ex = document.getElementById("skuExample");

  if (prev) prev.textContent = `${prefix}-${segPreview}-001`;
  if (ex) ex.textContent = `${prefix}-${segExample}-001`;
};

/* ================================
   SYNC INPUTS → STATE
================================ */

function syncSegmentInputs() {
  const inputs =
    document.getElementById("segmentContainer")?.querySelectorAll("input") ||
    [];

  inputs.forEach((el, idx) => {
    if (skuSegments[idx]) skuSegments[idx].label = el.value;
  });
}

/* ================================
   SAVE — dispatch event ให้ list รับ
================================ */

// แก้ — แยก id ออก ไม่ส่งติดไปใน payload
window.saveCategoryForm = function () {
  syncSegmentInputs();

  const name = document.getElementById("categoryName")?.value.trim();
  if (!name) {
    showFormToast("กรุณากรอกชื่อหมวดหมู่", "error");
    return;
  }

  const editId = document.getElementById("categoryEditId")?.value || null;

  const payload = {
    category_name: name,
    description: document.getElementById("categoryDesc")?.value.trim() || null,
    icon: selectedEmoji,
    color: selectedColor,
    sku_labels: {
      prefix:
        document
          .getElementById("skuPrefix")
          ?.value.toUpperCase()
          .replace(/[^A-Z]/g, "")
          .trim() || null,
      segments: skuSegments
        .map((s) => ({ label: s.label.trim(), locked: s.locked || false }))
        .filter((s) => s.label),
    },
  };

  // ส่ง id แยกต่างหาก ไม่รวมใน payload
  window.dispatchEvent(
    new CustomEvent("category-saved", {
      detail: { ...payload, category_id: editId },
    }),
  );

  closeCategoryModal();
};

/* ================================
   TOAST (local — ใช้ภายใน form)
================================ */

function showFormToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
