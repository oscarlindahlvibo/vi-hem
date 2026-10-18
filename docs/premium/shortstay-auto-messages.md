# Automatiska gästmeddelanden

Admin: Korttidsuthyrning → Meddelandemallar → Automatiska gästmeddelanden. Välj rum/mall, automatiskt eller bestämt språk, kanaler, ankomst/avresa, −7 till +7 dagar och svensk klocktid. Ny regel är avstängd; Booking.com/Expedia förvalda, Airbnb/Vrbo avvalda. Aktivering kräver granskning/bekräftelse. Inga regler skapas eller aktiveras vid installation.

Endast bekräftade bokningar genom direkt API-koppling. Beds24 kontrolleras omedelbart före reservation: id, organisationens rum/fastighet, kanal, status och datum måste stämma. `[FIRST_NAME]` använder gästens namn från den aktuella bokningen. Saknat namn/språk ger fel, ingen osäker gissning eller e-post/SMS-reservväg. Mallar väljs per rum för att undvika fel incheckningsuppgifter.

[Beds24s kanalstöd](https://wiki.beds24.com/index.php/Messages) omfattar Booking.com, Expedia, Airbnb och Vrbo. Vrbo kräver fungerande direkt meddelandekoppling; iCal räcker inte. Vissa bokningar via Vrbo/Expedias distributionsnät saknar meddelandestöd enligt [Vrbo Setup](https://wiki.beds24.com/index.php/VRBO_Setup). Verklig leverans till varje kanal återstår att verifiera med avsedd testgäst. Befintliga Auto Actions i Beds24 ändras inte; admin bör undvika parallella utskick av samma information.

## Säkerhet och leverans

- Admin/superadmin i egen aktiv organisation sparar via revisionskontrollerad RPC. Personal/externa/anonyma kan inte ändra regler eller reservera utskick. Regler/jobbhistorik visas endast för aktiva administratörer.
- Privat befintlig schemaläggningshemlighet krävs för worker; inga nycklar i frontend. Femminuterskontroll, högst 50 regler/cykel i ordning efter senaste kontroll, 45 sekunders arbetsbudget. Endast framtida tidpunkter efter senaste aktivering/redigering; två timmars eftersläpning, ingen historisk massutsändning.
- DB-reservation låser regel och kontrollerar aktuell mallrevision och organisationskoppling. Unikt jobb per regel/Beds24-bokning + kvitto i befintliga message_sends skapas atomiskt **före** externt POST. Samma text som redan skickats/väntar hoppas över. Ny regel med förlorat svar kan återförsökas idempotent; frontend återläser vid oklart sparsvar.
- Osäker leverans, krasch efter reservation eller förlorad kvittosparning återtas aldrig automatiskt. Admin kontrollerar i Beds24; historik visar väntande/misslyckat. Samma regel återanvänds inte för att skicka igen till samma bokning vid ombokning eller malländring. Ett påbörjat utskick kan hinna slutföras vid samtidig paus/avbokning.
- Nytt språk eller ny text i mallen gäller framtida ännu ej reserverade utskick. Mallar med regler behålls för historik; pausa regeln om den inte ska användas. Regler måste sparas av en aktiv administratör; avaktiverad regelägare stoppar leverans.

## Verifierat och installation

TypeScript, riktad lint, webb-/mobilbuild/bundle, modell-/workerprov med helt isolerade transporter; livebokning, kanalval, datum/DST/midnatt, inställd vistelse, ägare, paus och förlorat kvitto. QA SQL/RLS/CAS/orgisolering/idempotens och två verkliga parallella claim-sessioner PASS. Browser 390/768/1440: skapa, språk/rum, förval, förhandsvy, sparfel/retry, förlorat sparsvar samt aktiveringsbekräftelse PASS. Inga riktiga meddelanden eller aktiva regler.

Backend före frontend: migration `20261023100000_shortstay_auto_messages.sql` (beror på korttid, `20261008170000_beds24_manual_messages.sql`, `20261008183000_short_stay_message_templates.sql`, pg_net/pg_cron), `20261023101000_shortstay_auto_pause.sql` (paus fungerar även när språk/API-koppling tagits bort), ny worker och delad shortstay-auto-message samt uppdaterad beds24-send-message. Config använder egen hemlighetskontroll. Inga befintliga bokningar, mallar eller meddelanden skrivs om.

Backup `shortstay-auto-20261018T180517Z`: full databas återläst isolerat med ACL; kandidatmigration och negativa/sparprov PASS. Cron-schemaläggning och versionsspecifik GraphQL-extension-ACL utelämnades i QA-klonen, inklusive nya cron-anropet; produktionssignaturen/config kontrollerad separat. Inga QA-schemaläggare eller verkliga transporter startades. Föregående sender och ledger säkerhetskopieras före installation.

Återgång: inaktivera nya regler och det namngivna cron-jobbet, återställ föregående frontend/sender. Behåll jobb/kvitton för att hindra dubbla utskick. Ingen datarestore behövs för att stänga av funktionen. Fysisk native och verklig kanalleverans ej verifierade.

Installerat 2026-10-18: backend före frontend, nya worker laddar och nekar saknad hemlighet (401), adminläsning/personal/anonymprov PASS, cron aktiv. **0 regler, 0 jobb och 0 utskick** vid installationskontroll. Övriga bokningar och mallar oförändrade.

## Automatiskt språkval (2026-10-18)

Ny regel föreslår automatiskt språk med engelska som reserv när mallen har engelska. Beds24s `lang` prioriteras; om tomt används `country2`/`country`. Dessa fält finns i befintliga importerade bokningar och läses på nytt från Beds24 före utskick. Regionala språk matchas mot tillgänglig översättning; okänt/flerspråkigt land eller saknad översättning använder valt reservspråk. Ett uttryckligt språk utan översättning faller direkt tillbaka, inte till landets språk. Ingen maskinöversättning. Se [Beds24](https://wiki.beds24.com/index.php?title=Questions_and_Answers).

Migration `20261023102000_shortstay_auto_language.sql` efter pausmigrationen; ny v2-spar-RPC och worker/delad shortstay-language före frontend. Befintliga regler behåller fast språk. Äldre klienter sparar uttryckligen fast språk; revision/CAS, roll/orgisolering, idempotens och paus bevaras. Ingen aktivering eller omsändning vid installation.

Språk-/workerprov med mocktransport, negativa SQL/roll/org/CAS/idempotensprov samt TS/lint/mobilbuild/bundle PASS. Browser 390/768/1440: språkval, svensk/engelsk reservförhandsvy, spara/återläsa och fast språk PASS. Backup `shortstay-language-20261018T183149Z` återläst isolerat med nya migrationen och SQL-proven; ingen QA-schemaläggare. Återgång: föregående worker/frontend; den additiva kolumnen kan behållas, regler/kvitton ska bevaras. Fysisk native och verklig kanalleverans kvarstår.
