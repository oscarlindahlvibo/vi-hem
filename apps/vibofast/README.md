# Vibo Fastigheter

Vite + React + TypeScript. Publik webbplats för vibofast.se, baserad på det bifogade Bolt-utkastet.
Administration finns i Vi-hem. Ingen driftsättning eller migration har körts mot produktion.

## Starta lokalt

```sh
npm ci
cp .env.example .env
npm run dev
```

Kopiera Vi-hems **publika** Supabase-URL och anon/publishable-nyckel till `.env`.
`VITE_SUPABASE_ANON_KEY` stöds också för den befintliga delade installationen.
Använd aldrig service role-nyckeln i Vite.

För att granska designen innan databasdelen har installerats:

```sh
VITE_DEMO_MODE=true npm run dev
```

Exempelannonser visas endast i detta uttryckligen markerade demoläge.
Utan fungerande Supabase visas ett felmeddelande, inga gamla exempelannonser.
Formulären bekräftar mottagande först efter att servern har sparat uppgifterna.
I demoläge sparas/skickas inga formulär.

## Verifiering

```sh
npm run typecheck
npm test
npm run build
```

Databastesterna körs i lokal PGlite/PostgreSQL med en minimal Vi-hem-testmodell,
inte mot den delade databasen. De verifierar datum, tillgänglighet, organisationsgränser,
behörighet, konflikter mellan redigeringar och begränsning av formuläranrop.
Se [driftsättningsinstruktionen](integration/DEPLOYMENT.md) för manuell installation.

## Datakällor och publicering

`vihem_vibofast_public_site()` läser aktuella `vihem_apartments`, `vihem_properties`,
`vihem_tenancies` och godkända `vihem_termination_requests`.
Hemsidan hämtar ett nytt resultat varje minut och när fönstret återfår fokus.

- Ledig lägenhet med färdig annons kan publiceras direkt.
- Avtalslut 2027-01-31 ger inflyttning 2027-02-01.
- Godkänd uppsägning används om hyresförhållandets slutdatum saknas.
- Ej godkända uppsägningsärenden publiceras inte enbart på ansökan.
- Aktivt avtal utan slutdatum och nya framtida hyresförhållanden döljer annonsen.
- Renovering, blockering och inaktiv fastighet döljer annonsen.
- Ett senare datum för färdigställande kan skjuta fram inflyttningen.
- Ofullständig annons publiceras inte. Hyra, yta, rum och adress kommer från Vi-hem.

En admin inom den uttryckligen bundna Vibo-organisationen kan administrera innehållet.
Hyresgäster och administratörer i andra organisationer saknar åtkomst.
Den publika webbplatsen får bara annonsfält och offentligt sidinnehåll, inga hyresgästuppgifter.

Vi-hems signerade avtal skapar numera hyresförhållanden. Publiceringen följer dessa.
Ett signerat avtal med framtida tillträdesdatum reserverar också lägenheten direkt,
även om skapandet av hyresförhållandet rapporterat en konflikt. Den nya webbplatsen
ändrar inte Vi-hems avtalsprocess.

## Administration

Vi-hems meny får **Vibo hemsida**. Annonsredigeraren innehåller rubrik, beskrivningar,
hyrestyp, fördelar, vad som ingår, publiceringsval, bildordning och tidigaste inflyttning.
Företagsuppgifter, kunskapsbank, sidtexter, logotyper och sidbilder har egna redigeringsflikar.
Ändringarna visas på hemsidan utan ombyggnad. Kod/layoutändringar kräver ett nytt Vite-bygge.

Bilder lagras i den separata publika bucketen `vihem-vibofast-images`.
Ladda bara upp bilder avsedda för annonser eller webbplatsen där.
Kontakt- och intresseanmälningar blir tillgängliga i Vi-hems hemsideadministration.
Automatisk e-postavisering ingår inte.

## Hosting

`npm run build` skapar `dist/`. Servern måste returnera `index.html` för sidvägar.
Exempel finns i `integration/nginx.conf.example` och `public/_redirects`.
Domän/DNS/TLS för vibofast.se måste konfigureras manuellt på din server.
