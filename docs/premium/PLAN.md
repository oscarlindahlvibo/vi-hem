# VI-HEM 3.0 – arbetsplan och kontrollpunkter

Branch: `codex/vihem-3-premium`, utgår från den verifierade chattbranchen `1e6a561` ovanpå `main` `2b935b7`. Produktion och main ändras inte. Chattens befintliga backend bevaras. Andra agenter kan ändra main: fetch/review före publicering.

## Revisionens första slutsatser

Källkoden har 61 vy-/modulfiler och 103 TSX-filer totalt. Inventeringen i inventory.json innehåller alla kontroller med radnummer, dialogreferenser, komponenter och routes/grindar. Personalens specialbehörigheter är profilinställningar, inte nya roller; befintliga roller är superadmin/admin/staff/tenant/screen. Allmänna signerings-, återställnings-, tvätt- och skärmflöden behöver separat granskning utanför Layout. Webbplatserna i apps/ är separata produkter; deras VI-HEM-adminmoduler ingår.

Konkreta kodfynd före förändringar:

- Grundsystemet har redan VI-HEM-färger och komponenter men tokens är duplicerade i Tailwind/CSS. Inter nämns i CSS men ingen lokalt levererad font har verifierats. Utgå från systemets native-typsnitt; undvik att ange en font som inte laddas.
- Input/Select/Textarea skapar ID från etikett, vilket kan ge dubbletter i stora formulär. Hjälp/feltexter saknar aria-describedby och aria-invalid.
- Modal har Escape och scroll-lås men ingen fokusfälla eller återställning; samtliga modaler lyssnar på Escape samtidigt. Bakgrunden är inte inert.
- Klickbara Card är div med onClick utan tangentbordsbeteende.
- Tabs har inte fullständigt tangentbordsbeteende. Små knappar/statusar kan vara 10–12 px; touchytor behöver vara 44 px där lämpligt.
- Avatar finns men stöder bara initialer; Profile.avatar_url används inte konsekvent. Ingen granskad egen profil-/beskärningsfunktion finns.
- Chatten har fristående delningslänkar, permanent åtgärdsknapp per bubbla, stora radier och utdragen läsbredd. Backend/realtid/utkast/återförsök ska behållas.
- Besiktningsmodellen har rum med condition good/remark/action_required, kommentarsfält, rumskopplade bilder, utkast/slutför och befintlig kamera. Inför inte ett nytt N/A-tillstånd eller andra signeringsregler utan datamodellsgranskning. Progress/sammanfattning och läsbara kontroller kan utvecklas ovanpå befintliga tillstånd.
- Många ekonomi-, avtal-, fordons-, fastighets- och administrativa undersidor använder egna tabeller/kontroller. De måste granskas per flöde, inte massersättas via regex eller generisk CSS.

Bedömningens tio dimensioner finns per vy i inventory.json. Visuell kvalitet, mobil, klickflöde, funktion och premiumkänsla är **ej verifierade** tills autentiserad runtime-granskning gjorts. Kodfynd är indikatorer, inte påhittade användartestresultat.

## Etapper

| Etapp | Omfattning | Status |
|---|---|---|
| A | Full källkodsinventering, tokens, tillgängliga gemensamma kontroller, dokumenterade referensvyer | Pågår; inventering klar, runtime-revision återstår |
| B | Navigation, startsida per roll, egen profil/beskärning, privat profilbild, formulär/dialoger | Ej klar |
| C | Arbetsordrar, tid, projekt, besiktningar, fastigheter | Ej klar |
| D | Chattytor/plusmeny/kontextåtgärder, personbilder, kommentarer/notiser | Ej klar |
| E | Avtal/signering, personal, båda ekonomier, hyror, dokument, inventarier/fordon/drift, admin, hyresgästportal | Ej klar |
| F | Visuell/regressions-/a11y-/prestanda-/säkerhetsmatris för samtliga inventerade flöden | Ej klar |

## Kontrollmatris för varje modul

Registrera explicit: list-/detalj-/ny-/redigera-/fel-/tom-/laddningsvyer; roller/behörigheter; 390/430/768/1024/1440 px; dialog/tangentbord; funktionella spar-/avbrytflöden; screenshot före/efter; a11y/tangentbord; befintliga regressionsprov; återstående brister. Alla tolv DoD-krav i användaruppdraget måste uppfyllas innan modulstatus Klar.

Endast säker QA med syntetiska konton/data används. Inga produktionsnycklar eller personuppgifter i rapport/screenshot. Gemensamma tabellstilar är inte ersättning för individuell mobilpresentation. Autosparning av utkast får aldrig signera, publicera eller fakturera. Profilbildsfunktion kräver privat lagring och serverkontroll; använd inte publik bucket som genväg.

## Återupptagning

Läs denna fil, inventory.md, designsystem.md och kontrollpunkter.md. Kontrollera git status/fetch före vidare ändringar. Varje session ska beskriva faktiskt implementerat/testat och vad som återstår. Markera inte hela VI-HEM 3.0 färdigt vid en delcheckpoint.
