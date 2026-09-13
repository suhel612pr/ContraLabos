-- Run this once in the Supabase SQL Editor for an existing installation.
-- It replaces the signup trigger without recreating application tables.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
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
    INSERT INTO public.organizations (name)
    VALUES (COALESCE(NULLIF(NEW.raw_user_meta_data->>'orgName', ''), 'My Organization'))
    RETURNING id INTO new_org_id;
  ELSE
    BEGIN
      new_org_id := requested_org_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The organization ID is not a valid UUID.';
    END;
  END IF;

  INSERT INTO public.profiles (id, name, role, org_id, avatar_initials)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1)),
    new_role::public.role_enum,
    new_org_id,
    upper(left(COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), NEW.email), 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
GRANT USAGE ON SCHEMA public TO postgres;
GRANT SELECT, INSERT ON TABLE public.organizations, public.profiles TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();