# Åtkomstkoder – separat säkerhetskandidat (pass10)

Bekräftat i kod och negativt QA-prov: äldre `vihem-access-entries` uppdaterar metadata med caller-RLS men kräver ingen träff. En efterföljande service-role-upsert av kod kan därför skriva på ett främmande entry-ID. Inga produktionsattacker eller faktisk dataexponering har undersökts/påstås.

Kandidaten kräver aktiv profil, läser och validerar befintligt mål före update, kräver en återlämnad rad samt validerar fastighet/lägenhet/bolag/projekt mot användarens organisation. Explicit JWT ges till getUser. Kryptering förbereds före metadata-skrivning. API-formatet för äldre klienter bevaras. Ingen premiummigration krävs; befintliga access-/secret-/audit-tabeller och permission-modell återanvänds.

Riktig isolerad QA-Edge: skapa/hämta syntetisk krypterad kod PASS; tenant/foreign nekas; främmande update ger ingen secret-post och oförändrat mål; främmande objektreferens nekas. `scripts/premium/access-entry-integration.mjs` kräver localhost och QA-orgnamn och städar egna fixturer.

Inför separat godkänd hotfix: jämför aktuell main/produktionsfunktion och specialroller, ta backup av berörda tabeller/Edge-version, kör samma negativa prov i isolerad staging med aktuellt schema, deploya enbart Edge-kandidaten, gör efterprov med syntetiskt own-org-mål och kontrollera audit. Ingen produktion ändrad i pass10. Återställning av gammal Edge återinför bristen och kräver uttrycklig riskbedömning.

Kvar: metadata och kod lagras fortfarande i separata DB-operationer; secret-/auditfel kan ge delvis sparning. Full specialroll-/inaktiv-/äldre-klientmatris och auditavstämning är inte slutverifierade. Dessa begränsningar får inte beskrivas som atomisk sparning eller full releaseklarhet.
