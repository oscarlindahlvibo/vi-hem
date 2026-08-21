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

**Klart:** bolagskoppling, kundlänkning, fakturaskapande (generisk +
hyresfakturering + kundprojektfakturering), webhook-grund, datamodellen
förberedd för framtida samlingsfakturor, generell avdrag/tillägg-modul
(kopplad till hyresfakturering), hyresgästportalens fakturavy (lista +
PDF, Accounted som source of truth).
**Kvar:** avdrag/tillägg-modulen kopplad till kundprojekt/andra
faktureringskällor, scanner → Accounted.

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
"Datamodellen stödjer nu framtida samlingsfakturor" nedan.

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

Migrationerna rör inte någon tabell som legacy-ekonomin skriver till för
befintlig produktionsfakturering (`vihem_invoices`, `vihem_accounting_*`,
`vihem_rent_adjustments`, etc.) — bara additiva kolumner/tabeller.

### Delad logik (`_shared/`)

- **`accounted-crypto.ts`** — AES-GCM-kryptering av Accounted-hemligheter, egen miljövariabel `VIHEM_ACCOUNTED_SECRET_KEY`.
- **`accounted-rest-client.ts`** — enda platsen som bygger ett `Bearer gnubok_sk_...`-anrop mot Accounted. Idempotency-Key, dry-run, timeout, strukturerat felkuvert (`AccountedApiError`), plus `getBinary()` för Accounteds PDF-endpoint (raw `application/pdf`, inte v1-JSON-kuvertet).
- **`accounted-company-context.ts`** — laddar bolagskoppling + dekrypterad API-nyckel; enhetliga felkoder (`ACCOUNTED_NOT_LINKED`/`ACCOUNTED_LINK_DISABLED`/`ACCOUNTED_NO_API_KEY`) oavsett vilken funktion som anropar.
- **`accounted-customer-resolver.ts`** — `resolveOrCreateAccountedCustomer`: kundlänkning/-skapande, delad mellan `vihem-accounted-customers` och batch-anrop (hyresfakturering, framtida kundprojekt) så logiken bara finns på ett ställe.
- **`accounted-invoice-creator.ts`** — `createAccountedInvoiceForSource`: samma sak för fakturaskapande.
- **`billing-adjustments.ts`** — `listEligibleAdjustments`/`buildAdjustmentLineItems`/`recordAdjustmentApplications`: avdrag & tillägg-logiken, se eget avsnitt nedan.
- **`vihem-auth.ts`** — delat auth/behörighetshjälpmedel (JWT + `vihem_user_has_company_access`). Befintliga 30+ Edge Functions är **inte** omskrivna till detta.

### Edge Functions

- **`vihem-accounted-admin`** — `save_company_link`, `test_connection`, `register_webhooks`. Kräver `admin`-bolagsbehörighet.
- **`vihem-accounted-customers`** — hittar befintlig kundkoppling eller skapar kunden i Accounted (idempotent, dry-run-stödd). Tunn wrapper runt den delade resolvern.
- **`vihem-accounted-invoices`** — `create` (generisk, idempotent, dry-run-stödd) och `refresh_status`. Tunn wrapper runt den delade skaparen.
- **`vihem-accounted-rent-billing`** — batchar fakturaskapande för en hel hyreskörning: för varje ej fakturerad rad, länka/skapa Accounted-kunden (`vihem_finance_customers`, via `finance_customer_id`), hämta gällande avdrag/tillägg för hyresförhållandet och perioden, och skapa fakturan (grundhyra + hyresjusteringar redan summerat av befintlig SQL, plus en rad per avdrag/tillägg). Partial-success-svar per rad, samma mönster som Accounteds egen `bulk-create`.
- **`vihem-accounted-project-billing`** — skapar Accounted-fakturan för ett `ready_for_invoicing`-faktureringsunderlag från Kundprojekt. Återanvänder den befintliga SQL-funktionen `vihem_ensure_finance_customer_for_project` (samma match-eller-skapa-logik som legacy-RPC:n) för kundmatchning, kör som anropande användare (inte service-role) eftersom funktionen är `SECURITY DEFINER` och läser `auth.uid()` internt. Fakturarader byggs direkt från underlagets `ready`-rader (tid/material/ändringsorder/fast pris). Avdrag/tillägg är inte kopplat in här ännu.
- **`vihem-billing-adjustments`** — `create`/`update` för avdrag/tillägg. Enda platsen som får skriva till `vihem_billing_adjustments`.
- **`vihem-accounted-tenant-invoices`** — `GET ?invoice_link_id=`, hyresgäst-scopad. Proxar Accounteds PDF-endpoint: verifierar ägarskap manuellt (`vihem_rent_billing_items.tenant_id = caller.id`, samma relation som RLS-policyn nedan) eftersom en binär PDF-respons inte kan gå via en vanlig RLS-skyddad tabellfråga. Vanlig `verify_jwt` (ingen `config.toml`-ändring) eftersom Accounted aldrig anropar den här — bara den inloggade hyresgästens webbläsare.
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

Sju flikar: Översikt, Bolagskoppling (spara URL/company-id/API-nyckel, testa
anslutning, registrera webhooks), **Fakturering** (hyra: välj hyresperiod →
hämta körning från befintlig `vihem_create_rent_billing_run` →
förhandsgranska mot Accounted som dry-run → skapa fakturor på riktigt, med
resultat per rad), **Kundprojekt** (listar `ready_for_invoicing`-underlag
oavsett projekt, förhandsgranska/skapa faktura per underlag — underlaget
självt skapas fortfarande i Kundprojekt-sidan, orörd), **Avdrag & tillägg**
(filtrerbar lista — Alla/Aktiva/Återkommande/Kommande/Pausade/
Förbrukade-historik — plus ett skapa-formulär med hyresgästväljare; se eget
avsnitt nedan), Fakturor (läser `vihem_accounted_invoice_links`), och
Kommande (platshållare för det som inte är byggt än).

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

## Scanner → Accounted: rekommendation (ej implementerad ännu)

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

**Rekommendation**: koppla VI-HEM-scannern till invoice-inbox via
e-postkanalen, inte via ett nytt API-anrop. VI-HEM har redan Postfix/SMTP
konfigurerat (se root-`README.md`). Flödet blir: personal scannar i VI-HEM →
välj bolag → VI-HEM skickar originaldokumentet som mejlbilaga till bolagets
Accounted-inkorgsadress (hämtas en gång manuellt från Accounteds UI och
sparas i `vihem_accounted_company_links.settings` eller en ny kolumn) →
Accounted tar över (AI-extraktion, granskning, attest). Detta kräver **ingen**
ändring i Accounted.

Om ett äkta server-till-server-API senare visar sig nödvändigt (t.ex. för att
slippa mejl-latens eller för att få tillbaka ett dokument-id synkront), är
rekommendationen en **separat** Accounted-extension
(`extensions/general/vihem-bridge` eller liknande, eget `manifest.json`) som
exponerar en API-nyckel-autentiserad `apiRoutes`-endpoint enligt samma
mönster som `lib/api/v1/with-api-v1.ts` använder — INTE en ändring av
`invoice-inbox`s egen kod. Detta är inte implementerat i denna etapp; det
kräver ett separat beslut och arbete i Accounted-repot.

## Vad som INTE är byggt än

1. ~~Hyresfakturering~~ Klart (`vihem-accounted-rent-billing`) — grundhyra
   och hyresjusteringar. Elförbrukning/eldebitering är inte beräknad
   någonstans i kodbasen ännu (varken legacy eller V2) och ingår därför
   inte i vad som faktureras.
2. ~~En allmän avdrag & tillägg-modul~~ Klart (`vihem_billing_adjustments`,
   `vihem-billing-adjustments`), kopplad in i hyresfakturering. Inte kopplad
   till kundprojekt eller andra faktureringskällor än — se eget avsnitt
   nedan.
3. ~~Kundprojektfakturering mot den nya vägen~~ Klart
   (`vihem-accounted-project-billing`), men bara ett underlag i taget —
   legacy `vihem_create_invoice_from_project_basis_batch`s förmåga att slå
   ihop flera underlag till EN faktura (t.ex. flera delfaktureringar av
   samma kund) är inte porterad, bara förberedd på datamodellnivå (se
   nästa avsnitt). Ingen samlingsfaktura-funktion är byggd i denna etapp.
4. ~~Hyresgästportalens fakturavy~~ Klart (`TenantInvoicesPage.tsx`,
   `vihem-accounted-tenant-invoices`) — lista + PDF, Accounted som source of
   truth. Bara hyresfakturor (`source_type = 'rental_billing'`); en
   hyresgäst med kundprojekt- eller andra fakturor via Accounted ser inte
   dem här, eftersom ingen sådan koppling mellan hyresgäst och de
   `source_type`erna finns i datamodellen.
5. Scanner → Accounted-kopplingen (rekommendation ovan, ej kopplad).
6. Avbetalningsplaner i Finance V2-gränssnittet (fortsatt legacy tills
   vidare — panelen finns redan och flyttas inte i denna etapp).

### Datamodellen stödjer nu framtida samlingsfakturor

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

En framtida samlingsfaktura skulle alltså bara behöva skapa flera rader i
`vihem_accounted_invoice_links` (en per underlag) som alla pekar på samma
`accounted_invoice_id` — ingen ytterligare schemaändring krävs.
`vihem-accounted-webhook`s statusuppdatering uppdaterar redan alla rader
som matchar en `accounted_invoice_id` (inte bara en), så webhook-synken
fungerar oförändrat den dagen flera rader delar samma faktura. Själva
sammanslagningslogiken (vilka underlag som får slås ihop, hur en
delbetalning fördelas tillbaka till respektive underlag) är **inte** byggd.

### Avdrag & tillägg (`vihem_billing_adjustments`)

**Datamodell.** En rad per avdrag/tillägg i `vihem_billing_adjustments`:

- `target_type`/`target_id` — generiskt precis som `vihem_accounted_
  invoice_links.source_type`/`source_id`: `tenancy` (enda konsumenten
  hittills), `customer_project`, `finance_customer` finns med i
  CHECK-listan för framtida bruk men läses inte av något ännu.
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
