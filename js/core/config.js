/* ============================================================
   config.js — Supabase Connection Config
   แก้ค่าด้านล่างให้ตรงกับโปรเจกต์ Supabase ของคุณ
   ============================================================ */
window.APP_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",   // ← เปลี่ยนตรงนี้
  SUPABASE_KEY: "your-anon-key-here",                  // ← เปลี่ยนตรงนี้
};

/* sync ลง localStorage เพื่อให้ทุกหน้าอ่านได้เหมือนเดิม */
localStorage.setItem("sb_url", window.APP_CONFIG.SUPABASE_URL);
localStorage.setItem("sb_key", window.APP_CONFIG.SUPABASE_KEY);
