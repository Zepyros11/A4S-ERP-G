/* ============================================================
   web-view-config.js — Public config สำหรับเว็บไซต์สาธารณะ
   ============================================================
   หน้า web-view.html ไม่ได้ login → อ่าน localStorage sb_url/sb_key ไม่ได้
   (ค่านั้น js/core/config.js เป็นคนใส่ ซึ่งโหลดเฉพาะหน้าใน ERP)
   จึงต้องมี anon key ตรงนี้ — เหมือน register-config.js / portal-config.js

   anon key เป็นค่าสาธารณะโดยออกแบบ ไม่ใช่ความลับ
   ความปลอดภัยจริงมาจากสิทธิ์ระดับตารางใน Supabase ไม่ใช่การซ่อน key นี้

   env switch — ดู js/core/config.js + docs/MIGRATION-2026-08.md
   ============================================================ */
window.ERP_IS_NEW =
  window.ERP_IS_NEW ??
  (localStorage.getItem("erp_env") === "new" ||
    location.hostname.startsWith("a4scontent"));

window.WEB_VIEW_CONFIG = window.ERP_IS_NEW
  ? {
      sb_url: "https://egnwfmdsqtxxyhyajnnu.supabase.co",
      sb_key:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc",
    }
  : {
      sb_url: "https://dtiynydgkcqausqktreg.supabase.co",
      sb_key:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
    };
