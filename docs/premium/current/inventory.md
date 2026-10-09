# VI-HEM 3.0 – källkodsinventering

Inventeringen omfattar 107 TSX-filer, 62 vy-/modulfiler, 55 route-val, 251 dialog-/sheet-/kamera-/signaturreferenser och 2625 interaktiva element/formulär/tabeller. Varje element har fil och rad i inventory.json. Dynamiska underflöden och runtime-behörigheter kräver separat prov.

**Detta är en kodinventering, inte en visuell eller funktionell verifiering.** Alla vyer börjar med ej verifierad status för varje bedömningsdimension. Ingen sida markeras klar genom gemensam CSS.

| Vy/modul | Rader | Dialogreferenser | Kodindikatorer att granska |
|---|---:|---:|---|
| src/components/LoginPage.tsx | 326 | 0 | 3 native fields: inspect labels, sizing, validation; 6 native buttons: review purpose/states/touch size |
| src/components/ResetPasswordPage.tsx | 130 | 0 | 1 native fields: inspect labels, sizing, validation; 1 native buttons: review purpose/states/touch size |
| src/modules/agreements-v2/pages/AgreementsV2Page.tsx | 1818 | 7 | 25 native fields: inspect labels, sizing, validation; 41 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination; Sub-12px text: inspect legibility; Native confirmation: review shared dialog replacement |
| src/modules/agreements-v2/pages/PublicAgreementSignPage.tsx | 284 | 1 | 1 native fields: inspect labels, sizing, validation; 7 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement; No shared UI import: inspect component consistency |
| src/modules/agreements-v2/pages/PublicAgreementVerifyPage.tsx | 111 | 0 | Gemensam UI finns; faktisk kvalitet måste granskas |
| src/modules/ekangen/EkangenAdmin.tsx | 450 | 0 | 3 native fields: inspect labels, sizing, validation; 4 native buttons: review purpose/states/touch size; Sub-12px text: inspect legibility |
| src/modules/finance-v2/pages/FinanceV2Page.tsx | 1400 | 2 | 5 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination |
| src/modules/meeting-series/pages/MeetingSeriesPage.tsx | 637 | 4 | 2 native fields: inspect labels, sizing, validation; 1 native buttons: review purpose/states/touch size |
| src/modules/meetings-v2/pages/MeetingsV2Page.tsx | 496 | 2 | 2 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size |
| src/modules/rent/RentModulePage.tsx | 249 | 4 | 2 native fields: inspect labels, sizing, validation; 3 native buttons: review purpose/states/touch size |
| src/modules/vibofast/DriveImagesAdmin.tsx | 72 | 0 | 3 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size; No shared UI import: inspect component consistency |
| src/modules/vibofast/InterestsAdmin.tsx | 66 | 0 | 1 native fields: inspect labels, sizing, validation; 4 native buttons: review purpose/states/touch size; No shared UI import: inspect component consistency |
| src/modules/vibofast/WebsiteAdmin.tsx | 153 | 0 | 12 native fields: inspect labels, sizing, validation; 6 native buttons: review purpose/states/touch size; No shared UI import: inspect component consistency |
| src/pages/AdminBroadcastPage.tsx | 269 | 0 | 1 native fields: inspect labels, sizing, validation; Native confirmation: review shared dialog replacement |
| src/pages/AdminImportPage.tsx | 233 | 0 | 1 native fields: inspect labels, sizing, validation; Table: review mobile presentation, density, pagination |
| src/pages/AdminOrganisationsPage.tsx | 1692 | 4 | 15 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size |
| src/pages/AdminPayrollPage.tsx | 321 | 1 | 1 native fields: inspect labels, sizing, validation; 1 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination |
| src/pages/AdminPropertiesPage.tsx | 747 | 3 | 2 native fields: inspect labels, sizing, validation; 11 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/AdminStaffPage.tsx | 850 | 4 | 6 native fields: inspect labels, sizing, validation; 6 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination |
| src/pages/AdminTenantsPage.tsx | 1255 | 6 | 7 native fields: inspect labels, sizing, validation; 8 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination |
| src/pages/AdminTerminationsPage.tsx | 536 | 2 | 5 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination |
| src/pages/ApartmentPage.tsx | 814 | 3 | 1 native fields: inspect labels, sizing, validation; 3 native buttons: review purpose/states/touch size |
| src/pages/CalendarPage.tsx | 656 | 2 | 3 native fields: inspect labels, sizing, validation; 3 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/ChatPage.tsx | 842 | 6 | 2 native fields: inspect labels, sizing, validation; 4 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/CustomerProjectsPage.tsx | 2320 | 40 | 11 native fields: inspect labels, sizing, validation; 5 native buttons: review purpose/states/touch size |
| src/pages/DocumentsPage.tsx | 823 | 1 | 3 native fields: inspect labels, sizing, validation; 3 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination; Native confirmation: review shared dialog replacement |
| src/pages/FinancePage.tsx | 6800 | 20 | 15 native fields: inspect labels, sizing, validation; 4 native buttons: review purpose/states/touch size |
| src/pages/FleetPage.tsx | 2192 | 22 | 6 native fields: inspect labels, sizing, validation; 19 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/GuestLaundryPage.tsx | 283 | 0 | 2 native buttons: review purpose/states/touch size |
| src/pages/InspectionsPage.tsx | 737 | 6 | 5 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination |
| src/pages/InstallmentPlansPage.tsx | 94 | 0 | Gemensam UI finns; faktisk kvalitet måste granskas |
| src/pages/InventoryPage.tsx | 497 | 10 | 4 native fields: inspect labels, sizing, validation; 9 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/JourPage.tsx | 1415 | 6 | 5 native fields: inspect labels, sizing, validation; 9 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination; Sub-12px text: inspect legibility; Native confirmation: review shared dialog replacement |
| src/pages/LaundryPage.tsx | 1440 | 3 | 3 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/MailPage.tsx | 89 | 0 | 7 native fields: inspect labels, sizing, validation; 1 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement; Custom overlay: inspect focus/scroll/layer ownership |
| src/pages/MaintenancePage.tsx | 1644 | 5 | 5 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination |
| src/pages/MeetingsPage.tsx | 1554 | 2 | 2 native fields: inspect labels, sizing, validation; 5 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/NewsPage.tsx | 596 | 0 | 2 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/NotificationsPage.tsx | 322 | 0 | 2 native buttons: review purpose/states/touch size |
| src/pages/OperationsAccessPage.tsx | 267 | 1 | 2 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/OperationsChecklistsPage.tsx | 90 | 0 | Gemensam UI finns; faktisk kvalitet måste granskas |
| src/pages/OperationsInventoryPage.tsx | 257 | 1 | 1 native buttons: review purpose/states/touch size |
| src/pages/OperationsOverviewPage.tsx | 133 | 0 | 2 native buttons: review purpose/states/touch size |
| src/pages/OperationsRoutinesPage.tsx | 409 | 1 | 5 native fields: inspect labels, sizing, validation; 1 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/PlatformSettingsPage.tsx | 652 | 0 | 9 native fields: inspect labels, sizing, validation; 3 native buttons: review purpose/states/touch size |
| src/pages/ProfilePage.tsx | 442 | 3 | 5 native fields: inspect labels, sizing, validation |
| src/pages/PurchaseListPage.tsx | 483 | 1 | 1 native fields: inspect labels, sizing, validation; Native confirmation: review shared dialog replacement |
| src/pages/RentalPage.tsx | 317 | 8 | 1 native fields: inspect labels, sizing, validation; 1 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination; Sub-12px text: inspect legibility; Native confirmation: review shared dialog replacement |
| src/pages/ScreenDisplayPage.tsx | 2148 | 0 | 2 native fields: inspect labels, sizing, validation; 2 native buttons: review purpose/states/touch size; Sub-12px text: inspect legibility |
| src/pages/ScreenSettingsPage.tsx | 693 | 0 | 2 native fields: inspect labels, sizing, validation; 1 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/ShortStayPage.tsx | 2675 | 6 | 9 native fields: inspect labels, sizing, validation; 4 native buttons: review purpose/states/touch size; Sub-12px text: inspect legibility; Native confirmation: review shared dialog replacement |
| src/pages/SkatteverketPage.tsx | 103 | 0 | Gemensam UI finns; faktisk kvalitet måste granskas |
| src/pages/SmsPage.tsx | 115 | 0 | 2 native buttons: review purpose/states/touch size; Native confirmation: review shared dialog replacement |
| src/pages/StaffDashboard.tsx | 918 | 0 | 23 native buttons: review purpose/states/touch size; Sub-12px text: inspect legibility |
| src/pages/StaffDocumentScannerPage.tsx | 263 | 2 | Gemensam UI finns; faktisk kvalitet måste granskas |
| src/pages/StaffSchedulePage.tsx | 699 | 1 | 3 native buttons: review purpose/states/touch size; Sub-12px text: inspect legibility; Native confirmation: review shared dialog replacement |
| src/pages/TenantDashboard.tsx | 464 | 0 | 8 native buttons: review purpose/states/touch size |
| src/pages/TenantInvoicesPage.tsx | 147 | 0 | 1 native buttons: review purpose/states/touch size |
| src/pages/TerminationPage.tsx | 388 | 0 | 1 native fields: inspect labels, sizing, validation |
| src/pages/TimeTrackingPage.tsx | 3166 | 17 | 40 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination; Native confirmation: review shared dialog replacement |
| src/pages/WorkOrdersPage.tsx | 2532 | 13 | 6 native fields: inspect labels, sizing, validation; 18 native buttons: review purpose/states/touch size; Table: review mobile presentation, density, pagination; Native confirmation: review shared dialog replacement |
| src/pages/YearPlanningPage.tsx | 1369 | 2 | 1 native fields: inspect labels, sizing, validation; 8 native buttons: review purpose/states/touch size; Sub-12px text: inspect legibility; Native confirmation: review shared dialog replacement |

## Routes och befintliga frontendgrindar

Backend/RLS är den verkliga behörighetskontrollen. Tabellen dokumenterar befintliga frontendval och ger inga nya behörigheter.

| Route | Komponenter | Lokala grindar |
|---|---|---|
| dashboard |  | Kontrollera även omgivande router/rollgrind |
| apartment | ApartmentPage | !isTenant |
| maintenance | MaintenancePage | Kontrollera även omgivande router/rollgrind |
| workorders | MaintenancePage, WorkOrdersPage | !isStaff |
| timetracking | TimeTrackingPage | !isStaff |
| laundry | LaundryPage | Kontrollera även omgivande router/rollgrind |
| documents | DocumentsPage | Kontrollera även omgivande router/rollgrind |
| mail-search | MailPage | !isStaff |
| mail-watchers | MailPage | !isStaff |
| news | NewsPage | Kontrollera även omgivande router/rollgrind |
| chat | ChatPage | Kontrollera även omgivande router/rollgrind |
| purchases | PurchaseListPage | !isStaff |
| document-scanner | StaffDocumentScannerPage | !isStaff || !enabledModules.finance |
| calendar | CalendarPage | !isStaff |
| year-planning | YearPlanningPage | !isStaff || !enabledModules.year_planning |
| meetings | MeetingsPage | !isStaff || !enabledModules.meetings |
| meetings-v2 | MeetingsV2Page | !isStaff || !enabledModules.meetings |
| meeting-series | MeetingSeriesPage | !isStaff || !enabledModules.meetings |
| customer-projects | CustomerProjectsPage | !isStaff || !enabledModules.customer_projects |
| short-stay | ShortStayPage | !isStaff || !enabledModules.short_stay |
| rental | RentalPage | !isStaff || !enabledModules.rental_management |
| inventory | InventoryPage | !isStaff || !enabledModules.inventory_management |
| termination | TerminationPage | !isTenant |
| notifications | NotificationsPage | Kontrollera även omgivande router/rollgrind |
| vibofast-website | WebsiteAdmin | !isAdmin |
| ekangen-website | EkangenAdmin | !isAdmin |
| admin-properties | AdminPropertiesPage | !isAdmin |
| admin-tenants | AdminTenantsPage | !isAdmin |
| admin-import | AdminImportPage | !isAdmin |
| admin-staff | AdminStaffPage | !isAdmin |
| staff-schedule | StaffSchedulePage | !isStaff |
| screen-settings | ScreenSettingsPage | !isAdmin |
| admin-broadcast | AdminBroadcastPage | !isAdmin |
| operations-overview | OperationsOverviewPage | !isStaff || !enabledModules.operations |
| operations-access | OperationsAccessPage | !isStaff || !enabledModules.operations |
| operations-routines | OperationsRoutinesPage | !isStaff || !enabledModules.operations |
| operations-checklists | OperationsChecklistsPage | !isStaff || !enabledModules.operations |
| operations-inventory | OperationsInventoryPage | !isStaff || !enabledModules.operations |
| admin-settings | PlatformSettingsPage | !isSystemAdmin |
| admin-google-workspace | PlatformSettingsPage | !isSystemAdmin |
| admin-cellsynth | SmsPage | !isSystemAdmin |
| finance | FinancePage | !isStaff || !enabledModules.finance |
| finance-v2 | FinanceV2Page | !isStaff || !enabledModules.finance |
| rent-customers |  | Kontrollera även omgivande router/rollgrind |
| rent-adjustments |  | Kontrollera även omgivande router/rollgrind |
| rent-billing | RentModulePage | !isStaff || !enabledModules.finance |
| installment-plans | InstallmentPlansPage | !isStaff || !enabledModules.finance |
| tenant-invoices | TenantInvoicesPage | !isTenant || !enabledModules.finance |
| agreements-v2 | AgreementsV2Page | !isStaff |
| skatteverket | SkatteverketPage | !isStaff || !enabledModules.skatteverket |
| jour | JourPage | !isStaff || !enabledModules.jour |
| fleet | FleetPage | !isStaff || !enabledModules.fleet_management |
| admin-payroll | AdminPayrollPage | !isStaff || !enabledModules.payroll |
| admin-terminations | AdminTerminationsPage | !isAdmin |
| inspections | InspectionsPage | !isStaff |
