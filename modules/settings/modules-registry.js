/* ============================================================
   modules-registry.js — ERP Module & Permission Registry
   js/shared/

   วิธีใช้:
   1. เพิ่ม module ใหม่ในรายการ ERP_MODULES ด้านล่าง
   2. ทุกหน้าที่ import ไฟล์นี้จะได้รับข้อมูลอัตโนมัติ
============================================================ */
/* ============================================================
   ACTION REFERENCE — สำหรับใช้ตั้งชื่อ permission key
   รูปแบบ: {action}_{module}  เช่น  edit_events, export_reports
   ============================================================

   ACTION ที่ใช้ได้:
   ─────────────────────────────────────────────────────────
   view      ดูข้อมูล (อ่านอย่างเดียว)
   create    สร้างรายการใหม่
   edit      แก้ไขรายการที่มีอยู่
   delete    ลบรายการ
   approve   อนุมัติ
   reject    ปฏิเสธ / ไม่อนุมัติ
   export    ส่งออกข้อมูล (CSV, PDF)
   import    นำเข้าข้อมูล
   manage    รวม create+edit+delete (ใช้กับ admin-level)
   assign    มอบหมายงาน / คน
   print     พิมพ์เอกสาร
   cancel    ยกเลิกรายการ
   ─────────────────────────────────────────────────────────

   ตัวอย่าง:
   view_events        ดูกิจกรรม
   create_events      สร้างกิจกรรม
   edit_events        แก้ไขกิจกรรม
   delete_events      ลบกิจกรรม
   approve_po         อนุมัติ PO
   export_reports     export รายงาน
   manage_users       จัดการผู้ใช้ (admin)
   ─────────────────────────────────────────────────────────
============================================================ */
const ERP_MODULES = [
  // ─────────────────────────────────────────────────────────
  // FORMAT:
  // {
  //   key:    "unique_module_key",          ← ห้ามซ้ำ, ใช้ snake_case
  //   label:  "🗓️ ชื่อ Module",              ← แสดงใน UI
  //   perms: [                              ← รายการสิทธิ์ใน module นี้
  //     { key: "view_xxx",   label: "ดู..." },
  //     { key: "manage_xxx", label: "จัดการ..." },
  //   ]
  // }
  // ─────────────────────────────────────────────────────────

  {
    key: "inventory",
    label: "📦 คลังสินค้า",
    perms: [
      { key: "view_inventory", label: "ดูคลังสินค้า" },
      { key: "manage_stock", label: "จัดการ Stock" },
      { key: "create_po", label: "สร้าง PO" },
      { key: "approve_po", label: "อนุมัติ PO" },
    ],
  },
  {
    key: "sales",
    label: "💰 การขาย",
    perms: [
      { key: "view_sales", label: "ดูการขาย" },
      { key: "create_so", label: "สร้าง SO" },
      { key: "approve_so", label: "อนุมัติ SO" },
    ],
  },
  {
    key: "event",
    label: "🗓️ กิจกรรม",
    perms: [
      { key: "view_events", label: "ดูกิจกรรม" },
      { key: "manage_events", label: "จัดการกิจกรรม" },
      { key: "manage_attendees", label: "จัดการผู้เข้าร่วม" },
      { key: "manage_events-calendar", label: "จัดการปฎิทิน" },
    ],
  },
  {
    key: "report",
    label: "📊 รายงาน",
    perms: [
      { key: "view_reports", label: "ดูรายงาน" },
      { key: "export_reports", label: "Export รายงาน" },
    ],
  },
  {
    key: "settings",
    label: "⚙️ ตั้งค่าระบบ",
    perms: [
      { key: "manage_users", label: "จัดการผู้ใช้" },
      { key: "manage_settings", label: "ตั้งค่าระบบ" },
      { key: "view_all", label: "ดูข้อมูลทั้งหมด" },
    ],
  },

  {
    key: "customer_service",
    label: "🎁 บริการลูกค้า",
    perms: [
      { key: "view_promotions", label: "ดูโปรโมชัน" },
      { key: "manage_promotions", label: "จัดการโปรโมชัน" },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // ➕ เพิ่ม Module ใหม่ที่นี่
  // เช่น:
  // {
  //   key: "hr",
  //   label: "🧑‍💼 HR",
  //   perms: [
  //     { key: "view_hr",    label: "ดูข้อมูล HR" },
  //     { key: "manage_hr",  label: "จัดการ HR" },
  //   ],
  // },
  // ─────────────────────────────────────────────────────────
];

/* ── HELPER: flatten เป็น array เดียว ── */
function getAllPerms() {
  return ERP_MODULES.flatMap((m) => m.perms);
}

/* ── HELPER: หา label จาก perm key ── */
function getPermLabel(key) {
  return getAllPerms().find((p) => p.key === key)?.label || key;
}

/* ── HELPER: หา module ที่ perm นั้นอยู่ ── */
function getPermModule(key) {
  return ERP_MODULES.find((m) => m.perms.some((p) => p.key === key));
}
