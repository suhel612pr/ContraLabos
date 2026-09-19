-- Run once in Supabase SQL Editor for an existing installation.
-- Allows contractors and accountants to generate unpaid payment records.

DROP POLICY IF EXISTS "contractor/accountant create payments" ON public.payments;

CREATE POLICY "contractor/accountant create payments"
  ON public.payments
  FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE org_id = public.my_org_id())
    AND public.my_role() IN ('contractor', 'accountant')
  );

NOTIFY pgrst, 'reload schema';
