/* ============================================================
   pax-fields.js — 📇 Catalog กลางของคอลัมน์ผู้เดินทาง (tour_seat_check)
   ------------------------------------------------------------
   แหล่งความจริงที่เดียว (single source of truth) ของ field ในตาราง
   tour_seat_check ที่หน้าอื่นเอาไปแสดง/แก้ไข/ออกรายงาน

   ✅ เพิ่มคอลัมน์ใหม่ = เพิ่ม 1 entry ใน FIELDS ที่นี่ที่เดียว แล้ว:
      • custom-report  → คอลัมน์โผล่ใน group ตาม cr.group อัตโนมัติ
      • pax-detail     → โผล่ในตาราง ถ้าใส่ key ไว้ใน PAX_DETAIL_ORDER ด้วย

   หมายเหตุ:
   • ลำดับใน FIELDS = ลำดับ canonical → ใช้กับ custom-report (เรียงตาม group)
   • pax-detail ใช้ลำดับของตัวเองผ่าน PAX_DETAIL_ORDER (curated UX)
   • check-seat / room-assign ยังคุม widget เอง (option/format เฉพาะทาง)
     แต่ดึง "label" จาก catalog นี้ได้ผ่าน byKey().en / .th

   schema ของแต่ละ field:
     key   : ชื่อคอลัมน์ใน DB (tour_seat_check)
     th    : label ภาษาไทย (fallback ของ custom-report + header pax-detail)
     en    : label อังกฤษ (custom-report EN + Excel)
     xlsx  : header สำหรับ Export Excel (ถ้าไม่ใส่ = ใช้ en)
     cr    : { group, fmt }  — config ฝั่ง custom-report
              group : "checkseat" | "detail"  (กลุ่มที่จะไปอยู่)
              fmt   : "date" | "gender" | "image"  (optional — วิธี format ค่า)
              * ไม่มี cr = ไม่โผล่ใน custom-report
     pax   : config ฝั่ง pax-detail (ต้องอยู่ใน PAX_DETAIL_ORDER ด้วยถึงจะแสดง)
              cls   : suffix ของ class คอลัมน์ → "pd-col-<cls>"
              header: ข้อความหัวตาราง (อาจมี emoji)
              input : "code"|"name"|"gender"|"select"|"text"|"textarea"
              options: array (ใช้กับ input:"select")
              ph    : placeholder
              edit  : true = แก้ไขได้ใน edit mode / false = view อย่างเดียว
   ============================================================ */
(function () {
  "use strict";

  // ── shared option lists (ใช้ร่วมหลายหน้าได้) ──────────────
  const PREFIX_OPTIONS = [
    "", "Mr.", "Mrs.", "Ms.", "Miss", "Dr.", "Prof.",
    "นาย", "นาง", "นางสาว", "ดร.",
  ];
  const SHIRT_OPTIONS = ["", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

  // ── FIELD CATALOG (ลำดับ = canonical / custom-report) ─────
  const FIELDS = [
    // ── กลุ่ม Check Seat ──────────────────────────────────
    { key: "code", th: "รหัส", en: "Code", xlsx: "Code",
      cr: { group: "checkseat" },
      pax: { cls: "code", header: "รหัส", input: "code", edit: false } },

    { key: "title_prefix", th: "คำนำหน้า", en: "Title", xlsx: "Title",
      cr: { group: "checkseat" },
      pax: { cls: "prefix", header: "คำนำหน้า", input: "select", options: PREFIX_OPTIONS, edit: true } },

    { key: "name", th: "ชื่อ", en: "Name", xlsx: "Name",
      cr: { group: "checkseat" },
      pax: { cls: "name", header: "ชื่อ", input: "name", edit: false } },

    { key: "gender", th: "เพศ", en: "Gender", xlsx: "Gender",
      cr: { group: "checkseat", fmt: "gender" },
      pax: { cls: "gender", header: "เพศ", input: "gender", edit: true } },

    { key: "nationality", th: "สัญชาติ", en: "Nationality", xlsx: "Nationality",
      cr: { group: "checkseat" },
      pax: { cls: "nat", header: "สัญชาติ", input: "text", edit: true } },

    { key: "pin", th: "ตำแหน่ง", en: "Position", cr: { group: "checkseat" } },
    { key: "group_name", th: "กลุ่ม", en: "Group", cr: { group: "checkseat" } },
    { key: "seat", th: "ที่นั่งเครื่องบิน", en: "Flight seat", cr: { group: "checkseat" } },
    { key: "passport_id", th: "เลขพาสปอร์ต", en: "Passport no.", cr: { group: "checkseat" } },
    { key: "passport_exp_date", th: "พาสปอร์ตหมดอายุ", en: "Passport expiry", cr: { group: "checkseat", fmt: "date" } },
    { key: "passport_image_url", th: "ภาพ passport", en: "Passport image", cr: { group: "checkseat", fmt: "image" } },
    { key: "visa_image_url", th: "ภาพสลิป/วีซ่า", en: "Slip / visa image", cr: { group: "checkseat", fmt: "image" } },

    { key: "tshirt_size", th: "ไซส์เสื้อ", en: "T-shirt size", xlsx: "T-Shirt Size",
      cr: { group: "checkseat" },
      pax: { cls: "shirt", header: "T-Shirt", input: "select", options: SHIRT_OPTIONS, edit: true } },

    { key: "religion", th: "ศาสนา", en: "Religion", xlsx: "Religion",
      cr: { group: "checkseat" },
      pax: { cls: "religion", header: "ศาสนา", input: "text", ph: "พุทธ/คริสต์/อิสลาม", edit: true } },

    { key: "food_allergy", th: "อาหารที่แพ้", en: "Food allergy", xlsx: "Food Allergy",
      cr: { group: "checkseat" },
      pax: { cls: "allergy", header: "🍽️ แพ้อาหาร", input: "text", ph: "แพ้ทะเล, มังสวิรัติ, ฮาลาล", edit: true } },

    { key: "return_flight", th: "ไฟลท์ขากลับ", en: "Return flight", cr: { group: "checkseat" } },
    { key: "return_date", th: "วันขากลับ", en: "Return date", cr: { group: "checkseat", fmt: "date" } },

    // ── กลุ่ม Detail ──────────────────────────────────────
    { key: "tel", th: "เบอร์โทร", en: "Phone", xlsx: "Tel / WhatsApp",
      cr: { group: "detail" },
      pax: { cls: "tel", header: "📞 Tel/WhatsApp", input: "text", ph: "+66 8x-xxx-xxxx", edit: true } },

    { key: "line_id", th: "LINE ID", en: "LINE ID", xlsx: "LINE ID",
      cr: { group: "detail" },
      pax: { cls: "line", header: "LINE ID", input: "text", ph: "@username", edit: true } },

    { key: "home_address", th: "ที่อยู่", en: "Home address", xlsx: "Home Address",
      cr: { group: "detail" },
      pax: { cls: "addr", header: "🏠 ที่อยู่", input: "textarea", ph: "ที่อยู่ปัจจุบัน", edit: true } },

    { key: "medical_conditions", th: "โรคประจำตัว", en: "Medical conditions", xlsx: "Medical Conditions",
      cr: { group: "detail" },
      pax: { cls: "medical", header: "💊 โรคประจำตัว", input: "textarea", ph: "เบาหวาน/ความดัน...", edit: true } },

    { key: "daily_medication", th: "ยาที่ใช้ประจำ", en: "Daily medication", xlsx: "Daily Medication",
      cr: { group: "detail" },
      pax: { cls: "medic", header: "💊 ยาประจำตัว", input: "textarea", ph: "ชื่อยา + ขนาด", edit: true } },

    { key: "emergency_contact_name", th: "ผู้ติดต่อฉุกเฉิน", en: "Emergency contact", xlsx: "Emergency Contact",
      cr: { group: "detail" },
      pax: { cls: "em-name", header: "🆘 ชื่อ", input: "text", ph: "ชื่อ-นามสกุล", edit: true } },

    { key: "emergency_contact_phone", th: "เบอร์ฉุกเฉิน", en: "Emergency phone", xlsx: "Emergency Phone",
      cr: { group: "detail" },
      pax: { cls: "em-phone", header: "🆘 เบอร์", input: "text", ph: "+66 8x-xxx-xxxx", edit: true } },

    { key: "emergency_contact_relation", th: "ความสัมพันธ์", en: "Relationship", xlsx: "Emergency Relation",
      cr: { group: "detail" },
      pax: { cls: "em-rel", header: "🆘 ความสัมพันธ์", input: "text", ph: "สามี/ภรรยา", edit: true } },

    { key: "insurance_company", th: "บริษัทประกัน", en: "Insurance company", xlsx: "Insurance Company",
      cr: { group: "detail" },
      pax: { cls: "ins-co", header: "🛡️ บริษัทประกัน", input: "text", ph: "ชื่อบริษัท", edit: true } },

    { key: "insurance_policy_no", th: "เลขกรมธรรม์", en: "Policy no.", xlsx: "Insurance Policy No.",
      cr: { group: "detail" },
      pax: { cls: "ins-no", header: "🛡️ เลขกรมธรรม์", input: "text", ph: "เลขกรมธรรม์", edit: true } },

    { key: "special_requests", th: "คำขอพิเศษ", en: "Special requests", xlsx: "Special Requests",
      cr: { group: "detail" },
      pax: { cls: "special", header: "📝 คำขอพิเศษ", input: "textarea", ph: "wheelchair, อื่นๆ", edit: true } },
  ];

  // ── ลำดับคอลัมน์ในหน้า pax-detail (curated) ────────────────
  // เพิ่ม field ใหม่ลงหน้า pax-detail = ใส่ key ตรงตำแหน่งที่ต้องการ
  const PAX_DETAIL_ORDER = [
    "code", "title_prefix", "name", "gender", "religion", "nationality",
    "tshirt_size", "food_allergy", "medical_conditions", "daily_medication",
    "tel", "line_id", "home_address",
    "emergency_contact_name", "emergency_contact_relation", "emergency_contact_phone",
    "insurance_company", "insurance_policy_no", "special_requests",
  ];

  const BY_KEY = {};
  FIELDS.forEach((f) => { BY_KEY[f.key] = f; });

  // ── PUBLIC API ────────────────────────────────────────────
  const PaxFields = {
    FIELDS,
    PREFIX_OPTIONS,
    SHIRT_OPTIONS,

    byKey(key) { return BY_KEY[key] || null; },

    // label helpers (เลือกภาษา) — fallback th → key
    th(key) { const f = BY_KEY[key]; return f ? f.th : key; },
    en(key) { const f = BY_KEY[key]; return f ? (f.en || f.th) : key; },

    /* custom-report: คืน cols ของ group หนึ่ง ในรูปแบบ COLUMN_GROUPS เดิม
       → [{ key, label, en, src:"pax", fmt }] เรียงตามลำดับ canonical */
    crCols(groupId) {
      return FIELDS
        .filter((f) => f.cr && f.cr.group === groupId)
        .map((f) => ({ key: f.key, label: f.th, en: f.en, src: "pax", fmt: f.cr.fmt }));
    },

    /* pax-detail: คืน field objects เรียงตาม PAX_DETAIL_ORDER (เฉพาะที่มี .pax) */
    paxColumns() {
      return PAX_DETAIL_ORDER
        .map((k) => BY_KEY[k])
        .filter((f) => f && f.pax);
    },

    /* pax-detail: key ของ field ที่แก้ไขได้ (ใช้สร้าง payload save) */
    paxEditableKeys() {
      return PaxFields.paxColumns().filter((f) => f.pax.edit).map((f) => f.key);
    },
  };

  window.PaxFields = PaxFields;
})();
