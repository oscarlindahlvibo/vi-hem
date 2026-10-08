# Kontrollerad chattrelease

Oscar har godkänt att äldre mobilversioner får förlora chattfunktionen. Webb/backend kan därför införas utan att invänta alla gamla installationer. En ny iPhone-version byggs från den nya koden. Android-push är en separat aktivering: Firebase-konfiguration och en fysisk Android-verifiering saknas. Övriga Android-chattfunktioner använder samma backend.

## Förbered och publicera manuellt

Paketet bygger exakt den separata chattbranchen ovanpå granskad `main`. Ingen installation sker vid paketering. `package.py` kräver ren, committad kod och hämtar bara serverns filhashar och konfigurationsmetadata, aldrig nycklar eller meddelandetext.

```sh
python3 scripts/chat-release/package.py /valfri/ny/paketmapp
```

Överför paketmappen till servern. Kör där:

```sh
sudo python3 /var/tmp/vihem-chat-release/install.py --check
sudo python3 /var/tmp/vihem-chat-release/install.py --rehearse
sudo python3 /var/tmp/vihem-chat-release/install.py --apply
```

Använd sökvägen där det aktuella paketet ligger. Bara `--apply` publicerar. `--rehearse` kör migrationerna och kontrollerna i en transaktion som alltid rullas tillbaka. Inga meddelanden skickas. Kontrollerna stoppar vid ändrad GitHub-main/chattbranch, ändrat live-index, avvikande berörda edgefiler, fel migrationshash eller oväntade Realtime-inställningar. Efter merge eller nya pushar måste paketet byggas om från den granskade versionen; det ska inte kringgås genom att ändra manifestet manuellt.

Införandet tar en skyddad fullständig databasdump, verifierar att `pg_restore` kan läsa arkivets innehåll, säkerhetskopierar tidigare webb och berörda edgefiler. Det är en läsbar backupkontroll, inte en fullständig återläsningsövning. Sex chattmigrationer körs i **en** transaktion med tidsgränser. Alla befintliga meddelande-ID:n, texter, avsändare, tider och gamla bilage-URL:er jämförs innan commit. RLS, publikation och privata bucketar kontrolleras. En skyddad databasjournal registrerar hash atomiskt med schemaändringen; hostens befintliga ledger kompletteras efter commit. Ett avbrott mellan dessa kan återupptas utan att köra migrationerna igen.

Endast två nya edgefunktioner, pushsändaren samt tre namngivna delade hjälpfiler kopieras. Befintlig autentisering/CORS/router måste matcha granskad serverversion och ersätts inte. Inga andra `_shared`-filer raderas. Edge-runtime startas om för att kasta cachade workers; detta innebär ett kort avbrott även för andra funktioner i just den delade runtime-instansen. Databas, Auth och Storage startas inte om.

Realtime höjs från den verifierade gränsen 100 till den QA-testade gränsen **1000 händelser/s** genom Realtime 2.76.5:s administrations-API. Andra gränser bevaras. API:t uppdaterar cache och kan koppla ned befintliga klienter när konfigurationen byts. Det gäller den gemensamma Supabase-instansen, inte enbart VI-HEM. Välj en lugn deploytid och följ CPU/minne/lagg samt andra appars återanslutning. Ändringen är förberedd, inte redan gjord i produktion.

Webbfiler kopieras med nya assets först och index sist; gamla assethashar behålls. Publicerat index och entry-assets verifieras via HTTPS. Vid fel efter backendens commit ska den nya webbreleasen repareras/återförsökas. En automatisk återgång till gamla direkta databasskrivningar vore inkompatibel och görs därför inte. Ingen automatisk återställning av den delade databasen görs.

## Äldre bilagor

Den vanliga installationen lämnar originalfiler och deras publika bucket oförändrade. När nya webb/native-klienter är ute körs `scripts/migrate-chat-attachments.mjs` först utan `--apply`, därefter separat med `--apply` och `CHAT_MIGRATION_BACKUP` via skyddad servermiljö. Det verifierar SHA-256 för original/kopia, bevarar original och stänger publik åtkomst först efter atomiskt referensbyte. Gamla klienter kan därefter också förlora åtkomsten till dessa chattbilagor, i enlighet med användarens accepterade utfasning.

## Releaseprov

Två riktiga konton/enheter behöver efter införandet kontrollera: skicka/svara direkt, läskvitto utan att andra dialoger blir lästa, bild/HEIC, dokument, röst och tangentbord/safe areas, samt iPhone-push som öppnar rätt meddelande. Detta kräver användarens enheter; simulator/webbresponsivitet kan inte bevisa riktig APNs-leverans. Produktionsnyckeln kan verifieras med en avsiktligt ogiltig syntetisk token utan att en användare kontaktas, men det är ingen leveransverifiering.

Android-push kräver rätt Firebase-projekt, Android-appen `se.vihem.app`, `android/app/google-services.json` och serverns `FCM_SERVICE_ACCOUNT_JSON`. Inga nycklar får läggas i Git eller deployutdata. Ingen Firebase-app/projekt/behörighet ska gissas fram. APNs i produktion är befintligt konfigurerat för `se.vihem.app`.

Status ska skilja mellan **webb/backend klar för kontrollerat införande**, **iPhone-bygge verifierat** och **fysisk iOS/Android-release verifierad**. Avsaknad av Android-push behöver inte blockera en uttryckligen avgränsad webb/iPhone-release, men får inte beskrivas som fullt stöd för alla plattformar.
