-- ============================================================
-- CONTRALABOS — SUPABASE STORAGE SETUP
-- ------------------------------------------------------------
-- Run this AFTER schema.sql and functions.sql. Creates the three
-- storage buckets Contralabos uses and their access policies.
--
-- Note on scope: these policies keep files readable/writable by
-- any signed-in user (not strictly org-scoped at the storage layer
-- itself) — simple and correct for a single-organization or small
-- deployment. The DATABASE ROWS that reference these files (in
-- documents/progress_media/profiles tables) ARE fully org-scoped
-- via the RLS policies in schema.sql. For a multi-tenant product
-- with many unrelated organizations, you'd want to also embed
-- org_id into the storage path and check it here — noted as a
-- known simplification, not an oversight.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', true),
  ('documents', 'documents', false),
  ('progress-media', 'progress-media', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------- AVATARS (public read, owner-only write) ----------------
DROP POLICY IF EXISTS "avatar images are publicly readable" ON storage.objects;
CREATE POLICY "avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "users upload their own avatar" ON storage.objects;
CREATE POLICY "users upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "users update their own avatar" ON storage.objects;
CREATE POLICY "users update their own avatar"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------- DOCUMENTS (any signed-in user) ----------------
DROP POLICY IF EXISTS "signed-in users read documents" ON storage.objects;
CREATE POLICY "signed-in users read documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "signed-in users upload documents" ON storage.objects;
CREATE POLICY "signed-in users upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

-- ---------------- PROGRESS MEDIA (any signed-in user) ----------------
DROP POLICY IF EXISTS "signed-in users read progress media" ON storage.objects;
CREATE POLICY "signed-in users read progress media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'progress-media' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "signed-in users upload progress media" ON storage.objects;
CREATE POLICY "signed-in users upload progress media"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'progress-media' AND auth.uid() IS NOT NULL);
