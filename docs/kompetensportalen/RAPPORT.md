# Kompetensportalen 2.0 – slutrapport

Status 2026-10-13. Läs tillsammans med `PLAN.md` (inventering, arkitektur, beroenden). Här står vad som är **byggt**, **testat**, **verifierat i produktion**, vad som **återstår** och vilka **begränsningar** som gäller. Inget i den här rapporten är markerat som produktionsverifierat om det bara är testat med simulerade händelser.

## 1. Sammanfattning

| Del | Byggt | Testat | Verifierat i produktion |
|---|---|---|---|
| Databas (`vihem_kp_*`, 5 migrationer) | Ja | SQL-tester (~70 kontroller, RLS + kolumnrättigheter) | Migrationer applicerade, loggade i ledger |
| Edge Functions (`vihem-kp-public/checkout/stripe/learn/admin/worker`) | Ja | E2E-svit (60 kontroller) | Driftsatta, matchar repo |
| VI-HEM-modul (15 vyer) | Ja | `tsc`, bygge | Släppt (revision 49fd117). **Inte genomklickad i webbläsare av mig** |
| Publik webbplats + deltagarmiljö + företagsportal | Ja | Typkontroll, bygge, förhandsvisning (start, katalog, kontakt, FAQ, verifiering, inloggning, mobil 375 px) mot riktigt API; enkel tillgänglighetskontroll (rubriker, labels, alt, overflow) | **Ej publicerad** – väntar på rotinstallation av nginx-vhost (se 4) |
| Enhetstester TS-hjälpare (`npm run test:kp`) | – | 22 kontroller: personnummer, AES-GCM-kryptering, Stripe-signatur, URL-omskrivning, certifikat-PDF (`pdfinfo`) | – |

## 2. Byggt

- **Kursbyggare** med kurs → moduler → lektioner → block (video, text, bild, PDF, ljud, kunskapskontroll, länk), dra-och-släpp, duplicering och versionerad publicering (publicerad version är oföränderlig, gamla resultat och intyg bevaras).
- **Spelare** med serverbaserad uppföljning: heartbeat var 5:e sekund, täckning lagras som intervall, lektion godkänns av servern, fortsätt-position mellan enheter. Bildfrågor i prov hämtas via ägarkontrollerad signerad URL.
- **Provmotor**: frågebank, slump av urval och alternativ, tidsgräns, försöksgräns, väntetid, förkunskapskrav, rättning i SQL, facit lämnar aldrig servern, manuell överstyrning med spårbarhet.
- **Intyg**: PDF på servern med QR, mall, unikt nummer, publik verifiering med minimiuppgifter, återkallelse/ersättning med historik. Typerna utbildningsintyg och kompetensbevis hålls isär; inget påstår extern certifiering.
- **ID06**: statusmaskin (väntar / behandlas / registrerad / kräver åtgärd / misslyckad). Ingen API-integration finns; ärenden hamnar i `kräver åtgärd` för manuell hantering. Framgång simuleras aldrig.
- **Handel**: pris- och rabattmotor, företagspriser, moms per rad, historiska priser på orderrader, order/betalning/plats/behörighet som separata begrepp, idempotens, partiell/full återbetalning, tvist, Stripe Checkout med webhook-styrd åtkomst, fakturaköp med godkännande.
- **Företag**: platsköp, inbjudan, tilldelning, återtagande av ostartade platser, överlåtelse, framsteg per anställd; personens historik följer personen.
- **Kurstillfällen**: kapacitet under radlås, väntelista, avbokning/ombokning, närvaro, påminnelser.
- **Kommunikation**: redigerbara mallar, outbox med unik idempotensnyckel och återförsök.
- **Rapporter**: ordervärde, mottagna betalningar och återbetalningar redovisas separat; CSV med BOM (öppnas i Excel).

## 3. Tester

- `scripts/test_kp_sql.sh` – SQL-logik (kvot, order, betalning, platser, prov, intyg, RLS). Grönt.
- `npm run test:kp` – 22 enhetskontroller. Grönt.
- `scripts/kp/run-e2e.sh` – 60 kontroller mot riktig miljö (produktionsdatabas och funktioner, testdata märkt `@e2e.kp.test`, städas alltid; senast `kurser=0 ordrar=0 kunder=0 användare=0`). Täcker uppdragets flöden 1–15.

### Viktiga förbehåll för E2E
- **Kortbetalning**: Stripe-nycklar saknas. Betalningar testades med syntetiska Stripe-händelser genom samma hanterare som webhooken använder. Signaturverifieringen är enhetstestad men ingen riktig Stripe-transaktion eller riktig webhook har körts.
- **Faktura**: WPE Sweden AB saknar Accounted-koppling. Fakturaorder får `invoice_status = needs_action`; ingen faktura har skapats i Accounted.
- **E-post** har inte skickats på riktigt (testadresser stänger kön, avsändare ej konfigurerad).
- **Video** testades som lagrad progressiv MP4 i signerad URL; riktig uppspelning i webbläsare, adaptiv kvalitet och undertexter är inte verifierade end-to-end.
- **ID06**, **BankID** och **Odoo-import** är inte testade (finns ingen åtkomst/avtal).
- Inte gjort: formell WCAG-granskning (skärmläsare, tangentbord genom hela köpflödet), prestandamätning/lasttest, test med äldre konton, genomklickning av hela admin-gränssnittet och av kurssida/kassa/spelare i webbläsare.

## 4. Det som kräver dig (externa beroenden)

1. **Publicera sajten**: `sudo bash apps/kompetensportalen/deploy/install.sh`, därefter `~/deploy_sites.sh kompetensportalen`. Redigera även `~/deploy_multi_app.sh` på servern (ta backup) så att det inte längre publicerar den gamla frontenden över webbroten.
2. **Stripe**: `apps/kompetensportalen/deploy/set-keys.sh --prepare`, därefter utan flagga. Sätter `VIHEM_KP_SECRET_KEY` (personnummerkryptering) och `STRIPE_KP_*`. Lägg webhook-adress i Stripe och slå på "Kortbetalning aktiv" i inställningar. Kör en riktig testbetalning (Stripe testläge) innan skarp drift.
3. **Accounted** för WPE Sweden AB i VI-HEM Ekonomi.
4. **E-post**: avsändardomän (Google Workspace-delegering eller SMTP) och aktivera arbetaren (`vihem_system_settings`-rad `kp_worker` med `enabled`, `function_url` = `http://kong:8000/functions/v1/vihem-kp-worker`, `secret`).
5. **Juridik**: köpvillkor, integritet, ångerrätt och fakturavillkor är utkast. Kassan vägrar sälja tills de publicerats. Säljardata (org.nr, momsnr, adress) ska in i inställningar.
6. **ID06**: avtal/API-behörighet. Tills vidare manuell rutin i ID06-vyn.
7. **BankID**-beslut, **Odoo-export** (kurser, användare, resultat), riktigt **kursinnehåll**, **videoplattform** för adaptiv strömning.

## 5. Begränsningar och kända luckor

- Paket (bundles) finns i datamodellen men saknar gränssnitt.
- Automatiskt gallringsjobb för personuppgifter saknas; gallring sker manuellt tills policy fastställts.
- Certifikatlogotyp stöds bara som JPEG.
- Excel-export är CSV (UTF-8 med BOM).
- Videotranskodning (ffmpeg) finns inte på servern.
- Rate limits är per användare/token, inte per IP.

## 6. Drift

- **Backup**: databas och lagring omfattas av serverns befintliga backuprutin (`/mnt/md0/supabase-backups`). Privat bucket `vihem-kp-private` innehåller videor och provbilder; profilbilder/chattbilagor berörs inte.
- **Hemligheter**: aldrig i repot. Nycklar sätts på servern via `set-keys.sh`.
- **Deploy**: SQL via dry-run + ledger, funktioner via tar + omstart av edge-runtime, VI-HEM via `~/deploy_vihem.sh`, sajt via `~/deploy_sites.sh kompetensportalen`. Släppvakten kräver att ändrade migrationer/funktioner matchar ledger/installerade kopior.
- **Lokal förhandsvisning**: `KP_DEV_PROXY=https://supabase.asedatruckmeet.se npm --prefix apps/kompetensportalen run dev` med `.env.local` (ej incheckad) som pekar `VITE_SUPABASE_URL` på `http://localhost:5210`; proxyn skriver om `Origin` till kompetensportalen.se.
- **Gamla systemet**: de gamla funktionerna `api`, `stripe-webhook`, `cron-daily` och schemat `kompetensportalen` (0 rader) är orörda. Pensionera efter att nya sajten är publicerad och verifierad.
