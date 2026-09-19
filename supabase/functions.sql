-- ============================================================
-- CONTRALABOS — SUPABASE FUNCTIONS & VIEWS
-- ------------------------------------------------------------
-- Run this AFTER schema.sql. These provide the derived/aggregate
-- calculations (budget spend, material stock, dashboard totals)
-- that Supabase's auto-generated REST API can't compute directly
-- from a plain table query — PostgREST doesn't support arbitrary
-- correlated subqueries in a select(), so we compute them here
-- instead, once, in the database.
-- ============================================================

-- Projects with derived "spent" — BUDGET-003: total spent must equal
-- recorded labour payments + material costs + expenses, never a
-- separately-stored (and therefore driftable) number.
CREATE OR REPLACE VIEW project_summary AS
SELECT
  p.*,
  COALESCE((SELECT SUM(amount) FROM payments WHERE project_id = p.id AND status = 'paid'), 0)
  + COALESCE((SELECT SUM(cost) FROM material_receipts WHERE project_id = p.id), 0)
  + COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = p.id), 0)
  AS spent
FROM projects p;

-- Views don't inherit RLS from their base tables automatically in
-- older Postgres, so re-enable and mirror the same policy here.
ALTER VIEW project_summary SET (security_invoker = true);

-- Derived material stock (received minus used) for one project.
-- Call via: supabase.rpc('get_material_stock', { p_project_id: '...' })
CREATE OR REPLACE FUNCTION get_material_stock(p_project_id UUID)
RETURNS TABLE(id UUID, name TEXT, unit TEXT, received NUMERIC, used NUMERIC, remaining NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    m.id, m.name, m.unit,
    COALESCE((SELECT SUM(quantity) FROM material_receipts WHERE project_id = p_project_id AND material_id = m.id), 0) AS received,
    COALESCE((SELECT SUM(quantity) FROM material_usage WHERE project_id = p_project_id AND material_id = m.id), 0) AS used,
    COALESCE((SELECT SUM(quantity) FROM material_receipts WHERE project_id = p_project_id AND material_id = m.id), 0)
    - COALESCE((SELECT SUM(quantity) FROM material_usage WHERE project_id = p_project_id AND material_id = m.id), 0) AS remaining
  FROM materials m
  WHERE EXISTS (SELECT 1 FROM material_receipts WHERE project_id = p_project_id AND material_id = m.id)
     OR EXISTS (SELECT 1 FROM material_usage WHERE project_id = p_project_id AND material_id = m.id);
$$;

-- Dashboard aggregate for the signed-in contractor's organization.
-- Call via: supabase.rpc('get_contractor_summary')
CREATE OR REPLACE FUNCTION get_contractor_summary()
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  result JSON;
  v_org_id UUID := my_org_id();
BEGIN
  SELECT json_build_object(
    'activeProjects', (SELECT COUNT(*) FROM projects WHERE org_id = v_org_id AND status = 'active'),
    'totalBudget', (SELECT COALESCE(SUM(budget), 0) FROM projects WHERE org_id = v_org_id),
    'totalSpent', (SELECT COALESCE(SUM(spent), 0) FROM project_summary WHERE org_id = v_org_id),
    'pendingRequests', (
      SELECT COUNT(*) FROM requests r JOIN projects p ON p.id = r.project_id
      WHERE p.org_id = v_org_id AND r.status IN ('submitted','review')
    ),
    'projects', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', id, 'name', name, 'budget', budget, 'spent', spent,
        'status', status, 'progress', progress, 'startDate', start_date
      )), '[]'::json)
      FROM project_summary WHERE org_id = v_org_id
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- Generates the next sequential human-facing request ID, e.g. REQ-1006.
-- Call via: supabase.rpc('next_request_display_id')
CREATE SEQUENCE IF NOT EXISTS request_display_id_seq START WITH 1001;
SELECT setval(
  'request_display_id_seq',
  GREATEST(
    1000,
    COALESCE((SELECT MAX(SUBSTRING(display_id FROM 5)::INT)
      FROM requests WHERE display_id ~ '^REQ-[0-9]+$'), 1000)
  ),
  true
);

CREATE OR REPLACE FUNCTION next_request_display_id()
RETURNS TEXT
LANGUAGE sql AS $$
  SELECT 'REQ-' || nextval('request_display_id_seq')::TEXT;
$$;

-- Low-stock check, called from the frontend right after recording usage
-- (mirrors the same 15%-of-received threshold used elsewhere in Contralabos).
-- Call via: supabase.rpc('check_low_stock', { p_project_id, p_material_id })
CREATE OR REPLACE FUNCTION check_low_stock(p_project_id UUID, p_material_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_received NUMERIC;
  v_used NUMERIC;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO v_received FROM material_receipts WHERE project_id = p_project_id AND material_id = p_material_id;
  SELECT COALESCE(SUM(quantity), 0) INTO v_used FROM material_usage WHERE project_id = p_project_id AND material_id = p_material_id;
  RETURN v_received > 0 AND (v_received - v_used) <= (v_received * 0.15);
END;
$$;
