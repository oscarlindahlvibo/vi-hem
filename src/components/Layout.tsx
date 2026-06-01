import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../types';
import {
  Home, Wrench, ClipboardList, Clock, WashingMachine, FileText,
  Newspaper, MessageCircle, LogOut, Bell, Building2, Users, Menu, X,
  ChevronRight, FileX, Settings, BarChart3, ClipboardCheck, Globe
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: React.ReactNode;
  page: string;
  roles: Role[];
  badge?: number;
}

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
  notificationCount?: number;
}

export function Layout({ children, currentPage, onNavigate, notificationCount = 0 }: LayoutProps) {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    { label: 'Besiktningar & Avtal', icon: <ClipboardCheck className="w-5 h-5" />, page: 'inspections', roles: ['staff', 'admin'] },
    // ── Admin ──────────────────────────────────────────────────────────────
    { label: 'Fastigheter', icon: <Building2 className="w-5 h-5" />, page: 'admin-properties', roles: ['admin'] },
    { label: 'Hyresgäster', icon: <Users className="w-5 h-5" />, page: 'admin-tenants', roles: ['admin'] },
    { label: 'Personal', icon: <Settings className="w-5 h-5" />, page: 'admin-staff', roles: ['admin'] },
    { label: 'Löneunderlag', icon: <BarChart3 className="w-5 h-5" />, page: 'admin-payroll', roles: ['admin'] },
    { label: 'Uppsägningar', icon: <FileX className="w-5 h-5" />, page: 'admin-terminations', roles: ['admin'] },
    // ── Superadmin ─────────────────────────────────────────────────────────
    { label: 'Organisationer', icon: <Globe className="w-5 h-5" />, page: 'admin-organisations', roles: ['superadmin'] },
  ];

  const visibleItems = navItems.filter(item => user && item.roles.includes(user.role));

  const navigate = (page: string) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const roleLabel = user?.role === 'tenant' ? 'Hyresgäst' : user?.role === 'staff' ? 'Personal' : user?.role === 'admin' ? 'Admin' : 'Superadmin';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-slate-200 fixed top-0 left-0 h-full z-30">
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">FastighetsApp</p>
              <p className="text-xs text-slate-500">Fastighetsportalen</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
          {visibleItems.map(item => (
            <button
              key={item.page}
              onClick={() => navigate(item.page)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                currentPage === item.page
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              <span className={currentPage === item.page ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}>
                {item.icon}
              </span>
              {item.label}
              {item.badge ? (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">{item.badge}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-slate-200">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-sm">
              {user?.name?.charAt(0) ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500">{roleLabel}</p>
            </div>
            {notificationCount > 0 && (
              <button onClick={() => navigate('notifications')} className="relative">
                <Bell className="w-5 h-5 text-slate-400 hover:text-slate-600" />
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{notificationCount}</span>
              </button>
            )}
          </div>
          <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors">
            <LogOut className="w-4 h-4" />
            Logga ut
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-800 text-sm">FastighetsApp</span>
        </div>
        <div className="flex items-center gap-2">
          {notificationCount > 0 && (
            <button onClick={() => navigate('notifications')} className="relative p-2">
              <Bell className="w-5 h-5 text-slate-500" />
              <span className="absolute top-1 right-1 bg-red-500 text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{notificationCount}</span>
            </button>
          )}
          <button onClick={() => setMobileMenuOpen(true)} className="p-2">
            <Menu className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative bg-white w-72 h-full flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-slate-800">FastighetsApp</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <div className="flex items-center gap-3 px-5 py-4 bg-slate-50 border-b border-slate-200">
              <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">
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
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all ${
                    currentPage === item.page ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className={currentPage === item.page ? 'text-blue-600' : 'text-slate-400'}>{item.icon}</span>
                  {item.label}
                  <ChevronRight className="w-4 h-4 ml-auto text-slate-300" />
                </button>
              ))}
            </nav>
            <div className="px-3 py-4 border-t border-slate-200">
              <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                <LogOut className="w-4 h-4" />
                Logga ut
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 lg:ml-64 pt-16 lg:pt-0">
        <div className="max-w-7xl mx-auto p-4 lg:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
