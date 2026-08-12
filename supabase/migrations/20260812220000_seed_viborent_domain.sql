-- Seed the public ViboRent tenant mapping for the existing owning organisation.
-- This is idempotent and intentionally does nothing if the organisation has
-- not been created yet.
INSERT INTO public.vihem_rental_domains (organisation_id, hostname, active)
SELECT o.id, 'viborent.se', true
FROM public.vihem_organisations o
WHERE o.active = true
  AND (o.slug ILIKE 'vibogruppen%' OR o.name ILIKE 'Vibogruppen%')
ORDER BY CASE WHEN o.slug = 'vibogruppen' THEN 0 ELSE 1 END
LIMIT 1
ON CONFLICT (hostname) DO UPDATE SET
  organisation_id = EXCLUDED.organisation_id,
  active = true,
  updated_at = now();

INSERT INTO public.vihem_rental_domains (organisation_id, hostname, active)
SELECT organisation_id, 'www.viborent.se', true
FROM public.vihem_rental_domains
WHERE hostname = 'viborent.se'
ON CONFLICT (hostname) DO UPDATE SET
  organisation_id = EXCLUDED.organisation_id,
  active = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
