/* ============================================================
   portal-config.js — Public Supabase config for IBD Portal
   ⚠️  PUBLIC values (anon key) — safe to commit. Real protection
       comes from RLS policies in sql/056_ibd_storage_rls.sql
   ============================================================ */
window.PORTAL_CONFIG = {
  sb_url: "https://dtiynydgkcqausqktreg.supabase.co",
  sb_key:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
  storage_bucket: "ibd-attachments",
  // ai-proxy URL — used for LINE notification when a member submits
  // (e.g. "https://your-proxy.onrender.com" or "http://localhost:3001")
  // Leave empty to disable notifications (form submission still works).
  proxy_url: "https://a4s-erp-proxy.onrender.com",
};
