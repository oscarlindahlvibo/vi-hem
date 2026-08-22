# VI-HEM ↔ Accounted (V2) – arkitektur och status

Detta dokument beskriver Finance V2-grunden: hur VI-HEM kopplas mot en
självhostad [Accounted](https://github.com/erp-mafia/accounted)-instans som
blir source of truth för den riktiga kundfakturan, fakturanummer,
faktura-PDF, kundreskontra och betalstatus.

Detta ersätter **inte** den befintliga `provider = 'accounted'`-inställningen
i `vihem_accounting_integrations` / `supabase/functions/_shared/accounted.ts`
(dokumenterad i [accounted-integration.md](accounted-integration.md)). Den
gamla integrationen skickar redan skapade VI-HEM-fakturor/kunder/betalningar
till Accounted i efterhand som en av flera bokföringsadaptrar (Fortnox,
Spiris, SIE …). Den nya integrationen som beskrivs här gör Accounted till den
**prospektiva** fakturaskaparen: VI-HEM skickar ett underlag *innan* fakturan
finns, och Accounted svarar med den riktiga fakturan. De två systemen är
medvetet separerade tills vidare — se `docs/accounted-integration.md` för den
gamla vägen.

## Arkitekturprincip

```
VI-HEM frontend (src/modules/finance-v2)
        ↓ Supabase JS (aldrig Accounted-nyckeln)
VI-HEM backend (Supabase Edge Functions, vihem-accounted-*)
        ↓ REST, Bearer gnubok_sk_..., Idempotency-Key, dry-run
Accounted /api/v1 (självhostad)
        ↓
bokföring, fakturanummer, PDF, kundreskontra, betalstatus, moms
```

VI-HEM äger fortsatt: hyresavtal, grundhyror, eldebitering, avdrag/tillägg,
kundprojekt (tid/material/pris), faktureringsunderlag innan fakturan finns,
avbetalningsplaner, korttidsbokningar/-kvitton. Accounted äger fakturan från
och med att den skapas där, plus allt kring bokföring/moms/reskontra/SIE.

## Status

Samtliga faktureringsvägar från originalspecens etappordning (1.
hyresfakturering, 2. avdrag/tillägg, 3. kundprojektfakturering, 4.
portal-sync, 5. scanner → Accounted) är nu byggda i grundform. **Klart:**
bolagskoppling, kundlänkning, fakturaskapande (generisk + hyresfakturering
+ kundprojektfakturering), webhook-grund, samlingsfaktura för
kundprojektunderlag (flera underlag → en Accounted-faktura), generell
avdrag/tillägg-modul (kopplad till hyresfakturering OCH kundprojekt, med
skapa-UI för båda måltyperna), hyresgästportalens fakturavy (lista + PDF,
Accounted som source of truth), scanner → Accounted (e-postkanalen),
avbetalningsplaner tillgängliga i Finance V2 (samma delade
`InstallmentPlansPanel`, inte omskrivet mot Accounted).
**Kvar:** avdrag/tillägg och fakturering för korttidsuthyrning (och andra
framtida faktureringskällor bortom hyra/kundprojekt) — se avsnittet
"Avdrag & tillägg" nedan för exakt vad det gapet innebär, samlingsfaktura
för hyresfakturering (bara kundprojekt har funktionen idag — se
"Samlingsfaktura" nedan), en riktig server-till-server-koppling för
scanner om e-postkanalen visar sig otillräcklig, en genväg för att bygga
en avbetalningsplan direkt från en Accounted-faktura (går redan via det
befintliga externa-underlag-fältet, men utan en egen "hämta från
Accounted"-väljare).

## Vad som finns

### Nya tabeller

`20260821090000_accounted_v2_foundation.sql`:

| Tabell | Syfte |
| --- | --- |
| `vihem_accounted_company_links` | organisation/bolag ↔ Accounted company-id, bas-URL, aktiverad, hälsostatus |
| `vihem_accounted_secrets` | krypterad API-nyckel per bolagskoppling + krypterad webhook-hemlighet per prenumeration. RLS blockerar all klientåtkomst. |
| `vihem_accounted_customer_links` | VI-HEM-kund/hyresgäst ↔ Accounted customer_id, med `source_type`/`source_id` för att stödja fler källor senare |
| `vihem_accounted_invoice_links` | VI-HEM-källa ↔ Accounted-faktura: `source_type`/`source_id`, `accounted_invoice_id`, status, belopp, `remaining_amount` — lokal läsmodell för Finance V2 |
| `vihem_accounted_webhook_subscriptions` | en rad per (bolagskoppling, event_type) — Accounted tillåter bara en event-typ per prenumeration |
| `vihem_accounted_webhook_events` | inkommande webhook-leveranser (idempotens + felsökning) |

Alla fyra länktabeller är läsbara för användare med bolagsåtkomst
(`vihem_user_has_company_access`) men **skrivbara endast av service-role**
(`USING (false)` för `authenticated`). Frontend kan alltså aldrig fabricera
en "länkad"/"synkad" rad — varje skrivning måste först ha gått via Accounteds
API i en Edge Function.

`20260821120000_accounted_v2_rent_billing_link.sql`:

- `vihem_rent_billing_items.accounted_invoice_link_id` (nullable FK) — låter
  en hyresrad faktureras via Accounted istället för legacy `invoice_id`.
  Ett och samma villkor (`invoice_id IS NULL AND accounted_invoice_link_id
  IS NULL`) styr vilka rader V2-batchen plockar upp, så legacy
  `vihem_generate_rent_invoices` och V2 kan aldrig dubbelfakturera samma
  rad.

`20260821130000_accounted_v2_project_billing_link.sql`: samma mönster som
ovan fast för `vihem_project_invoice_basis.accounted_invoice_link_id`.

`20260821140000_accounted_v2_invoice_link_many_sources.sql`: tar bort
`vihem_accounted_invoice_links`s `UNIQUE (company_link_id,
accounted_invoice_id)` (hittad dynamiskt via `information_schema`, inte ett
gissat constraint-namn) och ersätter med ett vanligt index. Se avsnittet
"Samlingsfaktura (kundprojekt)" nedan.

`20260821150000_billing_adjustments.sql`:

| Tabell | Syfte |
| --- | --- |
| `vihem_billing_adjustments` | avdrag/tillägg: `target_type`/`target_id` (generiskt, samma mönster som övriga länktabeller), signerat `amount` (positivt=tillägg, negativt=avdrag), engångs/återkommande, period-/antalsgränser, `applied_count` |
| `vihem_billing_adjustment_applications` | konsumtionsspår — en rad skapas ENDAST efter att Accounted bekräftat fakturan; ingen "pending"-status finns i denna tabell |

Samma mönster som övriga länktabeller: läsbara vid bolagsåtkomst,
`vihem_billing_adjustments` skrivbar endast via
`vihem-billing-adjustments`-funktionen (inte direkt av klient — se
avsnittet om avdrag/tillägg nedan för varför), `..._applications` helt
skrivskyddad för klienter.

`20260821160000_accounted_v2_tenant_invoice_view.sql`:

- `vihem_accounted_invoice_links.invoice_date`/`.due_date` (nullable) — de
  två fält hyresgästportalen behöver som inte redan cachades lokalt.
  Populeras vid fakturaskapande, webhook-uppdatering och manuell
  `refresh_status`, precis som övriga cachade fält.
- Utökad SELECT-policy på `vihem_accounted_invoice_links`: en hyresgäst får
  nu läsa sina egna rader (`source_type = 'rental_billing'` och
  `vihem_rent_billing_items.tenant_id = auth.uid()`) som en tredje
  OR-gren, utöver superadmin och bolagsåtkomst som redan fanns.

`20260821170000_accounted_v2_scanner_forwarding.sql`:

- `vihem_accounted_scanner_uploads` — spårar varje underlag som mejlats
  till Accounteds invoice-inbox: fil, status (`queued`/`sent`/`failed`),
  felmeddelande. Ingen ny storage-bucket — återanvänder `vihem-documents`,
  samma bucket legacy-scannern redan använder.

`invoice_inbox_email` för ett bolag lagras inte som en egen kolumn utan i
`vihem_accounted_company_links.settings` (jsonb-kolumnen som redan fanns
från grundmigrationen) — ingen schemaändring behövdes för det.

Migrationerna rör inte någon tabell som legacy-ekonomin skriver till för
befintlig produktionsfakturering (`vihem_invoices`, `vihem_accounting_*`,
`vihem_rent_adjustments`, etc.) — bara additiva kolumner/tabeller.

### Delad logik (`_shared/`)

- **`accounted-crypto.ts`** — AES-GCM-kryptering av Accounted-hemligheter, egen miljövariabel `VIHEM_ACCOUNTED_SECRET_KEY`.
- **`accounted-rest-client.ts`** — enda platsen som bygger ett `Bearer gnubok_sk_...`-anrop mot Accounted. Idempotency-Key, dry-run, timeout, strukturerat felkuvert (`AccountedApiError`), plus `getBinary()` för Accounteds PDF-endpoint (raw `application/pdf`, inte v1-JSON-kuvertet).
- **`accounted-company-context.ts`** — laddar bolagskoppling + dekrypterad API-nyckel; enhetliga felkoder (`ACCOUNTED_NOT_LINKED`/`ACCOUNTED_LINK_DISABLED`/`ACCOUNTED_NO_API_KEY`) oavsett vilken funktion som anropar.
- **`accounted-customer-resolver.ts`** — `resolveOrCreateAccountedCustomer`: kundlänkning/-skapande, delad mellan `vihem-accounted-customers` och batch-anrop (hyresfakturering, framtida kundprojekt) så logiken bara finns på ett ställe.
- **`accounted-invoice-creator.ts`** — `createAccountedInvoiceForSource`: samma sak för fakturaskapande (ett VI-HEM-underlag → en Accounted-faktura). Sedan detta steg även `createAccountedCollectionInvoiceForSources`: flera VI-HEM-underlag → EN Accounted-faktura, se "Samlingsfaktura" nedan.
- **`billing-adjustments.ts`** — `listEligibleAdjustments`/`buildAdjustmentLineItems`/`recordAdjustmentApplications`: avdrag & tillägg-logiken, se eget avsnitt nedan.
- **`smtp-mailer.ts`** — SMTP-klient med bilaga, för scanner-vidarebefordran. En anpassad **kopia** av den redan fungerande implementationen i `vihem-send-invoice-emails/index.ts` (inte en extraktion som även skriver om originalet) — den funktionen skickar riktiga produktionsfakturamejl idag, och att röra den var inte värt risken för det som annars är en engångsduplicering. Om den nya modulen visar sig hålla är att migrera originalet till den ett separat, framtida steg.
- **`vihem-auth.ts`** — delat auth/behörighetshjälpmedel (JWT + `vihem_user_has_company_access`). Befintliga 30+ Edge Functions är **inte** omskrivna till detta.

### Edge Functions

- **`vihem-accounted-admin`** — `save_company_link` (nu även `invoice_inbox_email`, sparas i `settings`), `test_connection`, `register_webhooks`. Kräver `admin`-bolagsbehörighet.
- **`vihem-accounted-customers`** — hittar befintlig kundkoppling eller skapar kunden i Accounted (idempotent, dry-run-stödd). Tunn wrapper runt den delade resolvern.
- **`vihem-accounted-invoices`** — `create` (generisk, idempotent, dry-run-stödd) och `refresh_status`. Tunn wrapper runt den delade skaparen.
- **`vihem-accounted-rent-billing`** — batchar fakturaskapande för en hel hyreskörning: för varje ej fakturerad rad, länka/skapa Accounted-kunden (`vihem_finance_customers`, via `finance_customer_id`), hämta gällande avdrag/tillägg för hyresförhållandet och perioden, och skapa fakturan (grundhyra + hyresjusteringar redan summerat av befintlig SQL, plus en rad per avdrag/tillägg). Partial-success-svar per rad, samma mönster som Accounteds egen `bulk-create`.
- **`vihem-accounted-project-billing`** — två anropsformer på samma endpoint: `{ basis_id }` skapar Accounted-fakturan för ETT `ready_for_invoicing`-faktureringsunderlag (ursprunglig väg, oförändrat beteende); `{ basis_ids: [...] }` (2–25 st) skapar EN samlingsfaktura av flera underlag, se "Samlingsfaktura" nedan. Återanvänder den befintliga SQL-funktionen `vihem_ensure_finance_customer_for_project` (samma match-eller-skapa-logik som legacy-RPC:n) för kundmatchning, kör som anropande användare (inte service-role) eftersom funktionen är `SECURITY DEFINER` och läser `auth.uid()` internt. Fakturarader byggs direkt från underlagets `ready`-rader (tid/material/ändringsorder/fast pris), plus gällande avdrag/tillägg för projektet (`target_type = 'customer_project'`, period = dagens datum eftersom projekt saknar en kalenderperiod-koppling).
- **`vihem-billing-adjustments`** — `create`/`update` för avdrag/tillägg. Enda platsen som får skriva till `vihem_billing_adjustments`.
- **`vihem-accounted-tenant-invoices`** — `GET ?invoice_link_id=`, hyresgäst-scopad. Proxar Accounteds PDF-endpoint: verifierar ägarskap manuellt (`vihem_rent_billing_items.tenant_id = caller.id`, samma relation som RLS-policyn nedan) eftersom en binär PDF-respons inte kan gå via en vanlig RLS-skyddad tabellfråga. Vanlig `verify_jwt` (ingen `config.toml`-ändring) eftersom Accounted aldrig anropar den här — bara den inloggade hyresgästens webbläsare.
- **`vihem-accounted-scanner-forward`** — laddar ner en redan uppladdad fil från `vihem-documents`, mejlar den till bolagets Accounted-inkorgsadress via `smtp-mailer.ts`, och spårar status i `vihem_accounted_scanner_uploads`. Kräver `seller`-bolagsbehörighet.
- **`vihem-accounted-webhook`** — publik mottagare, HMAC-verifierad (`X-Gnubok-Signature`, Stripe-liknande schema), **ingen** Supabase-JWT. Måste deployas med `verify_jwt = false` (redan satt i `supabase/config.toml`).

Ingen av dessa funktioner ger AI-tolkning eller PDF-generering själva — det
sker i Accounted, som redan har stöd för direkt Anthropic API i
självhostat läge (se `docs/SELF-HOSTING.md` i Accounted-repot, sektion
"Option 1: the direct Anthropic API").

### Frontend

`src/modules/finance-v2/` (types.ts, api.ts, pages/FinanceV2Page.tsx) — helt
separat modul enligt strukturen `ARCHITECTURE_ROADMAP.md` föreslår. Nås via
en ny meny-post "Ekonomi V2 (beta)", med samma gating som legacy `finance`:
org-admin + organisationens `finance`-modul aktiverad
([Layout.tsx](../src/components/Layout.tsx), [App.tsx](../src/App.tsx)).
Legacy `FinancePage.tsx` är oförändrad utöver att den nu kallas "legacy" i
kommentarer/dokumentation — ingen kod i den filen är rörd.

Nio flikar: Översikt, Bolagskoppling (spara URL/company-id/API-nyckel,
Accounted-inkorgsadress, testa anslutning, registrera webhooks),
**Fakturering** (hyra: välj hyresperiod → hämta körning från befintlig
`vihem_create_rent_billing_run` → förhandsgranska mot Accounted som
dry-run → skapa fakturor på riktigt, med resultat per rad),
**Kundprojekt** (listar `ready_for_invoicing`-underlag oavsett projekt,
förhandsgranska/skapa faktura per underlag — underlaget självt skapas
fortfarande i Kundprojekt-sidan, orörd; kryssrutor + en samlingsåtgärd
låter en markera 2+ underlag och förhandsgranska/skapa DEM som en enda
Accounted-faktura, se "Samlingsfaktura" nedan), **Avdrag & tillägg**
(filtrerbar lista — Alla/Aktiva/Återkommande/Kommande/Pausade/Förbrukade-
historik — plus ett skapa-formulär med en måltyp-väljare
(hyresgäst/kundprojekt) och en beroende hyresgäst- eller
projektväljare; se eget avsnitt nedan),
**Underlag** (filuppladdning + skickade-underlag-lista; se
"Scanner → Accounted" nedan), Fakturor (läser
`vihem_accounted_invoice_links`), **Avbetalningsplaner** (samma delade
panel som legacy använder, se eget stycke nedan), och Kommande
(platshållare för det som inte är byggt än).

**Hyresgästportalen.** [`src/pages/TenantInvoicesPage.tsx`](../src/pages/TenantInvoicesPage.tsx)
— ny sida, ny meny-post "Mina fakturor" i "Hem"-gruppen
([Layout.tsx](../src/components/Layout.tsx)), gated `roles: ['tenant']` +
`module: 'finance'`. Listar hyresgästens egna rader ur
`vihem_accounted_invoice_links` (fakturanummer, datum, förfallodatum,
belopp, återstående belopp, status) via den utökade RLS-policyn — ingen
egen edge function behövs för listan, bara `vihem-accounted-tenant-
invoices` för själva PDF:en. Datafunktionerna (`listMyRentInvoices`,
`fetchMyInvoicePdfUrl`) ligger i samma `src/modules/finance-v2/api.ts` som
admin-sidans funktioner — samma modul, samma Accounted-domän, bara en
annan sida/målgrupp som anropar den.

Ingen manuell uppdateringsknapp på hyresgästsidan (till skillnad från
admin-fliken "Fakturor") — `refresh_status` kräver `seller`-bolagsbehörighet
som en hyresgäst inte har. Statusuppdateringar (betald, skickad osv.) når
alltså hyresgästen enbart via webhooks. Om webhookarna inte är registrerade
för ett bolag ser hyresgästen en faktura som fastnat på sin ursprungliga
status tills en admin uppdaterar den via Ekonomi V2 eller registrerar
webhooks under Bolagskoppling.

**Avbetalningsplaner.** Fliken renderar det befintliga
[`InstallmentPlansPanel`](../src/components/InstallmentPlansPanel.tsx)
oförändrat — samma komponent legacy `FinancePage.tsx` redan använder, nu
med två anropare istället för en. Finance V2 matar den med tre
organisation-scopade läsningar (`listCompaniesForInstallmentPlans`,
`listFinanceCustomersForInstallmentPlans`,
`listLegacyInvoicesForInstallmentPlans` i `api.ts`) som är exakta kopior
av FinancePage.tsx:s egna frågor mot `vihem_companies`/
`vihem_finance_customers`/`vihem_invoices`, så panelen beter sig identiskt
oavsett varifrån den renderas.

Detta är en **ren flytt av åtkomst**, inte en ombyggnad: panelen skapar
fortfarande sina egna administrativa "delfakturor" mot legacy
`vihem_invoices` via RPC:n `vihem_generate_installment_invoice`
(`accounting_exportable` är hårdlåst till `false` i databasen på både
`vihem_installment_plans` och `vihem_installment_payments`, så inget av
detta någonsin når bokföring eller Accounted). Det är ett medvetet val,
inte en genväg: originalspecen är uttrycklig om att en avbetalningsplan
ska vara ett betalningsuppföljningslager ovanpå redan existerande skuld
— "VI-HEM ska INTE skapa nya ersättningsfakturor i Accounted varje
månad" — så delfaktura-mekanismen ska inte skrivas om mot Accounted.

En plan kan redan idag byggas på en Accounted-skapad hyres- eller
kundprojektfaktura, men bara via panelens befintliga "Övriga
ursprungsunderlag"-sektion (fritextfälten `external_invoice_number`/
`external_invoice_date`/`external_due_date`/`amount` — samma mekanism
som redan används för alla fakturor VI-HEM inte har en lokal
`vihem_invoices`-rad för). En genväg som fyller i de fälten automatiskt
från en vald `vihem_accounted_invoice_links`-rad är inte byggd i denna
etapp — panelen är oförändrad, så det skulle vara ett separat, litet
tillägg till just den komponenten.

`InstallmentPlansPanel.tsx` och `FinancePage.tsx` är **oförändrade** —
`git status` bekräftar noll ändringar i båda filerna för detta steg.

Kundskapande i Accounted (steget innan fakturan) körs alltid på riktigt,
även under en fakturas dry-run — att skapa en kundpost har ingen ekonomisk
effekt, och fakturans dry-run behöver ett riktigt `customer_id` att
validera mot. Endast själva fakturaskapandet respekterar dry-run-flaggan.

## Accounted-sidan: vad som redan finns och används

Verifierat direkt mot `github.com/erp-mafia/accounted` (klonad för denna
genomgång, inte modifierad):

- **REST-API**: `/api/v1/companies`, `/companies/{id}/customers`
  (+ `bulk-create`), `/companies/{id}/invoices` (+ `bulk-create`, `/send`,
  `/mark-paid`, `/credit`, `/pdf`), `/companies/{id}/documents`,
  `/companies/{id}/webhooks`. Alla skyddade av API-nyckel
  (`Authorization: Bearer gnubok_sk_...`) med scopes.
- **Rekommenderade scopes för VI-HEMs nyckel**: `companies:read`,
  `customers:read`, `customers:write`, `invoices:read`, `invoices:write`,
  `documents:write`, `webhooks:manage`. Ge **inte** `bookkeeping:write`
  eller `payroll:write` — inget i denna integration behöver det.
- **Idempotens**: `Idempotency-Key` är obligatorisk på skrivande v1-anrop;
  Accounted spelar upp cachat svar vid samma nyckel+body. `?dry_run=true`
  eller `X-Dry-Run: true` kör valideringssteget utan att skriva något.
- **Felformat**: `{ error: { code, message, message_en, details,
  recovery_hint, docs_url, request_id } }` — VI-HEMs klient och Edge
  Functions returnerar `code`/`recovery_hint` vidare istället för att bara
  visa HTTP-status.
- **Webhooks**: en `event_type` per prenumeration (inte en lista), hemlighet
  returneras exakt en gång vid skapande, leverans signeras
  `X-Gnubok-Signature: t=<unix>,v1=<hmac-sha256("t.body")>`, at-least-once
  med backoff — mottagaren måste vara idempotent (vilket
  `vihem-accounted-webhook` är, via upsert på `accounted_invoice_id`).
- **AI/Claude**: Accounted har inbyggt stöd för direkt Anthropic API
  (`ANTHROPIC_API_KEY`) i självhostat läge, använt av bl.a.
  `invoice-inbox`-extensionen. VI-HEM ska **inte** bygga en egen
  Claude-integration för dokumenttolkning.
- **Licens**: AGPL-3.0 med en uttrycklig "extension exception" — tredjeparts-
  extensions som *endast* pratar med Accounted via det dokumenterade
  Extension API (`lib/extensions/types.ts`, `app/api/extensions/ext/[...path]`)
  får licensieras fritt, men får inte modifiera Accounteds källkod. VI-HEM
  själv triggar aldrig AGPL eftersom vi bara pratar med Accounted över
  nätverket (REST/webhook) — ingen Accounted-kod är kopierad eller länkad in
  i VI-HEM.

## Scanner → Accounted

Undersökt konkret i Accounted-koden:

- `extensions/general/invoice-inbox` har en manuell uppladdningsroute
  (`POST /upload` på `/api/extensions/ext/invoice-inbox/upload`), men den
  routen går genom `app/api/extensions/ext/[...path]/route.ts`, som kräver
  en **Supabase-sessionscookie** (`requireAuth()` → `supabase.auth.getClaims/
  getUser()`), inte API-nyckel-Bearer. Den är alltså byggd för Accounteds
  egen webb-UI, **inte** server-till-server-anrop från VI-HEM.
- invoice-inbox har däremot en **e-postbaserad** kanal: varje bolag får en
  unik inkorgsadress (Resend inbound), och dokument som mejlas dit fångas,
  läses av med AI och hamnar i granskningskön — exakt samma flöde som en
  vidarebefordrad leverantörsfaktura idag.

**Implementerat**: e-postkanalen, inte ett nytt API-anrop.
[`vihem-accounted-scanner-forward`](../supabase/functions/vihem-accounted-scanner-forward/index.ts)
laddar ner en fil som redan laddats upp till `vihem-documents` från
frontend, och mejlar den (via [`_shared/smtp-mailer.ts`](../supabase/functions/_shared/smtp-mailer.ts),
VI-HEM:s redan konfigurerade Postfix/SMTP — se root-`README.md`) till
bolagets Accounted-inkorgsadress, som en admin en gång sparar manuellt
under Bolagskoppling (`vihem_accounted_company_links.settings.
invoice_inbox_email` — inte en ny kolumn, den fanns redan). Flödet:
personal öppnar Underlag-fliken i Ekonomi V2 → väljer fil → VI-HEM laddar
upp filen och skickar den vidare → Accounted tar över (AI-extraktion,
granskning, attest). Detta kräver **ingen** ändring i Accounted.

Legacy-scannern i `FinancePage.tsx` (`vihem-process-supplier-invoice-ocr`,
VI-HEM:s egen OCR/AI) är **oförändrad** och finns kvar parallellt — de två
vägarna delar ingen kod och en organisation väljer själv vilken de
använder för ett givet underlag.

Om ett äkta server-till-server-API senare visar sig nödvändigt (t.ex. för att
slippa mejl-latens eller för att få tillbaka ett dokument-id synkront), är
rekommendationen fortsatt en **separat** Accounted-extension
(`extensions/general/vihem-bridge` eller liknande, eget `manifest.json`) som
exponerar en API-nyckel-autentiserad `apiRoutes`-endpoint enligt samma
mönster som `lib/api/v1/with-api-v1.ts` använder — INTE en ändring av
`invoice-inbox`s egen kod. Kräver ett separat beslut och arbete i
Accounted-repot; inte gjort.

## Vad som INTE är byggt än

1. ~~Hyresfakturering~~ Klart (`vihem-accounted-rent-billing`) — grundhyra
   och hyresjusteringar. Elförbrukning/eldebitering är inte beräknad
   någonstans i kodbasen ännu (varken legacy eller V2) och ingår därför
   inte i vad som faktureras.
2. ~~En allmän avdrag & tillägg-modul~~ Klart (`vihem_billing_adjustments`,
   `vihem-billing-adjustments`), kopplad in i hyresfakturering OCH
   kundprojektfakturering, med skapa-UI för båda måltyperna. Inte kopplad
   till korttidsuthyrning (eller andra framtida faktureringskällor bortom
   hyra/kundprojekt) — varken konsumtion i en faktureringsfunktion eller
   ett `target_type` för det finns byggt. Detta är ett medvetet
   scope-beslut för denna etapp, inte ett förbiseende: uppdraget bad
   specifikt om "avdrag & tillägg för fler källor (korttidsuthyrning
   m.fl.)", vilket tolkades som att stänga gapet i skapa-UI:t mellan vad
   backend redan konsumerar (`tenancy`, `customer_project`) och vad
   gränssnittet exponerade (bara `tenancy`) — INTE som att bygga en full,
   ogranskad korttidsfaktureringsväg. Kvitton från korttidsuthyrning
   skapar fortsatt aldrig automatiskt en Accounted-faktura (kvitto ≠
   faktura, per originalspecen), och ingenting i denna etapp ändrar det.
3. ~~Kundprojektfakturering mot den nya vägen~~ Klart
   (`vihem-accounted-project-billing`), inklusive samlingsfaktura av flera
   underlag (`{ basis_ids: [...] }`, se "Samlingsfaktura" nedan) — legacy
   `vihem_create_invoice_from_project_basis_batch`s förmåga att slå ihop
   flera underlag till EN faktura är alltså nu porterad till V2-vägen,
   inte bara förberedd på datamodellnivå. Samlingsfakturering för
   hyresfakturering (`vihem-accounted-rent-billing`) är fortfarande inte
   byggd — samma datamodell stödjer det, men funktionen är inte
   implementerad för den vägen i denna etapp.
4. ~~Hyresgästportalens fakturavy~~ Klart (`TenantInvoicesPage.tsx`,
   `vihem-accounted-tenant-invoices`) — lista + PDF, Accounted som source of
   truth. Bara hyresfakturor (`source_type = 'rental_billing'`); en
   hyresgäst med kundprojekt- eller andra fakturor via Accounted ser inte
   dem här, eftersom ingen sådan koppling mellan hyresgäst och de
   `source_type`erna finns i datamodellen.
5. ~~Scanner → Accounted-kopplingen~~ Klart (`vihem-accounted-scanner-
   forward`, fliken Underlag) — e-postkanalen. Ett äkta server-till-server-
   API (separat Accounted-extension) är fortsatt inte byggt, se avsnittet
   ovan.
6. Avbetalningsplaner i Finance V2-gränssnittet (fortsatt legacy tills
   vidare — panelen finns redan och flyttas inte i denna etapp).

### Samlingsfaktura (kundprojekt)

`vihem_accounted_invoice_links` hade tidigare `UNIQUE (company_link_id,
accounted_invoice_id)`, vilket tvingade fram exakt en VI-HEM-källa per
Accounted-faktura. Migration `20260821140000_accounted_v2_invoice_link_
many_sources.sql` tar bort den constrainten (dynamiskt, via
`information_schema`-uppslag — inte ett hårdkodat constraint-namn) och
ersätter den med ett vanligt index för snabba uppslag. Kvar står
`UNIQUE (company_link_id, source_type, source_id)`, vilket ger exakt den
relation som efterfrågades:

```
en VI-HEM source (source_type, source_id)  → högst en Accounted-faktura
en Accounted-faktura (accounted_invoice_id) → kan ha flera VI-HEM sources
```

Denna etapp bygger själva sammanslagningsfunktionen ovanpå den modellen,
för kundprojektfakturering: `createAccountedCollectionInvoiceForSources`
(`_shared/accounted-invoice-creator.ts`) skapar EN Accounted-faktura och
skriver sedan en `vihem_accounted_invoice_links`-rad per källa, alla
pekande på samma `accounted_invoice_id`. Anropas från
`vihem-accounted-project-billing` när begäran har `basis_ids` (2–25
unika id) istället för `basis_id`:

- Varje underlag valideras individuellt (samma `NOT_FOUND`/
  `ALREADY_INVOICED`/`NOT_READY`/bolagsmatchning/`NO_LINES`-kontroller som
  enskild fakturering).
- Alla underlag måste tillhöra samma Accounted-kund — kontrolleras
  explicit innan Accounted-anropet (`PROJECT_BASIS_CUSTOMER_MISMATCH` om
  inte), eftersom en Accounted-faktura bara kan ha en kund.
- Gällande avdrag/tillägg hämtas för samtliga distinkta projekt bland de
  valda underlagen (deduplicerat på avdrags-id) och läggs till som egna
  rader på den kombinerade fakturan.
- Fakturarader taggas med underlagets nummer/titel i beskrivningen, så en
  kombinerad faktura fortfarande går att läsa rad för rad per underlag.
- Idempotency-Key härleds från den sorterade, deduplicerade
  källkombinationen — samma kombination igen returnerar Accounteds
  cachade svar; en annan kombination (en källa mer/färre) är en ny
  begäran, inte en repetition av den gamla.
- Efter lyckad fakturaskapelse markeras varje underlag `invoiced`
  individuellt; om uppdateringen misslyckas för ett enskilt underlag
  (fakturan är redan skapad i Accounted vid det laget) samlas det i ett
  `warnings`-fält i svaret istället för att låta hela anropet se ut som
  ett misslyckande — resten av underlagen kan ha uppdaterats korrekt.

`vihem-accounted-webhook`s statusuppdatering uppdaterade redan alla rader
som matchar en `accounted_invoice_id` (inte bara en) innan detta steg, så
webhook-synken fungerar oförändrat för en samlingsfaktura.

Motsvarande samlingsfunktion för **hyresfakturering**
(`vihem-accounted-rent-billing`) är inte byggd i denna etapp — samma
datamodell och samma delade `createAccountedCollectionInvoiceForSources`
skulle kunna återanvändas, men ingen UI eller anropslogik finns för det
ännu.

### Avdrag & tillägg (`vihem_billing_adjustments`)

**Datamodell.** En rad per avdrag/tillägg i `vihem_billing_adjustments`:

- `target_type`/`target_id` — generiskt precis som `vihem_accounted_
  invoice_links.source_type`/`source_id`: `tenancy` (hyresfakturering) och
  `customer_project` (kundprojektfakturering) konsumeras idag, och
  skapa-formuläret i Ekonomi V2 (`CreateAdjustmentModal`) exponerar båda
  — en måltyp-väljare (bara synlig om organisationen har både hyresgäster
  och kundprojekt att välja mellan) styr om formuläret visar en
  hyresgästväljare eller en kundprojektväljare, och skickar rätt
  `target_type`/`target_id` till `vihem-billing-adjustments`.
  `finance_customer` finns med i CHECK-listan för framtida bruk men läses
  inte av något ännu, och har ingen UI. Korttidsuthyrning har **inget**
  `target_type` alls — varken konsumtion i en faktureringsfunktion eller
  ett värde i CHECK-listan — det är precis det som återstår av "avdrag &
  tillägg för fler källor" utöver denna etapp.
- `amount` — **signerat, EN representation**: positivt = tillägg, negativt
  = avdrag. Ingen separat kind/riktning-kolumn; tecknet är hela modellen,
  i både databas och UI (röd/grön text + `+`/`-` i Ekonomi V2).
- `adjustment_type`: `one_time` eller `recurring`.
- `start_period` — för engångsposter: ett golv ("gäller från och med
  denna tidpunkt, tillämpas på målets nästa faktura oavsett kalendermånad"
  — matchar "avdrag på nästa hyra", inte en specifik period). För
  återkommande: första giltiga period.
- `end_period` — endast återkommande, valfritt slutdatum.
- `max_occurrences` — endast återkommande, valfritt tak ("X
  faktureringstillfällen"). Engångsposter sätts till `max_occurrences = 1`
  av API-lagret (inte ett DB-default), så behörighetsfrågan i
  `listEligibleAdjustments` blir identisk för båda typerna.
- `applied_count`, `last_applied_period` — uppdateras endast av
  `recordAdjustmentApplications`, aldrig av klienten.
- `status`: `active` → `paused`/`cancelled` (klientstyrt) eller `completed`
  (endast systemet, när `applied_count` når `max_occurrences` eller
  `end_period` passeras).
- `description`, `created_by`, `created_at`.

**Återkommande poster.** `listEligibleAdjustments` väljer rader där
`status = 'active'`, `start_period <= period`, `end_period` är null eller
`>= period`, `applied_count < max_occurrences` (eller `max_occurrences`
är null), och `last_applied_period` skiljer sig från `period` (skydd mot
dubbel tillämpning samma period). Samma fråga täcker engångs- och
återkommande poster tack vare `max_occurrences = 1`-konventionen ovan.

**Hur de väljs till en faktureringskörning.** `vihem-accounted-rent-billing`
anropar `listEligibleAdjustments({company_id, target_type:'tenancy',
target_id: item.tenancy_id, period: item.rent_period})` för varje
hyresrad, **direkt innan** Accounted-anropet — inte inbakat i själva
körningen (`vihem_create_rent_billing_run`), så ett avdrag skapat efter att
körningen genererats men innan fakturan skickas fångas ändå upp.
Avdragen blir egna radposter i samma Accounted-faktura som grundhyran
(`buildAdjustmentLineItems`), oavsett dry-run eller inte — en
förhandsgranskning ska visa exakt vad som skulle faktureras.
`vihem-accounted-project-billing` gör samma anrop med `target_type:
'customer_project', target_id: project.id`, men eftersom ett kundprojekt
saknar en kalenderperiod-koppling (varje underlag faktureras ad hoc, inte
månadsvis) används dagens datum som `period` istället för en verklig
period. Det gör att `end_period`/`max_occurrences` för ett projektavdrag
jämförs mot faktureringsdatum snarare än en meningsfull periodgräns — ett
fungerande men mindre exakt generaliseringsval, dokumenterat här istället
för att byggas om till en riktig "faktureringstillfälle"-modell för
projekt i denna etapp.

**Exakt när de markeras konsumerade.** ENDAST efter att
`createAccountedInvoiceForSource` returnerat ett bekräftat (icke-dry-run,
icke-redan-fakturerat) resultat — dvs. efter att Accounted-anropet lyckats.
Vid fel (Accounted svarar med fel, timeout, nätverksfel) kastas ett
exception innan `recordAdjustmentApplications` någonsin anropas: inget
skrivs, avdraget ligger kvar exakt som innan. Det finns inget
"pending"-läge i modellen — konsumtion är antingen "hände inte alls" (inget
skrivet) eller "hände och är bekräftat" (en rad i
`vihem_billing_adjustment_applications`). Detta skiljer sig medvetet från
den äldre `vihem_rent_adjustments`-mekanismen (kvar orörd för legacy), som
tillämpar avdrag redan vid körningsgenerering via en databastrigger — långt
innan något Accounted-anrop existerar och därför omöjlig att koppla till
en bekräftelse. De två systemen kan köras sida vid sida (olika rader,
ingen konflikt), men om en organisation råkar använda båda för samma
hyresförhållande/period hamnar båda avdragen på fakturan — dokumenterat
här som en verklig men osannolik källa till förvirring, inte tekniskt
förhindrad.

**Koppling till Accounted-fakturan.** Varje lyckad tillämpning skapar en
rad i `vihem_billing_adjustment_applications` med `adjustment_id`,
`billing_period`, `source_type`/`source_id` (samma vokabulär som
`vihem_accounted_invoice_links`) och `accounted_invoice_link_id`
(NOT NULL — raden existerar bara för bekräftade fall) plus ett snapshot av
`amount` (så historik inte ändras om avdraget redigeras efteråt). Frågan
"Avdrag 600 kr användes på Accounted-faktura X" besvaras genom att slå upp
`accounted_invoice_link_id` → `vihem_accounted_invoice_links.accounted_
invoice_id`/`accounted_invoice_number`. Ekonomi V2:s flik "Förbrukade/
historik" visar detta direkt.

**Känd begränsning (dokumenterad, inte löst):** ingen radlåsning över
Accounted-anropet. Om två administratörer samtidigt startar fakturering
för samma hyresgäst/period skulle båda i teorin kunna läsa samma
"outnyttjade" avdrag och inkludera det på två olika fakturaförsök. Givet
att hyreskörningen körs sekventiellt (en post i taget) och det i praktiken
är en administratör som klickar "skapa fakturor", bedöms detta som en låg
praktisk risk som inte motiverar en distribuerad låsning i detta skede.

## Öppna frågor som kräver verksamhetsbeslut

1. Körs en Accounted-instans per Vibo-bolag, eller en delad instans med
   flera "companies" internt i Accounted? Påverkar hur
   `accounted_base_url` sätts (per bolagskoppling idag, kan bli en delad
   default).
2. Vem administrerar Accounted-API-nycklar i produktion, och hur roterar vi
   dem (nu manuellt via Bolagskoppling-fliken)?
3. ~~Ska "Ekonomi V2"-menyn öppnas för organisationsadmins innan
   hyresfakturering är klar?~~ Beslutat 2026-08-21: ja, samma gating som
   legacy `finance` (org-admin + `finance`-modulen aktiverad), inget
   superadmin-specialfall.
4. Bekräfta att `vihem-accounted-webhook`s publika URL faktiskt är nåbar
   utanför Vibos nätverk (Accounted SSRF-validerar att webhook-URL:en
   pekar på en publik, icke-privat adress vid registrering).
5. Hur hämtas varje bolags invoice-inbox-mejladress ur Accounted i praktiken
   (manuellt kopierat av admin, eller finns ett sätt att läsa det via API)?
6. Ska avdrag/tillägg kunna skapas direkt från en hyresgästs/avtals egen
   sida (t.ex. `AdminTenantsPage.tsx`/`ApartmentPage.tsx`), inte bara från
   Ekonomi V2? Uppdraget öppnade för det "om befintlig arkitektur gör detta
   rimligt" — den här etappen byggde bara Ekonomi V2-vägen, eftersom de
   sidorna är aktivt använda legacy-sidor och en till ingångspunkt hade
   krävt antingen att dela UI-logik in i dem (mer sidyta att röra) eller
   duplicera skapa-formuläret (precis det centraliseringen ska undvika).
   Om det önskas är den enkla lösningen en länk från den sidan till Ekonomi
   V2:s avdragsflik med hyresgästen förvald, inte en ny formulärimplementation.

## Felhantering

Alla `vihem-accounted-*`-funktioner returnerar samma kuvert som Accounted
själv: `{ error: { code, message, recovery_hint?, details? } }`. Frontend
(`src/modules/finance-v2/api.ts`) läser `code`/`recovery_hint` istället för
att bara visa HTTP-status. Nätverksfel/timeout mot Accounted mappas till
egna koder (`ACCOUNTED_TIMEOUT`, `ACCOUNTED_NETWORK_ERROR`) med samma form,
så UI:t hanterar dem likadant som ett riktigt Accounted-fel.

Alla skrivande anrop mot Accounted (kund, faktura, webhook) skickar en
deterministisk `Idempotency-Key` härledd från VI-HEMs egen post-identitet
(`sha256(company_link_id:source_type:source_id)`), så ett nätverksfel eller
en Supabase-timeout under ett create-anrop kan alltid säkert göras om med
exakt samma nyckel utan risk för dubblettfaktura/dubblettkund.
