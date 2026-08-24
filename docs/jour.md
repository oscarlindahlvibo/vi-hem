# Jour (fastighetsjour & snöjour) — arkitektur och status

## 1. Datamodell

En modell, inte två separata system: `duty_type` (`'fastighet' | 'sno'`) är
ett fält på varje jourpass, inte en egen tabell/modul per typ. En person
kan ha fastighets- **och** snöjour samtidigt -- det är bara två rader.

- `vihem_jour_eligibility` -- vem som är behörig för vilken jourtyp
  (admin sätter, per person och typ).
- `vihem_jour_rotation_templates` + `vihem_jour_rotation_template_slots`
  -- ett "grundschema" är en ordnad lista av (person, antal dagar)-segment
  som upprepas cykliskt från ett ankardatum. Materialiseras till konkreta
  `vihem_jour_shifts`-rader via RPC:n `vihem_generate_jour_shifts_from_template(template_id, until_date)`
  (admin-only, körs från "Grundschema"-fliken) -- idempotent, hoppar över
  varje del av perioden som redan har ETT jourpass av samma typ (oavsett
  vem det tillhör), så en admins manuella justering aldrig tyst skrivs
  över av en omkörning.
- `vihem_jour_shifts` -- de faktiska passen. **Dubbelbokning inom samma
  jourtyp är omöjlig på databasnivå**, inte bara i applikationskod:
  ```sql
  ALTER TABLE vihem_jour_shifts ADD CONSTRAINT vihem_jour_shifts_no_overlap
    EXCLUDE USING gist (user_id WITH =, duty_type WITH =, tstzrange(starts_at, ends_at) WITH &&);
  ```
  Två överlappande pass av SAMMA typ för SAMMA person är omöjligt att
  spara. Olika typ (fastighet + snö) överlappar aldrig varandra i denna
  spärr -- en person får gärna ha båda samtidigt.
- `vihem_jour_swap_offers` -- bytesmarknaden. En innehavare annonserar sitt
  eget pass (`allow_partial` styr om bara hela passet kan tas, eller om
  någon kan ta en valfri del av tidsintervallet). Status
  `open → claimed | cancelled | expired`.

## 2. Bytesmarknaden: server-side, atomärt

All affärslogik för byten körs i en `BEFORE UPDATE`-trigger på
`vihem_jour_swap_offers` (`vihem_before_jour_swap_offer_update`), inte i
frontend-kod eller en edge-funktion:

- **"Först till kvarn" är atomärt** -- klienten gör en vanlig
  `UPDATE ... WHERE status = 'open'`; Postgres rad-lås garanterar att bara
  en av flera samtidiga klaim-försök lyckas (verifierat med två riktiga
  parallella databassessioner, se avsnitt 4).
- **Behörighetskoll**: klaimaren måste finnas i `vihem_jour_eligibility`
  för rätt jourtyp, annars avvisas klaimet (`RAISE EXCEPTION`, hela
  transaktionen rullas tillbaka).
- **Delning**: fyra fall hanteras -- helt pass (byt bara `user_id`), klaim
  från början eller slutet (krymp originalet, ny rad för klaimaren), och
  klaim från mitten (originalet delas i TVÅ kvarvarande delar åt
  ursprungspersonen plus en ny rad för klaimaren).
- **Dubbelbokningsspärren gäller garanterat även vid byten**: om
  klaimaren redan har ett överlappande pass av samma typ, slår
  EXCLUDE-constraint till på triggerns egen INSERT/UPDATE, hela
  transaktionen rullas tillbaka, annonsen förblir `open`.
- Notiser: en separat `AFTER INSERT`-trigger
  (`notify_jour_swap_offered`) mejlar/notifierar alla i
  `vihem_jour_eligibility` för samma jourtyp (utom annonsören själv) --
  samma mönster som `notify_staff_absence_submitted()`.

## 3. Modul & frontend

Registrerad som en valfri modul (`vihem_module_registry` +
`vihem_organisation_modules`), avstängd som standard -- aktiveras per
organisation i Organisationer-sidan (superadmin) eller direkt i databasen.
`src/pages/JourPage.tsx` har fem flikar: **Dagbesked** (Gantt-liknande
tidslinje, adapterad från `RentalPage.tsx`s kalendermönster),
**Byten** (bytesmarknaden), **Mitt schema** (egna pass +
"Annonsera byte"), och admin-only **Behörighet** (kryssrutematris) +
**Grundschema** (rotationsmallar + "Generera jourpass"-knapp).

Alla läsningar/skrivningar går direkt via supabase-js + RLS (samma
mönster som `AdminStaffPage.tsx`/`listMyAgreements()`) -- ingen
edge-funktion behövs eftersom all atomär logik redan ligger i
databasen.

## 4. Verifiering

Två riktiga buggar hittades och fixades under verifieringen (inte bara
typkontrollerat -- körd mot en riktig lokal databas):

1. `SUM(duration_days) OVER (...)` returnerar `bigint`, och
   `date + bigint` finns inte som operator i Postgres -- kastade fel vid
   varje generering. Fixat med en explicit `::integer`-cast.
2. RPC-generatorns "hoppa över om redan täckt"-logik kollade bara om
   klaimaren (SAMMA person) redan hade en överlappande rad -- en admins
   manuella omplacering till en ANNAN person blev osynlig för spärren,
   så nästa generering lade en konkurrerande rad ovanpå. Fixat med en
   explicit `EXISTS`-koll mot ALLA pass av samma typ i intervallet,
   oavsett vem de tillhör, innan en ny rad ens försöker skapas.

Verifierat med riktiga databassessioner (`SET LOCAL role authenticated` +
`request.jwt.claims`, samma teknik som användes för att testa RLS-policyer
tidigare i sessionen):

- Två överlappande pass, samma person, samma typ → avvisas av
  EXCLUDE-constraint.
- Samma person, överlappande, OLIKA typ → går igenom.
- Två parallella klaim-uppdateringar på samma annons, riktiga samtidiga
  databassessioner → exakt en lyckas, den andra får noll påverkade rader
  utan fel.
- Alla fyra delningsfall (helt/början/slut/mitt) körda och resulterande
  radernas start/slut/ägare kontrollerade.
- Klaim som skulle skapa en dubbelbokning → avvisas, annonsen förblir
  `open`.
- Klaim av en icke-behörig person → avvisas.
- Notistriggern → exakt (och bara) de behöriga för samma jourtyp
  notifieras, aldrig annonsören själv.
- RPC-generatorn → rätt rotationssekvens, idempotent omkörning (0 nya
  rader), utökning av intervallet (bara de nya raderna), och en
  manuellt omplacerad vecka bevaras korrekt vid omkörning.
- Fullständig klick-för-klick-verifiering i webbläsaren som en riktig
  inloggad admin (via token-injektion, se övriga dokument i denna
  session för tekniken): skapade en rotationsmall, genererade jourpass,
  bekräftade att Gantt-vyn visar dem korrekt, annonserade ett pass för
  byte, och bekräftade att annonsen visas i Byten-fliken och att
  notisen gick fram till rätt person -- allt via faktiska knapptryck,
  inte bara direkta databasanrop.
- All testdata skapad och raderad i den lokala databasen efteråt.

## 5. Kvarstående (inte byggt)

- Ingen automatisk generering (t.ex. ett cron-jobb som förlänger
  schemat N veckor framåt) -- admin klickar "Generera jourpass" manuellt.
  Motiverat av att inget cron-mönster finns i kodbasen att haka i idag.
- Ingen "expired"-hantering av gamla, aldrig plockade annonser (statusen
  finns i CHECK-constrainten men inget sätter den automatiskt).
- Ingen push-notis/SMS för jourbyten, bara in-app-notisen.
