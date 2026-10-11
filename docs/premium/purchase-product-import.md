# Produktval i inköpslistan

Bygge 12: separat native-butiksvy för Jula/Biltema på iOS och Android. Sök, öppna produkt, välj ”Välj produkt”, granska i VI-HEM och använd uppgifterna. Produktnamn/butik/länk förs över till befintliga fält; artikelnummer läggs i anteckningen. Antal, prioritet och befintlig kommentar bevaras. Ingen automatisk sparning eller beställning. Bilder, priser och produktbeskrivningar importeras inte.

Webb/äldre binärer: befintlig butikssökning samt ”Importera från produktlänk”. Edge-funktionen `vihem-supplier-product` läser offentlig produktmetadata efter aktiv personalautentisering. Biltemas publicerade JSON-varianter kan granskas separat. Jula gav Cloudflare 403 vid serverprov: ingen kringgång eller garanti om serverimport. Native hämtar uppgifter från den sida användaren själv öppnat, men riktig butik i WKWebView/Android WebView är ännu ej verifierad.

## Säkerhet

Native-vyn har separat WebView utan Capacitor-bridge/autentiseringsheaders; huvudnavigation tillåts endast på vald HTTPS-butik. iOS använder icke permanent webbdatastore; Android använder vanlig domänavgränsad WebView-lagring, inga VI-HEM-headers eller JavascriptInterface. URL och returnerad metadata valideras igen i frontend. Ingen osignerad TLS eller CAPTCHA-kringgång.

Edge använder användarens JWT/RLS för egen aktiv profil, accepterar endast de två butikerna och produktvägar, följer inga redirects, vidarebefordrar inga autentiseringsuppgifter och begränsar svar till 2 MB/8 s. Request max 3 kB. Enkel workerlokal begränsning 10 försök/minut; inte en distribuerad trafikspärr. Ingen service-role-klient och inga databas-/lagringsskrivningar.

## Verifierat

- `node scripts/supplier-product-check.mjs`: URL/SSRF, redirects, storlek, blockerad sida, varianter, svenska tecken och DOM-metadata PASS.
- Isolerad QA Edge: anonym 401, tenant 403, admin/staff osäker URL 400; verklig Biltema-fetch ger rätt namn/18-319. Klientens organisations-ID ignoreras. Inga verksamhetsdata ändrade.
- Faktisk PurchaseListPage med mockad transport/DB i Chrome 390/768/1440: sparfel i import bevarar utkast, återförsök, granskning före applicering, antal/kommentar och uttrycklig sparning PASS. Mobil/desktopbilder granskade.
- TypeScript, riktad lint, premiumtester, mobilbygge/releasekontroll PASS. iOS simulatorbygge samt Android Java-kompilering PASS. Första iOS-byggmapp gav build.db disk-I/O-fel; separat /tmp/DerivedData byggde korrekt. Android byggdes med JDK 21.
- Native DOM-läsning testad med browserfixture. Riktig native-butik/Cloudflare, kamera, fysisk navigation och eventuell processåterstart EJ verifierade. Ingen produktionsinstallation i detta pass.

## Installationsordning

1. Installera endast `supabase/functions/vihem-supplier-product/` i betans befintliga Edge-runtime. Säkerhetskopiera eventuell äldre version först. Funktionen är ny; inga SQL-migrationer eller andra appar behöver ändras. Verifiera anonym/tenant-avslag samt personalhämtning innan beroende frontend publiceras.
2. Publicera frontend med befintlig kontrollerad VI-HEM-deploy. Det vanliga skriptet installerar inte denna Edge-funktion automatiskt.
3. `npm run mobile:build` och `npx cap sync`, bygg och prova mobilversion 3.0/12 i TestFlight/Android innan distribution. Native-installerade appar måste uppdateras för inbyggd butik/produktval; äldre binärer behåller sökwebbläsaren.
4. Återställning: tidigare frontend/binär; ta bort den nya funktionen endast när klienter inte använder den. Inga dokument eller databasposter behöver migreras/återställas.
