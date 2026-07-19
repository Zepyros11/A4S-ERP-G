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

const sbGet = async (query) => {
  const r = await fetch(`${SB_URL}/rest/v1/web_pages?${query}`, {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

async function load() {
  const slug = new URLSearchParams(location.search).get("slug");
  const q = slug ? `slug=eq.${encodeURIComponent(slug)}` : `is_home=eq.true`;
  const L = window.WebBlocks.LAYOUT_SLUGS;
  try {
    /* ยิงพร้อมกัน — ส่วนกลางกับหน้าไม่ต้องรอกัน
       ส่วนกลางยังไม่ถูกตั้งค่า = ไม่มีแถว/blocks ว่าง → หน้าออกมาเหมือนเดิมเป๊ะ
       (ตั้งใจให้ค่อยๆ ย้ายได้ ไม่ใช่เปลี่ยนแล้วทุกหน้าพังพร้อมกัน) */
    const [rows, chrome] = await Promise.all([
      sbGet(`${q}&status=eq.published&select=title,blocks&limit=1`),
      /* ไม่กรอง status ตั้งใจ — แถวส่วนกลางสร้างเป็น published เสมอและซ่อนจากรายการหน้าเว็บ
         ไม่มีทาง toggle เป็นร่างได้ จึงไม่ต้องเช็คซ้ำ */
      sbGet(`slug=in.(${L.header},${L.footer})&select=slug,blocks`),
    ]);
    if (!rows.length) return show("stateEmpty");

    const partOf = (s) => (chrome.find((c) => c.slug === s) || {}).blocks || [];
    const page = rows[0];
    document.title = page.title || "A4S Academy";
    document.getElementById("site").innerHTML = window.WebRender.page([
      ...partOf(L.header),
      ...(page.blocks || []),
      ...partOf(L.footer),
    ]);
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
