# Besiktningar/Drive – verifiering 2026-10-10

Isolerad self-hosted QA, syntetiska användare/objekt. Inga produktionsfiler eller produktionsinställningar ändrade. Inga riktiga Google-anrop gjorda. Riktig QA-Drive/credentials har inte konfigurerats.

| Kontroll | Status | Bevis/avgränsning |
|---|---|---|
| TypeScript | PASS | npm run typecheck |
| Build | PASS | Vite; PDF separat lazy chunk ~433 kB; App fortfarande ~2.67 MB |
| Mobilbundle | PASS | Befintligt releaseprov; publik vibofast ingår inte |
| Scope-lint | PASS med varningar | Inga errors; hook-varningar dokumenterade; full-repo lint körd och FAIL, se kontrollpunkt 9 |
| Edge typkontroll | PASS | Deno check archive + generell storage; låsta frontendpaket återställda efter Deno |
| Databas/JWT/RLS | PASS | inspection-drive-db: own/foreign org, tenant, anon, concurrent begin/lease, immutable retry, staging denied, commit/retry, gamla versioner, snapshot/rollback. Drive-ID:n syntetiska |
| Google-transport mock | PASS | Stabil mapp, chunking, förlorat success-svar, retry samma ID, size/parent/job/SHA, 401/429/500/503. Ingen verklig Drive |
| Verklig QA Edge | PASS för fel/åtkomst | Anonymous 401, fel action 400, saknad konfiguration 409 utan strandad lease. Fångade/fixade await-bugg som typecheck inte hittade |
| PDF-generator | PASS | 16 sidor, många rum/bilder/långa texter, ÅÄÖ; trasig bild/unsupported glyph stoppar färdigställande |
| PDF visuellt | DELVIS | Första 3 sidor renderade; radbrytning förbättrad. Alla 16 sidor behöver full bildgranskning |
| Browser draft | PASS | Christofer sparade och återöppnade 5-rumsutkast; halltext bevarad |
| Browser complete med saknad Drive | PASS för felväg | PDF-jobb skapas, fel visas, formulär kvar och ingen falsk completion |
| Browser filval | BLOCKERAT | Chrome-tillägget saknar Allow access to file URLs. Inget faktiskt browserfoto uppladdat |
| Visuell QA | DELVIS | Rum och arkivfel vid 390/430/768/1024/1440 ×900; mobil och desktop samt PDF inspekterade. Bredare scroll/alla roller återstår |
| Lokal IndexedDB återstart | EJ FULLT KÖRT | Implementerat; filval blockerar browser-flöde. PDF-retention och account switch behöver slutprov |
| Verklig Google Drive | EJ KÖRT | Separat QA-rot/auth krävs |
| Native kamera/HEIC/keyboard | EJ KÖRT | Viewports är inte fysisk iOS/Android-verifiering |
| Full 40-punkts Drive-matris | EJ KÖRT | Ovanstående är en delmängd |
| Full migrering/gallring/reconciliation | EJ IMPLEMENTERAT | Read-only inventering provad |
| Atomiska tidsövergångar | IMPLEMENTERAT / DELVIS VERIFIERAT | Efterföljande kontrollpunkt 8–9; se clock-transitions.md |

Browserprovet stördes först av utvecklingsomladdning vid återställning av npm-paket. Sparning/återöppning och felväg kördes om när miljön var stabil; dessa är provresultaten ovan.

Kvarvarande obligatoriska prov: riktiga JPEG/PNG/HEIC-filer på olika rum/general, quota och appstängning, samtidigt upload/retry, backendtimeout/authexpiry/badfolder, Drive-success/DB-fail, DB-pending/Drive-fail, gamla kopior/dubbletter, faktisk tenant-file-fetch och removed-membership, signerade versioner, full PDF sidgranskning, stor fil/antal, kontobyte/utloggning/cache, lokal/staging-gallring. Mock får inte ersätta slutligt verkligt Drive-prov.

Återuppta från branchens senaste commit, fetch remote först. Börja med revisionskontroll för drafts och beständiga/resumable jobb, säker avstämning/migrering samt riktig QA-Drive. Fortsätt sedan tidsroll-/offline-/midnattsprov och kvarvarande moduler enligt modulstatus. Ingen modul-Klar eller deploy-rekommendation i denna kontrollpunkt.
