# Snö & halka V2 – utvecklingsleverans

2026-10-27. Branch `codex/snow-operations-v2`, bas `d5ab514`. Ingen merge, push, produktionsmigration, faktisk utkallning eller fakturaskapande i Accounted har utförts. Läs [inventeringen](INVENTORY.md) först. Detta är en testad utvecklingsleverans för granskning och pilotprov, inte en garanti att hela kravbilden är produktionsverifierad.

## Vad som återanvänds och fungerar i implementationen

- Den befintliga snömodulens rutter, blandade linjer/områden, prioriteringar, kartfärger, jour och daterade vecka-/månadskalender finns kvar. Snöuppdrag länkas till ekonomins juridiska kund och fakturerande bolag. Flera uppdrag kan dela kund men ha egna priser/referenser/kostnadsställen.
- Ny översikt med resursstatus, bekräftade/obekräftade pass, aktiva körningar via ordinarie klocka och administration. Samma mobila sida, separata begränsade förarkonton enligt tidigare behörigheter.
- Återkommande grundvecka med upp till fyra intervall/dag, datumundantag, frånvaro och personlig veckobekräftelse. Ett ändrat grundschema/datumundantag gör tidigare veckobekräftelse inaktuell. Optimistiskt revisionsskydd förhindrar att två schemavyer tyst skriver över varandra.
- Kalenderns kapacitet beräknas nu även från grundveckan. Den visar frivillig kapacitet, inte garanterad maskinbemanning. Jouransvar räknas inte som accepterat maskinpass. Antal resurser hämtas från konfiguration; inga verkliga maskin-/ortsnamn eller priser läggs in automatiskt.
- Resurser länkas till Fleet eller representerar handlag. Kompetenser, planerade pass, dagfilter, alternativa förare sorterade efter snötid senaste 30 dagarna, redigering av ännu ej utkallad planering och batchutkallning.
- Servern kontrollerar bekräftad tillgänglighet, kompetens, aktiv resurs, planerade/antagna pass, pågående ordinarie arbete, längsta pass och viloperiod. Överlappande maskin/förare och dubbla accepterade svar blockeras transaktionellt.
- Egen kvittens/avböjning, svarstid, upprepning, reserveskalering, avlösning och ansvarignotis vid lucka. Status skiljer planerad, utkallad, accepterad och arbete startat. Inga kvittenser visas som lyckade före serversvar. Översikten uppdateras var 15:e sekund och vid återfokus.
- Ordinarie stämpelklocka och dess exakta UUID-kvitton återanvänds; inget parallellt lönetidssystem. Snöwrappern kopplar maskin/Fleet och accepterat uppdrag till tiden. Byte/rast/lunch/utstämpling finns kvar.
- Grundorsaken till fastnade submitted-pass var klientens uttryckliga completion_status och avsaknad av servergranskning. Avslutade giltiga snöpass granskas nu efter det atomiska klockkvittot. Avvikelser och manuella ändringar blir submitted för granskning. Gamla submitted-pass bulkändras inte; administrationen granskar dem med orsak.
- Förare kan söka befintlig kund, skapa begränsade kunduppgifter och registrera extrauppdrag utan ekonomiadministration. Kunduppgifter kan vara ofullständiga under körningen; fakturering spärras tills de kompletterats.
- Prisversioner per uppdrag eller gemensam bas: arbete, maskin, startavgift, material, resa; timpris, fast pris, tidssteg, minsta antal/avrundning och giltighetsdatum. Inkl./exkl. moms normaliseras serverbaserat. Godkänt arbete får en prisbild som inte ändras när prislistan senare uppdateras.
- Material-/reseregistrering med servervalt pris och exakt återförsök. Privata arbetsbilder i egen 10 MB JPEG/PNG/WebP-bucket med ägande/orgkontroll och tidsbegränsad visningslänk. Bilder och kommentarer är valfria.
- RUT skiljer berättigad arbetskostnad och faktiska arbetstimmar från maskin, resa, startavgift och material. RUT måste begäras på uppdraget och prisets arbetsrad uttryckligen vara berättigad. Administratör måste granska privatkundens skyddade person-/bostadsuppgifter. Ingen generell fakturarabatt.
- Periodval 1–31 dagar och denna månad, gruppering per juridisk kund/bolag/referens, låsta fakturarader/totalsummor, CSV med Excel-BOM och formelneutralisering. Samma arbetspass kan endast reserveras en gång, även med två administratörer samtidigt.
- Underlag som aldrig överförts kan återöppnas med orsak; snapshot och händelsehistorik bevaras. Reserverat/externt arbete kan inte flyttas eller skrivas om genom gamla tidsredigeringsvägar.
- Accounted-adapter använder befintlig krypterad bolagskontext, kundresolver och REST-klient. Skapar bara utkast. Bolags-/säljbehörighet kontrolleras. Extern payload, datum, bolagskoppling och nyckel låses. Bekräftelse kräver faktiskt matchande utkastssvar.

## Accounted: särskilt viktigt fynd

Läst faktisk serverkod, utan ändringar: `/home/vibo/accounted/gnubok/src/app/api/v1/companies/[companyId]/invoices/route.ts`, `src/lib/api/idempotency.ts`, `src/lib/api/v1/with-api-v1.ts`, scheman och RUT-regler. API:t har obligatorisk Idempotency-Key men svarets cache är **best effort med 24 timmars TTL**. Det är ingen transaktionell garanti mot ett avbrott mellan skapande och cachning.

Därför återupprepar denna snöintegration **inte en osäker invoice-POST**. Underlaget förblir reserverat. `Stäm av befintligt utkast` gör endast GET mot angivet UUID och verifierar kund, VI-HEM-batchmarkör i notes, datum, belopp, valuta, RUT och draft-status. Byte av bolagskoppling/adress för extern API spärrar överföringen. Fel loggas med batch-ID och säker felkod, utan nycklar/personnummer.

Om inget utkast kan hittas efter osäker POST behövs manuell avstämning innan en ny överföring får tillåtas. Ingen knapp för att kringgå detta har lagts in. En framtida helautomatisk återstart kräver ett verifierat atomiskt idempotenskontrakt eller unik extern fakturareferens i Accounted. Den begränsningen är avsiktlig och viktig för att undvika dubbelfakturering.

## Databas och säkerhet

Åtta additiva migrationer: `20261027100000` grund/kompetens/tillgänglighet/planering; `101000` kommandon/utkallning/dispatch; `102000` tidsgranskning; `103000` pris/RUT/fakturaunderlag; `104000` scoped läsmodell/API-allowlist/native token; `105000` Accounted-utkast; `110000` privata foton och pushkontroll; `112000` kalenderprojektion.

Nya tabeller omfattar settings/resources/competencies/patterns/week_confirmations/duties/invitations/events/operations/notices/time_audit/reviews/prices/work_items/valuations/customer_tax/invoice_batches/invoice_entries/photos med prefix `vihem_snow_`. Ägarskap/organisation och admin/egen läsning upprätthålls med RLS. Direkta klientskrivningar ersätts av validerade RPC; interna helpers är inte klientanropbara. Organisationens tillgänglighetslås används även av gamla datumeditorn. Maskinlås och reservationsnycklar skyddar mot samtidighet. Ingen service role key i frontend.

Tid lagras i UTC; dagsgränser och kalender visas i Europe/Stockholm. Tidsfingerprint använder epoch för att inte ändras med sessionens tidszon. Arbets-/viloparametrar är konfigurerbara planeringsregler, inte ett rättsligt godkännande av anställningsvillkor.

Personnummer lämnas inte till förarens läsmodell eller lokala kommandolagring. Administratörens fakturaunderlag och serverns revisionskvitton innehåller nödvändiga skyddade fakturauppgifter. Dessa kräver samma kontrollerade lagring/backup/gallring som ekonomidata. Storage har en extra restriktiv bucket-policy så att äldre breda permissiva regler inte öppnar arbetsbilder.

## Tester och deras faktiska omfattning

- `npm run test:snow` – befintlig geometri/roller/tillgänglighet/DST samt nya återkommande intervall, veckobekräftelse och datumundantag.
- `npm run test:snow:db` – färsk märkt PostgreSQL 15-container. Läser samtliga åtta verkliga V1-snömigrationer plus åtta nya. Sju förare, tre maskiner, samtidiga accepteranden/reservationer, avböjning/timeout/reserv, faktisk ordinarie klocka, auto-/manuell granskning, historiska priser, privatkund och ofullständiga fakturauppgifter, materialåterförsök efter utstämpling, RUT endast arbete, avlösning, skyddade foton trots bred gammal Storage-policy, stale-push, tidszonfingerprint, veckopåminnelse, avslutad eskalering, låst extern payload, faktisk utkastskvittens samt spårbar återöppning före överföring.
- `npm run test:snow:payload` – verklig Accounted-mappning, RUT-arbetsrad/timmar, saknade och felaktiga värden.
- `python3 scripts/snow-v2/http-test.py` mot lokal PostgREST – verklig JWT/API-grind för snöroll, ekonomidata/adminskrivning nekas, egen native push-token tillåts, annans nekas.
- TypeScript, riktad ESLint, Deno check för nya Accounted-funktionen och ändrade pushfunktionen samt Vite-build.
- Chrome använder den riktiga SnowPage + AuthProvider mot den isolerade PostgREST/SQL-databasen, ingen mockad backend. Mobiltest av grundveckans flera intervall, sparning, inaktuell bekräftelse, kundskapande och dialoger; desktop/iPad-granskning och avbrott/återförsök dokumenteras i QA-noterna.

**Avgränsning:** PostgreSQL-fixturen är ett kontraktschema, inte en full produktionsklon. Bland annat personaleditorns omgivning och externa notis-/fakturatransporter är isolerade. Före installation behövs repetition på återläst aktuell full schema/backup för att fånga andra triggers/defaults och faktisk Accounted-konfiguration. Syntetiska data används enbart lokalt.

## Kvarstående begränsningar / fysiska prov

- Ingen automatisk röstuppringningsleverantör eller iOS Critical Alerts-behörighet är verifierad. Vanlig push kan inte lovas väcka någon. Reserv-/påminnelseflödet och säkra leveransgrindar är implementerade; telefoni, egna larmljud och kritiska native-kanaler är inte aktiva.
- Fysisk iPhone/Android: testa inloggning, tokenregistrering, ljud/Fokus/batteri, stängd app/deep link, serveravbrott och verklig kvittens. Provideracceptans är inte telefonleverans eller läskvitto.
- Utkallningarnas egna notisinställningar måste verifieras mot verkliga användarpreferenser. Cron och existerande push-transport måste installeras/provas separat.
- Serverbaserat arbete/pris/RUT/fakturaflöde är testat med syntetiska data; inget faktiskt Accounted-utkast har skapats i detta uppdrag. Accounteds eventuella avrundning, kundkonton och fulla RUT-svar kräver separat kontrollerat integrationsprov. RUT-berättigande, årets utrymme och kundvillkor måste kontrolleras av administrationen; formatkontroll av personnummer är inte identitetsverifiering.
- Ingen digital kundsignatur eller automatisk RUT-ansökan till Skatteverket. Utförande-/prisöverenskommelse kan dokumenteras, men är inte en signerad handling.
- Fakturakreditering och efterföljande externa rättelser hanteras i Accounted. Befintligt låst snöunderlag bevaras. Kontraktsvillkor/kontaktpersoner kan dokumenteras i befintliga instruktioner; avancerad avtalsdatamodell och prognosoptimering ingår inte som färdig funktion.
- Resurser/kompetenser och manuella planeringsändringar finns, men ingen drag-and-drop-planerare eller automatisk flerdagarsoptimering. Reserver föreslås för planerade maskinpass; allmän tillgänglighet är aldrig en accepterad reservbokning.
- Nätavbrott: ordinarie klockans befintliga kvitto/återförsök samt operativa kommandons vänteläge används. Kartor och fotouppladdning kräver anslutning; ingen falsk offlinekvittens. Pågående vy kan behålla läst data, men kallstart utan nät har inte lovats som komplett offlineläge.
- Ofärdiga fotouppladdningar blir inte synliga som färdiga. Gallring av övergivna objekt behöver ett separat servicejobb som använder Storage-API:t; radera inte storage.objects direkt. Automatisk fullständig mediagallring är inte aktiverad.

Detta färdigmarkerar inte VI-HEM:s övergripande premiumprojekt eller alla framtida snöfunktioner.
