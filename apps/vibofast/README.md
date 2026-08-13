# Vibofast kundportal

Separat publik frontend för kundinloggning. Bokningar, betalstatus och kundärenden hämtas från VI-HEM via `vihem-rental-customer-portal`; ingen boknings- eller betalningsdata dupliceras.

## Miljövariabler

```env
VITE_SUPABASE_URL=https://<supabase-host>
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_CUSTOMER_PORTAL_API_URL=https://<supabase-host>/functions/v1/vihem-rental-customer-portal
```

Bygg separat med `npm run vibofast:build`. Deploya `apps/vibofast/dist` till `vibofast.se` eller det kunddomännamn som väljs. Sätt `VIBOFAST_PORTAL_URL` som Supabase secret så att inbjudningsmejl pekar rätt.
