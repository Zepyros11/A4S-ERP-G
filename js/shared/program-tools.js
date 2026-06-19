/* ============================================================
   program-tools.js — 🧰 Catalog กลางของ "เครื่องมือ" ใน Operations Hub
   ------------------------------------------------------------
   แหล่งความจริงที่เดียวว่า program (TRIP|EVENT) มีเครื่องมืออะไรได้บ้าง
   และ render/route ยังไง · ใช้คู่กับ programs.enabled_tools (DB บอกว่า
   "เปิดเครื่องมือไหน" — ไฟล์นี้บอก "เครื่องมือนั้นหน้าตา/ลิงก์ยังไง")

   เพิ่มเครื่องมือใหม่ = เพิ่ม 1 entry ใน TOOLS ที่นี่ที่เดียว แล้ว:
     • program-workspace → ปุ่มโผล่อัตโนมัติ (ถ้า type ตรง + เปิดใน enabled_tools + มี perm)
     • create form       → ตัวเลือกเปิด/ปิดเครื่องมือโผล่ตาม availableFor(type)
   พอสร้างหน้าเครื่องมือจริงแล้ว → set ready:true + ใส่ path

   schema ของแต่ละ tool:
     key      : id (ตรงกับค่าใน programs.enabled_tools)
     label    : ชื่อปุ่ม (TH)
     icon     : emoji
     perm     : permission ที่ต้องมีถึงเห็น (MVP ใช้ umbrella program_* ก่อน)
     types    : program_type ที่ใช้เครื่องมือนี้ได้ ['TRIP','EVENT']
     desc     : คำอธิบายสั้นใต้ปุ่ม
     ready    : true = หน้าพร้อมใช้ (เปิด path) / false = stub "เร็วๆ นี้"
     path     : ลิงก์เปิดเครื่องมือ (relative จาก modules/operations/) — ใส่ตอน ready
   ============================================================ */
(function () {
  "use strict";

  // ลำดับใน TOOLS = ลำดับปุ่มใน workspace
  const TOOLS = [
    { key: "participants", label: "รายชื่อผู้เข้าร่วม", icon: "👥", perm: "program_participant_view",
      types: ["TRIP", "EVENT"], desc: "จัดการคน / แขกในโปรแกรม (spine ของทุกเครื่องมือ)", ready: true, path: "program-participants.html" },
    { key: "rooming", label: "จัดห้องพัก", icon: "🏨", perm: "program_room_view",
      types: ["TRIP", "EVENT"], desc: "จับคู่คนเข้าห้อง", ready: true, path: "program-rooming.html" },
    { key: "buses", label: "จัดรถบัส", icon: "🚌", perm: "program_bus_view",
      types: ["TRIP"], desc: "จัดคนขึ้นรถ + ความจุ", ready: true, path: "program-buses.html" },
    { key: "flights", label: "เที่ยวบิน / ตั๋ว", icon: "✈️", perm: "program_flight_view",
      types: ["TRIP"], desc: "กลุ่มเที่ยวบิน + จัดคนขึ้นเครื่อง", ready: true, path: "program-flights.html" },
    { key: "seating", label: "ที่นั่ง / ผังโต๊ะ", icon: "🪑", perm: "program_seating_view",
      types: ["TRIP", "EVENT"], desc: "ผังโต๊ะ banquet / ผังที่นั่งห้องประชุม", ready: true, path: "program-seating.html" },
    { key: "staff", label: "ทีมงาน / Staff", icon: "🧑‍🤝‍🧑", perm: "program_staff_view",
      types: ["TRIP", "EVENT"], desc: "Staff / Guide / Outsource", ready: true, path: "program-staff.html" },
    { key: "tasks", label: "งาน (Task / Gantt)", icon: "📋", perm: "program_task_view",
      types: ["TRIP", "EVENT"], desc: "Task list + Gantt ติดตามผลงาน", ready: true, path: "program-tasks.html" },
    { key: "namecard", label: "ป้ายชื่อ", icon: "🏷️", perm: "program_participant_view",
      types: ["TRIP", "EVENT"], desc: "พิมพ์ป้ายชื่อ / ป้ายตั้งโต๊ะ", ready: true, path: "program-namecard.html" },
    { key: "reports", label: "รายงาน / Export", icon: "📊", perm: "program_view",
      types: ["TRIP", "EVENT"], desc: "เลือกคอลัมน์ → export", ready: true, path: "program-reports.html" },
  ];

  // เครื่องมือที่เปิดให้อัตโนมัติตอนสร้าง program ใหม่ (ปรับได้ตอน create)
  const DEFAULT_TOOLS = {
    TRIP: ["participants", "rooming", "buses", "flights", "staff", "reports"],
    EVENT: ["participants", "seating", "tasks", "namecard", "reports"],
  };

  function byKey(key) {
    return TOOLS.find((t) => t.key === key) || null;
  }

  // เครื่องมือที่ "ใช้ได้" กับ program type นี้ (ไม่สนว่าเปิดอยู่ไหม) — ใช้ใน create form
  function availableFor(type) {
    return TOOLS.filter((t) => t.types.includes(type));
  }

  // default enabled_tools array สำหรับ type (clone กันแก้ของกลาง)
  function defaultsFor(type) {
    return (DEFAULT_TOOLS[type] || []).slice();
  }

  // เครื่องมือที่จะ "แสดงปุ่ม" ใน workspace ของ program นี้:
  //   type ตรง  +  อยู่ใน enabled_tools  +  ผ่าน can(perm) (ถ้าส่ง can มา)
  // program: { program_type, enabled_tools:[] }  ·  can: (perm)=>bool (optional)
  function toolsFor(program, can) {
    const type = program && program.program_type;
    const enabled = Array.isArray(program && program.enabled_tools)
      ? program.enabled_tools : [];
    return TOOLS.filter((t) => {
      if (!t.types.includes(type)) return false;
      if (!enabled.includes(t.key)) return false;
      if (typeof can === "function" && t.perm && !can(t.perm)) return false;
      return true;
    });
  }

  window.ProgramTools = {
    TOOLS,
    DEFAULT_TOOLS,
    byKey,
    availableFor,
    defaultsFor,
    toolsFor,
  };
})();
