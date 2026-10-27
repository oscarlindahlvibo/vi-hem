# Installation och drift – ej utfört i produktion

1. Granska feature-diffen och senaste main. Ta aktuell verifierad backup och repetera på återläst full schema. Kontraktstesterna ersätter inte detta.
2. Installera de åtta migrationerna med projektets etablerade migrationsprocess i tidsordning. Förväntar befintlig snow V1, Finance/Fleet/Accounted/push/Storage. Migrationerna stannar hellre än tar bort okända Accounted-constraints. Adminpilot och tidigare externa åtkomstgrindar behålls.
3. Driftsätt `vihem-snow-accounted` (JWT-verifiering + egen autentisering/bolagskontroll), uppdaterad `vihem-send-push` och deras `_shared`-beroenden. Befintliga Accounted-nycklar används endast serverbaserat.
4. Bygg och publicera webbappen enligt ordinarie manuell deployprocess först efter separat tillstånd. Native-flödet återanvänder befintlig pushregistrering; inga kritiska native-entitlements tillkommer automatiskt.
5. Skapa resurser från Fleet, kompetenser, juridiska kundkopplingar, fakturerande bolag, prisversioner och tillgänglighet i administratörens vy. Inga sju personer, tre maskiner, orter eller exempelpriser seedas i produktion. Provkör först med administratör.
6. Efter kontrollerat godkännande kan ett privat databasjobb ägt av betrodd databasoperatör köra `SELECT public.vihem_snow_dispatch();` varje minut via befintlig pg_cron. Funktionen är inte publik; inga browserhemligheter behövs. Ingen cron skapas av migrationerna. Testa faktisk notistrigger/APNs/FCM innan personal bjuds in. Ändra inte organisationens adminpilot av misstag.

## Felsökning

- Alla kommandon har UUID och exakt payload. Vid osäkert svar återförsök samma kommando; skapa inte en kopia. Förarens skärm visar väntande status tills servern svarar.
- Lämplig förare saknas: kontrollera modul/pilot/aktivt konto, aktuell veckobekräftelse, datumundantag/frånvaro, resurskompetens, andra maskinpass, pågående klocka samt maxpass/vila. Tillgänglighetskalenderns kapacitet betyder inte att alla har kompetens för varje maskin.
- `submitted`: kontrollera snow_review_flags och revisionshistorik. Gamla pass utan maskinkoppling kan behöva kompletteras/manuellt granskas. Tidsgodkännande skapar ingen faktura. Pris saknas kan lösas genom prislista och ny granskning; redan låsta prisbilder ändras inte av en prisändring.
- Utkallning: vihem_snow_invitations visar svar/expiry; vihem_snow_notices visar notiskoppling; vihem_push_deliveries visar providerförsök. Dessa är tre olika statusar. `dispatch_error` i vihem_snow_events och cronjobbloggen visar serverfel. Orgtransaktionen rullas tillbaka vid fel och kan köras igen utan dubbla notiser; andra organisationer fortsätter.
- Osäker Accounted-status: kontrollera utkast i Accounted, hitta underlagets UUID-markör `VI-HEM snow batch ...` i notes och använd `Stäm av befintligt utkast`. Funktionen gör GET, aldrig en ny invoice-POST vid osäkert tidigare resultat. Bolagskoppling, kund, belopp och datum måste stämma. Ny POST efter manuellt konstaterat saknat utkast kräver kontrollerad administrativ avstämning; ingen kringgå-knapp finns.
- Faktura redan skapad: korrigera/kreditera via ordinarie Accounted-flöde. Ändra inte reserverade tidspass eller ta bort reservationsrader manuellt.
- Avbruten bild: behåll originalet, försök igen när nät finns. Endast färdigmarkerade bilder listas. Bucket ska förbli privat; använd signerade länkar.

## Telefoni – förberedd integrationsgräns, inte aktiv tjänst

Ingen verifierad befintlig automatisk uppringningsintegration hittades. Lägg en framtida leverantörsadapter serverbaserat efter den beständiga utkallningshändelsen, med nyckel `invitation-ID + försökstyp`, leverantörens externa ID, separat status queued/provider_accepted/failed/unknown och signerad webhook. Leverans eller att någon svarar i telefon är inte samma sak som accepterat maskinpass. En eventuell knappkvittens i telefonsamtal måste använda samma låsta `respond`-transaktion och kontrollera att erbjudandet ännu är öppet. Skicka inte känsliga uppgifter eller ring verkliga förare före leverantörskonfiguration och uttryckligt testgodkännande. Nuvarande implementation har ingen aktiv telefoniadapter.

## Lokal QA

```sh
npm run test:snow
npm run test:snow:db
npm run test:snow:payload
npm run snow:qa
# Öppna http://127.0.0.1:5197/scripts/snow-v2/qa/index.html
python3 scripts/snow-v2/http-test.py
```

Endast container `vihem-snow-v2-test` med label `vihem.task=snow-v2` får återställas av testkommandot. PostgREST i `vihem-snow-v2-rest`, privat Docker-nät och bindning 127.0.0.1:55450. QA Vite är 127.0.0.1:5197 och använder en offentlig enbart lokal JWT-testhemlighet. Inga produktions-URL:er läses. Stoppa Vite och ta bort endast de två märkta testcontainrarna och nätverket efter provet. QA-fixturen får inte publiceras som produktionssida.

## Återställning

Behåll data och migrationer; återgå hellre till föregående frontend och avaktivera det nya cronjobbet/Accounted-endpointen vid problem. Riv inte nya tabeller eller kör destruktiv down-migration mot verkligt arbete. Reserverade externa underlag måste stämmas av även efter rollback. Återställning av hel backup kräver separat driftbeslut eftersom senare verksamhetsdata annars kan gå förlorad.
