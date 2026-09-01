-- Drift & rutiner -- demo data for local development only (see
-- supabase/production-migration-skip.txt). All codes here are clearly
-- fake test values, never real production secrets. Uses the local demo
-- org (00000000-0000-0000-0000-000000000001) and its first property.
--
-- The "encrypted" secret values below are NOT actually encrypted (there's
-- no edge-function-only encryption key available inside a plain SQL
-- migration) -- they're plaintext placeholders prefixed DEMO- so nobody
-- mistakes them for a real ciphertext. Reveal via the edge function will
-- fail to decrypt these; that's fine for seed data whose purpose is to
-- populate lists/UI, not to exercise the reveal path (test reveal by
-- creating a real entry through the app instead).

DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_admin uuid := '23ae8600-fab7-4d0d-890f-3a576ce51c9a';
  v_property uuid;
  v_entry_id uuid;
  v_routine_id uuid;
  v_version_id uuid;
  v_template_id uuid;
BEGIN
  SELECT id INTO v_property FROM public.vihem_properties WHERE organisation_id = v_org ORDER BY name LIMIT 1;
  IF v_property IS NULL THEN RETURN; END IF;

  -- Åtkomst
  INSERT INTO public.vihem_access_entries (organisation_id, property_id, name, entry_type, location_note, instructions, secret_hint, created_by, updated_by)
  VALUES (v_org, v_property, 'Portkod huvudentré (TESTDATA)', 'portkod', 'Entré mot gatan', 'Fungerar dygnet runt.', '••32', v_admin, v_admin)
  RETURNING id INTO v_entry_id;
  INSERT INTO public.vihem_access_entry_secrets (entry_id, encrypted_secret)
  VALUES (v_entry_id, 'DEMO-NOT-REAL-CIPHERTEXT');

  INSERT INTO public.vihem_access_entries (organisation_id, property_id, name, entry_type, location_note, instructions, secret_hint, created_by, updated_by)
  VALUES (v_org, v_property, 'Nyckelbox städmaterial (TESTDATA)', 'nyckelbox', 'Vid soprummet', 'Kombinationslås, vrid moturs efter användning.', '••17', v_admin, v_admin)
  RETURNING id INTO v_entry_id;
  INSERT INTO public.vihem_access_entry_secrets (entry_id, encrypted_secret)
  VALUES (v_entry_id, 'DEMO-NOT-REAL-CIPHERTEXT');

  INSERT INTO public.vihem_access_entries (organisation_id, property_id, name, entry_type, location_note, instructions, created_by, updated_by)
  VALUES (v_org, v_property, 'Teknikrum (TESTDATA)', 'teknikrum', 'Källarplan, bakom pannrummet', 'Nyckel K14 i personalens nyckelskåp.', v_admin, v_admin);

  INSERT INTO public.vihem_access_entries (organisation_id, property_id, name, entry_type, location_note, instructions, comments, created_by, updated_by)
  VALUES (v_org, v_property, 'Larm (TESTDATA)', 'larm_instruktion', 'Vid entrén', 'Slå av inom 30 sekunder efter dörren öppnats.', 'Kontakta larmbolaget vid upprepade falsklarm.', v_admin, v_admin);

  -- Rutin: Airbnb-städ med checklista
  INSERT INTO public.vihem_routines (organisation_id, title, category, summary, status, requires_acknowledgement, created_by)
  VALUES (v_org, 'Airbnb-städ (TESTDATA)', 'stad', 'Standardrutin för städning mellan gäster vid korttidsuthyrning.', 'published', false, v_admin)
  RETURNING id INTO v_routine_id;
  INSERT INTO public.vihem_routine_versions (routine_id, version_number, body, steps, tips, changed_by)
  VALUES (
    v_routine_id, 1,
    'Städningen ska vara klar senast kl 15:00 inför nästa incheckning.',
    '["Ta av använda sängkläder", "Kontrollera madrasskydd", "Bädda med rena sängkläder", "Byt handdukar", "Rengör kök och badrum", "Fyll på toalett- och hushållspapper", "Dammsug och moppa", "Fotografera färdigt boende"]'::jsonb,
    'Rena sängkläder finns i förrådet, se fastighetens lokala tillägg nedan.',
    v_admin
  )
  RETURNING id INTO v_version_id;
  UPDATE public.vihem_routines SET current_version_id = v_version_id WHERE id = v_routine_id;
  INSERT INTO public.vihem_routine_checklist_templates (routine_version_id, sort_order, label, required)
  VALUES
    (v_version_id, 0, 'Byt sängkläder', true),
    (v_version_id, 1, 'Rengör badrum', true),
    (v_version_id, 2, 'Fyll på förbrukningsvaror', false),
    (v_version_id, 3, 'Fotografera färdigt boende', true);
  INSERT INTO public.vihem_routine_local_notes (routine_id, property_id, note, updated_by)
  VALUES (v_routine_id, v_property, 'Rena sängkläder finns i förrådet på plan 1. Smutsig tvätt lämnas i tvättstugan.', v_admin);

  -- Rutin: Akut vattenläcka (nödläge)
  INSERT INTO public.vihem_routines (organisation_id, title, category, summary, status, is_emergency, requires_acknowledgement, created_by)
  VALUES (v_org, 'Akut vattenläcka (TESTDATA)', 'akut', 'Stäng av vattnet och begränsa skadan.', 'published', true, true, v_admin)
  RETURNING id INTO v_routine_id;
  INSERT INTO public.vihem_routine_versions (routine_id, version_number, body, steps, warnings, changed_by)
  VALUES (
    v_routine_id, 1,
    'Vid vattenläcka: agera snabbt för att begränsa skadan innan hjälp anländer.',
    '["Stäng huvudkranen", "Fotografera skadan", "Kontakta fastighetsansvarig", "Informera berörda hyresgäster"]'::jsonb,
    'Bryt aldrig ström i våtutrymmen själv -- kontakta elektriker vid osäkerhet.',
    v_admin
  )
  RETURNING id INTO v_version_id;
  UPDATE public.vihem_routines SET current_version_id = v_version_id WHERE id = v_routine_id;

  -- Rutin: Nyckelhantering (kräver kvittering)
  INSERT INTO public.vihem_routines (organisation_id, title, category, summary, status, requires_acknowledgement, created_by)
  VALUES (v_org, 'Nyckelhantering (TESTDATA)', 'nyckelhantering', 'Så hanteras fysiska nycklar och koder.', 'published', true, v_admin)
  RETURNING id INTO v_routine_id;
  INSERT INTO public.vihem_routine_versions (routine_id, version_number, body, steps, changed_by)
  VALUES (v_routine_id, 1, 'Alla nycklar kvitteras ut och in i nyckelloggen.', '["Kvittera nyckel vid uttag", "Återlämna samma dag om inte annat avtalats", "Rapportera borttappad nyckel omedelbart"]'::jsonb, v_admin)
  RETURNING id INTO v_version_id;
  UPDATE public.vihem_routines SET current_version_id = v_version_id WHERE id = v_routine_id;

  -- Inventarielista: Standard städvagn
  INSERT INTO public.vihem_inventory_templates (organisation_id, name, created_by)
  VALUES (v_org, 'Standard städvagn -- Airbnb (TESTDATA)', v_admin)
  RETURNING id INTO v_template_id;
  INSERT INTO public.vihem_inventory_template_items (template_id, sort_order, label, desired_quantity, unit)
  VALUES
    (v_template_id, 0, 'Allrengöring', 2, 'flaskor'),
    (v_template_id, 1, 'Mikrofiberdukar', 15, 'st'),
    (v_template_id, 2, 'Soppåsar', 20, 'st'),
    (v_template_id, 3, 'Toalettpapper', 12, 'rullar'),
    (v_template_id, 4, 'Diskmaskinstabletter', 20, 'st');
END $$;
