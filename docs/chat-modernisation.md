# VI-HEM – modernisering av chatt och kommunikation

## Leverans och driftsättning

Implementation på separat branch `codex/chat-modernisation`, uppdaterad mot Claudes senaste `main` (`b3d6430`) före publicering. Produktion har inte uppdaterats. Befintlig stack React/Vite, Capacitor och self-hosted Supabase används. Den separata Beds24-gästchatten, webbplatserna, tidrapporteringen och arbetsordrarnas kommentarer bevaras.

Detta är en kodleverans med verifierad backend och webbflöden. Oscar har nu godkänt att äldre mobilversioner får förlora chatten. Samordna därför nya webb/backend utan krav på att alla gamla appar uppdateras först. Fysisk iPhone-verifiering återstår. Android-push kräver separat Firebase-konfiguration och enhetstest. Ett kontrollerat manuellt releasepaket beskrivs i `docs/chat-release.md`.

## Nuläge som faktiskt verifierades

Samtliga nio rapporterade brister fanns i utgångsversionen: saknad meddelandeprenumeration, svag senaste-meddelandevy, global läsmarkering av egna chattnotiser, bortfiltrerade hyresgästgrupper, publik bildbucket, opaginerad historik, bristande skickningsstatus/felhantering, traditionell mobilvy och onödiga obligatoriska fält vid direktchatt.

Servergranskningen visade även att chattabellerna saknades i Realtime-publicationen och att den gamla `can_access_chat_thread` gav organisationens personal åtkomst till privata direkt- och gruppkonversationer utan deltagarskap. Produktionsinventeringen omfattade 12 konversationer, 59 meddelanden, 35 deltagare och fem äldre bilagereferenser. Ingen meddelandetext eller produktionsnyckel kopierades till testmiljön.

## Genomförda funktioner

- Riktiga Realtime-prenumerationer för meddelanden, konversationslistor, läsmarkeringar, reaktioner och aktivitet. Realtime autentiseras med aktuell användar-JWT före prenumeration. Återanslutning, återkomst från bakgrunden och periodisk kompletterande synkronisering hanterar missade händelser. Reaktioner uppdateras direkt från CDC; historiksynkronisering hämtar endast laddade meddelandens reaktioner i begränsade batchar och låter nyare realtidshändelser vinna över fördröjda svar. Kanaler stängs vid navigation och utloggning.
- Optimistisk skickning med klientgenererad UUID, hållbar lokal kö, skickar/skickat/läst/fel och återförsök. Databasen serialiserar skrivning per konversation och verifierar en oföränderlig begäranshash. Ett osäkert nätverksutfall eller återförsök efter redigering/radering skapar ingen ny rad. Bekräftelse från Realtime väger tyngre än ett senare transportfel i samma skickningsförsök. Levererat visas inte eftersom plattformen inte kan verifiera leverans till en mottagarenhet.
- Konversationslista med avatar/initialer/gruppbild, senaste meddelande, ”Du:”, tid, olästa antal, fästning, sökresultatutdrag och serverfiltrerade chips Alla/Olästa/Personal/Hyresgäster/Grupper/Arkiverade. Direktchatt kräver endast personval; atomisk skapande-RPC återanvänder samma direktdialog i organisationen.
- Helskärmskonversation på mobil, dold flytande navigation inne i dialogen, återställd navigation i listan, safe areas, VisualViewport-anpassning och textstorlek som undviker iPhones fältzoom. iPad och desktop har två kolumner. Blå egna bubblor, ljusa mottagna bubblor, datumavdelare, närliggande avsändargruppering och tangentbordsåtkomst till åtgärder.
- Per-mottagare läskvitton med `last_read_at`. Endast faktiskt synlig meddelandegräns markeras läst. Andra dialogers meddelanden och notiser påverkas inte. Navigationsbadge räknar faktisk chattstatus, även för äldre olästa meddelanden. Samtidiga badge-händelser samlas och fel i nätverket nollar inte ett tidigare verifierat antal.
- Tillfällig skrivindikator och verifierbar aktivitet i chatten med debounce och utgångstid. Användaren kan dölja sin aktivitet. Aktiviteten använder kortlivade RLS-kontrollerade rader i stället för Broadcast med kvarvarande kanalbehörighet efter borttagning. Ingen text som användaren håller på att skriva lagras där. Ingen påhittad ”senast aktiv” visas.
- Svar med referens och hopp till original, reaktioner 👍 ❤️ 😂 ✅, egen redigering/radering inom 15 minuter, redigeringsmarkering och soft-delete. Läsare kan visas i åtgärdsmenyn. Långtryck, horisontellt svarssvep och tillgänglig menyknapp. Kopiering och intern vidarebefordran av text finns; vidarebefordran är avsiktligt begränsad till personalkonversationer, och privata filer vidarebefordras inte.
- Privat uppladdning av bilder, PDF, Word/Excel, text, kort video och ljud. Filnamn, MIME, byte-signaturer och 50 MB-gräns valideras i backend. SVG, HTML och exekverbara format tillåts inte. HEIC konverteras till JPEG i en separat dynamiskt laddad modul. Stora bilder skalas ned när det är lämpligt. Bildvisare med zoom/nedladdning, dokumentkort och ljud/video med kontroller. Bilagor hämtas autentiserat först nära synligt område; blob-URL:er frigörs när de lämnar vyn och inte spelas upp.
- MediaRecorder-inspelning, stopp/avbryt, maximalt fem minuter och begripligt behörighetsfel. iOS mikrofonbeskrivning och Android mikrofonbehörigheter ingår. Ett inspelat meddelande granskas innan det skickas.
- Gruppnamn/bild, deltagarlista, tillägg/borttagning, lämna, individuellt tyst/omnämnanden/allt, arkivera, fäst och markera oläst. Personal kan skapa interna grupper. Hyresgäster kan endast delta efter uttrycklig inbjudan; deltagarskap får dem att se just den gruppen, inte andra hyresgäster eller grupper.
- @omnämnanden med deltagarval, strukturerade mottagar-ID:n, visuell markering och särskild notis. Befintliga globala notisinställningar återanvänds, med egna konversationsinställningar och möjlighet att tysta grupper.
- Arbetsorder- och projektkort som hämtar detaljer med befintlig RLS. Skapa arbetsorder från meddelande öppnar befintligt formulär för granskning med föreslagen beskrivning och kontext. Privat chattbilaga kan uttryckligen kopieras till separat privat arbetsorderlagring; arbetsorderbehörigheten styr den kopian. Misslyckad kopiering kan återförsökas utan att skapa ytterligare arbetsorder. Befintliga interna/kundsynliga kommentarer blandas inte in i chatten.
- Öppna/skapa relevanta grupper från arbetsorder, fastighet och kundprojekt. Flera fastighetsgrupper stöds; projektpersonal föreslås och granskas. Hyresgästprofil visar relevanta tillåtna dialoger och kan öppna/starta fastighetskontorets supportdialog. Gruppdeltagande ger ingen utökad åtkomst till underliggande verksamhetsdata.
- APNs-sändaren bevaras och har kollaps-ID och timeout. Android FCM HTTP v1 implementeras med servicekonto, tokenhantering och deeplänk. En service-only leveransjournal förhindrar parallella/dubbla sändningsförsök. Ett oklart leveransutfall återförsöks inte blint; det kan kräva administrativ kontroll för att undvika dubbel push.

## Säkerhet och databas

Sex additiva migrationer i `supabase/migrations/`:

| Migration | Innehåll |
| --- | --- |
| `20261009090000_chat_foundation.sql` | Kompletterande kolumner, deltagarskap/organisations-RLS, atomiska create/send/read, inbox/historik, cursor- och trigramindex, Realtime-publication, notisrouting. |
| `20261009091000_chat_actions_groups.sql` | Reaktioner, ägarskap/tidsgränser, grupper, deltagarinställningar, aktivitet/TTL och integritetsval. |
| `20261009092000_chat_private_storage.sql` | Privat chattbucket och konversationsstyrd läsning. Endast validerad serveruppladdning tillåts. |
| `20261009093000_chat_workorder_files.sql` | Privat lagring och metadata för granskade arbetsorderkopior. |
| `20261009094000_chat_legacy_cutover.sql` | Inaktiv service-only funktion för kontrollerad migrering av äldre filreferenser. Stänger inte publik lagring när migrationen installeras. |
| `20261009095000_chat_push_dedup.sql` | Service-only leveransjournal och atomisk push-claim. |

Alla nya mutationer har backendkontroll. Privata direkt-/gruppdialoger kräver medlemskap i samma organisation, även för administratörer. Fastighetskontorets befintliga personalåtkomst till supportdialoger bevaras. Borttagna deltagare får endast läsa sin egen tidigare deltagarrad för att kunna motta åtkomstindragningen i realtid; de kan inte läsa meddelanden/filer genom den regeln. Säker grupphantering tillåter uttryckligen inbjudna hyresgäster utan generell åtkomst.

Äldre meddelanden/ID:n och konversationer tas inte bort. Skapare, tilldelad personal och supporthyresgäst får uttryckliga befintliga deltagarrelationer. Den tidigare generella personalinsynen i privata dialoger stramas medvetet åt enligt uppdragets säkerhetskrav. En organisationsadministratör ska inte förvänta sig generell insyn i alla privata personaldialoger efter uppgraderingen.

`migrate-chat-attachments.mjs` inventerar som standard utan mutation. `--apply` kopierar gamla filer, jämför SHA-256 av både original och privat kopia, skriver skyddad referensbackup och byter referenser atomiskt först när samtliga är verifierade. Originalfiler raderas inte. Ändrad referens/okänd URL/saknad kopia stoppar migreringen. Publik åtkomst avvecklas först vid denna separata godkända körning.

## Ändrade komponenter

`ChatPage.tsx` är uppdelad i logiska komponenter i `src/components/chat/` och återanvänder projektets UI-komponenter. Tillstånd/realtid finns i `useChat`, aktivitet i `useChatActivity`, sammansatta utkast i `useChatComposerDraft`. Datatyper och testbara hjälpfunktioner ligger i `chatCore.ts`, RPC-anrop i `chat.ts`, mediahantering i `chatMedia.ts`.

`App.tsx`, `Layout.tsx`, `AuthContext.tsx` och `index.css` hanterar deeplänkar, faktisk badge, korrekt Realtime-auth och mobilutrymme. Detaljvyer i `WorkOrdersPage`, `CustomerProjectsPage`, `AdminPropertiesPage` och `AdminTenantsPage` har kontextlänkar. Nya edgefunktioner: `vihem-chat-upload` och `vihem-chat-to-workorder`; `_shared/chat-files.ts`, `_shared/fcm.ts`, APNs och `vihem-send-push` kompletteras. Capacitor-paket och Xcode-projektstrukturen har inte skrivits om.

## Verifiering

En isolerad self-hosted QA-stack byggdes med samma versioner som produktion: PostgreSQL 15, Realtime 2.76.5, Auth 2.186.0, Storage 1.48.26 och REST 14.8. Schema kopierades utan produktionsdata. Under 110-meddelandesbursten hittades den befintliga Realtime-gränsen på 100 händelser/s; QA-gränsen höjdes till 1000 och just den QA-tjänsten startades om inför de avslutande belastnings-/återanslutningskontrollerna. Produktion har fortfarande 100 händelser/s, 200 samtidiga användare och 100 kanaler per klient. Sex syntetiska konton i två organisationer användes. Externa e-post-/push-/webhookutskick var avstängda i QA. Enbart lokala chattnotiser var aktiva.

Godkända automatiska kontroller:

- TypeScript och Vite produktionsbygge.
- ESLint för nya chattkomponenter/hooks/bibliotek och `ChatPage`, utan fel eller varningar.
- Deno typecheck för båda nya edgefunktionerna och pushsändaren.
- `npm run test:chat`: kronologisk sammanslagning/deduplicering, per-mottagare kvitton, separata utkast, filtyper/gränser och serversignaturer. FCM OAuth/signering/deeplänk/tag/ogiltig token verifierade mot mockad provider. Fördröjda reaktionssvar testas så att nyare tillägg/borttagningar via realtid bevaras. PostgreSQLs mikrosekunder bevaras vid sortering och läskvitton för samtidiga meddelanden.
- `npm run test:chat:integration` i isolerad QA: faktiska JWT/RLS, samtidiga meddelanden, Realtime, läsmarkering per dialog, redigering/radering/återförsök, gruppinbjudan/borttagning, explicit flerhyresgästgrupp, organisationsisolering, omnämnanden/notiser, bilagevalidering genom riktiga edgefunktioner, privat filåtkomst, arbetsorderkopiering, projekt/fastighetskontext och verksamhetsisolering.
- Transportfel simulerat efter att servern sparat meddelandet: samma UUID gav en rad och en notis efter återförsök. 110 parallella meddelanden och två separata 50-meddelandesidor gav 100 unika rader.
- Stängd Realtime-anslutning, hämtning av missad historik och ny riktig prenumeration efter återanslutning verifierade. SDK:s korta asynkrona socketstängning hanteras vid ny prenumeration.
- Parallella push-claims gav exakt ett tillåtet försök. Definitivt fel kunde återförsökas, oklart leveransutfall kunde inte det.
- Fullt migreringstest av syntetisk gammal publik bild: bytes/hash/private referens bevarades, obehörig åtkomst nekades, publik URL stängdes och originalfilen fanns kvar.
- Samtliga sex migrationer kompilerades och kritiska RPC/RLS-flöden kördes i en rollback-transaktion mot aktuellt produktionsschema. Originalmeddelandenas ID, innehåll, avsändare, tider och gamla URL:er jämfördes inom testet och var oförändrade. Transaktionen rullades tillbaka; inga testnotiser skickades externt.
- Befintliga tester för hyror, lager, Skatteverket, avbetalningsplaner och mobilbundle godkända. Mobilbundlekontrollen verifierar även att Vibo-administration följer med men den publika Vibo-webbplatsen inte gör det.

Webbläsarverifiering med två separata användarsessioner: Oscar QA skickade, Christofer QA såg och svarade utan omladdning, Oscar såg svar och läststatus. Svar på specifikt meddelande verifierades genom UI. 390×844 mobil, 768×1024 iPad och 1440×900 desktop granskades med faktiska DOM-mått och screenshots. Ingen sidledsöverströmning; mobilens kompositör låg inom viewport och flytande navigation doldes/återkom korrekt. Detta verifierar responsiv webb, inte fysisk mobilkeyboard eller native push.

Byggets befintliga stora App-bundle och Browserslist-varning kvarstår. HEIC-konverteraren är en stor separat chunk som endast laddas när den behövs. Ingen generell omskrivning av hela appens bundling gjordes.

## Kvarvarande fysisk och operativ kontroll

APNs-konfigurationens nyckel-, team-, topic- och miljöfält finns på servern, men en riktig iPhone-push har inte skickats/verifierats. Android saknar observerad serverkonfiguration för FCM och repo saknar `android/app/google-services.json`. Lägg till rätt Firebase-appkonfiguration och `FCM_SERVICE_ACCOUNT_JSON` i serverns hemligheter; verifiera rätt application ID och registrerade enhetstoken. Logga aldrig dessa hemligheter i deployutdata.

Innan produktion ska två fysiska enheter testa APNs/FCM, bakgrund/foreground, notistryck till exakt konversation/meddelande, tangentbord/safe areas, röstbehörighet/inspelning och aktuella Safari/Android WebView-versioner. Testa även en verklig HEIC från iPhone; konverteringskoden är implementerad, men en fysisk iPhone-HEIC och mikrofon har inte verifierats här. Kamera-/filval kan fungera olika i äldre appversioner. Ingen leveransstatus ”levererat” utlovas. Webbläsarens filväljare kunde inte automatiseras i den här datorns session; riktig uppladdning och nedladdning verifierades genom edge-/Storage-API i QA, medan OS-filval och bildvisarens fullständiga användarflöde ingår i manuell releasekontroll.

Regressionerna är automatiska invariants-/bundlekontroller och granskning av ändrade integrationspunkter; de utgör inte en fullständig fysisk end-to-end-körning av varje gammal VI-HEM-modul. Slutlig stagingkontroll av arbetsordrar inklusive befintliga kommentarssynligheter, stämpling, tenantportal, kundprojekt och övriga notiser ingår i releasekontrollen.

Utkast/utgående kö lagras lokalt separat per organisation/användare/dialog och rensas vid utloggning. Osända bilagor som användaren uttryckligen tar bort kan städas genom edgefunktionen; ingen automatisk destruktiv rensning av äldre filer införs. Närvaron avser konstaterad aktivitet i chatten. Videofiler begränsas i storlek, inte genom en verifierad maxlängd på servern.

## Manuell produktionssättning

1. Hämta senaste `main` och kontrollera parallella ändringar före merge. Ta och verifiera databasbackup, Storage-backup och aktuell filreferensinventering. Notera tråd-/meddelande-/deltagarantal och nuvarande RLS/publication. Förbered samordnad webb/native release och minsta tillåtna klientversion.
2. Testa exakt sammanslagen commit på staging. Kör alla ovanstående kontroller och fysisk testmatris. Nya migrationer ska köras i angiven ordning och registreras i projektets befintliga migrationsledger; kopiera inte schema från QA.
3. Deploya `vihem-chat-upload`, `vihem-chat-to-workorder`, `vihem-send-push` och deras ändrade delade filer. **Ersätt inte hela serverns `_shared`-mapp**: andra appar använder samma Supabase och deras filer måste bevaras. Båda nya funktionerna verifierar JWT själva via befintlig `vihem-auth`; konfigurationen avspeglas i `supabase/config.toml`.
4. Kör de sex additiva migrationerna med kontrollerad underhålls-/klientversionsplan. De kompletterar befintlig Realtime-publication och ersätter endast chattens behörighetspolicyer. Kontrollera att WebSocket-proxy och Realtime faktiskt når public-tabellerna med användar-JWT. Kontrollera `_realtime.tenants.max_events_per_second` (nu 100 i produktion) mot förväntad last; den gränsen gav `MessagePerSecondRateLimitReached` vid QA-bursten. Belastningstesta exempelvis 1000 som i avslutande QA, och välj därefter en gräns utifrån serverns resurser. Inställningen gäller den delade Supabase-miljön och påverkar även andra appar; samordna och övervaka ändringen. Kontrollera även samtidiga användare (nu 200). Uppdatera PostgREST schema-cache enligt befintlig serverrutin. Inga andra appar eller databaser ska återställas/ersättas.
5. Rulla ut den nya webb- och godkända nativeklienten samordnat. Kontrollera riktiga tvåkontoflöden, behörigheter, badge och befintliga moduler. Begränsa underhållsperioden så gamla klienter inte får missvisande generiska sparfel.
6. Kör först read-only `scripts/migrate-chat-attachments.mjs` med serverns egna `SUPABASE_URL` och servicekey via skyddad miljö. När nya klienter använder autentiserad filhämtning, kör separat `--apply` med `CHAT_MIGRATION_BACKUP` till en skyddad ny fil. Verktyget stoppar vid en enda overifierad fil och raderar inte original. Kontrollera samtliga fem aktuella äldre referenser, privat läsning som rätt deltagare och nekad läsning som fel organisation innan avslut.
7. Aktivera/verifiera FCM först när rätt hemligheter och Android-appkonfiguration finns. Testa APNs i rätt sandbox/production-miljö. Följ leveransjournalens failed/unknown; återställ inte unknown utan att kontrollera providerutfallet.

Rollback efter databasförändringar kräver en plan för klienternas RPC/skrivmodell. Rulla inte tillbaka enbart frontend till en version som använder de gamla direkta writes. Återställ inte publik filåtkomst som rutinmässig rollback. Bevara säker backup och tillåtna filreferenser.

Ingen automatisk produktionsdeployment, merge till main eller verklig användarkommunikation har genomförts för detta uppdrag.

## Återkörning av integrationstest

`npm run test:chat:integration` kräver `CHAT_QA_CONFIG` som pekar på en lokal skyddad JSON-fil för en separat QA-instans. Filen innehåller `url` (endast localhost tillåts), QA-nycklarna `anon`/`service`, `user_password`, organisationerna `org`/`other_org` och `users` med `oscar`, `christofer`, `other_staff`, `tenant`, `tenant_two`, `outsider` (varje objekt har `id`/`email`). Organisationen måste heta exakt `VI-HEM Chat QA`. Oscar är admin, Christofer/other_staff personal, tenant/tenant_two hyresgäster; outsider är admin i den andra organisationen. Aktivera projektmodulen för QA-organisationen. Schema och alla sex migrationer samt båda fil-edgefunktionerna ska finnas. Externa notifierings-/mail-/webhooktriggers ska vara avstängda; chattens lokala notistrigger ska vara aktiv. Kör aldrig detta mot produktionsdata. Ingen QA-hemlighet ligger i Git.

Integrationstestet skapar syntetiska grupper/meddelanden/objekt och testar även en riktig legacy-cutover i sin isolerade lagring. Använd en engångsinstans eller återställ endast den namngivna QA-instansen efter testet. Den skapade QA-stacken har stoppats efter verifieringen; testdata/volymer hålls separerade från produktion och kan användas för återkörning.

## Publicering

Koden är pushad till `codex/chat-modernisation`, med `main` oförändrad. Granska jämförelsen: https://github.com/oscarlindahlvibo/vi-hem/compare/main...codex/chat-modernisation . GitHub-integrationen nekade automatiskt skapande av pull request med HTTP 403 (`Resource not accessible by integration`). Ingen pull request har därför skapats genom verktyget; jämförelsen kan användas för att skapa en manuellt. Detta påverkar inte den pushade kodleveransen.

## Komplettering inför release

Branchen uppdaterades mot Claudes `main` 2b935b7. Ett kallstartsfel verifierades: WebSocket kan bli SUBSCRIBED innan postgres_changes är redo. Både inbox och meddelandevy synkroniserar nu när CDC bekräftas redo. Testerna väntar på faktisk CDC-start och tolererar SDK:s återanslutning efter serverstart; ett tidigt omtest med 15 sekunders gräns misslyckades, efter serverinitiering gick hela integrationssviten igenom. Inga misslyckade testkörningar räknas som godkända.

Åtta automatiska tester verifierar releaseverktygets read-only-standard, rollback-repetition, paket/serverdrift, oväntade Realtime-värden, schema utan journal, konflikt i journalhash och återupptagning efter commit/ledger-avbrott. Det nya införandet prövar alla sex migrationer i en gemensam transaktion. Exakt installationspaket ska dessutom genomgå `--check` och `--rehearse` på servern före manuell publicering. Runtime/API-ändringen prövas endast i isolerad QA tills Oscar deployar.

Xcode byggde den nya iOS-appen framgångsrikt för iPhone 17 Pro-simulator (iOS 26.5); appen installerades och startades. Simulatorns interaktiva chatt-/tangentbordsprov blockerades av låst Mac och räknas inte som utfört. Ett syntetiskt APNs-prov via HTTP/2 med produktionskonfiguration fick HTTP 400 BadDeviceToken för en avsiktligt ogiltig token; ingen riktig användare kontaktades. Detta visar providerkontakt men bevisar inte leverans till en riktig telefon.
