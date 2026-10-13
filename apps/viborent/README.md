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
- Publicering godkänd 2026-10-13, avgränsad till `deploy_sites.sh viborent` med backup och hashkontroll. Aktivera riktig avtalstext och kontakt-/hämtningsuppgifter i VI-HEM före verklig användning; frontendkontrollen ersätter inte servervalidering. Server-idempotens vid tappat svar från bokningsskapandet återstår, liksom verklig Stripe-/SMS-/låsverifiering. Inga databas- eller backendändringar ingår.

2026-10-13: Juridisk uthyrare för viborent.se ändrad till WPE Sweden AB i startsida, metadata, sidfot och kassa. Central webbidentitet i `src/lib/siteIdentity.ts`; backendens organisationstillhörighet och historiska data oförändrade. Korrigerat avtalsförslag i `docs/viborent/hyresavtal-v2.md`, inte aktiverat i databasen. TypeScript/build PASS. Publicering avgränsad till ViboRent-webbplatsen.


## BankID och aktivt avtal – 2026-10-13
Avtal v2 med WPE Sweden AB aktivt (5276 tecken); v1 bevarad, äldre bokningar oförändrade. Backup av tidigare avtalsversioner: `/home/vibo/vihem-release-backups/viborent-contract-20261013/contract-versions-before.sql`.
BankID återanvänder VI-HEM:s BankSignering-inställningar och befintliga leverantörsklient. Publika ViboRent-åtgärder kontrollerar organisation/domän + hemlig bokningsnyckel före leverantörsanrop. Ny privat tabell `vihem_rental_bankid_orders` och service-only RPC binder signering till avtalsversion, belopp, deposition, kund och hyresrader. Signatur/OCSP/personnummer lagras AES-GCM-krypterat, aldrig i publika svar. Slutförande är atomiskt/idempotent och avvisar ändrad/utgången/avbokad bokning.
Installationsordning: `20261021100000_rental_bankid.sql`, sedan `_shared/kp-bankid.ts`, `_shared/rental-bankid.ts`, `vihem-public-rental/index.ts`, därefter ViboRent-webb. Befintlig VI-HEM/Avtal V2-signering och mobilapp ändras inte. BankID erbjuds när samma organisations koppling är konfigurerad och signering aktiverad; handritad signatur kvarstår som val.
PASS: ny migrationsinstallation i isolerad QA; negativa organisations-/boknings-/bevis-/utgångs-/ändringsprov, privata läs-/RPC-rättigheter, rollback, idempotens och två samtidiga slutföranden. QA-baslinjens ViboRent v2 installerad utan cronregistrering (QA saknar cron); produktionsbaslinjen är redan installerad. Provider-mock `node scripts/viborent-bankid-check.mjs`, befintliga rental/KP-enhetstester, frontend-TS/build/lint. Browser med enbart syntetisk transport: start, dubbeltryck, väntan/slutförande och betalningsfel, misslyckad signering och bevarat formulär. Ingen riktig signering eller betalning utförd.
Kvarstående verifiering: en verklig användare måste genomföra BankID på mobil/QR och kontrollera leverantörens visade företagsnamn samt Stripe-övergång. Testmiljön skickar inte verkliga BankID-anrop. Full server-idempotens vid tappat bokningsskapandesvar kvarstår separat.

Backend installerad och hashkontrollerad 2026-10-13. Backup: `/home/vibo/vihem-release-backups/rental-bankid-20261013T092515Z`. Live-preflight PASS: aktivt WPE-avtal v2, BankID-kapabilitet, fel bokningsnyckel/bokning och okänd Origin avvisas utan leverantörsanrop. Frontend publiceras efter denna kontroll.
