# VI-HEM 3.0 – utvecklingskontrollpunkt 2026-10-09

**Uppdraget är pågående. Ingen hel modul är ännu godkänd enligt hela Definition of Done. Detta är inte en produktionsrelease.**

Arbetsbranch: `codex/vihem-3-premium`. Bas: chatt `1e6a561`, main `2b935b7`. Main kontrollerades med fetch under passet. Ingen produktionsdatabas, publicerad webbapp eller App Store-version har ändrats. Oscar sköter produktionsdeployment manuellt. Claude kan ändra main; fetch och granska igen innan nästa push/merge.

## Implementerat i detta pass

- Baslinjeinventering av 103 TSX-filer, 61 vy-/modulfiler, 55 switch-routeval och 2 595 kontroller/formulär/tabeller. Aktuell kod efter tillägg: 107 TSX  62 vy-/modulfiler  2 621 kontroller. Egna profilsidan ligger före switchen; routeantalet är därför inte en fullständig runtime-routeförteckning. Dialogsiffrorna avser referenser, inte unika dialoger. Baslinjen är bevarad.
- Centrala navy/blå/neutrala tokens, kontrollstorlekar, fokusmarkering och gemensamma fälttillstånd. Unika fält-ID:n, kopplade fel/hjälptexter, tangentbordsval i filter/segment och tangentbordsaktivering av klickbara Card.
- DialogSurface: portal, fokusfälla, fokusåterställning, inert bakgrund, endast översta Escape-dialogen, mobil bottom sheet, desktopdialog, fullscreen, separat toolbar och footer. Befintliga custom-overlays behöver fortfarande granskas individuellt.
- Egen profilsida för alla roller med bildval/kameraval, beskärning, zoom/pan, förhandsvisning, spara/ta bort samt befintliga säkerhetsinställningar. Serverkontrollerad privat JPEG-lagring, ägarvalidering och begränsad bildåtkomst. Gemensam Avatar med initialer, säker legacy-reserv och användar-/organisationsbunden cache.
- Delade arbetsorder/projekt visar svenska statusnamn och korrekt förhandsvisning även utan meddelandetext. Kortet återställs vid objektbyte och skiljer hämtningsfel från otillgängligt objekt.
- Chattlistan visar ett laddningstillstånd under initial hämtning och vid ändrade sökfilter, i stället för att blinka tom.
- Personbilder används nu i navigation, chatt, arbetsorderansvariga/kommentarer, personaladministration, tidsöversikt och projektdeltagare. Alla övriga avatarplatser är inte genomgångna.
- Kompaktare desktopmeny med profil/inställningar samlade; mobilens Mer använder gemensam dialog. Befintliga säkerhetsfunktioner nås från profilsidan.
- Startsidan: nollposter i uppmärksamhetslistan döljs och arbetsorderåtgärden öppnar arbetsordrar. Rollen, hela dashboardhierarkin och alla kort måste fortfarande gås igenom.
- Besiktning: Objekt/Rum/Sammanfattning, accordion för rum, de fyra befintliga skickvärdena, explicit markering av genomgång, progress, noteringar, rumskopplade bilder, namnbyte, bekräftad rumsborttagning och fast sparfooter. Dubbeltrycksskydd, bevarad form vid fel, separata feltexter för utkast/slutför och skydd för osparade ändringar. Ingen ny regel kräver samtliga rum markerade före slutför. Utkast och befintligt dokumentflöde bevaras.
- Chatt: balanserad läsbredd/två kolumner, mindre bubblor och diskretare åtgärder, profilbilder, tydligare tider, integrerad plusmeny för bilder/kamera/filer/arbetsorder/projekt, textarea som räknar om höjd när bredden ändras. Backendfunktionerna bevaras.
- Arbetsorderdetalj: beskrivning först, tomma objektuppgifter döljs, ansvariga i disclosure, metadata separat, gemensamma flikar och fast sparåtgärd när ändringar finns. Checklisteknappar har namn och touchytor. Samtidig status/tilldelning behåller båda uppdateringar. Öppning från chatt återupprepas inte efter varje listuppdatering.
- Autentisering: generationskontroll hindrar gamla profilsvar från att återställa föregående användare efter utloggning eller kontobyte.

## Databas och backend

1. `20261009120000_profile_photos.sql`: additiv avatar_path, privat vihem-profile-photos-bucket, bildåtkomst begränsad till egen profil/behörig personal/uttryckliga chattdeltagare, restriktiva Storage-policyer och ägarstyrd RPC. Legacy-avatar_url bevaras tills ägaren byter/tar bort bilden.
2. `vihem-profile-photo`: autentiserad Edge-funktion som normaliserad frontend-JPEG laddas upp genom. Filstorlek, JPEG-header, dimensioner och egen profilreferens kontrolleras; klienten får inte skriva direkt i bucketen.
3. `20261009130000_work_order_comment_isolation.sql`: QA-testet upptäckte att en äldre permissiv personalpolicy tillät en administratör i annan organisation att läsa arbetsorderkommentarer. En restriktiv policy kräver aktiv personal och åtkomst till arbetsordern genom befintlig arbetsorder-RLS. Hyresgäster nekades även före ändringen. Befintlig explicit superadminåtkomst bevaras. Inga kommentarposter ändras/raderas och ingen rättighet öppnas för hyresgäster.

4. `20261009131000_chat_link_previews.sql`: samma inboxbehörigheter/filter/paginering, men ett delat arbetsorder-/projektmeddelande utan brödtext har en korrekt förhandsvisning. Meddelandets lagrade innehåll ändras inte.

De tre nya migrationerna och profilfunktionen är tillämpade **enbart i isolerad QA**. Chattens tidigare releasepaket innehåller inte dessa tillägg och får inte beskrivas som ett VI-HEM 3.0-paket. Ta fram nytt granskat paket vid produktionssättning.

## Faktiskt genomförd verifiering

Isolerad self-hosted Supabase med syntetiska konton/data och avstängd extern dispatch. Inga produktionsmeddelanden har skickats.

| Prov | Resultat / faktisk omfattning |
|---|---|
| TypeScript | Godkänt efter ändringarna |
| Produktionsbygge | Godkänt; stor App-chunk kvarstår, cirka 2,65 MB / 677 kB gzip. HEIC-biblioteket laddas separat. Prestandafasen är inte klar |
| Mobilpaketkontroll | Godkänt; hyror, båda ekonomier och Vibo-admin finns; publik vibofast.se-kod ingår inte |
| Premiumenhetstest | Godkänt: JPEG-gränser/spoofing och oberoende register för osparade formulär |
| Profilintegration med verkliga JWT/Storage/Edge | Godkänt: egen uppladdning/borttagning, cross-org/anon nekas, personal/deltagare tillåts, borttaget medlemskap nekas, direkt mutation/annan ägare/aktivt innehåll nekas, profilidentitet oförändrad |
| Arbetsorderkommentarer med verkliga JWT | Godkänt efter migration: personalåtkomst kvar, tenant/anon/annan organisation/förfalskad avsändare nekas |
| Chattinvarianter | Godkänt: idempotens, mikrosekunder/ordning, receipts, drafts, filer, reaktionsrace, pushadapter. Providerdelen är mockad |
| Chattintegration | Senaste kompletta omkörning godkänd: realtid, samtidiga meddelanden, oläst isolering, grupper, filer, typing/reaktioner, reconnect, pushclaims och legacy-migrering. Föregående körning missade ett realtime-event vid återanslutning trots SUBSCRIBED. Den intermittenta återanslutningssituationen måste utredas/stresstestas före release; en omkörning är inte bevis på att den är löst |
| Befintliga hyres-/lager-/avbetalnings-/Skatteverksprov | Godkända; dessa är avgränsade automatiska kontroller, inte fullständig manuell modulregression |
| ESLint | Riktad kontroll av nya primitives, profil, hooks och chattkomponenter godkänd. Hela repositoryts lintstatus är inte certifierad |
| Besiktning via autentiserad UI | Utkast sparat/återöppnat med notering och genomgångsmarkering kvar. Rumsnamnsredigering, avbruten borttagning och nästlad Escape kontrollerade. Slutför gav completed-post med länkat inspection-dokument. Dokumentets PDF-utseende/signering är inte visuellt verifierat |
| Arbetsorder via UI | Delad arbetsorder öppnades från chatt. Status + ansvarig sparades, återöppnades och verifierades i API. Titel/beskrivning/fastighet ändrades i QA. Intern kommentar sparades och behörighetskontrollerades |
| Chatt via UI | Skicka, specifikt svar, reaktion, uppdaterad förhandsvisning, arbetsorderdelning före explicit Skicka, navigation till arbetsorder och utkast efter tillbaka/återöppning kontrollerade. Mobilnavigation återkommer på konversationslistan |
| Profil via UI | Admin och tenant når egen profil. Notisdialog öppnades från profil. Utloggning, kontobyte och utloggat läge efter omladdning kontrollerade. Gamla användarens avatar följde inte med till hyresgästen |
| Visuell QA | Profil, gruppchatt, besiktningsrum och arbetsorderdetalj skärmbildstagna i 390, 430, 768, 1024 och 1440 px. Ingen horisontell rotöverströmning i dessa prov. Mer/plusmeny i 390 px. Inte en certifiering av samtliga tillstånd eller fysisk tangentbordshantering |

## Begränsningar och exakt återstående arbete

- Browserextensionen tillåter inte lokala fil-URL:er för file chooser. Därför är själva browserflödet bildval → beskärning → uppladdning **inte end-to-end verifierat**, även om verklig Edge/Storage-uppladdning och bildåtkomst klarar API-tester. Aktivera "Allow access to file URLs" i ChatGPT-extensionens inställningar för detta prov. Kameran, HEIC på fysisk iPhone, mikrofon, haptik, iOS/Android-tangentbord och safe areas kräver riktiga enheter.
- Besiktningarnas gamla publika bildbucket har inte ändrats eller migrerats. Granska åtkomst/referenser och ta fram säker migrering innan modulen kan godkännas. Kamera/bilduppladdning, PDF/export/godkännande och befintliga signeringsflöden kräver mer verifiering.
- Profilbyte lämnar gamla, otillgängliga privata objekt i lagringen. Definiera och testa gallring utan att ta bort en fortfarande refererad bild.
- Avtal/BankID, båda ekonomier, hyresmodul, fordons-/lager-/drift-/dokumentmoduler och administrationsundersidor har inte fått individuell premiumgenomgång. Baslinjeinventering och gemensamma styles är inte modul-Done.
- Tidrapportering och projekt har bara vissa Avatar-ytor ändrade. Personalöversikten har även en kompakt inställningsdisclosure, tydligare personkort och namngivna redigeringsknappar; listan/inställningsöppning har visats i 390 och 1440 px. Skapa/redigera/behörigheter är inte end-to-end verifierade. Deras kompletta formulär/dialoger/tabeller och sparflöden är inte färdiga.
- Arbetsorderlistans tabellåtkomst med tangentbord, full ny-/redigeraform, bulk/svep/tid och alla laddnings-/feltillstånd kräver fortsatt granskning. Kommentarpolicyn ska också repeteras mot produktionslik datamängd och explicita specialroller.
- Riktig APNs/FCM-leverans, native pushnavigation, BankID-återkomst och fysisk appregression är inte verifierade i detta pass. Ingen plattform beskrivs som verifierad bara för att en adapter bygger.
- Flera custom-overlays, små textstilar och native confirmation återstår. Shared Modal kan göra externa popup-portaler inert; varje sådan integration måste testas.
- Startsidan behöver fortsatt informationsprioritering per roll och komprimering av tomma kort. Ingen heltäckande WCAG 2.2 AA- eller prestandacertifiering är gjord.

## Nästa kontrollpunkt

1. Läs PLAN, designsystem, denna fil och aktuell modulförteckning. Fetch/review main; behåll separat branch.
2. Läs security-and-realtime.md: observerat provfel reproducerat som socket/CDC-beredskapsgräns. Fortsätt verkliga browser-/native-avbrottsprov. Säkerhetshotfix för kommentarer rekommenderas separat, ännu inte applicerad i produktion.
3. Färdigställ profilbildens browsercrop och fysisk kamera/keyboard när miljön medger det. Kontrollera säkra referenser vid byte/removal.
4. Fortsätt etapp B/C: samtliga arbetsorderformulär och snabba åtgärder, rollanpassad startsida, tid/projekt samt besiktningars bilder/dokument/signering.
5. Arbeta därefter systematiskt genom varje kvarvarande modul i modulstatus.md. För varje viktig vy dokumentera de tio revisionsdimensionerna, funktioner/roller, fem bredder och faktisk screenshot-/fel-/tom-/laddningskontroll. Ge inte en modul status Klar genom en CSS-ändring.
6. Ta fram nytt releasepaket först efter dokumenterad QA, review och migrationsrepetition. Oscar deployar produktion.

Arbetet fortsätter inte automatiskt när en aktiv utvecklingssession avslutas. Denna kontrollpunkt beskriver hur nästa session återupptar det befintliga uppdraget utan att starta om eller tappa återstående scope.


## Kontrollpunkt 2 – fortsatt utveckling

Läs `security-and-realtime.md` för reproducerad återanslutningsdiagnostik och separat hotfixbedömning. Production metadata lästes under READ ONLY; inga produktionsdata eller policyer ändrades. Tolv rejoincykler och korrigerad full chattintegration passerade. Kommentarproven utökades med inaktiv profil och explicit global superadminåtkomst; båda passerade, QA-identitet återställdes.

Arbetsorder: ny/redigera har verksamhetssektioner, tvåkolumnsfält där det ryms och fasta footeråtgärder. Osparade ändringar följs i appens register och i gemensam discarddialog. Fält låses under sparning; edit/kommentar har samtidighetslås. Kommentar- och formulärfel behåller text; sparfeedback är explicit. Filval lägger till valda filer och kan nås med tangentbord. Privat chattfil behåller sitt befintliga återförsök på samma order. Tabelldetaljer kan öppnas via namngiven knapp med Enter. Kommentarutkast och intern/kundläge hålls per arbetsorder i minnet; UI-byte A → B → A verifierade att ett internt utkast inte flyttas till fel kund. Dessa utkast överlever inte omladdning/navigering till annan modul ännu.

Besiktningslista: laddningsfrågor kontrollerar Supabasefel, erbjuder återförsök och visar inte falskt tomt tillstånd. Sökning utan träff har egen text. Objekt visas primärt; normala skick/slutförstatus är diskreta. Kort används på mobil/iPad, tabell på större desktop, öppningsknappar är namngivna. Inget bild-/PDF-/signeringsflöde ändrades.

Faktisk visuell QA i detta pass: ny arbetsorder 390/768/1440, redigera 390/1440, besiktningslista 390/768/1440, sökning utan träff 390. Inte alla fem bredder/roller/tillstånd. Kontrollerat QA-sparfel (tillfällig QA-trigger, därefter borttagen), bevarad form och lyckat retry skapade exakt en order, redigering sparades och detail visade ny beskrivning. Discarddialog avbröts och uppgifter fanns kvar. Kommentarutkastets byte mellan två order verifierat i UI. Generella nya feltexter granskade i kod; full hämtfels-UI för besiktningar återstår. Inga bilagor/kamera/fysisk keyboard certifieras.

TypeScript, premiumenhetsprov, chattinvarianter, full chattintegration, utökad kommentarintegration och bygge/mobilpaketkontroll passerade. Stora App-/HEIC-chunks kvarstår. Ingen modul är fullständigt Klar. Tid/projekt/startsidor och hela övriga modullistan återstår enligt ursprunglig omfattning. Prioritera nästa operativa pass på kvarvarande arbetsorderprov, besiktningens bild-/dokumentåtkomst och tidrapporteringens spar-/stämpelflöden, därefter kundprojekt och rollstartsidor. Detta är en kontrollpunkt, inte slutleverans eller deploygodkännande.


## Kontrollpunkt 3 – tidrapportering, 2026-10-09

Samma premiumbranch, main/produktion oförändrade. Ingen modul förklaras Klar.

- Min tid visar aktivitet/dagens datum som standard, med explicit val att visa tomma dagar; kalendern kvar. Mobilverktygsraden och inaktiv stämpelklocka komprimerade efter bildgranskning.
- Manuell registrering, stämpling, dagskommentar och utstämpling väntar på faktisk mutation, låser dubbeltryck och behåller innehåll vid fel. Admins sparväg kontrollerar nu Supabase-fel före stängning (tidigare ignorerades dessa).
- Adminens egna och administrativt registrerade tidposter visar Spara som godkänd enligt befintlig affärsregel. Staffens utkast/granskningsväg kvar. Datumintervall och rastlängd valideras; manuell registrering har skydd för osparade ändringar.
- Aktiv stämpling och avslutande kommentar visar verklig arbetsordertitel. Timern uppdateras direkt vid jobbbyte. Dagsrader har större namngivna redigeringsåtgärder, läsbar flerradig kommentar och diskret faktisk status. Kalenderns månadspilar har namn; avslutad nollminuterspost visas inte längre felaktigt som Pågående.
- Den gemensamma dialogens fot följer dialogens hörnradie även på desktop/iPad; ingen ny dialogstil.

### Verkligt provat

Autentiserad Oscar QA/admin i isolerad Supabase: avsiktlig INSERT-trigger gav stämpelfel; val och kommentar kvar; trigger borttagen; återförsök skapade stämpling. Byt jobb mellan två QA-order bevarade föregående passkommentar i rätt rad; utstämpling stängde nya passet med rätt kommentar. Manuell 09–10/rast15 sparade en synlig godkänd 45min-post. Slut08 före start09 blockerade knappen med förklaring. Ändrad kommentar öppnade kasta-dialog vid Avbryt, Fortsätt redigera återöppnade formuläret, Kasta stängde det. Översikt och manuell dialog skärmbildsgranskade 390/768/1440; mobil därefter komprimerad och ny bild tagen. Inga öppna QA-stämplingar lämnades.

Browserverktygets fill på datetime-local skickade inte Reacts change-event; tangentbordsändring bekräftade värdet före sparning. Den begränsningen är inte ett påstående om en produktbugg. Fysisk datumväljare/tangentbord återstår.

### Ej färdigt och viktig teknisk risk

Jobbbyte/rast/återgång gör finishOpenEntries + INSERT i separata anrop. Utstämpling och dagskommentar sparas också separat. Vid fel efter första steget kan delvis sparad status uppstå. Ny UI-felhantering löser inte detta: transaktionell/idempotent RPC och offline-revision krävs. Ett lyckat online-adminprov ersätter inte personalens godkännandeflöde, frånvaro, nätverksavbrott, fysisk telefon eller säkerhetsmatris. Full modul-DoD kvar.


## Kontrollpunkt 4 – kundprojektets grundflöde, 2026-10-09

- Projektformulär grupperat i Projekt och kund, Planering, valbar Ekonomi/referenser samt personal med gemensamma avatarer. Fasta footeråtgärder, synligt sparfel vid knappen, låsta fält under sparning och skydd för osparade uppgifter. Ingen ny designfamilj.
- Laddfel i alla projektfrågor visas med återförsök. Filtertomhet skiljs från tom organisation och sökning. Nya projekt har en lugn text om ännu orapporterat arbete istället för sex stora nollkort. Aktivitetens befintliga statistik finns kvar. Statuskontroll är namngiven, låst under mutation och kontrollerar faktisk uppdaterad rad innan logg/fetch.
- Ny migration `20261009170000_atomic_customer_project_create.sql`: invoker-security RPC med befintlig RLS, aktiv admin/superadmin, egen organisation/kund, aktiv personal i samma organisation, datumkontroll. Projekt, unika deltagare/ledare och första historikpost skapas atomiskt. Klient-id + transaktionslås gör samtidiga återförsök idempotenta. UUID låses till ursprungligt skapande; återanvänt id uppdaterar inte innehåll. Ingen befintlig rad/behörighet ändras. Endast QA tillämpad. Frontend kräver denna RPC före användning; NOTIFY pgrst reload schema ingår.
- Befintliga separata offert-/fakturerings-/ÄTA-flöden är inte omskrivna eller DoD-godkända. Statusändring + aktivitetslogg är fortsatt två anrop. Inline Ny kund är en verklig separat kundpost även om projektutkast senare kastas, enligt befintligt flöde.

### Verifiering

RPC-integration med verkliga QA-JWT: två parallella likadana create gav en projektid, två unika deltagare, en historikpost. Triggerfel i deltagarinsert rullade tillbaka projekt/deltagare/logg till noll. Staff, tenant, annan organisations admin och anon nekades; främmande deltagare och omvända datum nekades. `scripts/premium/project-integration.mjs` PASS. För att upprepa: applicera QA-only `scripts/premium/project-rollback-fixture.sql`, kör med CHAT_QA_CONFIG, ta sedan bort trigger och funktion via QA-helper; aldrig produktion. Båda provens tillfälliga feltriggers borttagna.

Autentiserad browser: Parkgården Testkund QA skapades och valdes i projektutkast; texten kvar. Premiumprojekt QA med Oscar som ledare/Christofer som personal: kontrollerat tilldelningsfel bevarade form, DB-count=0; retry efter triggerborttagning skapade projekt och rätt personal. Sökning och Enter på kortet öppnade sparat projekt. Planerat val sparades och återlästes. Faktiska skärmbilder av nytt-formulär/detalj 390/768/1440 samt synligt sparfel390. Desktop-formulärbild visar planeringsdelen efter intern scroll, iPad/mobil visar början. Alla tillhörande ekonomiska undersidor, kamera/bilagor, staff UI och 430/1024 återstår.

QA-modulregistret var schema-klonat utan seed. Kundprojekt aktiverades i QA-registret för den syntetiska QA-organisationen; produktion orörd. Browser behövde logga in igen efter JWT-test, ordinarie inloggningsform användes.


## Kontrollpunkt 5 – rollanpassade startsidor, 2026-10-09

- Personal/admin: tydligare kompakt hero och genvägar, riktiga projekttotaler med separat begränsad förhandsvisning. Utkast/offert räknas inte som pågående projekt; aktiva projekt räknas inte som uppmärksamhetskrävande uppgifter. Tomma personal-/frånvaropaneler döljs. Arbetsorderrader är namngivna knappar med endast relevanta statusmarkeringar och verkliga datum. Två höjdanpassade kolumner från 768 px, utan nytt designsystem. Stale/unmount-guard och kontrollerade laddfel; realtime-refresh visar inte ny helsidesspinner.
- Hyresgäst: exakt antal egna öppna felanmälningar separat från tre förhandsvisningar. Påhittat månadsslutsdatum borttaget; fakturaaktiverad organisation får faktisk navigering till Mina fakturor. Ingen bostad visar — istället för påstådd nollhyra. Boendetjänster samlade med riktiga knappar, nyheter visas bara en gång, tom tvätt/nyheter komprimerade. Noll bokade tvätttider får ingen konkurrerande statistikpanel. Egen Avatar. Laddfel har återförsök och sena svar efter unmount ignoreras.
- Mobil screenshot visade brutet belopp/etiketter i små StatCard. Gemensam opt-in compactMobile staplar ikon och text på smal mobil, befintlig horisontell standard kvar för övriga användningar. Ny screenshot verifierar hela belopp och läsbara etiketter.

### Verkligt provat och begränsningar

Autentiserad admin och personal: tvåkolumnslayout och tilldelade order/projekt 390/768/1440. Personalens klick öppnade Ventilationskontroll QA med rätt detalj; native button Enter via browserverktyget gav inget synligt resultat och räknas därför inte som verifierad tangentbordsaktivering. Adminbilder är tidigare checkpoint före sista hero-/genvägsetikettförfiningen, personal768/1440 och tenant390/768/1440 är senaste layout.

Tenant QA: först ingen aktiv bostad (desktopbild före tomlägesförfining), därefter syntetisk QA-bostad 1001, hyra6200, fyra egna mottagna ärenden. Översikten visar antal4, tre ärendeförhandsvisningar, inga adminpaneler. Kontakta oss öppnar behörig chattlista, Boka tvätt öppnar rätt vy med verkligt Ingen tvättstuga-tomläge. Ingen produktion eller externa utskick påverkade. Sparning/signering/bokning utfördes inte från startsidan. Fakturaaktiverad variant, pending-avtal, faktisk tvättbokning, nyheter, kontrollerat laddfel, native/screen och 430/1024 återstår. Tenant-startsidan saknar fortfarande egen realtime-synk; inget löfte om sådan verifiering.

Efter senaste ändring: TypeScript, premiumtests (bildvalidering/osparade formulär), Vite build och mobil-bundleprov PASS. App-chunk ~2.66 MB / gzip680 kB och HEIC-chunk1.35 MB ger fortsatt storleksvarning. Ingen full system-/prestanda-/DoD-certifiering.


## Kontrollpunkt 6 – besiktningens sparning och sammanfattning, 2026-10-09

### Ändringar

Granskningen hittade ett verkligt delvis-sparningsproblem: inspection.status blev completed före genererat dokument och document_id-länk. Ny invoker-security RPC `vihem_save_inspection`, migration `20261009190000_atomic_inspection_save.sql`, sparar besiktning/protokoll/länk i en databastransaktion. Befintliga tabeller/RLS bevaras. Aktiv staff/admin/superadmin, egen organisation samt matchande fastighet/lägenhet/hyresavtal valideras. Ett befintligt protokoll måste tillhöra besiktningen; unrelated dokumentid avvisas. Frontend behåller UUID för nytt utkast och dokument vid återförsök; transaktionslås förhindrar två parallella nya rader. Det är idempotent skapande, inte en generell lösning på samtidiga redigerares konflikter. Migration tillämpad endast i QA och måste installeras innan denna frontend sätts i produktion.

Formulärets innehåll/steg låses under sparning/uppladdning. Objektval använder gemensamma Select. Sammanfattning visar objekt/typ/datum och informerar om ännu ej genomgångna rum. Detta skapar ingen ny obligatorisk affärsregel eller signeringsregel. Allmänna bilder får tydlig filknapp, namngivna öppna-/ta bort-åtgärder och läsbar storlekshjälp. Framgång ger gemensam toast. Privat bildlagring är fortfarande inte löst.

### Verklig QA

`scripts/premium/inspection-integration.mjs` PASS med riktiga JWT: parallellt utkast/retry en rad; dokument-triggerfel lämnar utkast utan protokoll; efterföljande inspection-triggerfel rullar även tillbaka redan infört dokument; completed/retry behåller samma protokoll; samma-org staff tillåts; tenant/anon/foreign admin nekas skapande; ogiltigt objekt och unrelated dokumentid nekas; saknad protokoll-URL nekas. Tenant behåller läsåtkomst till sin egen besiktning och sitt protokoll; foreign admin får noll dokumentrader. Fixture `scripts/premium/inspection-rollback-fixture.sql` är QA-only och måste appliceras före provet. Båda feltriggers/funktioner därefter borttagna.

Autentiserad Christofer/staff: byggnad/lägenhet/Tenant QA valdes, Hall bedömdes Dålig med notering, Rum genomgånget flyttade till Kök, utkast sparades och återöppnades med notering/progress kvar. Kontrollerat finaliseringsfel visade statiskt fel nära footer, alla formdata kvar; SQL bekräftade draft/document_id null och noll protokoll. Trigger borttagen, retry sparade completed+kopplat dokument för rätt tenant. Återöppning återläste notering/åtgärd. Andra Slutför sparade samma dokument och bekräftelsetoast; DB-count för UI-protokollet fortfarande1.

Faktiska rumbilder390/768; sammanfattning390/430/768/1024/1440 visuellt granskad, fel390 och sparbekräftelse390 dokumenterade. Fysisk telefon/tangentbord ej verifierat. Befintligt genererat PDF utan foton hämtades från QA, renderades med Poppler och granskades: rätt QA-objekt/hyresgäst/inspektör/rum/notering/åtgärd, läsligt och utan avklippning. PDF-layouten är fortfarande enkel och inte premium-godkänd; flera svenska fasta etiketter saknar diakritik, långt innehåll och foton kvar att förbättra/prova. PDF-skill användes för läsande renderkontroll.

Kamera/HEIC/filuppladdning (browserns filechooser-åtkomst är inte aktiverad), bildernas koppling och export, äldre publika referenser/privat bucket, full roll-/inaktiv-/konfliktmatris och signerings-/historikflöden återstår. Ingen modul är DoD-Klar.

## Kontrollpunkt 7 – 2026-10-10: första Drive-arkivflödet

Fortsätter från 1ab53b8 på samma premiumbranch. Nytt binärt archive Edge-flöde, gemensam Drive-auth, service-only jobb/lease/commit, privata stagingfiler, beständiga mappar och verifiering av metadata + hämtad SHA256. Nya protokoll får egna dokumentversioner; nya completed-inspektioner kräver verifierat protokoll. Frontend använder lokal kö, explicit progress/fel/retry och säkert filarkiv; äldre referenser läses fortfarande. PDF lazy-loadas och har 16-sidors syntetiskt prov med rumskopplade bilder och svenska tecken.

Se inspection-drive-architecture/migration/verification för faktisk status och öppna risker. Detta är en återupptagbar implementationskontrollpunkt, inte färdig Drive-del eller release. Riktig Drive, fysisk mobil, full migration, säker gallring/reconciliation, samtidiga draft-revisioner och hela testmatrisen återstår. Tid-RPC och övriga moduler är inte genomförda i denna kontrollpunkt. Main/produktion oförändrade. Separat arbetsorderkommentar-hotfix ska fortsatt godkännas och deployas fristående; den har inte tillämpats i produktion.

## Kontrollpunkt 8 – 2026-10-10: atomisk stämplingskedja

Ny självregistrerings-RPC med användarlås, förväntad öppen post, stabilt operations-ID, klienttid/servermottagning, validering före skrivning och atomiskt passbyte/kommentar/kvitto. Frontend behåller osäker operation med återförsök och serveravstämning. Pauser återgår till exakt pass via operationskvittot; projektets faktureringsscope bevaras.

Riktig QA-databas och staff-JWT: dubbelbegäran, konkurrerande jobbbyten, cross-user/target denial, rollback, rast/lunch/återgång/out, totalsummor, kommentar-isolering och idempotent dagskommentar PASS. Verkligt UI-flöde in/rast/återgång/out PASS; inga öppna QA-pass kvar. 390/430/768/1024/1440-bilder tagna, 390/1440 granskade. TypeScript/build/mobilbundle/premiumtests PASS. Full native-/offline-/admin-/midnattsmatris återstår. Se clock-transitions.md. Ingen ny modul DoD-Klar; main/produktion oförändrade.

## Kontrollpunkt 9 – arbetsordervyns klocka och slutkontroller

Även den gemensamma timeClock-hjälparen och arbetsordervyns utstämpling använder nu samma atomiska RPC och väntande konto-/organisationskö. Arbetsordervyns submitted-status och öppningskommentar bevaras i kompatibilitetsmigration 20261010140000. QA-databasprov för dessa egenskaper PASS. Arbetsordervyns hook-ordningsfel rättat; säkerhetsprov (staff/tenant/anonymous/foreign org/spoofing/inactive/explicit superadmin) repeterat PASS. Inget UI-prov av arbetsorderns specifika stämplingsknapp ännu. Ingen ny modul räknas Klar.

Full-repo lint körd: FAIL med kvarvarande fel utanför den nya archive-transporten. Transportens två nya lintfel rättade; ändrade komponenters avgränsade lint har inga errors men befintliga hook-varningar. Full lint-fel ska behandlas i nästa etapp, inte döljas bakom scope-lint.

Återuppta med draft-revisioner (samtidiga formulär kan fortfarande skriva över bilder), full äldre-fil-migrator, faktisk QA-Drive, avstämning/gallring och full besiktningsmatris. Därefter tidsroll-/offline-/midnattsprov och systematiska återstående moduler. Main och produktion oförändrade. Detta är ett implementationspass och verifierad kodkontrollpunkt, inte en deployklar premiumrelease.

## Kontrollpunkt 10 – besiktningsiteration 2 och revisionsskydd

Se inspection-iteration2.md för faktisk UX, bedömningsmetadata och historisk reservregel. Nya rums-ID:n skapas inte på återöppning. Ny revisions-RPC och serverguard hindrar stale innehåll/äldre direktklienter från att skriva över servern. Revisionsnummer utesluts ur PDF-snapshot. QA/JWT race, retry, legacy denial och stale fotoreferens PASS; arkivets ledgerprov PASS. Browser sparning/återöppning och tvåklientkonflikt med lokalt formval kvar PASS. Mobil helskärm opt-in via gemensam dialog. Full lint-errors nere från 3 till 0. Inte modul-Klar: foto/native/full migration/gallring/riktig QA-Drive och stabil slutlig screenshotserie kvar.

Slutkontroll för kontrollpunkt 10: stabil screenshotserie i fem bredder granskad, mobil scroll/fotoåtgärder och browser återöppning från konflikt → senaste servernotering → lyckad sparning PASS. PDF-provet har 16 visuellt granskade sidor; ensam bildsektionsrubrik rättad. TypeScript/build/mobilbundle/premiumtest/revisions- och arkiv-DB-prov PASS. Lint 0 errors / 89 warnings. Ny QA-only stagingavstämning med mocktester PASS; dry-run 27 jobb, inga filer raderade. Verktyget återverifierar permanenta bytes före eventuell tillfällig cleanup; full legacy-migrator och bred orphan-/retentionshantering är fortfarande INTE klara. Ingen riktig Drive-konfiguration i QA, inga produktionsoperationer.

Legacy-inventeringen utökad till nuvarande PDF-protokoll och paginerade register, med strikt källallowlist och begränsad PDF-byte/hashvalidering. QA 22 besiktningar/7 foto/14 protokoll, source-tests PASS. Inga Google-anrop/skrivningar. Full migrator och inventering av samtliga äldre dokumentversioner återstår; detta får inte beskrivas som färdig migrering.

## Kontrollpunkt 11A – Fastigheter och enheter, 2026-10-10

Utgångspunkt remote/local 09297b2 på codex/vihem-3-premium. Main och produktion orörda. Fastighetsöversikten visar faktisk beläggning, enhetsvyn kan sökas på nummer/hyresgäst och filtreras. Kontaktuppgifter är strukturerade fält med oförändrad lagringsmodell. Enhetsformuläret behåller teknik/åtkomst, med egna sektioner och fasta sparåtgärder. Sparning kontrollerar fel och returnerad rad, låser formulär vid pågående operation och skyddar osparade ändringar.

TypeScript PASS, riktad ESLint PASS. property-integration.mjs körd med CHAT_QA_CONFIG: admin skapar/ändrar QA-objekt, nycklar/nätverk/hyra återlästa, personal läser, hyresgäst/annan organisation nekas ändring och annan organisation nekas läsning. Testobjekt borttagna. Browser QA: tillfällig databastrigger avvisade fastighetssparning, formuläret behölls, avbryt varnade, återförsök efter borttagen trigger lyckades. QA-markör återställd; ingen trigger kvar. Enhet sparad och tom sök provad. Screenshots i outputs/vihem-3-premium-pass5; inget fysiskt nativeprov. Ny fastighet i UI begränsad av befintlig QA-kvot; ingen kvot ändrad. Ingen migration. Modulen är inte fullständigt verifierad.

## Kontrollpunkt 11B – Hyresgäster, 2026-10-10

Mobil har egna hyresgästrader med Avatar och aktuell bostad, desktop behåller tabell. Sökningen inkluderar telefon och statusfilter finns. Nytt konto har Kontakt/Boende, befintliga pris-/rabatt-/momsval bevarade. Kontaktredigering har fasta sparåtgärder och osparat-dialog. Laddfel syns med återförsök; UPDATE kräver returnerad rad för att inte rapportera noll uppdateringar som framgång.

QA admin öppnade profil, ändrade telefon lokalt, avbryt gav utkastvarning, fortsatte och återställde telefon innan sparning: toast och stängning verifierade. Ingen lösenords-/rolländring och inget konto skapades. Screenshots lista/profil fem bredder. TypeScript/riktad ESLint PASS. Konto+hyresförhållande är fortsatt ett äldre flerstegsflöde, ingen atomisk backend införd i detta designpass; nyregistrering/ekonomiflöden inte verifierade. Ingen migration/produktion.

## Kontrollpunkt 11C – Avtalsarkiv och generella utkast, 2026-10-10

Gemensamma filter, mobilarkivrader, tangentbordsåtkomlig dokumentöppning och ny utkastdialog. Avtal/Offert/Övrigt bevarade. Sökning debounce 250 ms och sekvenskontroll så gamla svar inte ersätter nya filterresultat. Backend, blockmodell och signeringsregler oförändrade.

QA router saknade vihem-agreements-admin (404 Unknown QA function). Kopierade samma admin-funktion och två rena databashelpers ENDAST till /var/tmp/vihem-chat-qa-20261008; QA-router tillåter list/get/create/update/save_blocks/save_parties/save_signers/save_entity_links/preview/list_entity_agreements/list_templates/get_template, övriga action nekas. Endast vihem-chat-qa-edge omstartad. Inget workflow/public/utskick aktiverat och produktion orörd.

Browser admin: skapade syntetisk serviceoffert, lade till och sparade rubrik med Å/ä, förhandsvisade och återgick till arkiv. Backend återläsning bekräftade offer/draft och innehåll. Personal får läsa, tenant och annan organisation nekas. Exakt QA-utkast borttaget efter verifiering, inga signaturer eller hyresförhållanden skapade. Screenshots arkiv/form 390/430/768/1024/1440. TypeScript/riktad lint PASS. Full avtalmodul inte klar: mallar, alla block/dialoger och signerade/publika flöden kvar.
