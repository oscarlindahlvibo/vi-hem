# ViboRent public frontend

ViboRent is a separate, deployable public frontend for the VI-HEM rental module. It owns presentation and checkout UX only. Products, prices, availability, bookings, payments and access credentials remain in VI-HEM.

## Local development

From the repository root:

```bash
npm run viborent:dev
```

Or from this directory after installing dependencies:

```bash
npm install
npm run dev
```

Required environment variables:

```bash
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_RENTAL_SITE_HOSTNAME=viborent.se
```

`VITE_PUBLIC_RENTAL_API_URL` may be used to point at a proxy/BFF instead of the public `vihem-public-rental` Edge Function.

## Routes

- `/` public landing page
- `/hyra` product catalogue
- `/hyra/:slug` product details, availability, quote and checkout
- `/bokning/:reference` secure booking confirmation (requires the token in the URL)
- `/kundportal` customer login, bookings, payment status and requests
- `/kundportal/reset-password` customer password reset

## Deployment

Build independently with `npm run build` in `apps/viborent`. Publish the resulting `dist/` to the ViboRent web root and configure `viborent.se` and `www.viborent.se` according to the shared reverse proxy/hosting setup. Configure the production environment variables at deploy time; no Supabase service-role or payment secret belongs in this frontend.

The public rental Edge Function resolves the tenant from `vihem_rental_domains`. Configure `viborent.se` there before production use and apply the migration `20260812200000_viborent_public_lookup.sql` so public booking confirmations can use a non-guessable token.

Customer invitations and password-reset links use `https://viborent.se/kundportal` by default. Set the server-side secret `VIBORENT_PORTAL_URL` when using a staging domain; never put service-role credentials in this frontend.
