-- Run once in Supabase SQL Editor for an existing installation.
-- Allows contractors to delete projects and their related records.

DROP POLICY IF EXISTS "contractor delete workers" ON public.workers;
CREATE POLICY "contractor delete workers" ON public.workers FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete attendance" ON public.attendance;
CREATE POLICY "contractor delete attendance" ON public.attendance FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete payments" ON public.payments;
CREATE POLICY "contractor delete payments" ON public.payments FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete requests" ON public.requests;
CREATE POLICY "contractor delete requests" ON public.requests FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete request history" ON public.request_history;
CREATE POLICY "contractor delete request history" ON public.request_history FOR DELETE USING (
  request_id IN (SELECT id FROM public.requests WHERE project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id()))
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete progress media" ON public.progress_media;
CREATE POLICY "contractor delete progress media" ON public.progress_media FOR DELETE USING (
  report_id IN (SELECT id FROM public.progress_reports WHERE project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id()))
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete progress reports" ON public.progress_reports;
CREATE POLICY "contractor delete progress reports" ON public.progress_reports FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete material receipts" ON public.material_receipts;
CREATE POLICY "contractor delete material receipts" ON public.material_receipts FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete material usage" ON public.material_usage;
CREATE POLICY "contractor delete material usage" ON public.material_usage FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete expenses" ON public.expenses;
CREATE POLICY "contractor delete expenses" ON public.expenses FOR DELETE USING (
  project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
  AND public.my_role() = 'contractor'
);

DROP POLICY IF EXISTS "contractor delete documents" ON public.documents;
CREATE POLICY "contractor delete documents" ON public.documents FOR DELETE USING (
  (project_id IS NULL OR project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id()))
  AND public.my_role() = 'contractor'
);

NOTIFY pgrst, 'reload schema';
