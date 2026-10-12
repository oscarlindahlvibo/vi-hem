# Stripe och igloohome för ViboRent

Inga nycklar ligger i koden eller i hemsidan. De läggs i edge-funktionernas miljö på servern med `set-keys.sh`.
Utan Stripe-nycklar är kortbetalning avstängd: kunden får ett tydligt besked och bokningen kan inte slutföras online.
Utan igloohome-integration (eller utan lås kopplade till objekten) hanteras koder manuellt – resten av uthyrningen fungerar som vanligt.

## Stripe
1. Aktivera betalmetoder i Stripe (*Settings → Payment methods*). Checkout visar de som är aktiverade.
2. Skapa en webhook: *Developers → Webhooks → Add endpoint*
   - URL: `https://supabase.asedatruckmeet.se/functions/v1/vihem-rental-stripe`
   - Händelser: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`
3. På servern: `bash ~/vi-hem/apps/viborent/deploy/set-keys.sh` och klistra in `sk_…` och `whsec_…` (dold inmatning).
   Testa först med testnycklar (`sk_test_…`) och testkortet 4242 4242 4242 4242.
4. Webhooken markerar bokningen betald först när belopp och valuta stämmer med bokningen. Händelser hanteras idempotent
   (Stripe kan skicka samma händelse flera gånger). Betalning som kommer efter att reservationen gått ut och objektet hunnit
   bokas av någon annan återbetalas automatiskt och personalen får en notis.
5. Egna ViboRent-nycklar (`STRIPE_RENTAL_*`) har företräde; saknas de används `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`. Ekängens nycklar används aldrig.

## igloohome (låskoder)
1. Skapa ett konto på igloohome Developer-portalen och en API-nyckel (Client ID + Client Secret). Observera: API:t har 30 dagars gratis provperiod, därefter krävs betalt konto (annars svarar API:t 402).
2. VI-HEM → Uthyrning → *Lås & åtkomst*: klistra in nyckeln, välj *Skarpt* läge, *Spara*, *Testa anslutning*, *Hämta lås*, koppla varje objekt till sitt lås och slå på *Skicka låskoder automatiskt*.
3. Koder skapas på servern (AlgoPIN, offline) först vid inställd utskickstid (standard 60 min före start), krypteras i databasen och skickas via Cellsynt-SMS. De skrivs aldrig i loggar och visas aldrig i publika svar.
4. Schemalagd körning: `vihem-rental-access-worker` varje minut. Aktivera den (en gång) med SQL:
   `update vihem_system_settings set value = jsonb_set(value,'{enabled}','true') where key='rental_worker';`
   (raden skapas av driftsättningen med slumpad hemlighet och rätt URL).
5. En redan utfärdad offline-kod kan inte återkallas på distans. Avbokar personal en bokning med utfärdad kod visas en tydlig varning med uppmaning om manuell säkerhetsåtgärd.
