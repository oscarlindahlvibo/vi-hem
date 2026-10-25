# VI-HEM Mail och Zero (Mail0) – ursprung och uppdateringar

VI-HEM Mail är **inte** en kopia av Zero. Zero (https://github.com/Mail-0/Zero, MIT, Copyright (c) 2025 Zero Email) har granskats och valts som teknisk och visuell utgångspunkt; delar av dess Gmail-logik är portade till VI-HEM:s egen stack (Deno-edge function + React/Tailwind 3). Zeros UI, Better Auth, tRPC, Drizzle och Cloudflare-lager används inte. Zeros logotyp och varumärke används inte. Licenstexten ligger i `docs/mail/ZERO-LICENSE.txt` och ska följa med så länge portad kod finns kvar.

Granskad version: `8c170b8` (2026-10-24).

## Portad logik
| VI-HEM-fil | Zero-källa @ 8c170b8 | Vad som är övertaget / anpassat |
|---|---|---|
| `supabase/functions/_shared/mail/parse.ts` | `apps/server/src/lib/driver/google.ts` | MIME-tolkning av Gmail-meddelanden (delar, bilagor, Content-ID), avsändar-/mottagarparsning, trådsammanfattning. Skrivet om utan Zeros ramverkskoppling; svenska ämnesprefix. |
| `supabase/functions/_shared/mail/gmail.ts` | `apps/server/src/lib/driver/google.ts` | Gmail-API-anrop (trådlista, trådar, modify, utkast, labels, sendAs). Zeros driver använder OAuth; VI-HEM använder service account med Domain-Wide Delegation och egen felklassning/retry-regel. |
| `supabase/functions/_shared/mail/mime.ts` | `apps/server/src/lib/driver/outgoing-mime.ts` | Utgående mejl: mottagarhantering, References/In-Reply-To, inline-bilder via Content-ID. Egen serialisering i stället för paketet `mimetext`. |
| `src/modules/mail/components/Composer.tsx` | `apps/mail/components/create/*` (begreppsmässigt) | Tiptap-baserad skrivruta. Ingen kod kopierad; signaturblocket, utkastsparning och ångra-skicka är egen design. |
| `src/modules/mail/components/MailApp.tsx` (kortkommandon) | `apps/mail/config/shortcuts.ts` (begreppsmässigt) | Kortkommandon följer Gmail/Zero-konvention (j/k, e, #, s, c, g+i). |

Allt övrigt (behörighetsmodell, utskicksledger, ärendehantering, kopplingar, notiser, arbetare, admin) är VI-HEM-eget.

## Uppdatera mot nyare Zero
1. Klona Zero i en tillfällig katalog och diffa filerna i tabellen mellan `8c170b8` och önskad version (`git diff 8c170b8..<ny> -- <källfil>`).
2. Bedöm varje ändring: buggfixar i MIME-/Gmail-hantering är intressanta, ramverksändringar inte.
3. Portera manuellt till motsvarande VI-HEM-fil, lägg till/justera enhetskontroll i `scripts/mail-unit-check.mjs`, kör `npm run test:mail`.
4. Uppdatera versionshashen i filhuvudet och i den här filen.
5. Kontrollera att Zeros licens fortfarande är MIT (inga bytta villkor) innan något portas. Inbox Zero eller andra projekt med kommersiella licensbegränsningar används inte utan separat licensgranskning.

Zeros paket (`mimetext` m.fl.) har medvetet inte lagts till som beroende. Nytt beroende som tillkommit: Tiptap 2.23 (MIT) och DOMPurify 3.2.5 (MPL-2.0 eller Apache-2.0, dual) i frontend.
