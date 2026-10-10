# Besiktningar – driftsättning och äldre klienter

Ingen produktion ändrad. Detta är inte ett releasegodkännande.

## Faktiskt kompatibilitetsprov

QA JWT/REST provar äldre vihem_save_inspection och direkt UPDATE: båda nekas efter revisionsmigrationen. SELECT är kvar enligt befintlig RLS, gamla dokument och URL:er raderas inte. Detta är API-kompatibilitetsprov, inte test av en installerad gammal iPhone-/Android-app. Äldre appar kan få generiskt sparfel; de kan inte säkert skriva med revisionskontroll. Tidigare tillåtelse att gamla appar får förlora **chatten** ska inte tolkas som godkännande av att även besiktningssparning stängs utan information.

## Säker ordning inför separat godkänd release

1. Verifiera och säkerhetskopiera den faktiska databasversionen. Kontrollera main-diff och parallella commits. Inga premiummigrationer ska ersätta fristående kommentarhotfix.
2. Konfigurera separat QA-organisation, QA Shared Drive-huvudmapp och backendautentisering. Kör hela foto/PDF/roller/retry-matrisen inklusive verklig Drive; nuvarande QA saknar drive_root_folder_id, aktiverad arkivering och användbara QA-autentiseringsuppgifter.
3. Slutför legacy-migratorn och kör read-only inventering. Verifiera signerade dokument utan att ersätta bytes eller gamla dokumentreferenser. Inga gamla filer får raderas.
4. Testa tilltänkt äldre installerad app samt ny app på fysisk iPhone/Android. Besluta en minsta klientversion och hur användaren informeras/uppdaterar. Utan uppdateringskrav eller planerat skrivstopp är denna revisionsmigration **inte** bakåtkompatibel för besiktningsskrivning.
5. Planera underhållsfönster för besiktningsskrivning. Förbered backend/Edge och webb/native-version som använder nya RPC:n. Den aktuella migrationen skapar nya RPC:n och spärrar gammal skrivning tillsammans; den ska inte köras långt före klientreleasen. Ingen publik legacy-fallback får återinföras, eftersom den skulle kringgå revisionsskyddet.
6. Efter separat godkännande: tillämpa testade migrationer i dokumenterad ordning, publicera motsvarande Edge och klienter, verifiera PostgREST-schema/cache och all RLS med syntetiska produktionskontrollobjekt. Öppna skrivning först efter godkända kontroller och tydlig klientversionshantering.
7. Migrera äldre filer separat enligt godkänd rapport. Avveckla publik lagring först efter integritetsavstämning av alla referenser och ett separat beslut. Den nuvarande staging-cleanup-rutinen tar enbart verifierade tillfälliga kopior och får inte användas för gamla permanenta filer.

## Återställning

Ta backend-/migrations- och klientversioner som en sammanhängande release. Att rulla tillbaka enbart frontend gör att gammal RPC nekas. Återställ inte gamla oskyddade skrivrättigheter som snabb lösning. Stoppa skrivning, bevara utkast/filjobb och förbered en verifierad kompatibilitetsrelease. Signerade dokument, Drive-filer och gamla lagringsobjekt får aldrig tas bort för att förenkla rollback.

## Öppet inför release

Full legacy-migration; riktig QA-Drive; fysisk kamera/tangentbord/offline; samtidiga fotouppladdningar och browserredigering; driftjobb för avstämning/övergivna uppladdningar; installerade gamla klienter; minsta version/uppdateringsinformation. Ingen av dessa räknas som PASS genom ett lyckat TypeScript-bygge.
