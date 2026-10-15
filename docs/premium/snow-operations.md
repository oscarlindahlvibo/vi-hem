# Snö & halka

Implementerad på `codex/snow-operations`, inte installerad i befintlig beta. Modulnyckeln `snow` är avstängd från början. Originalinventeringens 60 områden ändras inte av denna nya modul.

## Användning

- Aktivera Snö & halka för organisationen och ge berörd personal modulbehörighet. Befintliga explicita `module.jour`-grants kopieras till `module.snow`; modulen måste fortfarande aktiveras.
- Lägg upp uppdragsgivare under Planering, exempelvis SVEVIA VIRSERUM/JÄRNFORSEN och privata kunder. Inga verkliga kunder skapas automatiskt.
- Rita linjer eller områden på kartan. Välj uppdragsgivare, maskin/handskottning och prio 1–5 (1 först). Punkter kan flyttas eller ångras. Arkivering bevarar historiken; revisionskontroll förhindrar överskrivning av nyare redigeringar.
- Körpass: välj maskin/hand och tryck Snöröjning eller Sandning under kunden. Byte stänger föregående pass och öppnar nästa atomiskt i ordinarie stämpelklocka. Ingen manuell kommentar för snöpass; vanliga arbetspass behåller sina kommentarsregler. Rast/lunch/återuppta använder samma centrala tidsregler.
- Vald rutt följer passet. Klarmarkering visas för dagens arbete. Min tid visar egna snöpass; ordinarie tidrapportering/löneunderlag använder samma tidsposter.
- Snöjour använder befintliga `sno`-pass, rotation, behörighet och bytesflöden. När modulen aktiveras döljs snöjour i vanliga Jour; tidigare historik flyttas eller raderas inte.
- Rollen Snöpersonal får endast se egna snöjourpass. Administratör kan dessutom ge ”Tillåt snöjobb och egen tidrapportering”. Kontot får fortfarande ingen övrig modulåtkomst. Externa konton har inte jourbytesmarknaden.

## Installation – separat godkännande krävs

1. Kontrollera aktuell serverrevision, användbar databasbackup/återställningsväg och senaste definitionerna av `vihem_clock_transition`, `vihem_clock_operation_status` och `vihem_save_staff_editor`. Migreringarna bygger vidare på befintlig atomisk klocka och personalredigerare; jämför mot eventuell parallell utveckling före installation.
2. Installera i ordning `20261022100000_snow_operations.sql` → `20261022110000_snow_external_accounts.sql` → `20261022120000_snow_api_guard.sql`. Beroenden omfattar tidigare modulregister, jour, behörighetsgrants och atomisk personal-/klockgrund. Inga verkliga filer ändras.
3. Externa snökonton kräver ett **aktivt PostgREST pre-request-skydd**. Inventera befintlig hook och bevara dess kontroller; ändra inte delad konfiguration blint. `vihem_snow_external_ready()` kräver `pgrst.db_pre_request=public.vihem_snow_api_guard`. Om en befintlig hook behöver kedjas måste installation och readiness-kontroll anpassas/granskas tillsammans. Migreringen ändrar inte serverkonfigurationen automatiskt.
4. Verifiera över riktiga HTTP-anrop att externa snöidentiteter nekas övriga tabeller, vyer och RPC, samt befintliga Edge Functions/storage-vägar. PostgREST-skyddet skyddar inte automatiskt en Edge Function som använder service-role. Den nya rollen ska inte aktiveras innan dessa installerade vägar kontrollerats. Bevara övriga appars åtkomst; även identiteter utan VI-HEM-profil ska fungera.
5. Installera uppdaterad `vihem-create-user` före frontend. Både skapande och rollbyte via personalredigeraren spärras tills API-skyddets readiness är uppfylld. Kör ett riktigt Auth-skapa/logga-in/avaktivera-prov med syntetisk användare innan externa konton lämnas ut.
6. Installera frontend, aktivera organisationens modul och provkör ordinarie stämpelklocka + snöbyte/rast/återförsök och jour med syntetiska konton. Inga ändrade signaturer i befintligt klock-API.

Återgång: stäng av modulen, avaktivera externa snökonton och återställ frontend vid behov. Behåll nya tabeller/kolumner och tidshistorik; destruktiv nedmigrering är ingen säker rollback. Behåll API-skyddet så länge snöidentiteter finns. Framtida nya VI-HEM-tabeller/RPC måste omfattas av rollisoleringen.

## Verifiering 2026-10-15

- TypeScript, webbbuild, mobilbuild/bundle och riktad lint. Befintliga generella bundle-/Browserslistvarningar kvar.
- `npm run test:snow`: geometri/prioritet och isolerad Edge-handler för kontoskapande, roll/org, aktiv administratör, readiness och kompensation vid profilfel. Inga mejl skickas.
- `supabase/tests/snow_operations.test.sql` och `snow_external_accounts.test.sql` på namngiven QA-databas: kund/org, rutt/metod, idempotens, felrollback, växling, paus/återuppta, historik, arkivering, revision, roll-/självuppgraderingsskydd, jour och lagringskompatibilitet. Transaktionerna rullas tillbaka.
- `scripts/snow-clock-concurrency.py`: två samtidiga riktiga QA-sessioner och exakt återförsök, en tidspost.
- `scripts/snow-api-integration.py`: separat tillfällig PostgREST-instans på QA-nät, syntetiska identiteter, riktiga HTTP-nekanden för andra tabeller/RPC/PATCH, egna poster, klocka/återförsök och opåverkad admin. Container/testidentiteter städas bort. QA:s `auth.uid()` anpassades till den avlästa produktionsdefinitionen för JWT-formatparitet; produktion ändrades inte.
- Verklig komponent i isolerad UI-harness: 390/768/1440 px, start/fel/återförsök/byte/utstämpling, kund- och ruttritning, klarmarkering samt osparat-skydd. Kartdata verkliga OSM, kund-/passdata syntetiska; detta är inte Auth-E2E.

Kvar före drift: ovanstående installations-/Auth-/Edge-vägkontroller och fysisk iOS-/Androidkontroll, inklusive återkomst från bakgrund och nätavbrott. Kartan kräver nät och visar planerade geometrier; ingen GPS-spårning, navigering eller offlinekartnedladdning ingår. OSM-attribution bevaras, inga massnedladdningar. Ingen snow-deployment, produktionsmigration eller verklig användarändring gjord.
