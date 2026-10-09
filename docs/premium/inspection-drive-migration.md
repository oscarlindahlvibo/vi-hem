# Äldre besiktningsfiler – migreringsstatus

Status: read-only QA-inventering implementerad och provad. Fullständig migrering är INTE implementerad eller körd.

`scripts/premium/inspection-drive-inventory.mjs` paginerar besiktningar och inventerar allmänna/rumskopplade referenser. Det jämför äldre bucket-paths och source_keys med befintligt Drive-register och skiljer verifierade metadata från endast ett registrerat ID. Okända referenser kräver manuell granskning. Rapporten skriver inga databasändringar, gör inga Google-anrop och avvisar produktions-URL:er.

QA-körning:

```sh
CHAT_QA_CONFIG=/säkert/qa-config.json PREMIUM_INVENTORY_OUTPUT=/säkert/inventory.json node scripts/premium/inspection-drive-inventory.mjs
```

Kvar: säker källa-fetch med allowlist, integritets-/mappkontroll mot faktiska Drive-kopior, checksum-baserad dubblettavstämning, idempotent uppladdning och bakåtkompatibel referensuppdatering, avstämningsrapport och genomgående QA-prov. Ett befintligt register-ID får inte räknas som bevis på att rätt bytes finns.

Gamla protokoll och URL:er bevaras. Inga gamla bucket-filer eller Google-filer raderas. En separat godkänd produktionskörning och dokumenterad avstämning krävs innan gamla publika länkar avvecklas. Detta verktyg är ett förberedande inventeringssteg, inte det fullständiga migreringsverktyg som uppdraget kräver.

## Särskild övergångsrisk

Ett äldre completed-objekt utan verifierat nytt protokoll får inte bara få drive_required=true genom photo-begin: completed-vakten kräver ett verifierat protokoll. Den fullständiga migratorn måste därför ha ett separat verifierat legacy-flöde som bevarar completed/signering och befintlig dokumentreferens. Att först sätta gamla besiktningar till draft för att kringgå vakten är inte en godkänd migrationsstrategi. UI:s normala redigering kan spara ett nytt utkast, men det är inte ett automatiskt legacy-migreringsverktyg.
