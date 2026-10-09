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
