# Manuell driftsättning: Vibo och delad Supabase

Utgångspunkt: Vi-hem `origin/main` på commit `7263f05`, inklusive de senaste
ändringarna för Accounted, hyresdebitering under uppsägningstid och signerade avtal. Skrivskyddade kontroller har utförts mot den delade Supabase-instansen via ZeroTier.
Inga produktionsskrivningar har gjorts. SQL har verifierats i en isolerad lokal PostgreSQL-modell.

Ett färdigbyggt paket med avgränsade manuella steg finns också. Se `PAKET.md` i
repo-förslaget eller `LAS-MIG.md` i driftsättningspaketet. Paketets SQL-installer
ersätter körning av de separata migrationsfilerna och innehållsfilen nedan; kör inte båda vägarna.

## 1. Granska och bygg koden

Vibo-sidan finns i `apps/vibofast` i Vi-hem-förslaget, som ett separat Vite-projekt
med egen package.json och lockfil. Vi-hem får endast en ny modul och ett meny-/sidval.
Den befintliga Vi-hem-installationen och dess paketlås ändras inte.

Hämta senaste GitHub-versionen före merge och kontrollera Claudes nya ändringar.
Merga inte automatiskt. Bygg Vi-hem normalt, och hemsidan separat:

```sh
cd apps/vibofast
npm ci
npm run typecheck
npm test
npm run build
```

## 2. Installera de två nya migrationerna

Ta en aktuell backup och kör först mot din staging-kopia av den delade databasen.
Kontrollera att `vihem_organisations`, `vihem_profiles`, `vihem_properties`,
`vihem_apartments`, `vihem_tenancies` och `vihem_termination_requests` finns med
kolumnerna som migrationen refererar till. Även `vihem_agreements`,
`vihem_agreement_versions` och `vihem_agreement_entity_links` används för framtida signerade avtal. Organisation, behörighet och Avtal V2:s
koppling till hyresförhållanden måste motsvara aktuell Vi-hem-version.

Kör endast dessa två nya migrationer, i denna ordning:

1. `supabase/migrations/20261006113000_vihem_profile_authority_guard.sql`
2. `supabase/migrations/20261006120000_vihem_vibofast_website.sql`

I den fristående leveransen har hemsidemigrationen namnet
`202610060001_vibo_website.sql`; profilskyddet har samma namn som ovan.
Kör varje fil en gång, aldrig båda kopiorna av hemsidemigrationen.
Varje migration omsluts av en transaktion.

Använd inte `db reset`, historiska/demo-migrationer eller generell `db push`
på den delade installationen för denna leverans.

Hemsidemigrationen skapar ett separat privat schema, egna RPC-funktioner och en
bildbucket. Den läser befintliga Vi-hem-tabeller utan att ändra deras data eller RLS.

Profilskyddet är ett separat tillägg: en INSERT/UPDATE-trigger på `public.vihem_profiles`.
Den blockerar oauktoriserade ändringar av roll, organisation, aktiv status och
konto-ID. Vanlig profilredigering fortsätter fungera. Aktiva organisationsadmin kan
hantera roller/aktivering inom sin organisation, men inte befordra till superadmin
eller byta konto-ID. Aktiva superadmin kan hantera roll och organisation; befintliga
serveranrop med service_role och databasoperatörer fortsätter fungera.
Kontoskapande via befintlig service_role fortsätter fungera. Direkta INSERT kräver
aktiv admin inom rätt organisation eller aktiv superadmin. Befintliga policies,
användardata och andra appars tabeller lämnas kvar.
Verifiera särskilt kontohantering och organisationsbyte i staging innan driftsättning.

## 3. Bind rätt organisation och lägg in initialt innehåll

Verifierat via skrivskyddad ZeroTier/SSH-kontroll 2026-10-06: Vi-hem använder
containern `supabase-db`. Organisationen är Vibogruppen AB med ID
`38fe702d-e72c-49a2-9750-5e0b6934959b`. Kontrollera samma ID i staging innan körning.

I samma SQL-session som innehållsfilen körs:

```sql
SET vihem_vibofast.organisation_id = '38fe702d-e72c-49a2-9750-5e0b6934959b';
```

Kör därefter `docs/vibofast/initial-content.sql` i Vi-hem-förslaget, eller
`supabase/initial-content.sql` i fristående leverans. Filen skriver bara initialt
innehåll till den nya tabellen och skriver aldrig över befintligt hemsideinnehåll.
Innehållet är hämtat från Bolt-utkastet: kontrollera telefon, policyer och kunskapsbank före lansering.
Lägenhetsannonser importeras inte från utkastets exempel. Fyll i och aktivera rätt annonser i Vi-hem.

Alla aktiva profiler med rollen `admin` i den bundna organisationen Vibogruppen AB
får automatiskt administrera hemsidan. Ingen separat redaktörslista eller manuell
registrering av konton används. Åtkomsten försvinner direkt när rollen, organisationen
eller aktiv status ändras. Rollen `superadmin` ger inte hemsideåtkomst i sig.

Kontrollen av produktion visade självredigerbara roller/organisationer i befintlig
Vi-hem-RLS. Därför måste det nya profilskyddet installeras innan hemsideadministration
aktiveras. Profilskyddet ändrar inte de befintliga RLS-reglerna.
RPC:erna har låst search_path och explicita execute-behörigheter; det privata schemat
ska inte läggas till PostgREST:s exponerade schema-lista.

## 4. Installera en enda ny Edge Function

Installera `vihem-vibofast-enquiry` manuellt enligt din egen Supabase-serverprocess.
Låt all annan funktionskod och konfiguration vara kvar.
Den publika funktionen kan konfigureras utan JWT-verifiering om din gateway kräver det
för publishable-nycklar; detta ska gälla enbart denna funktion, inte andra appar.

Servermiljö:

- `SUPABASE_URL`: den delade Supabase-installationen.
- `SUPABASE_SERVICE_ROLE_KEY`: endast i funktionens servermiljö.
- `VIBOFAST_ALLOWED_ORIGINS`: `https://vibofast.se,https://www.vibofast.se`.
- `VIBOFAST_RATE_LIMIT_SECRET`: en slumpmässig hemlighet för hashning av begränsningsnycklar.

Funktionen validerar längder, obligatoriska fält, fältnamn och CORS-origin.
Databasen begränsar till fem anmälningar per timme och hashad avsändare.
På egen server: låt den betrodda reverse proxyn skriva över `x-real-ip` och blockera
extern direktåtkomst till funktionsservern. Utan betrodd IP används e-post som begränsningsnyckel.
CORS är inte en autentiseringsmekanism. E-postbegränsning ensam kan kringgås genom olika adresser.

## 5. Bygg och lägg ut hemsidan

Använd bara `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` eller
`VITE_SUPABASE_PUBLISHABLE_KEY` i Vite. Sätt `VITE_DEMO_MODE=false`.
Bygg med `npm run build`, kopiera `dist/` till webbservern och konfigurera SPA-fallback,
HTTPS samt DNS för vibofast.se. Inga DNS-/serverändringar har gjorts av Codex.

## 6. Verifiera före lansering

Kontrollera med riktiga staging-konton att:

- Alla aktiva Vibo-admin kan redigera annonser, bilder, sidinnehåll och läsa anmälningar.
- Hyresgäster, personal, inaktiva konton och andra organisationers admin saknar åtkomst.
- Ny adminroll ger automatiskt åtkomst; nedgradering eller organisationsbyte tar bort åtkomst.
- Vanliga användare kan inte befordra sig själva eller byta organisation via profiluppdatering.
- Endast aktiverade och fullständiga annonser visas offentligt.
- Avtalslut 2027-01-31 visar inflyttning 2027-02-01.
- Godkänd uppsägning fungerar även när tidigare flöde lämnat tenancy.end_date tomt.
- Ett nytt hyresförhållande döljer annonsen och blockerade/renoverade objekt inte visas.
- Bilder, formulär, CORS och rate limit fungerar genom din egen gateway.
- App.vi-hem.se öppnas från Mina sidor och hyresgästinformationen.

Lokala tester ersätter inte denna stagingkontroll av den riktiga datamodellen och proxyn.
Vid problem: återställ tidigare frontendbygge och låt tilläggstabellerna vara kvar.
Att lämna tillägget utan innehåll eller med alla annonser avaktiverade ger ingen publicering.
