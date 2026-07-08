/* ============================================================
   config.js — Supabase Connection Config
   แก้ค่าด้านล่างให้ตรงกับโปรเจกต์ Supabase ของคุณ
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: "https://dtiynydgkcqausqktreg.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
  /* ── Google Drive storage (default ทั้งระบบ) ──
     bucket ที่ย้ายไป Drive แล้ว → route ผ่าน proxy อัตโนมัติทุกเครื่องที่ login (ไม่ต้องตั้ง localStorage มือ)
     DRIVE_KEY = gate กัน bot อัปมั่ว (exposure ระดับเดียวกับ anon key ด้านบน) */
  DRIVE_PROXY: "https://a4s-erp-proxy.onrender.com",
  DRIVE_KEY: "e8a34e421ad649830e5da29bff37b9e2ec729c4e252ab337",
  DRIVE_BUCKETS: "product-images,event-files,tour-seat-images",
};

/* sync ลง localStorage เพื่อให้ทุกหน้าอ่านได้เหมือนเดิม */
localStorage.setItem("sb_url", window.APP_CONFIG.SUPABASE_URL);
localStorage.setItem("sb_key", window.APP_CONFIG.SUPABASE_KEY);
/* Drive routing — เติมให้ทุกคนที่ login (imageCompressor.js อ่าน localStorage นี้เอง) */
localStorage.setItem("erp_proxy_url", window.APP_CONFIG.DRIVE_PROXY);
localStorage.setItem("erp_drive_key", window.APP_CONFIG.DRIVE_KEY);
localStorage.setItem("erp_drive_buckets", window.APP_CONFIG.DRIVE_BUCKETS);
localStorage.setItem("erp_drive_storage", "1");
