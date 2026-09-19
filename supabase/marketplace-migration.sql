-- CONTRALABOS MARKETPLACE MIGRATION (Phase 2)
-- Run after schema.sql, functions.sql, and storage.sql.
-- This is the Claude-compatible marketplace schema used by the frontend.

ALTER TABLE profiles ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
UPDATE workers w SET org_id = p.org_id FROM projects p WHERE w.project_id = p.id AND w.org_id IS NULL;
ALTER TABLE workers ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE workers ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workers_org ON workers(org_id);

DO $$ BEGIN CREATE TYPE worker_type_enum AS ENUM ('skilled','unskilled','semi_skilled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE availability_enum AS ENUM ('available','busy','unavailable'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE wage_type_enum AS ENUM ('daily','weekly','monthly','fixed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE job_status_enum AS ENUM ('draft','published','paused','filled','active','completed','cancelled','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE application_status_enum AS ENUM ('pending','viewed','shortlisted','accepted','rejected','withdrawn','hired','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE hire_status_enum AS ENUM ('active','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS worker_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  worker_type worker_type_enum, skills TEXT[] NOT NULL DEFAULT '{}',
  experience_years NUMERIC(4,1) NOT NULL DEFAULT 0, city TEXT, area TEXT,
  availability availability_enum NOT NULL DEFAULT 'available', expected_wage NUMERIC(10,2),
  expected_wage_type wage_type_enum, bio TEXT, is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE worker_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "browse published worker profiles" ON worker_profiles;
CREATE POLICY "browse published worker profiles" ON worker_profiles FOR SELECT USING (is_published = true OR id = auth.uid());
DROP POLICY IF EXISTS "worker manages own marketplace profile" ON worker_profiles;
CREATE POLICY "worker manages own marketplace profile" ON worker_profiles FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), contractor_id UUID NOT NULL REFERENCES profiles(id),
  org_id UUID NOT NULL REFERENCES organizations(id), title TEXT NOT NULL, description TEXT,
  category TEXT, skill_required TEXT, worker_type worker_type_enum, workers_required INT NOT NULL DEFAULT 1 CHECK (workers_required > 0),
  workers_hired INT NOT NULL DEFAULT 0 CHECK (workers_hired >= 0), city TEXT, area TEXT, address TEXT,
  wage NUMERIC(10,2), wage_type wage_type_enum, start_date DATE, end_date DATE, working_hours TEXT,
  experience_required NUMERIC(4,1) NOT NULL DEFAULT 0, urgency TEXT, additional_requirements TEXT,
  status job_status_enum NOT NULL DEFAULT 'draft', project_id UUID REFERENCES projects(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (workers_hired <= workers_required)
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "browse published jobs" ON jobs;
CREATE POLICY "browse published jobs" ON jobs FOR SELECT USING (status = 'published' OR contractor_id = auth.uid() OR org_id = my_org_id());
DROP POLICY IF EXISTS "contractor creates own jobs" ON jobs;
CREATE POLICY "contractor creates own jobs" ON jobs FOR INSERT WITH CHECK (contractor_id = auth.uid() AND org_id = my_org_id() AND my_role() = 'contractor');
DROP POLICY IF EXISTS "contractor updates own jobs" ON jobs;
CREATE POLICY "contractor updates own jobs" ON jobs FOR UPDATE USING (contractor_id = auth.uid()) WITH CHECK (contractor_id = auth.uid());
DROP POLICY IF EXISTS "contractor deletes own jobs" ON jobs;
CREATE POLICY "contractor deletes own jobs" ON jobs FOR DELETE USING (contractor_id = auth.uid());

CREATE TABLE IF NOT EXISTS job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES profiles(id), contractor_id UUID NOT NULL REFERENCES profiles(id),
  message TEXT, status application_status_enum NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ, UNIQUE(job_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_job ON job_applications(job_id);
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parties read own applications" ON job_applications;
CREATE POLICY "parties read own applications" ON job_applications FOR SELECT USING (worker_id = auth.uid() OR contractor_id = auth.uid());
DROP POLICY IF EXISTS "worker applies to jobs" ON job_applications;
CREATE POLICY "worker applies to jobs" ON job_applications FOR INSERT WITH CHECK (worker_id = auth.uid() AND my_role() = 'worker' AND EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND status = 'published'));
DROP POLICY IF EXISTS "contractor reviews applications to own jobs" ON job_applications;
CREATE POLICY "contractor reviews applications to own jobs" ON job_applications FOR UPDATE USING (contractor_id = auth.uid()) WITH CHECK (contractor_id = auth.uid());

CREATE TABLE IF NOT EXISTS hires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID NOT NULL REFERENCES jobs(id),
  contractor_id UUID NOT NULL REFERENCES profiles(id), worker_id UUID NOT NULL REFERENCES profiles(id),
  org_id UUID NOT NULL REFERENCES organizations(id), application_id UUID REFERENCES job_applications(id),
  worker_row_id UUID REFERENCES workers(id), agreed_wage NUMERIC(10,2),
  status hire_status_enum NOT NULL DEFAULT 'active', hired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  start_date DATE, end_date DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(job_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_hires_org ON hires(org_id);
ALTER TABLE hires ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parties read own hires" ON hires;
CREATE POLICY "parties read own hires" ON hires FOR SELECT USING (worker_id = auth.uid() OR contractor_id = auth.uid() OR org_id = my_org_id());
DROP POLICY IF EXISTS "contractor creates hires for own jobs" ON hires;
CREATE POLICY "contractor creates hires for own jobs" ON hires FOR INSERT WITH CHECK (contractor_id = auth.uid() AND EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND contractor_id = auth.uid()));

DROP POLICY IF EXISTS "marketplace parties read profiles" ON profiles;
CREATE POLICY "marketplace parties read profiles" ON profiles FOR SELECT USING (
  id = auth.uid() OR EXISTS (
    SELECT 1 FROM job_applications a
    WHERE (a.worker_id = profiles.id AND a.contractor_id = auth.uid())
       OR (a.worker_id = auth.uid() AND a.contractor_id = profiles.id)
  ) OR EXISTS (
    SELECT 1 FROM hires h
    WHERE (h.worker_id = profiles.id AND h.contractor_id = auth.uid())
       OR (h.worker_id = auth.uid() AND h.contractor_id = profiles.id)
  )
);

CREATE OR REPLACE FUNCTION accept_job_application(p_application_id UUID)
RETURNS hires LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a job_applications; j jobs; h hires; worker_row UUID;
BEGIN
  SELECT * INTO a FROM job_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Application not found.'; END IF;
  SELECT * INTO j FROM jobs WHERE id = a.job_id FOR UPDATE;
  IF j.contractor_id <> auth.uid() THEN RAISE EXCEPTION 'Only the job owner can hire a worker.'; END IF;
  IF a.status NOT IN ('pending','viewed','shortlisted') THEN RAISE EXCEPTION 'This application is no longer available.'; END IF;
  INSERT INTO hires(job_id, contractor_id, worker_id, org_id, application_id, agreed_wage)
    VALUES (j.id, j.contractor_id, a.worker_id, j.org_id, a.id, j.wage) RETURNING * INTO h;
  UPDATE job_applications SET status = 'accepted', reviewed_at = now(), updated_at = now() WHERE id = a.id;
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

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
DECLARE new_org_id UUID; new_role TEXT := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'contractor'); requested_org_id TEXT := NULLIF(NEW.raw_user_meta_data->>'orgId', '');
BEGIN
  IF new_role NOT IN ('contractor','supervisor','worker','accountant','admin') THEN new_role := 'contractor'; END IF;
  IF new_role = 'contractor' THEN INSERT INTO organizations(name) VALUES (COALESCE(NEW.raw_user_meta_data->>'orgName','My Organization')) RETURNING id INTO new_org_id;
  ELSIF requested_org_id IS NOT NULL THEN new_org_id := requested_org_id::UUID;
  ELSIF new_role <> 'worker' THEN RAISE EXCEPTION 'An Organization ID is required for this role.'; END IF;
  INSERT INTO profiles(id,name,role,org_id,avatar_initials) VALUES (NEW.id,COALESCE(NEW.raw_user_meta_data->>'name',split_part(NEW.email,'@',1)),new_role::role_enum,new_org_id,upper(left(COALESCE(NEW.raw_user_meta_data->>'name',NEW.email),1)));
  IF new_role = 'worker' THEN INSERT INTO worker_profiles(id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
