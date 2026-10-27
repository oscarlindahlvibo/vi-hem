# Snö & halka – verifierad kodinventering 2026-10-27

Bas: origin/main d5ab514. Separat branch codex/snow-operations-v2. Inga produktionsändringar eller merge till main tillåtna i detta uppdrag. Uppgifterna nedan beskriver granskad källkod, inte påståenden om provkörd produktion.

| Del | Befintligt och återanvänds | Verifierat gap |
| --- | --- | --- |
| Körning | SnowPage + vanlig vihem_clock_transition, klockkvitton och återförsök, byte/rast/lunch/utstämpling | Klienten begär completion_status=submitted och servern följer det. Ingen separat snögranskning eller maskintilldelning. Min tid visar inte godkännandestatus. |
| Rutter | SnowMap, linjer/multilinjer/områden/blandad geometri, prioritet, färg per uppdragsgivare, revisioner | Ingen operativ koppling till bemannad maskin eller utkallning. Karta är nätberoende, ingen fordonsnavigation. |
| Kunder/uppdrag | vihem_snow_clients och routes med organisations-FK, admin-save, arkivering | Snow clients har endast namn/aktiv/revision; juridisk kund, bolag, referens, kostnadsställe och pris saknas. Bör utökas som uppdrag och länkas till befintliga vihem_finance_customers. Inte skapa ett till juridiskt kundregister. |
| Tillgänglighet | SnowAvailability vecka/månad, 1–4 intervall, batch/revision/idempotens, frånvaro, befintlig snöjour, begränsad egen chaufförskalender | Endast enskilda datum. Ingen grundvecka/återkomst, veckobekräftelse, maskinkompetens eller bekräftat maskinpass. Visad kapacitet är inte en bemanningsgaranti. |
| Jour/behörighet | Befintliga jourpass/rotationer används, särskild snow-roll med snow_time_access, API-allowlist och Storage-spärr | Adminpilot ligger kvar. Utökade RPC måste uttryckligen tillåtas för snökonton. Konton får inte öppnas som bieffekt av utvecklingen. |
| Bemanning/larm | Inga snöspecifika bemannings-/utkallningsentiteter eller kvittensflöden hittade i dessa migrationer/komponenter | Nytt sammanhållet flöde krävs. Tillgänglighet, accepterat uppdrag, push-provideracceptans och arbetets start måste skiljas åt. |
| Tid/fordon | Befintligt Fleet-register och vehicle_id på time_entries; vanlig löne-/tidrapportering | Ingen snökopplad resurskompetens, avlösning eller kontroll av maskinluckor. |
| Notiser | vihem_notifications → befintlig AFTER INSERT/pg_net → vihem-send-push → APNs/FCM. vihem_push_deliveries skiljer sent/failed/unknown, befintlig användarstyrning och native deep links. | Provider sent är inte levererat till telefon/läst/kvitterat. Inga kritiska larmbehörigheter eller röstleverantörer verifierade. Upprepningar måste återkontrollera aktuell kvittens. |
| Priser/RUT | Befintlig ekonomisk kundtabell, bolag och fakturainfrastruktur finns | Ingen snöprislista, historisk prisbild eller RUT-kostnadsfördelning. Inga exempelpriser får aktiveras som verkliga priser. |
| Fakturering | Accounted REST-klient, krypterat bolagscontext, kundresolver och skapare för hyra/kundprojekt/manuell debitering | Snow saknas som källa; befintlig skapare skickar generella fakturaitems men saknar RUT-kontrakt. Först säkra låsta underlag/export och deduplicering, sedan verifierad extern draft-adapter. |

Granskade kärnfiler: hela snömodulens komponent-/modell-/tillgänglighetsflöde och samtliga snow-migrationer 20261022100000–170000 samt befintliga SQL/enhets-/API-/samtidighetstester; clockTransitions/TimeTrackingPage, App/Layout/roller, Fleet-grund/RLS, Finance V2/Accounted skapare/projektfakturering/REST-kundkontext, notifications/push och personlig påminnelsedispatch. Äldre säkerhetsgrindar ska bevaras. Telefonireferenser i andra verksamhetsformulär är kontaktfält, ingen verifierad generell utkallningstjänst.

## Arkitekturbeslut före implementation

1. Utöka befintlig snow_client som uppdrag; juridisk kund länkas till Finance. Resurs pekar på Fleet, inte nytt maskinregister.
2. All planering, kompetens, veckobekräftelse, utkallning och acceptans kontrolleras i servertransaktioner. Organisationslås + constraints ska skydda samtidiga svar och dubbelbokning.
3. Återkommande tillgänglighet är frivillig; bekräftelse gör den aktuell, men bara accepterat maskinpass är bemanning. Ändrad tillgänglighet gör bekräftelsen inaktuell.
4. Bevara den ordinarie stämpelklockan. Serverregel granskar avslutade snöpass och godkänner bara kompletta giltiga underlag. Ingen bulkändring av gamla submitted-poster eller fakturaskapande i tids-trigger.
5. Versionsbundna prisrader och låsta underlag skapas serverbaserat. RUT-arbete hålls åtskilt från maskin/material/resa och kräver manuell behörighets-/kundkontroll innan fakturering.
6. Återanvänd befintlig notis/pushkedja med idempotenta utkallningshändelser och serverjobb. Röstuppringning är avstängd tills leverantör och autentiserat kontrakt verifierats. Inga larm om verkliga uppdrag skickas under utvecklingen.
7. Migreringar är additiva, installation/cron/Edge-aktivering kräver separat godkännande. Inga demoorganisationer, kunder, resurser eller priser införs i produktion.

## Regelunderlag

Skatteverket anger högst50% av berättigad arbetskostnad inklusive moms; maskin, material och resor ingår inte. Arbetstimmar på plats måste dokumenteras även vid fast pris. Snöskottning med traktor kan innehålla berättigad arbetskostnad men maskinkostnaden får inte dras av. Källor: https://www.skatteverket.se/foretag/skatterochavdrag/rotochrut/safungerarrutavdraget.4.64a656d113f4c7597011e41.html och https://www4.skatteverket.se/rattsligvagledning/edition/2026.10/2943.html. Berättigande och uppgifter måste kontrolleras för det specifika arbetet.

Apple kräver särskilt entitlement och användartillstånd för Critical Alerts: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts. Vanlig push är ingen väckningsgaranti. Planeringsparametrar för arbetstid/vila är verksamhetskonfiguration, inte juridiskt godkännande av schema/beredskap.
