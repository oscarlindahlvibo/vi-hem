# Modulstatus – VI-HEM 3.0

Ingen rad är modul-Klar. Gemensamma kontroller påverkar även orörda vyer; det ersätter inte individuell verifiering. Publika webbplatser i apps/ är separata produkter, deras VI-HEM-adminvyer ingår.

| Vy/modul | Individuell ändring | Faktisk verifiering | Återstående |
|---|---|---|---|
| src/components/LoginPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/components/ResetPasswordPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/agreements-v2/pages/AgreementsV2Page.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/agreements-v2/pages/PublicAgreementSignPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/agreements-v2/pages/PublicAgreementVerifyPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/ekangen/EkangenAdmin.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/finance-v2/pages/FinanceV2Page.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/meeting-series/pages/MeetingSeriesPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/meetings-v2/pages/MeetingsV2Page.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/rent/RentModulePage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/vibofast/DriveImagesAdmin.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/vibofast/InterestsAdmin.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/modules/vibofast/WebsiteAdmin.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/AdminBroadcastPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/AdminImportPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/AdminOrganisationsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/AdminPayrollPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/AdminPropertiesPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/AdminStaffPage.tsx | Avatarer, kompakt organisationsinställning, namngivna knappar | Lista/inställningsöppning och screenshots 390/1440 | Skapa/redigera/behörigheter och övriga bredder återstår |
| src/pages/AdminTenantsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/AdminTerminationsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/ApartmentPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/CalendarPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/ChatPage.tsx | Plusmeny, layout, avatarer | Skicka/svar/reaktion/delning/utkast; 5 bredder | Observerat rejoinprov förklarat och 12 SDK-cykler provade; browser-/native-avbrott samt fysisk keyboard/voice och samtliga gruppflöden återstår |
| src/pages/CustomerProjectsPage.tsx | Grupperat projektformulär, utkastskydd/fasta åtgärder, kontextuella tomlägen, ladd-/statusfel, lugn nyprojektöversikt, atomisk skapande-RPC | Admin QA ny inline-kund → projekt/personer; kontrollerat tilldelningsfel/återförsök; sökning/Enter/planeringsstatus; form/detalj 390/768/1440; parallell RPC/rollback/org-gränser | Samtliga övriga projektflikar/modaler, staff-flöden, ekonomi-/dokument-/ÄTA-säkerhet, offline och hela DoD kvar |
| src/pages/DocumentsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/FinancePage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/FleetPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/GuestLaundryPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/InspectionsPage.tsx | Rumsflöde, progress, gemensamt objektformulär, sammanfattning, utkastskydd, atomisk inspection/protokoll-RPC, sparfeedback | Staff utkast/återöppna/rum/notering/finaliseringsfel/retry; JWT rollback/org/tenant-protokoll; rum390/768, sammanfattning390/430/768/1024/1440; text-PDF renderad | Kamera/HEIC/filer, privat bildmigrering/äldre referenser, foton/lång-PDF/signering, konflikt/roll/native och hela DoD kvar |
| src/pages/InstallmentPlansPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/InventoryPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/JourPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/LaundryPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/MailPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/MaintenancePage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/MeetingsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/NewsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/NotificationsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/OperationsAccessPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/OperationsChecklistsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/OperationsInventoryPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/OperationsOverviewPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/OperationsRoutinesPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/PlatformSettingsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/ProfilePage.tsx | Egen profil + privat bild | Admin/tenant profil och inställningsdialog; 5 bredder | Bildval/crop blockerad i browser; fysisk kamera/HEIC återstår |
| src/pages/PurchaseListPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/RentalPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/ScreenDisplayPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/ScreenSettingsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/ShortStayPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/SkatteverketPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/SmsPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/StaffDashboard.tsx | Kompakt hero, verklig projekträkning, lugna arbetsorderrader, iPad-dynamiska kolumner, laddfel/återförsök och stale-request-skydd | Admin/personal autentiserade 390/768/1440; personal öppnar egen order; tilldelade order/projekt återlästa | 430/1024, aktiv stämpling/layoutförändring, frånvaro, skärmroll, laddfelsprov och full roll-/realtids-/DoD-matris kvar |
| src/pages/StaffDocumentScannerPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/StaffSchedulePage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/TenantDashboard.tsx | Verkligt felanmälansantal, borttaget påhittat förfallodatum, boendetjänster, kompakt tomhet, mobilstatistik, egen avatar, laddfel/återförsök | Tenant QA 390/768/1440 med aktiv bostad/4 ärenden och 3 förhandsvisningar; Kontakt/Tvätt navigation; tom bostad desktop checkpoint | Fakturaaktiverad variant, signering, nyheter, bokad tvätt, laddfelsprov, 430/1024, realtime och fysisk mobil/DoD kvar |
| src/pages/TenantInvoicesPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/TerminationPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |
| src/pages/TimeTrackingPage.tsx | Kompakt mobilöversikt, aktiva dagar, arbetsorderkontext, skyddad formulärsparning/utkast, datumvalidering och rollriktiga åtgärder | Admin QA stämpla in → byt jobb → stämpla ut; avsiktligt INSERT-fel/återförsök; manuell 45min-post; felaktig sluttid; osparat-dialog; 390/768/1440 skärmbilder | Transaktionella jobbbyten/utstämpling, offline/dublettsäkerhet, staff-/admin-granskning, frånvaro och fysisk enhet återstår |
| src/pages/WorkOrdersPage.tsx | Detaljhierarki, grupperade formulär/fasta åtgärder, utkastskydd, kommentarutkast per order och tangentbordsöppning | Tidigare detaljflöden + ny/redigera 390/768/1440, kontrollerat sparfel/återförsök, utkastbyte mellan två order | Bilagor, fler bredder/feltillstånd, bulk/svep/tid och full rollmatris återstår |
| src/pages/YearPlanningPage.tsx | Baslinjeinventerad | Ingen individuell runtime-/visuell verifiering | Alla revisionsdimensioner och DoD-flöden återstår |

Aktuell maskininventering finns i current/inventory.md. Kör `node scripts/premium/inventory.mjs` för aktuell JSON med kontrollernas fil/rad; JSON är genererad och inte versionerad i current/. Baslinje-JSON från projektstarten bevaras i inventory.json.

## 2026-10-10 – besiktningsarkiv

Besiktningar har nu första Drive-jobbflödet, lokal filkö, filarkiv/versioner och lazy PDF-generator. QA JWT/DB, mockad Google-transport och verklig Edge-felväg provade. Browser sparning/återöppning och konfigurationsfel samt fem viewports dokumenterade. Riktig Drive, browserfoto (extension-behörighet), fysisk mobil, full migrering/gallring och samtidig redigering återstår. DocumentsPage får säker inspection-jobb-hämtning; full dokumentmodul-UX/roller ej genomgångna. Ingen modul ändras till Klar. Se inspection-drive-verification.md.
