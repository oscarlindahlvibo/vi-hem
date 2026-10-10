# Pass 9 – verifiering och fortsättning

Branch `codex/vihem-3-premium`, bas 8794689. Main/produktion oförändrade. Samma designsystem och QA-organisation. Inga kund-/hyresgästuppgifter kopierades till staging.

## Omfattning och kvalitetsgräns

30/62 områden individuellt bearbetade (28 tidigare + driftinventarier och rutiner), 32 ännu orörda. Fordon och inbox vidareutvecklades men dubbelräknas inte. Ingen hel modul har full Definition of Done. Webbinkorgen är slutverifierad inom nedanstående webbmatris, separat från native push. Serviceplaneditor och atomisk inventeringskontroll är ytterligare avgränsade kandidater; full drift-/fordonsmodul räknas inte som klar.

## Webbinkorg – tillämplig matris

| Flöde | Faktiskt prov | Resultat |
|---|---|---|
| Visa/paginera | 56 syntetiska browserposter, 50→56; JWT lika datum/null/äldre historia | PASS |
| Sök hela historiken | Browser hittar äldre post 56 utan att den hämtats; backend literal wildcard/komma/citat och sök + cursor | PASS |
| Läs/oläst | Browser Enter/individuell toggle och DB CAS som stoppar stale oläst-skrivning | PASS |
| Markera alla | Browser alla inklusive ohämtade→tomt oläst; andra användares rader oförändrade | PASS |
| Radera/avbryt | Dialog Escape/fokus tillbaka, kontroll av verkligt QA DELETE-fel, bevarad rad/dialog, retry exakt borttagning | PASS |
| Laddfel/retry | Verklig restriktiv QA SELECT-felinjektion→felväg→återförsök | PASS |
| Roller/kontobyte | Nya admin/staff/tenant browserkonton egna rader; utloggning rensar vyn. JWT annan org/anonym/inactive/ägarskap | PASS |
| Utgången JWT | Korrekt signerad men utgången QA-JWT nekas av REST. Hela webbauth refreshflödet ej injicerat | Backend PASS; authlivscykel separat |
| Återanslutning | Realtime-container av/stängd session, ny rad utan CDC, omstart, explicit backoff/rebind och historikrefresh | PASS i browser; fysisk bakgrund ej provad |
| Objektnavigation | Browser Dokument; rutinlänk får nu egen behörighets-/modulvakt i App | Dokument PASS, rutinrouting kod/QA separat |
| Responsiv/tangentbord | 390/430/768/1024/1440; namngivna actions, Enter och Escape, shared dialog focus | PASS avgränsad web QA; ingen full extern WCAG-audit |

Sökningen var tidigare bara i laddade rader. Nu serverfiltreras alla ägda aviseringar med debounce och escaped PostgREST-mönster. Listan unmountas inte medan användaren skriver. Återanslutningen återskapar kanal vid CLOSED/ERROR/TIMED_OUT, med backoff och foreground/online-återhämtning. Socket utan aktiv CDC påstås inte vara fungerande realtid. 0-rads-delete är ett fel, inte simulerad lyckad radering. 111700 begränsar legacy owner-policy till aktiv ägare.

Native APNs/FCM, fysisk pushnavigation och enhetsbakgrund kvarstår som releaseblockerare för mobilkommunikation; webbinkorgens avgränsade status är inte en sådan verifiering.

## Serviceplaner

Planera/redigera nästa service utan att ändra befintlig 30-dagars månadsregel. Edit behåller nästa datum/mätargränser. Arkivering bevarar servicehistorik. Operation-ID + ledger och historik i samma SQL-transaktion; row lock/revision stoppar samtidiga gamla/nya skrivare. Samma retry återanvänder ID så länge editorn är öppen. Ingen hållbar offlinekö eller idempotens efter förlorat editortillstånd påstås.

QA DB: concurrent create/replay en plan/en händelse; två ändringar en vinnare; legacy writer invalidates revision; archive; negativa intervall och NaN/Infinity-strängar; staff/tenant/foreign mutation denied. Befintligt atomiskt service-record-provet passerar igen. Browser admin: create, notes edit och bevarat due date, avbryt arkivering, verkligt UPDATE-fel bevarar fält, retry lyckas. 390/430/768/1024/1440 fullsida och mobilmodal granskade. Browser stale-revision-prov bevarar utkast och annan skrivares ändring; återläsning + arkivering verifierad i DB: active=false, due 2027-10-05 bevarat, fyra RPC-historikhändelser. Full fordonsmodul/serviceutförande/utrustning/telematik/alla barnroller återstår.

## Driftinventarier

En kontroll är ett aktivt beslut: tomt är obesvarat, noll saknas. Snabbåtgärden Alla finns fyller uttryckligen önskade antal. Progress, kompakt responsiv artikelarbetsyta, en sammanhängande sammanfattning för alla artiklar. Browser kontrollerar 12/0/5/10, sparar fyra rader med exakt en brist (2 flaskor), lämna-/fortsätt-dialog, verkligt INSERT-fel bevarar alla antal och återförsök skapar en kontroll. QA återläsning: två avsiktliga kontroller totalt, åtta rader; felet skapade ingen tredje kontroll.

RPC 111900 sparar check + samtliga snapshots atomiskt, spärrar stale mall och malformed/missing/negativa antal, tenant/foreign mutation och foreign läsning. Concurrent replay ger exakt en check. List-/antal-/felvyer kontrollerade 390/768/1440, kompletterande bredder enligt skärmbildsmanifestet. Äldre malleditor och brist→inköp är fortfarande separata operationer; full historik-/scanning-/mall CRUD och same-org tenant SELECT-granskning blockerar helmodulstatus.

## Rutiner

Riktig instruktionsarbetsyta med parallell checklista på desktop, mobil läsbredd och färre kapslade kort. Editor grupperar instruktion/checklista/publicering utan att förlora data. Fixar: dialog från detaljvy syntes inte; template rows tappades vid edit; kvittering måste gälla aktuell version. Checkliststart använder 112000 transaktionellt; template required/photo flags kopieras, stale/empty/tenant/foreign nekas och replay är idempotent. Browser: aktuell version kvitterad, exakt en komplett tvåpunktschecklista skapad, editor från detaljvy visar de två befintliga raderna, cancel. Fem fullsidebredder och nedre mobilchecklista visuellt granskade. Se pass9-visual-qa.md för skillnaden mellan DOM-viewport, slutlig bild och tidiga exportframes. Rutin-Edge save/version/metadata/notification är fortfarande äldre icke-atomiskt flöde; ingen publicering/arkivering via ny backend hävdas verifierad. Lokalnote-save visar fel men full CRUD kvarstår.

## Säkerhet och migration

Se pass9-hotfix-staging.md för tre isolerade baslinje-/kandidatprov. Se pass9-release-plan.md för samtliga 32 filer, installationsprov och konkreta gates. Produktion/main är inte patchade. Nya 111700/111800/111900/112000 endast applicerade i QA/staging. Äldre publika storageytor ej åtgärdade. Profil-UPDATE-auktoritet finns i export men full specialgrantmatris återstår. Bred egen-org SELECT i äldre driftinventarier/checklistor kräver egen utredning; nya mutations-RPC:er kontrollerar aktiv roll/org på servern.

## Testresultat

- PASS TypeScript, Vite build och mobile bundle (ingen publik vibofast.se i apppaketet).
- PASS lint: 0 errors, 81 warnings, lika baslinjen; varningarna är kvarstående hook-/refresh-kvalitetsarbete.
- PASS premium, chat invariants/mock-FCM, inventory invariants och rental pricing.
- PASS notifications-integration, fleet-plan-integration, fleet-service-integration, operations-inventory-integration, routine-checklist-integration på riktig QA-DB/REST/JWT.
- PASS isolerade hotfix baselines/candidates; 32/32 DDL-installationer på separat schemaklon efter korrekt publication-förutsättning.
- EJ KÖRT fysisk iOS/Android, riktig QA-Drive, riktig Accounted PDF, full modulregression alla 62, production canary/backup/restore.

Kontrollerade testfel korrigerade under passet: event_type måste använda befintlig updated; test-fixture behöver explicit required/photo när blandade bulknycklar används; NaN-testets requestvariabel rättad. Slutproven passerar. Detta dokument innehåller inga produktionshemligheter/testlösenord.

## Nästa prioritering

1. Gör rutinens version/metadata/publiceringsnotis atomisk med revisionskontroll och testa QA Edge/legacy innan rutinmodulen slutverifieras.
2. Atomisk inventariemall + bristinköp, explicit driftroll-RLS, historia/scanning; serviceplaner vidare in i utrustning/serviceutförande.
3. Därefter orörda resor/åtkomst/underhåll, ekonomins underflöden och kvarvarande personal/admin enligt modulstatus. Undvik att ännu en gång fastna i redan moderniserade centrala vyer.
4. Skaffa separat QA-Drive/Accounted och fysisk mobiltestning för releasegates; externa blockerare hindrar inte oberoende UX-arbete.

## Teststädning och sessionsgräns

PASS cleanup av exakta disponibla pass9-konton/notiser, fordon/planer/historik, två inventeringschecks/åtta rader och rutin/kvittering/checklista. Feltriggers, restriktiv fault-policy, fault-funktioner/tabell och utgången test-JWT borttagna. Temporära operations/fleet QA-module fixtures återställda. Browser utloggad, temporära flikar stängda, viewport reset och baslinjeserver stoppad. Grund-QA och fyra schema-only-stagingkloner behålls för återupptagning; inga öppna teststämplingar skapades. Inget arbete fortsätter i bakgrunden efter slutrapporten.
