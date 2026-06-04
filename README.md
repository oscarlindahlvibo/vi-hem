# vi-hem

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-p8dzksdr)

## Lösenordsåterställning via Postfix

Appens "Glömt lösenord?" använder Supabase Auths recovery-mejl. Om användaren får felet `Error sending recovery email` betyder det normalt att Supabase Auth inte har en fungerande SMTP-konfiguration.

Om Supabase körs self-hosted på samma server som Postfix ska SMTP konfigureras i Supabase Auth/GoTrue, inte i React-appen. Lägg in motsvarande värden i Supabase-serverns `.env` eller `docker-compose.yml` och starta om auth-tjänsten:

```env
GOTRUE_SITE_URL=https://din-domän.se
GOTRUE_URI_ALLOW_LIST=https://din-domän.se/reset-password,https://din-domän.se/**
GOTRUE_SMTP_HOST=host.docker.internal
GOTRUE_SMTP_PORT=25
GOTRUE_SMTP_USER=
GOTRUE_SMTP_PASS=
GOTRUE_SMTP_ADMIN_EMAIL=noreply@din-domän.se
GOTRUE_SMTP_SENDER_NAME=VI-HEM
```

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
