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
