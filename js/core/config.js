/* ============================================================
   config.js — Supabase / Google Drive Connection Config
   ------------------------------------------------------------
   ทุก URL ชี้ Supabase + proxy ของบริษัท (ใหม่) เป็นค่าเริ่มต้น (ดู docs/MIGRATION-2026-08.md)
     • a4scontent.github.io   → ระบบใหม่ (ปลายทางถาวร)
     • zepyros11.github.io    → ระบบใหม่เช่นกัน — เป็นแค่ "หน้ากาก" URL เดิมให้ผู้ใช้
                                ระหว่างยังไม่ประกาศ URL ใหม่ · ฐานข้อมูลเหลือตัวเดียว
                                จึงไม่มีปัญหาข้อมูลแยกสองทางอีก

   ปุ่มถอยฉุกเฉิน (เฉพาะเครื่องที่สั่ง) — ให้กลับไปใช้ Supabase เดิม:
     localStorage.setItem('erp_env','old')   แล้ว reload
     localStorage.removeItem('erp_env')      = กลับมาใช้ระบบใหม่
   ============================================================ */
window.ERP_IS_NEW =
  window.ERP_IS_NEW ??
  (localStorage.getItem("erp_env") !== "old");

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
