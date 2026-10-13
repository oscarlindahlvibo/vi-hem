# ViboRent – publik webbplats för uthyrning

ViboRent är den publika frontenden för VI-HEM:s uthyrningsmodul (`rental_management`). VI-HEM är enda sanningskällan för produkter, priser,
tillgänglighet, bokningar, betalningar, avtal och låskoder. Webbplatsen äger bara presentation och kassaflöde.

## Arkitektur
- **Frontend** (`apps/viborent`, Vite + React + TypeScript): `/` startsida, `/hyra` katalog (sök/filter/sortering, `?kategori=`), `/hyra/:slug` produkt med kalender,
  antal och live-pris, `/varukorg`, `/kassa` (uppgifter, avtal + signatur, betalning), `/bokning/:referens?token=…` bokningssida (avboka, kodstatus),
  `/kundportal` inloggad portal. Gamla adresser (`/shop`, `/produkt/…`) pekas om. Sitemap genereras vid bygge (`scripts/postbuild.mjs`), JSON-LD och meta sätts per sida.
- **Publikt API** (`supabase/functions/vihem-public-rental`): organisation härleds ur `Origin` via `vihem_rental_domains` (aldrig ur klientens body), all indata valideras,
  endast kända felkoder (`[E_…]`) når kunden, skrivande anrop hastighetsbegränsas.
- **Betalning** (`vihem-rental-stripe`): Checkout-session endast med bokning + hemlig token, retur-URL:er låsta till organisationens egna domäner,
  webhook med signatur, belopp-/valutakontroll och idempotens.
- **Databasen** (`20261017*_viborent_2_*.sql`): prismotor (lägsta pris, prioritet/säsong, kombinationer), tillgänglighet (per objekt + produktövergripande spärrar + buffert),
  atomär bokning med betalningsreservation som förfaller (cron varje minut), serverstyrd avbokning, versionerade avtal, lås/åtkomstkoder.
- **Åtkomstkoder** (`vihem-rental-access-worker`, `_shared/igloohome.ts`): AlgoPIN via igloohome, krypterad lagring, SMS via Cellsynt, aldrig i loggar. Se `deploy/STRIPE.md`.
- **Admin**: VI-HEM → Uthyrning (produkter/priser med prisprov, spärrar, bokningar med kodpanel och avbokning, *Lås & åtkomst*, *Avtal*, inställningar).

## Utveckling
```bash
npm --prefix apps/viborent ci
VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm --prefix apps/viborent run dev
npm --prefix apps/viborent run typecheck
```
Miljövariabler (publika, inga hemligheter): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, valfritt `VITE_PUBLIC_RENTAL_API_URL`, `VITE_RENTAL_SITE_HOSTNAME` (bara lokal utveckling), `VITE_RENTAL_SITE_URL` (sitemap).

## Tester
- `npm run test:rental` – enhetstester för igloohome-klient, tidsformat, kryptering, Stripe-signatur, återbetalning, felmappning (mockad HTTP, inga riktiga anrop).
- `scripts/test_viborent_sql.sh` – SQL-tester (pris, tillgänglighet, race, reservation, avbokning, kodschema, avtal) i en transaktion som alltid rullas tillbaka.
- `scripts/viborent-api-check.mjs` – integrationstest mot en riktig miljö (skapar och raderar egna testbokningar). Se filens huvud för miljövariabler.

## Driftsättning
Engångs (root): `sudo bash apps/viborent/deploy/install.sh` (vhost för viborent.se + www, certifikat, lösenordsfri publicering).
Nycklar: `bash apps/viborent/deploy/set-keys.sh --prepare` och sedan `bash apps/viborent/deploy/set-keys.sh`.
Publicera: `~/deploy_sites.sh viborent`. Återställning: tidigare webbrot sparas av `site-publish` (`/var/backups/site-publish/viborent`).

## Kontrollpunkt 2026-10-13 – kassa och produktflöde
- Pris/offert kopplas till aktuella varukorgsrader och period; köp stoppas vid omladdning/fel, gamla svar ignoreras, riktade återförsök. Ändra datum behåller period/antal och ersätter raden utan dubblett.
- Produktbild begränsad på mobil/iPad; bokning före lång beskrivning, kompakt iPad-kalender och tvåkolumnsfält. Valfria företags-/adress-/meddelandefält i utfällbar sektion, utan ändrade indataregler. Frånpriser inkl. moms när produkt-/organisationsmomssats är känd; annars fortsatt uttryckligt exkl. moms. Backendens beräkningar oförändrade.
- Avtal hämtas före signering. Saknad aktiv version, känd platshållare, versionsavvikelse och hämtningsfel stoppar kassan. Reservationens avtalsögonblicksbild kontrolleras före signering. Tomt tryck i signaturrutan räcker inte längre.
- Samtidiga formulärsubmit låses. SHA-256 av bokningsindata jämförs vid återförsök (inga nya kunduppgifter i localStorage). Reservation behålls vid fel, även äldre reservationer utan kontrollsumma får en synlig väg till bokningssidan. Ändrade uppgifter kräver återställning eller avbokning; serverbekräftat avbokad reservation kan ersättas vid nytt försök.
- PASS: TypeScript, build, befintliga uthyrningsenhetstester, lint utan fel (4 befintliga Fast Refresh-varningar). Isolerad localhost-QA: datumändring/ersatt rad, långsam offert/rensa/gammalt svar, varukorgsprisfel/återförsök, tom signatur, dubbeltryck (1 reservation/1 signering), betalningsfel/återförsök utan ny reservation, ändrade kunduppgifter blockeras, platshållaravtal/hämtningsfel/återhämtning. Mobil 390, iPad 768 och desktop 1440 visuellt granskade. Inga riktiga bokningar, meddelanden eller betalningar.
- Ej publicerat. Aktivera riktig avtalstext och kontakt-/hämtningsuppgifter i VI-HEM före verklig användning; frontendkontrollen ersätter inte servervalidering. Server-idempotens vid tappat svar från bokningsskapandet återstår, liksom verklig Stripe-/SMS-/låsverifiering. Inga databas- eller backendändringar ingår.
