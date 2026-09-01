-- Drift & rutiner (Operations): internal access-code/routine/checklist
-- module. This migration lays the foundation two later migrations build
-- on: the module toggle (same vihem_module_registry pattern as
-- 20260826100000_jour_module.sql) and a small, generic fine-grained
-- permission-grant mechanism.
--
-- Why a new grants table instead of another boolean flag like
-- is_system_admin: the feature needs access.read vs access.reveal kept
-- strictly separate (staff can see that a code exists without being able
-- to reveal it), plus several more keys (routine.publish, routine.edit,
-- inventory_check.perform, ...). A single flag per key would mean adding
-- a new vihem_profiles column for every future permission; this table
-- scales to any future permission_key without a schema change, and
-- vihem_has_permission() is the one place every RLS policy and edge
-- function in this feature (and future ones) calls -- never re-derive the
-- role/grant logic inline elsewhere.

INSERT INTO public.vihem_module_registry (
  module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order
)
VALUES (
  'operations',
  'Drift & rutiner',
  'Åtkomstuppgifter, driftrutiner, checklistor och inventarielistor för personal ute på fält.',
  'staff',
  false,
  '{}'::jsonb,
  '{}'::jsonb,
  70
)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT o.id, 'operations', false, r.default_limits, r.default_settings
FROM public.vihem_organisations o
JOIN public.vihem_module_registry r ON r.module_key = 'operations'
ON CONFLICT (organisation_id, module_key) DO NOTHING;

-- ---- Fine-grained permission grants ----

CREATE TABLE IF NOT EXISTS public.vihem_permission_grants (
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_vihem_permission_grants_user ON public.vihem_permission_grants (user_id);

ALTER TABLE public.vihem_permission_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vihem_permission_grants_select ON public.vihem_permission_grants;
CREATE POLICY vihem_permission_grants_select ON public.vihem_permission_grants
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR organisation_id IN (
      SELECT organisation_id FROM public.vihem_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS vihem_permission_grants_manage ON public.vihem_permission_grants;
CREATE POLICY vihem_permission_grants_manage ON public.vihem_permission_grants
  FOR ALL
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.vihem_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    organisation_id IN (
      SELECT organisation_id FROM public.vihem_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

-- admin/superadmin implicitly have every Drift & rutiner permission (same
-- authority they already have over every other admin-gated feature in the
-- app) without needing a row per key. staff get a broad default for any
-- "*.read" key (matches the spec: ordinary staff should see published
-- routines and that an access entry exists without extra setup) but need
-- an explicit grant row for everything else -- this is the actual
-- access.read vs access.reveal separation the feature exists for. tenant/
-- screen never match the staff branch, so they get nothing unless
-- explicitly granted (never done from the UI).
CREATE OR REPLACE FUNCTION public.vihem_has_permission(p_user_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN (SELECT role FROM public.vihem_profiles WHERE id = p_user_id) = 'superadmin' THEN true
    WHEN (SELECT role FROM public.vihem_profiles WHERE id = p_user_id) = 'admin' THEN true
    WHEN (SELECT role FROM public.vihem_profiles WHERE id = p_user_id) = 'staff' AND p_permission_key LIKE '%.read' THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.vihem_permission_grants
      WHERE user_id = p_user_id AND permission_key = p_permission_key
    )
  END;
$$;

NOTIFY pgrst, 'reload schema';
