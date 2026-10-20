# Vibogruppen: AI-tolkningar och månadsvis fakturaunderlag

Status: byggt och testat lokalt på grenen `feature/ai-interpretation-billing`. Inte driftsatt. Produktionsdriftsättning görs manuellt enligt `README.md` och `SHARED_SUPABASE_DEPLOY.md`.

## Vad det är
- En central funktion, **`vihem-ai-interpret-document`**, som andra system (först JK Projektlogistik) anropar server-till-server för att AI-tolka transportdokument från sidbilder. Den använder samma OCR/AI-upplägg och samma organisationsnycklar som `vihem-process-supplier-invoice-ocr` (Google Vision → OpenAI `gpt-5-nano`, bildtolkning med `gpt-5-mini` som komplement) hämtade från Vibogruppens `vihem_ocr_provider_settings`.
- Modulen **Fakturering & AI** (meny för admin i Vibogruppens organisation) som räknar tolkningarna per kund och månad och bygger ett månadsunderlag: AI-sidor + hosting + tilläggstjänster.

## Debiteringsregler
- **Per tolkad sida, exkl. moms**: standard 5,00 kr per sida och 25 % moms, inställbart per kund.
- **Bara lyckade tolkningar** debiteras. Misslyckade försök och omförsök med samma `request_id` är gratis.
- Priset låses på varje tolkning när den startar, så en prisändring påverkar bara nya tolkningar.
- Underlag: återkommande poster (t.ex. hosting) mellan *gäller från* och *gäller till*, engångsposter i startmånaden, samt AI-sidor (grupperade per pris). Månaden kan låsas först efter månadsskiftet. Låsta tolkningar kan inte hamna i ett annat underlag; ett låst, ännu inte fakturerat underlag kan öppnas igen, ett fakturerat kan det inte.

## API (för kundsystem)
`POST <supabase>/functions/v1/vihem-ai-interpret-document` med headern `X-Vihem-Ai-Key: vhk_…` (nyckeln skapas i modulen och visas en gång; bara en SHA-256-hash lagras).

- `{"action":"quote"}` → `{ price_per_page, vat_rate, currency, max_pages_per_request, monthly_page_limit, month_pages_used }`.
- `{"action":"interpret","request_id","file_name","file_sha256","user_ref","source","pages":[{"content_type":"image/jpeg|png|webp","base64"}]}` → `{ ok, billed, duplicate, interpretation_id, orders[], warnings[], model, method, pages, amount_ex_vat, price_per_page, vat_rate, raw_text }`.
- Fel: 401 ogiltig nyckel, 403 avstängd kund, 413 för stort/för många sidor, 415 fel filtyp, 429 månadsgräns, 409 tolkningen pågår, 502 AI misslyckades (ingen debitering).
- `orders[]` följer JK:s `ParsedLtcOrder` (dokumentnummer, avsändare, lastning/lossning, kontakter, datum, leveransadress och godsrader).

## Skydd och integritet
- Tabellerna ligger i det privata schemat `vihem_vibogruppen_private` utan klientåtkomst. Admin i Vibogruppens organisation når dem bara via RPC:er (`vihem_vibogruppen_require_admin`). Serverfunktionerna `vihem_ai_*` kan bara köras av `service_role`.
- Idempotens per kund och `request_id`; gränser per kund (sidor per dokument, månadsgräns, av/på); nycklar kan återkallas.
- **Dokumentinnehåll sparas inte.** Metadata (tid, användare, filnamn, kontrollsumma, sidor, modell, tokens, uppskattad kostnad) sparas, och resultatet cachas högst 24 timmar för omförsök. Kunden behöver ha OpenAI och Google som underbiträden i sitt personuppgiftsbiträdesavtal.
- Tolkningar som fastnat mer än 10 minuter räknas som misslyckade.

## Driftsättning (manuellt, i den här ordningen)
1. `git pull --ff-only` på servern och kör migrationen `20261022100000_vibogruppen_billing_ai.sql` enligt gängse rutin (den kräver att `20261012200000_vibogruppen_portal.sql` finns).
2. Driftsätt funktionen `vihem-ai-interpret-document` **med `--no-verify-jwt`** (den autentiserar med nyckeln, inte JWT; se `supabase/config.toml`). Funktionen använder befintlig `VIHEM_OCR_SECRET_KEY` för att dekryptera organisationens nycklar.
3. Frontend byggs som vanligt. Menyn *Fakturering & AI* syns för admin i Vibogruppens organisation (`38fe702d-…`).
4. Skapa kunden JK i modulen, sätt hosting/tillägg och skapa nyckel. Lägg nyckeln och funktionens URL som `VIHEM_AI_CLIENT_KEY` och `VIHEM_AI_URL` i JK:s miljö (se JK:s `docs/ai-tolkning.md`).

## Månadsrutin
1. Välj föregående månad, kontrollera underlaget per kund (ladda ner CSV vid behov).
2. **Lås månaden**, fakturera (t.ex. i Accounted) och **Markera som fakturerad** med fakturanummer.

## Tester
- `bash scripts/test_billing_ai_sql.sh`: 29 kontroller i en tillfällig Postgres (behörighet, nycklar, idempotens, gränser, prisfrysning, månadsberäkning, låsning, fakturering).
- `node scripts/ai-interpret-check.mjs` och `node scripts/billing-format-check.mjs`.
- Inte provat live: anrop mot OpenAI/Google Vision och kedjan JK → VI-HEM.

## Kända begränsningar
- Bara bilder accepteras (JK renderar PDF-sidor i webbläsaren). Direkt PDF-inskick stöds inte.
- Fakturan skapas inte automatiskt; underlaget exporteras som CSV och faktureras manuellt (en koppling till Accounted kan läggas till senare).
