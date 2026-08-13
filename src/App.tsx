import React, { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './components/LoginPage';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { LoadingPage } from './components/ui';
import { supabase } from './lib/supabase';
import { registerNativePush, unregisterNativePush } from './lib/nativePush';

import { TenantDashboard } from './pages/TenantDashboard';
import { StaffDashboard } from './pages/StaffDashboard';
import { MaintenancePage } from './pages/MaintenancePage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { TimeTrackingPage } from './pages/TimeTrackingPage';
import type { TimeTrackingInitialAction } from './pages/TimeTrackingPage';
import { LaundryPage } from './pages/LaundryPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { NewsPage } from './pages/NewsPage';
import { ChatPage } from './pages/ChatPage';
import { PurchaseListPage } from './pages/PurchaseListPage';
import { CalendarPage } from './pages/CalendarPage';
import { TerminationPage } from './pages/TerminationPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AdminPropertiesPage } from './pages/AdminPropertiesPage';
import { AdminTenantsPage } from './pages/AdminTenantsPage';
import { AdminImportPage } from './pages/AdminImportPage';
import { AdminStaffPage } from './pages/AdminStaffPage';
import { AdminPayrollPage } from './pages/AdminPayrollPage';
import { AdminTerminationsPage } from './pages/AdminTerminationsPage';
import { ApartmentPage } from './pages/ApartmentPage';
import { InspectionsPage } from './pages/InspectionsPage';
import { AdminOrganisationsPage } from './pages/AdminOrganisationsPage';
import { CustomerProjectsPage } from './pages/CustomerProjectsPage';
import { ShortStayPage } from './pages/ShortStayPage';
import { YearPlanningPage } from './pages/YearPlanningPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { ScreenDisplayPage } from './pages/ScreenDisplayPage';
import { ScreenSettingsPage } from './pages/ScreenSettingsPage';
import { GuestLaundryPage } from './pages/GuestLaundryPage';
import { FinancePage } from './pages/FinancePage';
import { PlatformSettingsPage } from './pages/PlatformSettingsPage';
import { StaffDocumentScannerPage } from './pages/StaffDocumentScannerPage';
import { RentalPage } from './pages/RentalPage';
import { InventoryPage } from './pages/InventoryPage';
import type { ModuleKey } from './types';

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('VI-HEM page render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--vihem-canvas)] px-4">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-slate-900">Sidan kunde inte visas</h1>
            <p className="mt-2 text-sm text-slate-600">
              Något gick fel när innehållet skulle laddas. Försök ladda om sidan.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Ladda om sidan
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type ModuleState = Partial<Record<ModuleKey, boolean>>;

const OPTIONAL_MODULE_KEYS: ModuleKey[] = [
  'customer_projects',
  'short_stay',
  'year_planning',
  'meetings',
  'finance',
  'rental_management',
  'inventory_management',
];

const DEFAULT_MODULE_STATE: ModuleState = {
  properties: true,
  documents: true,
  maintenance: true,
  work_orders: true,
  time_tracking: true,
  laundry: true,
  chat: true,
  news: true,
  purchasing: true,
  inspections: true,
  finance: false,
  inventory_management: false,
};

function normalizeAppPath(path: string) {
  const withoutTrailingSlash = path.replace(/\/+$/, '');
  return withoutTrailingSlash || '/';
}

function isScreenRoute() {
  const path = normalizeAppPath(window.location.pathname);
  const hashPath = normalizeAppPath(window.location.hash.replace(/^#/, '').split('?')[0] || '/');
  const queryMode = new URLSearchParams(window.location.search).get('mode');
  return path === '/screen' || hashPath === '/screen' || queryMode === 'screen';
}

function isGuestLaundryRoute() {
  const path = normalizeAppPath(window.location.pathname);
  const hashPath = normalizeAppPath(window.location.hash.replace(/^#/, '').split('?')[0] || '/');
  return path === '/laundry-guest' || hashPath === '/laundry-guest';
}

function AppInner() {
  const { user, loading, passwordRecovery } = useAuth();
  const isScreenPath = isScreenRoute();
  const isGuestLaundryPath = isGuestLaundryRoute();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [notificationCount, setNotificationCount] = useState(0);
  const [chatNotificationCount, setChatNotificationCount] = useState(0);
  const [enabledModules, setEnabledModules] = useState<ModuleState>(DEFAULT_MODULE_STATE);

  const loadOrganisationModules = useCallback(async () => {
    if (!user?.organisation_id || user.role === 'superadmin') {
      setEnabledModules(DEFAULT_MODULE_STATE);
      return;
    }

    const organisationId = user.organisation_id;
    const nextModules: ModuleState = { ...DEFAULT_MODULE_STATE };
    const loadedModuleKeys = new Set<ModuleKey>();

    const moduleResult = await supabase
      .from('vihem_organisation_modules')
      .select('module_key, enabled')
      .eq('organisation_id', organisationId);

    if (!moduleResult.error && moduleResult.data?.length) {
      moduleResult.data.forEach((row: any) => {
        const moduleKey = row.module_key as ModuleKey;
        loadedModuleKeys.add(moduleKey);
        nextModules[moduleKey] = Boolean(row.enabled);
      });
    }

    const missingModuleKeys = OPTIONAL_MODULE_KEYS.filter(key => !loadedModuleKeys.has(key));

    if (moduleResult.error || missingModuleKeys.length > 0) {
      await Promise.all(
        missingModuleKeys.map(async (moduleKey) => {
          const { data, error } = await supabase.rpc('vihem_module_enabled', { module_key: moduleKey });
          if (!error && typeof data === 'boolean') {
            nextModules[moduleKey] = data;
            loadedModuleKeys.add(moduleKey);
          }
        })
      );
    }

    const stillMissingModuleKeys = OPTIONAL_MODULE_KEYS.filter(key => !loadedModuleKeys.has(key));

    if (moduleResult.error || stillMissingModuleKeys.length > 0) {
      const organisationResult = await supabase
        .from('vihem_organisations')
        .select('customer_projects_enabled, short_stay_enabled')
        .eq('id', organisationId)
        .maybeSingle();

      if (!organisationResult.error) {
        if (!loadedModuleKeys.has('customer_projects')) {
          nextModules.customer_projects = Boolean(organisationResult.data?.customer_projects_enabled);
        }
        if (!loadedModuleKeys.has('short_stay')) {
          nextModules.short_stay = Boolean(organisationResult.data?.short_stay_enabled);
        }
      }
    }

    if (moduleResult.error) {
      console.warn('Could not load organisation modules, using legacy module fields where available:', moduleResult.error);
    }

    setEnabledModules(nextModules);
  }, [user?.organisation_id, user?.role]);

  useEffect(() => {
    if (!user) {
      setCurrentPage('dashboard');
      setNotificationCount(0);
      setChatNotificationCount(0);
      setEnabledModules(DEFAULT_MODULE_STATE);
      return;
    }

    setCurrentPage(user.role === 'superadmin' ? 'admin-organisations' : 'dashboard');
    setNotificationCount(0);
    setChatNotificationCount(0);
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, [user?.id, user?.role]);

  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, [currentPage]);

  useEffect(() => {
    loadOrganisationModules();
  }, [loadOrganisationModules]);

  useEffect(() => {
    if (!user?.organisation_id || user.role === 'superadmin') return;

    const reloadOnFocus = () => {
      if (!document.hidden) {
        loadOrganisationModules();
      }
    };

    window.addEventListener('focus', reloadOnFocus);
    document.addEventListener('visibilitychange', reloadOnFocus);

    const channel = supabase
      .channel(`vihem_organisation_modules_${user.organisation_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'vihem_organisation_modules',
        filter: `organisation_id=eq.${user.organisation_id}`,
      }, () => {
        loadOrganisationModules();
      })
      .subscribe();

    return () => {
      window.removeEventListener('focus', reloadOnFocus);
      document.removeEventListener('visibilitychange', reloadOnFocus);
      supabase.removeChannel(channel);
    };
  }, [loadOrganisationModules, user?.organisation_id, user?.role]);

  useEffect(() => {
    if (!user) return;
    void registerNativePush(user.id, user.organisation_id);
    const notificationSince = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const refreshNotificationCounts = async () => {
      const [allUnread, chatUnread] = await Promise.all([
        supabase
          .from('vihem_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', notificationSince)
          .is('read_at', null),
        supabase
          .from('vihem_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', notificationSince)
          .is('read_at', null)
          .in('type', ['chat', 'message', 'chat_message']),
      ]);

      setNotificationCount(allUnread.count ?? 0);
      setChatNotificationCount(chatUnread.count ?? 0);
    };

    void refreshNotificationCounts();

    const channel = supabase
      .channel('vihem_notifications')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'vihem_notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        void refreshNotificationCounts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      void unregisterNativePush(user.id);
    };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingPage />
      </div>
    );
  }

  if (passwordRecovery) return <ResetPasswordPage />;

  if (isGuestLaundryPath) return <GuestLaundryPage />;

  if (isScreenPath) return <ScreenDisplayPage />;

  if (!user) return <LoginPage />;

  const navigate = (page: string) => {
    setCurrentPage(page);
    if (page === 'notifications') setNotificationCount(0);
    if (page === 'chat') setChatNotificationCount(0);
    window.scrollTo(0, 0);
  };

  const isAdmin = user.role === 'admin';
  const isSuperadmin = user.role === 'superadmin';
  const isStaff = user.role === 'staff' || isAdmin;
  const isTenant = user.role === 'tenant';
  const isScreen = user.role === 'screen';

  const renderDashboard = () => {
    if (isTenant) return <TenantDashboard onNavigate={navigate} />;
    return <StaffDashboard onNavigate={navigate} />;
  };

  function renderPage() {
    // Superadmin sees only the organisations page
    if (isSuperadmin) {
      return <AdminOrganisationsPage onNavigate={navigate} />;
    }

    if (isScreen) {
      return <ScreenDisplayPage />;
    }

    if (currentPage.startsWith('timetracking')) {
      if (!isStaff) return renderDashboard();
      const action = currentPage.split('/')[1] as TimeTrackingInitialAction;
      return <TimeTrackingPage onNavigate={navigate} initialAction={action} />;
    }

    switch (currentPage) {
      case 'dashboard':
        return renderDashboard();

      case 'apartment':
        if (!isTenant) return renderDashboard();
        return <ApartmentPage onNavigate={navigate} />;

      case 'maintenance':
        return <MaintenancePage onNavigate={navigate} />;

      case 'workorders':
        if (!isStaff) return <MaintenancePage onNavigate={navigate} />;
        return <WorkOrdersPage onNavigate={navigate} />;

      case 'timetracking':
        if (!isStaff) return renderDashboard();
        return <TimeTrackingPage onNavigate={navigate} />;

      case 'laundry':
        return <LaundryPage onNavigate={navigate} />;

      case 'documents':
        return <DocumentsPage onNavigate={navigate} />;

      case 'news':
        return <NewsPage onNavigate={navigate} />;

      case 'chat':
        return <ChatPage onNavigate={navigate} />;

      case 'purchases':
        if (!isStaff) return renderDashboard();
        return <PurchaseListPage onNavigate={navigate} />;

      case 'document-scanner':
        if (!isStaff || !enabledModules.finance) return renderDashboard();
        return <StaffDocumentScannerPage onNavigate={navigate} />;

      case 'calendar':
        if (!isStaff) return renderDashboard();
        return <CalendarPage onNavigate={navigate} />;

      case 'year-planning':
        if (!isStaff || !enabledModules.year_planning) return renderDashboard();
        return <YearPlanningPage onNavigate={navigate} />;

      case 'meetings':
        if (!isStaff || !enabledModules.meetings) return renderDashboard();
        return <MeetingsPage onNavigate={navigate} />;

      case 'customer-projects':
        if (!isStaff || !enabledModules.customer_projects) return renderDashboard();
        return <CustomerProjectsPage onNavigate={navigate} />;

      case 'short-stay':
        if (!isStaff || !enabledModules.short_stay) return renderDashboard();
        return <ShortStayPage onNavigate={navigate} />;

      case 'rental':
        if (!isStaff || !enabledModules.rental_management) return renderDashboard();
        return <RentalPage onNavigate={navigate} />;

      case 'inventory':
        if (!isStaff || !enabledModules.inventory_management) return renderDashboard();
        return <InventoryPage onNavigate={navigate} />;

      case 'termination':
        if (!isTenant) return renderDashboard();
        return <TerminationPage onNavigate={navigate} />;

      case 'notifications':
        return <NotificationsPage onNavigate={navigate} />;

      case 'admin-properties':
        if (!isAdmin) return renderDashboard();
        return <AdminPropertiesPage onNavigate={navigate} />;

      case 'admin-tenants':
        if (!isAdmin) return renderDashboard();
        return <AdminTenantsPage onNavigate={navigate} />;

      case 'admin-import':
        if (!isAdmin) return renderDashboard();
        return <AdminImportPage onNavigate={navigate} />;

      case 'admin-staff':
        if (!isAdmin) return renderDashboard();
        return <AdminStaffPage onNavigate={navigate} />;

      case 'screen-settings':
        if (!isAdmin) return renderDashboard();
        return <ScreenSettingsPage onNavigate={navigate} />;

      case 'admin-settings':
        if (!isAdmin) return renderDashboard();
        return <PlatformSettingsPage />;

      case 'admin-cellsynth':
        if (!isAdmin) return renderDashboard();
        return <PlatformSettingsPage initialSection="cellsynth" />;

      case 'finance':
        if (!isAdmin || !enabledModules.finance) return renderDashboard();
        return <FinancePage onNavigate={navigate} />;

      case 'admin-payroll':
        if (!isAdmin) return renderDashboard();
        return <AdminPayrollPage onNavigate={navigate} />;

      case 'admin-terminations':
        if (!isAdmin) return renderDashboard();
        return <AdminTerminationsPage onNavigate={navigate} />;

      case 'inspections':
        if (!isStaff) return renderDashboard();
        return <InspectionsPage onNavigate={navigate} />;

      default:
        if (currentPage.startsWith('workorder/')) {
          if (!isStaff) return renderDashboard();
          return <WorkOrdersPage onNavigate={navigate} initialWorkOrderId={currentPage.split('/')[1]} />;
        }
        return renderDashboard();

    }
  }

  if (isScreen) return <ScreenDisplayPage />;

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={navigate}
      notificationCount={notificationCount}
      chatNotificationCount={chatNotificationCount}
      enabledModules={enabledModules}
    >
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
