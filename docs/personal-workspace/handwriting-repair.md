# Handskrift – reparation 26 oktober 2026

Status: implementerad på `codex/handwriting-ipad`, utifrån `origin/main` `e734e48`. Redo för verklig iPad-testning, **inte slutligt godkänd för Apple Pencil/Scribble**. Ingen push, merge, produktionsmigration eller driftsättning i detta uppdrag.

## Bekräftade kodfel och vad som inte är bevisat

- Handskriftsvalet dolde textverktygen men lämnade Tiptap redigerbar. Dessutom fokuserade `insertInk` texteditorn. Pennytan låg inne i samma redigerbara DOM-träd. Detta var en konkret fokus-/inmatningskonflikt med handskrift, även om just iPadOS Scribble inte kan reproduceras på denna Mac.
- Zoom ändrade endast SVG-bredden. Det saknades dokumentkamera, ankarbaserad nypgest och konsekvent koordinattransformering.
- `pointercancel` anropade samma avslut som `pointerup` och kunde lagra ett avbrutet streck. Separat hantering av förlorad capture saknades.
- `touch-action: pan-x pan-y` överlät gester till webbläsaren samtidigt som pennskrivning pågick. Den nya modellen hanterar gester inom ritytan själv.
- Papperets avstånd var hårdkodat. SVG-pattern refererades med ett dokumentglobalt ID härlett ur pageId. Bakgrund och streck delade samma renderer. Den gamla lösningens linjeförsvinnande på fysisk iPad har **inte** reproducerats, och det är inte bevisat att en viss Safari-bugg var orsaken. Den nya bakgrunden tar bort pattern/URL-beroendet och isolerar pappersgeometrin från stroke-uppdateringar. Regressionstest kontrollerar att samma bakgrundsnod finns kvar genom hela skrivflödet. Fysisk verifiering återstår.
- Lägesbyte kunde följas av en editoruppdatering med föregående läge i callbacken. En aktuell mode-ref skyddar valet Handskrift vid insättning av första pennsidan.

## Arkitektur och ändrade filer

- `handwriting/InkPaper.tsx`: ny inmatnings-/gesthantering, lokal preview per animation frame, dokumentkamera, capture/cancel, palmprioritering och färdiga stroke-operationer.
- `handwriting/camera.ts`: zoom kring ankarpunkt, fingerpanorering, nypgest och invers faktisk SVG `getScreenCTM()`.
- `handwriting/interaction.ts`: testbar pointer-identitet, ritning, suddning, flytt och begränsad sessionshistorik.
- `handwriting/PaperBackground.tsx` och `paper.ts`: separat memoiserad SVG-bakgrund, validerade inställningar och äldre standardvärden.
- `handwriting/InkControls.tsx`: grupperade pennverktyg, tre favoritpennor, papperspanel och separata zoomkontroller.
- `editor/InkNode.tsx`: endast en icke redigerbar platshållare ligger i ProseMirror. Den riktiga ritkomponenten portaleras till en DOM-syskonvärd utanför `EditorContent`. ResizeObserver håller plats, bredd och position synkroniserade, utan dokumenttransaktioner för pennpunkter.
- `editor/RichEditor.tsx`, `commands.ts`: redigerbarhet/fokus skiljer text och handskrift åt; insättning av pennsida fokuserar inte texteditorn.
- `components/NoteEditor.tsx`, `workspace.css`: beständigt lägesval och skrivfokuserad helskärm med safe areas och kompakt titel/sparstatus.
- `services/export.ts`: monterar tillbaka portalens ritinnehåll i dokumentordningen och tar bort kamerazoom vid utskrift.
- `scripts/personal-workspace/handwriting-test.mjs`, `qa/ink.html`, `qa/ink-app.tsx`, `package.json`: automatiska domäntester och verkligt browser-/IndexedDB-prov.

Ingen ändring i databas, Storage, RLS, notissystem, Capacitor eller stroke-lagringens format. Inga nya bibliotek eller licenser.

## Scribble och lägen

Handskriftsläget gör själva texteditorn icke redigerbar och tar bort dess fokus. Ritytan har ingen `contenteditable=true`-förälder. I kombinerat läge stängs textinmatningen av redan när pennan går in över ritytan eller vid pointerdown där. Text kan sedan aktiveras genom tryck i textdelen eller den uttryckliga knappen **Textredigering**. Ritytan är fortsatt separat.

Det finns inget använt standard-API som säkert lovar att stänga av iPadOS Scribble i alla Safari-/WKWebView-versioner. Ingen global iPad-inställning krävs av implementationen, men frånvaron av tangentbord/Scribble måste verifieras på riktig iPad. Om iOS fortfarande behandlar ytan som text krävs riktad undersökning av native `UIScribbleInteractionDelegate` för WKWebView eller PencilKit; ingen sådan obeprövad native-brygga har lagts in. Det portabla vektorformatet behålls.

Referenser: [Apple UIScribbleInteractionDelegate](https://developer.apple.com/documentation/uikit/uiscribbleinteractiondelegate), [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events), [SVGGraphicsElement/getScreenCTM](https://developer.mozilla.org/en-US/docs/Web/API/SVGGraphicsElement), [Tiptap React NodeViews](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react).

## Dokumentkamera och inmatning

- Zoom 25–300 %, där den lägre gränsen även gör hela A4-sidan möjlig på mindre vyer. Reglage, 100 %, Anpassa bredd och Hela sidan.
- Kameran transformerar samma grupp för papper och pennstreck. Ingen lagrad stroke-koordinat ändras av zoom/pan.
- Nypgest bevarar dokumentpunkten mellan fingrarna; ett finger panorerar. Ctrl/Cmd + hjul zoomar kring muspekaren, vanligt hjul panorerar. `+`, `−`, `0` fungerar när ritytan har tangentbordsfokus.
- Mus ritar med valt verktyg; navigeringsverktyget panorerar. Finger ritar endast efter uttryckligt val i inställningarna.
- Aktiv penna prioriteras över tillkommande fingerkontakter. Det andra fingret avbryter eventuell fingerritning och startar nypgest.
- Coalesced events används när de finns. Tryckvärden bevaras; upplösning och zoom påverkar inte dokumentkoordinaterna. Preview uppdateras lokalt och färdiga stroke-operationer skickas till befintlig lagringskö.
- Pointercancel, förlorad capture, fönsterblur och bakgrundsläge avbryter ett ännu ofärdigt streck. Redan färdiga streck påverkas inte. En diskret förklaring visas vid avbrott. Detta är ett avsiktligt val, inte partiell autosparning av det avbrutna strecket.

## Pappersinställningar och bakåtkompatibilitet

`paper`, `spacing`, `lineColor` och `lineOpacity` lagras som attribut på det befintliga ink-blocket via vanlig autosparning, lokal IndexedDB och befintlig revisionskontroll/synkning. Ingen migration krävs. Saknade attribut ger linjerat 32, rutigt/prickat 24 dokumentenheter. Avstånd kan väljas 16–60; snabbval 24/32/48. Färg och styrka visas direkt. Mörkt papper har separat kontrasterande linjefärg.

Stroke-ID, pageId, punkter och tryckvärden ligger kvar oförändrade i den befintliga separata stroke-lagringen. Paper settings är oberoende av dessa. Gamla dokument behöver ingen manuell konvertering. Favoritpennor sparas lokalt per användare; inga anteckningstexter lagras i pennpreferensen. Kamera återställs vid ny öppning och är inte del av dokumentinnehållet.

## Faktiskt körda tester

26 oktober 2026, Chrome på Mac:

- `npm run typecheck`: PASS.
- `npm run test:workspace`: PASS, inklusive nya `test:workspace:ink`.
- `npm run test:workspace:db`: PASS mot isolerad PostgreSQL 15. Befintliga privata/delade RLS-, Storage-, stroke-CAS-/återförsöks- och notifieringsregressioner passerade. Ingen produktionsanslutning användes.
- Riktad ESLint för alla berörda TS/TSX/MJS-filer: PASS utan varningar.
- `npm run build`: PASS; befintliga varningar om Browserslist-data och stora chunks kvarstår.
- Hela `npm run lint`: 7 fel och 132 varningar i övriga kodbasen; inga fel i ändrade filer. Felen finns i en tidigare genererad Android native-bridge.js, de båda katalogvyerna, Id06Tab.tsx och tre befintliga Supabase-filer. Inga orelaterade lintfel har ändrats här.
- Browser-fixtur via riktig UI-knapp: PASS för pennpreview, kontinuerlig flerradig skrivning, stabil identisk bakgrundsnod, **noll Tiptap docChanged-transaktioner under pennhändelser**, pointercancel/lostcapture, palmkontakt, fingerpan/pinch, hjul/tangentbord, koordinater på faktisk SVG CTM vid 50/100/200/300 %, pappersattribut, färgbyte, sudda/ångra/gör om, exportens SVG/dokumentordning, riktig IndexedDB-sparning/återöppning, gamla vektorer, kombinerad text och uttrycklig återaktivering av texteditorn.
- Den vanliga arbetsytan mot isolerad lokal PostgREST/PostgreSQL: skapade **Linjerad iPad – skrivprov**, valde Handskrift och 48 i linjeavstånd, ritade med riktiga musinput. Efter omladdning/återöppning finns exakt det sparade strecket och spacing=48 kvar. SQL och DOM kontrollerades; inga redigerbara föräldrar till ritytan.
- Visuell kontroll av fullscreen i 1024×768, 768×1024 samt 390×844. Ingen horisontell dokumentoverflow på mobil/stående iPad. Sparstatus och återöppnad linjerad sida kontrollerade. Skrivytan använder tillgänglig höjd, verktygen radbryter på mobil.
- Utskriftens DOM/SVG-export regressionstestad. **Ny faktisk PDF-utskrift är inte genomförd i detta uppdrag.**
- Safari på Mac kunde inte provas eftersom Macen var låst vid native-testet. Ingen fysisk iPad eller Pencil har använts.

Browserprovet kan upprepas med `npm run workspace:qa` och `http://127.0.0.1:5187/scripts/personal-workspace/qa/ink.html`, knappen **Kör ritprov**. Det använder egna fasta test-ID:n i lokal IndexedDB och är en DEV-fixtur, inte en produktionssida. Det vanliga appflödet kräver separat isolerad testbackend enligt README.

## Obligatorisk fysisk acceptanskontroll

Kör både i Safari och VI-HEM:s Capacitor-app på iPad, i stående och liggande läge:

1. Öppna gammal och ny linjerad sida. Justera avstånd/färg/styrka, skriv flera rader och växla pennverktyg. Kontrollera att linjerna aldrig försvinner.
2. Kontrollera att Pencil ritar direkt, utan textkonvertering, textmarkör eller virtuellt tangentbord. Ha Scribble aktiverat i iPadOS under provet.
3. Lägg handflatan mot skärmen under pågående skrivning. Prova ett finger för pan och två för nypgest, även efter att ena fingret lyfts.
4. Rita på en tydlig linjekorsning vid 50/100/200/300 %, panorera och återgå till 100 %. Spets och vektor ska sammanfalla.
5. Växla text/hand/mixed, skriv text före och efter två ink-block, sudda/flytta, ångra/gör om. Kontrollera korrekt textfokus endast efter aktivt textval.
6. Koppla bort nätet, skriv färdiga streck, lämna/öppna sidan och återanslut. Kontrollera lokal sparstatus, synkning och samma geometri på en andra enhet.
7. Avbryt en pointergest/appväxla mitt i ett streck: endast det ofärdiga strecket ska förkastas. Kontrollera säker återhämtning och tidigare sparade streck.
8. Exportera verklig PDF med text, flera ink-block, bakgrund och färger. Granska sidbrytning och placering.

## Kända avgränsningar

Detta är en webbaserad vektorreparation, inte PencilKit eller ett påstående om hårdvarubaserad palm rejection. Tryck/coalesced events beror på webbläsare/enhet. Markering flyttar ett valt streck; grupp-/frihandslasso och suddning av del av streck ingår inte. Ångra/gör om gäller aktuell session (max100 operationer); befintlig varaktig lagring och dokumentrevisioner ersätts inte av pennhistoriken. Panorering är fri; fit-knapparna återställer dokumentet i bild. Ett mycket kort skärmläge kan behöva mer än 25 % zoom ut för att visa hela A4; då finns panorering. Fysiska iPad-/Scribble-/nativeprov måste vara godkända före slutligt acceptansbesked.
