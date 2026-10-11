# Mobil beta – VI-HEM 3.0

Webb/backend `585b822` installerade 2026-10-11. Mobilversion **3.0 (9)** förberedd; ingen App Store-/Play-publicering gjord.

- `npm run mobile:build` validerar HTTPS/publik Supabase-nyckel, spärrar lokalt superadminläge, tvingar betabegränsningarna och skriver revisionsmetadata. `mobile:sync` och Xcode Cloud använder samma bygge. Vanliga `npm run build` är fortfarande ett normalt webbbygge.
- iOS: privacy-manifest i appresurser för filtidstämplar och appens UserDefaults (badge), uppdaterade kamera-/bildtexter. Android: appdata inkluderas inte i systembackup (lokala sessioner/utkast skyddas); serverlagrad data påverkas inte.
- PASS: TypeScript, mobilbundle, release-konfigurationsprov (service keys/lokala URL:er nekas), chatt/premium-invarianter, plutil, Capacitor-sync, riktigt unsigned iOS Release-arkiv, iOS-simulatorbygge/start till inloggning, Android `bundleRelease`. Lint 0 fel/78 befintliga varningar. Första iOS-byggets disk-I/O-fel löstes med derived data under `/tmp`.
- Lokal distribution-signering saknas: endast Apple Development-certifikat, inget distributionsprofilprov. Android AAB är osignerad; keystore/Firebase saknas. APNs-konfiguration finns på servern för `se.vihem.app`/production, faktisk pushleverans ej provad. Inget fysiskt kamera-/mikrofon-/BankID-prov.
- Xcode Cloud: bygg från uppdaterad main med befintliga `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL`. Hooken tvingar beta-spärrar. Låt Cloud hantera distribution och kontrollera att byggnumret är ledigt/högre än senaste uppladdningen. Börja med TestFlight. Kontrollera App Store Connect-version, integritetsuppgifter, granskningskonto och bilder innan publik publicering.
- Google Drive-bilder/slutprotokoll, Accounted-PDF och äldre icke-chattbilagor förblir begränsade. Dessa behöver inte exponeras i första TestFlight-betan.

## Äldre chattbilagor

13 levande meddelandereferenser kopierade till privat chattlagring, SHA-256 verifierad för original/kopia och atomiskt referensbyte. Originalfiler/URL:er bevarade. Riktig deltagare kan hämta identiska bytes; anonym och annan organisation nekas. Vanliga roller saknar cutover-RPC-behörighet. Inga verkliga meddelanden skickade.

Ett runtimefel upptäcktes: SECURITY DEFINER-ägaren `postgres` äger inte `storage.objects`, så Storage-DDL i cutover-RPC stoppades. Första transaktionen rullades tillbaka. Framåträttningen `20261013100000_chat_legacy_cutover_permissions.sql` kräver befintlig restriktiv karantän och tar bort Storage-DDL ur RPC:n. Rättningen provades med verklig service-role/ägare i rollback-transaktion innan installation; ledger/hash registrerade. Karantänen behålls. Backup/mapping finns skyddat i serverbackup `20261011T111812Z`.

Privacy-API-skäl enligt [Capacitor Filesystem](https://next.capacitorjs.com/docs/apis/filesystem) och [Capacitor privacy manifest](https://next.capacitorjs.com/docs/next/ios/privacy-manifest); badge-pluginens installerade Swift-kod använder appens UserDefaults. Detta ersätter inte App Store Connects redovisning av behandlade personuppgifter.
