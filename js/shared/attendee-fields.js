/* ============================================================
   attendee-fields.js — 📇 Model กลางของฟอร์มลงทะเบียนผู้เข้าร่วม (Block-based)
   ------------------------------------------------------------
   ใช้ร่วมกัน 2 หน้า:
     • attendee-templates.js  — ตัวแก้ template (block builder)
     • attendees.js           — ฟอร์มลงทะเบียน + ตาราง

   โครงสร้าง config (ใหม่):
     {
       blocks: [
         { id, title, items: [ItemSpec, ...] }, ...
       ],
       // + flat keys (derive จาก blocks ตอน save) เพื่อ backward-compat กับ
       //   ตาราง/ระบบ save เดิมของ attendees: fields, field_order, custom_fields, qualifications
     }

   ItemSpec:
     { type:"core",  key:"member_code"|"name" }          // ล็อก ลบไม่ได้
     { type:"std",   key:<STD key>, label?, required? }  // ฟิลด์มาตรฐาน → DB column
     { type:"text"|"date"|"number", key, label, required? } // → extra_fields (JSONB)
     { type:"stamp", key, label }                         // ผู้บันทึก — ปั๊มชื่อ user ที่เพิ่ม → extra_fields (readonly)
     { type:"check", key, label }                         // ติ๊กถูก → extra_fields (boolean)
============================================================ */
(function () {
  // ── ฟิลด์มาตรฐาน (map → DB column ใน event_attendees) ──────
  const STD_FIELDS = {
    phone:        { label: "เบอร์โทร" },
    position:     { label: "ตำแหน่ง" },
    upline:       { label: "สายงาน" },
  };
  const STD_ORDER = ["phone", "position", "upline"];

  // ── Core fields (ล็อก — อยู่ในฟอร์มเสมอ) ───────────────────
  const CORE_FIELDS = {
    member_code: { label: "รหัส" },
    name:        { label: "ชื่อ-นามสกุล" },
  };

  const ITEM_TYPES = {
    core:   { label: "ระบบ",      icon: "🔒" },
    std:    { label: "มาตรฐาน",   icon: "📋" },
    text:   { label: "ข้อความ",   icon: "📝" },
    date:   { label: "วันที่",    icon: "📅" },
    number: { label: "ตัวเลข",    icon: "🔢" },
    check:  { label: "ติ๊กถูก",   icon: "✓" },
    stamp:  { label: "ผู้บันทึก", icon: "👤" },  // ปั๊มชื่อ user ที่เพิ่มรายชื่อ (auto, readonly)
    persontype: { label: "สถานะ", icon: "🪪" }, // ชนิดผู้เข้าร่วม (สมาชิก/ผู้สมัครร่วม/Guest) — auto, readonly
    nationalid: { label: "บัตรประชาชน", icon: "🆔" }, // สมาชิก → ดึง+ถอดรหัสจากข้อมูลสมาชิก (auto) · guest → กรอกมือ
  };

  let _seq = 0;
  function newId(prefix) {
    _seq += 1;
    return `${prefix || "id"}_${Date.now().toString(36)}_${_seq}`;
  }

  // slug → key สำหรับฟิลด์ text/date/number/check
  function slugKey(label, prefix) {
    const base = (prefix || "cf_") + String(label || "").toLowerCase()
      .replace(/[^\p{L}\p{N}\s_]/gu, "").replace(/\s+/g, "_").slice(0, 36);
    return base || (prefix || "cf_") + Date.now().toString(36);
  }

  // ── blocks → flat (สำหรับตาราง/ระบบ save เดิมของ attendees) ─
  function blocksToFlat(blocks) {
    const fields = {};
    const field_order = [];
    const custom_fields = [];
    const qualifications = [];
    (Array.isArray(blocks) ? blocks : []).forEach(b => {
      (Array.isArray(b.items) ? b.items : []).forEach(it => {
        if (!it || !it.type) return;
        if (it.type === "std" && STD_FIELDS[it.key]) {
          const f = { show: true, column: true, required: !!it.required };
          if (it.label && it.label !== STD_FIELDS[it.key].label) f.label = it.label;
          fields[it.key] = f;
          if (!field_order.includes(it.key)) field_order.push(it.key);
        } else if (it.type === "text" || it.type === "date" || it.type === "number" || it.type === "stamp" || it.type === "persontype" || it.type === "nationalid") {
          if (it.key && it.label) custom_fields.push({ key: it.key, label: it.label, ftype: it.type, required: !!it.required });
        } else if (it.type === "check") {
          if (it.key && it.label) qualifications.push({ key: it.key, label: it.label });
        }
        // core → ไม่ลงใน flat (name/member_code จัดการ native)
      });
    });
    // std ที่ไม่ได้อยู่ใน block ไหนเลย → show:false (ฟอร์ม/ตารางซ่อน)
    STD_ORDER.forEach(k => {
      if (!fields[k]) fields[k] = { show: false, column: false, required: false };
    });
    return { fields, field_order, custom_fields, qualifications };
  }

  // ── flat (config เก่า) → blocks (สำหรับโหลด template เดิม) ──
  function flatToBlocks(flat) {
    const f = flat || {};
    const order = (Array.isArray(f.field_order) && f.field_order.length) ? f.field_order : STD_ORDER;
    const seen = new Set();
    const stdItems = [];
    order.forEach(k => {
      if (!STD_FIELDS[k] || seen.has(k)) return;
      if (f.fields && f.fields[k] && f.fields[k].show === false) return;
      seen.add(k);
      stdItems.push({ type: "std", key: k, label: f.fields?.[k]?.label, required: !!f.fields?.[k]?.required });
    });
    const blocks = [{
      id: newId("blk"),
      title: "ฟิลด์มาตรฐาน",
      items: [{ type: "core", key: "member_code" }, { type: "core", key: "name" }, ...stdItems],
    }];
    const customItems = (Array.isArray(f.custom_fields) ? f.custom_fields : [])
      .filter(cf => cf && cf.key && cf.label)
      .map(cf => ({ type: cf.ftype || "text", key: cf.key, label: cf.label, required: !!cf.required }));
    if (customItems.length) blocks.push({ id: newId("blk"), title: "ฟิลด์เพิ่มเติม", items: customItems });
    const qualItems = (Array.isArray(f.qualifications) ? f.qualifications : [])
      .filter(q => q && q.key && q.label)
      .map(q => ({ type: "check", key: q.key, label: q.label }));
    if (qualItems.length) blocks.push({ id: newId("blk"), title: "เงื่อนไขเพิ่มเติม", items: qualItems });
    return blocks;
  }

  // คืน blocks จาก config (ใช้ blocks ถ้ามี ไม่งั้น derive จาก flat)
  function ensureBlocks(config) {
    const c = config || {};
    if (Array.isArray(c.blocks) && c.blocks.length) {
      return JSON.parse(JSON.stringify(c.blocks));
    }
    return flatToBlocks(c);
  }

  // เซ็ตของ std keys ที่ถูกใช้แล้วในทุก block (กันเพิ่มซ้ำ)
  function usedStdKeys(blocks) {
    const s = new Set();
    (blocks || []).forEach(b => (b.items || []).forEach(it => {
      if (it.type === "std") s.add(it.key);
    }));
    return s;
  }

  window.AttendeeFields = {
    STD_FIELDS, STD_ORDER, CORE_FIELDS, ITEM_TYPES,
    newId, slugKey, blocksToFlat, flatToBlocks, ensureBlocks, usedStdKeys,
  };
})();
