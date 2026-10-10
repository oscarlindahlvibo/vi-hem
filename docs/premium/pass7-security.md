# Pass 7 – isolerade säkerhetskandidater

Ingen produktionsändring. Följande gäller källkod och den isolerade databasen vihem_chat_qa; aktuell produktion är inte inspekterad eller certifierad.

## Bekräftat och rättat i QA

Den äldre SECURITY DEFINER-funktionen `vihem_inventory_apply_transaction` kontrollerade artikelns organisation men inte referensernas organisation. Ett disponibelt test skapade två lagerplatser i skilda QA-organisationer. Admin kunde registrera inleverans på egen artikel mot den andra organisationens plats. Felaktig saldo-/rörelserad bekräftad genom lyckad RPC, sedan borttagen tillsammans med samtliga syntetiska rader.

Fristående kandidat: `20261011143000_inventory_reference_isolation.sql`. Bevarar befintlig 10-parameterssignatur, rörelsetyper, kostnadssnapshot och beräkningslogik. Validerar aktiv aktör samt source/destination/project/workorder/apartment mot aktörens organisation; explicit execute endast authenticated. Funktionen behåller sedan originalets saldo-/transaktionsoperationer. QA: samma angrepp nekas 42501, egen inleverans fungerar och saldo återläst; atomiskt skapande och nya uttagsprov återkörda. Full kombinationsmatris för inventeringsjusteringar, gamla appar, inactive/superadmin och övriga referenser återstår.

Separata kandidater från tidigare pass är arbetsorderkommentarer (`20261009130000`) och restriktiv läsrollvakt för fleet/lager (`20261011103000`). De kräver fortfarande egna releasebeslut och efterkontroller. Ny editor ersätter inte tabell-/RPC-/storagekontroll.

## Profil-UPDATE: precisering av tidigare risk

QA har breda legacy UPDATE-policyer. Ett nytt disponibelt autentiserat tenantkonto försökte uppdatera sin egen role till admin. Försöket nekades med 42501 av `vihem_vibofast_guard_profile_authority`, befintlig migration `20261006113000_vihem_profile_authority_guard.sql`. Kontot/profilen raderades efter provet. Den specifika rolleskaleringsvägen är därför **inte bekräftad exploaterbar i aktuell QA**. Produktionens trigger/funktionsdefinition, övriga fält (BankID/email/systemadmin), admin/foreign/superadmin och RLS-policyernas hela samverkan återstår. Dra inte slutsatsen att breda policyer i sig bevisar exploatering när en servertrigger stoppar den.

## Legacy Storage

Källkod skapar publika fleet-/lager-/besiktningsbuckets. QA:s storage-policyregister har Fleet images/documents ALL med endast bucketvillkor, inventory SELECT med endast bucketvillkor och offentlig besiktningsläsning. Dessa definitioner är bekräftade. QA saknar bucketposter för dessa fyra bucket-ID:n; faktisk offentlig filhämtning/produktionsexponering har därför **inte runtime-verifierats**. Ingen bucket ändrad eller fil raderad. Revisionsplan: inventera verkliga bucketposter/referenser, kontrollera organisationsprefix och objektbehörighet, förbered privata hämtningar och migrering före avstängning av gamla länkar.

## Isolerad driftsättningsprocedur

1. Läs senaste main/produktionens funktioner och policyer på nytt. Spara exakta backupdefinitioner och funktionens grants. Ingen premiumfrontend krävs för referenshotfixen.
2. Applicera en kandidat i staging med main-versionen, inte hela premiumreleasen. Verifiera egna inleveranser/uttag/flytt/inventering och negativa korsorganisationsprov med samtliga relevanta roller.
3. Separat uttryckligt produktionsgodkännande; därefter operatörskörd transaktion och schema-reload. Ingen sådan körning är utförd här.
4. Efterkontrollera function signature/ACL och referensnekning samt oförändrade egna saldon/rörelser. Granska historiska felaktiga referenser read-only separat; hotfixen raderar eller flyttar inga historiska rader.
5. Rollback återställer sparad funktionsdefinition/ACL endast efter bedömning av återöppnad säkerhetsbrist. Återställ inte osäker kod för att lösa ett frontendproblem.
