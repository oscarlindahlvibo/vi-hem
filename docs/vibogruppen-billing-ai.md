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

## Driftmeddelanden (uppdateringar och serverunderhåll)

Migration `20261022110000_vibogruppen_system_notices.sql` lägger till tabellen `system_notices` och RPC:erna `vihem_vibogruppen_notices_list`, `vihem_vibogruppen_notice_save`, `vihem_vibogruppen_notice_delete` (admin i Vibogruppen) och `vihem_notices_for_client` (service_role).

- Admin skapar meddelanden under **Ekonomi → Driftmeddelanden**: rubrik, text, typ, allvarlighet, visa från/till, valfritt underhållsfönster och mottagare (alla kunder eller utvalda).
- Kundsystemen hämtar aktiva meddelanden med sin API-nyckel via `vihem-ai-interpret-document` med `{"action":"notices"}` och visar dem som banner. Fungerar även om AI-tolkningen är avstängd för kunden; inaktiv kund eller återkallad nyckel nekas.
- Meddelandet är aktivt när `active` och `show_from <= nu < show_until`. Tester: `scripts/test_billing_ai_sql.sh` (databas) och `scripts/notice-format-check.mjs` (formulärlogik).

### Egna appar och sajter

Migration `20261022120000_vibogruppen_notice_surfaces.sql` låter ett meddelande även riktas mot Vibogruppens egna ytor (`surfaces`): `vihem-app` (VI-HEM-appen), `vihem-site` (vi-hem.se), `kompetensportalen`, `vibofast`, `vibogruppen`, `viborent`. Mottagare väljs i admin-sidan: kundsystem (alla/utvalda/inga) och/eller ytor. Ett meddelande måste ha minst en mottagare.

- Sajterna hämtar med den publika RPC:n `vihem_public_notices(p_surface)` (anon får anropa den; svaret innehåller bara bannertexten, tider och allvarlighet).
- Gemensam kod: `apps/_shared/notice-banner.ts` (ren DOM utan beroenden, fungerar med CSP `script-src 'self'`). Varje app startar den i sin `main.tsx` med sin yta. Bannern läggs överst på sidan, uppdateras var 5:e minut och försvinner vid sluttiden. Kritiska kan inte döljas; övriga kan döljas per webbläsare.
- VI-HEM-appen startar bannern på webben men inte i den inbyggda iOS/Android-appen (som har ett eget fast skal).
- Ytorna byggs och driftsätts var för sig: `./deploy_vihem.sh` för appen, `./deploy_sites.sh vibofast vibogruppen viborent kompetensportalen vihem-site` för sajterna. Migrationen måste vara körd först.
- Test: `node scripts/notice-banner-check.mjs`, `node scripts/notice-format-check.mjs` och `scripts/test_billing_ai_sql.sh`.

## AI-tolkning i högkvalitetsläge och dubblettsammanslagning

`vihem-ai-interpret-document` tar valfritt fältet `accuracy: "high"`. Då hoppar funktionen över textmodellen och låter bildmodellen läsa sidorna direkt (OCR-texten följer med som stöd); misslyckas bildtolkningen används textmodellen som reserv. Läget används när användaren själv valt AI-tolkning för ett dokument som har läsbar text. Resultatet normaliseras: ordrar med samma dokumentnummer och leveransadress slås ihop (komplettering av tomma fält, godsrader med samma typ slås ihop) och mått över 30 m tolkas som centimeter/millimeter. Faktureringen är oförändrad (per skickad sida, bara lyckade).
