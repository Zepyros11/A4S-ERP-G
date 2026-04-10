/* ============================================================
   config.js — Supabase Connection Config
   แก้ค่าด้านล่างให้ตรงกับโปรเจกต์ Supabase ของคุณ
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: "https://dtiynydgkcqausqktreg.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
};

/* sync ลง localStorage เพื่อให้ทุกหน้าอ่านได้เหมือนเดิม */
localStorage.setItem("sb_url", window.APP_CONFIG.SUPABASE_URL);
localStorage.setItem("sb_key", window.APP_CONFIG.SUPABASE_KEY);
