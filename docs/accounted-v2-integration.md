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
hyresfakturering), webhook-grund.
**Kvar:** en allmän avdrag/tillägg-modul (utöver hyresjusteringar, som redan
fungerar), kundprojektfakturering mot Accounted, hyresgästportalens
fakturavy, scanner → Accounted.

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

Migrationerna rör inte någon tabell som legacy-ekonomin skriver till för
befintlig produktionsfakturering (`vihem_invoices`, `vihem_accounting_*`,
etc.) — bara additiva kolumner/tabeller.

### Delad logik (`_shared/`)

- **`accounted-crypto.ts`** — AES-GCM-kryptering av Accounted-hemligheter, egen miljövariabel `VIHEM_ACCOUNTED_SECRET_KEY`.
- **`accounted-rest-client.ts`** — enda platsen som bygger ett `Bearer gnubok_sk_...`-anrop mot Accounted. Idempotency-Key, dry-run, timeout, strukturerat felkuvert (`AccountedApiError`).
- **`accounted-company-context.ts`** — laddar bolagskoppling + dekrypterad API-nyckel; enhetliga felkoder (`ACCOUNTED_NOT_LINKED`/`ACCOUNTED_LINK_DISABLED`/`ACCOUNTED_NO_API_KEY`) oavsett vilken funktion som anropar.
- **`accounted-customer-resolver.ts`** — `resolveOrCreateAccountedCustomer`: kundlänkning/-skapande, delad mellan `vihem-accounted-customers` och batch-anrop (hyresfakturering, framtida kundprojekt) så logiken bara finns på ett ställe.
- **`accounted-invoice-creator.ts`** — `createAccountedInvoiceForSource`: samma sak för fakturaskapande.
- **`vihem-auth.ts`** — delat auth/behörighetshjälpmedel (JWT + `vihem_user_has_company_access`). Befintliga 30+ Edge Functions är **inte** omskrivna till detta.

### Edge Functions

- **`vihem-accounted-admin`** — `save_company_link`, `test_connection`, `register_webhooks`. Kräver `admin`-bolagsbehörighet.
- **`vihem-accounted-customers`** — hittar befintlig kundkoppling eller skapar kunden i Accounted (idempotent, dry-run-stödd). Tunn wrapper runt den delade resolvern.
- **`vihem-accounted-invoices`** — `create` (generisk, idempotent, dry-run-stödd) och `refresh_status`. Tunn wrapper runt den delade skaparen.
- **`vihem-accounted-rent-billing`** — batchar fakturaskapande för en hel hyreskörning: för varje ej fakturerad rad, länka/skapa Accounted-kunden (`vihem_finance_customers`, via `finance_customer_id`) och skapa fakturan (en rad: grundhyra + hyresjusteringar, redan summerat av befintlig SQL). Partial-success-svar per rad, samma mönster som Accounteds egen `bulk-create`.
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

Fem flikar: Översikt, Bolagskoppling (spara URL/company-id/API-nyckel, testa
anslutning, registrera webhooks), **Fakturering** (välj hyresperiod → hämta
körning från befintlig `vihem_create_rent_billing_run` → förhandsgranska
mot Accounted som dry-run → skapa fakturor på riktigt, med resultat per
rad), Fakturor (läser `vihem_accounted_invoice_links`), och Kommande
(platshållare för det som inte är byggt än).

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
2. En allmän avdrag & tillägg-modul enligt originalspecen (pending
   adjustment, konsumeras först när Accounted bekräftat fakturan). Hyra har
   redan ett fungerande, mer begränsat avdragsflöde
   (`vihem_rent_adjustments`, tillämpas innan fakturan skapas, inte kopplat
   till bekräftelse-semantiken) — se avsnittet nedan om varför det räckte
   för hyresfakturering.
3. Kundprojektfakturering mot den nya vägen (idag går kundprojekt fortsatt
   via legacy `vihem_create_invoice_from_project_basis*`-RPC:erna).
4. Hyresgästportalens fakturavy.
5. Scanner → Accounted-kopplingen (rekommendation ovan, ej kopplad).
6. Avbetalningsplaner i Finance V2-gränssnittet (fortsatt legacy tills
   vidare — panelen finns redan och flyttas inte i denna etapp).

### Hyresfakturering: hur avdrag/tillägg faktiskt löstes

Originalspecen (avsnitt 6) beskrev en generell pending-adjustment-modell där
avdraget markeras förbrukat först när Accounted bekräftat rätt faktura.
Hyresmodulen har redan en egen, enklare mekanism sedan tidigare
(`vihem_rent_adjustments` + en trigger som summerar aktiva justeringar in i
`vihem_rent_billing_items.amount` **vid körningsgenerering**, dvs innan
Accounted är inblandat alls). Den mekanismen återanvänds oförändrad: en
justering påverkar bara `draft`-rader (`item.status = 'draft'`), och en rad
byter status till `invoiced` i samma steg som `accounted_invoice_link_id`
sätts — så en justering kan aldrig ändra beloppet på en rad som redan
skickats till Accounted. Det uppfyller samma säkerhetsegenskap
("konsumeras inte i förtid, kan inte ändras i efterhand") utan att en ny
generell modul behövde byggas för hyra specifikt. Den generella modulen
(punkt 2 ovan) är kvar för andra faktureringskällor som saknar en
motsvarande mekanism.

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
