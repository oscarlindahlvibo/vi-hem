# Pass 9 – isolerade hotfixprov, 2026-10-10

Main är `2b935b7dcad54cb052c66df29674bf530a745590`. En färsk, **schema-only** export från aktuell PostgreSQL 15.8 återställdes i QA-containern, inte på produktionsdatabasen. SHA-256 för exporten: `1acee75e93916861f1841628ecc24364f29b18ce6e0d3f1e4c2b3667fb826f3e`. Inga produktionsrader, authkonton, servicehemligheter eller filobjekt kopierades. PostgreSQL ACL, RLS, constraints och integritetstriggers behölls. Authhooks och externa push/HTTP/e-post-dispatchtriggers stängdes av **endast i denna disponibla kopia**. Detta är en schemaverifiering, inte en produktionsbackup eller en komplett frontendstagingrelease.

Tre separata kloner skapades av grundschemat: `vihem_hotfix_stage_comments_20261010`, `vihem_hotfix_stage_fleet_20261010`, `vihem_hotfix_stage_inventory_20261010`. Varje klon fick **endast sin egen kandidat**, inga andra premiummigrationer. Alla syntetiska testposter ligger i BEGIN/ROLLBACK. Tester använder riktig `authenticated`-roll och JWT subject via auth.uid().

| Kandidat | Baslinje | Efter kandidat | Avgränsning |
|---|---|---|---|
| 20261009130000_work_order_comment_isolation | Personal/admin läser även andra organisationens kommentar | PASS admin/staff/tenant/screen/inactive/foreign/superadmin; legacy direkt INSERT i egen order tillåten, cross-org och falsk avsändare nekade, anonym läsning 0 | Förälderns befintliga RLS bestämmer superadminåtkomst; ingen ny global specialrätt införs |
| 20261011103000_fleet_read_role_guard | Hyresgäst kan läsa egen organisations fordons-/artikelregister | PASS admin/staff/screen/foreign/superadmin behåller orggränser, tenant/inactive 0; restriktiv SELECT-vakt finns på alla matchande tabeller | Faktiska rader provade på fordon, artiklar, platser och saldon. Övriga barntabeller policykontrollerade, deras hela CRUD är inte verifierat |
| 20261011143000_inventory_reference_isolation | Gammal RPC accepterar annan organisations målplats | PASS source/destination/project/workorder/apartment cross-org nekade utan transaktionsrad; gammal signatur transfer ger oförändrat sammanlagt saldo och en rad; inactive nekad | Samtliga åtta rörelsetypers affärsregler och fysisk äldre app behöver separat regression |

Kör `python3 scripts/premium/hotfix-stage-checks.py <comments|fleet|inventory> --baseline` **före** kandidaten, därefter utan flaggan. `hotfix-stage-sql.py` kan enbart ansluta till de tre namngivna QA-klonerna i QA-containern och läser serverns QA-credentialfil utan utskrift. Verktyget skapar/raderar inte databas och får inte användas för produktion. Fixturerna finns i hotfix-stage-fixtures.sql. Klonerna bevaras för granskning; de innehåller schema + respektive kandidat, testdata rullades tillbaka.

## Beroenden och godkännandeförfarande

Alla tre kandidater kan appliceras fristående på det exporterade aktuella schemat. Kommentarvakten kräver work-order-RLS, profils active, get_my_role och auth.uid. Registervakten kräver befintliga tabeller/profilroller; `screen` är uttryckligen bevarad. Lager-RPC kräver befintlig lägenhetskoppling (20260827130000), org-/rollhelpers och balansens unika nyckel. Ingen behöver Drive, chatt, nya editorer eller frontend.

Före godkännande: kör senaste `scripts/premium/security-preflight.sql` läsande, jämför funktioner/policyer/roller med exporten, dokumentera organisationernas specialgrants och kontrollera full matris för kostnadstabeller och alla lagertransaktionstyper. Ta en riktig verifierad databasbackup och spara tidigare funktions-/policydefinitioner. Schemaexporten ovan är **inte** en databackup. Ingen produktionsbackup, produktionsmigration eller återställning har körts i detta pass.

Godkänn och installera kandidaterna separat. Efter varje: kör egna-org och cross-org JWT/legacy-klientprov, inactive/anonym/tenant/screen och specialroller, jämför antal affärsrader, kontrollera loggar och notifiera PostgREST vid RPC-ändringen. Säker rollback bör inte återöppna den bekräftade läckan; använd avgränsad åtkomstblockering medan en korrigerad policy tas fram. Automatisk rollback till osäkra policyer erbjuds inte.

Publika storageytor kvarstår som separat releaseblockerare. Ingen bucket, verklig fil, Drive-behörighet eller produktionsprofil har ändrats. Profil-UPDATE auktoritetstrigger finns i aktuell export; full spoof-/specialrollmatris återstår.
