# Material & utrustning – tjänstebruk

Implementerat på separat branch, inte driftsatt. Personal kan använda en gemensam korg i en egen vy eller arbetsorder: förbrukningsmaterial dras från vald lagerplats, ett specificerat uthyrningsexemplar reserveras kostnadsfritt. Ingen kundbokning, faktura, betalning eller BankID-order skapas. Admin ser reservationerna under Uthyrning → interna spärrar och kan skapa QR-etiketter för exemplar.

## Behörighet och integritet

Aktiv personal/admin i organisationen får den begränsade arbetsytan när organisationens lager eller uthyrning är aktiverad. Detta kräver inte personligt tillträde till den fulla uthyrningsmodulen. Org-/roll-/modulkontroller utförs i RPC, inte endast i menyn. Begränsade svar innehåller inga kunder, hyrpriser, inköpspriser eller spärrorsaker. Personal ändrar egna reservationer; admin kan hantera organisationens reservationer. Arbetsorderhistorik följer befintlig organisationsbehörighet.

Migrationen ersätter uthyrningsregistrets breda staff/tenant-policyer med adminåtkomst och rättar `vihem_rental_assert_access`: `current_user` i SECURITY DEFINER var funktionsägaren och kunde därför kringgå rollkontrollen. Service-role för publik ViboRent bevaras. Direkta anrop till rå `vihem_rental_free_assets` spärras; begränsad tillgänglighet använder den internt.

Checkout tar samma sorterade produktlås som kundbokning, kontrollerar exemplar och period på nytt och skapar en bufferskyddad `internal_use`-spärr. Lageruttag använder befintlig `vihem_inventory_apply_transaction` inom samma transaktion. Skapande av spärr/reservation/uttag och idempotenspost rullas tillbaka tillsammans vid fel. Actor + operations-ID och SHA-256 av anropet skyddar återförsök; samma ID med ändrat innehåll nekas. Avbokning/uthämtning/återlämning är också återförsökssäkra. Historik bevaras; avbokning/retur släpper endast reservationens egen spärr.

## Verifierat

- Isolerad `vihem-chat-qa-db`: 35 rollback-/roll-/organisations-/modul-/historikprov PASS.
- Två samtidiga sessioner: ett uttag vid återförsök; kund kontra personal i båda riktningar; oförändrat materialsaldo när maskinen upptagen; service-role-prisåtkomst PASS. UUID-avgränsade syntetiska resurser borttagna.
- Riktiga React-komponenter med lokal mocktransport: blandad sparning, sparfel + rättning, förlorat svar + idempotent retry, bevarat utkast, nästa period, uthämtning/retur, adminavbokning/filter och kodväg PASS. Mobil 390, iPad 768, desktop 1440 visuellt granskade. Ingen verklig bokning ändrad.
- Riktig ZXing bildavkodning av syntetisk QR-etikett PASS; manuellt EAN-värde/äldre lager-QR/ambiguitet provade. Kamera/fysiska iOS/Android-enheter EJ KÖRT. Foto avkodas lokalt utan uppladdning.
- TypeScript, appbuild, mobilbundle och riktad lint PASS. Helhetslint: 6 befintliga fel / 125 varningar utanför nya resurskomponenter; bland annat genererad Android-fil och parallell Kompetensportalen.

## Installationsordning – separat godkännande

1. Ta verifierad backup av databas och aktuella uthyrningspolicyer/RPC-definitioner. Kontrollera återställningskommando och backupfil före ändring.
2. Kontrollera befintliga beroenden: `20260812150000_inventory_management_mvp`, aktuell lager-RPC inklusive apartment-argument, `20261017100000_viborent_2_core` och uthyrningens bas-/drift-/avtalsschema. Kompetensportalens parallella migrationer är separata.
3. Installera endast `20261021110000_staff_resources.sql` först. Inga nya Edge Functions behövs. Frontend döljer arbetsytan om den begränsade capabilities-RPC:n saknas på äldre backend. Återläs katalog, begränsningar, adminflöde och service-role i den verkliga installationen utan riktiga uttag/bokningar.
4. Publicera beroende frontend och uppdaterad native-app därefter. Äldre staff-klienters fulla uthyrningsvy blir avsiktligt spärrad av RLS; lagerfunktioner och befintliga kundbokningar behåller sina kontrakt. Admin/publik service-role måste smoke-testas före frontend.
5. Vid frontendproblem: återgå till tidigare frontend men behåll säkerhetsbegränsningen. Återställ inte den sårbara RPC-kontrollen/breda läspolicyerna. Vid backendproblem: stäng den nya arbetsytan, bevara reservationer/spärrar/transaktioner/idempotensposter och rätta framåt; ingen tabellradering eller återställning av hela databasen efter nya uttag.

Kvar: separat installationsgodkännande, ny backup/preflight i verklig miljö, fysisk kameraskanning och native-test. SessionStorage bevarar korg/operations-ID under samma flik/session; ingen offline-bokning utlovas. Tillgängligheten är preliminär tills checkout bekräftats. Återlämning efter sluttid visar varning men inför ingen ny obegränsad spärrregel. Befintliga kommersiella priser, betalning, BankID, låskoder och kunddata ändras inte av internbokningar.
