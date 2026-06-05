# vi-hem

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-p8dzksdr)

## Lösenordsåterställning via Postfix

Appens "Glömt lösenord?" använder Supabase Auths recovery-mejl. Om användaren får felet `Error sending recovery email` betyder det normalt att Supabase Auth inte har en fungerande SMTP-konfiguration.

Om Supabase körs self-hosted på samma server som Postfix ska SMTP konfigureras i Supabase Auth/GoTrue, inte i React-appen. Lägg in motsvarande värden i Supabase-serverns `.env` eller `docker-compose.yml` och starta om auth-tjänsten:

```env
API_EXTERNAL_URL=https://app.vi-hem.se
GOTRUE_SITE_URL=https://app.vi-hem.se
GOTRUE_URI_ALLOW_LIST=https://app.vi-hem.se/reset-password,https://app.vi-hem.se/**
GOTRUE_SMTP_HOST=host.docker.internal
GOTRUE_SMTP_PORT=25
GOTRUE_SMTP_USER=
GOTRUE_SMTP_PASS=
GOTRUE_SMTP_ADMIN_EMAIL=noreply@vi-hem.se
GOTRUE_SMTP_SENDER_NAME=VI-HEM
```

`API_EXTERNAL_URL` är den publika URL som Supabase Auth använder när den bygger länken i mejlet, till exempel `/auth/v1/verify?...`. Om den står som `http://localhost` får mottagaren en återställningslänk till localhost även om `redirect_to` är rätt.

Om GoTrue kör i Docker och Postfix kör direkt på servern fungerar `127.0.0.1` oftast inte, eftersom det då pekar på containern. Använd en host-adress som containern når, till exempel `host.docker.internal` om den är konfigurerad, serverns interna IP, Docker bridge gateway, eller kör Postfix så att den lyssnar på Docker-nätet.

Postfix måste tillåta relay från Supabase/Auth-containern, men bör inte vara ett öppet relay ut mot internet. Testa från servern eller containern:

```sh
nc -vz host.docker.internal 25
```

För lokal Supabase CLI kan motsvarande SMTP läggas i `supabase/config.toml` under `[auth.email.smtp]`. Efter ändring krävs:

```sh
supabase stop
supabase start
```
