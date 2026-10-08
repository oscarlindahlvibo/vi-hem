# Ekängens vandrarhem – hemsida och direktbokning

Publik sajt för **ekangensvandrarhem.se**. Precis som Vibo hemsida styrs och administreras den helt från VI-HEM
(meny **Ekängens hemsida**): texter, frågor och svar, rumsannonser med bilder, rabatt, avbokningsregler och bokningar.
Sajten innehåller ingen egen affärslogik eller hemliga nycklar.

## Så hänger det ihop

- **Innehåll**: `vihem_ekangen_public_site()` (publik RPC) – bara fält som får visas. Hämtas vid start, varje minut och vid fokus.
- **Priser och tillgänglighet**: edge-funktionen `vihem-ekangen-booking` räknar ut priset *på servern* ur VI-HEM:s korttidspriser
  (säsonger, priser, längdrabatter) minus direktrabatten. Klienten skickar aldrig ett belopp. Datum som är upptagna i Korttid
  (inklusive Beds24/Booking/Airbnb) går inte att boka.
- **Betalning**: Stripe Checkout. Webhooken `vihem-ekangen-stripe-webhook` markerar bokningen betald, skapar korttidsbokningen
  i VI-HEM, spärrar datumen i Beds24, mejlar gästen och notifierar admins.
- **Avbokning**: gästen avbokar själv via länken i bekräftelsen inom den gratis avbokningsfristen; Stripe återbetalar automatiskt.

## Lokalt

```sh
cd apps/ekangen
cp .env.example .env.local   # fyll i publik URL + anon-nyckel
npm install
npm run dev
```

`.env.production` innehåller bara den publika Supabase-URL:en och anon-nyckeln (ingen hemlighet).

## Driftsättning

1. **Engång** (kräver root): `sudo bash apps/ekangen/deploy/install.sh` – webbrot, nginx, Let's Encrypt-certifikat.
2. **Löpande**: `deploy_multi_app.sh` bygger (`npm run ekangen:build`) och publicerar till `/var/www/ekangensvandrarhem.se/html`.
3. **Stripe** (för att kunna ta betalt): se `deploy/STRIPE.md`.
