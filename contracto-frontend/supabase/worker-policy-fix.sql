-- Run once in Supabase SQL Editor for an existing installation.
-- Allows contractors and supervisors to insert/update workers in their projects.

DROP POLICY IF EXISTS "contractor/supervisor manage workers" ON public.workers;

CREATE POLICY "contractor/supervisor manage workers"
  ON public.workers
  FOR ALL
  USING (
    project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
    AND public.my_role() IN ('contractor', 'supervisor')
  )
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
    AND public.my_role() IN ('contractor', 'supervisor')
  );

NOTIFY pgrst, 'reload schema';
