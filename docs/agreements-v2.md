# Avtal V2 (BETA) — arkitektur och status

Ny, generell avtals- och offertmodul: blockbaserad dokumenteditor, flera
parter/signatärer, handskriven elektronisk signatur, säker
signeringslänk, e-post/SMS-utskick, PDF-bilagor och en fullständig audit
trail. Byggd helt vid sidan av den befintliga avtalsfunktionen
(`vihem_contract_signatures`, InspectionsPage.tsx/ApartmentPage.tsx), som
fortsätter fungera oförändrad och kallas **Legacy** i navigeringen.
Avtal V2 är aktiverad för **alla** organisationer från start — inget
modul-flagg-beslut krävs per organisation, till skillnad från Ekonomi V2.

## 1. Arkitektur

```
src/modules/agreements-v2/
  types.ts                        alla TS-typer
  api.ts                          enda platsen som anropar vihem-agreements-*
  blocks/blockTypes.ts            registret över 20 blocktyper
  components/BlockEditor.tsx      redigerbar blocklista
  components/BlockRenderer.tsx    läsläge (delas mellan förhandsgranskning och publik sida)
  components/SignaturePad.tsx     handskriven signatur, pointer events
  pages/AgreementsV2Page.tsx      arkiv + mallar + editor-wizard
  pages/PublicAgreementSignPage.tsx  publik signeringssida (/sign?token=...)

supabase/functions/
  vihem-agreements-admin/         CRUD innan utskick (JWT, staff/admin)
  vihem-agreements-workflow/      skicka/påminn/avbryt (JWT, staff/admin)
  vihem-agreements-public/        publik signering (INGEN JWT, tokenbaserad)
  _shared/agreement-snapshot.ts   dynamiska fält + immutable-hashning
  _shared/agreement-tokens.ts     säkra signeringstokens

supabase/migrations/
  20260822100000_agreements_v2_foundation.sql          nummerserie + mallar
  20260822110000_agreements_v2_core.sql                avtal + block + versioner
  20260822120000_agreements_v2_parties_signers.sql      parter + signatärer + signeringar
  20260822130000_agreements_v2_attachments_links_audit.sql  bilagor + kopplingar + audit
  20260822140000_agreements_v2_storage.sql              privat storage-bucket
```

Org-scopat (inte bolags-scopat som Ekonomi V2) — samma modell som legacy
`vihem_documents`: `organisation_id` + roll (`staff`/`admin`/`superadmin`),
ingen `company_id`-uppdelning. Avtal V2 har ingen egen "vilken juridisk
person"-koncept motsvarande Accounted-integrationen.

## 2. Datamodellen

Grundtypen är ett **dokument** (`vihem_agreements`), inte ett hyresavtal:
`document_type IN ('agreement','offer','other')` + fri `category`-text.
Ingen `tenant_id`/`apartment_id`-kolumn på tabellen — se punkt 14.

Tolv nya tabeller:

| Tabell | Syfte |
| --- | --- |
| `vihem_agreement_number_series` + `vihem_next_agreement_number()` | AVT-/OFF-ÅÅÅÅ-NNNNN, atomärt per (org, typ, år) |
| `vihem_agreement_templates` / `vihem_agreement_template_blocks` | mallbibliotek, egna blockrader |
| `vihem_agreements` | rotraden — dokumentnummer, typ, status, `current_version_id` |
| `vihem_agreement_blocks` | **muterbar** utkastversion, en rad per block |
| `vihem_agreement_versions` | **immutable** frysta snapshots, se punkt 6 |
| `vihem_agreement_parties` | avtalsparter (vem avtalet är mellan) |
| `vihem_agreement_signers` | signatärer (vem som ska signera, kan representera en part) |
| `vihem_agreement_signature_requests` | säker token per signatär, se punkt 8 |
| `vihem_agreement_signatures` | signaturbevis, pinnad till en exakt version |
| `vihem_agreement_attachments` | PDF-bilagor, låsta vid utskick |
| `vihem_agreement_entity_links` | generisk koppling till valfri VI-HEM-entitet |
| `vihem_agreement_audit_events` | en enda kanonisk händelselogg (audit + leverans slagna ihop, se migrationens kommentar för varför) |

Medvetna avsteg från det skisserade förslaget i uppdraget: `delivery_events`
slogs ihop med `audit_events` till EN tabell (leverans är bara en delmängd
händelsetyper av samma tidslinje — två tabeller hade bara gett två
RLS-policyer och två skrivvägar för samma logiska logg).

## 3. Nya tabeller och RLS

Alla tolv tabeller har `ENABLE ROW LEVEL SECURITY` och minst en policy —
verifierat direkt mot en lokal Postgres 17-instans (se punkt 20), inte bara
läst. Mönster:

- **Läsning**: org-scopad via `vihem_get_my_role()`/`vihem_get_my_org_id()`
  (samma funktioner som `vihem_documents` redan använder), plus superadmin.
- **Skrivning**: `vihem_agreements`/`vihem_agreement_blocks`/parter/signatärer
  är skrivbara av staff/admin **inom sin egen organisation** direkt via
  RLS (till skillnad från Ekonomi V2, där alla skrivningar går via
  service-role). Blockredigering stängs av när `status` lämnar
  `draft`/`ready` (RLS `WITH CHECK`, inte bara UI-gating).
- **Helt stängt för klienter**: `vihem_agreement_number_series` (ingen ska
  kunna läsa/gissa nästa nummer) och `vihem_agreement_signature_requests`
  (token-hashen ska aldrig vara läsbar för någon Supabase-roll, inte ens
  signatären själv — de autentiserar via edge-funktionen, aldrig en
  Supabase-session).
- **Signatärens egen läsning**: en inloggad hyresgäst (`profile_id` satt på
  sin `vihem_agreement_signers`-rad) får läsa sina egna signatärer,
  signaturer, audit-events och dokumentversioner via ett separat
  `profile_id = auth.uid()`-villkor — men ALDRIG organisationens hela
  arkiv. `vihem_agreement_attachments` har ingen sådan gren ännu (se
  punkt 22).

Ingen tabell delar constraint-namn eller RLS-policynamn med legacy-tabeller.
Inget i migrationerna rör `vihem_contract_signatures`, `vihem_documents`,
`vihem_tenancies` eller någon annan befintlig tabell.

## 4. Blockeditorn

20 blocktyper (`src/modules/agreements-v2/blocks/blockTypes.ts`): Rubrik,
Underrubrik, Brödtext, Informationsruta, Avtalspart, Kontaktuppgifter,
Datum, Dynamiskt fält, Pris/belopp, Tabell, Punktlista, Checklista,
Bild/logotyp, Avdelare, Sidbrytning, Villkor, Signaturblock, Bilaga/PDF,
Fritextfält (mottagaren fyller i), Checkbox (mottagaren måste godkänna).

Varje blocktyp har en `defaultContent()`-fabrik och en liten
fältdefinition (`text`/`textarea`/`select`/`rows`/`checklist_items`/
`table_grid`/`image_url`) som en GENERISK redigeringsform renderar —
alltså inte 20 egna React-komponenter, matchar uppdragets "enkelt, svårt
att göra fel i, inte en Word-klon".

Omordning är upp/ned-knappar, **inte** drag-and-drop — ett medvetet val
uppdraget uttryckligen tillåter ("gärna DnD om det kan implementeras
stabilt... annars är det okej"). Upp/ned är entydigt på mobil på ett sätt
HTML5 drag-and-drop inte är, och kräver ingen extra biblioteksberoende.

Block kan läggas till, tas bort, dupliceras, flyttas och redigeras.
`BlockEditor`/`BlockRenderer` är samma renderingskälla som används i tre
sammanhang: mallredigering, avtalsredigering (förhandsgranskning), och den
publika signeringssidan — så det som en signatär ser är alltid exakt vad
som förhandsgranskades, aldrig en andra renderingsväg som kan divergera.

## 5. Dynamiska fält och immutable snapshot

`{{namespace.fält}}` i valfri textsträng i ett blocks `content`.
`_shared/agreement-snapshot.ts`:

- `buildDynamicFieldContext()` + `mergeEntityContext()` bygger ett context
  öppet för valfria namespaces (`today`, `organisation`, plus en per
  `entity_link` — `tenant`, `apartment`, `property`, `customer`, `project`
  idag; INTE en hårdkodad, stängd lista — ett okänt `{{namespace.fält}}`
  resolvar bara till tom sträng istället för att krascha).
- Resolution sker **exakt en gång**, i `vihem-agreements-workflow`s
  `send`-action, aldrig i redigeringsläget. Blocken (med token-strängarna
  fortfarande synliga i UI) är vad admin redigerar; det RESOLVADE
  innehållet skrivs bara in i `vihem_agreement_versions.blocks`.
- `canonicalJson()` sorterar objektnycklar rekursivt innan hashning, så
  samma logiska innehåll alltid ger samma `content_hash` oavsett
  nyckelordning i minnet.
- `hashBlocks()` → SHA-256 av det kanoniska innehållet.

Efter frysning: en ändring av hyresgästens telefonnummer eller
lägenhetens namn kan ALDRIG påverka en redan fryst version — versionens
`blocks`-jsonb är den enda sanningen från den punkten, oavsett vad
källtabellerna senare säger.

## 6. Versionering / immutable snapshot

`vihem_agreement_versions`: `version_number` (sekventiellt per avtal),
`blocks` (fullt resolvat), `content_hash`, `frozen_at`/`frozen_by`. **Ingen
UPDATE- eller DELETE-policy finns för någon roll** — bara service-role
(via `vihem-agreements-workflow`) kan INSERT:a en rad, aldrig ändra en
befintlig. Skapas exakt en gång per "skicka för signering"-anrop.

Om ett dokument måste ändras efter utskick: det kräver en ny version
(en ny `send`, som ökar `version_number`) — signaturer på version 1 räknas
aldrig automatiskt som signaturer på version 2, eftersom varje
`vihem_agreement_signatures`-rad pekar på en specifik
`agreement_version_id`. Etapp 1 bygger inte ett eget "skapa ny version av
ett redan skickat dokument"-UI-flöde (blocken blir read-only i UI:t efter
utskick) — datamodellen stödjer det (flera rader i `vihem_agreement_
versions` per avtal är redan hur `version_number` är designad), men själva
återöppna-och-skicka-igen-arbetsflödet är inte byggt än.

## 7. Parter och signatärer

Separata koncept, matchar uppdraget: en **part** (`vihem_agreement_parties`)
är vem avtalet är mellan (t.ex. "Vibogruppen AB"), en **signatär**
(`vihem_agreement_signers`) är vem som fysiskt signerar (t.ex. "Kidde
signerar för Vibogruppen AB") — en signatär kan peka på en part via
`party_id`, men behöver inte. `party_type IN ('internal_org','contact',
'company','manual')` — `manual` kräver ingen befintlig VI-HEM-post, vilket
är hur ett fristående avtal ("Anna Andersson" utan att vara hyresgäst)
fungerar.

Ingen separat part-snapshot-tabell: parternas namn/adress renderas som
`party`-block i dokumentets innehåll, så snapshotten lever redan i
`vihem_agreement_versions.blocks` — en egen `party_snapshots`-tabell hade
bara dubblerat samma data.

`sign_order` (nullable int) finns på `vihem_agreement_signers` från start,
men **etapp 1 tillämpar bara parallell signering** — alla signatärer får
sin länk samtidigt vid utskick, ingen kod väntar på att person 1 ska
signera innan person 2 får sin länk. Att aktivera sekventiell signering
senare kräver ingen schemaändring, bara ny logik i `vihem-agreements-
workflow`s `send`-action (och möjligen `remind`) som kollar `sign_order`
innan en signatärs token skapas.

## 8. Säker signeringslänk

`vihem_agreement_signature_requests.token_hash` — **rå token lagras
aldrig**, bara dess SHA-256-hash (`_shared/agreement-tokens.ts`). Detta är
ett medvetet strängare val än den befintliga `vihem_laundry_guest_links`-
konventionen i kodbasen (som lagrar råtoken i klartext) — motiverat av att
en juridisk signatur är högre insats än en tvättbokningslänk. Token: 256
bitar slumpmässig entropi (`crypto.getRandomValues`), hex-kodad, aldrig
kortare eller mer förutsägbar än så.

- **Går ut**: `expires_at`, 30 dagar från utskick/påminnelse.
- **Kan återkallas**: `revoked_at` — sätts explicit vid `cancel`, och
  implicit vid `remind` (en påminnelse roterar alltid till en ny token och
  återkallar den gamla, eftersom en rå token aldrig kan återskapas från
  sin hash för att skickas igen).
- **Knuten till signatär OCH dokumentversion**: `signer_id` +
  `agreement_version_id`, `UNIQUE(signer_id, agreement_version_id)`.
- **Exponerar inga interna UUID:n som enda säkerhetsmekanism**: den publika
  edge-funktionen (`vihem-agreements-public`) tar bara emot `{token}`,
  aldrig ett `agreement_id`/`signer_id` i URL:en — token är den enda
  ingången, och den slås upp via hash, aldrig via ett gissbart ID.

## 9. Handskriven signatur

`src/modules/agreements-v2/components/SignaturePad.tsx` — en NY, fristående
komponent (inte den befintliga inline-canvasen i `ApartmentPage.tsx`, som
är orörd). Pointer events (inte separata touch/mouse-handlers), så samma
kod hanterar finger, Apple Pencil/stylus och mus identiskt.

Sparat på `vihem_agreement_signatures`: `signature_image` (base64 PNG),
`signature_name` (inskrivet namn), plus bevis utöver "en PNG och en
boolean": `ip_address`, `user_agent`, `signed_at`, samt vilken exakt
`agreement_version_id`/därmed `content_hash` som signerades.

## 10. BankID — vad som finns, vad som saknas

**Inventering gjord innan något byggdes** (`supabase/functions/vihem-bankid/
index.ts`, 107 rader): en fungerande integration mot en tredjeparts
BankSignering-proxy, med `start_auth`/`start_sign`/`collect`/`cancel`.
Databas: `vihem_bankid_settings` (per-org, krypterade credentials) +
`vihem_bankid_orders` (`order_ref`, `flow`, `contract_id`).

**Varför den inte återanvänds direkt i etapp 1**: `start_sign` och
`collect` kräver idag en INLOGGAD VI-HEM-profil (`profile.id ===
order.user_id`) och skriver resultatet hårdkodat till
`vihem_contract_signatures`. Avtal V2:s hela poäng med extern signering är
att signatären INTE har en VI-HEM-session — bara en signeringstoken. Det
är alltså inte en liten parametrisering utan en strukturellt annan
autentiseringsväg (token-baserad, inte JWT-baserad), och det är en
produktionsfunktion som redan används för skarp hyresavtalssignering
idag — att bygga om den utan att ha bevisat lösningen grundligt vore fel
risknivå för denna etapp. Uppdraget öppnade uttryckligen för detta:
*"Om BankID kräver ett större separat arbete: bygg provider-gränssnittet
och redovisa exakt vad som saknas."*

**Vad som är byggt**: datamodellen är redo (`signing_method IN
('handwritten','bankid')` på `vihem_agreement_signers`,
`method`/`bankid_personal_number`/`bankid_reference`-kolumner på
`vihem_agreement_signatures`), admin kan välja BankID som metod för en
signatär, och den publika signeringssidan visar tydligt "BankID-signering
kommer snart" istället för att låtsas att det fungerar — aldrig en falsk
signeringsförmåga.

**Exakt vad som krävs för att koppla in det** (nästa etapp):
1. En ny gren i `vihem-bankid`s `start_sign`: acceptera antingen
   `contract_id` (oförändrad, legacy-väg) ELLER en ny
   `agreement_signature_request_token` — verifiera token mot
   `vihem_agreement_signature_requests` (samma hash-uppslag som
   `vihem-agreements-public` redan gör) istället för att kräva en
   inloggad profil.
2. En motsvarande gren i `collect`: auktorisera om anroparen presenterar
   samma giltiga token igen, istället för `profile.id === order.user_id`.
3. Ny completion-branch: när ordern har en
   `agreement_signature_request_id` (ny nullable kolumn på
   `vihem_bankid_orders`), skriv resultatet till
   `vihem_agreement_signatures` (med `method:'bankid'`,
   `bankid_personal_number`, `bankid_reference` = `order_ref`) istället
   för `vihem_contract_signatures`.

Ingen ny BankID-leverantör — samma BankSignering-proxy, samma
provider-anropskod, bara en ny autentiseringsväg runt den.

## 11. SMS och e-post

Ingen ny leverantör. E-post: `_shared/smtp-mailer.ts` utökades med en
`sendMail()`-funktion som stödjer valfri bilaga (befintliga
`sendMailWithAttachment` är nu ett tunt skal ovanpå den, oförändrat
beteende för sin enda befintliga anropare
`vihem-accounted-scanner-forward`). SMS: `vihem-send-sms` (Cellsynt)
anropas **via den ursprungliga anroparens egen JWT**
(`auth.userClient.functions.invoke`), aldrig service-role-klienten —
`vihem-send-sms` autentiserar mot en riktig inloggad
`staff`/`admin`/`superadmin`-profil och skulle annars alltid neka
service-role-anrop.

Leverans loggas i `vihem_agreement_audit_events`
(`sent_email`/`sent_sms`/`email_delivery_failed`/`sms_delivery_failed`/
`reminder_sent`), se punkt 2 för varför det inte är en separat tabell.

## 12. PDF-bilagor

`vihem_agreement_attachments`: namn, beskrivning, ordning, `content_hash`
(SHA-256, beräknad **klientsidan** med `crypto.subtle.digest` innan
uppladdning — undviker att edge-funktionen behöver läsa tillbaka filen
bara för att hasha den). Fri att lägga till/ta bort/ändra ordning medan
`draft`/`ready`. Vid utskick sätter `vihem-agreements-workflow` samtliga
dåvarande bilagors `included_in_version_id` till den nyss frysta
versionen — bilagor som läggs till EFTER utskick (vilket RLS ändå
blockerar tills en ny version finns) ingick aldrig i det som skickades.

## 13. Slutlig PDF

**Inte byggt i denna etapp.** Det som finns: en fullständigt renderad,
hashad, versionerad datastruktur (`vihem_agreement_versions.blocks` +
bilagornas `content_hash`) som är exakt det en PDF-generator skulle
behöva som indata. Att rendera detta till en snygg, nedladdningsbar
slutgiltig PDF (med logotyp, dokumentnummer, signaturer, audit-ID) är
kvar till nästa etapp — se punkt 22.

## 14. Koppling till lägenhet/hyresgäst utan att vara obligatorisk

`vihem_agreement_entity_links(agreement_id, entity_type, entity_id, label)`
— `entity_type` är fri text (`apartment`/`property`/`tenancy`/`tenant`/
`finance_customer`/`customer_project`/`supplier`/`organisation`), flera
länkar per avtal tillåtna, `UNIQUE(agreement_id, entity_type, entity_id)`.
`vihem_agreements` har INGA `tenant_id`/`apartment_id`-kolumner — precis
det uppdraget bad om att undvika. `list_entity_agreements`-action i
`vihem-agreements-admin` gör den omvända uppslagningen ("visa avtal
kopplade till denna entitet").

**Inte byggt i denna etapp**: själva UI-integrationen i
`ApartmentPage.tsx`/`AdminTenantsPage.tsx` (en "Avtal"-sektion med
"+ Skapa avtal" som förifyller `entity_links`) — API:t och datamodellen
för det finns (`saveEntityLinks`/`listEntityAgreements` i
`src/modules/agreements-v2/api.ts`), men inget UI konsumerar dem än. Se
punkt 22.

## 15. Fristående avtal

Direkt konsekvens av punkt 14: ett avtal utan en enda rad i
`vihem_agreement_entity_links` och med enbart `party_type='manual'`-parter
är ett förstklassigt, fullt fungerande avtal — inget särfall i koden,
bara en tom relation.

## 16. Centralt avtalsarkiv

`AgreementsV2Page.tsx` → fliken **Arkiv**: alla dokument inom
organisationen, filter (status/typ), fritextsökning (`title`/
`document_number ILIKE`, med ett `pg_trgm`-index för prestanda). Ingen
mappstruktur i filsystem-mening — kategori/typ/status-filter ger samma
känsla av ett centralt arkiv utan att bygga en separat hierarki-modell,
matchar uppdragets "det behöver inte vara ett klassiskt filsystem".

## 17. V2 Beta och Legacy parallellt

Ny nav-post **"Avtal V2 (beta)"** i `Layout.tsx`, direkt under
"Besiktningar & Avtal" (som är den befintliga legacy-funktionen — den har
aldrig haft en egen toppnivå-nav-post, den ligger inbäddad i
`InspectionsPage.tsx`/`ApartmentPage.tsx`, vilka är helt orörda).
**Inget `module`-villkor** på nav-posten — den är synlig för alla
`staff`/`admin` oavsett organisationens modulinställningar, vilket är hur
"aktiverad för alla organisationer från start" implementeras (jämför med
Ekonomi V2:s `module: 'finance'`-krav).

## 18. Ändrade/nya filer

**Nya migrationer** (5 st, se sektion 1).
**Nya delade backend-moduler**: `_shared/agreement-snapshot.ts`,
`_shared/agreement-tokens.ts`.
**Utökad (bakåtkompatibelt)**: `_shared/smtp-mailer.ts` (ny `sendMail()`).
**Nya edge-funktioner**: `vihem-agreements-admin`, `vihem-agreements-workflow`,
`vihem-agreements-public`.
**Nytt frontend-modul**: `src/modules/agreements-v2/**` (9 filer).
**Ändrade befintliga filer**: `src/App.tsx` (routing + `/sign`-undantag),
`src/components/Layout.tsx` (nav-post), `supabase/config.toml`
(`verify_jwt=false` för `vihem-agreements-public`).
**Orörda**: `vihem_contract_signatures`, `InspectionsPage.tsx`,
`ApartmentPage.tsx`, `vihem-bankid/index.ts`, `vihem_documents`,
`vihem-send-invoice-emails` — bekräftat via `git status --short` innan commit.

## 19. Tester / verifiering

Ingen Deno-CLI eller körande edge-runtime var tillgänglig i den vanliga
sandboxmiljön, men denna etapp hade tillgång till en **lokal Supabase
Docker-instans** (upptäckt via `supabase status`), vilket gjorde det
möjligt att verifiera betydligt mer konkret än i tidigare etapper:

- **Alla fem migrationer applicerade mot en riktig Postgres 17-instans**
  (inte bara läst), tillsammans med samtliga befintliga migrationer i
  repot. Detta avslöjade en verklig, tidigare oupptäckt bugg i en
  BEFINTLIG migration från denna sessions Accounted V2-arbete
  (`20260821140000_accounted_v2_invoice_link_many_sources.sql` — fel typ
  i en `array_agg`-jämförelse, `sql_identifier[]` vs `text[]`), som
  fixades som en del av detta steg.
- **RLS bekräftad påslagen + minst en policy på samtliga 12 nya tabeller**
  via en direkt `pg_class`/`pg_policy`-fråga, inte bara ett antagande.
- **`vihem_next_agreement_number()` funktionstestad**: sekventiellt
  (20 anrop → 20 unika nummer) OCH med RIKTIG samtidighet (15 parallella
  `psql`-processer samtidigt → 15 unika, sekventiella nummer, inga
  dubbletter).
- **Storage-bucket + dess tre RLS-policyer bekräftade skapade**.
- **Frontend**: `npm run typecheck` (tsc), `npm run build` (vite) och
  `npm run lint` (eslint) — alla gröna, 0 nya fel (samma 51
  förbefintliga, orelaterade varningar som resten av kodbasen redan har).
- **Backend**: loose-tsc-passet (samma metod som resten av sessionen,
  ambient `Deno`-deklaration + filtrerat `npm:`-brus) — 0 riktiga fel
  efter en handfull typfixar (bl.a. en genuin TS2345 i
  `vihem-agreements-admin`, inte bara loose-checker-brus).
- **Webbläsarverifiering**: startade dev-servern lokalt mot den
  verifierade databasen, loggade in som en seedad admin-användare,
  bekräftade att "Avtal V2 (beta)" syns i navigeringen, öppnas korrekt,
  och att arkivsidans filter/sök/tomt-läge/felhantering renderar rätt.
  Den faktiska edge-funktions-roundtripen (skapa/lista dokument) kunde
  **inte** verifieras end-to-end i webbläsaren: den lokala Docker-baserade
  edge-runtime-behållaren i denna sandbox visade sig servera en gammal,
  cachad uppsättning funktioner (från en tidigare `supabase start`) och
  kunde inte startas om tillförlitligt i denna miljö (containern
  kraschade upprepade gånger vid omstart — troligen relaterat till en
  redan varnad CPU/AVX-inkompatibilitet i sandboxen, inte till koden).
  Detta är en miljöbegränsning i just detta testverktyg, inte ett bevisat
  fel i koden — men det är ärligt att säga att en fullständig
  klick-igenom-hela-flödet-verifiering (skapa avtal → lägg block → lägg
  signatär → skicka → öppna publik länk → signera → se audit trail) INTE
  kunde genomföras i denna session och bör göras vid nästa tillfälle en
  fungerande edge-runtime finns tillgänglig.
- **Inga automatiska testfiler (Vitest/Jest) skrevs** för detta första
  steg — inget testramverk för backend-logik är etablerat i repot sedan
  tidigare (samma situation som gällde för Ekonomi V2/Accounted V2
  tidigare i denna session), så samma verifieringsmetod (typecheck +
  build + lint + direkt SQL/RLS-verifiering + manuell
  webbläsargenomgång) återanvändes. En riktig testsvit (organisationsisolering,
  utgången/återkallad token, dubbelsignering, immutable version osv. —
  precis den lista uppdraget efterfrågade i sektion 30) är **inte byggd
  i denna etapp** och bör prioriteras tidigt i nästa, eftersom detta är
  ett uttryckligen säkerhets-/integritetskänsligt område.

## 20. Öppna frågor / kvarstående arbete till nästa etapp

1. **BankID-koppling** — se punkt 10 för exakt vad som krävs.
2. **Slutlig PDF-generering** — rendera en frusen version + bilagor +
   signaturer till en nedladdningsbar PDF.
3. **Apartment/hyresgäst-sidans UI-integration** — API:t finns
   (`saveEntityLinks`/`listEntityAgreements`), UI:t i
   `ApartmentPage.tsx`/`AdminTenantsPage.tsx` är inte byggt.
4. **Sekventiell signering** — datamodellen (`sign_order`) finns,
   arbetsflödet tillämpar bara parallell signering.
5. **En riktig testsvit** enligt uppdragets sektion 30-lista.
6. **Fullständig edge-funktions-verifiering i en fungerande lokal miljö**
   (blockerades av sandboxens Docker-instabilitet denna session, se
   punkt 19).
7. **Ny avtalsversion efter utskick** — datamodellen stödjer flera
   versioner per avtal, men UI-flödet "gör om ett redan skickat utkast
   och skicka som version 2" är inte byggt.
8. **Tenant-portalvy** ("Mina avtal") — RLS-grunden finns redan
   (`vihem_agreement_signers.profile_id = auth.uid()`), men ingen egen
   sida konsumerar den ännu (till skillnad från t.ex. `TenantInvoicesPage.tsx`
   för Ekonomi V2).
9. Mall-driven kategoristruktur ("Hyresavtal/Kundavtal/Offerter/..." som
   separata mappar) är idag bara `category`-textfiltret i arkivet, inte en
   egen hierarki — bedömdes tillräckligt för "känslan av ett centralt
   arkiv" per uppdragets egen öppning för det, men kan byggas ut.
