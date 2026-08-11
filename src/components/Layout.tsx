import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { ModuleKey, Role } from '../types';
import { AppLogo } from './AppLogo';
import { OfflineStatus } from './OfflineStatus';
import { Button, Input, Modal } from './ui';
import {
  Home, Wrench, ClipboardList, Clock, WashingMachine, FileText,
  Newspaper, MessageCircle, LogOut, Bell, Building2, Users, Menu, X,
  ChevronRight, FileX, Settings, BarChart3, ClipboardCheck, Globe, KeyRound, ShoppingCart, Briefcase,
  BedDouble, CalendarDays, Landmark, MessageSquareText, Monitor, ScanLine, SlidersHorizontal,
  Truck,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: React.ReactNode;
  page: string;
  roles: Role[];
  badge?: number;
  module?: ModuleKey;
}

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
  notificationCount?: number;
  enabledModules?: Partial<Record<ModuleKey, boolean>>;
}

export function Layout({ children, currentPage, onNavigate, notificationCount = 0, enabledModules = {} }: LayoutProps) {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const navItems: NavItem[] = [
    // ── Tenant ────────────────────────────────────────────────────────────
    { label: 'Hem', icon: <Home className="w-5 h-5" />, page: 'dashboard', roles: ['tenant', 'staff', 'admin'] },
    { label: 'Min lägenhet', icon: <Building2 className="w-5 h-5" />, page: 'apartment', roles: ['tenant'] },
    { label: 'Felanmälan', icon: <Wrench className="w-5 h-5" />, page: 'maintenance', roles: ['tenant', 'staff', 'admin'] },
    { label: 'Tvättbokning', icon: <WashingMachine className="w-5 h-5" />, page: 'laundry', roles: ['tenant', 'staff', 'admin'] },
    { label: 'Dokument', icon: <FileText className="w-5 h-5" />, page: 'documents', roles: ['tenant', 'staff', 'admin'] },
    { label: 'Nyheter', icon: <Newspaper className="w-5 h-5" />, page: 'news', roles: ['tenant', 'staff', 'admin'] },
    { label: 'Chatt', icon: <MessageCircle className="w-5 h-5" />, page: 'chat', roles: ['tenant', 'staff', 'admin'] },
    { label: 'Uppsägning', icon: <FileX className="w-5 h-5" />, page: 'termination', roles: ['tenant'] },
    // ── Staff / Admin ──────────────────────────────────────────────────────
    { label: 'Arbetsordrar', icon: <ClipboardList className="w-5 h-5" />, page: 'workorders', roles: ['staff', 'admin'] },
    { label: 'Tidrapportering', icon: <Clock className="w-5 h-5" />, page: 'timetracking', roles: ['staff', 'admin'] },
    { label: 'Kalender', icon: <CalendarDays className="w-5 h-5" />, page: 'calendar', roles: ['staff', 'admin'] },
    { label: 'Inköpslista', icon: <ShoppingCart className="w-5 h-5" />, page: 'purchases', roles: ['staff', 'admin'] },
    { label: 'Scanna underlag', icon: <ScanLine className="w-5 h-5" />, page: 'document-scanner', roles: ['staff', 'admin'], module: 'finance' },
    { label: 'Årsplanering', icon: <CalendarDays className="w-5 h-5" />, page: 'year-planning', roles: ['staff', 'admin'], module: 'year_planning' },
    { label: 'Möten & Uppföljning', icon: <MessageSquareText className="w-5 h-5" />, page: 'meetings', roles: ['staff', 'admin'], module: 'meetings' },
    { label: 'Kundprojekt', icon: <Briefcase className="w-5 h-5" />, page: 'customer-projects', roles: ['staff', 'admin'], module: 'customer_projects' },
    { label: 'Korttidsuthyrning', icon: <BedDouble className="w-5 h-5" />, page: 'short-stay', roles: ['staff', 'admin'], module: 'short_stay' },
    { label: 'Uthyrning', icon: <Truck className="w-5 h-5" />, page: 'rental', roles: ['staff', 'admin'], module: 'rental_management' },
    { label: 'Besiktningar & Avtal', icon: <ClipboardCheck className="w-5 h-5" />, page: 'inspections', roles: ['staff', 'admin'] },
    // ── Admin ──────────────────────────────────────────────────────────────
    { label: 'Fastigheter', icon: <Building2 className="w-5 h-5" />, page: 'admin-properties', roles: ['admin'] },
    { label: 'Hyresgäster', icon: <Users className="w-5 h-5" />, page: 'admin-tenants', roles: ['admin'] },
    { label: 'Personal', icon: <Settings className="w-5 h-5" />, page: 'admin-staff', roles: ['admin'] },
    { label: 'TV-skärm', icon: <Monitor className="w-5 h-5" />, page: 'screen-settings', roles: ['admin'] },
    { label: 'Inställningar', icon: <SlidersHorizontal className="w-5 h-5" />, page: 'admin-settings', roles: ['admin'] },
    { label: 'Ekonomi', icon: <Landmark className="w-5 h-5" />, page: 'finance', roles: ['admin'], module: 'finance' },
    { label: 'Löneunderlag', icon: <BarChart3 className="w-5 h-5" />, page: 'admin-payroll', roles: ['admin'] },
    { label: 'Uppsägningar', icon: <FileX className="w-5 h-5" />, page: 'admin-terminations', roles: ['admin'] },
    // ── Superadmin ─────────────────────────────────────────────────────────
    { label: 'Organisationer', icon: <Globe className="w-5 h-5" />, page: 'admin-organisations', roles: ['superadmin'] },
  ];

  const visibleItems = navItems.filter(item => {
    if (!user || !item.roles.includes(user.role)) return false;
    if (item.module) return Boolean(enabledModules[item.module]);
    return true;
  });

  const bottomItems = user ? [
    { label: 'Hem', icon: <Home className="h-5 w-5" />, action: () => navigate('dashboard'), active: currentPage === 'dashboard' },
    {
      label: user.role === 'tenant' ? 'Fel' : 'Jobb',
      icon: user.role === 'tenant' ? <Wrench className="h-5 w-5" /> : <ClipboardList className="h-5 w-5" />,
      action: () => navigate(user.role === 'tenant' ? 'maintenance' : 'workorders'),
      active: currentPage === (user.role === 'tenant' ? 'maintenance' : 'workorders'),
    },
    { label: 'Chatt', icon: <MessageCircle className="h-5 w-5" />, action: () => navigate('chat'), active: currentPage === 'chat' },
    {
      label: user.role === 'tenant' ? 'Tvätt' : 'Tid',
      icon: user.role === 'tenant' ? <WashingMachine className="h-5 w-5" /> : <Clock className="h-5 w-5" />,
      action: () => navigate(user.role === 'tenant' ? 'laundry' : 'timetracking'),
      active: currentPage === (user.role === 'tenant' ? 'laundry' : 'timetracking'),
    },
    { label: 'Mer', icon: <Menu className="h-5 w-5" />, action: () => setMobileMenuOpen(true), active: false },
  ] : [];

  const navigate = (page: string) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const roleLabel = user?.role === 'tenant' ? 'Hyresgäst' : user?.role === 'staff' ? 'Personal' : user?.role === 'admin' ? 'Admin' : 'Superadmin';

  const resetPasswordForm = () => {
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordSuccess('');
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 8) {
      setPasswordError('Lösenordet måste vara minst 8 tecken.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Lösenorden matchar inte.');
      return;
    }

    setPasswordLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordLoading(false);

    if (error) {
      setPasswordError(error.message);
      return;
    }

    setPasswordSuccess('Lösenordet är uppdaterat.');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="min-h-screen flex bg-[var(--vihem-canvas)] text-slate-900">
      <OfflineStatus />
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-30 hidden h-full w-[17rem] flex-col border-r border-slate-200/80 bg-white/95 shadow-[8px_0_34px_rgba(15,23,42,0.045)] backdrop-blur-xl lg:flex">
        <div className="border-b border-slate-200/80 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-xl shadow-sm ring-1 ring-slate-200">
              <AppLogo className="w-full h-full" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-950">VI-HEM</p>
              <p className="text-xs font-medium text-slate-500">Fastighetsportalen</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {visibleItems.map(item => (
            <button
              key={item.page}
              onClick={() => navigate(item.page)}
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                currentPage === item.page
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100 shadow-sm shadow-blue-600/5'
                  : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-950'
              }`}
            >
              <span className={currentPage === item.page ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-700'}>
                {item.icon}
              </span>
              {item.label}
              {item.badge ? (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">{item.badge}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-200/80 px-3 py-4">
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50/90 px-3 py-3 ring-1 ring-slate-200">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm shadow-blue-600/20">
              {user?.name?.charAt(0) ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-bold text-slate-950">{user?.name}</p>
              <p className="text-xs font-medium text-slate-500">{roleLabel}</p>
            </div>
            {notificationCount > 0 && (
              <button onClick={() => navigate('notifications')} className="relative">
                <Bell className="w-5 h-5 text-slate-400 hover:text-slate-600" />
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{notificationCount}</span>
              </button>
            )}
          </div>
          <button
            onClick={() => setPasswordModalOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
          >
            <KeyRound className="w-4 h-4" />
            Byt lösenord
          </button>
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
            <LogOut className="w-4 h-4" />
            Logga ut
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-30 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 overflow-hidden rounded-xl shadow-sm ring-1 ring-slate-200">
            <AppLogo className="w-full h-full" />
          </div>
          <span className="text-sm font-black text-slate-950">VI-HEM</span>
        </div>
        <div className="flex items-center gap-2">
          {notificationCount > 0 && (
            <button onClick={() => navigate('notifications')} className="relative p-2">
              <Bell className="w-5 h-5 text-slate-500" />
              <span className="absolute top-1 right-1 bg-red-500 text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{notificationCount}</span>
            </button>
          )}
          <button onClick={() => setMobileMenuOpen(true)} className="rounded-xl p-2 hover:bg-slate-100">
            <Menu className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative flex h-full w-72 flex-col bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg shadow-sm overflow-hidden">
                  <AppLogo className="w-full h-full" />
                </div>
                <span className="font-bold text-slate-800">VI-HEM</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-xl hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 font-bold text-white shadow-sm shadow-blue-600/20">
                {user?.name?.charAt(0) ?? '?'}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{user?.name}</p>
                <p className="text-xs text-slate-500">{roleLabel}</p>
              </div>
            </div>
            <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">
              {visibleItems.map(item => (
                <button
                  key={item.page}
                  onClick={() => navigate(item.page)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-all ${
                    currentPage === item.page ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100 shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                  }`}
                >
                  <span className={currentPage === item.page ? 'text-blue-600' : 'text-slate-400'}>{item.icon}</span>
                  {item.label}
                  <ChevronRight className="w-4 h-4 ml-auto text-slate-300" />
                </button>
              ))}
            </nav>
            <div className="px-3 py-4 border-t border-slate-200">
              <button
                onClick={() => {
                  setPasswordModalOpen(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-600 hover:bg-slate-100"
              >
                <KeyRound className="w-4 h-4" />
                Byt lösenord
              </button>
              <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-600 hover:bg-slate-100">
                <LogOut className="w-4 h-4" />
                Logga ut
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-x-hidden pb-24 pt-16 lg:ml-[17rem] lg:pb-0 lg:pt-0">
        <div className="w-full min-w-0 max-w-[1560px] overflow-x-hidden p-4 lg:p-6 xl:p-8">
          {children}
        </div>
      </main>

      {user?.role !== 'superadmin' && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 shadow-[0_-12px_34px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:hidden">
          <div className="grid grid-cols-5 gap-1">
            {bottomItems.map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-semibold transition-colors ${
                  item.active ? 'text-blue-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className={item.active ? 'text-blue-600' : 'text-slate-400'}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
                {item.label === 'Chatt' && notificationCount > 0 && (
                  <span className="absolute right-3 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}

      <Modal
        open={passwordModalOpen}
        onClose={() => {
          setPasswordModalOpen(false);
          resetPasswordForm();
        }}
        title="Byt lösenord"
      >
        <div className="space-y-4">
          <Input
            label="Nytt lösenord"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Input
            label="Bekräfta lösenord"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {passwordError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {passwordError}
            </div>
          )}
          {passwordSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              {passwordSuccess}
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPasswordModalOpen(false);
                resetPasswordForm();
              }}
            >
              Stäng
            </Button>
            <Button variant="primary" onClick={handleChangePassword} loading={passwordLoading}>
              Uppdatera
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
