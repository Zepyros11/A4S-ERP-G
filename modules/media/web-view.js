/* ============================================================
   web-view.js — Public website renderer (no login)
   ============================================================
   ?slug=<slug>  → เปิดหน้านั้น
   ไม่ใส่ slug   → เปิดหน้าที่ is_home = true

   แสดงเฉพาะ status = 'published' — ฉบับร่างต้องดูผ่าน editor เท่านั้น
   HTML ที่ได้ = ตัวเดียวกับ canvas ใน editor (js/shared/web-render.js)
   ============================================================ */

const CFG = window.WEB_VIEW_CONFIG || {};
/* login อยู่แล้ว (เปิดจาก editor) → ใช้ค่าใน localStorage · คนนอก → ใช้ค่าใน config */
const SB_URL = localStorage.getItem("sb_url") || CFG.sb_url || "";
const SB_KEY = localStorage.getItem("sb_key") || CFG.sb_key || "";

const show = (id) => {
  ["stateLoading", "stateEmpty"].forEach((s) => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? "block" : "none";
  });
};

async function load() {
  const slug = new URLSearchParams(location.search).get("slug");
  const q = slug ? `slug=eq.${encodeURIComponent(slug)}` : `is_home=eq.true`;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/web_pages?${q}&status=eq.published&select=title,blocks&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }
    );
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    if (!rows.length) return show("stateEmpty");

    const page = rows[0];
    document.title = page.title || "A4S Academy";
    document.getElementById("site").innerHTML = window.WebRender.page(page.blocks || []);
    show("");
    initShrink();
  } catch (e) {
    console.error(e);
    document.getElementById("stateEmpty").textContent = "โหลดหน้าไม่สำเร็จ";
    show("stateEmpty");
  }
}

/* ย่อโลโก้เมื่อเลื่อน — เฉพาะ header ที่ตั้ง data-shrink (CSS .is-shrunk อยู่ใน web-view.html) */
function initShrink() {
  const heads = [...document.querySelectorAll('.wv-header[data-shrink="1"]')];
  if (!heads.length) return;
  const onScroll = () => {
    const s = window.scrollY > 30;
    heads.forEach((h) => h.classList.toggle("is-shrunk", s));
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

load();
