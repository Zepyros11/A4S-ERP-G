/* env switch — ดู js/core/config.js + docs/MIGRATION-2026-08.md */
window.ERP_IS_NEW =
  window.ERP_IS_NEW ??
  (localStorage.getItem("erp_env") !== "old");

window.supabaseConfig = window.ERP_IS_NEW
  ? {
      url: "https://egnwfmdsqtxxyhyajnnu.supabase.co",
      anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc",
    }
  : {
      url: "https://dtiynydgkcqausqktreg.supabase.co",
      anon: "sb_publishable_erMV0G_pNtPTYq-3frqv1Q_sIJ7KILD",
    };
