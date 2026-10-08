# Beds24 gästmeddelanden i VI-HEM

Korttidsuthyrning har fliken **Gästmeddelanden**. Gästens och värdens meddelanden, systemmeddelanden och interna anteckningar visas i samma konversation. Konversationen kan också öppnas från bokningen. Äldre trådar utan en lokal bokning visas med Beds24s bokningsnummer. Sökningen gäller de inlästa konversationerna; knappen Visa fler hämtar nästa grupp.

Detta steg är en läskoppling. Inga meddelanden skickas till gäster och deras läststatus i Beds24 ändras inte. Bilagor ligger i en tabell med organisationsbehörighet och hämtas först när användaren väljer att ladda ned dem. Ingen publik bilagelänk skapas. Meddelandetext visas som text, utan att exekvera HTML från en gäst.

Synkningen hämtar alla sidor från `GET /bookings/messages` för organisationens kopplade rums-ID:n och kontrollerar både rum och fastighet innan lagring. Den unika nyckeln organisation + meddelande-ID gör upprepade synkningar idempotenta. Avbrutna och äldre bokningars konversationer kan finnas kvar; synkningen raderar inte historik. API-fel och saknade behörigheter visas vid manuell synkning och loggas utan meddelandetext eller tokens.

En separat pg_cron-körning hämtar flödet var 15:e minut, förskjuten från bokningssynkningen. Den befintliga inställningen `beds24_scheduled_sync.enabled` och dess hemlighet används. Webbläsaren uppdaterar vyn varje minut när den är öppen. Administratörer och personal inom organisationen kan läsa; hyresgäster och användare utan aktiverad korttidsmodul saknar åtkomst. Klienten får inte skriva i meddelandetabellen eller välja en annan organisation till synkningen.

## Driftsättning

För webb och iPhone används samma React-komponent. Inga Capacitor-plugins eller iOS-filer ändras. Bygg iPhone-appen från aktuell main på vanligt sätt.

Backend måste installeras före webbversionen:

1. Lägg till `vihem-sync-beds24-messages/index.ts` och `_shared/beds24-messages.ts` i den befintliga funktionsvolymen. `_shared/vihem-auth.ts` är en befintlig beroendefil; kontrollera att dess version stämmer, skriv inte över andra serverändringar.
2. Kör endast migreringen `20261008143000_beds24_guest_messages.sql`. Den skapar VI-HEM-tabell, vy, behörigheter och ett nytt schemajobb; den raderar inga befintliga data. Självhostad server använder redan `VERIFY_JWT=false`; funktionen verifierar session eller intern schedulerhemlighet själv. I Supabase CLI används konfigurationens `verify_jwt=false`.
3. Hämta meddelanden från fliken eller anropa den nya funktionen med befintlig intern sync-hemlighet. Anslutningen behöver `bookings-personal`. Läsbehörigheten har verifierats mot det befintliga Vibogruppen-kontot.
4. Publicera frontend manuellt enligt befintlig rutin. Ett förberett paket kan innehålla `publicera-chatt.sh`, som kontrollerar exakta filhashar, aktuellt GitHub main och tidigare webbversion innan installation, säkerhetskopierar databasen och publicerar index sist.

Detta aktiverar inte incheckningsutskick. Nästa steg behöver separat hantera utskickstid, gästens kanal, mallar, bokningsändringar och skydd mot dubbla utskick. Beds24s API för att skicka meddelanden gäller OTA-bokningar; direktbokningar behöver en annan leveransväg.

## Verifiering

- `node scripts/beds24-messages-check.mjs`: API-sidindelning, samtliga meddelandetyper, bilagor, felhantering, rums-/fastighetsscope, nekade hyresgäster, avstängd modul, schedulerhemlighet och organisationsscope.
- `npm run typecheck` och `npm run build`.
- Migreringen provkörd på den befintliga PostgreSQL 15-servern i en transaktion: upsert utan dubbletter, läsning genom tabell/vy för admin, nekade klientskrivningar och noll åtkomst för hyresgäst/okänd profil. Allt rullades tillbaka efter testet.

API-referens: https://beds24.com/api/v2/apiV2.yaml och https://wiki.beds24.com/index.php/Category:API_V2.

## Manuella svar (2026-10-08)

`vihem-send-beds24-message` skickar text via Beds24 för Booking.com, Airbnb, Expedia och Agoda. Direktbokningar och iCal-bokningar är spärrade. API-behörigheten behöver skrivåtkomst till bookings-personal. Endast organisationens admin, superadmin och staff med aktiverad korttidsmodul får skicka. Rummet och fastigheten verifieras mot den verkliga bokningen i Beds24; klienten väljer aldrig organisation eller mottagaradress.

Migration `20261008170000_beds24_manual_messages.sql` lagrar utskicksreferens, avsändare, text och status. Klienten har enbart läsrätt. UUID-referensen tas i anspråk före POST och återanvänds vid statuskontroll. En unik indexering av obekräftade texter skyddar även vid omladdning. Beds24 saknar dokumenterad idempotensnyckel: timeout, 5xx, trasigt svar och success:false behandlas därför som obekräftade och skickas aldrig automatiskt igen. Kontrollera dessa i Beds24; ändra inte pending-status utan att först utreda om meddelandet skickades. sent betyder accepterat av Beds24, inte bekräftad leverans hos kanalen. Läsflödet synkas efter accepterat utskick, annars vid nästa ordinarie synkning.

Verifiering: `node scripts/beds24-send-message-check.mjs`, befintlig meddelandesynkningstest, typkontroll, produktionsbygge och SQL i återställd transaktion. Inga testmeddelanden skickas till riktiga gäster.

## Meddelandemallar per lägenhet (2026-10-08)

Fliken **Korttidsuthyrning → Meddelandemallar** väljer en korttidsenhet (lägenhet eller rum). Organisationens admin/superadmin skapar, redigerar och tar bort namngivna mallar. En mall innehåller en separat manuellt skriven text per språkkod; förslag finns för sv/en/de/da/no/fi/fr/es/pl och egna koder som ar eller en-gb stöds. Ingen automatisk översättning eller automatisk sändning sker. Varje språktext har samma gräns på 5 000 tecken som chattens skickafunktion.

I konversationen hämtas endast mallar för den aktuella lägenheten. Välj mall och språk, förhandsvisa och tryck **Lägg in mall**. Texten hamnar i svarsfältet och kan ändras innan **Skicka meddelande**. Ett befintligt utkast ersätts först efter bekräftelse. Mallar fungerar även i bokningsdialogen och för äldre trådar där endast meddelandesynkens enhetskoppling finns kvar. Personal kan använda och läsa mallar men inte ändra dem.

Migration `20261008183000_short_stay_message_templates.sql` skapar en egen tabell med RLS för organisation/modul/roll och kontroll att lägenheten hör till samma organisation vid skrivning. Databasen validerar språkobjekt och texter. Namn är unika inom lägenheten utan hänsyn till stora/små bokstäver. Sparande/borttagning kontrollerar senaste updated_at så att andra administratörers samtidiga ändringar inte skrivs över. Malltexter behandlas som vanlig text.

Verifiering: `node scripts/short-stay-message-templates-check.mjs`, befintliga läs-/skickatester, typkontroll och produktionsbygge. SQL testas i en transaktion med ROLLBACK, inklusive admin-skrivning, staff-läsning, nekad staff-skrivning och nekad tenant/okänd användare/anon/TRUNCATE. Ingen befintlig bokning eller gästkonversation ändras av installationen.
