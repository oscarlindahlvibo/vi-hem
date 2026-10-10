# Isolerad hotfix – Fordon och lager – läsroll

Kandidat `20261011103000_fleet_read_role_guard.sql`. SHA256 `cf309e831ab8f72ef2f5c72809b1f224651055c24b943b2b31cc6a835aa76b0b`. Status: förberedd och provad i QA, **inte produktionsklar**.

## Aktuellt schema, beroenden och tester

Aktuell produktion har org/module-baserad SELECT på huvudregister utan tenant-rollspärr. Guardnamnen från kandidaten saknas. Metadata bekräftar samma policygap som tidigare exploaterats endast på syntetiska QA-poster.

Beroenden: befintliga public.vihem_fleet_*-tabeller och sex stock/location/balance/transaction/count/count_lines-tabeller, vihem_profiles.id/role/active, auth.uid(), PostgreSQL restrictive-policy-stöd. Inga editor-/premiumledgers krävs. Kandidaten adderar SELECT-vakt, behåller tidigare organisations-, modul- och kostnadsregler. Roller är tenant/staff/admin/superadmin/screen enligt produktionsconstraint. Screen bevaras av kompatibilitet, men dess faktiska läsbehov är ännu inte verifierat. Superadmin globalåtkomst skapas inte av vakten; befintliga orgregler gäller.

QA admin/staff på egna syntetiska poster bibehålls; tenant/annan org nekas enligt pass6-prov. Detta pass upprepar inte hela fleet-barnmatrisen. Specialgrants hanteras inte av helper vihem_module_enabled i produktion: den kontrollerar superadmin eller organisationsflagga. Granska därför både UI-grants och databasåtkomst före release.

Eftertester: admin/staff läser egna main/barnposter, tenant/foreign/anon/inactive nekas; screen enligt verifierad rättighet; kostnader fortfarande admin-only; telematik-/service-/dokument-RPC kontrolleras separat. Jämför samtliga tabellpolicyer, inte endast huvudregister. Publika filer skyddas inte av denna patch.
## Gemensam spärr inför driftsättning

Ingen produktionsskrivning är genomförd. Metadata lästes i en READ ONLY-transaktion från supabase-db/postgres på vibo-server, PostgreSQL15.8, den2026-10-10. Policy-/funktions-/trigger-/bucketdefinitioner sparades, inga personrader eller filinnehåll hämtades. Snapshot SHA256: 8617df7c3dc847941c99ab65dbf2016826cae2fd0da99994c1c42a4dfb65cb36. En tilläggsinventering omfattar hjälpfunktioner och work-order-/modulpolicyer.

Omedelbart före godkänd release måste operatören ta ny schema-/ACL-backup och jämföra med denna snapshot. Drift efter kontrolltillfället är inte certifierad. Varje kandidat ska köras ensam i staging byggd från aktuellt produktionsschema och main, utan premiummigrationer. QA-test på premiumschemat ersätter inte detta fristående stagingprov. Inga historiska rader/filer raderas av kandidaterna.

Produktionsgodkännande ska namnge kandidat och SQL-hash. Kör dess befintliga BEGIN/COMMIT med ON_ERROR_STOP, gör eftertester med verkliga roll-JWT utan att exponera klientnycklar. Publicera inte premiumfrontend för att åtgärda dessa brister. Rollback som återöppnar en säkerhetsbrist kräver separat riskbeslut; den är ingen rutinlösning vid klientfel.
