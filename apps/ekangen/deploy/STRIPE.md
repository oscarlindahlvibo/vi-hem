# Stripe för Ekängens direktbokning

Inga nycklar ligger i koden eller i hemsidan. De läggs i edge-funktionernas miljö på servern.

1. Skapa/logga in på Stripe och aktivera betalmetoder (kort, ev. Swish/Klarna) under *Settings → Payment methods*.
   Checkout visar automatiskt de metoder som är aktiverade för kontot.
2. Skapa en **webhook** i Stripe: *Developers → Webhooks → Add endpoint*
   - URL: `https://supabase.asedatruckmeet.se/functions/v1/vihem-ekangen-stripe-webhook`
   - Händelser: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`
3. På servern, i `/home/vibo/atm-personal-supabase/.env`, lägg till:
   ```
   STRIPE_EKANGEN_SECRET_KEY=sk_live_...
   STRIPE_EKANGEN_WEBHOOK_SECRET=whsec_...
   EKANGEN_SITE_URL=https://ekangensvandrarhem.se
   ```
   och i `docker-compose.yml` under tjänsten `functions` → `environment`:
   ```
   STRIPE_EKANGEN_SECRET_KEY: ${STRIPE_EKANGEN_SECRET_KEY:-}
   STRIPE_EKANGEN_WEBHOOK_SECRET: ${STRIPE_EKANGEN_WEBHOOK_SECRET:-}
   EKANGEN_SITE_URL: ${EKANGEN_SITE_URL:-https://ekangensvandrarhem.se}
   ```
   Kör sedan `docker compose up -d functions`. Testa gärna först med testnycklar (`sk_test_...`).
4. I VI-HEM → *Ekängens hemsida → Inställningar*: sätt avsändaradress för bekräftelsemejl (Google Workspace-adress),
   rabatt och avbokningsfrist, och slå på **Öppna för bokning**.
