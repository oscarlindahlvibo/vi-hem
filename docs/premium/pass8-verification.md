# Pass8 – lager, service, aviseringar och isolerade säkerhetsunderlag

Utgångspunkt remote a47615e, branch codex/vihem-3-premium. Inga merge-/produktions-/externa filoperationer. SQL enbart vihem_chat_qa, syntetisk organisation VI-HEM Chat QA. Befintligt designsystem/Modal/DialogSurface återanvänt; ingen ny UI-stack eller nya beroenden.

## Status och räknesätt

Modulregistret har 62 inventerade vyer/modulområden. Efter pass8 är 28 individuellt moderniserade/under arbete, 34 individuellt ej påbörjade, 0 hela moduler fullständigt QA-verifierade, 0 av dessa certifierade produktionsklara. Aviseringar är det nya individuellt moderniserade området, lager och fordon har vidareutvecklats. De tre nu förbättrade arbetsflödena är inte tre nya kompletta moduler. Siffrorna innebär inte att samtliga formulär inom de 28 områdena redan är färdiga.

Ingen hel modul får Klar i detta pass. Lager har kvar inventering/skanning/filer och legacy-vägar. Fordon har kvar serviceplan-CRUD, utrustning, dokument/körjournal och andra barnflöden. Aviseringar har en omfattande webbcheckpoint, men browserroll-/kontobyte, JWT-expiry, hämtfel, återanslutningsmatris och native push återstår. Att ett område saknar externa integrationer gör det enklare att slutverifiera; det ersätter inte hela tillämpliga matrisen.

## Lager – verklig funktion och UX

- Korgens radvisa anrop ersatta av vihem_checkout_inventory_cart. Samma actor/operation/payload ger samma rörelse-ID:n. Artikel-ID-sorterade lås förhindrar överuttag i de provade samtidiga cartfallen. En senare rad som avvisas återställer tidigare raders saldo och historik.
- UI visar material/destination sida vid sida på desktop, mobil helskärm och fasta sparåtgärder. Vald plats visar platsens saldo (19), inte organisationens total (20). Fel bevarar korgen, osparat-dialog bevarar respektive lämnar den uttryckligen. Skanning finns kvar men är inte fysiskt testad.
- Platseditor använder stable operation-ID och revision. Cykler, andra organisationers föräldrar, saldo och aktiva barn kontrolleras serverbaserat. Arkivering bevarar historik. Balance-trigger låser plats med FOR SHARE så skrivning efter arkivering nekas; direkt gamla plats-DELETE/parent-UPDATE-vägar är fortfarande en blockerare för full backendgaranti. En verklig parallell archive/balance-race har inte testats, bara stale-write och låsmekanismen.
- Artikelhistorik har egen org/item-query, 50-radssidor och cursor created_at/id. API traverserar 126 rader, varav123 med samma datum, utan luckor/dubbletter. Browser visar 67 rader inklusive äldre-knapp; organisationens gamla100-radsförhandsvisning begränsar inte artikeln längre.
- Browser: två rader1/999 → serveravslag, saldo20/20 och kvarvarande form. Retry1/1 → två flyttar, source19/19 och destination1/1. Plats skapa→edit HYLLA-Ö→arkivera tom, källplats med saldo nekas.

Operation-ID bevaras vid oförändrat återförsök i samma öppna formulär. Ingen beständig offlinekö. Stängning/omladdning eller ändrad payload efter ett osäkert nätverkssvar kan bli en ny operation; ingen generell exakt-once-garanti över appomstart påstås. UI redovisar osäkerheten.

## Fordonsservice

Ny vihem_record_fleet_service sparar record, planens nästa datum/mätare, tillgångens mätare, kostnad, event och kvitto i samma transaktion. Vehicle/plan låses med CAS. Replay kontrollerar org/record/payload. Befintlig 30-dagarsmånad och kostnadsmodell bevaras. Personal kan registrera ad-hoc service, men får inte administrativ plan-/kostnads-/mätarändring; den gamla UI-vägen kunde tyst misslyckas med sådana följdskrivningar. Ingen utökad personalrätt införd.

JWT QA: dubblett en record/cost/event, changed replay/stale revision/foreign/tenant nekas, staff ad-hoc utan administration tillåts. Kontrollerat triggerfel vid event efter cost gör rollback av record/plan/meter/cost. Feltrigger borttagen. Browser admin:1250kr,200mil, nästa2026-12-09 återläst; en följande ad-hoc service ligger kvar på Service efter save i stället för remount till Översikt. Serviceplanens eget skapa/edit och övriga barnoperationer är inte atomiserade av detta RPC.

## Aviseringar

Äldre aviseringar raderas inte längre när sidan öppnas. Paginering har null-datum sist och lika-tidsstämpel-ID-cursor. Sök avser uttryckligen hämtade rader. Markera läst/allt läst och delete kontrollerar resultat, fel är synliga och samma knapp är låst under anrop. Radering kräver bekräftelse och ändrar ingen länkad arbetsorder/dokumentpost. Nya CDC-händelser erbjuder refresh utan att kasta sidladdad historik. Null-datum visas som Datum saknas.

Disponibel QA-användare: läsfel med bevarad oläst → retry lyckas; read-all→tomt oläst; söktomt; avbryt/delete; dokumentnavigation; ny faktisk CDC-notis;59 rader över50-gränsen och gamla/null-datum bevaras. JWT admin/staff/tenant/annan org ser/uppdaterar/raderar endast egna aviseringar, anonym nekas. Baslinjevyn tog bort exakt den disponibla äldre testaviseringen; den återställdes för efterprov. Ingen riktig användares äldre avisering raderades.

## SQL och kompatibilitet

Nya migrationer endast QA:

1. 20261011150000_atomic_inventory_cart.sql – beror på befintlig10-parameter lager-RPC och premiumregler för artikel/behörighet. Referenshotfix bör finnas före frontendrelease.
2. 20261011153000_inventory_location_editor.sql – beror på vihem_editor_revision_timestamp från20261011140000 och befintligt platsschema.
3. 20261011160000_atomic_fleet_service.sql – beror på befintliga fleet-tabeller, vihem_module_enabled och fungerande vehicle/plan updated_at. Verifiera revisiontrigger i releaseschema.

Nya UI-anrop har ingen osäker fallback. Backend först, sedan frontend. Äldre appar har fortfarande sina gamla korg/service/direct-write-vägar; backendtillägg gör dem inte transaktionella. Aktiva platser krävs nu av balance-triggern, gamla klienter som väljer arkiverad plats nekas. Historiska transaktioner och protokollreferenser ändras inte av dessa migrationer. Äldre appversioner måste testas mot releaseschema separat.

## Säkerhet – faktisk aktuell produktion

Read-only snapshot från shared supabase-db/postgres den2026-10-10 (PG15.8) omfattar policyer, helper/RPC-definitioner, relevanta kolumner, grants, profilertrigger och bucketmetadata. Inga personrader eller filer hämtade, inga produktionsskrivningar. SHA2568617df7c3dc847941c99ab65dbf2016826cae2fd0da99994c1c42a4dfb65cb36. Tre separata underlag: hotfix-work-order-comments.md, hotfix-fleet-inventory-read.md, hotfix-inventory-references.md. security-preflight.sql kör READ ONLY.

Aktuell produktion saknar de föreslagna kommentar-/fleetguarderna och legacy lagerreferensvalideringen. vihem_module_enabled tittar på superadmin/orgflagga, inte specialgrants; staging måste ta med tillåtna specialroller och screen. Profilauthoritytrigger finns i production, men den fullständiga profilerskalering-/medlemskapsmatrisen är inte certifierad.

Publika buckets bekräftade: chat-attachments, inspection-photos, fleet-images/documents, inventory-images, rental-images, work-order-attachments samt publika webbplatsbilder. Intentionally public webbannonser skiljs från privata person-/inspektionsfiler. Ingen faktisk privat fil hämtad anonymt och ingen bucket stängd. Backup/refinventering/legacykompatibilitet och verifierad migrering krävs före avveckling. Generella storage- och SECURITY DEFINER-ytor är inte fullständigt säkerhetsreviderade.

## Tester

| Kontroll | Resultat | Avgränsning |
|---|---|---|
| TypeScript | PASS | tsconfig.app |
| Vite build | PASS | stor App-chunk kvar, ingen uppmätt prestandavinst |
| Mobilbundle | PASS | rent/bådafinance/Vibo-admin finns, publik vibofast kod utanför |
| Full lint | PASS med81 varningar,0 fel | inte varningsfritt |
| Premium/chat/inventory invarianter | PASS | inga bevis för fysisk native |
| Inventory cart/location JWT integration | PASS | disponibla QA-data |
| Fleet service JWT integration | PASS | kontrollerat rollbackfel, inte extern verkstadintegration |
| Notifications JWT integration | PASS | ägarkontroll/paginering |
| Work-order comments regression | PASS | premium-QA, inte isolerad mainstaging |
| Legacy inventory references regression | PASS | full hotfixmatris kvar |
| Authentiserad visuell/browser QA | DELVIS PASS | ovan dokumenterade flöden; ingen full modulDoD |
| Riktig Google Drive / Accounted PDF | EJ KÖRT | separat QA-konfiguration/nycklar saknas |
| Äldre installerade appar | EJ KÖRT | fysisk/versionsmatris krävs |
| Fysisk iOS/Android, kamera/safearea/keyboard | EJ KÖRT | viewport är inte nativeprov |
| Isolerade hotfixar mot main/prodschema-kopia | EJ KÖRT | ska göras före separat godkännande |

## Visuell QA och bilder

Före från oförändrad a47615e i separat lokal instans med samma QA. Efter från aktiv branch. Korg och aviseringar jämförda; servicegränssnitt har efterbilder, ingen påstådd service-före/efterserie. DOM-bredd kontrollerad vid390/430/768/1024/1440. Bildexport vid snabba viewport/animationövergångar gav ibland annan rasterstorlek eller övergångsbild; se pass8-screenshot-manifest.json (repo), screenshot-manifest.json (leverans). Dessa är inte pixelbevis för önskad breakpoint. Lagerkorgens768-overgångsbild ersatt vid slutkontroll. Service390/430 raster har även viss exportskalning, nativeprov saknas. Efter1440/768/1024 ska användas för desktop/iPadgranskning tillsammans med DOM-mått. Tidiga lagerkorg390-bilder endast271px höga är inte fullsidereferenser.

Layoutgranskning ledde till tvåkolumnskorg, fullbreddssök på mobil i inkorg, befintliga fungerande theme-färger och serviceknappar utan radbrytning. Foto/skanning/tangentbord, långa dokument och samtliga övriga vyer ej granskade i detta pass. Ingen bred tillgänglighetscertifiering påstås.

## Första säkra release – konkreta spärrar

1. Separata hotfixar måste verifieras ensamma mot aktuellt main/produktionsschema och specialroller; nytt preflight/backup, JWT-eftertester och uttryckligt godkännande.
2. Privata legacy-filer: full referens-/policyinventering, verifierad backfill/Drive-migrering, avstämning och ingen tidig public-avstängning.
3. Riktig separat QA-Drive måste konfigureras med tillåten backendidentitet och testmapp; kör upload/read/retry/reconcile/tenantmatris. Mock/QA-DB ersätter inte Drive.
4. Äldre appar/backend-först versionsmatris inklusive direkta äldre skrivvägar, nativepush/keyboard/camera och fysisk iOS/Android.
5. Riktiga Accounted-PDF-flöden med separat QA-bolag/behöriga nycklar.
6. Valda releaseområdens fulla tillämpliga DoD och stagingregression, migrationordning/schemagap och rollback utan säkerhetsregression.

Nästa utvecklingsprioritet: inventering och återstående lagerövergångar; serviceplan/utrustning/dokument/körjournal; driftens rutiner/underhåll/åtkomst/inventarier; sedan schemaadministration, hyra/laundry/calendar, FinanceV2-underflöden och övriga34 orörda områden. External blockers ska inte stoppa oberoende UX-arbete. Produktionsrelease är inte godkänd eller genomförd.
