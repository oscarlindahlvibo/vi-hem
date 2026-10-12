# Korttidskvitton via Google Workspace

Avsändare: **kontakt@ekangensvandrarhem.se**, separat Workspace-konto. Återanvänder organisationens krypterade servicekonto och `google-workspace-mailer.ts`; ingen SMTP-/kontolösenordshantering i frontend. Behöver Domain-Wide Delegation för `https://www.googleapis.com/auth/gmail.send` och aktiverad Gmail för kontot.

## Funktion och säkerhet

Aktiv administratör öppnar kvittot, granskar mottagare/utfärdare/belopp och bekräftar utskick. Backend hämtar bokningen via användarens befintliga RLS och organisationsfilter, skapar PDF från sparade uppgifter och ignorerar klientens mottagare/organisation/PDF. Endast organisationsspecifika Workspace-credentials och aktivt avsändarkonto accepteras; global credential-fallback används inte.

Ny tabell `vihem_short_stay_receipt_emails` lagrar sändningsstatus, mottagare, avsändare, skapare och versionshash, inga PDF-/nyckeldata. Org-admin kan läsa; bara backend skriver. Unik bokning/version och operation-ID hindrar parallella dubbletter. Bekräftad avvisning kan återförsökas; timeout eller accepterat mejl med misslyckad historiksparning blockerar återutskick tills resultatet kontrollerats i Gmail. `sent` betyder accepterat av Gmail, inte bevisad leverans. Ingen automatisk ompostning av samma kvittoversion.

Kvittorader, moms och explicit utfärdarval bevaras. Ändring av kvittouppgifter ger annan versionshash; stale granskningshash nekas. Inga bokningar, fakturor eller ekonomiska belopp uppdateras av utskick.

## Installation – separat godkännande krävs

1. Kontrollera senaste main/serverfiler och ta databas-/funktionbackup enligt befintlig beta-releaseprocedur. Säkerställ läsbar backup och dokumentera återställningsväg före SQL.
2. Applicera endast `20261012180000_short_stay_receipt_email_jobs.sql`. Additiv migration, beroenden: befintliga organisationer/profiler/korttidsbokningar. PostgREST-schema laddas om av migrationen.
3. Registrera/aktivera kontot i **Vibogruppen AB:s** `vihem_mail_accounts` via befintlig kontohantering. Kontrollera befintlig rad först; ingen annan organisations inställningar ändras. För nytt konto: `search_general=false`, `search_invoices=false`.
4. Installera uppdaterad `_shared/google-workspace-mailer.ts` (ny tokenkontroll, övrig mailfunktion bevarad) och `vihem-short-stay-receipt-email` i den befintliga Edge-routerkonfigurationen. Granska senaste serverversion innan delad helper ersätts. Befintliga Edge/authinställningar ska bevaras.
5. Kör `prepare` med behörig admin: kontrollerar avsändarkonto, org-credentials, Gmail-token och historiktabell utan mejlutskick. Vid scopes/delegationsfel måste Google Workspace-administratören korrigera just detta; exponera inte nycklar/tokens.
6. Efter godkänd backendkontroll: merge/push frontend och bygg ny app enligt befintligt flöde. Varje Git-push kan starta App Store Connect-flödet. Äldre appversioner fortsätter med PDF-delning; inga befintliga API-kontrakt tas bort.
7. Första verkliga testutskicket ska uttryckligen beställas till en angiven testmottagare. Kontrollera PDF, Gmail Skickat, ledger och faktisk leverans före kundanvändning.

Rollback: återställ frontend och avaktivera den nya funktionen/kontot utan att påverka andra mailkonton. Bevara sändningshistorik efter verkliga utskick; radera inte tabellen eller återställ hela delade databasen för en frontendrollback. Ny tabell får endast tas bort om den aldrig använts och efter separat beslut.

## Verifiering 2026-10-12

PASS: TypeScript, mobil-/Vite-build, riktad lint (0 fel, 1 befintlig hookvarning), `node scripts/shortstay-receipt-email-check.mjs`: validering, moms/belopp, versionshash, felklassificering och flersidig svensk PDF.

PASS isolerad QA med faktisk Edge och PostgreSQL men **falsk mailtransport**: anonym/personal/hyresgäst/annan organisation nekas, org-/mottagarinjektion ignoreras, stale version nekas, parallella anrop/återförsök, definitiv avvisning, timeout och accepterat utskick med historikfel. Ingen riktig Gmail begäran/mejl i dessa tester. Produktionskoden innehåller ingen testtransport eller bypass.

PASS faktisk ShortStayPage med mockad DB/Edge: konfigurationsfel/återkontroll, mottagargranskning, explicit bekräftelse, ett utskick och fortsatt befintlig PDF-delning. Mobil 390 och desktop 1440 visuellt granskade (`outputs/shortstay-receipt-email-*.png`, lokala leveransartefakter).

Produktionsinspektion var skrivskyddad: Vibogruppen AB har lagrad Workspace-koppling, men avsändarkontot är inte aktivt registrerat i VI-HEM. Riktig Gmail-delegation/token, verklig leverans och fysisk app är **ej verifierade**. Ingen produktionsmigration, kontoaktivering, frontenddeployment eller verkligt utskick genomfört.

## Aktivering efter användargodkännande 2026-10-12

Backend och avsändarkonto installerade. Färsk full PostgreSQL custom-backup och läsbar pg_restore-lista verifierade: `/mnt/md0/supabase-backups/shared/receipt-email-20261012T082213Z`. Tidigare helper, kontorad och migrationsledger bevarade. Additiv tabell och kontoaktivering i samma transaktion; adminläsning/backendskrivning efterkontrollerade. Riktig delegerad Gmail-send-token för kontaktkontot PASS utan mejlutskick. Förbättringarna för egna inköpswebbplatser finns på main sedan bygge 16; ny frontend samlar även kvittomejl i bygge 17. Verklig leverans och fysisk app återstår.

## Standardmeddelande och redigerbar granskning

Under Korttidsuthyrning → Kvitton → Mejlinställningar kan admin spara standardämne/text per organisation. Platshållare `{namn}`, `{boende}`, `{ankomst}`, `{avresa}` fylls av backend. Skicka-dialogen visar mottagare och avsändare, låter admin redigera text/ämne för just det utskicket, växla till mejlförhandsvy och visa kvittobilagan. Text skickas som ren text, inte HTML. Ämnesrad nekar radbrytningsinjektion; text max 6 000 tecken. Sparfel behåller texter; revisionsvillkor nekar samtidiga överskrivningar. Mejlets ämne/text registreras i den befintliga privata sändningshistoriken. Ändrad meddelandetext kringgår inte kvittoversionens dubbelutskicksskydd. Äldre frontend utan textfält använder standardmallen.

Ny additiv migration `20261012190000_short_stay_receipt_email_templates.sql` behöver föregående kvittomejlledger. Installation: backup → migration → uppdaterad receipt Edge/receipt.ts → frontend; inga Workspace-rättigheter/kontoändringar behövs. Ingen kunddata/bokning ändras. Detta tillägg är **inte installerat i befintlig beta ännu**.

QA PASS: faktisk isolerad Edge/DB mallskapande och revisioner (parallella/stale anrop), personal/hyresgäst/org-isolering, platshållare, redigerad text/ämne, headerinjektion och fortsatt dubblettspärr. Tidigare återförsök/timeout/ledgerfel PASS. Browser faktisk sida med mocktransport 390/768/1440: standardmall, sparfel/bevarad text/återförsök, redigering/förhandsvy/explicit utskick; mobil/desktop visuellt granskade. TypeScript/riktad lint, kvitto/PDF/malltest PASS. Inga riktiga mejl skickade; leverans och fysisk app återstår.
