/*
  # Avtal V2 -- standardmallar för hyresavtal (lägenhet och lokal)

  V1:s kontraktsbyggare (InspectionsPage.tsx) har färdiga
  §-numrerade mallar för "hyresavtal lägenhet" och "hyresavtal lokal"
  (fritextgenererade, ifyllda från tenancy-data). Avtal V2 har ingen
  motsvarighet -- varje avtal byggs från noll. Detta seedar två
  motsvarande mallar i vihem_agreement_templates, portade till Avtal
  V2:s blockmodell: samma §-struktur och juridiska boilerplate som V1,
  men med {{tenant.*}}/{{apartment.*}}/{{property.*}}/{{organisation.*}}
  dynamiska fält (se _shared/agreement-snapshot.ts) istället för
  hårdkodad text, och en riktig price_table istället för en fritextrad
  för hyran (stödjer moms/RUT/ROT om det någonsin blir aktuellt).

  Seedas per ORGANISATION (INSERT ... SELECT ... FROM vihem_organisations),
  inte mot ett hårdkodat organisation_id -- vihem_agreement_templates.
  organisation_id är NOT NULL (mallar är per-org), och det finns ingen
  garanti för vilket UUID en given driftsättnings organisation har. Detta
  seedar bara mallar för organisationer som finns VID MIGRATIONSTILLFÄLLET;
  om fler organisationer skapas senare får de bygga egna mallar (eller
  duplicera en annan orgs, om cross-org-mall-kopiering någonsin byggs) --
  samma "en organisation i praktiken idag"-verklighet som redan är
  dokumenterad för BankID-inloggningens organisationsval.
*/

WITH new_template AS (
  INSERT INTO public.vihem_agreement_templates (organisation_id, name, description, document_type, category, status)
  SELECT id, 'Hyresavtal - Lägenhet', 'Standardmall för hyresavtal av bostadslägenhet, enligt Jordabalken 12 kap.', 'agreement', 'Hyresavtal - Lägenhet', 'active'
  FROM public.vihem_organisations
  RETURNING id
)
INSERT INTO public.vihem_agreement_template_blocks (template_id, position, block_type, content)
SELECT new_template.id, blocks.position, blocks.block_type, blocks.content
FROM new_template
CROSS JOIN (VALUES
  (0, 'heading', '{"text": "HYRESAVTAL FÖR BOSTADSLÄGENHET"}'::jsonb),
  (1, 'paragraph', '{"text": "Enligt Jordabalken 12 kap (Hyreslagen). Upprättat: {{today.date}}."}'::jsonb),
  (2, 'subheading', '{"text": "§1 Parter"}'::jsonb),
  (3, 'paragraph', '{"text": "Hyresvärd: {{organisation.name}}\nHyresgäst: {{tenant.name}}\nE-post: {{tenant.email}}\nTelefon: {{tenant.phone}}\n\nFastighet: {{property.name}}, {{apartment.address}}\nLägenhetsnummer: {{apartment.apartment_number}}\nStorlek: {{apartment.size}} m², {{apartment.rooms}} rum"}'::jsonb),
  (4, 'subheading', '{"text": "§2 Hyresobjekt och hyrestid"}'::jsonb),
  (5, 'paragraph', '{"text": "Lägenheten hyrs ut för bostadsändamål. Uppsägningstid: 3 månader för båda parter om inte annat anges nedan."}'::jsonb),
  (6, 'date', '{"label": "Tillträdesdatum", "value": ""}'::jsonb),
  (7, 'subheading', '{"text": "§3 Hyra"}'::jsonb),
  (8, 'price_table', '{"price_form": "recurring", "items": [{"description": "Månadshyra", "quantity": "1", "unit_price": "", "vat_rate": 0, "deduction_type": "none"}], "rut_rate": 50, "rot_rate": 30, "deduction_personal_number": ""}'::jsonb),
  (9, 'terms', '{"title": "§4 Vad som ingår i hyran", "text": "Ange vad som ingår i hyran, t.ex. värme, vatten, el eller internet."}'::jsonb),
  (10, 'terms', '{"title": "§5 Hyresjustering", "text": "Hyran justeras enligt överenskommelse mellan parterna och meddelas skriftligen i god tid innan ändringen träder i kraft."}'::jsonb),
  (11, 'terms', '{"title": "§6 Skick vid tillträde", "text": "Lägenheten överlämnas i det skick som framgår av besiktningsprotokollet."}'::jsonb),
  (12, 'terms', '{"title": "§7 Ordningsregler och nyttjande", "text": "Hyresgästen förbinder sig att vårda lägenheten väl och följa fastighetsägarens ordningsregler. Andrahandsuthyrning, husdjur och rökning kräver hyresvärdens skriftliga godkännande om inte annat anges."}'::jsonb),
  (13, 'terms', '{"title": "§8 Underhåll", "text": "Hyresgästen ansvarar för enklare underhåll av lägenheten. Hyresvärden ansvarar för yttre underhåll och stamledningar."}'::jsonb),
  (14, 'terms', '{"title": "§9 Övrigt", "text": "Inga särskilda villkor utöver detta avtal."}'::jsonb),
  (15, 'checkbox_consent', '{"text": "Jag har läst och godkänner samtliga villkor i detta hyresavtal."}'::jsonb),
  (16, 'signature_block', '{"signer_index": 0}'::jsonb)
) AS blocks(position, block_type, content);

WITH new_template AS (
  INSERT INTO public.vihem_agreement_templates (organisation_id, name, description, document_type, category, status)
  SELECT id, 'Hyresavtal - Lokal', 'Standardmall för hyresavtal av lokal, enligt Jordabalken 12 kap.', 'agreement', 'Hyresavtal - Lokal', 'active'
  FROM public.vihem_organisations
  RETURNING id
)
INSERT INTO public.vihem_agreement_template_blocks (template_id, position, block_type, content)
SELECT new_template.id, blocks.position, blocks.block_type, blocks.content
FROM new_template
CROSS JOIN (VALUES
  (0, 'heading', '{"text": "HYRESAVTAL FÖR LOKAL"}'::jsonb),
  (1, 'paragraph', '{"text": "Enligt Jordabalken 12 kap. Upprättat: {{today.date}}."}'::jsonb),
  (2, 'subheading', '{"text": "§1 Parter"}'::jsonb),
  (3, 'paragraph', '{"text": "Hyresvärd: {{organisation.name}}\nHyresgäst/Hyresgästföretag: {{tenant.name}}\nE-post: {{tenant.email}}\nTelefon: {{tenant.phone}}\n\nFastighet: {{property.name}}, {{apartment.address}}\nLokalnummer/benämning: {{apartment.apartment_number}}\nStorlek: {{apartment.size}} m²"}'::jsonb),
  (4, 'subheading', '{"text": "§2 Hyresobjekt, användning och hyrestid"}'::jsonb),
  (5, 'paragraph', '{"text": "Lokalen uthyres för verksamhet enligt överenskommelse. Ange nedan tillträdesdatum, avtalsperiod och eventuell automatisk förlängning. Uppsägningstid: 6 månader om inte annat anges."}'::jsonb),
  (6, 'date', '{"label": "Tillträdesdatum", "value": ""}'::jsonb),
  (7, 'subheading', '{"text": "§3 Hyra"}'::jsonb),
  (8, 'price_table', '{"price_form": "recurring", "items": [{"description": "Månadshyra", "quantity": "1", "unit_price": "", "vat_rate": 25, "deduction_type": "none"}], "rut_rate": 50, "rot_rate": 30, "deduction_personal_number": ""}'::jsonb),
  (9, 'terms', '{"title": "§4 Drift och kostnader", "text": "Ange vad som ingår i hyran (värme, el, vatten, internet, parkering) och vad som debiteras separat efter förbrukning."}'::jsonb),
  (10, 'terms', '{"title": "§5 Hyresjustering", "text": "Hyran justeras enligt överenskommelse mellan parterna, alternativt årligen enligt konsumentprisindex (KPI), och meddelas skriftligen i god tid innan ändringen träder i kraft."}'::jsonb),
  (11, 'terms', '{"title": "§6 Underhåll och skötsel", "text": "Hyresgästen ansvarar för det inre underhållet av lokalen. Hyresvärden ansvarar för yttre underhåll och gemensamma utrymmen."}'::jsonb),
  (12, 'terms', '{"title": "§7 Skyltar och profil", "text": "Skyltning och profilmarkering utanför lokalen kräver hyresvärdens skriftliga godkännande."}'::jsonb),
  (13, 'terms', '{"title": "§8 Andrahandsuthyrning", "text": "Andrahandsuthyrning är inte tillåten utan hyresvärdens skriftliga godkännande."}'::jsonb),
  (14, 'terms', '{"title": "§9 Öppettider/nyttjandetid", "text": "Lokalen får nyttjas utan tidsbegränsning om inte annat anges."}'::jsonb),
  (15, 'terms', '{"title": "§10 Övrigt", "text": "Inga särskilda villkor utöver detta avtal."}'::jsonb),
  (16, 'checkbox_consent', '{"text": "Jag har läst och godkänner samtliga villkor i detta hyresavtal."}'::jsonb),
  (17, 'signature_block', '{"signer_index": 0}'::jsonb)
) AS blocks(position, block_type, content);
