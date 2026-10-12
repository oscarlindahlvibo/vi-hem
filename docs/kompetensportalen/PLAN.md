# Kompetensportalen 2.0 – inventering, arkitektur och plan

Status: Fas 1 (2026-10-12). Detta dokument uppdateras när beslut ändras. Ett separat dokument (`RAPPORT.md`) följer upp vad som är byggt, testat och produktionsverifierat.

## 1. Inventering (vad som faktiskt finns)

### 1.1 Kompetensportalen (repo `oscarlindahlvibo/kompetensportalen`, driftsatt på kompetensportalen.se)
| Del | Fynd | Bedömning |
|---|---|---|
| Frontend | `src/main.tsx` (37 rader, en fil), Vite + React Router. Platshållarinnehåll, hårdkodade fallback-kurser, "Markera klar"-knapp som gör lektioner klara från klienten, ingen kassa, ingen spelare. | **Ersätts** (ny frontend). Varumärkestillgångar (logotyp, ID06-ackrediteringsbild) återanvänds. |
| Backend | Tre Edge Functions (`api` 278 rader, `stripe-webhook`, `cron-daily`) med generiska namn i den delade funktionskatalogen. | **Ersätts** av namngivna `vihem-kp-*`-funktioner. De gamla lämnas orörda tills de pensioneras. |
| Databas | Schemat `kompetensportalen` (40 tabeller, **0 rader i produktion**). Text-ID:n, text-tidsstämplar, JSON som text, egen `users`-tabell vid sidan av Supabase Auth, ingen koppling till VI-HEM. RLS på men schemat är inte exponerat. | **Ersätts** av nytt schema (se 3). Inget att migrera från produktionen. Domänidéerna (kursversion, enrollment, licens, ID06-statusmaskin) återanvänds konceptuellt. |
| Kursinnehåll | `data/apv-seed.json` är **demodata** som uttryckligen inte är den riktiga APV-kursen. Riktigt innehåll finns i Odoo. | Importvägen byggs; riktigt innehåll måste exporteras ur Odoo av ägaren. |
| Odoo | Odoo 18 kör på servern (port 8069, lokal Postgres). Inloggningsuppgifter finns inte tillgängliga för mig (`odoo.conf` är läsbar bara för odoo). | **Beroende:** export av befintliga kurser, användare och provresultat kräver Odoo-åtkomst. |
| Auth | Egen `users`-tabell + Supabase Auth via `KP_ADMIN_EMAILS`-lista. | Ersätts: deltagare = `auth.users`; admin = `vihem_profiles` (VI-HEM). |
| Stripe | Kod finns men inga nycklar är satta; ingen produktionstrafik. | Byggs om (idempotens, webhook-styrd åtkomst). Nycklar saknas fortfarande. |
| BankID/ID06 | Adapter-gränssnitt utan leverantör. `vihem-bankid` finns i VI-HEM (befintligt avtal/stöd ej verifierat av mig). | Återanvänds där möjligt; ID06-API-behörighet **okänd** → manuell rutin + adapter som aldrig simulerar framgång. |

### 1.2 VI-HEM (återanvändbart)
- **Organisation/moduler/behörigheter:** `vihem_organisations`, `vihem_organisation_modules`, `get_my_org_id()`, `get_my_role()`, RLS-mönster från uthyrning. WPE Sweden AB finns redan som bolag (`vihem_companies`) inom organisationen Vibogruppen AB men saknar Accounted-koppling.
- **Ekonomi:** Accounted (extern bokföring) är kopplad för Vibogruppen AB. Delade moduler `accounted-company-context.ts`, `accounted-customer-resolver.ts`, `accounted-invoice-creator.ts` ger idempotent kund- och fakturaskapande med länktabeller. Käll-typerna är begränsade till `rental_billing | customer_project | manual_charge` → **utökas med `course_order`** (bakåtkompatibel CHECK-ändring).
- **Integrationsmönster:** privat schema + service-role-funktion (Vibofast/Ekängen/Gräv/ViboRent), `site-publish` för lösenordsfri sajtpublicering, Stripe-hjälpare, Cellsynt-SMS, Google Workspace-mejl (stöd för bilagor) och SMTP-mejl, pg_cron → `pg_net` → funktion med delad hemlighet, kryptering (AES-GCM) av hemligheter.
- **Delad Supabase:** Auth tillåter självregistrering med e-postbekräftelse (SMTP via vibogruppen.se). Redirect-allowlist innehåller app.vi-hem.se m.fl. men inte kompetensportalen.se.
- **Lagring:** Supabase Storage (privata buckets finns). Ingen videotranskodning installerad (ffmpeg saknas på servern).

### 1.3 Skillnader mellan kod och produktion
- Produktionssajten kompetensportalen.se visar den platshållar-frontend som beskrivs ovan; ingen kurs kan köpas eller genomföras. Schemat är tomt. Ingen betalning, inget certifikat och ingen ID06-registrering har någonsin genomförts via det nya systemet.

### 1.4 Teknisk skuld / risker i befintlig kod
Klientstyrd lektionsmarkering, text-ID/-datum, dubbla identitetstabeller, generiska funktionsnamn som kolliderar i delad katalog, hårdkodade fallback-kurser i frontend, saknade tester av kassa/prov.

## 2. Arkitekturbeslut

1. **Ett repo.** Webbplats + deltagarmiljö flyttas till monorepot (`apps/kompetensportalen`), backend till `supabase/functions/vihem-kp-*`, admin till `src/modules/kompetensportalen`. Skäl: ett släppvakt-flöde, en publiceringskedja (`deploy_sites.sh`), delad kod. Det gamla repot arkiveras (README-pekare) när allt är verifierat.
2. **VI-HEM är sanningskällan.** Alla affärsdata ligger i `public.vihem_kp_*` (RLS per organisation + modulen `kompetensportalen`). Webbplatsen skriver aldrig direkt i tabeller; den pratar med Edge Functions. Admin i VI-HEM använder RLS-skyddade tabeller direkt samt `vihem-kp-admin` för allt som kräver hemligheter.
3. **Ekonomisk/verksamhetsmässig separation:** alla KP-tabeller bär `organisation_id` och (där ekonomi berörs) `finance_company_id` = WPE Sweden AB. Inga delade kund-/ordertabeller med fastighetsförvaltningen. Fakturor skapas i Accounted under WPE:s eget bolag – kräver att WPE kopplas i VI-HEM Ekonomi (beroende).
4. **Identiteter:** deltagare/företagsadmin = Supabase Auth-användare (delad instans) utan VI-HEM-profil → inga adminrättigheter. Behörighet avgörs av tabeller (`vihem_kp_company_members`) och kontrolleras i funktionerna. Personnummer lagras krypterat i separat tabell utan läsrättighet för personal via RLS.
5. **Pengar:** `numeric(12,2)` SEK, historik på orderrader (pris, moms, villkorsversion).
6. **Betalning ≠ order ≠ bokning ≠ behörighet.** `payments` (Stripe-händelser, idempotent per provider-id), `orders`/`order_items`, `seats` (köpta platser) och `enrollments` (tillgång). Åtkomst skapas endast av en server-funktion (`vihem_kp_fulfill_order`) som anropas av verifierad webhook eller av administratör (faktura).
7. **Kursversioner:** utkast → publicerad (oföränderlig) → ersatt. Innehåll (moduler/lektioner/block/prov) hör till en version. Enrollments, provförsök och certifikat pekar på versionen.
8. **Video:** privat lagring + korta signerade URL:er (progressiv MP4 med Range). Uppföljning är serverbaserad: spelaren skickar signerade heartbeat-token; servern räknar faktisk speltid och godkänner lektion först vid uppfylld regel. HLS/adaptiv kvalitet kräver transkodning (Mux/Cloudflare Stream eller egen ffmpeg-worker) → dokumenteras som uppgradering, inte simulerad.
9. **Prov:** serverrättning; klienten får aldrig rätt svar. Försök lagrar frågesnapshot, svar, poäng, tider och revisionshändelser.
10. **Certifikat:** PDF skapas på servern (vektor-QR, logotyp, mall), unikt nummer + verifieringskod; publik verifiering visar minimiuppgifter. Typ skiljs: *utbildningsintyg* vs *kompetensbevis* vs *myndighets-/extern certifiering* (ID06 visas bara som registreringsstatus, aldrig som påstående).
11. **Fakturering:** orderkonto → `vihem-kp-admin` skapar faktura via Accounted-delarna (källtyp `course_order`), idempotent; ingen parallell fakturamotor.
12. **E-post:** `email_outbox` med idempotensnyckel, mallar i databasen, utskick via befintlig Google Workspace-/SMTP-infrastruktur av `vihem-kp-worker`.

## 3. Datamodell (översikt)
Katalog: `courses`, `course_versions`, `modules`, `lessons`, `lesson_blocks`, `media_assets`, `question_bank`, `question_options`, `exams`, `exam_rules`, `products`, `price_rules`, `discount_codes`, `bundles`/`bundle_items`.
Handel: `orders`, `order_items`, `payments`, `refunds`, `stripe_events`, `invoice_refs`.
Personer/företag: `participants`, `participant_identity` (krypterad), `customers` (företag), `company_members` (med historik).
Tillgång/lärande: `seats`, `enrollments`, `lesson_progress`, `video_sessions`, `exam_attempts`, `attempt_answers`.
Tillfällen: `sessions`, `session_bookings`, `waitlist`.
Intyg: `certificate_templates`, `certificates`, `certificate_events`, `external_registrations`.
Övrigt: `email_templates`, `email_outbox`, `site_pages`, `settings`, `audit_log`.

## 4. Faser och leveranskrav
1. **Inventering & arkitektur** – detta dokument.
2. **Databas + kursadministration** – migrationer, SQL-tester, VI-HEM-modul (kurser, byggare, frågebank, prov, priser).
3. **Webbplats + försäljning** – ny frontend, Stripe + faktura, företagsköp.
4. **Lärplattform** – spelare, serverbaserad uppföljning, prov, certifikat, privat media.
5. **Företag/tillfällen/ID06/kommunikation** – företagsportal, platser, tillfällen, adapter, mejl, påminnelser.
6. **Kvalitet & drift** – tester (de 15 flödena), säkerhetsgranskning, driftsättning, dokumentation, rapport.

## 5. Beroenden som inte kan lösas av mig
Stripe-nycklar + webhook; Accounted-koppling för WPE Sweden AB; ID06-avtal/API-behörighet; BankID-avtal (befintlig `vihem-bankid` ej verifierad för detta bruk); Odoo-export (kurser, användare, resultat); avsändardomän för e-post (kompetensportalen.se) i Google Workspace eller SMTP; juridisk granskning av villkor; riktigt kursinnehåll (video, texter, frågor); videoplattform-beslut för adaptiv strömning.

## 6. Juridik – flaggas för manuell granskning
Köpvillkor (privat/företag), ångerrätt vid digital leverans (särskilt samtycke att leveransen påbörjas), personuppgiftspolicy (personnummer, ID06), fakturavillkor, certifieringspåståenden. Mallar levereras som **utkast** märkta "kräver juridisk granskning".
