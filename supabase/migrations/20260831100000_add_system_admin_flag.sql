-- "admin" today can reach every API/integration settings page (OpenAI/
-- Google Vision keys, Google Workspace credentials, BankID, Cellsynt SMS --
-- see PlatformSettingsPage.tsx). The org wants a narrower "admin" that
-- can't touch those, and a "systemadmin" tier that can -- scoped to their
-- own organisation only, not the existing 'superadmin' role, which is
-- already a platform-wide role used as an unconditional OR in dozens of
-- RLS policies (e.g. 20260601170500_fix_work_order_org_insert.sql) for
-- Vibogruppen's own cross-org operation. Reusing 'superadmin' here would
-- silently grant cross-org access, which isn't wanted. Instead: a plain
-- boolean flag layered on top of the existing 'admin' role -- every
-- existing RLS policy scoped to 'admin' is untouched, only the specific
-- API-key edge functions gain an extra check.

ALTER TABLE public.vihem_profiles
  ADD COLUMN IF NOT EXISTS is_system_admin boolean NOT NULL DEFAULT false;

-- vihem_profiles' own UPDATE policy ("VIHEM admins can update profiles",
-- 20260617090000) lets any admin/superadmin update any profile row, with
-- no per-column restriction. Without this guard, a regular admin could
-- self-grant is_system_admin through a raw UPDATE. Only someone who is
-- already superadmin, or already is_system_admin themselves, may flip it
-- on someone (including themselves).
CREATE OR REPLACE FUNCTION public.vihem_guard_system_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_system_admin IS DISTINCT FROM OLD.is_system_admin THEN
    IF public.vihem_get_my_role() != 'superadmin' AND NOT COALESCE(
      (SELECT is_system_admin FROM public.vihem_profiles WHERE id = auth.uid()),
      false
    ) THEN
      RAISE EXCEPTION 'Only a systemadmin or superadmin can change is_system_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_guard_system_admin_flag ON public.vihem_profiles;
CREATE TRIGGER trg_vihem_guard_system_admin_flag
  BEFORE UPDATE ON public.vihem_profiles
  FOR EACH ROW EXECUTE FUNCTION public.vihem_guard_system_admin_flag();

NOTIFY pgrst, 'reload schema';
