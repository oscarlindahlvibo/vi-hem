# Google Workspace / Gmail i VI-HEM

Integrationen är read-only och använder endast `https://www.googleapis.com/auth/gmail.readonly`.
VI-HEM kan därför söka och läsa godkända mailboxar, men kan inte skicka, radera, arkivera eller ändra e-post.

## 1. Google Cloud

1. Skapa eller välj ett Google Cloud-projekt.
2. Aktivera Gmail API.
3. Skapa ett service account och en JSON-nyckel.
4. Aktivera Domain-Wide Delegation på service accountet och notera Client ID.
5. I Google Workspace Admin Console: **Security > Access and data control > API Controls > Manage Domain Wide Delegation**.
6. Lägg till service accountets Client ID och endast följande scope:

   `https://www.googleapis.com/auth/gmail.readonly`

## 2. Supabase secrets

Lägg följande secrets i den gemensamma Supabase-instansen. Lägg aldrig JSON-nyckeln i frontend eller i git.

```sh
supabase secrets set GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON_BASE64="$(base64 < service-account.json | tr -d '\\n')"
```

`GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` kan användas lokalt, men base64-varianten är säkrare i deploy-script.

## 3. VI-HEM

Öppna **E-post & underlag > Mailboxar**, lägg till de Workspace-adresser som får sökas och testa varje mailbox.
En användare kan aldrig ange en godtycklig impersonerad adress från klienten. Edge Function verifierar användare,
organisation, roll och allowlist innan Google API anropas.

## Felsökning

* `CREDENTIALS_MISSING`: secret saknas i Edge Function-miljön.
* `DELEGATION_OR_CREDENTIALS_INVALID`: service account, Client ID eller impersonerad adress stämmer inte.
* `SCOPE_OR_API_NOT_AUTHORIZED`: Gmail API är inte aktiverat eller readonly-scope saknas i DWD.
* `MAILBOX_NOT_FOUND`: adressen är inte en primär Workspace-adress eller finns inte i domänen.

Google beskriver service-account-flödet i [OAuth 2.0 for server-to-server applications](https://developers.google.com/identity/protocols/oauth2/service-account),
Domain-Wide Delegation i [Create access credentials](https://developers.google.com/workspace/guides/create-credentials),
och Gmail `messages.list`/`messages.get` i [List Gmail messages](https://developers.google.com/workspace/gmail/api/guides/list-messages).
