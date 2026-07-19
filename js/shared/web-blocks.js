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
    { key: "element", label: "องค์ประกอบ (Elements)",       icon: "🧩", hint: "ข้อความ · รูป · ปุ่ม — วางในคอลัมน์" },
    { key: "layout",  label: "โครงสร้าง (Structure)",       icon: "🧱", hint: "แถบคอลัมน์ · ส่วนหัว · เมนู · ส่วนท้าย" },
    { key: "content", label: "เนื้อหา (Content)",           icon: "📰", hint: "ข่าวเด่น · ข่าวหลัก" },
    { key: "list",    label: "รายการข้อมูล (Lists & Details)", icon: "🔲", hint: "สินค้า · กิจกรรม · ดาวน์โหลด" },
    { key: "cta",     label: "Call to Action",             icon: "🎯", hint: "แบนเนอร์เรียกให้สมัคร" },
  ];

  /* ── ชุดตัวเลือกที่ใช้ซ้ำหลาย block ── */
  const ALIGN_OPTS = [{ value: "left", label: "ซ้าย" }, { value: "center", label: "กลาง" }, { value: "right", label: "ขวา" }];

  /* ── เลย์เอาต์คอลัมน์ ──
     เก็บเป็นสตริงสัดส่วน "1-1" / "2-1" / "1-1-1" แทนการเก็บ "จำนวนคอลัมน์" เฉยๆ
     เพราะงานจริงต้องการคอลัมน์ไม่เท่ากันบ่อยมาก (เนื้อหา 2 ส่วน + แถบข้าง 1 ส่วน)
     ถ้าเก็บเป็นตัวเลขจำนวน จะรองรับได้แค่ช่องเท่ากันตลอดไป แล้วต้องรื้อ data ทีหลัง
     จำนวนคอลัมน์ = จำนวนท่อน · ความกว้าง = สัดส่วน fr ของแต่ละท่อน */
  const LAYOUTS = [
    { value: "1", label: "เต็มความกว้าง" },
    { value: "1-1", label: "2 คอลัมน์เท่ากัน" },
    { value: "2-1", label: "ซ้ายกว้าง · ขวาแคบ" },
    { value: "1-2", label: "ซ้ายแคบ · ขวากว้าง" },
    { value: "1-1-1", label: "3 คอลัมน์เท่ากัน" },
    { value: "1-2-1", label: "กลางกว้าง" },
    { value: "1-1-1-1", label: "4 คอลัมน์เท่ากัน" },
  ];
  const parts = (layout) => {
    const a = String(layout || "1").split("-").map((n) => Math.max(1, Math.min(6, +n || 1)));
    return a.length && a.length <= 4 ? a : [1];
  };
  /* ภาพจำลองเลย์เอาต์ — วาดจากสัดส่วนจริง ใช้ได้ทั้งการ์ดใน palette และปุ่มเลือกในแผงตั้งค่า
     สร้างด้วยโค้ดแทนวาดมือ 7 อัน เพราะถ้าเพิ่มเลย์เอาต์ใหม่จะได้ไม่ต้องวาด SVG ตามทุกครั้ง */
  function gridWire(layout, w = 120, h = 44, pad = 7, gap = 4) {
    const ps = parts(layout);
    const total = ps.reduce((a, b) => a + b, 0);
    const avail = w - pad * 2 - gap * (ps.length - 1);
    let x = pad, out = "";
    ps.forEach((p) => {
      const cw = (avail * p) / total;
      out += `<rect x="${x.toFixed(1)}" y="${pad}" width="${cw.toFixed(1)}" height="${h - pad * 2}" rx="3"/>`;
      x += cw + gap;
    });
    return `<svg viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f6f7f3"/><g fill="#fff" stroke="#71bf44" stroke-width="1.1" stroke-dasharray="3 2">${out}</g></svg>`;
  }

  const CATALOG = [
    /* ============================================================
       โมเดล 3 ชั้น: Section > Column > Element
       ============================================================
       node ทุกตัวหน้าตาเหมือนกัน { id, type, props, children? }
       — section  = แถบเต็มจอ · children = คอลัมน์ (จำนวนตาม props.cols)
       — column   = ช่องในแถบ  · children = element (ไม่อยู่ใน palette สร้างจาก section เท่านั้น)
       — element  = ใบไม้ ไม่มี children (scope:"element" = ลากลงได้เฉพาะในคอลัมน์)

       ทำไมจำกัด 3 ชั้น (ไม่ให้ section ซ้อน section):
       ซ้อนไม่จำกัด = ผู้ใช้หลงว่าตัวเองอยู่ชั้นไหน ลากของหล่นผิดกล่องตลอด
       และ responsive คุมไม่ได้ · 3 ชั้นครอบคลุมงานจริงเกือบทั้งหมด
       ============================================================ */
    {
      type: "section",
      group: "layout",
      label: "แถบ + คอลัมน์ (Section)",
      icon: "▤",
      wire: gridWire("1-1"),
      /* presets = แตกเป็นการ์ดหลายใบใน palette → "เลือก grid ก่อนลาก" ไม่ต้องวางแล้วค่อยมาตั้งค่า
         (ยังเปลี่ยนทีหลังได้ในแท็บตั้งค่า — นี่แค่ทางลัดของขั้นตอนที่ทำบ่อยที่สุด) */
      presets: LAYOUTS.map((l) => ({ layout: l.value, label: l.label, wire: gridWire(l.value) })),
      /* container = editor รู้ว่า block นี้มีลูก ต้องวาด children + รับการวางของ */
      container: true,
      fields: [
        { section: "เลย์เอาต์" },
        { key: "layout", label: "คอลัมน์", type: "gridpick", options: LAYOUTS },
        { key: "gap", label: "ระยะห่างคอลัมน์", type: "range", row: true, min: 0, max: 80, step: 4, unit: "px" },
        { key: "vAlign", label: "จัดแนวตั้ง", type: "segment", row: true,
          options: [{ value: "start", label: "บน" }, { value: "center", label: "กลาง" }, { value: "stretch", label: "เต็ม" }] },

        { section: "สไตล์" },
        { key: "bg", label: "สีพื้นหลัง", type: "color", row: true },
        { key: "maxWidth", label: "ความกว้างเนื้อหา", type: "range", row: true, min: 700, max: 1600, step: 20, unit: "px" },
        { key: "padY", label: "ระยะบน-ล่าง", type: "range", row: true, min: 0, max: 160, step: 4, unit: "px" },
        { key: "padX", label: "ระยะซ้าย-ขวา", type: "range", row: true, min: 0, max: 120, step: 4, unit: "px" },
      ],
      defaults: { layout: "1-1", gap: 24, vAlign: "start", bg: "#ffffff", maxWidth: 1200, padY: 40, padX: 44 },
      /* section ที่เพิ่งสร้าง = ต้องมีคอลัมน์ว่างให้ลากของลงทันที */
      makeChildren: true,
    },
    {
      /* ไม่มี group = ไม่โผล่ใน palette · เกิดจาก section เท่านั้น (ลบเดี่ยวไม่ได้ ลบทั้ง section แทน) */
      type: "column",
      label: "คอลัมน์",
      icon: "▯",
      container: true,
      fields: [
        { section: "จัดวาง" },
        { key: "align", label: "จัดข้อความ", type: "segment", row: true, options: ALIGN_OPTS },
        { key: "pad", label: "ระยะขอบใน", type: "range", row: true, min: 0, max: 60, step: 2, unit: "px" },
        { key: "gap", label: "ระยะห่างระหว่างชิ้น", type: "range", row: true, min: 0, max: 48, step: 2, unit: "px" },
        { section: "สไตล์" },
        { key: "bg", label: "สีพื้นหลัง", type: "color", row: true },
        { key: "radius", label: "ความมนขอบ", type: "range", row: true, min: 0, max: 32, step: 2, unit: "px" },
      ],
      defaults: { align: "left", pad: 0, gap: 14, bg: "", radius: 0 },
      makeChildren: true,
    },
    {
      type: "el_text",
      group: "element",
      scope: "element",
      label: "ข้อความ",
      icon: "🅃",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="10" y="10" width="60" height="6" rx="3" fill="#16240f"/><rect x="10" y="22" width="100" height="4" rx="2" fill="#c3cbba"/><rect x="10" y="31" width="86" height="4" rx="2" fill="#c3cbba"/></svg>`,
      fields: [
        { key: "text", label: "ข้อความ", type: "textarea" },
        { section: "สไตล์" },
        { key: "size", label: "ขนาด", type: "range", row: true, min: 11, max: 72, step: 1, unit: "px" },
        { key: "weight", label: "น้ำหนัก", type: "segment", row: true,
          options: [{ value: "light", label: "บาง" }, { value: "normal", label: "ปกติ" }, { value: "bold", label: "หนา" }] },
        { key: "color", label: "สี", type: "swatch", swatches: ["#16240f", "#2f3a28", "#5a6551", "#71bf44", "#ffffff"] },
        { key: "align", label: "จัดวาง", type: "segment", row: true, options: ALIGN_OPTS },
        { key: "lh", label: "ระยะบรรทัด", type: "range", row: true, min: 1, max: 2.4, step: 0.1, unit: "" },
      ],
      defaults: { text: "พิมพ์ข้อความที่นี่ — ขึ้นบรรทัดใหม่ได้", size: 16, weight: "normal", color: "#2f3a28", align: "left", lh: 1.6 },
    },
    {
      type: "el_image",
      group: "element",
      scope: "element",
      label: "รูปภาพ",
      icon: "🖼️",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="14" y="7" width="92" height="30" rx="3" fill="#e4ece0"/><circle cx="34" cy="17" r="4" fill="#a9c69a"/><path d="M20 33l16-13 12 9 10-7 16 11z" fill="#a9c69a"/></svg>`,
      fields: [
        { key: "src", label: "รูป", type: "image" },
        { key: "alt", label: "คำอธิบายรูป (SEO)", type: "text" },
        { key: "link", label: "คลิกแล้วไปหน้า", type: "select", optionsFrom: "pages", allowEmpty: true, emptyLabel: "— ไม่ลิงก์ —", row: true },
        { section: "สไตล์" },
        { key: "ratio", label: "สัดส่วน", type: "select", row: true,
          options: [{ value: "auto", label: "ตามรูปจริง" }, { value: "16/9", label: "16:9" }, { value: "4/3", label: "4:3" }, { value: "1/1", label: "จัตุรัส" }, { value: "3/4", label: "แนวตั้ง 3:4" }] },
        { key: "width", label: "ความกว้าง", type: "range", row: true, min: 20, max: 100, step: 5, unit: "%" },
        { key: "radius", label: "ความมนขอบ", type: "range", row: true, min: 0, max: 40, step: 2, unit: "px" },
        { key: "align", label: "จัดวาง", type: "segment", row: true, options: ALIGN_OPTS },
      ],
      defaults: { src: "", alt: "", link: "", ratio: "16/9", width: 100, radius: 12, align: "center" },
    },
    {
      type: "el_button",
      group: "element",
      scope: "element",
      label: "ปุ่ม",
      icon: "🔘",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="34" y="14" width="52" height="17" rx="5" fill="#71bf44"/><rect x="45" y="21" width="30" height="4" rx="2" fill="#0f2109"/></svg>`,
      fields: [
        { key: "label", label: "ข้อความบนปุ่ม", type: "text" },
        { key: "link", label: "ลิงก์ไปหน้า", type: "select", optionsFrom: "pages", allowEmpty: true, emptyLabel: "— ไม่ลิงก์ —", row: true },
        { section: "สไตล์" },
        { key: "variant", label: "รูปแบบ", type: "segment", row: true,
          options: [{ value: "solid", label: "ทึบ" }, { value: "outline", label: "ขอบ" }] },
        { key: "bg", label: "สีปุ่ม", type: "swatch", swatches: ["#71bf44", "#16240f", "#3B6D11", "#ffffff"] },
        { key: "fg", label: "สีตัวอักษร", type: "swatch", swatches: ["#0f2109", "#ffffff", "#16240f"] },
        { key: "size", label: "ขนาด", type: "range", row: true, min: 12, max: 22, step: 1, unit: "px" },
        { key: "radius", label: "ความมนขอบ", type: "range", row: true, min: 0, max: 999, step: 1, unit: "px" },
        { key: "align", label: "จัดวาง", type: "segment", row: true, options: ALIGN_OPTS },
      ],
      defaults: { label: "ดูรายละเอียด →", link: "", variant: "solid", bg: "#71bf44", fg: "#0f2109", size: 15, radius: 10, align: "left" },
    },
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
          /* pills = แสดงเป็นปุ่มกลมแถวเดียว (ไทย · EN · FR) แทนการ์ด #1 #2 #3
             กด ✎ ถึงจะกางแผงจัดการ (เพิ่ม/ลบ/เรียง/เปลี่ยนชื่อ) */
          key: "langs", label: "ภาษาที่แสดง", type: "list", pills: true,
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
            /* allowEmpty = มีตัวเลือก "ไม่ลิงก์" ให้เลิกผูกได้ (ไม่งั้น dropdown ไม่มีทางว่าง)
               เมนูเก่าที่บันทึกไว้ไม่มี key นี้ → renderer เช็ค falsy แล้วออกเป็นข้อความเฉยๆ */
            { key: "link", label: "ลิงก์ไปหน้า", type: "select", optionsFrom: "pages", allowEmpty: true, emptyLabel: "— ไม่ลิงก์ —" },
          ],
        },
        /* ปุ่ม CTA ขวาสุด — เป็นรายการ เพิ่ม/ลบได้ · แต่ละปุ่มเปิดปิดเองได้ (ไม่ exclusive)
           ของเดิมเก็บปุ่มเดียวใน ctaText → ย้ายให้อัตโนมัติใน withDefaults ข้างล่าง */
        {
          key: "ctaItems", label: "ปุ่มขวา (CTA)", type: "list",
          itemFields: [
            { key: "label", label: "ข้อความปุ่ม", type: "text" },
            { key: "enabled", label: "แสดงปุ่ม", type: "toggle", half: true, default: true },
            { key: "link", label: "ลิงก์ไปหน้า", type: "select", optionsFrom: "pages", allowEmpty: true, emptyLabel: "— ไม่ลิงก์ —" },
          ],
        },
      ],
      defaults: {
        items: [
          { label: "หน้าแรก", active: true, link: "" },
          { label: "ข่าวสาร", active: false, link: "" },
          { label: "สินค้า", active: false, link: "" },
          { label: "กิจกรรม", active: false, link: "" },
          { label: "บทเรียนออนไลน์", active: false, link: "" },
          { label: "ดาวน์โหลด", active: false, link: "" },
        ],
        /* ctaItems = null (ไม่ใช่ []) โดยตั้งใจ — เป็นสัญญาณให้ withDefaults รู้ว่า "ยังไม่เคยย้าย"
           ถ้าตั้งเป็น [] ปุ่มเดิมของหน้าเก่าจะหายเงียบๆ · ผู้ใช้ลบปุ่มจนหมดเองถึงจะเป็น [] จริง */
        ctaItems: null,
        ctaText: "สมัครเป็นสปอนเซอร์ →", /* legacy — ปล่อยค้างไว้เป็นต้นทางตอนย้าย */
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
      /* ── spacer — ช่องว่างล้วน ไม่มีเนื้อหา ──
         หน้า public = ว่างเปล่าจริงๆ · ในโหมดแก้ไขต้อง "มองเห็นและลบได้"
         ไม่งั้นผู้ใช้หาไม่เจอ → ทำด้วย class wv-spacer + CSS ฝั่ง editor
         (แบบเดียวกับ wv-header/wv-hide-sm — renderer ไม่ต้องรู้ว่าอยู่ canvas หรือ public) */
      type: "spacer",
      group: "layout",
      label: "ตัวเว้นระยะ",
      icon: "↕️",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="8" y="5" width="104" height="8" rx="2" fill="#dfe4d8"/><rect x="8" y="31" width="104" height="8" rx="2" fill="#dfe4d8"/><line x1="8" y1="22" x2="112" y2="22" stroke="#71bf44" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M60 16v12M56.5 19.5 60 16l3.5 3.5M56.5 24.5 60 28l3.5-3.5" stroke="#71bf44" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`,
      fields: [
        { section: "ความสูง" },
        { key: "height", label: "จอปกติ", type: "range", row: true, min: 8, max: 200, step: 2, unit: "px" },
        { key: "mobileHeight", label: "บนมือถือ", type: "range", row: true, min: 8, max: 120, step: 2, unit: "px" },
      ],
      defaults: { height: 48, mobileHeight: 32 },
    },
    {
      /* ── divider — เส้นคั่นเซกชัน ──
         ทำงานคล้าย spacer แต่มีเส้นให้เห็น · แยกเป็นคนละ block เพราะชื่อสื่อความหมายกว่า
         width < 100% = เส้นสั้นลงและจัดกึ่งกลางเอง (margin:0 auto) */
      type: "divider",
      group: "layout",
      label: "เส้นคั่น",
      icon: "➖",
      wire: `<svg viewBox="0 0 120 44"><rect width="120" height="44" fill="#fff"/><rect x="8" y="8" width="70" height="4" rx="2" fill="#dfe4d8"/><rect x="8" y="32" width="52" height="4" rx="2" fill="#dfe4d8"/><line x1="22" y1="22" x2="98" y2="22" stroke="#16240f" stroke-width="2"/></svg>`,
      fields: [
        { section: "เส้น" },
        { key: "lineStyle", label: "รูปแบบ", type: "segment", row: true,
          options: [{ value: "solid", label: "ทึบ" }, { value: "dashed", label: "ประ" }, { value: "dotted", label: "จุด" }] },
        { key: "thickness", label: "ความหนา", type: "range", row: true, min: 1, max: 8, step: 1, unit: "px" },
        /* เส้นคั่นส่วนใหญ่ควรเป็นสีเทาจางๆ ไม่ใช่สีแบรนด์ → ใส่เทาเป็นปุ่มแรก
           ไม่งั้น default #e3e5e0 จะไปโผล่เป็น "กำหนดเอง" ทั้งที่เป็นค่ามาตรฐาน */
        { key: "color", label: "สีเส้น", type: "swatch", swatches: ["#e3e5e0", ...BRAND_COLORS] },
        { key: "width", label: "ความกว้าง", type: "range", row: true, min: 20, max: 100, step: 5, unit: "%" },

        { section: "ระยะ" },
        { key: "spacing", label: "ระยะห่างบน-ล่าง", type: "range", row: true, min: 0, max: 96, step: 4, unit: "px" },
      ],
      defaults: { lineStyle: "solid", thickness: 1, color: "#e3e5e0", width: 100, spacing: 32 },
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

  /* ── ส่วนกลางของเว็บ (Global chrome) ──
     header/เมนู/footer เหมือนกันทุกหน้า → เก็บไว้ "แถวเดียว" ไม่ใช่ก๊อปใส่ทุกหน้า
     ใช้ตาราง web_pages เดิม แค่จอง slug ขึ้นต้นด้วย "_" ไว้ (ไม่ต้องสร้างตารางใหม่/ไม่ต้องรัน SQL)
     เวลาแสดงผลจริง = header ส่วนกลาง + blocks ของหน้านั้น + footer ส่วนกลาง
     slug ขึ้นต้นด้วย "_" ถือเป็นแถวระบบ → ต้องซ่อนจากรายการหน้าเว็บปกติเสมอ */
  const LAYOUT_SLUGS = { header: "_layout_header", footer: "_layout_footer" };
  const isSystemSlug = (slug) => String(slug || "").startsWith("_");

  const byType = Object.fromEntries(CATALOG.map((b) => [b.type, b]));

  /* deep clone แบบง่าย — props เป็น JSON ล้วน ไม่มี Date/function */
  const clone = (o) => JSON.parse(JSON.stringify(o));

  return {
    CATALOG,
    GROUPS,
    SIZE_PRESETS,
    LAYOUT_SLUGS,
    isSystemSlug,
    /* บล็อกที่ควรอยู่ "ส่วนกลาง" ไม่ใช่รายหน้า — ใช้ตรวจว่าหน้านี้มีของที่ควรย้ายไหม */
    CHROME_TYPES: ["site_header", "nav_bar", "site_footer"],
    byGroup: (key) => CATALOG.filter((b) => b.group === key),
    get: (type) => byType[type] || null,
    /* element = ลากลงได้เฉพาะในคอลัมน์ · ไม่ใช่ = วางที่ระดับหน้าเท่านั้น
       ใช้ตัดสินใจตอน drag & drop ทั้ง 2 ฝั่ง (ไฮไลต์เป้าหมาย + ตอนวางจริง) */
    isElement: (type) => byType[type]?.scope === "element",
    isContainer: (type) => !!byType[type]?.container,

    /* ── เดินต้นไม้หา node จาก id ──
       คืน { node, list, idx, parent } — list คือ array ที่ node อยู่ (ไว้ splice ย้าย/ลบ)
       ต้องมีตัวนี้เพราะ block ไม่ได้อยู่ระดับเดียวอีกแล้ว (blocks.find เอาไม่อยู่) */
    find(list, id, parent = null) {
      for (let i = 0; i < (list || []).length; i++) {
        const n = list[i];
        if (!n) continue;
        if (n.id === id) return { node: n, list, idx: i, parent };
        if (n.children) {
          const hit = this.find(n.children, id, n);
          if (hit) return hit;
        }
      }
      return null;
    },

    /* ── ปรับจำนวนคอลัมน์ให้ตรงกับ props.cols ──
       เพิ่ม = ต่อคอลัมน์ว่าง · ลด = ย้ายของในคอลัมน์ที่หายไปมารวมกับคอลัมน์สุดท้ายที่เหลือ
       (ห้ามตัดทิ้งเฉยๆ — ผู้ใช้กดเลข 3→2 แล้วเนื้อหาหายไปเงียบๆ คือบั๊กที่ให้อภัยไม่ได้) */
    syncColumns(section) {
      if (section?.type !== "section") return section;
      const want = parts(section.props.layout).length;
      const cols = section.children || [];
      while (cols.length < want) cols.push(this.newBlock("column"));
      if (cols.length > want) {
        const dropped = cols.splice(want);
        const last = cols[want - 1];
        dropped.forEach((c) => last.children.push(...(c.children || [])));
      }
      section.children = cols;
      return section;
    },

    LAYOUTS,
    gridWire,
    colParts: parts,

    /* block ใหม่พร้อม props default — id ใช้แยก block ตอน drag/select
       preset = ค่าที่เลือกไว้ตั้งแต่ใน palette (ตอนนี้ใช้กับ section: เลย์เอาต์คอลัมน์) */
    newBlock(type, preset) {
      const def = byType[type];
      if (!def) return null;
      /* ต้องผ่าน withDefaults ด้วย — บล็อกที่เพิ่งลากมาวางต้องได้ "รูปข้อมูล" เดียวกับที่โหลดจาก DB เป๊ะ
         ไม่งั้นค่าที่รอย้ายรูปแบบ (เช่น ctaItems ที่ default เป็น null) จะค้างเป็น null ในสถานะ editor
         → แผงตั้งค่าเห็น 0 รายการ แต่ canvas เห็นปุ่ม (renderer เรียก withDefaults เอง) = ไม่ตรงกัน
         และกด "เพิ่มรายการ" แล้วพัง เพราะ push ใส่ null ไม่ได้ */
      const b = this.withDefaults({
        id: "b" + Math.random().toString(36).slice(2, 9),
        type,
        props: clone(def.defaults),
      });
      if (preset && type === "section") b.props.layout = preset;
      /* container ต้องมี children ตั้งแต่เกิด — section ที่ยังไม่มีคอลัมน์ = ลากของลงไม่ได้เลย */
      if (def.makeChildren) {
        b.children = [];
        this.syncColumns(b);
      }
      return b;
    },
    /* เติม props ที่ขาด (block เก่าใน DB ที่ contract เพิ่ม field ทีหลัง) */
    withDefaults(block) {
      const def = byType[block.type];
      if (!def) return block;
      const props = { ...clone(def.defaults), ...(block.props || {}) };
      /* ── ย้ายข้อมูลรูปแบบเก่า ──
         nav_bar เดิมเก็บปุ่ม CTA เดียวเป็นข้อความใน ctaText → ตอนนี้เป็นรายการ ctaItems
         ทำที่นี่ที่เดียว renderer/editor จึงเห็นรูปเดียวกันเสมอ · ctaText ไม่ลบทิ้ง
         (เผื่อเปิดหน้าเดิมด้วยโค้ดเวอร์ชันเก่า ปุ่มจะได้ไม่หาย) */
      if (block.type === "nav_bar" && !Array.isArray(props.ctaItems)) {
        props.ctaItems = props.ctaText
          ? [{ label: props.ctaText, link: "", enabled: true }]
          : [];
      }
      return { ...block, props };
    },
  };
})();
