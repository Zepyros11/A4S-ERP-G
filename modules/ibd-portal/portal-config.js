/* ============================================================
   portal-config.js — Public Supabase config for IBD Portal
   ⚠️  PUBLIC values (anon key) — safe to commit. Real protection
       comes from RLS policies in sql/056_ibd_storage_rls.sql

   env switch — ดู js/core/config.js + docs/MIGRATION-2026-08.md
   ============================================================ */
window.ERP_IS_NEW =
  window.ERP_IS_NEW ??
  (localStorage.getItem("erp_env") === "new" ||
    location.hostname.startsWith("a4scontent"));

window.PORTAL_CONFIG = window.ERP_IS_NEW
  ? {
      sb_url: "https://egnwfmdsqtxxyhyajnnu.supabase.co",
      sb_key:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc",
      storage_bucket: "ibd-attachments",
      proxy_url: "https://a4s-erp-proxy-new.onrender.com",
    }
  : {
      sb_url: "https://dtiynydgkcqausqktreg.supabase.co",
      sb_key:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
      storage_bucket: "ibd-attachments",
      // ai-proxy URL — used for LINE notification when a member submits
      // Leave empty to disable notifications (form submission still works).
      proxy_url: "https://a4s-erp-proxy.onrender.com",
    };
