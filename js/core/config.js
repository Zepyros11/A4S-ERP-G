/* ============================================================
   config.js — Supabase / Google Drive Connection Config
   ------------------------------------------------------------
   รองรับ 2 สภาพแวดล้อมพร้อมกันช่วงย้ายไปบัญชีบริษัท (ดู docs/MIGRATION-2026-08.md)
     • a4scontent.github.io          → Supabase + proxy ของบริษัท (ใหม่)
     • zepyros11.github.io / อื่นๆ    → ของเดิม (production ที่ใช้อยู่)

   localStorage แยกตาม origin อยู่แล้ว → 2 ระบบไม่กวนกัน
   ทดสอบบนเครื่อง (localhost) ให้ชี้ของใหม่:
     localStorage.setItem('erp_env','new')   แล้ว reload
     localStorage.removeItem('erp_env')      = กลับของเดิม
   ============================================================ */
window.ERP_IS_NEW =
  window.ERP_IS_NEW ??
  (localStorage.getItem("erp_env") === "new" ||
    location.hostname.startsWith("a4scontent"));

window.APP_CONFIG = window.ERP_IS_NEW
  ? {
      /* ── บัญชีบริษัท (a4scontent) ── */
      SUPABASE_URL: "https://egnwfmdsqtxxyhyajnnu.supabase.co",
      SUPABASE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc",
      DRIVE_PROXY: "https://a4s-erp-proxy-new.onrender.com",
      DRIVE_KEY: "7f2f204a8636f7136e23ec84924d691bde6879086605ece1",
      DRIVE_BUCKETS:
        "product-images,event-files,tour-seat-images,promotion-files,manual-files,web-images",
    }
  : {
      /* ── บัญชีเดิม (zepyros11) — production ปัจจุบัน ── */
      SUPABASE_URL: "https://dtiynydgkcqausqktreg.supabase.co",
      SUPABASE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
      /* ── Google Drive storage (default ทั้งระบบ) ──
         bucket ที่ย้ายไป Drive แล้ว → route ผ่าน proxy อัตโนมัติทุกเครื่องที่ login (ไม่ต้องตั้ง localStorage มือ)
         DRIVE_KEY = gate กัน bot อัปมั่ว (exposure ระดับเดียวกับ anon key ด้านบน) */
      DRIVE_PROXY: "https://a4s-erp-proxy.onrender.com",
      DRIVE_KEY: "e8a34e421ad649830e5da29bff37b9e2ec729c4e252ab337",
      DRIVE_BUCKETS:
        "product-images,event-files,tour-seat-images,promotion-files,manual-files,web-images",
    };

/* sync ลง localStorage เพื่อให้ทุกหน้าอ่านได้เหมือนเดิม */
localStorage.setItem("sb_url", window.APP_CONFIG.SUPABASE_URL);
localStorage.setItem("sb_key", window.APP_CONFIG.SUPABASE_KEY);
/* Drive routing — เติมให้ทุกคนที่ login (imageCompressor.js อ่าน localStorage นี้เอง) */
localStorage.setItem("erp_proxy_url", window.APP_CONFIG.DRIVE_PROXY);
localStorage.setItem("erp_drive_key", window.APP_CONFIG.DRIVE_KEY);
localStorage.setItem("erp_drive_buckets", window.APP_CONFIG.DRIVE_BUCKETS);
localStorage.setItem("erp_drive_storage", "1");
