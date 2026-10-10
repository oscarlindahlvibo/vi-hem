# Pass 9 – läsande storagegranskning

2026-10-10: endast metadata SELECT på produktions `storage.buckets` och `pg_policies`, inga objekt hämtades, flyttades eller ändrades. Delad Supabase innehåller andra appar; deras buckets/policyer har inte ändrats eller räknats in i VI-HEM-resultatet.

| VI-HEM-bucket | Faktisk public-flagga | Bedömning |
|---|---|---|
| vihem-agreements | false | Privat flagga; auth-/filreferensmatris kvar |
| vihem-documents | false | Privat flagga; auth-/filreferensmatris kvar |
| vihem-chat-attachments | true | Bekräftad publik konfiguration; premiumcutover måste migrera och säkra gamla referenser |
| vihem-inspection-photos | true | Bekräftad publik konfiguration; Drive-migrering/avstämning före avveckling |
| vihem-work-order-attachments | true | Bekräftad publik konfiguration; säker privat läsning och äldre klientreferenser behöver egen migreringsplan |
| vihem-fleet-documents | true | Bekräftad publik konfiguration trots org-policy; kräver innehålls-/referensinventering och privat åtkomstplan |
| vihem-fleet-images | true | Identifiera interna kontra avsedda publika objekt före ändring |
| vihem-inventory-images | true | Identifiera interna kontra avsedda publika objekt före ändring |
| vihem-ekangen-images | true | Webbplatsbilder kan avsiktligt vara publika; inte i sig bevis för personuppgiftsläcka |
| vihem-rental-images | true | Avsedd publik annonsvisning behöver bevaras |
| vihem-vibofast-drive-images | true | Publik annonscache behöver bevaras enligt publiceringsregler |
| vihem-vibofast-images | true | Webbplatsmaterial; bevara avsedd publik visning |

Policyinventeringen visar bland annat `VIHEM public can view chat attachments`, `VIHEM public can view inspection photos`, `VIHEM public can view work order attachments` samt `Fleet documents org access`. En org-policy gör inte en public bucket privat. Detta bekräftar konfigurationen, inte vilka enskilda filer som innehåller personuppgifter eller om en viss fil faktiskt kunnat hämtas anonymt. Inga privata filbytes eller verkliga hyresgästdokument används som testdata.

Nästa säkerhetsåtgärd är en läsande referens-/innehållsinventering, syntetiska tester av faktisk anonym åtkomst i separat staging och en idempotent migrering med gamla referensfallbacks. Lås inte alla publika ytor samtidigt: annonser/webbplatsbilder har ett annat ändamål. Stäng interna publika länkar först efter verifierad privat filhämtning, migrering och separat godkännande. Detta är en kvarstående releasegate, inte en fjärde redan färdig hotfix. Servicekontonycklar och signerade URL:er ingår inte i rapporten.
