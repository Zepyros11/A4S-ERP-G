/* =====================================================
   categories-form.js
   Form Controller — Category Modal
===================================================== */

/* ================================
   STATE
================================ */

let selectedEmoji = "📦";
let selectedColor = "#0f4c75";

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

  buildPickers();
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
   SAVE — dispatch event ให้ list รับ
================================ */

window.saveCategoryForm = function () {
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
  };

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
