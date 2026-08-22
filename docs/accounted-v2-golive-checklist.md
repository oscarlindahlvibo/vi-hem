# Driftklar-checklista: koppla på Accounted

Steg-för-steg för att slå på en riktig Accounted-instans mot Finance V2 för
första gången. Se [accounted-v2-integration.md](accounted-v2-integration.md)
för hela arkitekturen — det här dokumentet är bara ordningen att göra det i.

Ingen av migrationerna/funktionerna i grunden kräver att detta körs på ett
visst sätt, men ordningen nedan minimerar risken att en admin råkar aktivera
skarp fakturering innan anslutningen faktiskt är verifierad.

## 0. Innan ni börjar (i Accounted)

- [ ] Skapa en API-nyckel i Accounted för VI-HEM med scopes: `companies:read`,
      `customers:read`, `customers:write`, `invoices:read`, `invoices:write`,
      `documents:write`, `webhooks:manage`. **Ge inte** `bookkeeping:write`
      eller `payroll:write` — inget i VI-HEM-integrationen behöver det.
- [ ] Notera Accounted company-id och bas-URL (https).
- [ ] Om scanner-vidarebefordran ska användas: notera bolagets
      invoice-inbox-mejladress i Accounted (den unika Resend-adressen för
      det bolaget).

## 1. Miljövariabler att verifiera i Supabase INNAN någon sparar en nyckel

- [ ] **`VIHEM_ACCOUNTED_SECRET_KEY`** satt i edge function-miljön
      (produktion). Utan denna kastar `save_company_link` ett
      `SECRET_ENCRYPTION_UNAVAILABLE`-fel — ofarligt (inget sparas
      okrypterat), men bättre att sätta i förväg än att upptäcka det mitt i
      ett måndagsmöte.
- [ ] SMTP-variablerna som redan används av `vihem-send-invoice-emails` är
      satta, **om** scanner → Accounted-vidarebefordran ska användas
      (samma `_shared/smtp-mailer.ts`-konfiguration).
- [ ] `VIHEM_ACCOUNTED_WEBHOOK_URL` — valfri. Om den inte sätts härleds
      webhook-URL:en automatiskt från `SUPABASE_URL`. Sätt den explicit bara
      om den publika URL:en skiljer sig från `SUPABASE_URL` (t.ex. en egen
      domän framför Supabase).

## 2. Bolagskoppling (Ekonomi V2)

Gör detta med kopplingen **inaktiverad** (`enabled` avstängd) tills steg 2c
är klart — inga fakturor kan skapas via V2 medan den är inaktiverad, så det
här går inte att göra fel.

- [ ] a) Fyll i bas-URL, Accounted company-id och API-nyckeln under
      Bolagskoppling. Spara.
- [ ] b) Klicka **Testa anslutning** — ska svara ok. Om inte: kontrollera
      URL/nyckel/scopes innan ni går vidare.
- [ ] c) Klicka **Registrera webhooks**. Detta skapar fyra prenumerationer
      (`invoice.created`, `invoice.sent`, `invoice.paid`,
      `credit_note.created`) i Accounted. Accounted SSRF-validerar att
      webhook-URL:en är publikt nåbar vid registreringen — om detta steg
      misslyckas med ett nätverksrelaterat fel är sannolikt orsaken att
      Supabase-projektets edge-funktions-URL inte är nåbar utifrån (brandvägg,
      privat nätverk). Detta MÅSTE lösas innan skarp drift, annars kommer
      fakturastatus (skickad/betald) aldrig synkas tillbaka till VI-HEM.
      **Säkert att klicka flera gånger** — redan registrerade event-typer
      hoppas över, ingen risk för dubbletter.
- [ ] d) Sätt invoice-inbox-mejladressen under Bolagskoppling om
      scanner-vidarebefordran ska användas.
- [ ] e) Aktivera kopplingen (`enabled`) när a–d är klara.

## 3. Verifiera end-to-end innan skarp fakturering för alla

- [ ] Kör en **förhandsgranskning (dry-run)** av en enskild hyresfaktura
      eller kundprojektfaktura i Ekonomi V2 — bekräftar att kund- och
      fakturaskapande fungerar utan att något skapas på riktigt.
- [ ] Skapa **en riktig testfaktura** med lågt belopp.
- [ ] Markera den betald/skickad direkt i Accounteds egna UI, och bekräfta
      att statusen uppdateras i Ekonomi V2:s Fakturor-flik inom en kort
      stund (bekräftar att webhook-leveransen faktiskt fungerar end-to-end,
      inte bara att registreringen i steg 2c lyckades).
- [ ] Om scanner-vidarebefordran används: skicka ett testdokument via
      Underlag-fliken, bekräfta att det dyker upp i Accounteds
      invoice-inbox-granskningskö.

## 4. Proaktiv hälsokontroll (ny — byggd inför denna driftsättning)

En ny pg_cron-körning (`vihem-accounted-healthcheck-every-30-minutes`)
kontrollerar nu automatiskt alla **aktiverade** bolagskopplingar var 30:e
minut och uppdaterar samma hälsostatus Bolagskoppling-fliken redan visar
(`last_health_status`/`last_health_check_at`/`last_health_error`) — en
trasig koppling (utgången nyckel, nätverksproblem) upptäcks alltså inom 30
minuter istället för att vänta på att någon råkar klicka "Testa anslutning".

- [ ] Verifiera att cron-jobbet finns och kör (kör i Supabase SQL-editor
      eller `psql`):
      ```sql
      SELECT jobid, jobname, schedule, active FROM cron.job
      WHERE jobname = 'vihem-accounted-healthcheck-every-30-minutes';
      ```
- [ ] Efter minst en körning, kontrollera senaste körresultat:
      ```sql
      SELECT status, return_message, start_time
      FROM cron.job_run_details
      WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'vihem-accounted-healthcheck-every-30-minutes')
      ORDER BY start_time DESC LIMIT 5;
      ```
- [ ] Valfritt: en superadmin kan trigga samma kontroll manuellt direkt (utan
      att vänta på cron) genom att anropa `vihem-accounted-healthcheck` med
      sin egen inloggning — användbart för att verifiera funktionen fungerar
      innan ni väntar 30 minuter på första cron-körningen.

## 5. Säkerhetsgenomgång — vad som redan granskats

Gjord specifikt för de nya `vihem_accounted_*`- och
`vihem_billing_adjustments*`-tabellerna/funktionerna inför denna
driftsättning (utöver den ursprungliga helhetsgranskningen). Inga
blockerande fynd. Sammanfattning:

- **RLS**: samtliga nya tabeller har `ENABLE ROW LEVEL SECURITY`, läsning
  scopad till bolagsåtkomst (eller superadmin), och **alla** klient-writes
  (`INSERT`/`UPDATE`/`DELETE`) explicit satta till `USING (false)` — bara
  service-role (Edge Functions) kan skriva. `vihem_accounted_secrets` och
  `vihem_accounted_webhook_events` är helt oläsbara för klienter (kan
  innehålla nycklar respektive PII i råa webhook-payloads).
- **Kryptering**: API-nycklar och webhook-hemligheter AES-GCM-krypteras med
  en dedikerad nyckel (`VIHEM_ACCOUNTED_SECRET_KEY`), slumpmässig IV per
  kryptering, ingen fallback/standardnyckel — saknas miljövariabeln
  **kastas ett fel istället för att spara okrypterat**.
- **Webhook-verifiering**: HMAC-SHA256 med timing-safe jämförelse,
  ±5 minuters tidsfönster mot replay-attacker, unikt per prenumeration
  (en läckt hemlighet för en event-typ påverkar inte de andra), idempotent
  bearbetning via unik `(company_link_id, dedupe_key)`.
- **Idempotens mot Accounted**: alla skrivande anrop (kund, faktura,
  webhook-registrering) använder en deterministisk `Idempotency-Key` härledd
  från VI-HEMs egen post-identitet — en nätverkstimeout kan alltid säkert
  göras om utan risk för dubblettfaktura.
- **Webhook-registrering är redan idempotent** (verifierat i kod, se
  `vihem-accounted-admin`s `handleRegisterWebhooks`): kör man "Registrera
  webhooks" flera gånger skapas inga dubbletter, redan registrerade
  event-typer hoppas bara över.

**Ej blockerande observationer** (medvetna designval, inte fel):
- `accounted_base_url` valideras bara mot `https://`-prefix, inte mot
  interna/privata IP-intervall — samma tillitsnivå som övriga
  admin-konfigurerade integrations-URL:er i VI-HEM (t.ex. Beds24, Google
  Workspace). Kräver redan `admin`-bolagsbehörighet att sätta.
- CORS är `Access-Control-Allow-Origin: *` på de JWT-skyddade
  funktionerna, samma mönster som resten av kodbasen — inte exploaterbart
  utan att redan ha en giltig Bearer-token.

## 6. Om något går fel på måndag

**Ingen destruktiv åtgärd behövs.** Stäng av kopplingen
(`enabled` → av) under Bolagskoppling: det blockerar omedelbart alla nya
V2-fakturor för det bolaget (både hyres- och kundprojektfakturering
kontrollerar `enabled` innan de skapar något), utan att röra en enda rad i
legacy `vihem_invoices`/`FinancePage.tsx`-flödet. Redan skapade
Accounted-fakturor och deras länkar i `vihem_accounted_invoice_links`
påverkas inte — de fortsätter synkas via webhook oavsett `enabled`-läget
(statusuppdateringar är läsning/synk, inte ny fakturering).
