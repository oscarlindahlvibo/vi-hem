/*
  # Fleet: biluppgifter.se som standardkälla för alla fordon med registreringsnummer

  Varje fordon med regnr får en sparad källa (https://biluppgifter.se/fordon/REGNR,
  label 'biluppgifter.se (standard)') som kontrolleras automatiskt av
  vihem-fleet-recheck-sources. Admin kan stänga av kontrollen eller lägga till
  en alternativ länk under fordonets Besiktningar-flik. Triggern körs bara när ett
  fordon skapas eller regnumret ändras, så en borttagen standardlänk kommer inte tillbaka.
*/

CREATE OR REPLACE FUNCTION public.vihem_fleet_ensure_default_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg text;
BEGIN
  v_reg := upper(regexp_replace(COALESCE(NEW.registration_number, ''), '[^A-Za-z0-9]', '', 'g'));
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.vihem_fleet_vehicle_sources
    WHERE vehicle_id = NEW.id AND label = 'biluppgifter.se (standard)' AND url <> 'https://biluppgifter.se/fordon/' || v_reg;
  END IF;
  IF length(v_reg) >= 2 AND NEW.status <> 'sold' THEN
    INSERT INTO public.vihem_fleet_vehicle_sources (organisation_id, vehicle_id, url, label, auto_check)
    VALUES (NEW.organisation_id, NEW.id, 'https://biluppgifter.se/fordon/' || v_reg, 'biluppgifter.se (standard)', true)
    ON CONFLICT (vehicle_id, url) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fleet_default_source ON public.vihem_fleet_vehicles;
CREATE TRIGGER trg_fleet_default_source
AFTER INSERT OR UPDATE OF registration_number ON public.vihem_fleet_vehicles
FOR EACH ROW EXECUTE FUNCTION public.vihem_fleet_ensure_default_source();

-- Befintliga fordon med regnr
INSERT INTO public.vihem_fleet_vehicle_sources (organisation_id, vehicle_id, url, label, auto_check)
SELECT v.organisation_id, v.id, 'https://biluppgifter.se/fordon/' || upper(regexp_replace(v.registration_number, '[^A-Za-z0-9]', '', 'g')),
       'biluppgifter.se (standard)', true
FROM public.vihem_fleet_vehicles v
WHERE length(regexp_replace(v.registration_number, '[^A-Za-z0-9]', '', 'g')) >= 2 AND v.status <> 'sold'
ON CONFLICT (vehicle_id, url) DO NOTHING;
