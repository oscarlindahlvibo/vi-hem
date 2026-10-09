# Besiktningsarkiv – kontrollpunkt 2026-10-10

Status: implementerad första sammanhängande version, inte produktionsklar eller fullt Drive-verifierad. Main, produktion, produktions-Drive och produktionsdatabas har inte ändrats.

## Arkitektur

Befintliga Workspace-inställningar, kryptering och servicekontots OAuth används. Autentiseringen har flyttats till `_shared/google-drive-auth.ts` och återanvänds av den generella Drive-funktionen. Ny `vihem-inspection-archive` tar binära filer, inte base64 i JSON. Organisation och fil väljs från autentiserad användare och ett RLS-skyddat jobb-ID. Klienten skickar aldrig en auktoritativ organisation eller ett godtyckligt Drive-fil-ID.

`vihem_inspection_file_jobs` binder operationens UUID till besiktning, skapare, organisation, rum, filtyp, storlek, SHA256 och besiktningssnapshot. `vihem_begin_inspection_file` låser besiktningen och kontrollerar metadata. `vihem_claim_inspection_file` ger backend en tidsbegränsad lease. Backend reserverar Drive-ID före skapandet. Reserverade mapp-ID:n ligger i `vihem_inspection_drive_folders`, med unik beständig objektnyckel. Återförsök använder samma fil och ID.

Flöde: lokal IndexedDB-kö → serverprivat `vihem-inspection-staging` → Google resumable upload → metadata- och fullständig byte/SHA256-kontroll → atomisk metadataregistrering och besiktningskoppling → borttagning av stagingkopian. Databas och Drive är inte en gemensam transaktion. En lyckad Google-skrivning före misslyckad DB-commit kan återanknytas via det reserverade ID:t.

Google-svaret kontrolleras för ID, parent, appProperties-jobb, storlek, eventuell Google-SHA256 och SHA256 av hämtade bytes. Filstatus är pending/uploading/failed/verified. Bara verified protocol kan sätta Drive-besiktning till completed. Protokollets snapshot måste fortfarande matcha besiktningen. Nytt protokoll får ny dokumentpost och version; äldre poster och filer skrivs inte över.

Mappar: konfigurerad organisationsrot / Besiktningar / fastighet + kort ID / lägenhet + kort ID / datum + typ + kort besiktnings-ID / Bilder / rum, respektive Protokoll. Beständiga fullständiga ID:n styr kopplingen, inte etiketter eller datum. Inga hyresgästnamn i mappar. Nuvarande datamodell/RPC kräver lägenhet; andra objekt och fastighet utan lägenhet återstår.

## Säkerhet

Staging är privat, server-only och har en restrictive deny-policy för anon/authenticated. Nya foton går inte till `vihem-inspection-photos`. Ingen publik Google-delning skapas. Aktiva staff/admin/superadmin får börja/skriva i egen organisation. Read följer besiktningens befintliga RLS, inklusive behörig hyresgäst. Backend läser filen och kontrollerar integritet; Google-konto behövs inte för VI-HEM-hämtning. Jobbattestering/folderregister/claim/commit är service-only. Konto som tagits bort eller inaktiverats ska nekas även om en tidigare uppladdning finns.

Bilder omvandlas till JPEG, begränsas till 1920 px och valideras även servermässigt med befintlig JPEG-parser. HEIC-stödet laddas vid behov. Bilder högst 10 MB före förberedelse; protokoll högst 25 MB; migrationskoden begränsar jobb till 200 per besiktning. PDF-header/footer kontrolleras, men det är inte en fullständig PDF-sanitizer.

Generell Drive-rename kräver nu register-/dokumentkoppling till användarens organisation. Den ändringen behöver fler regressionsprov med äldre registrerade dokument före release.

## Filernas livscykel och öppna risker

Lokala filer separeras efter konto och besiktning och tas bort efter bekräftad arkivering. Browserns kvot, privat läge eller rensad webbplatsdata kan förhindra återställning. Lokal kö är inte krypterad separat från browserns lagring. Delade enheter, utloggning och säker gallring av övergivna köposter behöver slutlig policy och prov. Klienten får inte göra temporära filer offentliga för att undvika dessa begränsningar.

Staging raderas efter verifierad commit. Misslyckad cleanup lämnar en identifierbar temporär kopia, men schemalagd avstämning/gallring är inte byggd ännu. Inget raderas automatiskt i Drive. Att ta bort bild från ett utkast ändrar endast referensen; tidigare protokoll/filer bevaras.

Resumable chunks är 1 MiB. Avbrott efter färdig fil återhämtas med samma ID. En delvis genomförd Google-session sparas inte beständigt; sådana överföringar startar om med samma mål-ID. Mobil nätverkskostnad och Edge-tidsgräns måste provas. Ingen automatisk bakgrundsworker/cron är aktiverad. Retry i filsektionen fungerar endast om underlag redan kommit till staging; annars används lokala filkön/Slutför.

Samtidig redigering av samma besiktning från flera klienter behöver explicit revisionskontroll. Snapshot stoppar inaktuellt protokoll, men befintlig draft-RPC har fortfarande last-write-wins för formuläret. PDF-versionen visar operationens korta ID; registret har numerisk version. Dessa ska samordnas. Helvetica stöder svenska men inte all Unicode; unsupported glyph ger tydligt fel och inget slutförande. Inbäddat bredare typsnitt, organisationslogotyp och exakt organisationsnamn återstår.

## Driftsättning – inte godkänd i denna kontrollpunkt

1. Slutför öppna risker och hela QA-matrisen i `inspection-drive-verification.md`.
2. Verifiera separat QA-organisations Drive-rot, Shared Drive-medlemskap, krypteringsnyckel och OAuth-scopes. Använd inte produktionsroten för tester.
3. Tillför migrationerna 20261010100000 och 20261010101000 efter befintlig atomic inspection save, granska grants och befintliga policies i miljön.
4. Deploya shared helper, generell Drive-funktion och ny archive-funktion tillsammans med frontend efter godkänd releaseplan. Gamla klienters nya completed-inserts avvisas av Drive-kravet; kompatibilitet måste kommuniceras.
5. Migrera äldre bilder först efter separat verifierad migreringsplan och godkännande. Gamla länkar får inte stängas eller filer raderas i förväg.

Google-protokoll: [officiell uppladdningsdokumentation](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [filmetadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
