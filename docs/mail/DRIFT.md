# VI-HEM Mail – driftsättning (kräver godkännande, inget av detta är gjort)

Branch: `feature/vihem-mail`. **Inget är mergat, driftsatt eller migrerat i produktion.** Stegen nedan görs först efter uttryckligt godkännande, i den här ordningen.

## 1. Databas (additiva migrationer)
1. `supabase/migrations/20261101100000_vihem_mail_core.sql` – tabeller, behörighetsfunktioner, utskicksledger, snooze, ärenden, mallar, audit. Befintliga tabeller får bara nya kolumner (`access_mode`, `client_enabled`, `kind`, `owner_user_id`) med standardvärden som bevarar nuvarande beteende (`org_shared`). Utvidgar audit-CHECK med alla redan använda actions.
2. `supabase/migrations/20261101110000_vihem_mail_worker.sql` – cron-jobb `vihem-mail-worker` (gör inget förrän inställningsraden finns).
3. Verifiera efteråt: `npm run test:mail:sql` (körs i en transaktion som rullas tillbaka).
4. Anteckna migrationerna i `applied-migrations.tsv` på servern om de körs manuellt.

## 2. Edge functions
- `vihem-mail` (ny, JWT krävs).
- `vihem-mail-worker` (ny, `verify_jwt = false`, skyddad av hemlig header; finns i `supabase/config.toml`).
- `vihem-gmail` (ändrad: respekterar `access_mode = restricted` och lagt till `visibleAccounts()`). Redeploya – äldre sök/bevakningar beter sig oförändrat för `org_shared`-brevlådor.

## 3. Worker-inställning
Lägg in raden `mail_worker` i `vihem_system_settings` med `{"enabled": true, "function_url": "<url till vihem-mail-worker>", "secret": "<slumpad hemlighet>"}` (hemligheten genereras av användaren/skript – skrivs inte in i chatt eller kod).

## 4. Google-behörighet (Admin Console → Säkerhet → API-kontroller → Domänövergripande delegering)
Nuvarande scope: `gmail.readonly` → **läsning, sökning, Skickat/Utkast-listor, sendAs-lista fungerar redan**.
För skriv- och skickfunktioner (arkivera, läst/oläst, stjärna, etiketter, papperskorg, utkast, skicka, snooza) krävs att `https://www.googleapis.com/auth/gmail.modify` läggs till för samma klient-ID. **Detta är inte aktiverat och görs bara efter godkännande.** Tills dess svarar skriv-anrop med `SCOPE_NOT_AUTHORIZED` och gränssnittet visar ett begripligt meddelande. Permanent radering (`mail.google.com`) används inte – papperskorgen används.

## 5. Behörigheter och första uppsättning
1. Admin öppnar E-post → Brevlådor och behörigheter.
2. Sätt delade brevlådor till `Begränsad`, tilldela personer läs/skicka/hantera.
3. Personliga brevlådor: ägaren får åtkomst; annan åtkomst kräver orsak och notifierar ägaren.
4. Befintliga brevlådor står kvar som `org_shared` (läsning för hela personalen i äldre sök) tills admin ändrar.

## 6. Ej konfigurerat / medvetet utelämnat
- Gmail Pub/Sub-push: ej uppsatt (kräver Google Cloud-projekt och ev. kostnad). Ändringar hämtas via History API var 30:e sekund.
- Personliga Gmail-konton utanför Workspace (OAuth): kräver Googles verifiering/säkerhetsgranskning – inte byggt.
- Inga nya API-abonnemang har skapats.

## Utfört 2026-10-25 (godkänt av användaren)
- Databasbackup: `/home/vibo/db-backups/pre-mail-20261025T162504Z.sql.gz`.
- Migrationerna `20261101100000` och `20261101110000` tillämpade i produktion och införda i `applied-migrations.tsv`. Verifierat: 17 tabeller `vihem_mail_*`, cron-jobbet finns, 10 befintliga brevlådor står kvar som `org_shared`.
- Edge functions kopierade till `volumes/functions` (`_shared/mail`, `vihem-mail`, `vihem-mail-worker`, `vihem-gmail`) och runtime omstartad. Röktest utan inloggning: `vihem-mail` 401 (kräver JWT), `vihem-mail-worker` 403 (kräver hemlighet), `vihem-gmail` 401.
- `/home/vibo/vi-hem`-utcheckningen är orörd. Ännu ej gjort: worker-inställning (`mail_worker`), scope `gmail.modify`, frontend-merge/deploy.
