# Isolerad hotfix – Äldre lager-RPC – referensisolering

Kandidat `20261011143000_inventory_reference_isolation.sql`. SHA256 `3a8fcf3801ecf9b766ee32e9c13ee1f8a6684a85d4abfc3383a6f30d239a56f9`. Status: förberedd och provad i QA, **inte produktionsklar**.

## Aktuellt schema, beroenden och tester

Aktuell produktion har exakt den10-parametriga vihem_inventory_apply_transaction-signaturen. Den är SECURITY DEFINER med search_path public, public/anon/authenticated execute, artikel-orgkontroll men inga organisationskontroller för source/destination/project/order/apartment. Kandidatens referensvalidering finns inte i den lästa definitionen. Ingen produktionsattack utfördes.

Beroenden: befintliga stock/location/balance/transaction/customer_project/work_order/apartment/profiles-tabeller samt vihem_get_my_org_id/vihem_get_my_role. Kandidaten behåller10-parametrig signatur inklusive p_apartment_id och befintliga beräkningar/rörelsetyper. Ingen premiumfrontend, ledger, revisiontrigger eller ny korg-RPC krävs. Staff/admin enligt befintlig funktion; aktivprofilkontroll tillkommer. Superadmin har inte automatiskt fått denna gamla transaktionsrätt.

QA inventory-reference-isolation-integration.mjs PASS: annan organisations destination nekas, egen inleverans/saldo bevaras. Nya cart/movement-prov återkörda i QA. Full legacy-kompatibilitet, adjustment/inventory_adjustment/correction/waste och screen/inactive/alla referenstyper återstår i fristående staging.

Eftertester: signatur exakt, PUBLIC/anon execute borttaget och authenticated execute finns; giltig egen in/ut/return/flytt och samtliga befintliga kostnads-/justeringsregler ger samma resultat; varje foreign-referens nekas utan saldo-/historikändring. Read-only inventering av historiska felreferenser separat; patchen flyttar/raderar inga tidigare data.
## Gemensam spärr inför driftsättning

Ingen produktionsskrivning är genomförd. Metadata lästes i en READ ONLY-transaktion från supabase-db/postgres på vibo-server, PostgreSQL15.8, den2026-10-10. Policy-/funktions-/trigger-/bucketdefinitioner sparades, inga personrader eller filinnehåll hämtades. Snapshot SHA256: 8617df7c3dc847941c99ab65dbf2016826cae2fd0da99994c1c42a4dfb65cb36. En tilläggsinventering omfattar hjälpfunktioner och work-order-/modulpolicyer.

Omedelbart före godkänd release måste operatören ta ny schema-/ACL-backup och jämföra med denna snapshot. Drift efter kontrolltillfället är inte certifierad. Varje kandidat ska köras ensam i staging byggd från aktuellt produktionsschema och main, utan premiummigrationer. QA-test på premiumschemat ersätter inte detta fristående stagingprov. Inga historiska rader/filer raderas av kandidaterna.

Produktionsgodkännande ska namnge kandidat och SQL-hash. Kör dess befintliga BEGIN/COMMIT med ON_ERROR_STOP, gör eftertester med verkliga roll-JWT utan att exponera klientnycklar. Publicera inte premiumfrontend för att åtgärda dessa brister. Rollback som återöppnar en säkerhetsbrist kräver separat riskbeslut; den är ingen rutinlösning vid klientfel.
