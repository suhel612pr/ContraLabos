-- Run once in Supabase SQL Editor for an existing installation.
-- Repairs cross-organization update/insert checks without recreating tables.

DROP POLICY IF EXISTS "contractor/accountant advance requests" ON public.requests;
CREATE POLICY "contractor/accountant advance requests" ON public.requests
  FOR UPDATE
  USING (
    project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
    AND public.my_role() IN ('contractor', 'accountant')
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
    AND public.my_role() IN ('contractor', 'accountant')
  );

DROP POLICY IF EXISTS "contractor/accountant update payments" ON public.payments;
CREATE POLICY "contractor/accountant update payments" ON public.payments
  FOR UPDATE
  USING (
    project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
    AND public.my_role() IN ('contractor', 'accountant')
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
    AND public.my_role() IN ('contractor', 'accountant')
  );

DROP POLICY IF EXISTS "any signed-in org member uploads" ON public.documents;
CREATE POLICY "any signed-in org member uploads" ON public.documents
  FOR INSERT
  WITH CHECK (
    uploaded_by_id = auth.uid()
    AND (project_id IS NULL OR project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id()))
  );

NOTIFY pgrst, 'reload schema';