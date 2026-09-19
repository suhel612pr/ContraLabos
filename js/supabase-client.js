/* ============================================================
   CONTRALABOS — SUPABASE CONFIGURATION
   ------------------------------------------------------------
   Fill in these two values from your Supabase project:
   Dashboard → Project Settings → API → "Project URL" and
   "anon public" key (NOT the service_role key — that one must
   never appear in frontend code, it bypasses Row Level Security).
   ============================================================ */

const SUPABASE_URL = "https://fflsyatamiuphfusulqf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmbHN5YXRhbWl1cGhmdXN1bHFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTc3OTMsImV4cCI6MjEwNDc5Mzc5M30.Osxzhf77D-T6HaVmJ3v0ftJxSDIs90ODnH4ht9l1O4s";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
