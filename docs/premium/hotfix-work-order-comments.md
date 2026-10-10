# Isolerad hotfix – Arbetsorderkommentarer

Kandidat `20261009130000_work_order_comment_isolation.sql`. SHA256 `94baefc09a81bb795d5b23128719b43138b0f80c88c22ef4328d47f50e0716d0`. Status: förberedd och provad i QA, **inte produktionsklar**.

## Aktuellt schema, beroenden och tester

Aktuell produktion har två permissiva staff/admin/superadmin-policyer för SELECT/INSERT utan kontroll av parent-order-organisation. Kandidatens vihem_comment_parent_access och anon-vakt saknas. RLS är aktiverat.

Beroenden: public.vihem_work_order_comments med work_order_id/user_id, vihem_work_orders befintlig RLS, vihem_profiles.active, auth.uid(), get_my_role(). Inga premiumtabeller/RPC krävs. get_my_role() är rollkälla; aktiva staff/admin/superadmin bibehålls och work-order-RLS avgör uttrycklig superadminåtkomst. Tenant och anon ska nekas. Specialbehörigheter får inte antas ge kommentaråtkomst utan orderåtkomst.

QA workorder-integration.mjs återkörd PASS: personal läser/skriver egen organisations tillåtna order, annan org/tenant/anon/author-spoof/inactive nekas, explicit superadminåtkomst bibehålls. Fristående staging och screen/specialgrants återstår.

Eftertester: samma prov på staging och efter godkänd hotfix, SELECT från annan org ska ge0 och INSERT nekas; egna kommentarer/historik finns kvar. Kund-/intern synlighet får inte utökas. Restrictive USING/WITH CHECK samt anon-policy ska finnas och RLS fortfarande vara på. Inga massrättningar av kommentarer utan separat inventering.
## Gemensam spärr inför driftsättning

Ingen produktionsskrivning är genomförd. Metadata lästes i en READ ONLY-transaktion från supabase-db/postgres på vibo-server, PostgreSQL15.8, den2026-10-10. Policy-/funktions-/trigger-/bucketdefinitioner sparades, inga personrader eller filinnehåll hämtades. Snapshot SHA256: 8617df7c3dc847941c99ab65dbf2016826cae2fd0da99994c1c42a4dfb65cb36. En tilläggsinventering omfattar hjälpfunktioner och work-order-/modulpolicyer.

Omedelbart före godkänd release måste operatören ta ny schema-/ACL-backup och jämföra med denna snapshot. Drift efter kontrolltillfället är inte certifierad. Varje kandidat ska köras ensam i staging byggd från aktuellt produktionsschema och main, utan premiummigrationer. QA-test på premiumschemat ersätter inte detta fristående stagingprov. Inga historiska rader/filer raderas av kandidaterna.

Produktionsgodkännande ska namnge kandidat och SQL-hash. Kör dess befintliga BEGIN/COMMIT med ON_ERROR_STOP, gör eftertester med verkliga roll-JWT utan att exponera klientnycklar. Publicera inte premiumfrontend för att åtgärda dessa brister. Rollback som återöppnar en säkerhetsbrist kräver separat riskbeslut; den är ingen rutinlösning vid klientfel.
