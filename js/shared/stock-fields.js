/* ============================================================
   stock-fields.js — 📦 Catalog กลางของคอลัมน์ Stock Report
   ------------------------------------------------------------
   แหล่งความจริงที่เดียว (single source of truth) ของคอลัมน์ที่
   หน้า stock-report เอาไปให้ผู้ใช้ "เลือกคอลัมน์ → ออกรายงาน"

   ✅ เพิ่มคอลัมน์ใหม่ = เพิ่ม 1 entry ใน FIELDS ที่นี่ที่เดียว
      แล้วมันโผล่ใน picker ของ stock-report ตาม group อัตโนมัติ

   schema ของแต่ละ field:
     key   : คีย์ที่ใช้อ่านค่าจาก report row (stock-report.js build ค่าใส่ไว้)
     th    : label ภาษาไทย (หัวคอลัมน์ + Excel header)
     group : "info" | "qty" | "value"  (กลุ่มใน picker)
     fmt   : วิธี format / sort
              "number" : จำนวนเต็ม (thousands sep, sort แบบเลข)
              "money"  : เงิน 2 ตำแหน่ง (sort แบบเลข)
              "image"  : URL รูป → thumbnail (filter binary มี/ไม่มี)
              "date"   : วันที่ DD/MM/YYYY
              (ไม่ใส่ = ข้อความปกติ)
   ============================================================ */
(function () {
  "use strict";

  // กลุ่มคอลัมน์ (id → label + emoji) — ลำดับ = ลำดับใน picker
  const GROUPS = [
    { id: "info", label: "📋 ข้อมูลสินค้า" },
    { id: "qty", label: "📊 ยอดคงเหลือ" },
    { id: "value", label: "💰 มูลค่า" },
  ];

  // ── FIELD CATALOG (ลำดับ = ลำดับคอลัมน์ใน picker ต่อ group) ──
  const FIELDS = [
    // ── ข้อมูลสินค้า ──────────────────────────────────────
    { key: "product_code", th: "รหัสสินค้า", group: "info" },
    { key: "product_name", th: "ชื่อสินค้า", group: "info" },
    { key: "parent_name", th: "สินค้าชุด (หลัก)", group: "info" },
    { key: "category", th: "หมวดหมู่", group: "info" },
    { key: "warehouse_names", th: "คลังที่มีของ", group: "info" },
    { key: "image", th: "รูปสินค้า", group: "info", fmt: "image" },

    // ── ยอดคงเหลือ ────────────────────────────────────────
    { key: "onHand", th: "On-hand", group: "qty", fmt: "number" },
    { key: "reserved", th: "Reserved", group: "qty", fmt: "number" },
    { key: "available", th: "Available", group: "qty", fmt: "number" },
    { key: "reorder", th: "จุดสั่งซื้อ", group: "qty", fmt: "number" },
    { key: "status", th: "สถานะ", group: "qty" },
    { key: "expQty", th: "ใกล้หมดอายุ (จำนวน)", group: "qty", fmt: "number" },

    // ── มูลค่า ─────────────────────────────────────────────
    { key: "cost_price", th: "ราคาทุน/หน่วย", group: "value", fmt: "money" },
    { key: "stock_value", th: "มูลค่าสต็อก (ทุน)", group: "value", fmt: "money" },
  ];

  const BY_KEY = {};
  FIELDS.forEach((f) => { BY_KEY[f.key] = f; });

  // ── PUBLIC API ────────────────────────────────────────────
  const StockFields = {
    FIELDS,
    GROUPS,

    byKey(key) { return BY_KEY[key] || null; },
    th(key) { const f = BY_KEY[key]; return f ? f.th : key; },

    /* stock-report: คืน cols ของ group หนึ่ง ในรูปแบบ COLUMN_GROUPS
       → [{ key, label, fmt }] เรียงตามลำดับ canonical */
    crCols(groupId) {
      return FIELDS
        .filter((f) => f.group === groupId)
        .map((f) => ({ key: f.key, label: f.th, fmt: f.fmt }));
    },
  };

  window.StockFields = StockFields;
})();
