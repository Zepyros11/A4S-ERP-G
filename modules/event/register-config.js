/* ============================================================
   register-config.js — Public Supabase config for register.html

   ⚠️  These are PUBLIC values (anon key) — safe to commit to git.
   Real protection comes from Row Level Security (RLS) policies
   in Supabase, NOT from hiding these keys.

   To find your values:
     1. Supabase Dashboard → Project Settings → API
     2. Copy "Project URL" → sb_url
     3. Copy "anon public" key (NOT service_role!) → sb_key

   env switch — ดู js/core/config.js + docs/MIGRATION-2026-08.md
   ============================================================ */
window.ERP_IS_NEW =
  window.ERP_IS_NEW ??
  (localStorage.getItem("erp_env") !== "old");

window.REGISTER_CONFIG = window.ERP_IS_NEW
  ? {
      sb_url: "https://egnwfmdsqtxxyhyajnnu.supabase.co",
      sb_key:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc",
      proxy_url: "https://a4s-erp-proxy-new.onrender.com",
    }
  : {
      sb_url: "https://dtiynydgkcqausqktreg.supabase.co",
      sb_key:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
      // ai-proxy URL — used by "เชื่อม LINE" button to call /line/preauth
      // (auto-link flow: server verifies password → ออก token → ฝังใน deep link)
      // Leave empty to fall back to old "send code only, then type password in chat" flow
      proxy_url: "https://a4s-erp-proxy.onrender.com",
    };
