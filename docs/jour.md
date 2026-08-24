# Jour (fastighetsjour, snöjour & städjour) — arkitektur och status

## 1. Datamodell

En modell, inte separata system per jourtyp: `duty_type`
(`'fastighet' | 'sno' | 'stad'`) är ett fält på varje jourpass, inte en
egen tabell/modul per typ. En person kan ha flera jourtyper samtidigt --
det är bara flera rader.

- `vihem_jour_eligibility` -- vem som är behörig för vilken jourtyp
  (admin sätter, per person och typ).
- `vihem_jour_rotation_rules` -- ett "grundschema" är INTE längre en delad
  linjär cykel. Varje rad är en OBEROENDE, redigerbar regel: "person X har
  jourtypen var `interval_weeks`:e vecka, `duration_weeks` veckor åt
  gången, från `start_date`". Flera regler kan gälla SAMMA person samtidigt
  (t.ex. "var 3:e vecka" + "var 6:e vecka" som två separata rader) -- när
  deras beräknade tillfällen råkar hamna intill varandra i tiden blir det
  naturligt två veckor i rad, vilket är precis det uttryckta behovet.
  Ersatte den ursprungliga `vihem_jour_rotation_templates` +
  `_template_slots` (en delad cykel av (person, dagar)-segment i strikt
  turordning), som strukturellt inte kunde uttrycka två oberoende kadenser
  för samma person -- bytet gjordes rakt av eftersom mallmodellen aldrig
  hann användas på riktigt. Materialiseras till konkreta
  `vihem_jour_shifts`-rader via `vihem_generate_jour_shifts_from_rule(rule_id, until_date)`
  (en regel) eller bulk-hjälparen
  `vihem_generate_jour_shifts_for_duty_type(organisation_id, duty_type, until_date)`
  (alla aktiva regler för en jourtyp, en admin-knapptryckning) -- båda
  idempotenta, hoppar över varje del av perioden som redan har ETT
  jourpass av samma typ (oavsett vem det tillhör eller vilken regel som
  skapade det), så en admins manuella justering, eller en annan regels
  intilliggande tillfälle, aldrig tyst skrivs över av en omkörning.
  **Handover-klockslag: 07:00 svensk lokal tid**, inte midnatt. Varje
  regel-genererat tillfälle (start OCH slut) beräknas som
  `(datum + tid '07:00') AT TIME ZONE 'Europe/Stockholm'` -- det
  korrekta Postgres-idiomet för "det här klockslaget, som lokal tid i
  Stockholm", vilket automatiskt hanterar sommartidsväxlingar (t.ex.
  ett tillfälle beräknat före och efter en DST-växling landar båda på
  exakt 07:00 lokal tid, trots att UTC-offseten skiljer). Ett tidigare
  försök att bara casta `date::timestamptz` gav midnatt UTC, vilket i
  svensk sommartid blev 02:00 -- ett omotiverat klockslag för ett
  jourbyte.
- `vihem_jour_shifts` -- de faktiska passen. `user_id` är **nullable**:
  `NULL` betyder ett obemannat/öppet pass som vem som helst med rätt
  behörighet kan plocka, helt eller delvis, via bytesmarknaden (se
  nedan). **Dubbelbokning inom samma jourtyp är omöjlig på
  databasnivå**, inte bara i applikationskod:
  ```sql
  ALTER TABLE vihem_jour_shifts ADD CONSTRAINT vihem_jour_shifts_no_overlap
    EXCLUDE USING gist (user_id WITH =, duty_type WITH =, tstzrange(starts_at, ends_at) WITH &&);
  ```
  Två överlappande pass av SAMMA typ för SAMMA person är omöjligt att
  spara. Olika typ (fastighet/snö/städ) överlappar aldrig varandra i
  denna spärr -- en person får gärna ha flera samtidigt. `NULL`
  `user_id` behandlas som distinkt av EXCLUDE (precis som UNIQUE), så
  flera obemannade pass av samma typ FÅR överlappa varandra -- rimligt
  eftersom "dubbelbokning" inte är meningsfullt för ett pass utan ägare.
- `vihem_jour_swap_offers` -- bytesmarknaden. En innehavare (eller admin,
  för ett obemannat pass) annonserar. `offer_start_at`/`offer_end_at`
  (båda NULL som standard = hela passet) är den ANNONSERADE delen -- man
  kan annonsera ut t.ex. bara torsdagen av en veckolång jour istället för
  hela passet. `allow_partial` styr om NÅGON kan ta MINDRE än den
  annonserade delen (inte mindre än hela passet). Status
  `open → claimed | cancelled | expired`.

## 2. Bytesmarknaden: server-side, atomärt

All affärslogik för byten körs i triggers på `vihem_jour_swap_offers`,
inte i frontend-kod eller en edge-funktion:

- `vihem_before_jour_swap_offer_insert` (BEFORE INSERT) -- validerar att
  en annonserad delmängd (`offer_start_at`/`offer_end_at`) ligger inom
  passets egna gränser.
- `vihem_before_jour_swap_offer_update` (BEFORE UPDATE) -- klaim/avbryt.
  **"Först till kvarn" är atomärt** -- klienten gör en vanlig
  `UPDATE ... WHERE status = 'open'`; Postgres rad-lås garanterar att bara
  en av flera samtidiga klaim-försök lyckas (verifierat med två riktiga
  parallella databassessioner, se avsnitt 4).
- **Behörighetskoll**: klaimaren måste finnas i `vihem_jour_eligibility`
  för rätt jourtyp, annars avvisas klaimet (`RAISE EXCEPTION`, hela
  transaktionen rullas tillbaka).
- **Delning: EN generell brytpunktsalgoritm** hanterar alla lägen (helt
  pass, del i början/slutet/mitten, med eller utan en delvis annonserad
  delmängd, tilldelat eller obemannat pass) istället för separata fall.
  Breakpoints är de sorterade, deduplicerade gränserna
  (passets start/slut, den annonserade delens start/slut, det klaimade
  intervallets start/slut). Det klaimade segmentet återanvänder/uppdaterar
  ORIGINALRADEN (görs FÖRST, innan några andra INSERT, för att undvika en
  falsk självöverlappning mot originalradens fortfarande-fulla intervall).
  Varje annat (kvarvarande) segment:
  - Om originalpasset var **obemannat** (`user_id IS NULL`): förblir
    obemannat OCH får en FRÄSCH öppen `vihem_jour_swap_offers`-rad
    (för vidarebefordrar `offered_by`/`allow_partial`/`note` från den
    gamla annonsen) -- oavsett om segmentet låg inom eller utanför den
    ursprungligen annonserade delen, eftersom ett obemannat pass inte har
    någon ägare att återgå till. Det är detta som gör att "plockar någon
    en del mitt i ett obemannat pass finns det direkt två nya pass att
    plocka" -- exakt det uttryckta kravet.
  - Om originalpasset var **tilldelat**: återgår till samma ursprungsägare,
    INTE återannonserat (matchar hur ett vanligt person-till-person-byte
    av en del av ett tilldelat pass redan fungerade innan denna
    utökning).
- **Dubbelbokningsspärren gäller garanterat även vid byten**: om
  klaimaren redan har ett överlappande pass av samma typ, slår
  EXCLUDE-constraint till på triggerns egen INSERT/UPDATE, hela
  transaktionen rullas tillbaka, annonsen förblir `open`.
- Notiser: en separat `AFTER INSERT`-trigger
  (`notify_jour_swap_offered`) notifierar alla i `vihem_jour_eligibility`
  för samma jourtyp (utom annonsören själv) -- samma mönster som
  `notify_staff_absence_submitted()`. Gäller "gratis" även för de
  fräscha annonser som klaim-triggern skapar åt kvarvarande delar av ett
  obemannat pass, eftersom de också går via ett vanligt INSERT.

## 3. Schema-Gantt: fem tillstånd per jourtyp

Dagbeskedets Gantt (både desktop och mobil) visar inte bara "vem har
jour", utan VILKET TILLSTÅND passet är i just nu, med en egen palett
(`STATE_CLASS` i `JourPage.tsx`, separat från de badge-färger
Byten/Mitt schema/Behörighet använder):

- **Ljus nyans per jourtyp** (blå/gul/lila) -- ordinarie schemaläggning
  (`source`-agnostisk, bara "det här är personens eget pass").
- **Mörk nyans per jourtyp** -- personen har TAGIT ÖVER passet via ett
  byte. Härleds direkt från `vihem_jour_shifts.notes = 'Byte av pass'`,
  som klaim-triggern redan sätter.
- **Brun** (gemensam för alla jourtyper) -- personen har BYTT BORT
  tiden till någon annan. Det finns inget kvarvarande passrad för detta
  (ägarskapet flyttades), så det REKONSTRUERAS från klaimade annonser
  där personen var `offered_by`, med `claim_start_at`/`claim_end_at`
  som exakt intervall -- samma händelse som ger mottagaren ett mörkt
  segment ger alltså avsändaren ett brunt segment i sin egen rad.
- **Grön** (gemensam) -- passet (eller en del av det) är ute för byte
  just nu (`vihem_jour_swap_offers.status = 'open'`), klippt till
  `offer_start_at`/`offer_end_at`.
- **Röd** (gemensam) -- personen är samtidigt godkänt frånvaroanmäld
  (`vihem_staff_absence_requests.status = 'approved'`) under en period
  då de annars skulle setts som schemalagda/tagit över/ute för byte --
  röd målas ÖVER den färgen för den överlappande delen, högst
  prioritet. Hämtas via `vihem_jour_absence_overlaps(from, to)`, en
  SECURITY DEFINER-funktion som medvetet läcker NÄR (start/slutdatum)
  men aldrig VARFÖR (`absence_type`/`comment` exponeras inte) -- en
  avgränsad avvikelse från `vihem_staff_absence_requests`s annars
  strikta RLS (personal ser annars bara sina egna anmälningar), motiverad
  av att ett delat jourschema behöver kunna visa "ej i tjänst" för alla
  som tittar på det, inte bara admin.

Ett pass delas vid varje brytpunkt (passets egna gränser, den
annonserade delens gränser, en frånvaros gränser) till en sorterad
lista av segment, var och en färgad efter vilket tillstånd som gäller
just då -- samma brytpunktsmönster som klaim-triggerns delning i
databasen, fast i frontend för visualisering.

### Mobil: person-rader med initialer, timelinjal och dragbart tidsreglage

Mobilvyn (under `md`) fick en större omarbetning för att likna
Daedalos referensvyer: smala rader (en per person och jourtyp, initialer
istället för namn i en färgad cirkel -- `initials()`), en timelinjal i
huvudet (dag/vecka/14-dagars/månads-header, eller en 24-timmarsklocka i
dagläge), och ett DRAGBART tidsreglage (grön linje + klockslags-bubbla)
som scrubbar en `scrubTime`-state över hela det synliga fönstret via
pekar-events (`onPointerDown/Move/Up`, `touch-action: pan-y` så
vertikal sidscroll fortfarande fungerar). Ett kort drag (< 6px) tolkas
som ett TAPP istället för en drag -- tappar man på ett segment öppnar
det "Hantera jourpass" (samma modal som desktop-Gantten), annars
flyttar tappet reglaget dit. Under Gantt-tabellen visas "PERSONAL I
TJÄNST [scrubbat klockslag]" -- alla som har status schemalagd/tagit
över/ute för byte (INTE bytt bort eller frånvarande) vid exakt den
scrubbade tidpunkten, med initialer, jourtyp-badge och fullt namn --
uppdateras reaktivt i realtid när reglaget dras.

## 4. Modul & frontend

Registrerad som en valfri modul (`vihem_module_registry` +
`vihem_organisation_modules`), avstängd som standard -- aktiveras per
organisation i Organisationer-sidan (superadmin) eller direkt i databasen.
`src/pages/JourPage.tsx` har fem flikar:

- **Dagbesked** -- två vyer beroende på skärmstorlek: på desktop en
  Gantt-liknande tidslinje (adapterad från `RentalPage.tsx`s
  kalendermönster), en rad per (person eller "Obemannat", jourtyp); på
  mobil (under `md`-brytpunkten, som ersatte den tidigare horisontellt
  scrollande Gantt-tabellen som var svårläst på smal skärm) tappbara
  dag-pills (idag förvalt) + en lista över vem som har jour den valda
  dagen, med tiden KLIPPT till den dagen (t.ex. "08:00 - 14:00", eller
  "Hela dagen" om passet täcker hela dygnet) så att en klyvpunkt mitt på
  dagen (två personer, samma dag, olika pass) är tydlig -- en sekundär
  rad visar hela passets fulla datumspann när det sträcker sig över
  fler än en dag. `dateKey()` bygger dagnyckeln av lokala
  datumkomponenter (år/månad/dag), INTE `toISOString()`, eftersom en
  UTC-baserad nyckel skiftar kalenderdagen ett dygn för alla
  tidszoner med positiv offset (t.ex. Europe/Stockholm) -- detta orsakade
  tidigare att "idag" (både pill-markeringen och auto-valet) visade FEL
  dag.
  **Vygranularitet är valbar**: Dag/Vecka/14 dagar/Månad
  (`ViewMode`, `VIEW_MODE_DAYS` = 1/7/14/30), en knappgrupp ovanför
  tidslinjen. Att byta vy hoppar tillbaka till "idag" för den nya
  granulariteten (`anchorForMode()`) istället för att behålla en
  eventuellt udda deljusterad startpunkt. Kolumnbredden per dag
  (`VIEW_MODE_COL_MIN`) är bredare i Dag/Vecka-läge (plats för
  tid-etiketter) och smalare i 14-dagars/Månads-läge (fler kolumner
  måste rymmas). Gantt-stapelns synliga text visar nu klockslag, inte
  bara datum -- `HH:MM-HH:MM` när passet ligger inom en enda dag,
  annars fullt datum+tid för start/slut -- så att en delning mitt på
  dygnet är läsbar direkt i stapeln, inte bara i hover-tooltippen.
  **Dag-läget är en riktig 24-timmarsklocka, inte en dagruta**: en
  enda kolumn med en timlinjal (00, 02, 04, ..., 22) i huvudet, och
  passens position/bredd beräknas som en tidsandel av dygnet
  (`hourPosition()`/`hourSpan()`, klippt till [00:00, 24:00)) istället
  för hela-dagen-granulariteten `position()`/`span()` som resten av
  vyerna använder -- annars hade två pass samma dag (t.ex. 02:00-17:00
  och 17:00-20:00) båda ritats som att de täckte HELA dagens bredd,
  eftersom day-granulariteten bara känner till "vilken dag", inte "vilken
  tid på dagen". En röd linje visar nuvarande klockslag när den valda
  dagen är idag.
  **Admin kan klicka på ett pass** (både i Gantt-stapeln och
  mobil-listraden) för att öppna "Hantera jourpass" med fyra
  handlingar: **Annonsera för byte** (samma annons-flöde som "Mitt
  schema", men för VILKET pass som helst, inte bara admins eget --
  redan möjligt via den befintliga RLS-policyn som redan tillät
  admin/superadmin att annonsera ett pass de inte äger), **Dela pass**
  (kryper originalets `ends_at` till en vald klyvpunkt + infogar ett
  nytt pass för resten, med valfri ny ägare -- ett direkt
  admin-verktyg, skilt från bytesmarknadens annonsera-och-vänta-flöde),
  **Tilldela till någon annan** (`UPDATE ... SET user_id = ...`,
  dubbelbokningsspärren `EXCLUDE`-constrainten gäller precis som vid
  alla andra skrivningar), och **Radera pass** (`DELETE`, kaskaderar
  automatiskt bort en ev. öppen annons via `ON DELETE CASCADE` på
  `vihem_jour_swap_offers.shift_id`). Ett pass som redan har en öppen
  annons visar en varning och "Annonsera"-knappen inaktiveras (för att
  undvika två samtidiga annonser på samma pass). Personal ser INTE
  klick-att-hantera-affordansen alls -- de kan bara annonsera sina egna
  pass (Mitt schema) och plocka annonserade (Byten), oförändrat.
- **Byten** -- bytesmarknaden. Visar den annonserade delen (inte
  nödvändigtvis hela passet), en "Obemannat"-badge för öppna pass, och
  för admin en **"Skapa öppet pass"**-knapp+modal som skapar ett
  obemannat pass av valfri jourtyp och annonserar det i samma steg.
  Klaim-modalen begränsar tidsväljaren till den ANNONSERADE delen, inte
  alltid hela passet.
- **Mitt schema** -- egna pass + "Annonsera byte" med val mellan "hela
  passet" och "en del av passet" (datum/tid-väljare för delen).
- Admin-only **Behörighet** (kryssrutematris, en kolumn per jourtyp i
  `DUTY_TYPES`) + **Grundschema** (en sektion per jourtyp, rader av
  redigerbara rotationsregler med "Ändra"/radera, en
  "Generera jourpass"-knapp per jourtyp som anropar
  `vihem_generate_jour_shifts_for_duty_type`, och en **"Rensa
  genererade"**-knapp som raderar alla KOMMANDE (`starts_at > now()`)
  pass av den jourtypen med `source = 'template'` -- dvs. bara
  automatgenererade pass som inte redan bytts eller manuellt redigerats
  (ett bytt/redigerat pass får `source = 'manual'` av klaim-triggern
  respektive splitten ovan, så det är strukturellt skyddat mot att
  rensas bort av misstag). Ger admin ett rent sätt att slänga ett gammalt
  genererat schema och köra om generatorn efter att ha ändrat
  rotationsreglerna.

Alla läsningar/skrivningar går direkt via supabase-js + RLS (samma
mönster som `AdminStaffPage.tsx`/`listMyAgreements()`) -- ingen
edge-funktion behövs eftersom all atomär logik redan ligger i
databasen.

## 5. Verifiering

### Ursprunglig implementation

Två riktiga buggar hittades och fixades (mallmodellen, sedan ersatt --
se ovan):

1. `SUM(duration_days) OVER (...)` returnerar `bigint`, och
   `date + bigint` finns inte som operator i Postgres. Fixat med en
   explicit `::integer`-cast (motsvarande problem finns inte i
   regelmodellen, som bara använder enkel heltalsaritmetik).
2. Generatorns "hoppa över om redan täckt"-logik kollade bara samma-person-
   överlapp, inte alla ägare. Fixat med en explicit `EXISTS`-koll mot ALLA
   pass av samma typ i intervallet, oavsett ägare -- samma mönster
   återanvänt i den nya regelbaserade generatorn.

### Städjour + flexibla rotationsregler + obemannade/delade pass (denna utökning)

Två YTTERLIGARE riktiga buggar hittades och fixades i den omskrivna
klaim-triggern, upptäckta via en regressionstest (klaim av mittendel på
ett TILLDELAT pass, som redan fungerade innan denna utökning):

1. Villkoret för "ska det kvarvarande segmentet återannonseras?" var
   först felaktigt kopplat till om segmentet låg INOM den annonserade
   delen -- det gjorde att ett vanligt TILLDELAT pass' kvarvarande delar
   (som normalt utgör hela passet, eftersom `offer_start_at`/`_end_at` är
   NULL som standard) felaktigt återannonserades som obemannade.
   `ERROR: conflicting key value violates exclusion constraint`. Fixat:
   villkoret är nu enbart `v_shift.user_id IS NULL` (var passet
   någonsin tilldelat någon alls), helt oberoende av den annonserade
   delens gränser.
2. Brytpunktsloopen bearbetade segment i kronologisk ordning, men koden
   som omtilldelar ORIGINALRADEN till det klaimade segmentet kördes bara
   när loopen nådde just det segmentet -- om ett TIDIGARE (kronologiskt
   först) kvarvarande segment för SAMMA ägare bearbetades först,
   kolliderade dess INSERT med originalraden som fortfarande hade sitt
   FULLA, okrympta intervall vid den tidpunkten. Samma felmeddelande som
   ovan. Fixat: `UPDATE ... WHERE id = v_shift.id` som omtilldelar
   originalraden till det klaimade segmentet körs nu OVILLKORLIGEN och
   FÖRST, innan brytpunktsloopen ens startar; loopen hoppar sedan
   explicit över det klaimade segmentet och hanterar bara genuina
   kvarvarande bitar via nya INSERT.

Verifierat med riktiga databassessioner (`SET LOCAL role authenticated` +
`request.jwt.claims`) och riktig psql mot en lokal sandbox-databas:

- `vihem_generate_jour_shifts_for_duty_type` med två regler för samma
  person (var 3:e + var 6:e vecka) → producerade exakt de förväntade
  tillfällena, INKLUSIVE två fall av två veckor i rad när tillfällena
  råkade hamna intill varandra -- precis det uttryckta behovet.
  Idempotent omkörning bekräftad (0 nya rader).
- `städ` som jourtyp respekterar EXCLUDE-spärren precis som `fastighet`/
  `sno`.
- Regressionstest: klaim av mittendel på ett TILLDELAT pass →
  kvarvarande delar återgår korrekt till ursprungsägaren, INGEN
  återannonsering (efter de två buggfixarna ovan).
- Nytt scenario: klaim av mittendel på ett OBEMANNAT pass → tre
  resulterande pass (obemannat/klaimare/obemannat), tre resulterande
  annonser (den klaimade + två nya öppna), notiser gick fram för de nya
  annonserna också (via den redan existerande `AFTER INSERT`-triggern,
  ingen ny notiskod behövdes).
- Delvis ANNONSERAT pass (Erik annonserar bara en del av en tvåveckors
  jour) → klaimarens tidsväljare begränsas korrekt till den annonserade
  delen, klaim inom den delen fungerar, de yttre delarna återgår till
  Erik utan återannonsering.
- Validering av annonsens gränser (annonsera utanför passets egna
  gränser) → avvisas korrekt av `BEFORE INSERT`-triggern.
- Fullständig klick-för-klick-verifiering i webbläsaren som TRE riktiga
  inloggade användare (admin + två personal, via token-injektion):
  satte behörighet för städjour, skapade två överlappande
  rotationsregler och genererade jourpass (bekräftade "2 veckor i rad"-
  mönstret även i Gantt-vyn), skapade ett obemannat städjour-pass som
  admin, klaimade mittendelen som personal (bekräftade två nya öppna
  pass i Byten-fliken), annonserade en delmängd av ett eget tilldelat
  pass, och klaimade en del av DEN delmängden som en tredje person
  (bekräftade att ytterdelarna återgick utan återannonsering) -- allt
  via faktiska knapptryck i UI:t, inte bara direkta databasanrop.
- All testdata (pass, annonser, regler, behörigheter) skapad och
  raderad i den lokala databasen efteråt; modulen återställd till
  avstängd för demo-organisationen.

### Mobil dagbesked, tidszonsbugg och admin-hantering av enskilda pass (denna utökning)

Ingen ny migration -- helt frontend, eftersom admin redan hade `FOR ALL`
på `vihem_jour_shifts` och redan fick annonsera vilket pass som helst
via den befintliga RLS-policyn på `vihem_jour_swap_offers`.

- Bekräftat att `dateKey()`s tidigare `toISOString()`-baserade
  implementation faktiskt gav fel resultat i en riktig
  `Europe/Stockholm`-webbläsarsession (verifierat direkt:
  `Intl.DateTimeFormat().resolvedOptions().timeZone` → `"Europe/Stockholm"`,
  `new Date().getTimezoneOffset()` → `-120`) -- "idag" markerades och
  auto-valdes en dag FÖR SENT innan fixen, och en dag KORREKT efter.
- Ett delat pass (Erik 08:00–14:00 dag 1, Maja 14:00– dag 2) visar nu
  klyvpunktens exakta tid på handover-dagen i mobil-listan istället för
  bara datum -- verifierat att båda personernas segment visas med rätt
  start/sluttid (`14:00`) på samma dag.
- "Dela pass" (admin, via Dagbesked) testat: krymper originalet och
  infogar en ny rad för resten med en vald ny ägare, verifierat mot
  databasen (rätt `starts_at`/`ends_at`/`user_id` på båda raderna).
- "Tilldela till någon annan" testat, inklusive omtilldelning till
  "Obemannat" (`user_id = NULL`).
- "Annonsera för byte" från Dagbesked (admin, på ett pass som INTE är
  admins eget) testat -- skapar en öppen annons; ett pass som redan har
  en öppen annons visar korrekt varningen och inaktiverar knappen.
- "Radera pass" testat, inklusive att en tillhörande öppen annons
  försvinner automatiskt (`ON DELETE CASCADE`).
- Bekräftat att personal INTE ser klick-att-hantera-affordansen alls
  (inga klickbara rader/staplar i DOM:en) när inloggad som `personal@demo.se`.
- "Rensa genererade" testat: genererade 5 pass från en regel, rensade
  dem, bekräftade att exakt de 5 `source = 'template'`-raderna
  försvann medan två `source = 'manual'`-rader (en delad, en
  omtilldelad) lämnades orörda.
- All testdata skapad och raderad efteråt; modulen återställd till
  avstängd.

### Schema-Gantt: fem tillstånd, mobilt reglage (denna utökning)

Byggd via ett realistiskt scenario med den RIKTIGA byteskedjan (inte
handskrivna testrader): Erik annonserade en delmängd av sitt pass,
Maja klaimade den, plus en separat öppen oklaimad annons på Marias
hela snöjourspass, plus en godkänd sjukanmälan för Erik som delvis
överlappar hans schemalagda tid.
Resultatet verifierat både i databasen och i webbläsaren (som riktig
inloggad admin):

- Alla fem tillstånd renderades med rätt färg OCH rätt tidsintervall
  samtidigt i Eriks rad (röd → ljusblå → brun → ljusblå i kronologisk
  ordning), Majas rad (mörkblå för den klaimade delen), Marias rad
  (grön för hela det oklaimade passet) -- bekräftat via DOM-inspektion
  av varje stapels `title`-attribut och Tailwind-klass.
- Hover-tooltippen ("klicka för att hantera") visas bara på segment
  som har en verklig underliggande passrad (`shiftId` satt) -- det
  BRUNA segmentet (rekonstruerat, ingen kvarvarande rad) saknar
  korrekt klick-affordansen.
- Tryck på ett segment (utan drag) öppnar "Hantera jourpass" för RÄTT
  underliggande pass, verifierat genom att simulera en riktig
  pointerdown/pointerup på en specifik stapel och läsa av vilket pass
  som öppnades.
- Det dragbara tidsreglaget testat genom att simulera tryck (utan
  rörelse, vilket enligt "kort tryck = tapp"-logiken ändå flyttar
  reglaget om trycket inte landar på ett segment) på olika tidpunkter:
  reglaget hoppade till exakt rätt klockslag varje gång, och
  "PERSONAL I TJÄNST"-listan uppdaterades reaktivt -- Erik försvann
  ur listan när reglaget flyttades in i hans bruna (bytt bort) eller
  röda (frånvarande) segment, Maja dök upp i exakt samma ögonblick
  hans bruna segment började.
- Dag-, Vecka- och 14-dagarsvyerna alla testade i mobilbredd (375px)
  -- smala rader, initialer i cirklar, korrekt tidslinjal-header
  (timlinjal i dagläge, datumkolumner annars) i samtliga.
- `vihem_jour_absence_overlaps` verifierad direkt mot databasen som en
  ANNAN användare än den frånvaroanmälda (Maja såg Eriks godkända
  frånvaro men inte en tredje persons ännu ej godkända anmälan) --
  bekräftar att funktionen korrekt kringgår den annars strikta RLS:en
  utan att läcka anmälningar som inte är godkända.
- All testdata (pass, annonser, behörigheter, frånvaroanmälan) skapad
  och raderad efteråt; modulen återställd till avstängd.

## 6. Kvarstående (inte byggt)

- Ingen automatisk generering (t.ex. ett cron-jobb som förlänger
  schemat N veckor framåt) -- admin klickar "Generera jourpass" manuellt
  per jourtyp. Motiverat av att inget cron-mönster finns i kodbasen att
  haka i idag.
- Ingen "expired"-hantering av gamla, aldrig plockade annonser (statusen
  finns i CHECK-constrainten men inget sätter den automatiskt).
- Ingen push-notis/SMS för jourbyten, bara in-app-notisen.
