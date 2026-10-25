# VI-HEM Mail – slutrapport (branch `feature/vihem-mail`)

Datum: 2026-10-25. Status: **utvecklingsklart för granskning och användartest, ej driftsatt.** Inget är mergat, inga produktionsmigrationer är körda, inga nya Google-scopes är aktiverade, inga nya API-abonnemang är skapade.

## Hur testerna ska läsas
| Test | Vad det bevisar | Vad det **inte** bevisar |
|---|---|---|
| `npm run test:mail` (59 kontroller) | MIME-bygge (verifierat mot Pythons e-postparser), tolkning, Gmail-klientlogik **mot lokala mockar**, utskicksledger/dubblettskydd, DWD-token med genererad RSA-nyckel, signatur/alias/svarslogik, mallar | Att Gmail faktiskt accepterar anropen |
| `npm run test:mail:sql` (26 kontroller) | Behörighetsmodell, grants/revoke, personliga brevlådor, ledger-constraints, kört i en transaktion som rullas tillbaka mot riktiga schemat | Beteende under last |
| Webbläsargranskning med mockdata (`mail-harness.html`, ej incheckad) | Rendering och interaktion på mobil (375), iPad (768) och desktop; sanering av farlig HTML (script/onerror borttagna, externa bilder blockerade, CSP + sandbox); skrivruta, signaturblock, ångra-skicka med fördröjning, `client_request_id`, utkastsparning, ärendepanel, admin, inställningar | Att något fungerar mot riktiga Gmail |
| `npm run typecheck`, `npm run build`, eslint | Kompilerar utan fel (endast varningar) | – |

**Ingen funktion är verifierad mot ett riktigt Gmail-konto.** Läsvägarna (gmail.readonly) använder samma delegering som den befintliga söktjänsten, men VI-HEM Mails egna anrop är inte körda live. Skrivvägarna kan inte köras förrän `gmail.modify` godkänns.

## Fullt implementerat (kod + test enligt ovan)
- Arkitektur och licensgranskning (Zero MIT, `docs/mail/PLAN.md`, `ZERO-UPSTREAM.md`).
- Behörighetsmodell per användare och brevlåda (läsa/skicka/hantera/administrera, kombinerbara), kontrolleras i servern vid varje anrop; admin-rollen ger inte automatiskt läsning av personliga brevlådor; personlig åtkomst kräver orsak, ägare notifieras, ingen självtilldelning; återkallande gäller direkt; klienten har ingen direktåtkomst till tabellerna.
- Samlad inkorg och flera brevlådor; delade brevlådor; äldre sök/bevakningar respekterar `restricted`.
- Trådlista (paginering, cache, History-polling var 30 s, optimistiska åtgärder med ångra, svep på mobil, kortkommandon), trådvy, bilagor (förhandsvisning, nedladdning, spara i Dokument + koppling).
- Säker HTML-visning (DOMPurify + sandboxad iframe + CSP, externa bilder blockerade per mejl/inställning, cid-bilder inbäddade).
- Skrivruta: Tiptap, Svara/Svara alla/Vidarebefordra (inkl. bilagor), avsändare från Gmail sendAs (server validerar alltid – frontendens `from` litas aldrig på), signatur per alias som markerat block (byts vid avsändarbyte, skriver aldrig över manuellt ändrad signatur, ingen dubbel signatur), autospar av utkast i Gmail, kopia/hemlig kopia/svarsadress, bilagor (20 MB), mallar med variabler, ångra skicka (8 s), schemalagt utskick.
- Säkert utskick: ledger före Gmail-anrop, eget Message-ID, osäkert utfall vid nätverksfel kontrolleras via `rfc822msgid:` innan nytt försök, ingen automatisk omsändning av skrivanrop.
- Delad inkorg som ärende: status, prioritet, ansvarig (endast personer med läsrätt), interna kommentarer (skickas aldrig), kopplingar via generisk länkmodell, närvaro ("någon svarar"), skapa arbetsorder från mejl (förifylld, tråden kopplas efter sparande).
- Snooze och schemalagda utskick via arbetare (cron per minut, inaktiv tills inställningsrad finns).
- Admin: brevlådor, åtkomstläge, behörigheter, granskningslogg. Inställningar: notiser (läge, visa avsändare av som standard, viktiga avsändare), externa bilder, standardbrevlåda, mallar.
- Audit-logg för läsning, åtkomst nekad, utskick, behörighetsändringar m.m.

## Delvis / begränsat
- **Skriv- och skickfunktioner är inaktiva i drift tills `gmail.modify` godkänns** (se `DRIFT.md`). Läsning fungerar med nuvarande scope.
- Snooze, schemalagt utskick och "ångra skicka" är VI-HEM:s egna implementationer (Gmails API har ingen sådan funktion): ångra skicka fördröjer anropet i webbläsaren – stängs fliken inom 8 sekunder skickas inte mejlet (utkastet finns kvar). Schemalagda utskick körs av arbetaren och kräver att den aktiveras.
- Notiser: arbetaren skapar VI-HEM-notiser enligt användarens läge och utan dubbletter; push till låsskärm återanvänder befintlig notiskanal (ej separat testad på enhet).
- Kontaktförslag byggs bara från adresser i inlästa trådar (ingen People API-behörighet).
- Sök använder Gmails söksyntax via Gmail-API (from:, has:attachment, label: …) över tillåtna brevlådor; ingen egen sökindexering – mycket stora brevlådor beror på Gmails svarstid.
- Listan är sidindelad men inte virtualiserad.
- Fyra av arbetsytemodulerna i uppdraget (anteckningar, påminnelser) saknas som egna moduler i VI-HEM; kopplingsmodellen stödjer typerna men det finns inget gränssnitt att skapa dem från mejl.
- Utskick utan nätverkskontroll under 8 s-fördröjningen: se ovan.

## Ej gjort
- Gmail Pub/Sub-push (kräver Google Cloud-uppsättning och eventuell kostnad; History-polling används).
- OAuth för personliga Gmail-konton utanför Workspace (kräver Googles verifiering/säkerhetsgranskning, tid och kostnad).
- Test på riktig iPad/iPhone-enhet (endast emulerade bredder).
- Live-test mot Gmail för skriv/skicka.
- Automatiska UI-tester (Playwright). Granskningen gjordes manuellt med mockdata.

## Licenser och kostnader
- Zero (MIT) – licenstext bevarad; ingen logotyp/varumärke. Tiptap 2.23 (MIT), DOMPurify 3.2.5 (MPL-2.0/Apache-2.0). Ingen Inbox Zero-kod.
- Nya kostnader: inga. Framtida möjliga: Google Cloud Pub/Sub, Googles säkerhetsgranskning (CASA) för personlig OAuth.

## Risker att känna till
- Äldre `org_shared`-brevlådor är läsbara för hela personalen via den gamla söken tills admin sätter `restricted`.
- `gmail.modify` ger bredare rättigheter än `readonly` för tjänstekontot – bör godkännas medvetet.
- Migrationerna är additiva men bör köras i en testmiljö/backup först.

## Nästa steg (förslag)
1. Godkänn migrationer + scope i en kontrollerad ordning (`DRIFT.md`), börja med en delad testbrevlåda.
2. Kör verifierande live-test av läsning, svar och skicka mot testbrevlådan; notera avvikelser.
3. Aktivera arbetaren och prova schemalagt utskick/snooze.
4. Användartest på iPad/mobil; justera.
