-- ============================================================
-- CONTRALABOS — SUPABASE SCHEMA
-- ------------------------------------------------------------
-- Paste this entire file into your Supabase project's
-- SQL Editor (Dashboard → SQL Editor → New query) and run it.
-- It creates every table, enables Row Level Security (RLS) on
-- all of them, and adds policies so the frontend can talk to
-- Supabase directly and safely — no custom backend server needed.
--
-- Assumes: a fresh Supabase project (auth.users already exists,
-- managed by Supabase Auth — you never create or modify it).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE role_enum AS ENUM ('contractor','supervisor','worker','accountant','admin');
CREATE TYPE project_status_enum AS ENUM ('active','completed');
CREATE TYPE attendance_status_enum AS ENUM ('present','absent','half_day','leave');
CREATE TYPE request_type_enum AS ENUM ('payment','material','expense');
CREATE TYPE request_status_enum AS ENUM ('submitted','review','approved','rejected','completed');
CREATE TYPE payment_status_enum AS ENUM ('paid','unpaid');

-- ---------------- ORGANIZATIONS ----------------
CREATE TABLE organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  gstin      TEXT,
  city       TEXT,
  address    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- PROFILES ----------------
-- Supabase Auth already manages auth.users (email, password, sessions).
-- This table holds everything app-specific about each user, linked 1:1
-- to auth.users by sharing the same id.
CREATE TABLE profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  phone            TEXT,
  role             role_enum NOT NULL,
  org_id           UUID NOT NULL REFERENCES organizations(id),
  profile_complete BOOLEAN NOT NULL DEFAULT false,
  avatar_url       TEXT,
  avatar_initials  TEXT,
  extra            JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_org ON profiles(org_id);

-- Auto-creates a profile row whenever someone signs up via Supabase Auth.
-- Role/org/name are passed in from the frontend as "user metadata" during
-- signUp() — see contralabos-frontend/js/supabase-client.js for exactly how.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
  new_role TEXT := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'contractor');
  requested_org_id TEXT := NULLIF(NEW.raw_user_meta_data->>'orgId', '');
BEGIN
  IF new_role NOT IN ('contractor', 'supervisor', 'worker', 'accountant', 'admin') THEN
    new_role := 'contractor';
  END IF;

  IF new_role = 'contractor' OR requested_org_id IS NULL THEN
    INSERT INTO organizations (name)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'orgName', 'My Organization'))
    RETURNING id INTO new_org_id;
  ELSE
    BEGIN
      new_org_id := requested_org_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The organization ID is not a valid UUID.';
    END;
  END IF;

  INSERT INTO profiles (id, name, role, org_id, avatar_initials)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    new_role::role_enum,
    new_org_id,
    upper(left(COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------- PROJECTS ----------------
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  name          TEXT NOT NULL,
  description   TEXT,
  supervisor_id UUID REFERENCES profiles(id),
  budget        NUMERIC(14,2) NOT NULL,
  status        project_status_enum NOT NULL DEFAULT 'active',
  progress      INT NOT NULL DEFAULT 0,
  start_date    DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_org ON projects(org_id);

-- ---------------- WORKERS ----------------
CREATE TABLE workers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  user_id    UUID UNIQUE REFERENCES profiles(id),
  phone      TEXT,
  wage_rate  NUMERIC(10,2) NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id),
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workers_project ON workers(project_id);

-- ---------------- ATTENDANCE ----------------
CREATE TABLE attendance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id),
  worker_id      UUID NOT NULL REFERENCES workers(id),
  date           DATE NOT NULL,
  status         attendance_status_enum NOT NULL,
  recorded_by_id UUID NOT NULL REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, worker_id, date)
);
CREATE INDEX idx_attendance_project ON attendance(project_id);

-- ---------------- REQUESTS ----------------
CREATE TABLE requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id   TEXT NOT NULL UNIQUE,
  type         request_type_enum NOT NULL,
  project_id   UUID NOT NULL REFERENCES projects(id),
  amount       NUMERIC(14,2) NOT NULL,
  status       request_status_enum NOT NULL DEFAULT 'submitted',
  raised_by_id UUID NOT NULL REFERENCES profiles(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_requests_project ON requests(project_id);

CREATE TABLE request_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  stage      TEXT NOT NULL,
  by_name    TEXT NOT NULL,
  note       TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reqhistory_request ON request_history(request_id);

-- ---------------- MATERIALS ----------------
CREATE TABLE materials (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL
);

CREATE TABLE material_receipts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id),
  project_id  UUID NOT NULL REFERENCES projects(id),
  quantity    NUMERIC(12,2) NOT NULL,
  cost        NUMERIC(14,2) NOT NULL,
  vendor      TEXT,
  date        DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_project_material ON material_receipts(project_id, material_id);

CREATE TABLE material_usage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id    UUID NOT NULL REFERENCES materials(id),
  project_id     UUID NOT NULL REFERENCES projects(id),
  quantity       NUMERIC(12,2) NOT NULL,
  recorded_by_id UUID REFERENCES profiles(id),
  date           DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_project_material ON material_usage(project_id, material_id);

-- ---------------- EXPENSES ----------------
CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id),
  category    TEXT NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  vendor      TEXT,
  recorded_by TEXT,
  receipt_url TEXT,
  date        DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_project ON expenses(project_id);

-- ---------------- PAYMENTS ----------------
CREATE TABLE payments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id  UUID NOT NULL REFERENCES workers(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  period     TEXT NOT NULL,
  amount     NUMERIC(14,2) NOT NULL,
  status     payment_status_enum NOT NULL DEFAULT 'unpaid',
  paid_date  DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_project_worker ON payments(project_id, worker_id);

-- ---------------- PROGRESS REPORTS ----------------
CREATE TABLE progress_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  date            DATE NOT NULL,
  work_completed  TEXT NOT NULL,
  percentage      INT NOT NULL CHECK (percentage BETWEEN 0 AND 100),
  issues          TEXT,
  material_needs  TEXT,
  next_day_plan   TEXT,
  submitted_by_id UUID NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_project ON progress_reports(project_id);

CREATE TABLE progress_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  UUID NOT NULL REFERENCES progress_reports(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- DOCUMENTS ----------------
CREATE TABLE documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  project_id     UUID REFERENCES projects(id),
  uploaded_by_id UUID NOT NULL REFERENCES profiles(id),
  file_url       TEXT NOT NULL,
  date           DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_project ON documents(project_id);

-- ---------------- NOTIFICATIONS ----------------
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id),
  title      TEXT NOT NULL,
  type       TEXT NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT false,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_org ON notifications(org_id);

-- ---------------- SUPPORT TICKETS ----------------
CREATE TABLE support_tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id),
  user_id    UUID NOT NULL REFERENCES profiles(id),
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Every table is scoped to "rows belonging to my organization"
-- via a helper function, since RLS policies can't easily do a
-- subquery join efficiently inline everywhere.
-- ============================================================

CREATE OR REPLACE FUNCTION my_org_id() RETURNS UUID AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION my_role() RETURNS role_enum AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own org" ON organizations FOR SELECT USING (id = my_org_id());
CREATE POLICY "contractor updates own org" ON organizations FOR UPDATE USING (id = my_org_id() AND my_role() = 'contractor');

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org profiles" ON profiles FOR SELECT USING (org_id = my_org_id());
CREATE POLICY "update own profile" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "contractor/admin invite users" ON profiles FOR INSERT WITH CHECK (my_role() IN ('contractor','admin') OR auth.uid() = id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org projects" ON projects FOR SELECT USING (org_id = my_org_id());
CREATE POLICY "contractor manages projects" ON projects FOR ALL USING (org_id = my_org_id() AND my_role() = 'contractor');

ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org workers" ON workers FOR SELECT USING (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "contractor/supervisor manage workers" ON workers FOR ALL USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','supervisor')
) WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','supervisor')
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org attendance" ON attendance FOR SELECT USING (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "contractor/supervisor record attendance" ON attendance FOR INSERT WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','supervisor')
);
CREATE POLICY "contractor delete attendance" ON attendance FOR DELETE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() = 'contractor'
);

ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org requests" ON requests FOR SELECT USING (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "anyone in org raises requests" ON requests FOR INSERT WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "contractor delete requests" ON requests FOR DELETE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() = 'contractor'
);
CREATE POLICY "contractor/accountant advance requests" ON requests FOR UPDATE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','accountant')
 ) WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','accountant')
);

ALTER TABLE request_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org request history" ON request_history FOR SELECT USING (
  request_id IN (SELECT id FROM requests WHERE project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()))
);
CREATE POLICY "anyone in org appends history" ON request_history FOR INSERT WITH CHECK (
  request_id IN (SELECT id FROM requests WHERE project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()))
);
CREATE POLICY "contractor delete request history" ON request_history FOR DELETE USING (
  request_id IN (SELECT id FROM requests WHERE project_id IN (SELECT id FROM projects WHERE org_id = my_org_id())) AND my_role() = 'contractor'
);

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "materials readable by any signed-in user" ON materials FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "contractor/supervisor manage material catalog" ON materials FOR INSERT WITH CHECK (my_role() IN ('contractor','supervisor'));

ALTER TABLE material_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org receipts" ON material_receipts FOR SELECT USING (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "contractor/supervisor record receipts" ON material_receipts FOR INSERT WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','supervisor')
);
CREATE POLICY "contractor delete material receipts" ON material_receipts FOR DELETE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() = 'contractor'
);

ALTER TABLE material_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org usage" ON material_usage FOR SELECT USING (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "contractor/supervisor record usage" ON material_usage FOR INSERT WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','supervisor')
);
CREATE POLICY "contractor delete material usage" ON material_usage FOR DELETE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() = 'contractor'
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org expenses" ON expenses FOR SELECT USING (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "contractor/supervisor record expenses" ON expenses FOR INSERT WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','supervisor')
);
CREATE POLICY "contractor delete expenses" ON expenses FOR DELETE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() = 'contractor'
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own payments or same-org if staff" ON payments FOR SELECT USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id())
  AND (my_role() IN ('contractor','accountant','supervisor') OR worker_id IN (SELECT id FROM workers WHERE user_id = auth.uid()))
);
CREATE POLICY "contractor/accountant create payments" ON payments FOR INSERT WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','accountant')
);
CREATE POLICY "contractor/accountant update payments" ON payments FOR UPDATE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','accountant')
 ) WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','accountant')
);
CREATE POLICY "contractor delete payments" ON payments FOR DELETE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() = 'contractor'
);

ALTER TABLE progress_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org progress" ON progress_reports FOR SELECT USING (project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()));
CREATE POLICY "contractor/supervisor submit progress" ON progress_reports FOR INSERT WITH CHECK (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() IN ('contractor','supervisor')
);
CREATE POLICY "contractor delete progress reports" ON progress_reports FOR DELETE USING (
  project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()) AND my_role() = 'contractor'
);

ALTER TABLE progress_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org progress media" ON progress_media FOR SELECT USING (
  report_id IN (SELECT id FROM progress_reports WHERE project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()))
);
CREATE POLICY "contractor/supervisor attach media" ON progress_media FOR INSERT WITH CHECK (
  report_id IN (SELECT id FROM progress_reports WHERE project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()))
);
CREATE POLICY "contractor delete progress media" ON progress_media FOR DELETE USING (
  report_id IN (SELECT id FROM progress_reports WHERE project_id IN (SELECT id FROM projects WHERE org_id = my_org_id())) AND my_role() = 'contractor'
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org documents" ON documents FOR SELECT USING (uploaded_by_id IN (SELECT id FROM profiles WHERE org_id = my_org_id()));
CREATE POLICY "any signed-in org member uploads" ON documents FOR INSERT WITH CHECK (
  uploaded_by_id = auth.uid()
  AND (project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE org_id = my_org_id()))
);
CREATE POLICY "contractor delete documents" ON documents FOR DELETE USING (
  (project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE org_id = my_org_id())) AND my_role() = 'contractor'
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read same-org notifications" ON notifications FOR SELECT USING (org_id = my_org_id());
CREATE POLICY "system/any org member creates notifications" ON notifications FOR INSERT WITH CHECK (org_id = my_org_id());
CREATE POLICY "org member marks read" ON notifications FOR UPDATE USING (org_id = my_org_id());

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own tickets" ON support_tickets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "create own tickets" ON support_tickets FOR INSERT WITH CHECK (user_id = auth.uid());
