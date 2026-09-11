ALTER TABLE public.vihem_apartments DROP CONSTRAINT IF EXISTS apartments_unit_type_check;
ALTER TABLE public.vihem_apartments ADD CONSTRAINT apartments_unit_type_check
  CHECK (unit_type IN ('apartment', 'commercial', 'storage', 'garage'));
