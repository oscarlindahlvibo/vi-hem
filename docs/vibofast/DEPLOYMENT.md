# Manuell driftsättning: Vibo och delad Supabase

Utgångspunkt: Vi-hem `origin/main` på commit `8300a2f`, inklusive Claudes senaste
ändringar för signerade avtal och hyresförhållanden. Skrivskyddade kontroller har utförts mot den delade Supabase-instansen via ZeroTier.
Inga produktionsskrivningar har gjorts. SQL har verifierats i en isolerad lokal PostgreSQL-modell.

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

## 2. Installera bara tilläggets migration

Ta en aktuell backup och kör först mot din staging-kopia av den delade databasen.
Kontrollera att `vihem_organisations`, `vihem_profiles`, `vihem_properties`,
`vihem_apartments`, `vihem_tenancies` och `vihem_termination_requests` finns med
kolumnerna som migrationen refererar till. Även `vihem_agreements`,
`vihem_agreement_versions` och `vihem_agreement_entity_links` används för framtida signerade avtal. Organisation, behörighet och Avtal V2:s
koppling till hyresförhållanden måste motsvara aktuell Vi-hem-version.

Kör endast `supabase/migrations/20261006120000_vihem_vibofast_website.sql` i Vi-hem-förslaget.
I den fristående Vibo-leveransen heter samma fil `202610060001_vibo_website.sql`.
**Kör en av dem, aldrig båda.** Migrationen omsluts av en transaktion.

Använd inte `db reset`, inte historiska/demo-migrationer och inte generell `db push`
på den delade installationen för denna leverans.

Migrationen skapar ett separat privat schema, egna RPC-funktioner och en bildbucket.
Den läser befintliga Vi-hem-tabeller och ändrar inte deras data, RLS eller definitioner.
Den lägger bara till bucketavgränsade storage-policyer och en ny bucket utan att ändra andra buckets.
Det finns inga demoanvändare, ändringar av auth.users eller global policyändring.

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

Lägg därefter till en uttryckligen verifierad hemsideredaktör som databasoperatör:

```sql
INSERT INTO vihem_vibofast_private.editors (profile_id)
SELECT id FROM public.vihem_profiles
WHERE id = 'VERIFIERAD_REDAKTORS_UUID'::uuid
  AND organisation_id = '38fe702d-e72c-49a2-9750-5e0b6934959b'::uuid
  AND role = 'admin' AND active
ON CONFLICT DO NOTHING;
```

Använd ID för det verifierade inloggningskontot, aldrig alla profiler med rollen admin.
Hemsidans åtkomst kräver denna separata lista, rätt organisation och aktiv adminprofil.
Kontrollen av produktion visade självredigerbara roller/organisationer i befintlig
Vi-hem-RLS. Dessa befintliga regler ändras inte av hemsidemigrationen och behöver
utredas separat. Hemsidans privata redaktörslista kan inte ändras av inloggade användare.
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

- Vibo-admin kan redigera annonser, bilder, sidinnehåll och läsa anmälningar.
- Hyresgäster och andra organisationers admin saknar denna åtkomst.
- Endast aktiverade och fullständiga annonser visas offentligt.
- Avtalslut 2027-01-31 visar inflyttning 2027-02-01.
- Godkänd uppsägning fungerar även när tidigare flöde lämnat tenancy.end_date tomt.
- Ett nytt hyresförhållande döljer annonsen och blockerade/renoverade objekt inte visas.
- Bilder, formulär, CORS och rate limit fungerar genom din egen gateway.
- App.vi-hem.se öppnas från Mina sidor och hyresgästinformationen.

Lokala tester ersätter inte denna stagingkontroll av den riktiga datamodellen och proxyn.
Vid problem: återställ tidigare frontendbygge och låt tilläggstabellerna vara kvar.
Att lämna tillägget utan innehåll eller med alla annonser avaktiverade ger ingen publicering.
