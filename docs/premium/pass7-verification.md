# Pass 7 – fullständigare operativa arbetsflöden

Utgångspunkt remote b0e1c04, branch codex/vihem-3-premium. Main och produktion oförändrade. Denna kontrollpunkt kompletterar systemmoderniseringen; den avslutar inte hela inventeringen. Ingen hel modul uppfyller ännu hela Definition of Done.

## Individuellt implementerade förbättringar

| Område | Arbetsflöde och berörd kod | Faktisk verifiering | Återstår |
| --- | --- | --- | --- |
| Lager | InventoryPage + ArticleWorkspace: artikel/startsaldotransaktion, plats/saldo/historik, uttag/inleverans/förflyttning med operations-ID, CAS-redigering, bibehållet formulär vid fel | Admin browser startsaldo12 → uttag2 → fel1000 → återförsök1; DB saldo9/exakt3 rörelser. SQL dubbelanrop, rollback, saldo-race, referenser, roller och revision | Lagerplatser, inventering, korgens flerstegsskrivningar; komplett historikpaginering (nu organisationens 100 senaste), förlorat svar med ändrad payload, persistent offlinekö, alla rörelsetyper i UI |
| Schema | StaffSchedulePage: dagsagenda mobil/iPad, desktop dragvecka, Avatar, utkast/skydd/fel, CAS-redigering/radering | Admin browser skapar/redigerar text och DB; SQL CAS-race och legacy revisionsuppdatering | Tidfält visit_time, drag/delete/touch i browser, staff/tenant och full rollmatris. Skapande har UI-lås men inte hållbar nätverksidempotens |
| Fordon | FleetPage: tillgångsprofil med relevanta fakta/kommande åtgärder, bibehållna flikar, atomisk editor + historik/kontroll/källa, operation-ID och revision | Admin browser skapa/statusändra/historik; SQL inspection/source, exakt en statuslogg, replay/stale/rollback/roller | Service, utrustning, körjournal, onboard/barnoperationer är fortfarande äldre flöden; full fel-/rollmatris |
| Driftchecklistor | OperationsChecklistsPage: fokusarbetsyta, progress, stora punktytor, avslutat arkiv; atomisk punkt + slutförande | Browser fem punkter och arkiv; DB5/5 completed. JWT personal/dubblerade steg/aktör/tid/avslut/roller | Rutinstart, kommentarer/fotoregler, underhåll/åtkomst och full felmatris |
| Frånvaro | TimeTrackingPage: heldag/del av dag, fokuserade fält, tids-/datumsammanfattning, fasta åtgärder, bevarat formulär, villkorad granskning | Admin browser heldag, serverfel/återförsök, del av dag10–12:30, godkännande/DB. SQL personal skapar; tenant/annan org läser inte; personal godkänner inte; konflikt ger en vinnare | Offlinekön/skapa är inte idempotent över förlorat svar. Admin edit/delete, fler typer och full rollmatris |

Inga ekonomiska beräkningar eller signeringsregler ändrade. Arbetsorderkommentarer och tidigare atomiska tid-/personal-RPC bevarade och regressionstestade. Inga dokument/filer migrerade eller publika buckets stängda.

## Teststatus

| Kontroll | Status | Begränsning |
| --- | --- | --- |
| npm run typecheck | PASS | Inte runtime-bevis |
| npm run build | PASS | App-chunk2714,33 kB/gzip700,26 kB; storleksvarning kvar |
| npm run test:mobile-bundle | PASS | Webb-bundle, inte App Store/native build |
| npm run lint | PASS med varningar | 0 errors/81 warnings; tidigare82, befintliga hook/refresh-varningar kvar |
| test:premium, test:chat, test:rental, test:inventory | PASS | Invariants/mockar, inte fysisk push/extern leverantör |
| inventory-create/movement, fleet-editor, checklist-step, editor-revision, inventory-reference-isolation, absence-review-integration.mjs | PASS | Riktig isolerad PostgreSQL/Supabase med syntetiska JWT-konton; inte produktionskonfiguration |
| workorder-integration.mjs | PASS | Roller/cross-org/inactive/spoof och superadmin; exact-fixture cleanup |
| clock-integration.mjs | PASS | Race/retry/rollback/rast/lunch/byte/out, total/comment/projekt; inga öppna testpass |
| staff-editor-integration.mjs | PASS | Atomisk profil/schema/grants, retry/rollback/roller; återställda data |
| legacy-security-probe.mjs | PASS | Provad tenant→admin nekad av befintlig QA-profiltrigger; andra profilfält/produktion ej verifierade |
| Visuell QA | PASS för angivna vyer | Ingen hel modul färdig; matris nedan |
| Fysisk iOS/Android, tangentbord/kamera/push | EJ KÖRT | Viewportsimulering är inte native-verifiering |
| Riktig Google Drive/Accounted | EJ KÖRT | Ingen separat extern QA-konfiguration tillgänglig i detta pass |
| Hela modulregistret/regression | EJ KÖRT | Nedan redovisade underflöden återstår |

Inga slutkontroller FAIL. Tidigare kontrollerade fel (översaldo, CAS-konflikt och avsiktligt sparfel) var förväntade negativa prov, inte fullständigt verifierade felmatriser.

## Visuell matris

Bilder i outputs/vihem-3-premium-pass7. Föreinstans från oförändrad b0e1c04 mot samma syntetiska QA. Aktuell UI5176 och separat baseline5186, endast tillfälliga testflikar.

| Vy | Före | Efter | Granskning |
| --- | --- | --- | --- |
| Schema | 390/1440 | 390/768/1440 | Agenda, vecka, formulär; hela dagvyn |
| Fordonsprofil | 390/768/1440 | 390/768/1440 | Profil, nedre innehåll, historik; ingen verklig fordonsbild i fixture |
| Artikel/uttag | Ingen jämförbar artikel-detalj före (ny arbetsyta) | 390/768/1440 + sparfel390 | Saldo/plats/historik och behållet uttag; kompakt fotoreserv efter iteration |
| Checklista | 390/1440 | 390/768/1440 | Arbetsyta/nedre punkter och avslutat5/5; ensam listselector borttagen efter granskning |
| Frånvaro | 390/1440 | 390/430/768/1024/1440 | Formulär/dagintervall/fel/osparat/godkännande; actual viewport kontrollerad |

430/1024 är inte verifierade i övriga operativa vyer. FullPage-bilder kan vara6px smalare på grund av scrollbar, och fixed navigation kan återges i mitten av en lång screenshot. Faktisk DOM-viewport och riktig scroll kontrollerades; screenshots ensamma används inte som native-/safe-area-bevis. Tidiga bilder med fel viewportmål ersattes i huvudmatrisen. Artikel-historik390 och checklista-avslutad1440 visar ett tidigare delsteg och bör inte användas som slutlig designreferens.

## QA-städning

Exakta nya browserfixtures för schema, artikel/plats/rörelser, fordon, checklista och två frånvaroposter borttagna efter DB-avstämning. Testskript städar egna UUID:n. Ingen öppen Christofer-stämpling. Temporära modulflaggor och syntetiskt avstängt Accounted-bolag återställda/borttagna. Kontrollerad frånvarofeltrigger borttagen. Äldre QA-fixtures bevarade. Ingen extern begäran/fakturering/utskick/Drive-delning.

## Migrationer och säker driftsättningsordning

Nya migrationer, endast QA-applicerade:

- 20261011120000_atomic_inventory_create.sql
- 20261011123000_atomic_checklist_step.sql
- 20261011130000_idempotent_inventory_movement.sql
- 20261011133000_atomic_fleet_editor.sql
- 20261011140000_editor_revision_timestamps.sql
- 20261011143000_inventory_reference_isolation.sql

1. Separat granska säkerhetskandidater för arbetsorderkommentarer, fleet/lager-läsning och äldre lager-RPC. Se pass7-security.md och fleet-inventory-read-hotfix.md. Kontrollera beroenden, specialroller, grants och eftertester i staging. Produktionshotfix kräver separat godkännande och får inte blandas med premiumrelease.
2. För premium: backup + staging med produktionslik schema/publication/RLS. Applicera nödvändiga tidigare och nya RPC-migrationer i ordning före frontend. Frontend har ingen osäker fallback till gamla flerstegsskrivningar.
3. Kör roller, samtidighet, legacy-klient och regressionsprov. Äldre klienter kan fortsätta direkt-/legacyvägar, men får inte nya retrygarantier. Revisionstrigger fångar deras ändringar för nya CAS-klienter; gamla klienter har själva inget CAS-skydd. Restrictive säkerhetshotfix kan avsiktligt neka tidigare felaktigt tenant-läsbart fleet/lager.
4. Ledgerkvittens måste behållas för retryhorisonten. Ingen automatisk gallring av idempotenskvitton eller produktionsfiler införs här. Säkerställ logg-/retentionpolicy innan sådan gallring.
5. Mobilbundle PASS måste kompletteras med fysisk iOS/Android, native build, tangentbord/touch och offline-/förlorat-svar-prov. Produktionssätt inte hela premiumbranchen utifrån denna rapport.

## Bekräftat och inte bekräftat

Bekräftat i QA: äldre inventory SECURITY DEFINER accepterade lagerplats från annan org. Fristående kontrollpatch avvisar detta och behåller giltig egen stockin. Fleet/lager tenant-SELECT och WO-kommentarbrister har separata tidigare kandidater. Legacy publika buckets/svaga policydefinitioner finns i källkod; faktisk anonym åtkomst till produktionsfiler ej prövad. Profil-UPDATE är bred i äldre policy, men provad rolleskalering stoppas av befintlig trigger i QA. Produktionsguard/övriga profilfält kräver fortsatt utredning. Inga produktionsexploateringar utförda.

## Nästa arbetsflöden

Lagerplatser/inventering/korg; fordonsservice/utrustning/resor; driftens rutiner/underhåll/åtkomst. Därefter Finance V2 alla underflöden, lönegranskning, hyror, tvättadmin/tenant/samtidighet, återkommande kalenderhändelser och övriga administrativa moduler enligt modulstatus.md. Dessa områden har inte fått full individuell verifiering i detta pass. Säkerhets-, Drive-, äldre app- och native-releaseblockerare kvarstår.
