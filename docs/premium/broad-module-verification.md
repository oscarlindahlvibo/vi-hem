# VI-HEM 3.0 – breddpass 5, 2026-10-10

Utgångspunkt: 09297b2 på codex/vihem-3-premium. Detta pass moderniserar nio vyer/modulområden individuellt. Main, produktion och installerade appar har inte ändrats. Det övergripande premiumuppdraget är inte färdigt; ingen hel modul har ännu verifierats mot samtliga Definition of Done-krav.

## Genomförda förbättringar och faktisk verifiering

| Område | Förbättring | Verifierat i isolerad QA | Kvarstår |
|---|---|---|---|
| Fastigheter/lägenheter | Kompakt beläggningsöversikt, enhetssök/status, strukturerad kontakt, Grunduppgifter/Teknik & åtkomst, fasta sparåtgärder och utkastskydd | Admin ändrar/sparar enhet. Kontrollerat fastighetssparfel, behållet formulär och återförsök. API skapa/ändra med nycklar, nätverk och oförändrad hyra; staff läser, tenant/foreign nekas ändring | UI ny fastighet begränsad av befintlig QA-kvot; alla bild-/teknik-/ekonomi-/relaterade detaljflöden och full rollmatris |
| Hyresgäster | Mobil kontaktlista, status-/telefonsök, Avatar, fokuserade Kontakt/Boende-formulär och sparfeedback | Admin profil, lokal telefonändring, avbryt/fortsätt, oförändrad kontakt sparad | Nytt konto/hyreskoppling, ekonomiska följdoperationer, sparfel och alla roller |
| Avtal V2 | Responsivt arkiv, namngivna filter, sökdebounce och skydd mot gamla svar; generell utkastdialog | Admin skapar Offert, sparar svensk rubrik i blockredigeraren, preview och DB-återläsning. Staff läser, tenant/foreign nekas. Inga signaturer eller utskick | Malladministration, alla block, signer-/partsflöden, public sign/verify och BankID. V2 är fortsatt generell |
| Dokument | Desktop-tabell som standard, kompakt mobil/iPad, Fil/Uppgifter & åtkomst, diskreta objektkopplingar, öppningsstatus och utkastskydd | Admin skapar metadata för personaldokument, DB återläsning; staff läser, tenant/foreign nekas. Tom titel, osparat-dialog och tom sökning | Faktisk filuppladdning, riktig Drive, alla gamla fil-/PDF-referenser, full behörighetsmatris |
| Personal | Kontakt/Behörighet/Schema, fokuserad veckodag, bevarade rollval, laddkontroll innan editor öppnas, schemavalidering före profilskrivning | Ogiltig sluttid avvisas med formulär kvar, utkastvarning och återöppning till sparat schema | Nytt konto, roll-/grantsändringar, hela personallistan och schemamodulen. Giltig profil/schema/grants-sparning är fortfarande flerstegsoperationer |
| Inköp | Relevant kompakt översikt, sök/status, Avatar, mobilform, utkastskydd, kontrollerade sparresultat och statuslås per post | Browser create/edit/inköpt/ångra/filter; DB status/mängd/kommentar och nollställd inköpare efter ångring. Staff läser, tenant/foreign nekas | Radering, statusfel, samtidighet mellan enheter, fysisk touch och lager/inventarier |
| Min bostad | Bostaden/Avtal/Besiktningar, direkta boendeåtgärder, samlade uppgifter, tom kontakt dold, korrekt tenancy-hyra | Tenant öppnar bostad, växlar avtal/historik, Felanmälan öppnar rätt sida. 6200 kr stämmer med startsidan | Signering, faktiska protokoll, uppsägning, tillvalstjänster och alla fel-/tomlägen |
| Mina fakturor | Belopp/datum, sök/status, öppningslås och PDF-återförsök; rättad ägarkontroll | Tenant ser delbetalning 6200/1200, Betalda ger tomt filter; kontrollerat PDF-fel/retry bevarar listan. DB egna fakturor/admin/foreign/anon/inaktiv och privata interna billing items | Riktig Accounted-PDF, native delning, alla statusar/valutor och resten av ekonomimodulerna |
| Nyheter | DialogSurface, Innehåll/Mottagare & publicering, riktiga fältetiketter, tydlig Publicera/Spara utkast, lokal datumvisning, lugnare läsning och odubblerad Läs mer | Browser skapar/redigerar svenskt utkast, validering/utkastskydd, kontrollerat serversparfel och retry. DB originaldatum bevarat, staff läser, tenant/foreign nekas utkast | Bilder, publicering till olika mottagar-/fastighetsgrupper, samtliga statusar och native |

Befintliga fält och funktioner har behållits. Inga ekonomiska beräknings-, signerings- eller rollregler har ändrats som designåtgärd. Bostadens hyresvisning använder redan lagrat tenancy.monthly_rent, samma fält som hyresgästens startsida; apartment.rent är objektets grundhyra.

## Gemensamma komponenter och relevanta filer

Återanvänder befintliga Modal/DialogSurface, Tabs, Input, Select, Textarea, SearchInput, Button, Avatar, Toast och useUnsavedChanges. Inget nytt designsystem, ikonbibliotek eller externt beroende.

Ändrade vyer: AdminPropertiesPage, AdminTenantsPage, AdminStaffPage, DocumentsPage, PurchaseListPage, ApartmentPage, TenantInvoicesPage, NewsPage och modules/agreements-v2/pages/AgreementsV2Page. Nya QA-prov: scripts/premium/property-integration.mjs och invoice-ownership-integration.mjs. Kontrollpunkter 11A–11H beskriver detaljer och miljöåtgärder. modulstatus.md har uttryckliga statusar för hela registret.

## Databasmigration och säkerhet

20261010170000_tenant_invoice_ownership.sql är den enda nya produktmigrationen i passet. Tillämpad endast i databasen vihem_chat_qa. Den tidigare fakturapolicyn använde ett EXISTS över rent_billing_items under anroparens RLS. Hyresgästen fick inte läsa den interna tabellen och såg därför inte heller sina fakturor.

Ny SECURITY DEFINER-funktion verifierar auth.uid, aktiv profil och organisation i profil, fakturakoppling, billing item och bolagskoppling. Tabellen med interna billing-uppgifter öppnas inte. Anonyma saknar execute. Befintlig admin-/bolagsåtkomst och superadmin-gren bevaras. Funktion och policy uppdateras i en transaktion. QA-prov verifierar också inaktivering och återställer kontot i finally.

Inför en framtida godkänd release: migrationen förutsätter befintlig finance/Accounted-foundation men inga premiummigrationer för chatt, profilbild eller besiktning. Tillämpa före UI-versionen och ladda om PostgREST-schema om nödvändigt. Äldre klienter använder samma SELECT/API och behöver ingen ny parameter. Ingen produktionsmigration utförd och ingen färdig produktionsrelease deklarerad.

Tidigare arbetsorderkommentar-hotfix 20261009130000 och granskning av äldre profil-UPDATE-policy kvarstår som separata säkerhetsärenden. Ingen sådan rättning har applicerats i produktion i detta pass.

## QA-miljö, städning och begränsningar

Self-hosted isolerad QA, vihem_chat_qa, organisation VI-HEM Chat QA och syntetiska konton. Vite localhost:5176, QA gateway localhost:18880. Inga produktionsdata har skrivits.

QA:s Edge-router saknade avtalsadministration. Samma befintliga funktion aktiverades endast i QA med avgränsade list/get/create/update/save/preview-actions; workflow/public/utskick tilläts inte. Endast QA edge-container startades om.

Fakturaprovet använde ett avstängt syntetiskt bolag med https://qa.example.invalid och en tillfällig QA finance-modulrad. Inga externa Accounted-anrop gjordes. Temporära bolag/fakturor/billing-run/modulrader borttagna; Tenant QA är åter aktiv. Exakta skapade property/unit/offert/dokument/inköp/nyhetsprov rensade. Tillfälliga QA-sparfeltriggers borttagna. Oförändrade personalsparprov skapade QA:s standardschemarader 08–17; ingen roll eller autentisering ändrad. Inga stämplingar öppnades.

## Tester

| Kontroll | Resultat | Avgränsning |
|---|---|---|
| TypeScript | PASS | Hela appen |
| Vite build | PASS | Ingen deployment |
| ESLint | PASS med varningar | 0 errors, 85 warnings; inte varningsfritt |
| Mobilbundle | PASS | Båda ekonomi-/hyresmodulerna och Vibo-admin kvar; publik vibofast.se-kod ingår inte |
| Premium checks | PASS | Profilbildvalidering, separata dirty forms, rumsbedömning |
| Chat invariants | PASS | Meddelandeordning/dedup/läskvitton/reaktionsrace/filvalidering; pushprovider mockad |
| Rental pricing | PASS | Befintliga beräkningsinvarianter |
| Inventory invariants | PASS | Befintliga saldo/flytt/validering/tenant-invarianter; inget nytt lager-UI-prov |
| Installment invariants | PASS | Befintliga regler |
| Property/apartment QA API | PASS | CRUD och behörigheter enligt ovan, självrensande |
| Invoice ownership QA API | PASS | Egen/admin åtkomst och nekade interna/foreign/anon/inactive läsningar, självrensande |
| Browserflöden | PASS för angivna delprov | Inte full regression av samtliga moduler eller roller |
| Visuell QA | DELVIS | Autentiserade verkliga QA-vyer fotograferade 390/430/768/1024/1440, representativa mobil/iPad/desktopbilder granskade och justerade. Inte varje dialog/tillstånd individuellt granskad på alla fem bredder |
| Google Drive live | EJ KÖRT | Separat QA-Drive-root och verifierad autentisering saknas |
| Accounted PDF live | EJ KÖRT | Ingen extern QA-koppling; endast säkert PDF-fel/retry provat |
| Fysisk iPhone/Android | EJ KÖRT | Viewportsimulering bevisar inte tangentbord, kamera, safe areas eller native delning |
| Main testmerge/konfliktlösning | EJ KÖRT | Remote hämtad och premiumbranch kontrollerad; main inte sammanfogad |

Under implementationen upptäcktes och rättades JSX-/Tabs-typfel innan slutkontroller. Inga kvarvarande TypeScript-/lint-errors. En tillfällig QA-RPC-kontroll missade ny funktion före PostgREST schema reload; samma test passerade efter omladdning. CUA fill på native tidsfält ändrade DOM men inte React-state; det giltiga valideringsprovet utfördes med tangentbord.

App-chunk cirka 2685.75 kB (gzip 690.67 kB), HEIC-chunk cirka 1352.60 kB. Storleksvarning kvarstår; ingen uppmätt prestandaförbättring hävdas. Browserslist har en befintlig databasvarning.

## Återstående arbete och återupptagning

Ingen modul är Verifierad och klar enligt full DoD. Nio områden är implementerade men delvis verifierade, flera tidigare förbättrade moduler är under arbete, och många övriga är Ej påbörjad. Se det fullständiga modulregistret, inte bara denna sammanfattning.

Nästa oberoende etapp: hela schemavyn/frånvaro; ekonomi/Finance V2/hyror med välavgränsad syntetisk QA och fungerande testkoppling; därefter lager/inventarier/fordon/drift och övriga inventerade moduler. Parallellt färdigställ saknade fastighets-/hyresgäst-/avtalsdetaljer. De nya formulären räknas inte som full modulmodernisering.

Tidigare releaseblockerare kvar: verifierad riktig QA-Drive, full säker legacy-migrator/avstämning/gallring och gamla inspection-klienters skrivkompatibilitet. Staff- och tenantkontoskapande består delvis av flera backendoperationer och kräver separata atomiska förbättringar. Alla signerings-/ekonomiändringar kräver full säker verifiering före godkänd produktion.

Återuppta från premiumbranchens senaste kontrollpunkt. Hämta remote innan nästa pass/push. Main hade 2b935b7 vid senaste fetch i detta pass; inga antaganden om framtida konfliktfri merge. Arbetet fortsätter inte i bakgrunden när den aktiva sessionen avslutas.
