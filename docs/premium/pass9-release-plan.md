# Releaseplan – kontrollpunkt pass 9

Ingen deployment är utförd. Underlag för separat godkännande, inte ett automatiskt körskript. Main vid provet: `2b935b7dcad54cb052c66df29674bf530a745590`.

## Vad som faktiskt har verifierats

En fjärde isolerad klon, `vihem_hotfix_stage_release_20261010`, återställdes från samma färska schema-only-export som hotfixproven. Alla 32 migrationsfiler i premiumdiffen kördes sekventiellt med ON_ERROR_STOP. PASS 32/32. Första provet stannade vid saknad `supabase_realtime` publication; publicationen ingår inte i den avgränsade schemaexporten. Produktionsmetadata kontrollerades läsande: insert/update/delete/truncate=true, all_tables=false. En tom publication med denna basförutsättning skapades enbart i klonen och hela kedjan kördes därefter. Det bevisar DDL-installation på detta schema, inte datamigrering över riktiga rader, full publication-medlemskap eller aktiv CDC i klonen. De isolerade hotfixklonerna fick fortfarande endast varsin kandidat.

## Steg och godkännanden

1. **Säkerhetshotfixar separat.** Läs latest security-preflight, kontrollera specialgrants/roller och snapshotdiff. Verifierad databasbackup + tidigare policy-/funktionsdefinitioner före varje kandidat. Kommentarvakten 091300, registervakten 111030 och referensvakten 111430 kräver ingen ny frontend. Applicera endast efter separat uttryckligt godkännande. Eftertester egna/foreign/tenant/screen/inactive/anonym och äldre RPC-signatur. Rollback får inte återöppna läckan. Full kostnads-/barnregistermatris och åtta lagerrörelsetyper återstår.
2. **Backendgrund före ny UI.** Installera de valda, beroendeslutna migrationsgrupperna i QA/staging, sedan tillhörande Edge Functions med befintlig auth/verksamhetskonfiguration. PostgREST reload och JWT-prober före frontend. Versionssätt databas/Edge/frontend tillsammans i releaseunderlaget. Ingen frontend ska slå an nya RPC:er innan de finns.
3. **Stegvis frontend.** Oberoende inbox/rutin-/inventerings-/serviceplaneditorer kan avgränsas från hela premiumreleasen, men App/UI-diffen innehåller även tidigare moduler. Skapa en granskad release-/cherry-pickkandidat; deploya inte premiumbranchens hela frontend som om den bara innehöll inboxen. Äldre manuella editorer blir inte atomiska av att nya RPC:er finns.
4. **Chattens cutover separat.** Backend + privat filåtkomst och migrerade legacyreferenser före 090940 och ny UI. Äldre appar kan förlora chatt enligt användarens tidigare beslut, men får inte återfå publik åtkomst. Native push/APNs/FCM och fysisk navigering kräver verifiering före ett påstående om färdig mobilrelease.
5. **Besiktningsarkiv separat gate.** Verklig separat QA-Drive, reconciliation och full idempotent äldre-filmigrering krävs. Behåll gamla referenser/filer tills avstämning är godkänd. Backend/Edge före frontend. Äldre installerade klienter och signerat versionsmaterial måste regressionstestas; inga signerade dokument skrivs över.
6. **Produktionslik dataprofil och canary.** Syntetiska långtexter/volymer/legacytidsrader i staging, fysisk iOS/Android, ekonomi/Accounted-PDF och business flow checks. Backup/restoreövning, övervakning av RPC/Edge/CDC/arkivfel, versionsmetadata och explicit beslut innan någon produktionstransaktion.

## Full migrationsinventering

Alla rader nedan: DDL PASS på isolerad klon. “Befintligt schema” betyder inte beroende på hela premiumstacken. Kortnummer avser YYYYMMDDHHMMSS där tabellen använder MMDDHHMM. Säkerhetsberoenden kan kräva annan ordning än filernas tidstämpel.

| Fil | Beroende/förutsättning | Release/äldre klienter |
|---|---|---|
| `20261009090000_chat_foundation.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Chattgrupp; cutover/privata filer/push måste verifieras, gamla chattklienter kan brytas |
| `20261009091000_chat_actions_groups.sql` | 090900 | Chattgrupp; cutover/privata filer/push måste verifieras, gamla chattklienter kan brytas |
| `20261009092000_chat_private_storage.sql` | 090900/090910 | Chattgrupp; cutover/privata filer/push måste verifieras, gamla chattklienter kan brytas |
| `20261009093000_chat_workorder_files.sql` | 090900/090920 | Chattgrupp; cutover/privata filer/push måste verifieras, gamla chattklienter kan brytas |
| `20261009094000_chat_legacy_cutover.sql` | 090900/090920/090930 + privat filåtkomst | Chattgrupp; cutover/privata filer/push måste verifieras, gamla chattklienter kan brytas |
| `20261009095000_chat_push_dedup.sql` | 090900 | Chattgrupp; cutover/privata filer/push måste verifieras, gamla chattklienter kan brytas |
| `20261009120000_profile_photos.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Privat Storage + photo-Edge; gammal profilvisning bevaras, fysisk crop/kamera kvar |
| `20261009130000_work_order_comment_isolation.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Fristående hotfix; specialroller/legacy eftertest och separat godkännande |
| `20261009131000_chat_link_previews.sql` | 090900 + befintlig objekt-RLS | Chattgrupp; cutover/privata filer/push måste verifieras, gamla chattklienter kan brytas |
| `20261009170000_atomic_customer_project_create.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261009190000_atomic_inspection_save.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Drive-gate, äldre protokoll/signaturer/klienter; backend före arkiv-UI |
| `20261010100000_inspection_drive_jobs.sql` | 091900 + befintligt Drive-register | Drive-gate, äldre protokoll/signaturer/klienter; backend före arkiv-UI |
| `20261010101000_inspection_archive_commit.sql` | 091900/101000 | Drive-gate, äldre protokoll/signaturer/klienter; backend före arkiv-UI |
| `20261010130000_atomic_clock_transitions.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261010140000_workorder_clock_compatibility.sql` | 101300 | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261010160000_inspection_draft_revisions.sql` | 091900/101000/101010 | Drive-gate, äldre protokoll/signaturer/klienter; backend före arkiv-UI |
| `20261010170000_tenant_invoice_ownership.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Ägar-RLS; Accounted/PDF och samtliga fakturavarianter kvar |
| `20261011100000_atomic_staff_editor.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011103000_fleet_read_role_guard.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Fristående hotfix; specialroller/legacy eftertest och separat godkännande |
| `20261011120000_atomic_inventory_create.sql` | befintlig lager-RPC; 111430 krävs för säker referensvalidering | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011123000_atomic_checklist_step.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011130000_idempotent_inventory_movement.sql` | 111200 + befintlig lager-RPC; 111430 säkerhetsberoende | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011133000_atomic_fleet_editor.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011140000_editor_revision_timestamps.sql` | 111330 + schema med editorernas updated_at | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011143000_inventory_reference_isolation.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Fristående hotfix; specialroller/legacy eftertest och separat godkännande |
| `20261011150000_atomic_inventory_cart.sql` | 111300/111430 | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011153000_inventory_location_editor.sql` | 111400 + lager/fordon | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011160000_atomic_fleet_service.sql` | 111330 + serviceplansschema | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011170000_notification_active_owner.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Owner-RLS för alla klienter; inaktiv spärras; web UI separat från native push |
| `20261011180000_fleet_service_plan_editor.sql` | 111400 + serviceplansschema | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011190000_atomic_operations_inventory_check.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |
| `20261011200000_atomic_routine_checklist_start.sql` | befintligt schema/helpers/RLS; inget annat nytt premium-RPC krävs | Additiv backend före ny RPC-UI; gamla direktoperationer behöver eget legacyprov |

## Externa beroenden och absoluta blockerare

- Riktig QA-Drive saknar separat autentiserad QA-mapp/prov; mock/konfigurationsfel räcker inte. Ingen produktionsfil används för fel-/gallringsprov.
- Accounted: autentiserat verkligt PDF-/bolags-/underlagsflöde ej verifierat. Ekonomiska regler får inte ändras via designrelease.
- Fysisk iOS/Android kamera, HEIC, safe-area/tangentbord, bakgrund/återanslutning, push och äldre appkompatibilitet ej slutverifierade.
- Gamla publika buckets/policyer: filreferenser, faktisk åtkomst och säker migrering måste inventeras; stäng inte länkar blint. Profil-UPDATE-trigger finns i schemat men full auktoritets-/specialgrantmatris är inte klar.
- Nyupptäckt separat granskning: äldre driftinventarie-/checklist-SELECT tillåter bred egen-org-läsning. Mutations-RPC är strikt staff/admin/active/org; detta är inte bevis för att hela gamla driftmodulens läsbehörighet är färdiggranskad.
- Ny rutinredigerare använder fortfarande gammal `vihem-routines` Edge-sparning utan atomisk versions-/metadata-/notistransaktion. Inventariemalleditor och koppling av brist till inköp har också äldre flerstegsoperationer. Det blockerar full modul-DoD, inte den isolerat verifierade atomiska kontrollsparningen.
- Inga produktionsbackuper/restoreövningar har körts här. Schemaexport är inte databasbackup. Inga migrationsändringar tar bort gamla filer automatiskt.

## Återuppta

Kontrollera remote/main och production schema read-only på nytt. Upprepa staging från färsk export om schema ändrats. Kör nya samt befintliga QA-testskript, låt auth-/dispatch-externaler vara avstängda enbart i disponibel staging. Välj en konkret liten releasekandidat med alla beroenden; få separat godkännande först när matris och rollback är granskade.
