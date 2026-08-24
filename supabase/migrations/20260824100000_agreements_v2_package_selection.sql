/*
  # Avtal V2 -- valbara tillägg (package_option-block)

  Selectable add-ons (e.g. "tvättmaskin & torktumlare", "internet") a
  signer can toggle on/off before signing, on top of the document's base
  price/price_table blocks. The selection is ONE shared choice for the
  whole document (a tenant picks once, not one choice per signer), so it
  lives on vihem_agreements itself rather than per-signature.

  A jsonb array of `package_option` block ids (not a boolean-keyed jsonb
  object) -- block ids are stable across draft edits and the frozen
  version snapshot, so referencing them directly is enough; nothing here
  needs to know which VERSION a given id came from.
*/

ALTER TABLE public.vihem_agreements
  ADD COLUMN IF NOT EXISTS selected_package_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
