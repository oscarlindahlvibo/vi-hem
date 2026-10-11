# Pass 13 – snabb, begränsad beta-release

Beslutskandidat, **ingen installation godkänd eller utförd**. Mainbas: `2b935b7`; premiumbas: `8f3a45b`. Alla 60 aktiva områden är individuellt implementerade; detta är inte full DoD eller generell slutverifiering. Finance/Finance V2 förblir pausade.

## Vad kan släppas nu?

Befintliga `app.vi-hem.se` kan uppdateras direkt efter godkännande. En ny omfattande stagingetapp behövs inte för denna begränsade beta. Isolerad QA finns redan, med riktig Auth/PostgREST/Storage/Realtime och utvalda riktiga Edge Functions. QA-webb är endast serverloopback:18881 via SSH; inga publika portar har öppnats. QA-router blockerar externa utskick/signering/betalning. Den routern ska **aldrig** installeras i befintlig beta.

Paketet innehåller **36 ordnade migrationer**, **15 ändrade backendfiler**, opt-in beta-frontend och en separat, tillfällig filsekretess-spärr. `scripts/beta-release/prepare.py` skapar SHA-256-manifest; inget apply-läge. Slutpaket kräver ren branch och frontend byggd från samma commit. Exakt fillista och ordning finns i manifestet.

Tre SQL-hotfixar installeras först: kommentarer `20261009130000`, registerläsning `20261011103000`, äldre lager-RPC `20261011143000`. Deras tidigare isolerade stagingprov återanvänds; main har inte ändrats. Fjärde hotfixen är `vihem-access-entries/index.ts`, utan premiummigrationsberoende. Riktiga negativa QA-API-prov repeterade PASS.

## Avsiktliga betabegränsningar

- Nya besiktningsbilder och slutprotokoll avstängda i frontend **och** arkiv-Edge. Textutkast/revisionskontroll fungerar. Drive-konfiguration saknas i QA: inget verkligt arkiveringsprov påstås.
- Accounted-PDF-hämtning avstängd i aktiva hyres-/hyresgästvyer; fakturauppgifter och ekonomiska beräkningar ändras inte. Verklig testbolagskoppling/PDF inte verifierad. Detta är en produktspärr, inte en ny Accounted-behörighetsmodell för gamla klienter.
- Fem äldre lagringsytor sätts privata och en restriktiv Storage-policy stoppar normala klienters läsning, signerade länkar, uppladdning och radering: chat-attachments, inspection-photos, work-order-attachments, fleet-images, fleet-documents (alla med vihem-prefix).
- **40 befintliga filobjekt** i dessa ytor bevaras, liksom databasreferenserna. Gamla bilagor/foton blir tillfälligt otillgängliga i appen tills behörighetskontrollerad visning/migrering är klar. Ny arbetsorder-/fordonsuppladdning spärras. Nya privata chattbilagor och privata chattfiler kopplade till arbetsorder berörs inte.
- Publika webbplatsbilder, privat avtals-/dokumentlagring och andra appar lämnas utanför filspärren. Ingen riktig fil flyttas eller raderas av releasen.
- Äldre installerade appar kan förlora chatt- och besiktningsskrivning; nya RPC-grindar och filspärren kan inte kringgås av en gammal klient. Hänvisa betatestare till uppdaterad webbversion. Ingen ny native-app publiceras. Fysiska enheter/push/kamera och verklig BankID inte slutverifierade.

Denna release är alltså **begränsad beta**, inte obegränsad lansering av alla nya fil-/integrationsfunktioner. Om tillfälligt låsta gamla bilagor inte accepteras måste deras privata visning/migrering färdigställas först. Det är ett uttryckligt godkännandebeslut.

## Backup och återställning – faktiskt prov

Shared-backup `20261011T062001Z`: databas + storage/config. SHA-256 och gzip PASS. Nätverkslös engångscontainer, samma Supabase PG15-image: **67 fysiska filer**, 67 Storage-objekt, 16 dokumentposter, 70 Auth-användare återställda. Alla 36 migrationer + filspärren passerar på kopian; antal befintliga poster och hash för övriga publika appars data oförändrade. Kopian förstörs efter provet, originalbackup behålls. Backupen har 0 besiktningsrader; historiska besiktningsposter är därför inte bevisade av detta prov.

Återställningsproceduren behöver Supabase-anpassning: behåll bootstraproller, återställ deras originalinställningar/grants, återskapa originalets GraphQL-forwardingfunktion före dess ACL. Efter anpassningen **0 SQL-fel**; ingen generell ignoreringslista. `scripts/staging/restore-probe.py` dokumenterar/kör detta enbart i namngiven engångscontainer och extraherar endast Storage ur filarkivet. Det är inte ett live-restore-verktyg.

Återgång: spara befintligt webbinnehåll, Edge-filer/config och migrationsledger. Före commit rullas misslyckad SQL-transaktion tillbaka; redan genomförda additiva migrationer behålls och rättas framåt. Frontend kan återställas till föregående version med säkerhets- och filspärrar kvar (gamla funktioner kan då vara begränsade). **Ingen automatisk nedmigrering eller återöppning av publika privata filer.** Full shared-restore påverkar andra appar och är endast samordnad katastrofåterställning, inte förstahandsrollback.

## Installationsordning efter uttryckligt godkännande

1. Läs senaste main/ledger/security-preflight; stoppa vid oväntad schemadrift. Ta färsk databas-/fil-/konfigbackup och kontrollera checksummor. Spara tidigare frontend/Edge/policydefinitioner separat. Meddela betatestare om underhåll/funktionsbegränsningar.
2. Installera tre SQL-hotfixar, sedan resterande migrationer i manifestordning med ON_ERROR_STOP och rimlig lock-timeout. Registrera endast lyckade filer i befintlig ledger. Vid fel: exponera inte nya frontend; rätta eller håll VI-HEM stängt. Ingen återapplicering av gamla main-migrationer.
3. Installera filspärren efter migrationerna; verifiera privata bucketflaggor, anonym/inloggad/signed nekad, service recovery och oförändrade filantal. Kontrollera cachebeteende; spärren återkallar inte redan nedladdade/kopierade filer.
4. Kopiera endast manifestets VI-HEM-backendfiler. Sätt `VIHEM_BETA_RESTRICT_EXTERNAL=true` för arkivfunktionen via Edge-miljön. RPC/Edge och Realtime-publication före frontend. QA-router/nginx/credentials installeras inte.
5. Gemensamma Edge-tjänsten kan behöva återskapas för miljöflagga/kodcache. **Kort Edge-avbrott kan även märkas i andra appar.** Ingen annan app deployas; PostgreSQL/Storage/andra Supabase-stackar ska inte startas om. Kontrollera deras tillgänglighet efteråt. Om detta avbrott inte accepteras behövs ett separat driftsättningsupplägg.
6. Backend-smoke/negativa åtkomstprov med disponibla betafixturer. Kopiera nya webbassets före index, behåll gamla hashade assets och tidigare index; byt index sist. Ingen merge till main och inget server-checkout som kastar lokalt arbete.
7. Kontrollera inloggning, arbetsorder, klocka, chatt mellan två klienter, utkast, hyresportal och filspärrar. Kontrollera andra appar och loggar. Markera exakta installerade hashes/commit. Vid fel: stäng berörd funktion eller återställ frontend; bevara datan och säkerhetsrättningar.

## Kontroller detta pass

PASS: TypeScript, beta-/QA-build, mobilbundle, lint (0 errors/78 warnings), premium/chat/lager-invarianter; riktiga QA-prov för åtkomstkoder, klockövergångar, lagerrörelser, fastigheter och besiktningsrevisioner. Storage: fem ytor nekar publik/auth/signed hämtning medan service hämtar identiska syntetiska bytes. Arkivskrivning ger 503 utan nytt filjobb. Browser: riktig QA-inloggning, besiktningsutkast save/reload/återöppning och synlig beta-spärr; mobil/desktop. Testutkastet städas, inga teststämplingar lämnas öppna.

Kvar till full release: riktig QA-Drive och Accounted-PDF, äldre filers privata återöppning/migrering/avstämning, fysisk mobil/push/kamera, äldre klienters full matris, samlad riskbaserad regression och driftsättningsgodkännande. Dessa behöver inte blockera **ovan uttryckligen begränsade beta**. Ingen befintlig installation, produktionsdatabas, verklig fil eller main har ändrats.
