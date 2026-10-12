# Gräv & Allservice i Virserum AB – hemsida

Publik sajt för **gavirserum.se** med offertformulär. Precis som Vibo hemsida och Ekängens vandrarhem styrs den helt från VI-HEM
(meny **Gräv & Allservice hemsida**): inkomna offertförfrågningar (status, anteckningar, bilder), texter, tjänster, frågor och svar,
bilder och inställningar. Sajten innehåller ingen egen affärslogik och inga hemliga nycklar.

## Så hänger det ihop

- **Innehåll**: `vihem_grav_public_site()` (publik RPC, bara fält som får visas). Hämtas vid start, varje minut och vid fokus.
- **Offertförfrågan**: edge-funktionen `vihem-grav-quote` (ingen inloggning). Validerar strikt, tar emot upp till 4 bilder (förminskas i
  webbläsaren, kontrolleras på servern med magic bytes), sparar i VI-HEMs privata schema och notifierar alla admins. Skydd: origin-lista,
  honeypot + minsta ifyllnadstid, hastighetsbegränsning per avsändare (HMAC-fingeravtryck, aldrig rå IP) och dygnstak.
- **Bilder från kunder** ligger i en privat bucket; bara admins i VI-HEM kan se dem. Förfrågningar kan raderas (GDPR) inklusive bilder.
- **Mejl** (valfritt): ange en Google Workspace-avsändare under Inställningar, så skickas notis till företaget och bekräftelse till kunden.

## Lokalt

```sh
cd apps/grav
cp .env.example .env.local   # publik URL + anon-nyckel
npm install && npm run dev
```

## Driftsättning

1. **Engång (root):** `sudo bash apps/grav/deploy/install.sh` – webbrot, nginx, Let's Encrypt, och uppdaterar `site-publish`.
2. **Löpande (inget lösenord):** `~/deploy_sites.sh grav` (se `scripts/deploy/`).
