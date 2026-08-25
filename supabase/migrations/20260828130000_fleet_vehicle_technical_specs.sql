-- Utökar fordonsregistret med mått, vikter och annan teknisk spec, så att
-- AI-importen (vihem-fleet-lookup-vehicle) kan fylla i ett mer gediget
-- register. Vanliga, tvärgående fält (mått/vikter/färg/växellåda/CO2/
-- miljöklass) får egna kolumner för filtrering/rapportering; allt annat
-- (motoreffekt, cylindervolym m.m., som varierar kraftigt per fordonstyp)
-- går i technical_specs som en flexibel lista av {label, value}.
alter table public.vihem_fleet_vehicles
  add column if not exists color text not null default '',
  add column if not exists transmission text not null default '',
  add column if not exists curb_weight_kg numeric(8,1),
  add column if not exists gross_weight_kg numeric(8,1),
  add column if not exists max_load_kg numeric(8,1),
  add column if not exists trailer_weight_braked_kg numeric(8,1),
  add column if not exists trailer_weight_unbraked_kg numeric(8,1),
  add column if not exists length_mm integer,
  add column if not exists width_mm integer,
  add column if not exists height_mm integer,
  add column if not exists number_of_seats integer,
  add column if not exists co2_g_km numeric(6,1),
  add column if not exists euro_class text not null default '',
  add column if not exists technical_specs jsonb not null default '[]'::jsonb;
