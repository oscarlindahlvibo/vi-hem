# Besiktningar – iteration 2 och revisionsskydd

Fokuserad rumsarbetsyta i gemensam DialogSurface. Mobil använder opt-in helskärm; desktop/iPad behåller avgränsad arbetsyta. Horisontell rumsväljare, föregående/nästa, konkret progress och explicit klart→nästa. Foto/bibliotek ingår i observationen. Notering visas vid behov eller automatiskt efter Dålig. Lägg till rum har obrytbar etikett. Rumsväxling återgår till arbetsytans överkant och respekterar reducerad rörelse.

## Bedömning och historik

De fyra befintliga skickvärdena bevaras. Ny JSON-metadata condition_selected skiljer tekniskt default good från faktiskt användarval. Nya rum har false; ingen radio/bedömningsknapp är vald och PDF visar Ej bedömt. Genomgång kräver ett faktiskt val, men ingen ny obligatorisk juridisk slutföranderegel införs. Äldre rum utan reviewed-metadata behåller registrerad bedömning; äldre icke-defaultvärden bevaras också. Ett gammalt draft med good + reviewed=false är tvetydigt och visas utan aktiv bedömning tills användaren väljer; värdet i historiken raderas inte. Återöppning bevarar befintliga rums-ID:n.

## Revision

Migration 20261010160000 inför revision och vihem_save_inspection_draft. Aktiv personal i egen organisation valideras, besiktningen låses och endast förväntad revision får sparas. Identiskt lost-response-retry returnerar befintligt utkast utan ny skrivning. Revisionskonflikt lämnar formuläret kvar. Innehållsändringar, inklusive foto-referenser, ökar revision. Arkivmetadata gör det inte. PDF-snapshot utesluter revisionsnumret eftersom det är teknisk metadata; annars skulle completed-övergångens egen revision ändra snapshot efter verifiering. QA-provet fångade och rättade denna interaktion.

Efter egen fotouppladdning läses senaste serverrad. Rebasering sker endast när övrigt innehåll matchar sparat underlag; verkliga främmande text-/rumsändringar får konflikt. Serverns bekräftade foto-referenser återanvänds. Full browserfoto+tvåklientprov återstår.

Äldre vihem_save_inspection nekas authenticated och direkta innehållsskrivningar kräver den nya RPC-vägen. Gamla appar kan fortsätta läsa, men behöver uppdateras för att ändra besiktningar. Det är ett medvetet skrivskydd, inte full skrivkompatibilitet. Ingen produktionsmigration körd. Befintliga generic Storage-/dokumentflöden är inte certifierade av detta skydd.

## QA i detta checkpoint

TypeScript och enhetstest för nytt/valt/historiskt/tvetydigt skick PASS. Verkligt PostgreSQL/JWT-prov: identiskt retry, två personal med samma revision (en vinner), stale photo-referens bevarad, gamla RPC/REST nekade, tenant/foreign org nekade PASS. Arkivets befintliga ledger/version/snapshotprov repeterat PASS efter fixen ovan. Browser: Hall Dålig+notering → klart → Kök obehandlat → spara → återöppna bevarade skick/notering/progress. Andra klientens sparning → lokal ändring → revisionskonflikt visar fel och behåller lokalt val. Inget faktiskt foto skickat i detta browserprov.

Stabila slutbilder ersätter den första serien och är visuellt granskade vid 390/430/768/1024/1440 px. Rumsytan scrollad på mobil; filarkivet flyttat till sammanfattningen och dubbla sammanfattningsåtgärden borttagen. Efter konflikt läses senaste serverrad vid återöppning; browserprovet bekräftar andra klientens notering och lyckad ny sparning. Fysisk mobilkamera/tangentbord och full a11y återstår.

Alla tre lint-errors rättade. Full-repo lint: 0 errors, befintliga warnings återstår. agreement-tenancy ändrar endast redundant nullish-uttryck till Number(apartment.rent ?? 0), inte normal giltig hyresberäkning. Icke-numerisk hyra ska fortfarande hanteras av separat validering, inget nytt ekonomiskt default införs.

PDF: alla 16 sidor i syntetiskt flerrumsprov visuellt granskade, inklusive svenska tecken, långa kommentarer och 19 bilder. En ensam rubrik före allmänna bilder rättad och sista två sidorna omrenderade/granskade. Verkliga besiktningsfoton/QA-Drive/native är fortfarande inte verifierade.
