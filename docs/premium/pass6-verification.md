# Pass 6 – arbetsflöden, säkerhet och faktisk verifiering

Utgångspunkt 6fadc64 på codex/vihem-3-premium. Ingen merge, produktionsmigration, extern faktura eller apppublicering. Alla skrivprov använde syntetisk organisation VI-HEM Chat QA i vihem_chat_qa. Befintligt designsystem återanvänt.

## Levererat

1. Personaleditor: dagskopiering, nettovecka med befintlig lunchregel, mindre upprepning. Befintlig profil + schema + grant-diff sparas i samma PostgreSQL-transaktion med operation-ID och payloadfingeravtryck. Ny Auth-användare och äldre direktklienter omfattas inte av atomiseringsgarantin.
2. Lön: kompakt granskning, personalfilter, Avatar och mobilrader, kontrollerad bulk-update med tydlig bekräftelse. CSV-export implementerad; nedladdningens slutresultat EJ verifierat eftersom browserdownload väntade och sessionen avbröts. Befintlig regel som inkluderar utkast/avvisade i Godkänn alla bevarad och synlig.
3. Finance V2: uppgiftssammanfattning, enklare fakturafilter, egen mobilpresentation och bolagsrace-skydd. Övriga flikar inte fullständigt omarbetade.
4. Kalender: mobilmånad/agenda och fokuserad redigering; privat create/edit sparat och återläst. iCal och alla synlighetsvarianter kvarstår.
5. Fordon: nollkort ersatta av sammanfattning och relevant uppföljning; registerfilter bevarade. Tre delar i editorn, utkastskydd och laddfel. Detaljer/körjournal/service fortfarande inte individuellt färdiga.
6. Lager: artikel/saldo separat, validering före insert, sparlås/utkast/fel. Artikel med positivt startsaldo kräver fortfarande separat RPC efter insert; ingen falsk atomisk garanti.
7. Hyror: kompakt sammanfattning, underlag på begäran och synliga varningar; mobiljusteringsform. Riktig QA-overview-Edge utan externa fakturafunktioner. -50 kr sparat, 6200 → 6150 kr och exakt en DB-rad kontrollerad. Befintlig beräkningslogik orörd.
8. Tvätt: nästa lediga pass i visad vecka och idag-genväg, gästlänkar sekundära och kompakt bokningstomläge. Riktig UI-bokning/avbokning med en cancelled-rad i DB. Tenant/maxgräns/rumsadministration återstår.
9. Driftöversikt: behovsstyrd uppföljning, verktygsingångar, kontrollerade söksvar. Driftundersidor inte omarbetade i detta pass.

Gemensamma Tabs håller vald flik synlig även vid resize. ResizeObserver stängs vid avmontering. Fieldset min-width korrigerad efter riktig visuell upptäckt av mobil överflytning. Ingen ny konkurrerande designkomponent eller teknikstack.

## Tester

| Kontroll | Resultat | Begränsning |
|---|---|---|
| TypeScript | PASS | Lokal tsc, inte native-kompilering |
| Build | PASS | Stor App-chunk cirka 2703 kB / gzip696 kB; chunkvarning kvar |
| Mobilbundle | PASS | Rent/finance/Vibo-admin kvar, publik vibofast-app ej med |
| Full ESLint | PASS, 0 errors / 82 warnings | Befintliga hook/refresh-varningar kvar, inte varningsfri |
| test:premium | PASS | Profilvalidering, utkast och rumsbedömning |
| test:inventory | PASS | Befintliga invarianter, ersätter inte hela UI/integrationsmatrisen |
| test:rental | PASS | Befintliga prismodellsprov |
| test:chat | PASS | Invarianter/pushtransportmock, inte två verkliga klienter/native |
| staff-editor-integration.mjs | PASS | Riktig QA RPC/transaktion/replay/constraint-rollback och negativa roller; full admin/grants/superadmin/screen kvar |
| pass6-module-integration.mjs | PASS | Browser create/edit återläst; privata kalender-/fleet-/lagerrader, tenant/foreign negativa SELECT/UPDATE; godkänd tid och avbokning |
| Hyresjustering DB | PASS | Exakt en syntetisk -50-rad, inga fakturor eller utskick |
| Lager sparfelsprov | PASS | QA triggerfel behöll formuläret, retry lyckades; trigger borttagen |
| Real Accounted/Drive/APNs/FCM | EJ KÖRT | Externa nycklar/testkonfiguration och fysiska enheter saknas |
| Native iOS/Android | EJ KÖRT | Browser viewport är inte fysisk tangentbords-/kameraverifiering |

Behörighetsprov hittade befintlig tenant-läsning av fleet/lager inom samma org. Separat rollvakt tillämpad/återtillämpad i QA. Staff/admin fortsätter läsa; tenant/foreign läs/ändra nekas. Se fleet-inventory-read-hotfix.md. Legacy publika storage-buckets är fortfarande en separat risk och blir INTE privata av tabellpolicyn.

Testet pass6-module-integration kräver att de namngivna syntetiska posterna först skapas genom UI enligt checklistan ovan och att PREMIUM_QA_STATE anger fixture-ID:n för tids-/tvättprovet. Efter städning går det avsiktligt inte att köra mot saknade poster; återskapa disponibla QA-fixtures, aldrig produktionsposter. CHAT_QA_CONFIG innehåller QA-URL/nycklar/testkonton och ska aldrig committas.

## Visuell QA och dess gränser

Föreinstans var ett git archive av 6fadc64, separat localhost-proxy till samma QA. Före-/eftergranskning av schema, ekonomi, lön, kalender, fordons- och artikelform visar verkliga UI-vyer. Kontroller vid begärda 390/430/768/1024/1440 har genomförts i browser, men screenshotverktyget fångade ibland tidigare resize-tillstånd eller skalade bilder. Filnamn är därför inte tillräckligt breakpointbevis.

- Fordonsregister fem korrekt storlekskontrollerade PNG 390/430/768/1024/1440. Lagerlista har verifierade 768/1024/1440, stabil 390-form; vissa tidiga 390/430-filer avviker.
- Schema/form, kalender/form, lön, Finance V2, hyresunderlag, tvätt och drift har stabila mobila slutbilder i outputs/vihem-3-premium-pass6. Lön/Finance nedskalade tidiga -korrekt-390 ska inte användas; använd -slut-390.
- Full kontrollerad före/eftermatris vid alla fem bredder för ALLA nio områden återstår. Flera bilder visar endast överdelen; full scroll-/långdata-/fel-/tangentbordsmatris är inte färdig. Ingen modul är DoD-Klar.
- Två visuella brister upptäcktes och rättades: fieldset expanderade fordonsformuläret på mobil, aktiv Finance-flik kunde hamna utanför synlig remsa efter resize. Ny slutbild bekräftar rättelserna.
- Samlad mobilbild är en översikt över förbättringarna, inte bevis på alla arbetsflöden.

## Release och fortsättning

Backend 20261011100000_atomic_staff_editor.sql först, sedan frontend; ingen osäker fallback om RPC saknas. Äldre installerade appar kan fortsätta direkt gamla personalskrivningar men får ingen transaktionsgaranti. Rollvakten 20261011103000 är fristående säkerhetskandidat efter full policy/storage/RPC-granskning och separat godkännande. Ingen produktionsdeployment rekommenderas enbart av detta pass.

Fortsätt med frånvaro, StaffSchedule-översikten, lagerplatser/uttag/inventering, fordonsdetaljer/körjournal, driftundersidor samt övriga adminfunktioner enligt modulstatus. Åtgärda samtidigt atomiska följdskrivningar i lager/fleet, privata legacy-filer och full ekonomisk granskningsmatris. Tidigare workorder-comment/profile-UPDATE säkerhetsärenden och QA-Drive/migrering/native-blockerare kvarstår. Inga andra moduler räknas moderniserade av gemensamma Tabs-ändringen.
