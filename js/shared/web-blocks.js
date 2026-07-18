/* ============================================================
   web-blocks.js — Block Contract (catalog กลางของ Website Builder)
   ============================================================
   นี่คือ "สัญญา" ที่ editor / renderer / theme ใช้ร่วมกัน
   เพิ่ม block ชนิดใหม่ = เพิ่มที่นี่ที่เดียว → palette + properties panel
   + renderer อัปเดตตาม (renderer ต้องเพิ่ม case ใน web-render.js)

   field types:
     text     — input บรรทัดเดียว
     textarea — ข้อความหลายบรรทัด
     image    — URL รูป + ปุ่มอัปโหลด (Drive)
     list     — repeater (array ของ object) — ใช้ itemFields กำหนดคอลัมน์

   ทุก block = แถบเต็มความกว้าง 1 แถว (full-width band)

   wire = ภาพจำลองโครงสร้าง (wireframe) โชว์ในแผงเครื่องมือของ editor
   ทำไมไม่ย่อ block จริงมาโชว์: ย่อ 1200px ลงเหลือ ~250px = scale 0.2
   ตัวอักษรเหลือ 3px อ่านไม่ออก กลายเป็นรอยเปื้อน · wireframe วาดที่ 120×44
   ให้เห็น "โครง" ชัดที่ขนาดเล็ก · ต้องอัปเดตเองถ้าเปลี่ยนหน้าตา block
   ============================================================ */

window.WebBlocks = (() => {
  /* สีแบรนด์ A4S — ใช้เป็นปุ่มสีในช่อง swatch (สีข้อความส่วนหัว) */
  const BRAND_COLORS = ["#16240f", "#71bf44", "#3B6D11", "#7c8a72"];
  /* preset ขนาดตัวอักษร (px) สำหรับปุ่ม S/M/L/XL ใน TextSetting
     sizeMode "custom" = ค่าที่ไม่ตรง preset ไหน (derive จาก size ไม่เก็บ state แยก) */
  const SIZE_PRESETS = { s: 16, m: 22, l: 30, xl: 44 };

  /* หมวดของเครื่องมือ — แผงซ้ายโชว์หมวดก่อน กดแล้วค่อยสไลด์ไปดูบล็อกข้างใน
     block ใหม่ต้องมี group ตรงกับ key ใดใน GROUPS ไม่งั้นจะไม่โผล่ในแผง */
  const GROUPS = [
    { key: "layout",  label: "โครงสร้าง (Structure)",       icon: "🧱", hint: "ส่วนหัว · เมนู · ส่วนท้าย" },
    { key: "content", label: "เนื้อหา (Content)",           icon: "📰", hint: "ข่าวเด่น · ข่าวหลัก" },
    { key: "list",    label: "รายการข้อมูล (Lists & Details)", icon: "🔲", hint: "สินค้า · กิจกรรม · ดาวน์โหลด" },
    { key: "cta",     label: "Call to Action",             icon: "🎯", hint: "แบนเนอร์เรียกให้สมัคร" },
  ];

  const CATALOG = [
    {
      type: "site_header",
      group: "layout",
      label: "ส่วนหัว (โลโก้+ภาษา)",
      icon: "🏷️",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="8" y="13" width="16" height="18" rx="3" fill="#71bf44"/><rect x="28" y="14" width="28" height="7" rx="2" fill="#16240f"/><rect x="28" y="25" width="20" height="4" rx="2" fill="#c3cbba"/><rect x="76" y="17" width="13" height="9" rx="4.5" fill="#71bf44"/><rect x="92" y="17" width="10" height="9" rx="4.5" fill="#dfe4d8"/><rect x="105" y="17" width="10" height="9" rx="4.5" fill="#dfe4d8"/></svg>`,
      /* fields มี section marker → editor render เป็นหัวข้อกลุ่ม + แถวแนวนอน (label ซ้าย/ตัวคุมขวา)
         บล็อกอื่นที่ไม่มี section ยังใช้ layout เดิม (แนวตั้ง) ไม่กระทบ */
      fields: [
        { section: "เนื้อหา" },
        /* bucket = company-assets → uploadViaRest ส่งขึ้น Supabase Storage (ไม่อยู่ใน DRIVE_BUCKETS)
           keepAlpha → ได้ PNG พื้นใส · maxDim 600 พอสำหรับโลโก้ */
        {
          key: "logo", label: "โลโก้", type: "image",
          bucket: "company-assets", keepAlpha: true, maxDim: 600,
        },
        /* optionsFrom pages → editor เติม dropdown จากหน้าเว็บที่มีจริง (คลิกโลโก้ไปหน้านั้น) */
        { key: "logoLink", label: "ลิงก์โลโก้", type: "select", optionsFrom: "pages", row: true },

        /* TextSetting = ชุดตั้งค่าข้อความรวม (ข้อความ+ขนาด+น้ำหนัก+สี+จัดวาง) พับได้
           ใช้ซ้ำ 3 ตัว · map = ผูกแต่ละส่วนเข้ากับ prop key เดิมที่บันทึกอยู่แล้ว (ไม่รื้อเป็น nested) */
        { type: "textsetting", label: "ชื่อแบรนด์", swatches: BRAND_COLORS, min: 10, max: 90,
          map: { text: "brand", size: "brandSize", color: "brandColor", weight: "brandWeight", align: "brandAlign" } },
        { type: "textsetting", label: "คำที่เน้นสี", swatches: BRAND_COLORS, min: 10, max: 90,
          map: { text: "brandAccent", size: "accentSize", color: "accentColor", weight: "accentWeight", align: "accentAlign" } },
        { type: "textsetting", label: "Tagline", swatches: BRAND_COLORS, min: 8, max: 90,
          map: { text: "tagline", size: "taglineSize", color: "taglineColor", weight: "taglineWeight", align: "taglineAlign" } },

        { key: "showLangs", label: "แสดงตัวเลือกภาษา", type: "toggle", row: true },
        {
          key: "langs", label: "ภาษาที่แสดง", type: "list",
          itemFields: [
            { key: "code", label: "ภาษา", type: "text", half: true },
            { key: "active", label: "ใช้อยู่", type: "toggle", half: true, exclusive: true },
          ],
        },

        { section: "สไตล์" },
        { key: "logoPos", label: "ตำแหน่งโลโก้", type: "segment", row: true,
          options: [{ value: "left", label: "ซ้าย" }, { value: "center", label: "กลาง" }] },
        { key: "bgColor", label: "สีพื้นหลัง", type: "color", row: true },
        { key: "height", label: "ความสูง", type: "range", row: true, min: 48, max: 160, step: 2, unit: "px" },
        { key: "showBorder", label: "เส้นขอบล่าง", type: "toggle", row: true },

        { section: "พฤติกรรม" },
        { key: "sticky", label: "ปักหมุดเมื่อเลื่อน (Sticky)", type: "toggle", row: true },
        { key: "shrinkOnScroll", label: "ย่อโลโก้เมื่อเลื่อน", type: "toggle", row: true },
        { key: "hideMobile", label: "ซ่อนบนมือถือ", type: "toggle", row: true },
      ],
      defaults: {
        logo: "", logoLink: "home",
        /* weight/align = state ใหม่ (ของเดิมไม่มี) · หน้าเก่า withDefaults เติมให้
           ตั้ง brand/accent = bold รักษาหน้าตาเดิม (ไม่ทำตาม GPT ที่ default normal ทั้งหมด — ไม่งั้นแบรนด์บางลง) */
        brand: "A4S", brandSize: 30, brandColor: "#16240f", brandWeight: "bold", brandAlign: "left",
        brandAccent: "Academy", accentSize: 30, accentColor: "#71bf44", accentWeight: "bold", accentAlign: "left",
        tagline: "Make a Life, Not Just a Living!",
        taglineSize: 13, taglineColor: "#7c8a72", taglineWeight: "normal", taglineAlign: "left",
        showLangs: true,
        langs: [
          { code: "ไทย", active: true },
          { code: "EN", active: false },
          { code: "FR", active: false },
        ],
        logoPos: "left", bgColor: "#ffffff", height: 90, showBorder: true,
        sticky: false, shrinkOnScroll: false, hideMobile: false,
      },
    },
    {
      type: "nav_bar",
      group: "layout",
      label: "แถบเมนู",
      icon: "🧭",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#16240f"/><rect x="8" y="19" width="15" height="5" rx="2" fill="#fff"/><rect x="27" y="19" width="12" height="5" rx="2" fill="#c3cbba"/><rect x="43" y="19" width="12" height="5" rx="2" fill="#c3cbba"/><rect x="59" y="19" width="12" height="5" rx="2" fill="#c3cbba"/><rect x="86" y="15" width="28" height="13" rx="3" fill="#71bf44"/></svg>`,
      fields: [
        {
          key: "items", label: "เมนู", type: "list",
          itemFields: [
            { key: "label", label: "ชื่อเมนู", type: "text", half: true },
            { key: "active", label: "หน้าปัจจุบัน", type: "toggle", half: true, exclusive: true },
          ],
        },
        { key: "ctaText", label: "ปุ่มขวา (CTA)", type: "text" },
      ],
      defaults: {
        items: [
          { label: "หน้าแรก", active: true },
          { label: "ข่าวสาร", active: false },
          { label: "สินค้า", active: false },
          { label: "กิจกรรม", active: false },
          { label: "บทเรียนออนไลน์", active: false },
          { label: "ดาวน์โหลด", active: false },
        ],
        ctaText: "สมัครเป็นสปอนเซอร์ →",
      },
    },
    {
      type: "ticker",
      group: "content",
      label: "แถบข่าวเด่น",
      icon: "📢",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="8" y="17" width="18" height="10" rx="2.5" fill="#1c3d12"/><rect x="31" y="20" width="81" height="4" rx="2" fill="#c3cbba"/></svg>`,
      fields: [
        { key: "label", label: "ป้าย", type: "text" },
        { key: "text", label: "ข้อความ", type: "textarea" },
      ],
      defaults: {
        label: "ข่าวเด่น",
        text: "ผู้นำต้องเริ่มก่อนเสมอ · คลื่นลูกใหม่แห่งอนาคต · การเป็นสปอนเซอร์มืออาชีพ (ภาค 3)",
      },
    },
    {
      type: "hero_news",
      group: "content",
      label: "ข่าวหลัก + หมวดหมู่",
      icon: "📰",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#f6f7f3"/><rect x="6" y="5" width="62" height="21" rx="2" fill="#dbe6d2"/><rect x="6" y="29" width="46" height="5" rx="2" fill="#16240f"/><rect x="6" y="37" width="56" height="3" rx="1.5" fill="#c3cbba"/><g fill="#fff" stroke="#e0e5d9" stroke-width="0.8"><rect x="74" y="5" width="41" height="11" rx="2"/><rect x="74" y="18" width="41" height="11" rx="2"/><rect x="74" y="31" width="41" height="11" rx="2"/></g><g fill="#e4ece0"><rect x="76.5" y="7.5" width="8" height="6" rx="1"/><rect x="76.5" y="20.5" width="8" height="6" rx="1"/><rect x="76.5" y="33.5" width="8" height="6" rx="1"/></g><g fill="#c3cbba"><rect x="87" y="9" width="25" height="3" rx="1.5"/><rect x="87" y="22" width="25" height="3" rx="1.5"/><rect x="87" y="35" width="25" height="3" rx="1.5"/></g></svg>`,
      fields: [
        { key: "sectionTitle", label: "หัวข้อฝั่งซ้าย", type: "text" },
        { key: "sidebarTitle", label: "หัวข้อฝั่งขวา", type: "text" },
        { key: "image", label: "ภาพข่าวหลัก", type: "image" },
        { key: "category", label: "หมวด", type: "text" },
        { key: "title", label: "พาดหัว", type: "textarea" },
        { key: "excerpt", label: "คำโปรย", type: "textarea" },
        { key: "meta", label: "ผู้เขียน · วันที่", type: "text" },
        {
          key: "items", label: "รายการข่าวฝั่งขวา", type: "list",
          itemFields: [
            { key: "category", label: "หมวด", type: "text" },
            { key: "title", label: "หัวข้อ", type: "text" },
            { key: "image", label: "ภาพ", type: "image" },
          ],
        },
      ],
      defaults: {
        sectionTitle: "ข่าวหลัก", sidebarTitle: "หมวดหมู่ข่าว",
        image: "", category: "ธุรกิจ",
        title: "People Join People — สร้างเครือข่ายที่เริ่มจากความสัมพันธ์ ไม่ใช่แค่ตัวเลข",
        excerpt: "แนวคิดการเป็นผู้นำที่คนรุ่นใหม่ควรรู้ ก่อนจะก้าวเข้าสู่โลกของธุรกิจขายตรงอย่างมืออาชีพ",
        meta: "admin · มิถุนายน 21, 2025",
        items: [
          { category: "ธุรกิจ", title: "โอกาสที่มองไม่เห็นด้วยตา แต่รู้สึกได้ด้วยใจ", image: "" },
          { category: "ผลิตภัณฑ์", title: "ดูแลสุขภาพของคุณด้วยรอยัล ออยล์ ทุกวัน", image: "" },
          { category: "กิจกรรม", title: "พาวเวอร์พอยต์ท่องเที่ยวเยอรมนี 2026", image: "" },
          { category: "การท่องเที่ยว", title: "ตามล่าแสงเหนือ ณ ออโรร่า", image: "" },
        ],
      },
    },
    {
      type: "product_grid",
      group: "list",
      label: "กริดสินค้า (4 ช่อง)",
      icon: "🛍️",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="6" y="5" width="26" height="4" rx="2" fill="#16240f"/><rect x="100" y="5" width="14" height="4" rx="2" fill="#71bf44"/><g fill="#e4ece0"><rect x="6" y="13" width="25" height="19" rx="2"/><rect x="35" y="13" width="25" height="19" rx="2"/><rect x="64" y="13" width="25" height="19" rx="2"/><rect x="93" y="13" width="21" height="19" rx="2"/></g><g fill="#c3cbba"><rect x="6" y="35" width="20" height="3" rx="1.5"/><rect x="35" y="35" width="20" height="3" rx="1.5"/><rect x="64" y="35" width="20" height="3" rx="1.5"/><rect x="93" y="35" width="18" height="3" rx="1.5"/></g></svg>`,
      fields: [
        { key: "title", label: "หัวข้อ", type: "text" },
        { key: "linkText", label: "ลิงก์มุมขวา", type: "text" },
        {
          key: "items", label: "สินค้า", type: "list",
          itemFields: [
            { key: "title", label: "ชื่อสินค้า", type: "text" },
            { key: "image", label: "ภาพ", type: "image" },
          ],
        },
      ],
      defaults: {
        title: "สินค้า & ผลิตภัณฑ์", linkText: "ดูทั้งหมด →",
        items: [
          { title: "ผลิตภัณฑ์เพื่อการเกษตร 4Tree", image: "" },
          { title: "รอยัล ออยล์ ดูแลสุขภาพ", image: "" },
          { title: "ผลิตภัณฑ์กลุ่ม 4Life", image: "" },
          { title: "กาแฟอะโลฮ่า ซี", image: "" },
        ],
      },
    },
    {
      type: "event_lessons",
      group: "list",
      label: "กิจกรรม + บทเรียน (2 คอลัมน์)",
      icon: "📅",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#f6f7f3"/><rect x="6" y="4" width="24" height="4" rx="2" fill="#16240f"/><rect x="64" y="4" width="24" height="4" rx="2" fill="#16240f"/><g fill="#fff" stroke="#e0e5d9" stroke-width="0.8"><rect x="6" y="12" width="50" height="13" rx="2"/><rect x="6" y="28" width="50" height="13" rx="2"/><rect x="64" y="12" width="50" height="13" rx="2"/><rect x="64" y="28" width="50" height="13" rx="2"/></g><g fill="#16240f"><rect x="9" y="15" width="9" height="7" rx="1.5"/><rect x="9" y="31" width="9" height="7" rx="1.5"/></g><g fill="#e4ece0"><rect x="67" y="15" width="11" height="7" rx="1.5"/><rect x="67" y="31" width="11" height="7" rx="1.5"/></g><g fill="#c3cbba"><rect x="21" y="17" width="32" height="3" rx="1.5"/><rect x="21" y="33" width="32" height="3" rx="1.5"/><rect x="81" y="17" width="31" height="3" rx="1.5"/><rect x="81" y="33" width="31" height="3" rx="1.5"/></g></svg>`,
      fields: [
        { key: "leftTitle", label: "หัวข้อฝั่งซ้าย", type: "text" },
        { key: "rightTitle", label: "หัวข้อฝั่งขวา", type: "text" },
        {
          key: "events", label: "กิจกรรม", type: "list",
          itemFields: [
            { key: "day", label: "วันที่", type: "text" },
            { key: "month", label: "เดือน", type: "text" },
            { key: "title", label: "ชื่องาน", type: "text" },
            { key: "sub", label: "คำอธิบาย", type: "text" },
          ],
        },
        {
          key: "lessons", label: "บทเรียน", type: "list",
          itemFields: [
            { key: "title", label: "ชื่อบทเรียน", type: "text" },
            { key: "sub", label: "คำอธิบาย", type: "text" },
            { key: "image", label: "ภาพปก", type: "image" },
          ],
        },
      ],
      defaults: {
        leftTitle: "กิจกรรม & อีเวนต์", rightTitle: "บทเรียนออนไลน์",
        events: [
          { day: "01", month: "ต.ค.", title: "Reward Trip ท่องเที่ยวเยอรมนี 2026", sub: "สำหรับผู้นำระดับ Ultimate Leaders" },
          { day: "22", month: "มิ.ย.", title: "ตามล่าแสงเหนือ ณ ออโรร่า", sub: "ทริปพิเศษสำหรับสมาชิก A4S" },
        ],
        lessons: [
          { title: "สไลด์บรรยาย 4Tree โดย อ. โก พัสกร", sub: "บทเรียน · 12 นาที", image: "" },
          { title: "คู่มือการใช้ 4Tree พร้อมกับ Booster", sub: "บทเรียน · 18 นาที", image: "" },
        ],
      },
    },
    {
      type: "download_grid",
      group: "list",
      label: "กริดดาวน์โหลด",
      icon: "📥",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="6" y="5" width="26" height="4" rx="2" fill="#16240f"/><rect x="98" y="5" width="16" height="4" rx="2" fill="#71bf44"/><g fill="#fff" stroke="#e0e5d9" stroke-width="0.8"><rect x="6" y="13" width="25" height="26" rx="2"/><rect x="35" y="13" width="25" height="26" rx="2"/><rect x="64" y="13" width="25" height="26" rx="2"/><rect x="93" y="13" width="21" height="26" rx="2"/></g><g fill="#eef4ea"><rect x="9" y="16" width="8" height="8" rx="2"/><rect x="38" y="16" width="8" height="8" rx="2"/><rect x="67" y="16" width="8" height="8" rx="2"/><rect x="96" y="16" width="8" height="8" rx="2"/></g><g fill="#c3cbba"><rect x="9" y="28" width="18" height="3" rx="1.5"/><rect x="38" y="28" width="18" height="3" rx="1.5"/><rect x="67" y="28" width="18" height="3" rx="1.5"/><rect x="96" y="28" width="15" height="3" rx="1.5"/></g></svg>`,
      fields: [
        { key: "title", label: "หัวข้อ", type: "text" },
        { key: "linkText", label: "ลิงก์มุมขวา", type: "text" },
        {
          key: "items", label: "ไฟล์", type: "list",
          itemFields: [
            { key: "type", label: "ชนิด (PDF/PPT/IMG/VDO)", type: "text" },
            { key: "title", label: "ชื่อ", type: "text" },
            { key: "sub", label: "วันที่อัปเดต", type: "text" },
          ],
        },
      ],
      defaults: {
        title: "ดาวน์โหลด & สื่อ", linkText: "ประเภทไฟล์ทั้งหมด →",
        items: [
          { type: "PDF", title: "เอกสาร & โบรชัวร์", sub: "อัปเดต ก.ค. 18, 2025" },
          { type: "PPT", title: "รวมไฟล์นำเสนอ", sub: "อัปเดต มิ.ย. 20, 2025" },
          { type: "IMG", title: "รวมภาพต่างๆ", sub: "อัปเดต มิ.ย. 20, 2025" },
          { type: "VDO", title: "วิดีโอต่างๆ", sub: "อัปเดต มิ.ย. 20, 2025" },
        ],
      },
    },
    {
      type: "cta_banner",
      group: "cta",
      label: "แบนเนอร์ CTA",
      icon: "🎯",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#f6f7f3"/><rect x="6" y="6" width="108" height="32" rx="4" fill="#16240f"/><rect x="12" y="15" width="40" height="5" rx="2" fill="#fff"/><rect x="12" y="24" width="50" height="3" rx="1.5" fill="#8fa382"/><rect x="72" y="17" width="20" height="10" rx="2.5" fill="#71bf44"/><rect x="95" y="17" width="15" height="10" rx="2.5" fill="none" stroke="#3d5a30" stroke-width="1"/></svg>`,
      fields: [
        { key: "title", label: "หัวข้อ", type: "text" },
        { key: "sub", label: "คำอธิบาย", type: "textarea" },
        { key: "primaryText", label: "ปุ่มหลัก", type: "text" },
        { key: "secondaryText", label: "ปุ่มรอง", type: "text" },
      ],
      defaults: {
        title: "พร้อมเริ่มธุรกิจกับ A4S แล้วหรือยัง?",
        sub: "รับข่าวสาร ค้นหาข้อมูล และสมัครเป็นสปอนเซอร์เข้าบริษัทได้ในที่เดียว",
        primaryText: "สมัครเป็นสปอนเซอร์", secondaryText: "ติดต่อทีม",
      },
    },
    {
      type: "site_footer",
      group: "layout",
      label: "ส่วนท้าย",
      icon: "🔻",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#0f2109"/><rect x="8" y="10" width="26" height="5" rx="2" fill="#fff"/><rect x="8" y="19" width="30" height="3" rx="1.5" fill="#8fa382"/><rect x="8" y="25" width="24" height="3" rx="1.5" fill="#8fa382"/><g fill="#71bf44"><rect x="50" y="10" width="14" height="3" rx="1.5"/><rect x="72" y="10" width="14" height="3" rx="1.5"/><rect x="94" y="10" width="14" height="3" rx="1.5"/></g><g fill="#c3cbba"><rect x="50" y="18" width="16" height="2.5" rx="1"/><rect x="50" y="24" width="16" height="2.5" rx="1"/><rect x="50" y="30" width="16" height="2.5" rx="1"/><rect x="72" y="18" width="16" height="2.5" rx="1"/><rect x="72" y="24" width="16" height="2.5" rx="1"/><rect x="72" y="30" width="16" height="2.5" rx="1"/><rect x="94" y="18" width="16" height="2.5" rx="1"/><rect x="94" y="24" width="16" height="2.5" rx="1"/><rect x="94" y="30" width="16" height="2.5" rx="1"/></g></svg>`,
      fields: [
        { key: "brand", label: "ชื่อแบรนด์", type: "text" },
        { key: "brandAccent", label: "คำที่เน้นสี", type: "text" },
        { key: "about", label: "คำอธิบายบริษัท", type: "textarea" },
        {
          key: "cols", label: "คอลัมน์ลิงก์", type: "list",
          itemFields: [
            { key: "title", label: "หัวคอลัมน์", type: "text" },
            { key: "links", label: "ลิงก์ (คั่นด้วย ,)", type: "textarea" },
          ],
        },
      ],
      defaults: {
        brand: "A4S", brandAccent: "Academy",
        about: "แหล่งรวมข่าวสาร ธุรกิจ สินค้า และสื่อของ A4S สำหรับลูกค้าและผู้สนใจร่วมธุรกิจ",
        cols: [
          { title: "เมนู", links: "ข่าวสาร, สินค้า, กิจกรรม, บทเรียนออนไลน์" },
          { title: "แหล่งข้อมูล", links: "ดาวน์โหลด, โบรชัวร์, ไฟล์นำเสนอ, วิดีโอ" },
          { title: "ติดต่อ", links: "สมัครเป็นสปอนเซอร์, ติดต่อทีมงาน, ไทย / EN / FR" },
        ],
      },
    },
  ];

  const byType = Object.fromEntries(CATALOG.map((b) => [b.type, b]));

  /* deep clone แบบง่าย — props เป็น JSON ล้วน ไม่มี Date/function */
  const clone = (o) => JSON.parse(JSON.stringify(o));

  return {
    CATALOG,
    GROUPS,
    SIZE_PRESETS,
    byGroup: (key) => CATALOG.filter((b) => b.group === key),
    get: (type) => byType[type] || null,
    /* block ใหม่พร้อม props default — id ใช้แยก block ตอน drag/select */
    newBlock(type) {
      const def = byType[type];
      if (!def) return null;
      return {
        id: "b" + Math.random().toString(36).slice(2, 9),
        type,
        props: clone(def.defaults),
      };
    },
    /* เติม props ที่ขาด (block เก่าใน DB ที่ contract เพิ่ม field ทีหลัง) */
    withDefaults(block) {
      const def = byType[block.type];
      if (!def) return block;
      return { ...block, props: { ...clone(def.defaults), ...(block.props || {}) } };
    },
  };
})();
