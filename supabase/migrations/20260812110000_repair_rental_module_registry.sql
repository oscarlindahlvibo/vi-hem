-- Reparationsmigration för installationer där uthyrningsmodulen fått UI-stöd
-- men modulregistret inte hunnit skapas innan organisationsraden sparades.
INSERT INTO public.vihem_module_registry (
  module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order
)
VALUES (
  'rental_management',
  'Uthyrning',
  'Produkter, assets, priser, kunder, bokningar och interna spärrar.',
  'rental',
  false,
  '{"max_products":5000,"max_bookings_per_month":10000}'::jsonb,
  '{"currency":"SEK","vat_rate":25,"timezone":"Europe/Stockholm"}'::jsonb,
  175
)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT o.id, 'rental_management', false, r.default_limits, r.default_settings
FROM public.vihem_organisations o
JOIN public.vihem_module_registry r ON r.module_key = 'rental_management'
ON CONFLICT (organisation_id, module_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
