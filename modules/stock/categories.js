/* ============================================================
   categories.js — Logic สำหรับหน้าหมวดหมู่สินค้า
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

let categories = [],
  products = [];
let selectedEmoji = "📦";
let selectedColor = "#0f4c75";

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
  // อาหารเสริม / สุขภาพ / ความงาม
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
  // โบรชัวร์ / การตลาด
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
  // บัตร / การเงิน
  "💳",
  "💰",
  "💵",
  "🏦",
  "🧾",
  "🪙",
  "💱",
  "🏧",
  "📉",
  "💹",
  "🤝",
  "📜",
  "🗃️",
  "💼",
  "📊",
  // ยานพาหนะ / โลจิสติกส์
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
  "📦",
  "🛣️",
];
const COLORS = [
  // สีเข้ม (เดิม)
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
  // Pastel 20 สี
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

async function sbFetch(table, q = "", opts = {}) {
  const { method = "GET", body } = opts;
  const res = await fetch(`${SB_URL}/rest/v1/${table}${q}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).message || "Error");
  return method !== "DELETE" ? res.json().catch(() => null) : null;
}

async function loadData() {
  if (!SB_URL || !SB_KEY) {
    renderGrid([]);
    return;
  }
  showLoading(true);
  try {
    const [cats, prods] = await Promise.all([
      sbFetch("categories", "?select=*&order=category_name"),
      sbFetch("products", "?select=product_id,category_id&is_active=eq.true"),
    ]);
    categories = cats || [];
    products = prods || [];
    renderGrid(categories);
  } catch (e) {
    showToast("โหลดไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function renderGrid(cats) {
  const grid = document.getElementById("catGrid");
  let html = "";
  cats.forEach((c) => {
    const count = products.filter(
      (p) => p.category_id === c.category_id,
    ).length;
    const color = c.color || "#0f4c75";
    const bg = color + "22";
    const lbl = c.sku_labels || {};
    const skuFmt = lbl.prefix
      ? `${lbl.prefix}-[${lbl.l2 || "?"}]-[${lbl.l3 || "?"}]-[${lbl.l4 || "?"}]-001`
      : "—";
    html += `<div class="cat-card">
      <div class="cat-card-top">
        <div class="cat-color" style="background:${bg};color:${color}">${c.icon || "📦"}</div>
        <div style="flex:1;min-width:0">
          <div class="cat-name">${c.category_name}</div>
          ${c.description ? `<div class="cat-desc">${c.description}</div>` : ""}
          <div style="font-size:11px;font-family:monospace;color:#1f2937;margin-top:4px;opacity:.8">${skuFmt}</div>
        </div>
      </div>
      <div class="cat-card-foot">
        <div><div class="cat-count">${count}</div><div class="cat-count-lbl">สินค้า</div></div>
        <div class="cat-actions">
          <button class="btn-sm btn-sm-edit" onclick="event.stopPropagation();editCategory(${c.category_id})">✏️ แก้ไข</button>
          <button class="btn-sm btn-sm-del" onclick="event.stopPropagation();deleteCategory(${c.category_id},'${c.category_name}')">🗑</button>
        </div>
      </div>
    </div>`;
  });
  // Add card
  html += `<div class="cat-add-card" onclick="openModal()"><div class="cat-add-icon">＋</div><div class="cat-add-lbl">เพิ่มหมวดหมู่ใหม่</div></div>`;
  grid.innerHTML = html;
}

function buildPickers() {
  const ep = document.getElementById("emojiPicker");
  ep.innerHTML = EMOJIS.map(
    (e) =>
      `<div class="emoji-opt ${e === selectedEmoji ? "selected" : ""}" onclick="selectEmoji('${e}')">${e}</div>`,
  ).join("");
  const cp = document.getElementById("colorPicker");
  cp.innerHTML = COLORS.map(
    (c) =>
      `<div class="color-opt ${c === selectedColor ? "selected" : ""}" style="background:${c}" onclick="selectColor('${c}')"></div>`,
  ).join("");
  updateCatPreview();
}

function selectEmoji(e) {
  selectedEmoji = e;
  buildPickers();
}
function selectColor(c) {
  selectedColor = c;
  buildPickers();
}

function updateCatPreview() {
  const name = document.getElementById("fName")?.value || "ชื่อหมวดหมู่";
  const desc = document.getElementById("fDesc")?.value || "คำอธิบาย";
  const icon = selectedEmoji || "📦";
  const color = selectedColor || "#0f4c75";
  const pi = document.getElementById("prevIcon");
  const pn = document.getElementById("prevName");
  const pd = document.getElementById("prevDesc");
  if (pi) {
    pi.textContent = icon;
    pi.style.background = color + "22";
    pi.style.color = color;
  }
  if (pn) {
    pn.textContent = name || "ชื่อหมวดหมู่";
  }
  if (pd) {
    pd.textContent = desc || "—";
  }
}

function updateSkuPreview() {
  const f1 = (document.getElementById("skuF1")?.value || "XXX").toUpperCase();
  const l2 = document.getElementById("skuL2")?.value || "?";
  const l3 = document.getElementById("skuL3")?.value || "?";
  const l4 = document.getElementById("skuL4")?.value || "?";
  const prev = document.getElementById("skuPreview");
  const ex = document.getElementById("skuExample");
  if (prev) prev.textContent = `${f1}-[${l2}]-[${l3}]-[${l4}]-001`;
  if (ex)
    ex.textContent = `${f1}-${l2.substring(0, 4).toUpperCase() || "TYPE"}-${l3.substring(0, 4).toUpperCase() || "COL"}-${l4.substring(0, 4).toUpperCase() || "SZ"}-001`;
}

function openModal(data = null) {
  document.getElementById("modalTitle").textContent = data
    ? "แก้ไขหมวดหมู่"
    : "เพิ่มหมวดหมู่ใหม่";
  document.getElementById("editId").value = data?.category_id || "";
  document.getElementById("fName").value = data?.category_name || "";
  document.getElementById("fDesc").value = data?.description || "";
  selectedEmoji = data?.icon || "📦";
  selectedColor = data?.color || "#0f4c75";

  // SKU fields
  const labels = data?.sku_labels || { prefix: "", l2: "", l3: "", l4: "" };
  document.getElementById("skuF1").value = labels.prefix || "";
  document.getElementById("skuL2").value = labels.l2 || "";
  document.getElementById("skuL3").value = labels.l3 || "";
  document.getElementById("skuL4").value = labels.l4 || "";
  updateSkuPreview();

  buildPickers();
  updateCatPreview();
  document.getElementById("modalOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fName").focus(), 100);
}

function editCategory(id) {
  openModal(categories.find((c) => c.category_id === id));
}
function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}
function closeModalBg(e) {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
}

async function saveCategory() {
  const name = document.getElementById("fName").value.trim();
  if (!name) {
    showToast("กรุณากรอกชื่อหมวดหมู่", "error");
    return;
  }
  if (!SB_URL || !SB_KEY) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "error");
    return;
  }

  const skuLabels = {
    prefix: document.getElementById("skuF1").value.trim().toUpperCase() || null,
    l2: document.getElementById("skuL2").value.trim() || null,
    l3: document.getElementById("skuL3").value.trim() || null,
    l4: document.getElementById("skuL4").value.trim() || null,
  };
  const payload = {
    category_name: name,
    description: document.getElementById("fDesc").value.trim() || null,
    icon: selectedEmoji,
    color: selectedColor,
    sku_labels: skuLabels,
  };
  showLoading(true);
  try {
    const editId = document.getElementById("editId").value;
    if (editId) {
      await sbFetch("categories", `?category_id=eq.${editId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("✅ แก้ไขหมวดหมู่สำเร็จ!", "success");
    } else {
      await sbFetch("categories", "", { method: "POST", body: payload });
      showToast("✅ เพิ่มหมวดหมู่สำเร็จ!", "success");
    }
    closeModal();
    await loadData();
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  }
  showLoading(false);
}

async function deleteCategory(id, name) {
  const count = products.filter((p) => p.category_id === id).length;
  if (count > 0) {
    showToast(`ไม่สามารถลบได้ มีสินค้า ${count} รายการในหมวดนี้`, "error");
    return;
  }
  if (!confirm(`ลบหมวดหมู่ "${name}"?`)) return;
  showLoading(true);
  try {
    await sbFetch("categories", `?category_id=eq.${id}`, { method: "DELETE" });
    showToast("ลบหมวดหมู่แล้ว", "success");
    await loadData();
  } catch (e) {
    showToast("ลบไม่ได้: " + e.message, "error");
  }
  showLoading(false);
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

window.addEventListener("DOMContentLoaded", () => {
  if (SB_URL && SB_KEY) loadData();
  else renderGrid([]);
});
