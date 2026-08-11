# Mobil release

## Lokal bygg- och synksekvens

```sh
npm ci
npm run typecheck
npm run lint
npm run mobile:sync
npm run mobile:ios
npm run mobile:android
```

`npm run mobile:sync` bygger webbappen och kopierar den till både `ios/` och `android/`. Kör den efter varje ändring i `src/` eller `public/`.

## Offline och konflikter

Appskalet cachas av service worker i webb/PWA-läge. Tidstämpling, frånvaro, felanmälan och formulär som skapas utan nät läggs i IndexedDB och skickas i skapad ordning när anslutningen återkommer. Om servern avvisar en ändring som konflikt ligger den kvar lokalt och visas som en röd konfliktindikering i appen i stället för att tyst skrivas över. Den första versionen använder serverns validering som konfliktkälla; slutlig lösning är att användaren granskar och skickar om den aktuella ändringen.

## iOS

1. Öppna `ios/App/App.xcworkspace` i Xcode.
2. Välj Apple Developer Team och ett unikt signing certificate i Signing & Capabilities.
3. Kontrollera bundle id `se.vihem.app`, version och buildnummer.
4. Lägg in App Store Connect-metadata och `https://app.vi-hem.se/privacy-policy.html`.
5. Archive och ladda upp via Xcode Organizer.

## Android

1. Öppna `android/` i Android Studio.
2. Skapa en release-keystore lokalt och förvara den utanför repo:t eller i CI:s secrets.
3. Konfigurera `signingConfigs.release` med CI-secrets, aldrig hårdkodade nycklar.
4. Bygg en signed Android App Bundle (`.aab`) och ladda upp i Play Console.

## Produktionschecklista

- Sätt produktionsvärden för `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` vid build.
- Kontrollera Supabase Auth redirect URLs för webb och native deep links.
- Publicera privacy policy på sekretess-URL:en.
- Konfigurera push/camera permissions bara för funktioner som används.
- Sätt `VIHEM_CRON_SECRET` och kör `vihem-dispatch-scheduled-notifications` varje minut via Supabase Cron eller er deploy-scheduler.
- För native push: konfigurera APNs/FCM-leverans i servermiljön och kontrollera att `vihem_push_tokens` fylls efter första appstarten.
- Testa inloggning, offlinekö, återanslutning, dokumentuppladdning och lösenordsåterställning på riktiga iOS- och Android-enheter.
- Sätt aldrig Supabase service role, OpenAI- eller Google-nycklar i appens buildmiljö eller i Git.

Själva certifikaten och keystores kan inte skapas säkert här utan era utvecklarkonton och ska därför göras i Xcode/Android Studio eller CI med hemliga variabler.
