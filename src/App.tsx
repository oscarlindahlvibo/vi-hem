import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './components/LoginPage';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { LoadingPage } from './components/ui';
import { supabase } from './lib/supabase';

import { TenantDashboard } from './pages/TenantDashboard';
import { StaffDashboard } from './pages/StaffDashboard';
import { MaintenancePage } from './pages/MaintenancePage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { TimeTrackingPage } from './pages/TimeTrackingPage';
import { LaundryPage } from './pages/LaundryPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { NewsPage } from './pages/NewsPage';
import { ChatPage } from './pages/ChatPage';
import { TerminationPage } from './pages/TerminationPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AdminPropertiesPage } from './pages/AdminPropertiesPage';
import { AdminTenantsPage } from './pages/AdminTenantsPage';
import { AdminStaffPage } from './pages/AdminStaffPage';
import { AdminPayrollPage } from './pages/AdminPayrollPage';
import { AdminTerminationsPage } from './pages/AdminTerminationsPage';
import { ApartmentPage } from './pages/ApartmentPage';
import { InspectionsPage } from './pages/InspectionsPage';
import { AdminOrganisationsPage } from './pages/AdminOrganisationsPage';

function AppInner() {
  const { user, loading, passwordRecovery } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCurrentPage('dashboard');
      setNotificationCount(0);
      return;
    }

    setCurrentPage(user.role === 'superadmin' ? 'admin-organisations' : 'dashboard');
    setNotificationCount(0);
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)
      .then(({ count }) => setNotificationCount(count ?? 0));

    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        setNotificationCount(c => c + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingPage />
      </div>
    );
  }

  if (passwordRecovery) return <ResetPasswordPage />;

  if (!user) return <LoginPage />;

  const navigate = (page: string) => {
    setCurrentPage(page);
    if (page === 'notifications') setNotificationCount(0);
    window.scrollTo(0, 0);
  };

  const isAdmin = user.role === 'admin';
  const isSuperadmin = user.role === 'superadmin';
  const isStaff = user.role === 'staff' || isAdmin;
  const isTenant = user.role === 'tenant';

  const renderDashboard = () => {
    if (isTenant) return <TenantDashboard onNavigate={navigate} />;
    return <StaffDashboard onNavigate={navigate} />;
  };

  function renderPage() {
    // Superadmin sees only the organisations page
    if (isSuperadmin) {
      return <AdminOrganisationsPage onNavigate={navigate} />;
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

      case 'admin-staff':
        if (!isAdmin) return renderDashboard();
        return <AdminStaffPage onNavigate={navigate} />;

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
        return renderDashboard();
    }
  }

  return (
    <Layout currentPage={currentPage} onNavigate={navigate} notificationCount={notificationCount}>
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
