/*
  # VI-HEM optional module registry repair

  Ensures optional modules used by the superadmin organisation form exist in
  vihem_module_registry before rows are written to vihem_organisation_modules.
  This is intentionally idempotent so it can repair servers where an earlier
  module registration was missed or a deployment failed midway.
*/

INSERT INTO public.vihem_module_registry
  (module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order)
VALUES
  (
    'year_planning',
    'Årsplanering',
    'Planera arbeten, möten, besiktningar och deadlines över året.',
    'planning',
    false,
    '{}'::jsonb,
    '{}'::jsonb,
    130
  ),
  (
    'meetings',
    'Möten & Uppföljning',
    'Strukturerade möten, dagordning, protokoll, beslut och uppgifter.',
    'planning',
    false,
    '{}'::jsonb,
    '{"ai_requires_approval": true}'::jsonb,
    145
  ),
  (
    'finance',
    'Ekonomi',
    'Bolag, kunder, leverantörer, fakturor, betalningar och bokföringskopplingar.',
    'finance',
    false,
    '{"max_companies": 10, "max_invoices_per_month": 1000}'::jsonb,
    '{}'::jsonb,
    190
  )
ON CONFLICT (module_key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_enabled = EXCLUDED.default_enabled,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT organisation.id, registry.module_key, false, registry.default_limits, registry.default_settings
FROM public.vihem_organisations organisation
CROSS JOIN public.vihem_module_registry registry
WHERE registry.module_key IN ('year_planning', 'meetings', 'finance')
ON CONFLICT (organisation_id, module_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
