# Atomiska stämplingsövergångar – kontrollpunkt 8

Migration `20261010130000_atomic_clock_transitions.sql` inför självregistrering via `vihem_clock_transition` och avstämning via `vihem_clock_operation_status`. Samma transaktion validerar mål, låser användarens klocka, stänger föregående pass, skapar nästa pass, kopplar avslutande kommentar och sparar ett oföränderligt operationskvitto. UUID, ursprunglig klienttid och separat servermottagningstid sparas. Oförenliga parallella övergångar ger tillståndskonflikt. Oförändrat återförsök returnerar samma resultat. Pausens operationskvitto pekar på exakt föregående arbetspass; äldre pauser använder dokumenterad tidsordnad reservhämtning.

Frontend sparar en väntande åtgärd per konto/organisation före RPC-anropet. Ingen osäker operation visas som definitivt registrerad. Återförsök behåller UUID, tid, kommentar och förväntad föregående post. Efter 30 sekunder behålls underlaget. Statuskontrollen väntar på pågående servertransaktion; en ej registrerad avsikt bevaras separat lokalt innan användaren kan fortsätta. Ingen automatisk bakgrundskörning utlovas. Lokal historik behöver en beslutad gallringsregel.

## Faktiskt verifierat i isolerad QA

- Riktiga JWT och PostgreSQL: parallella identiska begäranden, oföränderligt operations-ID, annan användares ID, främmande organisations arbetsorder, rollback före stängning, konkurrerande jobbbyten, rast/lunch/återgång/utstämpling, projektscope, totalsummor, rätt passkommentar, idempotent dagskommentar och statuskvittots åtkomst.
- UI som Christofer QA: instämpling, rast, återgång och utstämpling genom verkliga kontroller. Servern hade inga öppna pass efteråt. De tre uttryckligen identifierade syntetiska UI-posterna städades efter verifieringen.
- Skärmbilder 390/430/768/1024/1440 × 900 finns i pass3-leveransen. 390 och 1440 visuellt granskade. Detta är viewportsimulering, inte fysisk native-verifiering.
- TypeScript, build, mobilbundle och premiumenhetstester PASS. Avgränsad lint: inga fel, befintliga hook-varningar i TimeTrackingPage kvar.

## Inför produktion och återstående prov

Ingen produktion ändrad. Installera inte utan separat releasebeslut. Inventera redan dubbla öppna poster; migrationen raderar eller stänger dem inte. Ny RPC avvisar ett sådant läge med behov av administrativ avstämning. Äldre klienter kan fortfarande göra separata steg och ska inte beskrivas som avbrottssäkra. Öppnings-triggern förhindrar nya parallella öppna poster men gör inte deras gamla flöde transaktionellt. Befintlig generell offlinekö för manuell tidregistrering är inte omskriven.

Adminregistrering, godkännande, korrigering och befintliga RLS-regler bevaras, men full admin-/inaktiv-/tenant-/superadminmatris är inte verifierad i detta pass. Fysisk offline, kontobyte, omstart med väntande operation, midnatt/DST, korrigerat tidigare pass, långa nätavbrott och gamla offlineoperationer återstår. Godkännanderegeln för klockans avslutade pass är återanvänd från befintlig kod; detta är ingen ny ekonomisk regel.

Det första slutprovet efter UI-testet nekades korrekt eftersom den syntetiska bakdaterade testkedjan överlappade de nyss avslutade UI-passen. Efter säker städning av de exakt identifierade UI-posterna passerade samma databasprov. Testet förutsätter därmed en testanvändare utan senare historik; nästa testetapp bör skapa en egen tillfällig användare per körning.

## Arbetsordervyns stämpling – tillägg

`20261010140000_workorder_clock_compatibility.sql` och gemensamma `timeClock.ts` ersätter arbetsordervyns separata stäng-/öppna-/återställningsskrivningar. Öppningskommentaren hör till det nya passet. Arbetsordervyns utstämpling behåller befintlig `submitted`-status, medan tidsvyns befintliga automatiska godkännande behålls. Arbetsordervyns tidigare jobbbyte till arbetsorder kräver inte en ny avslutande kommentar; denna begränsade verksamhetsväg bevaras när ett giltigt arbetsordermål finns. Dubbel clockin med befintlig öppen post nekas även om klienten skickar dess ID.

Osäkra svar använder samma konto-/organisationskö som tidsvyn. Arbetsordervyn uppmanar till återförsök/status i Tidrapportering; den kastar inte bort den väntande operationen. Pausutstämpling från arbetsordervyn hänvisar också dit för korrekt kommentar och kontext. Efterföljande QA-databasprov verifierar öppningskommentar på nya passet och submitted utan approved_at. Den specifika arbetsorderknappens browserflöde är ännu inte provat efter ändringen. Hook-ordningsfel för osparade detaljändringar rättat; tidigare roll-/cross-org-kommentarprov passerar fortfarande.

Projektkopplade arbetsordrar behåller tidigare databasdefault outside_quote i den gemensamma hjälparen; en RPC-default för andra projektval får inte ändra arbetsorderns ekonomiska summering. Arbetsordervyns submitted-utstämpling behåller dess tidigare frivilliga avslutningskommentar även för projektkopplade arbetsordrar.
