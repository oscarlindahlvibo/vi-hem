# Fordon och lager: separat rollskydd för läsning

## QA-observation 2026-10-11

Verkligt JWT-prov i den isolerade vihem_chat_qa visade att en hyresgäst i samma organisation kunde SELECT:a en fordonsrad och en lagerartikel via API. Annan organisation nekades. Befintliga org-läspolicyer saknade rollkontroll. Att UI döljer menyerna räcker inte.

`20261011103000_fleet_read_role_guard.sql` lägger RESTRICTIVE SELECT-policyer på befintliga public.vihem_fleet_*-tabeller och sex lager-/inventeringstabeller. Aktiva staff/admin/superadmin/screen tillåts av rollvakten; alla tidigare organisations-, modul- och kostnadsregler måste fortfarande uppfyllas. Screen behålls av kompatibilitetsskäl och är inte verifierad i runtime. Rättningen tar inte bort gamla permissiva policyer och ändrar inga rader eller skrivregler. RESTRICTIVE behövs eftersom även FOR ALL-policyer kan ge SELECT genom OR.

## Faktisk verifiering

Migrationen applicerades och återapplicerades endast i QA. Admin/personal kan läsa egna fordons-/artikelrader; tenant och foreign kan inte läsa eller ändra testposterna. Kalenderns privata händelse kan inte läsas av annan personal. Browser CRUD-resultat återlästa. Full matris för samtliga fleet-barnposter, kostnader, screen, superadmin, inaktiva användare, alla RPC och externa telematikfunktioner återstår.

## Separat godkänd produktionsprocedur

1. Granska aktuell main och levande policyinventering read-only: pg_policies, fleet-tabeller och hjälpfunktioner. Kontrollera specialroller/grants och PostgreSQL-stöd för restrictive policies.
2. Ta schema-/policybackup. Prova migrationen i produktionslik staging, inklusive kostnadsrestriktioner och gamla klienter.
3. Efter separat godkännande: applicera SQL som en transaktion, oberoende av premium-frontend eller staff-editor-RPC. Kräver befintliga fleet- och lagergrundtabeller, ingen annan premiummigration.
4. Efterkontroll med egna JWT: samma org admin/staff läsning, tenant/foreign/anonymous/inactive nekade, screen enligt beslutad rättighet, kostnader fortsatt adminbegränsade, barnposter/RPC isolerade.
5. Vid avvikelse: pausa release och utred. Att ta bort vakten återöppnar bristen och är inte en säker rutinrollback.

**Inte åtgärdat:** äldre publika fleet-/lagerbildbuckets och dokumentbuckets, lagringspolicyer eller RPC-funktioner med SECURITY DEFINER. Dessa kräver filinventering/migrationsstrategi och separat säkerhetsgranskning. SQL-vakten gör inte publika filer privata. Ingen produktionshotfix utförd.
