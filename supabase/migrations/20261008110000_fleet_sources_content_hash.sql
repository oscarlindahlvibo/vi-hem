-- Fleet: spara hash av senast tolkade sidinnehåll så att oförändrade sidor inte tolkas med AI igen.
ALTER TABLE public.vihem_fleet_vehicle_sources ADD COLUMN IF NOT EXISTS content_hash text;
