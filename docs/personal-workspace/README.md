# Min arbetsyta – implementation och granskning, 2026-10-25

Status: en sammanhängande implementation med verklig databas och testade huvudflöden. Hela beställningens acceptanslista är **inte** färdig. Driftsättning och push till main beställdes separat av användaren 2026-10-25; ursprunglig granskning var utan publicering. Utgångspunkt: origin/main 95c37d6, branch codex/personal-workspace.

## Implementerat

- Personlig arbetsyta i befintlig navigation för aktiv personal/admin/superadmin. Hyresgästportalen får ingen åtkomst. Tre paneler med storleksjustering, anpassad navigation på smala skärmar och helskärmsläge.
- Anteckningsböcker, mappar/undermappar, skapa/namnbyte/färg/flytt, drag-and-drop av anteckningar, anteckningsflytt via tangentbordsvänligt valfält. Favoriter, fästa anteckningar, arkiv, papperskorg och återställning av anteckningar. Etiketter och filtrering.
- Tiptap med rubriker, fet/kursiv/understruken/överstruken text, färg/markering, listor/checklistor, citat, kodblock, tabeller, länkar, bilder, avdelare och undo/redo. Block har stabila ID:n. HTML återges via editorschema, inte genom godtycklig HTML-injektion.
- Text, handskrift och kombinerade dokument. Handskriven sektion infogas utan att ersätta markerad text. Separata vektorstreck, tryck, utjämning, penna/överstrykning/suddning av hela streck, markera/flytta ett streck, linje, zoom, färg/tjocklek, sessionens undo/redo. A4-papper: blankt, linjerat, rutigt, prickat eller mörkt.
- Privat uppladdning av bilder/PDF/dokument/ljud med storleks- och MIME-gräns, signerad åtkomst, borttagning och bildblock. Binärfiler ligger i Storage.
- Svensk fulltextsökning i PostgreSQL. Sidindelade listor hämtar korta förhandsvisningar, inte dokumentens fulla innehåll. Pennstreck läses i sidor om 500 även över PostgRESTs 1 000-radsgräns.
- Lokal autosparning av text och streck, bakgrundssynk, revisionskontroll och konfliktkopior. Beständig texthistorik, högst 50 versioner. PDF via utskriftsdialog och portabel JSON med text och vektorstreck.
- Personliga påminnelser: idag/kommande/försenade/alla/avklarade, prioritet, redigering, snooze, slutförande, avbokning, dag/vecka/månad/valda veckodagar/anpassat dagintervall. En begränsad svensk datumtolkning visar tolkningen före sparning. Anteckningslänk och blocklänk från markerad text.
- Snabbanteckning från huvudgränssnittet, med sidkontext och privat sökvy för aktuell sida.

## Arkitektur och licenser

Modulen ligger isolerat i `src/modules/personal-workspace`: UI, editor, handwriting, reminders och services. Befintlig AuthContext, Layout, UI/Modal, semantiska färgtokens och navigering återanvänds. Editorn lazy-loadas med sidan.

Tiptap 3.32.0 (MIT), inklusive StarterKit, TaskList/TaskItem, Highlight, TextStyle/Color, TableKit och UniqueID. perfect-freehand 1.2.3 (MIT) skapar tryckkänsliga vektorkonturer. Testberoenden: fake-indexeddb 6.2.6 (Apache-2.0), esbuild 0.28.2 (MIT). Inget betalt AI-API eller kommersiell editor krävs.

Underlag: [Tiptaps dokumentation](https://tiptap.dev/docs/editor/getting-started/overview), [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent). Native PencilKit har inte införts: det gemensamma formatet är redigerbara koordinater/tryck i dokumentets koordinatsystem.

## Databas och säkerhet

Migrationerna körs i ordning:

1. `20261025100000_personal_workspace.sql`: grundmodell, ägarskap, RLS, RPC, sökindex, Storage och atomisk påminnelsedispatch.
2. `20261025101000_personal_workspace_hardening.sql`: restriktiv Storage-spärr, korta förhandsvisningar, validering av vektordata, lokal tidsankring för återkomst och underhåll.
3. `20261025102000_personal_workspace_push_retries.sql`: begränsade pushåterförsök via befintlig infrastruktur.
4. `20261025103000_personal_workspace_routing.sql`: privata, verifierade påminnelser får inte filtreras bort av organisationens allmänna notistilldelning. Övrig befintlig routing bevaras.

5. `20261025110000_personal_workspace_sharing.sql`: uttrycklig delning av anteckningar och mappträd, read/edit, medlemskap och återkallad åtkomst.

Tabeller med prefix `vihem_personal_`: collections, notes, revisions, mutations, ink_strokes, tags, note_tags, attachments, object_links, reminders, reminder_deliveries, shares. Alla personliga tabeller har ägar-RLS plus restriktiv kontroll av aktiv personalroll. Organisationstillhörighet ger ingen läsbehörighet i sig. Uttryckliga delningar kan ge läs-/redigeringsrätt inom samma organisation; personliga påminnelser, etiketter och historik delas aldrig. Sammansatta ägar-FK:n skyddar privata korsreferenser. Anteckningens mappreferens är enkel FK för att medlemmar ska kunna skapa egna anteckningar i delade mappar; RPC:n verifierar mappens redigeringsbehörighet vid skapande/flytt. Anteckningar/pennstreck/påminnelser skrivs genom ägarkontrollerade RPC:er med revisionskontroll. Privilegierade funktioner har explicit search_path, återkallad publik exekvering och snäva grants.

Privat bucket `vihem-personal`, sökväg `ägare/anteckning/fil`. Restriktiv policy skyddar även om andra moduler har breda permissiva Storage-policyer. 20 MB, explicit MIME-lista. Inga service role-nycklar i frontend. Lagringen är privat enligt API/RLS, inte end-to-end-krypterad gentemot databasens driftadministratör.

## Synkning och återställning

IndexedDB v2 har användarindexerade dokument och separata streck, inklusive migration av äldre lokala utkast. Varje skrivning inväntar transaktionens commit. Textmutationen får ett stabilt UUID, servern lagrar en liten idempotent ACK; ett tappat svar skapar inte en ny revision vid återförsök. ACK och senare lokala ändringar uppdateras atomiskt så att ett gammalt svar inte ersätter ny text.

Web Locks håller en skrivande flik per dokument i samma webbläsare. Andra flikar blir skrivskyddade. Äldre webbläsare utan Web Locks måste uppdateras; de får inte oskyddad redigering. På olika enheter används compare-and-swap: konflikt bevaras lokalt och användaren kan skapa en konfliktkopia. Olika streck-ID:n lagras oberoende; konflikt på samma streck hanteras utan tyst överskrivning. Det finns ingen samtidig realtidssammanslagning av text.

Vid utloggning tas ren cache för användaren bort. Osynkade utkast behålls för samma ägare så att data inte försvinner. De är inte lokalt krypterade; en delad dator kräver separat enhets-/webbläsarskydd. Appens befintliga autentisering måste kunna starta innan arbetsytan öppnas: **kallstart helt offline är inte löst**. Redan öppnat dokument fungerar utan nätverk. Metadata, bilagor och påminnelser kräver nätverk.

Texthistoriken innehåller dokument/block och referenser till handskrivna sidor, men återställer inte tidigare versioner av själva pennstrecken. Detta står uttryckligen i gränssnittet. Sessionens penn-undo/redo fungerar. Mutationkvitton gallras efter 90 dagar, texthistorik begränsas till 50 versioner. Inga anteckningar eller originalfiler raderas automatiskt av underhållsfunktionen.

## Påminnelser och drift

Europe/Stockholm används i UI; modellen lagrar UTC och IANA-tidszon. Vårens obefintliga klockslag avvisas, höstens dubbla klockslag väljer första förekomsten. Månatlig återkomst bevarar ursprunglig dag (31 januari → 28 februari → 31 mars). Nästa förekomst beräknas när uppgiften slutförs, utan obegränsat antal uppgiftskopior.

Serverfunktionen låser förfallna rader med SKIP LOCKED. Befintlig `vihem_notifications` och eget leveranskvitto skapas i samma transaktion; fel rullar tillbaka båda. Unikt påminnelse-ID + förfallotid förhindrar dubbel in-app-notis. Ett borttaget notismeddelande raderar inte kvittot. Papperskorg, avbokning, slutförande och inaktiv ägare spärras.

Befintlig delad pushfunktion och dess per-enhetsledger återanvänds. Ny helper i `supabase/functions/_shared/personal-reminder-push.ts` kontrollerar ägare, aktuell förekomst och status igen före utskick; standardtexten på låsskärmen är neutral. Titel visas endast efter aktivt val per påminnelse. Deep link öppnar rätt privat påminnelse/anteckningsblock efter auth/RLS. Leverans till fysisk APNs/FCM och öppning från helt stängd native-app är inte verifierade.

Återförsök använder befintlig pushkonfiguration, högst fem försök med exponentiellt intervall. Leveranser med okänt eller pågående providerresultat upprepas inte blint, eftersom det kan skapa dubbletter; in-app-påminnelsen finns kvar. Sådana fall behöver driftgranskning. Databasens atomiska del kan återförsökas nästa minut.

### Förberedda driftsättningssteg – inte utförda

1. Ta och återläs en aktuell produktionsbackup i separat miljö. Kör migrationerna mot fullständig klon av verkligt schema; här användes isolerat testschema och faktisk befintlig routingmigration.
2. Installera fyra migrationer ovan med etablerad migreringsprocess. Kontrollera befintliga cron/pg_net/pushförutsättningar och att inga andra cronjobb redan kallar samma funktioner.
3. Driftsätt ändrad `vihem-send-push` tillsammans med delad helper. Använd befintliga serverhemligheter och delade pushinställningar, inga nya frontendhemligheter.
4. Aktivera först efter separat beställning följande jobb, exempel på SQL för driftansvarig:

```sql
SELECT cron.schedule('vihem-personal-reminders', '* * * * *',
  'SELECT public.vihem_personal_dispatch_reminders();');
SELECT cron.schedule('vihem-personal-push-retry', '* * * * *',
  'SELECT public.vihem_personal_retry_push();');
SELECT cron.schedule('vihem-personal-maintenance', '17 2 * * *',
  'SELECT public.vihem_personal_maintenance();');
```

5. Kontrollera `cron.job_run_details`, Edge-loggar och `vihem_push_deliveries`. Funktionerna saknar offentlig/användar-exekvering; schemalägg via ordinarie betrodd driftroll. Utan cron fungerar listor/sparning, men inget serverbaserat påminnelseutskick sker.
6. Verifiera riktiga privata filuppladdningar/signerade URL:er och push till två testpersoners enheter. Avbokning/snooze/utloggning får inte läcka innehåll. Kör sedan frontendbuild/deploy enligt VI-HEM:s ordinarie process. Backa frontend och pausa enbart dessa nya jobb vid fel; radera inte personliga data.

## Tester och verifiering

Automatiserade tester:

```sh
npm run test:workspace
npm run test:workspace:db
npm run typecheck
npx eslint src/modules/personal-workspace scripts/personal-workspace
npm run build
```

Databastestet skapar en **egen namngiven PostgreSQL 15-container**, aldrig en produktionsanslutning. Det avslutar med verkliga SQL-prov av ägarskap A/B/admin i samma/annan organisation, tenant/inaktiv användare, främmande nycklar, cykler, FTS, historik, revisionskonflikt, idempotenta ACK/streck, atomisk rollback, deduplicering, DST/månad/veckodagar/intervall, push-backoff och Storage trots bred annan policy. Skalsmoke: 1 200 dokument och 1 500 streck, inte ett löfte om fysisk iPad-prestanda.

`unit-test.mjs` provar tidslogik/tryckgeometri. `local-test.mjs` provar IndexedDB-migration, ägarisolering, hållbar kö, misslyckad skrivning och 20 ACK/redigeringsrace. `push-test.mjs` använder riktig lokal PostgREST och PostgreSQL: privat pushguard, redaktion, preview, avbokning/snooze/papperskorg/fel ägare, 1 501 streck i paginerade REST-svar och korta listförhandsvisningar. Inga riktiga externa push skickas.

Browser-QA har använt verklig modul och Layout mot lokal PostgreSQL/PostgREST, med uttrycklig utvecklingsfixture för auth (inte produktionsauth). Testat skapa/redigera, formatering, blandat dokument, ritning/sparning/återöppning, påminnelse från markerat block, påminnelsedialog och PDF genom Chromes verkliga utskriftsdialog. PDF renderades och granskades: text, fetstil, linjerat papper och vektorstreck på en A4-sida. Browserprov: REST avstängd → redigera/rita → återanslutning → sparat, även lokal återöppning av utkast efter avbrott. Kallstartens auth kräver däremot nätverk.

Visuellt granskade Chrome-vyer: desktop 1440/1660, mobil 390 och iPad stående 768. Liggande iPad, mörkt tema på fysisk enhet, verkligt touch/tangentbord/Apple Pencil, Capacitor och native-PDF behöver slutprov. Slutligt försök till 1024-viewport påverkade inte den avsedda Chrome-fliken och räknas därför inte som verifierat.

Regression: befintliga `test:chat`, `test:snow`, `test:resources` passerade. Full projektlint har sju befintliga fel i orörda filer (gavirserum/App, två Catalog, Id06Tab, kp-receipt-pdf, vihem-kp-worker, short-stay receipt). Se slutlig leveransrapport för aktuella kontrollresultat.

### Lokal browsermiljö

`npm run workspace:qa` är en separat localhost-bunden Vite-start (5187) med tydlig fixture. Den proxyar enbart till lokal PostgREST (55440). `qa/index.html` ingår inte i produktionsbyggets ingångar. Publicera aldrig QA-servern på nätet. Kör `database-test.py --fresh-test` först för schema/fixtures; skapa därefter separat lokalt Docker-nät och anslut testdatabasen, starta PostgREST med lokal JWT-hemlighet från qa/vite.config.ts, schema public och authenticatorrollen. För `push-test.mjs` behöver den lokala authenticatorrollen kunna SET ROLE service_role. Dessa är testinställningar, inte produktionsinstruktioner.

## Apple Pencil och kvarvarande arbete

Webbimplementationen använder Pointer Events, tryck/coalesced events när de finns, dokumentkoordinater och separata vektorstreck. Penna skriver, finger navigerar; fingerteckning är ett aktivt val. Palm rejection är begränsat till vad webbläsaren exponerar. **Ingen fysisk iPad eller Apple Pencil har testats.**

Återstår före hela originalbeställningens acceptans:

- Fysiska Pencil-/Safari-/Capacitorprov och fintrimning av latens/palm rejection. Grupp-lasso, geometriska former, favoritpennor, anpassad bakgrundsfärg, kontinuerligt papper och egen multitouch/pinchzoom finns inte.
- Beständig revisionshistorik för handskrift, full offline kallstart, offlinekö för metadata/filer/påminnelser och snabbanteckningars typade sidkopplingar; realtidsuppdatering mellan enheter.
- Komplett mapp-/bokpapperskorg, mappordning/drag-sortering, ikoner och sparade smarta vyer. Avancerade sökfilter/markerade sökutdrag och OCR är inte färdiga.
- Hela anteckningsböcker i export/import och portabelt paket med originalbilagor. JSON innehåller referenser, inte binärfiler. PDF visar infogade bilder och bilagornas namn; originalfiler bifogas inte.
- Automatisk städning av övergivna Storage-filer och beslutad gallring av papperskorg/bilagor. Ingen bakgrundsradering av användardata har införts.
- Full riktig Supabase Auth/Storage-provning mot komplett schemaklon, verklig pushleverans och kallstart-deep-links. Nuvarande lokala transporttest ersätter inte dessa.
- Belastningsprov på fysisk iPad med långa dokument, många mappar/bilder och tusentals pennstreck. Databasens skalsmoke räcker inte för det.

Inga visuella platshållarknappar för dessa saknade funktioner ska presenteras som fungerande. Modulen är ett underlag för granskning och riktad användartestning; den uppfyller ännu inte hela den fullständiga acceptanslistan.

### Exakt lokal REST-start efter databastest

Följande avser enbart testcontainern ovan och använder offentliga, disponibla testuppgifter. Kör inte mot produktionsdatabasen. Om namnen redan finns, kontrollera att etiketten `vihem.task=personal-workspace` stämmer; starta inte dubbla instanser.

```sh
docker network create vihem-personal-qa-net
docker network connect vihem-personal-qa-net vihem-personal-qa-test
docker exec -i vihem-personal-qa-test psql -U postgres -v ON_ERROR_STOP=1 -c "GRANT service_role TO authenticator; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;"
docker run -d --name vihem-personal-rest --label vihem.task=personal-workspace \
  --network vihem-personal-qa-net -p 127.0.0.1:55440:3000 \
  -e PGRST_DB_URI=postgres://authenticator:workspace-local-test-only@vihem-personal-qa-test:5432/postgres \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_SCHEMAS=public \
  -e PGRST_JWT_SECRET=workspace-local-test-secret-at-least-32-characters \
  public.ecr.aws/supabase/postgrest:v14.12
npm run workspace:qa
# I annan terminal:
node scripts/personal-workspace/push-test.mjs
```

Öppna `http://127.0.0.1:5187/scripts/personal-workspace/qa/index.html`. Auth är en fixture för Testperson A, backend är riktig lokal PostgreSQL/PostgREST. Stoppa bara dessa namngivna testtjänster efter testet; rör inte andra projekt eller Docker-volymer.

## Slutkontroll på leveransrevisionen

2026-10-25: `test:workspace`, färsk isolerad databaskörning inklusive små ACK-kvitton, REST/pushguard/pagination, riktad ESLint (0 fel, 0 varningar), typecheck och Vite-build PASS. Regressionerna chat/snow/resources PASS. Bygget varnar för stora JS-chunkar (arbetsytan cirka 539 kB/172 kB gzip, lazy-laddad) samt att en dynamisk import också används statiskt. Dessa är inte byggfel men ska följas vid prestandaprovet på iPad. Full lint stoppas av de sju tidigare nämnda befintliga felen i orörda filer. Remote main hämtades och var fortfarande 95c37d6; ingen merge har gjorts.

## Delning och installationsprov, 2026-10-25

Ägaren öppnar **Dela** vid anteckningen eller mappen/anteckningsboken och väljer aktiv kollega i samma organisation samt **Kan läsa** eller **Kan redigera**. Mappdelning gäller rekursivt och för nya anteckningar. Redigerare får skapa egna anteckningar i en skrivbar mapp; författaren äger anteckningen, medan mappens delning ger övriga medlemmar åtkomst. Flytt av en egen anteckning till en delad mapp innebär därför uttrycklig delning. Bara anteckningsägaren organiserar/raderar dokumentet och laddar upp/tar bort dess bilagor. En direkt delning visar inte föräldramappar eller syskon. `Delat med mig` visar mottagna anteckningar.

Backend kontrollerar rättigheten vid varje läsning/skrivning, även ett idempotent återförsök. Mottagna dokument kräver nätverk för att öppna och redigera. Öppen vy kontrollerar åtkomst var tredje sekund; borttagen åtkomst döljer dokumentet och rensar dess lokala cache. Offline stoppar redigeringen. Redan visat/nedladdat innehåll kan inte göras oläst, och signerade länkar kan vara giltiga till sin utgång (bilder upp till 15 minuter). Delning ska därför användas för avsedda mottagare; den är ingen DRM-lösning. Vid samtidig textredigering finns revisionskonflikt och konfliktkopia, inte realtidsmerge.

Delning testad mot riktig isolerad PostgreSQL: läs/edit, privata syskon, privata påminnelser och historia, skydd mot självförhöjning av ACL, arv till barn/nya anteckningar, skapande av medlemsägd anteckning, vektorändringar, bilagor, återkallad rättighet och organisationsbyte. Browserprov av mapp-/anteckningsdialogens sparning och borttagning av åtkomst PASS. Mobil 390×844 och liggande surfplatta 1024×768 visuellt granskade.

Färsk serverbackup återlästes i separat, nätverksisolerad PostgreSQL 15.8-container med samma image som produktion och avstängda cronjobb. Ägare och ACL återställdes; endast en befintlig GraphQL-ACL för en saknad extensionsfunktion uteslöts från återläsningslistan. Den berör inte arbetsytan och produktionens GraphQL har inte ändrats. Alla fem arbetsytemigrationer installerades därefter i klonen. Ett transaktionellt prov med riktiga profil-/organisationsstrukturer verifierade privat åtkomst, läs/edit/återkallande och privat historik och rullades tillbaka.

Routingmigrationen behöver köras med `supabase_admin`, eftersom den ersätter en befintlig funktion som ägs av den rollen. Övriga migrationer körs med ordinarie `postgres`. Använd befintligt privat driftlösenord utan att skriva det i kod, logg eller frontend. Efter installation registreras filernas SHA256 i ordinarie applied-migrations.tsv, och bara de två ändrade Edge-filerna synkas med backup. Använd sedan befintlig lösenordsfri deploy_vihem.sh och verifiera HTTPS-version och assethashar.
