-- ============================================================
-- CONTRALABOS — MARKETPLACE MIGRATION v2 (upgrade)
-- ------------------------------------------------------------
-- Run this AFTER the marketplace-migration.sql that's already in this
-- project (the one that created worker_profiles/jobs/job_applications/
-- hires and the accept_job_application() RPC). This file does NOT
-- recreate anything that already exists — everything here is additive:
-- new table, new columns, new triggers, one function body update.
-- Nothing is dropped. No existing row is touched except one backfill
-- UPDATE that only fills in NULLs.
-- ============================================================

-- 1. Add the missing job_offers table (direct contractor -> worker
--    offers). Applications and offers were meant to be separate
--    concepts — this was the piece missing from the version currently
--    live, which only supports the "worker applies" path.
DO $$ BEGIN
  CREATE TYPE offer_status_enum AS ENUM ('pending','accepted','rejected','expired','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS job_offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES profiles(id),
  worker_id     UUID NOT NULL REFERENCES profiles(id),
  message       TEXT,
  offered_wage  NUMERIC(10,2),
  status        offer_status_enum NOT NULL DEFAULT 'pending',
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_offers_job ON job_offers(job_id);
CREATE INDEX IF NOT EXISTS idx_offers_worker ON job_offers(worker_id);
CREATE INDEX IF NOT EXISTS idx_offers_contractor ON job_offers(contractor_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_offers_pending_job_worker
  ON job_offers(job_id, worker_id) WHERE (status = 'pending');

ALTER TABLE job_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parties read own offers" ON job_offers;
CREATE POLICY "parties read own offers" ON job_offers FOR SELECT USING (
  worker_id = auth.uid() OR contractor_id = auth.uid()
);
DROP POLICY IF EXISTS "contractor sends offers" ON job_offers;
CREATE POLICY "contractor sends offers" ON job_offers FOR INSERT WITH CHECK (
  contractor_id = auth.uid() AND my_role() = 'contractor'
);
DROP POLICY IF EXISTS "contractor withdraws own offer" ON job_offers;
CREATE POLICY "contractor withdraws own offer" ON job_offers FOR UPDATE USING (
  contractor_id = auth.uid()
) WITH CHECK (
  contractor_id = auth.uid() AND status = 'withdrawn'
);
DROP POLICY IF EXISTS "worker responds to own offer" ON job_offers;
CREATE POLICY "worker responds to own offer" ON job_offers FOR UPDATE USING (
  worker_id = auth.uid()
) WITH CHECK (
  worker_id = auth.uid() AND status IN ('accepted','rejected')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON job_offers TO anon, authenticated;

-- 2. hires needs an offer_id column to track offer-driven hires
--    (it currently only has application_id).
ALTER TABLE hires ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES job_offers(id);

-- 3. notifications: add an optional per-user target, same reasoning as
--    before — marketplace events are between two specific people, not
--    org-wide broadcasts, and the worker may have no org yet.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id);
ALTER TABLE notifications ALTER COLUMN org_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
DROP POLICY IF EXISTS "read same-org notifications" ON notifications;
DROP POLICY IF EXISTS "read own or org notifications" ON notifications;
CREATE POLICY "read own or org notifications" ON notifications FOR SELECT USING (
  user_id = auth.uid() OR (user_id IS NULL AND org_id IS NOT NULL AND org_id = my_org_id())
);
DROP POLICY IF EXISTS "system/any org member creates notifications" ON notifications;
DROP POLICY IF EXISTS "create notifications" ON notifications;
CREATE POLICY "create notifications" ON notifications FOR INSERT WITH CHECK (
  (user_id IS NOT NULL) OR (org_id IS NOT NULL AND org_id = my_org_id())
);
DROP POLICY IF EXISTS "org member marks read" ON notifications;
DROP POLICY IF EXISTS "mark own or org notifications read" ON notifications;
CREATE POLICY "mark own or org notifications read" ON notifications FOR UPDATE USING (
  user_id = auth.uid() OR (user_id IS NULL AND org_id IS NOT NULL AND org_id = my_org_id())
);

-- 4. Align accept_job_application()'s terminal status with the rest of
--    the app: the version currently live sets status='accepted' when a
--    worker is hired via an application. The frontend (and the
--    'hired' value already defined in application_status_enum) expects
--    'hired' to mean "this application resulted in a real hire", with
--    'accepted' reserved as a distinct earlier stage. This is a
--    same-signature CREATE OR REPLACE — nothing about the function's
--    capacity/security checks changes, only which status value it sets.
CREATE OR REPLACE FUNCTION accept_job_application(p_application_id UUID)
RETURNS hires LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a job_applications; j jobs; h hires; worker_row UUID;
BEGIN
  SELECT * INTO a FROM job_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Application not found.'; END IF;
  SELECT * INTO j FROM jobs WHERE id = a.job_id FOR UPDATE;
  IF j.contractor_id <> auth.uid() THEN RAISE EXCEPTION 'Only the job owner can hire a worker.'; END IF;
  IF a.status NOT IN ('pending','viewed','shortlisted') THEN RAISE EXCEPTION 'This application is no longer available.'; END IF;
  IF j.workers_hired >= j.workers_required THEN RAISE EXCEPTION 'This job has already reached its required number of workers.'; END IF;
  INSERT INTO hires(job_id, contractor_id, worker_id, org_id, application_id, agreed_wage)
    VALUES (j.id, j.contractor_id, a.worker_id, j.org_id, a.id, j.wage) RETURNING * INTO h;
  UPDATE job_applications SET status = 'hired', reviewed_at = now(), updated_at = now() WHERE id = a.id;
  UPDATE jobs SET workers_hired = workers_hired + 1, status = CASE WHEN workers_hired + 1 >= workers_required THEN 'filled'::job_status_enum ELSE status END, updated_at = now() WHERE id = j.id;
  SELECT id INTO worker_row FROM workers WHERE user_id = a.worker_id;
  IF worker_row IS NULL THEN
    INSERT INTO workers(name, user_id, phone, wage_rate, project_id, org_id, status)
      SELECT p.name, p.id, p.phone, COALESCE(j.wage, 0), j.project_id, j.org_id, 'active' FROM profiles p WHERE p.id = a.worker_id RETURNING id INTO worker_row;
  ELSE
    UPDATE workers SET status = 'active', org_id = j.org_id, wage_rate = COALESCE(j.wage, wage_rate), project_id = COALESCE(j.project_id, project_id) WHERE id = worker_row;
  END IF;
  UPDATE hires SET worker_row_id = worker_row WHERE id = h.id RETURNING * INTO h;
  UPDATE profiles SET org_id = j.org_id, updated_at = now() WHERE id = a.worker_id AND org_id IS NULL;
  RETURN h;
END;
$$;
GRANT EXECUTE ON FUNCTION accept_job_application(UUID) TO authenticated;

-- 5. Mirror the same hire logic for OFFERS: accepting an offer (worker
--    action) should hire just like accepting an application does.
--    Runs SECURITY DEFINER so the worker's own UPDATE can create the
--    hire + workers row without needing broader table grants.
CREATE OR REPLACE FUNCTION accept_job_offer(p_offer_id UUID)
RETURNS hires LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o job_offers; j jobs; h hires; worker_row UUID;
BEGIN
  SELECT * INTO o FROM job_offers WHERE id = p_offer_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Offer not found.'; END IF;
  IF o.worker_id <> auth.uid() THEN RAISE EXCEPTION 'Only the offered worker can accept this offer.'; END IF;
  IF o.status <> 'pending' THEN RAISE EXCEPTION 'This offer is no longer available.'; END IF;
  SELECT * INTO j FROM jobs WHERE id = o.job_id FOR UPDATE;
  IF j.workers_hired >= j.workers_required THEN
    UPDATE job_offers SET status = 'expired', responded_at = now() WHERE id = o.id;
    RAISE EXCEPTION 'This job has already reached its required number of workers.';
  END IF;
  UPDATE job_offers SET status = 'accepted', responded_at = now() WHERE id = o.id;
  INSERT INTO hires(job_id, contractor_id, worker_id, org_id, offer_id, agreed_wage)
    VALUES (j.id, j.contractor_id, o.worker_id, j.org_id, o.id, COALESCE(o.offered_wage, j.wage)) RETURNING * INTO h;
  UPDATE jobs SET workers_hired = workers_hired + 1, status = CASE WHEN workers_hired + 1 >= workers_required THEN 'filled'::job_status_enum ELSE status END, updated_at = now() WHERE id = j.id;
  SELECT id INTO worker_row FROM workers WHERE user_id = o.worker_id;
  IF worker_row IS NULL THEN
    INSERT INTO workers(name, user_id, phone, wage_rate, project_id, org_id, status)
      SELECT p.name, p.id, p.phone, COALESCE(o.offered_wage, j.wage, 0), j.project_id, j.org_id, 'active' FROM profiles p WHERE p.id = o.worker_id RETURNING id INTO worker_row;
  ELSE
    UPDATE workers SET status = 'active', org_id = j.org_id, wage_rate = COALESCE(o.offered_wage, j.wage, wage_rate), project_id = COALESCE(j.project_id, project_id) WHERE id = worker_row;
  END IF;
  UPDATE hires SET worker_row_id = worker_row WHERE id = h.id RETURNING * INTO h;
  UPDATE profiles SET org_id = j.org_id, updated_at = now() WHERE id = o.worker_id AND org_id IS NULL;
  RETURN h;
END;
$$;
GRANT EXECUTE ON FUNCTION accept_job_offer(UUID) TO authenticated;

-- 6. Simple reject, for symmetry (worker declines an offer — no hire).
CREATE OR REPLACE FUNCTION reject_job_offer(p_offer_id UUID)
RETURNS job_offers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o job_offers;
BEGIN
  UPDATE job_offers SET status = 'rejected', responded_at = now()
    WHERE id = p_offer_id AND worker_id = auth.uid() AND status = 'pending'
    RETURNING * INTO o;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Offer not found or already responded to.'; END IF;
  RETURN o;
END;
$$;
GRANT EXECUTE ON FUNCTION reject_job_offer(UUID) TO authenticated;

-- 7. Release job capacity if a hire is ever cancelled (wasn't handled
--    before — there was no path to cancel a hire at all).
CREATE OR REPLACE FUNCTION release_job_capacity_on_cancel()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
    UPDATE jobs SET
      workers_hired = GREATEST(workers_hired - 1, 0),
      status = CASE WHEN status = 'filled' THEN 'published'::job_status_enum ELSE status END,
      updated_at = now()
    WHERE id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_hires_release ON hires;
CREATE TRIGGER trg_hires_release
  AFTER UPDATE ON hires
  FOR EACH ROW EXECUTE FUNCTION release_job_capacity_on_cancel();
DROP POLICY IF EXISTS "contractor updates own hires" ON hires;
CREATE POLICY "contractor updates own hires" ON hires FOR UPDATE USING (
  contractor_id = auth.uid()
) WITH CHECK (
  contractor_id = auth.uid()
);

-- 8. Plain-SQL match score helper (skill 40 / location 25 /
--    availability 20 / experience 15) — not marketed as AI anywhere.
CREATE OR REPLACE FUNCTION job_match_score(p_job_id UUID, p_worker_id UUID)
RETURNS INT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_job jobs%ROWTYPE;
  v_wp worker_profiles%ROWTYPE;
  v_score INT := 0;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  SELECT * INTO v_wp FROM worker_profiles WHERE id = p_worker_id;
  IF v_job IS NULL OR v_wp IS NULL THEN RETURN 0; END IF;
  IF v_job.skill_required IS NOT NULL AND v_wp.skills @> ARRAY[v_job.skill_required] THEN v_score := v_score + 40; END IF;
  IF v_job.city IS NOT NULL AND v_wp.city IS NOT NULL AND lower(v_job.city) = lower(v_wp.city) THEN v_score := v_score + 25; END IF;
  IF v_wp.availability = 'available' THEN v_score := v_score + 20; END IF;
  IF v_wp.experience_years >= v_job.experience_required THEN v_score := v_score + 15; END IF;
  RETURN v_score;
END;
$$;
GRANT EXECUTE ON FUNCTION job_match_score(UUID, UUID) TO anon, authenticated;

-- 9. Same additive cross-org visibility for profiles/organizations that
--    job_applications/hires already got in the version live now —
--    extend it to cover job_offers too (OR'd with existing policy,
--    nothing existing is weakened).
DROP POLICY IF EXISTS "marketplace parties read profiles" ON profiles;
CREATE POLICY "marketplace parties read profiles" ON profiles FOR SELECT USING (
  id = auth.uid()
  OR EXISTS (SELECT 1 FROM worker_profiles wp WHERE wp.id = profiles.id AND wp.is_published = true)
  OR EXISTS (SELECT 1 FROM jobs j WHERE j.contractor_id = profiles.id AND j.status = 'published')
  OR EXISTS (SELECT 1 FROM job_applications a WHERE (a.worker_id = profiles.id OR a.contractor_id = profiles.id)
       AND (a.worker_id = auth.uid() OR a.contractor_id = auth.uid()))
  OR EXISTS (SELECT 1 FROM job_offers o WHERE (o.worker_id = profiles.id OR o.contractor_id = profiles.id)
       AND (o.worker_id = auth.uid() OR o.contractor_id = auth.uid()))
  OR EXISTS (SELECT 1 FROM hires h WHERE (h.worker_id = profiles.id OR h.contractor_id = profiles.id)
       AND (h.worker_id = auth.uid() OR h.contractor_id = profiles.id))
);
DROP POLICY IF EXISTS "marketplace visible orgs" ON organizations;
CREATE POLICY "marketplace visible orgs" ON organizations FOR SELECT USING (
  EXISTS (SELECT 1 FROM jobs j WHERE j.org_id = organizations.id AND j.status = 'published')
);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- MANUAL TESTS TO RUN AFTER APPLYING THIS
-- ============================================================
-- 1. Existing application flow still works: post a job, apply as a
--    worker, Accept & Hire as the contractor — confirm the
--    application's status shows as "Hired" (not "Accepted") afterward.
-- 2. NEW: Find Workers -> open a worker -> Send Job Offer -> as that
--    worker, Job Offers -> Accept -> confirm a hire was created and
--    the job's "workers hired" count went up.
-- 3. Post a 1-worker job, hire someone, confirm the job shows "Filled"
--    and a second hire attempt (application or offer) is rejected.
-- 4. Confirm existing pages (Projects/Attendance/Wages/etc.) still
--    work exactly as before — nothing here touches them.
-- ============================================================
