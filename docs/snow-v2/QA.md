# QA – 2026-10-27

Samtliga data nedan är syntetiska i en isolerad Docker-databas. Ingen faktisk utkallning, personalaktivering eller faktura skickades.

| Kontroll | Utfall |
| --- | --- |
| Befintliga snow unit/availability-tester | PASS, inklusive äldre geometri/roller och svenska DST/datumgränser |
| Nya återkommande kalender-/undantagstester | PASS |
| Åtta verkliga äldre snow-migrationer + nio nya, färsk PostgreSQL15 | PASS på kontraktschema; full produktionsschema-repetition återstår |
| Sju förare/tre maskiner, behörighet, vecka, avböjning, timeout, reserv | PASS |
| Samtidiga kvittenser och samtidiga fakturareservationer | PASS; bara en får platsen respektive reservationen |
| Ordinarie klocka/exakt återförsök och automatisk granskning | PASS |
| Manuell tidändring och historiska priser | PASS; ny granskning krävs, prisändring ändrar inte gammal snapshot |
| RUT på endast arbete, faktiskt arbetade timmar, ofullständig privatkund | PASS |
| Bilder: org/ägande, även med gammal bred Storage-policy | PASS SQL; faktisk Storage HTTP-uppladdning/signerad nedladdning inte end-to-end-provad |
| Accounted-payload och utkastssvar, osäker POST, lease, låst innehåll, rättelse | PASS simulerad kontrakts-/SQL-körning; inget verkligt Accounted-anrop |
| Verklig PostgREST JWT/pre-request-grind för snow-roll | PASS: egen översikt/token, nekad ekonomiläsning/adminskrivning/annans token |
| TypeScript, riktad ESLint | PASS, noll fel/varningar i ändrad snökod |
| Deno check ny Accounted-Edge + ändrad push-Edge | PASS |
| Vite produktionsbuild | PASS; befintliga varningar om stora bundlar kvarstår |

## Webbläsarprov

Riktig `SnowPage`, `AuthProvider`, delade UI-kontroller och Supabase-klient, mot faktisk lokal PostgREST och den testade databasen. Ingen mockad backend. Fixture-auth är endast lokal och tillhör inte produktionen.

- Desktop1440×900: översikt, fem statusfält, tre resurskort, inga yttre horisontella överflöden. Administrationens kund/pris/faktura/rutt/inställningar samlades under en separat menynivå efter visuell granskning.
- Mobil390×844: kunddialog och faktiskt sparad ny kund, grundveckans två intervall på samma dag sparade genom RPC, inaktuell veckobekräftelse och kalenderns uppdaterade kapacitet verifierade.
- Verkligt serveravbrott: lokal PostgREST stoppades. Veckobekräftelse blev tydligt väntande och nya kommandon blockerades. Efter omstart och omladdning fanns samma kommando kvar. Säkert återförsök gav serverbekräftelse och vänteläget försvann.
- Körpass: maskin vald, faktisk UI-instämpling, faktisk materialregistrering, fyra minuters körning, UI-utstämpling och databasstatus approved. `Min tid` visar Godkänt. Maskinvalet återställs från sparat pågående pass efter omladdning.
- iPad768×1024: fakturagranskning/låsta underlag. iPad1024×768: administration/prislista och lång prisdialog med delad scroll-/footerhantering. Det är Chrome-viewports, inte fysisk iPad/Safari.
- CSV-knappen klickades. Browserverktygets nedladdningsevent låste sig och sessionen återanslöts. Den verkligt nedladdade filen fanns i Downloads och verifierades separat: UTF-8 BOM, specifikationsrader och väntad syntetisk totalsumma375SEK. Serialiseringstestet verifierar även svensk decimal och skydd mot formler med inledande kontroll-/blanktecken.

Lokala skärmbilder och kontrolloggar sparas utanför Git i `som/outputs/snow-v2/`: desktopöversikt och mobilens godkända körpass. Tillfälliga viewport-inställningar och egna testtjänster återställs/stängs efter leverans.

## Inte verifierat

Full aktuell produktionsschema, verklig Accounted-konfiguration och eventuell öresavrundning, skarpt RUT-svar, faktisk Storage-transport, fysisk Safari/iPhone/Android/Capacitor, APNs/FCM-ljud/Fokus/kallstart, voice/critical alerts. Inga garantier om larm som väcker föraren. Dessa prov och aktivering kräver separat kontrollerad driftsättning; se OPERATIONS.md och DELIVERY.md.

## Godkänt återläsningsprov inför driftsättning

2026-10-27: färsk full backup från den riktiga VI-HEM-databasen återläst i identisk Supabase/PostgreSQL-image med network=none och avstängd cron. Roller, ägarskap och ACL återställda; Supabases extensionstyrda GraphQL-wrapper återskapades från källans definition före dess ACL. Nya migrationer körda med samma administratörsroll som befintliga snötabeller kräver. Autentiserat faktisk-schema-prov av kund/uppdrag/resurs/kompetens/ordinarie klocka/autoapproval/pris/snapshot/frisläppning PASS; alla provskrivningar rullades tillbaka. Befintlig adminpilot bevaras. Privata backup- och installationsloggar finns under /home/vibo/snow-release-20261027.
