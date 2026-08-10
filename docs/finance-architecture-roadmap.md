# VI-HEM ekonomi och fakturering

## Syfte

Ekonomimodulen ska ge VI-HEM en gemensam grund för bolag, kunder, leverantörer, fakturor, betalningar och framtida bokföringskopplingar. Den ska kunna användas av fastighetsförvaltning, kundprojekt, hyresdebitering och korttidsuthyrning utan att varje modul bygger egen ekonomi.

## Nuläge i systemet

- VI-HEM har redan organisationsnivå (`vihem_organisations`) och rollbaserad åtkomst via `vihem_profiles`.
- De flesta nya tabeller ligger i VI-HEM-namnrymden med prefixet `vihem_`, vilket är viktigt i den delade Supabase-instansen.
- Moduler styrs via `vihem_module_registry`, `vihem_organisation_modules` och funktionen `vihem_module_enabled`.
- Återanvändbara domäner finns redan: fastigheter, lägenheter, hyresförhållanden, dokument, arbetsordrar, kundprojekt, tidrapportering och korttidsbokningar.
- Det saknas en tydlig juridisk bolagsnivå. `organisation` är kund/tenant i SaaS-systemet, medan fakturering behöver kunna ske från ett eller flera juridiska bolag inom organisationen.

## Domänmodell

```mermaid
flowchart LR
  Org["Organisation"] --> Company["Bolag"]
  Company --> CompanyPermission["Bolagsbehörighet"]
  Company --> Customer["Kund"]
  Company --> Supplier["Leverantör"]
  Company --> Series["Fakturanummerserie"]
  Company --> Invoice["Faktura"]
  Invoice --> InvoiceLine["Fakturarad"]
  Invoice --> Payment["Betalning"]
  Company --> AccountingIntegration["Bokföringskoppling"]
  CustomerProject["Kundprojekt"] --> Invoice
  WorkOrder["Arbetsorder"] --> Invoice
  Tenancy["Hyresförhållande"] --> Invoice
  ShortStay["Korttidsbokning"] --> Invoice
```

## Modulgränser

- **Ekonomi** äger bolag, kunder, leverantörer, fakturor, fakturarader, betalningar, nummerserier, ekonomiaudit och bokföringskopplingar.
- **Kundprojekt** får skapa fakturaunderlag men ska inte äga fakturan eller bokföringsstatus.
- **Hyra/Hyresförhållanden** får skapa återkommande debiteringar men ska gå via samma fakturabas.
- **Korttidsuthyrning** får ta in prisuppgifter och betalstatus från kanal, men ska bara skapa kvitto/faktura via ekonomi.
- **Dokument** används för PDF:er, kvitton, avtal och fakturabilagor men äger inte fakturadata.

## Databasprinciper

- Alla nya tabeller ska börja med `vihem_`.
- Alla ekonomiobjekt ska ha `organisation_id`.
- Alla transaktionella ekonomiobjekt ska ha `company_id`.
- Tabeller som kan kopplas till ekonomi får `company_id` som nullable migrationssteg: fastigheter, lägenheter, hyresförhållanden, kundprojekt, arbetsordrar, tidrader och dokument.
- Fakturanummer får bara delas ut från en låst nummerserie, aldrig manuellt i frontend.
- Historik och ändringar loggas i `vihem_finance_audit_log`.
- Bokföringsleverantörer abstraheras bakom `vihem_accounting_integrations` och framtida edge functions/adaptrar.

## Behörigheter

- `superadmin` kan se och hantera alla bolag.
- `admin` kan hantera bolag och ekonomi inom sin organisation.
- Personal kan få bolagsbehörighet via `vihem_company_user_permissions`.
- Roller på bolag: `viewer`, `seller`, `bookkeeper`, `approver`, `admin`.
- Personal ska kunna registrera tid/material på kundprojekt utan att se marginal, påslag, debiteringssammanställning eller bokföringsdata.
- Hyresgäster ska aldrig läsa interna ekonomiobjekt direkt.

## API och edge functions

Phase 1 kan använda Supabase direkt för admin-CRUD. Därefter bör känsliga flöden flyttas till edge functions:

- `finance-create-invoice`: skapar faktura från källa.
- `finance-approve-invoice`: låser fakturan och hämtar nästa fakturanummer i transaktion.
- `finance-render-invoice-pdf`: skapar PDF och sparar dokument.
- `finance-send-invoice-email`: plockar köade fakturamejl, hämtar PDF-dokument och skickar via SMTP/Postfix eller vald e-postleverantör.
- `finance-sync-accounting`: synkar mot vald bokföringsadapter.
- `finance-import-supplier-invoice`: tar emot fil/e-post och startar OCR.
- `finance-register-payment`: tar emot bank-/bokföringsstatus.

## Bakgrundsjobb

- Skapa hyresfakturor inför förfallodag.
- Skapa fakturaunderlag från godkända kundprojektrader.
- Synka bokföringsstatus.
- Synka betalstatus.
- OCR-tolka leverantörsfakturor.
- Skicka påminnelser och flagga förfallna fakturor.
- Uppdatera förfallna kundfakturor via schemalagd edge function.

## OCR och AI-pipeline

1. Fil laddas upp till dokument/storage.
2. Edge function extraherar text och metadata.
3. AI föreslår leverantör, OCR-rader, belopp, moms, förfallodag och kontering.
4. Förslag sparas som utkast.
5. Admin/bokförare godkänner.
6. Leverantörsfaktura går till betal-/bokföringsflöde.

## Bokföringsadaptrar

Ekonomimodulen ska inte hårdkodas mot en leverantör. Adapterlagret ska normalisera:

- kunder
- leverantörer
- fakturor
- fakturarader
- betalningar
- konton och momskoder
- synkstatus och felmeddelanden

Aktuella första adapterkandidater: Spiris, Accounted, Fortnox, SIE-export och manuell CSV.

## UI-struktur

- Ekonomiöversikt
- Bolag
- Kunder
- Leverantörer
- Fakturor
- Utkast/fakturaunderlag
- Betalningar
- Nummerserier
- Bokföringskopplingar
- Inställningar
- Audit/logg

## Roadmap

### Phase 1: Grund

- Ekonomimodul i modulregistret.
- Multi-company.
- Bolagsbehörigheter.
- Kundregister.
- Leverantörsregister.
- Fakturabas, fakturarader och betalningar.
- Fakturanummerserier.
- Första adminvy för bolag, kunder och fakturautkast.

### Phase 2: Fakturaflöde

- Godkännande.
- Transaktionell nummersättning.
- PDF-generering.
- Dokumentkoppling.
- E-postutskick.
- Kreditfakturor.
- Betalstatus.

Status i kod:

- Serverfunktion för godkännande och låst fakturanummer finns.
- Serverfunktion för att markera faktura som skickad finns.
- Serverfunktion för manuell betalningsregistrering finns.
- Fakturatotaler räknas om från fakturarader med trigger.
- Fakturadokument kan genereras som VI-HEM-dokument från adminvyn.
- Faktura-PDF skapas med strukturerad fakturamall och laddas upp i `vihem-documents` med dokumentkoppling på fakturan.
- Edge function för serverrenderad faktura-PDF finns som `vihem-render-invoice-pdf`, så fakturadokument kan skapas från backend-flöden och automationer.
- Adminvyn använder serverrenderingen först och faller tillbaka till lokal PDF-generering om edge-funktionen inte är tillgänglig i lokal utveckling.
- Betalningar visas i egen ekonomiflik som historik per bolag, faktura och källa.
- Fakturanummerserier visas i egen ekonomiflik så admin ser prefix, nästa nummer och aktiv status.
- Admin kan skapa och redigera fakturanummerserier med prefix, nästa nummer, padding, räkenskapsår och aktiv status.
- Admin kan välja aktiv nummerserie när ett fakturautkast godkänns.
- Fakturamejl kan köas från fakturadetaljen med mottagare, ämne, meddelande och koppling till faktura-PDF.
- Köade fakturamejl visas i egen ekonomiflik med status och eventuellt felmeddelande.
- Edge function för faktisk SMTP-/Postfix-sändning från e-postkön finns som `vihem-send-invoice-emails`.
- Admin kan skicka alla köade fakturamejl eller en enskild köad rad från ekonomivyn.
- Funktionen kräver servermiljövariablerna `SMTP_HOST` och `SMTP_FROM_EMAIL`. Valfria variabler är `SMTP_PORT`, `SMTP_SECURE`, `SMTP_STARTTLS`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_NAME` och `VIHEM_CRON_SECRET`.
- Kreditfakturor kan skapas som separata utkast från godkända/skickade/betalda fakturor.
- Kreditfakturan får negativa fakturarader och originalfakturan markeras som krediterad när kreditfakturan godkänns.
- Betalningar kan importeras från CSV och matchas mot fakturanummer per bolag.
- Betalimporten är idempotent om exporten innehåller `external_payment_id`; annars skapas ett stabilt dubblettskydd från fakturanummer, datum, belopp och referens.
- Serverfunktion för förfallna kundfakturor finns som `vihem_refresh_overdue_invoices`.
- Admin kan uppdatera förfallna fakturor direkt från Fakturor-fliken.
- Edge function för ekonomi-cron finns som `vihem-finance-cron` och kan köras med `VIHEM_CRON_SECRET` för att markera obetalda fakturor som försenade.
- Samma cron kan köa betalningspåminnelser genom att anropas med `queue_reminders: true`.
- Samma cron kan även skicka köade fakturamejl och påminnelser genom att anropas med `send_emails: true` och valfritt `email_limit`.
- Ekonomi-cron skriver körningslogg till `vihem_finance_automation_runs`, inklusive fel, antal förfallna fakturor, köade påminnelser och behandlade mejl.
- Admin kan se senaste ekonomi-automationerna i Bokföring-fliken och styra standarder i `vihem_finance_automation_settings`.
- Cron-anrop kan fortfarande överstyra `finance_cron_enabled`, `queue_reminders`, `send_emails` och `email_limit` per enskild körning.
- Faktura-e-postkön skiljer nu på vanliga fakturamejl och betalningspåminnelser.
- Admin kan köa betalningspåminnelser för förfallna obetalda fakturor från E-post-fliken.
- Påminnelsefunktionen kan köras både av admin i appen och av service-role cron.
- Påminnelseflödet har spärr mot påminnelsespam: första påminnelsen tidigast 1 dag efter förfall, minst 7 dagar mellan påminnelser och max 3 påminnelser per faktura.
- Påminnelseavgift sparas nu som snapshot på varje köad påminnelse och visas i e-postfliken, så historiken inte ändras om bolagets inställningar ändras senare.
- Bokföringssynk har fått en provider-oberoende exportkö för fakturor, betalningar, kunder, leverantörer och leverantörsfakturor.
- Admin kan köa en låst faktura för bokföring från fakturadetaljen och följa status i Bokföring-fliken.
- Admin kan manuellt markera bokföringsköposter som bearbetas, synkade, misslyckade, avbrutna eller återköade.
- När en fakturapost i bokföringskön markeras synkad eller misslyckad uppdateras fakturans `accounting_status`.
- Admin kan konfigurera bokföringskopplingar per bolag med status, driftläge, exportformat, externt tenant-id, anteckning och extra public JSON.
- API-hemligheter sparas separat via `vihem-save-accounting-secret` till `vihem_accounting_integration_secrets`.
- Bokföringstokens krypteras i edge-funktionen med `VIHEM_ACCOUNTING_SECRET_KEY` och kan inte läsas tillbaka från frontend.
- Bokföringskopplingen visar bara ofarlig tokenstatus: om token finns, maskerad hint och senaste rotation.
- Edge function `vihem-test-accounting-integration` kontrollerar kopplingens behörighet, provider och tokenstatus.
- Admin kan testa en bokföringskoppling från dialogen och få tydlig status utan att exponera token.
- Edge function för manuell CSV-export av aktiva bokföringsköposter finns som `vihem-export-accounting-csv`.
- Admin kan ladda ner aktiva köposter som CSV från Bokföring-fliken.
- Edge function för SIE-export finns som `vihem-export-accounting-sie`.
- Admin kan ladda ner aktiva köposter som SIE-fil från Bokföring-fliken.
- SIE-exporten använder bolagets egna standardkonton när de finns i kontoplanen och faller tillbaka till försiktiga BAS-konton annars.
- Kontoplan och momskoder finns som bolagsspecifika tabeller: `vihem_accounting_accounts` och `vihem_vat_codes`.
- Admin kan skapa en svensk standarduppsättning av konton och momskoder per bolag från Bokföring-fliken.
- Admin kan skapa och redigera konton och momskoder per bolag från Bokföring-fliken.
- Nya kundfakturor och leverantörsfakturor kan välja konto och momskod från bolagets kontoplan.
- SIE-exporten använder fakturaradernas egna konton när de finns, annars bolagets standardkonto.
- Fakturautkast kan byggas med flera manuella fakturarader, inklusive konto och momssats per rad.
- Manuella fakturarader i utkast kan redigeras eller tas bort innan fakturan godkänns.
- Leverantörsfakturor kan granskas med flera kostnadsrader, där varje rad kan ha eget konto och egen momssats innan attest.
- Attesterade leverantörsfakturor kan köas till bokföringssynk/export från detaljvyn.
- Betalningar på leverantörsfakturor exporteras som egna bokföringshändelser i CSV/SIE, separat från själva fakturan.
- Edge function för att behandla bokföringskön finns som `vihem-process-accounting-sync`.
- Admin kan köra bokföringskön från Bokföring-fliken.
- Manual/SIE-köposter markeras som exporterade/synkade.
- Bokföringskön kan behandlas av `vihem-process-accounting-sync` med riktig adapterdispatch.
- Fortnox-adaptern kan skapa eller uppdatera kunder, leverantörer, kundfakturor, fakturabetalningar och leverantörsfakturor via sparad krypterad token.
- Spiris/Accounted och andra system kan kopplas via generisk HTTP-adapter med endpoint-konfiguration per entity/action.
- Adapterfel sparas på köposten och fakturans/leverantörsfakturans bokföringsstatus sätts till `failed`, så admin ser exakt vad som saknas.
- Ekonomi-cron kan även behandla bokföringskön enligt organisationsinställningarna, med separat maxgräns för antal köposter per körning.
- Kvar: produktionscertifiering och miljöspecifik konfiguration mot vald bokföringsleverantör.

### Phase 3: Hyra och kundprojekt

- Återkommande hyresdebitering.
- Fakturaunderlag från kundprojekt, tid och material.
- Rättighetsseparation så personal kan rapportera men admin ser ekonomi.

Status i kod:

- Kundprojektens befintliga faktureringsunderlag visas i ekonomimodulen.
- Admin kan omvandla ett projektunderlag till ett vanligt fakturautkast.
- Underlaget markeras som fakturerat och kopplas till skapad faktura för att undvika dubbletter.
- Om ingen ekonomikund väljs när projektunderlaget faktureras matchas projektkunden automatiskt mot befintlig ekonomikund eller skapas från projektets kunduppgifter.
- Admin kan markera flera projektunderlag och skapa en samlingsfaktura, med spärr mot att automatiskt blanda olika projektkunder.
- Återkommande hyresdebitering finns som körning per bolag och hyresmånad.
- Hyreskörningen hämtar aktiva hyresförhållanden, skapar ekonomikund för hyresgästen vid behov och kan generera fakturautkast.
- Admin kan granska hyresraderna i en körning och hoppa över en rad innan fakturautkast skapas.
- Hyresförfallodag sätts till sista dagen i månaden före hyresperioden, exempelvis 31 maj för juni-hyran.
- Ekonomi-cron kan skapa kommande hyreskörningar automatiskt per aktivt bolag med dubblettskydd.
- Admin kan styra om hyresautomation bara ska skapa hyreskörningen eller även fakturautkast.
- Automationshistoriken visar hur många hyresrader och fakturautkast som skapats av cron.
- Admin kan lägga in engångsjusteringar per hyresförhållande och hyresmånad, både tillägg och avdrag.
- Hyresjusteringar räknas automatiskt in i hyresrader som skapas manuellt eller via ekonomi-cron.
- Hyresjusteringar kan även vara återkommande tills vidare eller under ett periodspann, samt indexerade med procentsats ovanpå grundhyran.
- Admin kan köa hyresfakturor för e-post samlat från en hyreskörning när fakturorna är godkända och har PDF.
- Samlat hyresutskick hoppar över fakturor som saknar PDF, saknar mottagare, redan är köade/skickade eller inte är godkända.
- Autogiromandat kan registreras per hyresförhållande med status, mandatreferens, betalarnummer och maskerat konto.
- Admin kan aktivera, pausa och avsluta autogiromandat från Hyra-fliken.
- Hyresfliken visar en enkel hyresreskontra per aktivt hyresförhållande med senaste period, fakturerat, betalt, öppet saldo och autogirostatus.
- Hyreskörningar kan exporteras som bankneutral autogiro-CSV baserat på aktiva mandat och fakturerade hyresrader.
- Hyreskörningar kan även exporteras som Bankgirot-inriktad autogirofil (`.txt`) med header, betalrader och summeringspost.
- Autogiroexporten rapporterar vilka hyresrader som saknar aktivt mandat, saknar faktura eller inte är indrivningsbara.
- Kvar: bankens test/certifiering av Bankgirot-filen innan skarp produktion samt mer hyresspecifika påminnelseflöden.

### Phase 4: Leverantörsfakturor

- Leverantörsfakturainbox.
- OCR/AI-förslag.
- Godkännandeflöden.
- Bilagor och attest.

Status i kod:

- Leverantörsfakturor och fakturarader finns som egna tabeller.
- Admin kan registrera leverantörer och leverantörsfakturor manuellt.
- Admin kan bifoga PDF/bild vid registrering av leverantörsfaktura.
- Bilagan sparas som VI-HEM-dokument med kategorin `supplier_invoice` och kopplas till leverantörsfakturan.
- Leverantörsfakturan markeras som OCR-köad när en bilaga laddas upp, så OCR/AI kan byggas som separat efterföljande steg.
- Edge function för att behandla OCR-kön finns som `vihem-process-supplier-invoice-ocr`.
- Första OCR-steget använder filmetadata och markerar leverantörsfakturor som `needs_review`, så samma flöde kan ersättas med riktig OCR/AI senare.
- Admin kan köra OCR-kön från leverantörsfakturafliken och se OCR-underlag i granskningsvyn.
- Edge function för inkommande leverantörsfakturor finns som `vihem-ingest-supplier-invoice`.
- Inkommande fakturor kan tas emot via inloggat admin-/bokföraranrop eller via serverhemligheten `VIHEM_SUPPLIER_INVOICE_INBOUND_SECRET`.
- Ingest-flödet matchar eller skapar leverantör, skapar leverantörsfaktura, sparar bilaga som dokument och lägger bilagan i OCR-kön.
- Admin kan öppna leverantörsfakturor i en granskningsvy och justera leverantör, datum, konto, radtext, belopp, moms, anteckning och bilaga innan attest.
- Serverfunktion för attest/godkännande finns.
- Attesterade leverantörsfakturor kan markeras som planerade för betalning eller betalda.
- När leverantörsfakturor planeras/betalas köas de till bokföringssynken för kommande adapterflöde.
- Leverantörer kan ha bankgiro, plusgiro, IBAN/BIC, bankkonto och standardreferens för betalningsunderlag.
- Planerade leverantörsfakturor kan exporteras som CSV eller Bankgirot-inriktat betalningsunderlag från leverantörsfakturafliken.
- Leverantörsbetalningsexporten markerar fakturor med export-id och exporttid samt rapporterar saknade betaluppgifter.
- OCR-status och OCR-data är förberedda i datamodellen.
- Kvar: faktisk e-postadapter som skickar mailbilagor till ingest-funktionen, riktig AI/OCR-tolkning av dokumentinnehåll och bankens test/certifiering av betalfil innan skarp produktion.

### Phase 5: Integrationer

- Bokföringsadaptrar.
- Bank-/betalstatus.
- SIE/CSV-export.
- Webhooks och schemalagda synkar.

Status i kod:

- Bokföringskopplingar kan läggas upp per bolag för Spiris, Accounted, Fortnox, SIE och manuell hantering.
- Bokföringskopplingar kan redigeras från adminvyn med public adapterkonfiguration och status.
- Bokföringskopplingar kan rotera/spara en adapterhemlighet via edge function utan att hemligheten lagras i vanlig `config`.
- Admin kan se om extern adapter saknar token innan API-synk försöker köras.
- Bokföringskön ger nu olika fel för saknad token, saknad endpoint och fel från extern leverantör.
- Bokföringssynk köas i `vihem_accounting_sync_queue` med status, försök, externt id och felmeddelande.
- Manuell CSV-export finns för aktiva köposter som kontroll- och fallbackflöde.
- SIE-export finns för aktiva köposter och använder bolagets egna standardkonton för kundfordran, bank, försäljning, moms, leverantörsskuld och inköp när kontoplanen är upplagd.
- Bolag kan nu ha egna konton och momskoder som grund för SIE-export och adapterpayloads.
- Provider-processorn finns som `vihem-process-accounting-sync`, med säkert fallback-beteende för manual/SIE, Fortnox-adapter och generisk HTTP-adapter för Spiris/Accounted eller annan brygga.
- Schemalagd hantering kan aktiveras i ekonomiautomationen, så bokföringskön kan behandlas från `vihem-finance-cron`.
- Ekonomiöversikten visar produktionshygien per bolag: nummerserie, kontoplan, momskoder, fakturaavsändare, aktiv bokföringsadapter och leverantörsbetaluppgifter.
- Korttidsbokningar från Airbnb, Booking, Expedia/Hotels.com och Vrbo/HomeAway behandlas som förbetalda även när kvitto/faktura skapas i efterhand.
- Kvar: produktionsverifiering mot valt bokföringssystem och exakt fältmappning för organisationens kontoplan.

## Viktiga beslut innan senare faser

- Vilka juridiska bolag som ska finnas i Vibogruppen.
- Om hyresfakturor ska gå via samma bolag som fastigheten ägs av.
- Vilket bokföringssystem som ska prioriteras först.
- Om betalningar ska matchas från bokföringssystem, bankfil eller manuellt.
- Vilken fakturamall och nummerseriestruktur som ska användas.
