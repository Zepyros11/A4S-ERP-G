/* ============================================================
   register-config.js — Public Supabase config for register.html

   ⚠️  These are PUBLIC values (anon key) — safe to commit to git.
   Real protection comes from Row Level Security (RLS) policies
   in Supabase, NOT from hiding these keys.

   To find your values:
     1. Supabase Dashboard → Project Settings → API
     2. Copy "Project URL" → sb_url
     3. Copy "anon public" key (NOT service_role!) → sb_key
   ============================================================ */

window.REGISTER_CONFIG = {
  // REPLACE with your Supabase project URL:
  sb_url: "https://dtiynydgkcqausqktreg.supabase.co",

  // REPLACE with your ANON (public) key — NOT service_role:
  sb_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...(key จริง)",
};
