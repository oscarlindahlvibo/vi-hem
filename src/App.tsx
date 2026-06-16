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
import { PurchaseListPage } from './pages/PurchaseListPage';
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
import { CustomerProjectsPage } from './pages/CustomerProjectsPage';
import { ShortStayPage } from './pages/ShortStayPage';

function AppInner() {
  const { user, loading, passwordRecovery } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [notificationCount, setNotificationCount] = useState(0);
  const [customerProjectsEnabled, setCustomerProjectsEnabled] = useState(false);
  const [shortStayEnabled, setShortStayEnabled] = useState(false);

  useEffect(() => {
    if (!user) {
      setCurrentPage('dashboard');
      setNotificationCount(0);
      return;
    }

    setCurrentPage(user.role === 'superadmin' ? 'admin-organisations' : 'dashboard');
    setNotificationCount(0);
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, [user?.id, user?.role]);

  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, [currentPage]);

  useEffect(() => {
    if (!user?.organisation_id || user.role === 'superadmin') {
      setCustomerProjectsEnabled(false);
      setShortStayEnabled(false);
      return;
    }

    supabase
      .from('vihem_organisations')
      .select('customer_projects_enabled, short_stay_enabled')
      .eq('id', user.organisation_id)
      .maybeSingle()
      .then(({ data }) => {
        setCustomerProjectsEnabled(Boolean(data?.customer_projects_enabled));
        setShortStayEnabled(Boolean(data?.short_stay_enabled));
      });
  }, [user?.organisation_id, user?.role]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('vihem_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)
      .then(({ count }) => setNotificationCount(count ?? 0));

    const channel = supabase
      .channel('vihem_notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'vihem_notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        setNotificationCount(c => c + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    if (!user || !['staff', 'admin'].includes(user.role) || !user.organisation_id) return;
    const reminderUser = user;

    const todayKey = () => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    };
    const minutesOfDay = (time: string) => {
      const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
      return hours * 60 + minutes;
    };
    const localDateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const reminderSent = (key: string) => localStorage.getItem(key) === 'true';
    const markReminderSent = (key: string) => localStorage.setItem(key, 'true');
    const isMissingSchemaError = (error: any) =>
      error?.code === 'PGRST205' || String(error?.message || '').includes('schema cache');
    const sendReminder = async (kind: string, title: string, message: string) => {
      const key = `vihem.reminder.${reminderUser.id}.${todayKey()}.${kind}`;
      if (reminderSent(key)) return;
      const { error } = await supabase.from('vihem_notifications').insert({
        user_id: reminderUser.id,
        organisation_id: reminderUser.organisation_id,
        title,
        message,
        type: 'time_entry',
        link: 'timetracking',
      });
      if (!error) {
        markReminderSent(key);
        setNotificationCount((count) => count + 1);
      }
    };

    async function checkScheduleReminders() {
      const now = new Date();
      const weekday = ((now.getDay() + 6) % 7) + 1;
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const [settingsResult, scheduleResult, openEntriesResult] = await Promise.all([
        supabase
          .from('vihem_organisation_notification_settings')
          .select('settings')
          .eq('organisation_id', reminderUser.organisation_id)
          .maybeSingle(),
        supabase
          .from('vihem_staff_work_schedules')
          .select('*')
          .eq('user_id', reminderUser.id)
          .eq('weekday', weekday)
          .eq('active', true)
          .maybeSingle(),
        supabase
          .from('vihem_time_entries')
          .select('id, entry_type, start_time, end_time, status')
          .eq('user_id', reminderUser.id)
          .eq('status', 'draft')
          .is('end_time', null)
          .gte('start_time', new Date(`${todayKey()}T00:00:00`).toISOString()),
      ]);

      if (isMissingSchemaError(settingsResult.error) || isMissingSchemaError(scheduleResult.error)) return;
      if (settingsResult.error || scheduleResult.error || openEntriesResult.error) {
        console.error('Error checking schedule reminders:', settingsResult.error || scheduleResult.error || openEntriesResult.error);
        return;
      }

      const settingsRow = settingsResult.data;
      const schedule = scheduleResult.data;
      const openEntries = openEntriesResult.data;

      if (!schedule) return;

      const settings = {
        shift_start_reminder: true,
        lunch_start_reminder: true,
        lunch_return_reminder: true,
        shift_end_reminder: true,
        default_lunch_return_minutes: 45,
        ...(settingsRow?.settings || {}),
      };
      const open = openEntries || [];
      const hasOpenWork = open.some((entry: any) => entry.entry_type !== 'break');
      const openBreak = open.find((entry: any) => entry.entry_type === 'break');

      const inReminderWindow = (target: number) => currentMinutes >= target && currentMinutes <= target + 5;

      if (settings.shift_start_reminder && inReminderWindow(minutesOfDay(schedule.work_start)) && open.length === 0) {
        await sendReminder('shift-start', 'Dagens pass börjar', 'Kom ihåg att stämpla in.');
      }

      if (settings.lunch_start_reminder && schedule.lunch_start && inReminderWindow(minutesOfDay(schedule.lunch_start)) && hasOpenWork) {
        await sendReminder('lunch-start', 'Dags för lunch', 'Ditt schema säger att lunch börjar nu.');
      }

      if (settings.lunch_return_reminder && openBreak) {
        const breakStart = new Date(openBreak.start_time);
        const returnMinutes = schedule.lunch_minutes || settings.default_lunch_return_minutes || 45;
        if (localDateKey(breakStart) === todayKey() && Date.now() - breakStart.getTime() >= returnMinutes * 60000) {
          await sendReminder('lunch-return', 'Dags att börja jobba igen', `Din rast har pågått i ${returnMinutes} minuter.`);
        }
      }

      if (settings.shift_end_reminder && inReminderWindow(minutesOfDay(schedule.work_end)) && open.length > 0) {
        await sendReminder('shift-end', 'Dagens schema slutar', 'Kom ihåg att stämpla ut om du inte jobbar över.');
      }
    }

    checkScheduleReminders();
    const interval = window.setInterval(checkScheduleReminders, 60_000);
    return () => window.clearInterval(interval);
  }, [user?.id, user?.role, user?.organisation_id]);

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

      default:
        if (currentPage.startsWith('workorder/')) {
          if (!isStaff) return renderDashboard();
          return <WorkOrdersPage onNavigate={navigate} initialWorkOrderId={currentPage.split('/')[1]} />;
        }
        return renderDashboard();

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

      case 'customer-projects':
        if (!isStaff || !customerProjectsEnabled) return renderDashboard();
        return <CustomerProjectsPage onNavigate={navigate} />;

      case 'short-stay':
        if (!isStaff || !shortStayEnabled) return renderDashboard();
        return <ShortStayPage onNavigate={navigate} />;

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

    }
  }

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={navigate}
      notificationCount={notificationCount}
      customerProjectsEnabled={customerProjectsEnabled}
      shortStayEnabled={shortStayEnabled}
    >
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
