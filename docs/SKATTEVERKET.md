# Skatteverket-modulen

Skatteverket är en valbar organisationsmodul i VI-HEM. Den använder befintliga bolag i `vihem_companies`, samma organisationstillhörighet och adminbehörighet som ekonomin. Superadmin aktiverar modulen under organisationen; därefter visas `Ekonomi -> Skatteverket` för organisationens admin.

## Läge och säkerhet

Första versionen har mockad synk för testdata. Officiella myndighetsanrop ska gå via en serveradapter och OAuth Authorization Code + PKCE. Klienthemligheter, certifikat och tokens ska läggas som Supabase secrets, aldrig i webbläsaren. OAuth state och verifier lagras hashat/tidsbegränsat i databasen.

Relevanta secrets när Skatteverkets testmiljö kopplas in: `SKATTEVERKET_CLIENT_ID`, `SKATTEVERKET_CLIENT_SECRET`, `SKATTEVERKET_AUTH_URL`, `SKATTEVERKET_TOKEN_URL`, `SKATTEVERKET_API_BASE_URL`, `SKATTEVERKET_REDIRECT_URI`.

## Datamodell

`vihem_skatteverket_integrations` håller bolagets anslutningsläge och synkstatus. `vihem_tax_obligations` skiljer officiell status, verifieringsstatus och intern uppgiftsstatus. `vihem_tax_events` är en deduplicerad händelsehistorik och `vihem_tax_sync_runs` är körlogg. RLS kräver rätt organisation, adminroll, aktiverad modul och bolagsåtkomst.

Mockad synk skapar åtaganden och motsvarande planeringspunkter i `vihem_planning_items`. Den skriver inte till Skatteverket och ändrar inte bokförda data.

## Deployment

Migreringen ska köras genom projektets vanliga deployscript. Edge Function `vihem-skatteverket` ska synkas till Supabase Edge Functions. Kör `npm run test:skatteverket` lokalt. OAuth kan aktiveras först när redirect-URL och secrets är konfigurerade på servern.
