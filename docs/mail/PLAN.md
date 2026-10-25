# VI-HEM Mail – teknisk analys, arkitektur och plan

Status: Fas 1 (2026-10-25). Branch: `feature/vihem-mail`. Ingen produktionsmigration, ingen deploy och inga nya Google-scopes har aktiverats – allt nedan är byggt och testat lokalt eller i rullad transaktion.
Slutredovisningen (vad som är klart/delvis/kvar) står i `docs/mail/RAPPORT.md`.

## 1. Licens- och källgranskning av Zero (Mail-0/Zero)

| Kontroll | Resultat |
|---|---|
| Granskad version | `8c170b8` (2026-10-24), grundat klonad grund i scratchpad, ingen kod körd |
| Licens | **MIT**, Copyright (c) 2025 Zero Email (`LICENSE`, kopia i `docs/mail/ZERO-LICENSE.txt`) |
| Annan licens i repot | Ingen träff på AGPL/GPL/SPDX-markeringar i `apps/`, `packages/`, `docs/` |
| Inbox Zero-kod | Ingen referens eller kod funnen. Ingen sådan kod används |
| Varumärke | MIT ger inte rätt till logotyp/namn. Zeros logotyp och namn används **inte** i VI-HEM Mail |
| Beroenden vi lägger till | Endast MIT-licensierade: `@tiptap/*` (core, starter-kit, link, image, placeholder, underline), `dompurify`, `mimetext` (edge) |
| Krav vid återanvändning | Upphovsrättsnotis + licenstext bevaras: `docs/mail/ZERO-LICENSE.txt` och rubrikkommentar i varje portad fil med `Adapted from Zero (MIT)` |

## 2. Vad Zero är (kodgranskning)

- **Stack:** React Router 7 (Vite), React 19, Tailwind 4, shadcn/Radix, tRPC, Jotai, nuqs, Better Auth, Drizzle/Postgres. Backend på **Cloudflare Workers + Durable Objects** (en "ZeroDriver"-agent per brevlåda), Hono, `@googleapis/gmail`, `postal-mime`, `mimetext`. Zero har dessutom AI-assistent, röststyrning, pris-/marknadssidor och IMAP/Microsoft-drivrutiner.
- **Storlek:** ca 50 000 rader TS/TSX i `apps/mail`, drygt 12 000 rader i driver-lagret. Repot rör sig snabbt (nya AI-funktioner dagligen).
- **Koppling:** UI-komponenterna (`mail-list`, `thread-display`, `mail-display`, `email-composer`) är djupt kopplade till tRPC-hooks, Better Auth-session, Jotai-atomer, nuqs-URL-state och inlang-översättningar. De går inte att köra oförändrade i en annan app.
- **Portabelt rakt av (logik):** `outgoing-mime.ts` (RFC 5322-bygge, dedupliceringar av mottagare, inline-bilder, References/In-Reply-To), Gmail-meddelandetolkning (header-/delparsning, bilageextrahering, etikettmappning i `google.ts`), Tiptap-editorns tillägg och utkastskonventioner, tangentbordskartan (`config/shortcuts.ts`), HTML-sanering och svarscitat-logik.
- **Inte återanvändbart:** Durable Object-agenterna, Better Auth, Drizzle-schemat, AI-/röstdelarna, IMAP/Microsoft, pris-/marknadsföringssidor.

## 3. Vad VI-HEM redan har

- React 18, Vite 5, Tailwind 3, Supabase (självhostad Postgres 15, edge functions på Deno bakom Kong), Capacitor-appar, egna UI-komponenter (`src/components/ui.tsx`).
- **Gmail finns redan** (`supabase/functions/vihem-gmail`, `src/pages/MailPage.tsx`): service account + Domain-Wide Delegation (nyckel krypterad i `vihem_google_workspace_settings`), skrivskyddat scope `gmail.readonly`, godkända brevlådor i `vihem_mail_accounts`, sökning, bevakningar (`vihem_mail_watch_*`), Drive-import, revisionslogg `vihem_mail_audit_events`.
- Egna användare/organisationer/roller (`vihem_profiles.role`: admin/staff/…). **Observera:** VI-HEM-profilerna har adresser `@vibofast.se` medan brevlådorna är `@vibogruppen.se`/`@digital-faktura.se` → koppling användare↔brevlåda kan **inte** härledas ur e-postadress utan måste vara en uttrycklig tilldelning.
- Befintlig sökning låter alla staff/admin söka i alla aktiva brevlådor. Det är avsiktligt idag (ekonomi-underlag) men strider mot kravet på brevlådebehörighet i nya klienten → hanteras med `access_mode` (se 6).

## 4. Arkitekturval

Utvärdering:

| Alternativ | Bedömning |
|---|---|
| A. Porta Zeros komponenter direkt | UI måste ändå skrivas om mot annan datalager, Tailwind 3/React 18 och VI-HEM:s komponenter. Möjligt men bara delvis |
| B. Köra Zero som separat tjänst | Kräver Cloudflare-miljö (Workers/Durable Objects), egen Better Auth-användardatabas och eget Postgres → **dubbla inloggningar och användarregister**, vilket uppdraget förbjuder. Går inte att köra i vår självhostade Supabase-miljö utan omfattande ombyggnad. Svårt att styra behörigheter per brevlåda |
| **C. Hybrid (vald)** | Zeros **Gmail-logik och UI-designmönster** porteras in i VI-HEM: (1) Gmail-motor som delad Deno-modul + ny edge function `vihem-mail` (REST mot Gmail via befintlig DWD-token), (2) ny React-modul `src/modules/mail` med Tiptap-baserad composer, trepanelslayout och tangentbordskarta efter Zero, (3) all auktorisering i VI-HEM:s databas |

Motivering: högsta möjliga återanvändning av Zeros genomarbetade delar (MIME, parsning, composer, UI-mönster) utan att ärva dess infrastruktur. VI-HEM:s inloggning (Supabase Auth) är den enda inloggningen – ingen andra inloggning krävs. Behörigheter avgörs i Postgres och kontrolleras i edge-funktionen vid varje anrop.

**Uppdateringar från Zero:** portad kod ligger i tydligt märkta filer (`// Adapted from Zero (MIT) – <ursprungssökväg>@8c170b8`) och samlas i `docs/mail/ZERO-UPSTREAM.md` med ursprungssökväg och commit. Säkerhetsfix/uppdateringar förs över genom att diffa respektive uppströmsfil mellan den registrerade commit och ny commit och applicera manuellt. Eftersom vi inte kör Zeros server kommer endast logik-/UI-ändringar att vara relevanta.

## 5. Dataflöde

```
Webbläsare (React, Supabase-session)
   └─ supabase.functions.invoke('vihem-mail', {action, account_id, …})
        ├─ verifierar JWT → vihem_profiles (org, roll)
        ├─ vihem_mail_authorize(user, account, nivå)  ← Postgres, vid VARJE anrop
        ├─ Gmail REST (service account + Domain-Wide Delegation, subject = brevlådan)
        └─ revisionslogg vihem_mail_audit_events
```

Gmail är auktoritativ för meddelanden/etiketter/utkast. VI-HEM lagrar **inte** mejlinnehåll: bara metadata (behörigheter, ärendestatus, kopplingar, kommentarer, mallar, inställningar, sändningsregister, synkstatus). Klienten cachar i minnet (och sessionStorage för listor) – ingen serverkopia av e-post, därför ingen retentionspolicy för innehåll behövs.

## 6. Datamodell (migration `20261101100000_vihem_mail_core.sql`)

- `vihem_mail_accounts` (befintlig, additivt): `kind` (personal/shared), `owner_user_id`, `access_mode` (`org_shared` = nuvarande beteende för befintlig sökning, `restricted` = bara de med behörighet), `client_enabled`.
- `vihem_mail_permissions`: per användare × brevlåda: `can_read`, `can_send`, `can_manage`, `can_admin` (skicka/hantera/admin förutsätter läsa), `granted_by`, `reason`, `revoked_at`.
- `vihem_mail_send_ledger`: idempotens och statusmodell för utskick (`queued → sending → sent | unknown | failed | cancelled`), `scheduled_for`, `gmail_message_id`, `request_hash`.
- `vihem_mail_sync_state`: History-ID, senaste synk, fel, watch-utgång per brevlåda.
- `vihem_mail_thread_meta` + `vihem_mail_thread_comments` + `vihem_mail_presence`: ärendehantering i delade brevlådor (tilldelning, status, prioritet, interna kommentarer, "någon svarar").
- `vihem_mail_thread_links`: generell koppling tråd ↔ objekt (`work_order`, `property`, `tenant`, `project`, `document`, `note`, `reminder`, … – ny typ kräver bara ett nytt värde).
- `vihem_mail_templates`, `vihem_mail_user_prefs` (senaste avsändare, notiser, externa bilder).
- SQL-funktion `vihem_mail_authorize(uuid, uuid, text)` (security definer) + RLS: klienten har **ingen** direktåtkomst till de nya tabellerna; allt går via edge function med servicenyckel.

Behörighetsprinciper: org-admin kan *tilldela* men får inte automatiskt läsa personliga brevlådor; tilldelning på personlig brevlåda kräver skriven orsak, loggas, och brevlådans ägare får en notis; självtilldelning på någon annans personliga brevlåda blockeras (fyra ögon).

## 7. Google-behörigheter (kräver godkännande, ej aktiverade)

| Behov | Scope | Status |
|---|---|---|
| Läsa/sök/etiketter/historik | `gmail.readonly` | **redan godkänd** |
| Skicka | `gmail.send` | godkänd (används av systemutskick) |
| Arkivera, markera, etiketter, utkast, papperskorg | `gmail.modify` | **ej godkänd – ny i Admin Console → Domain-wide delegation** |
| Hämta Send-As + signaturer | `gmail.readonly` räcker för `settings.sendAs.list/get` | redan godkänd |
| Radera permanent | `https://mail.google.com/` | **används inte** (papperskorg istället) |
| Push (Pub/Sub) | Google Cloud-projekt, topic + `gmail.readonly`/`modify` för `users.watch` | ej uppsatt – polling via History API används tills vidare |

Koden begär `gmail.readonly` för läsvägar och `gmail.modify` endast för skrivande åtgärder, och returnerar ett tydligt fel (`SCOPE_NOT_AUTHORIZED`) om delegeringen saknas – inget faller tyst tillbaka.
Personlig OAuth (konton utanför Workspace) kräver Googles OAuth-verifiering för begränsade scopes inkl. oberoende säkerhetsgranskning (CASA, kostnad) och byggs därför inte nu.

## 8. Synkronisering

- Initial: listvy hämtar första sidan (50 trådar) med metadata – ingen helnedladdning.
- Inkrementell: `users.history.list` från sparat `historyId` (per fönster och per brevlåda i `vihem_mail_sync_state` för notiser). Klienten pollar var 30:e sekund när fliken är synlig och hämtar bara berörda trådar.
- Utgånget historyId (404) → full omladdning av listan; fel → exponentiell backoff; kvotfel (429/403 rate) → `Retry-After` respekteras.
- Pub/Sub-push: designat men ej aktiverat (se 7).

## 9. Utskickssäkerhet

1. Klienten skickar `client_request_id` (UUID) per sändning.
2. Servern skapar rad i `vihem_mail_send_ledger` (unik på brevlåda + id) **före** Gmail-anrop, status `sending`.
3. Gmail `messages.send` med ett eget `Message-ID`.
4. Nätverksfel/timeout → status `unknown`. Ett nytt försök med samma id **söker först i Gmail efter Message-ID** (`rfc822msgid:`) och markerar `sent` om det finns – annars skickas på nytt. Samma id kan aldrig ge två utskick.
5. Avsändare valideras server-side mot brevlådans verifierade Send-As (`verificationStatus=accepted`) och användarens `can_send`.
6. Ångra: klienten håller utskicket några sekunder; schemalagt: server-kö (`scheduled_for`) som arbetaren skickar.

## 10. Fasplan och leveransläge

| Fas | Innehåll | Läge efter denna leverans |
|---|---|---|
| 1 | Analys, licens, arkitektur | Klar (detta dokument) |
| 2 | Edge function, UI-skal, läsa/skriva, flera brevlådor | Se RAPPORT |
| 3 | Send-As, signaturer, behörigheter, admin | Se RAPPORT |
| 4 | Synk, utkast, etiketter, History | Se RAPPORT |
| 5 | Kopplingar, ärenden, mallar | Se RAPPORT |
| 6 | Polering, test | Se RAPPORT |
