import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Users, Plus, Edit2, ShieldCheck, KeyRound, RefreshCw, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createUserAccount, resetUserPassword, sendUserPasswordResetEmail } from '../lib/userAdmin';
import { normalizePersonalNumber } from '../lib/bankid';
import {
  Avatar,
  Card,
  Badge,
  Button,
  Modal,
  Input,
  PageHeader,
  EmptyState,
  LoadingPage,
  SearchInput,
  Tabs,
  Select,
} from '../components/ui';
import type { ModuleKey, Profile, StaffWorkSchedule } from '../types';
import { defaultNotificationSettings, NOTIFICATION_SETTING_LABELS, type NotificationSettings } from '../lib/utils';

// Same optional-module set App.tsx gates on an org-wide on/off toggle
// (OPTIONAL_MODULE_KEYS) -- these are the only modules it makes sense to
// grant per staff member. Core features (maintenance, work orders, time
// tracking, ...) are always on for every staff member and aren't listed
// here, matching DEFAULT_MODULE_STATE in App.tsx.
// 'finance', 'skatteverket' and 'payroll' were previously excluded here
// because their RLS was hard-gated to role='admin' everywhere -- ticking
// the checkbox would have done nothing. 20260902130000_module_grants_extend_finance.sql
// added module.finance/module.skatteverket/module.payroll as alternate
// paths through that RLS (finance via vihem_user_has_company_access,
// skatteverket and payroll directly), so every optional module now follows
// the same one grant pattern -- see that migration for exactly what a
// grant here does and does not unlock.
const GRANTABLE_MODULES: { key: ModuleKey; label: string }[] = [
  { key: 'inventory_management', label: 'Lager' },
  { key: 'customer_projects', label: 'Kundprojekt' },
  { key: 'short_stay', label: 'Korttidsuthyrning' },
  { key: 'rental_management', label: 'Uthyrning' },
  { key: 'year_planning', label: 'Årsplanering' },
  { key: 'meetings', label: 'Möten & uppföljning' },
  { key: 'jour', label: 'Jour' },
  { key: 'fleet_management', label: 'Fleet Manager' },
  { key: 'operations', label: 'Drift & rutiner' },
  { key: 'finance', label: 'Ekonomi' },
  { key: 'skatteverket', label: 'Skatteverket' },
  { key: 'payroll', label: 'Löneunderlag' },
];

const WEEKDAYS = [
  { weekday: 1, label: 'Måndag' },
  { weekday: 2, label: 'Tisdag' },
  { weekday: 3, label: 'Onsdag' },
  { weekday: 4, label: 'Torsdag' },
  { weekday: 5, label: 'Fredag' },
  { weekday: 6, label: 'Lördag' },
  { weekday: 7, label: 'Söndag' },
];

type ScheduleFormRow = {
  weekday: number;
  active: boolean;
  work_start: string;
  work_end: string;
  lunch_start: string;
  lunch_minutes: string;
};


function scheduleMinutes(row:ScheduleFormRow) {
  if(!row.active||!row.work_start||!row.work_end||row.work_end<=row.work_start)return 0;
  const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
  return Math.max(0,minutes(row.work_end)-minutes(row.work_start)-(row.lunch_start?Math.max(0,parseInt(row.lunch_minutes,10)||0):0));
}
function formatScheduleMinutes(minutes:number){return `${Math.floor(minutes/60)} h${minutes%60?` ${minutes%60} min`:''}`;}

function isMissingSchemaError(error: any) {
  return error?.code === 'PGRST205' || String(error?.message || '').includes('schema cache');
}

const ROLE_LABELS: Record<string, string> = {
  staff: 'Personal',
  admin: 'Admin',
  superadmin: 'Superadmin',
  screen: 'TV-skärm',
};

const ROLE_COLORS: Record<string, string> = {
  staff: 'text-blue-700 bg-blue-100',
  admin: 'text-teal-700 bg-teal-100',
  superadmin: 'text-red-700 bg-red-100',
  screen: 'text-violet-700 bg-violet-100',
};

interface AdminStaffPageProps { onNavigate: (page: string) => void; }
export function AdminStaffPage({ onNavigate: _onNavigate }: AdminStaffPageProps) {
  const { user } = useAuth();
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingStaff, setEditingStaff] = useState<Profile | null>(null);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editorStep,setEditorStep]=useState('contact');
  const [activeScheduleDay,setActiveScheduleDay]=useState<number|null>(1);
  const [discard,setDiscard]=useState(false);
  const [openingStaff,setOpeningStaff]=useState(false);
  const [editorLoadError,setEditorLoadError]=useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [resetCredentials, setResetCredentials] = useState<{ email: string } | null>(null);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState('');
  const saveOperation=useRef<{body:string;id:string}|null>(null);
  const saveLock=useRef(false);
  const [copyTargets,setCopyTargets]=useState<number[]>([]);
  const [copySource,setCopySource]=useState<number|null>(null);
  const [scheduleRows, setScheduleRows] = useState<ScheduleFormRow[]>([]);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [savingNotificationSettings, setSavingNotificationSettings] = useState(false);
  const [moduleAccess, setModuleAccess] = useState<Set<ModuleKey>>(new Set());
  const [initialModuleAccess, setInitialModuleAccess] = useState<Set<ModuleKey>>(new Set());
  const [staffFormData, setStaffFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'staff',
    active: true,
    bankid_personal_number: '',
    is_system_admin: false,
  });
  const dirty=useUnsavedChanges({staffFormData,scheduleRows,modules:[...moduleAccess].sort()},showStaffModal);
  const closeEditor=()=>{if(saving)return;if(dirty){setDiscard(true);return;}setShowStaffModal(false);setEditingStaff(null);resetForm();};
  const canManageSystemAdminFlag = user?.role === 'superadmin' || user?.is_system_admin;

  const fetchNotificationSettings=useCallback(async () => {
    if (!user?.organisation_id) return;
    const { data, error } = await supabase
      .from('vihem_organisation_notification_settings')
      .select('settings')
      .eq('organisation_id', user.organisation_id)
      .maybeSingle();
    if (error) {
      if (!isMissingSchemaError(error)) console.error('Error fetching notification settings:', error);
      return;
    }
    setNotificationSettings({ ...defaultNotificationSettings, ...(data?.settings || {}) });
  },[user?.organisation_id]);

  async function saveNotificationSettings() {
    if (!user?.organisation_id) return;
    setSavingNotificationSettings(true);
    try {
      const { error } = await supabase
        .from('vihem_organisation_notification_settings')
        .upsert({
          organisation_id: user.organisation_id,
          settings: notificationSettings,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organisation_id' });
      if (error) throw error;
    } catch (err: any) {
      alert(err.message || 'Kunde inte spara notisinställningarna');
    } finally {
      setSavingNotificationSettings(false);
    }
  }

  function updateNotificationSetting<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    setNotificationSettings((current) => ({ ...current, [key]: value }));
  }

  const fetchStaff = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vihem_profiles')
        .select('*')
        .in('role', ['staff', 'admin', 'superadmin', 'screen'])
        .order('name');
      if (error) throw error;
      if (data) setStaff(data);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setLoading(false);
    }
  },[]);
  useEffect(()=>{void fetchStaff();void fetchNotificationSettings();},[fetchStaff,fetchNotificationSettings]);

  const filteredStaff = staff.filter(
    (s) =>
      s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveStaff = async () => {
    if(saveLock.current||saving||openingStaff)return;
    if(!staffFormData.name.trim()){setSaveError('Ange medarbetarens namn.');setEditorStep('contact');return;}
    const rawPno = staffFormData.bankid_personal_number.trim();
    const normalizedPno = rawPno ? normalizePersonalNumber(rawPno) : null;
    if (rawPno && !normalizedPno) {
      setSaveError('Personnumret måste vara 10 eller 12 siffror, t.ex. 199001011234 eller 900101-1234.');
      return;
    }
    setSaveError('');
    saveLock.current=true;
    setSaving(true);
    try {
      if (editingStaff) {
        validateStaffSchedule();
        const payload={
          p_target:editingStaff.id,
          p_profile:{name:staffFormData.name,phone:staffFormData.phone,role:staffFormData.role,active:staffFormData.active,bankid_personal_number:normalizedPno,is_system_admin:canManageSystemAdminFlag?staffFormData.is_system_admin:editingStaff.is_system_admin===true},
          p_schedule:scheduleRows.map(row=>({...row,work_start:row.work_start||'08:00',work_end:row.work_end||'17:00',lunch_start:row.active&&row.lunch_start?row.lunch_start:null,lunch_minutes:row.active&&row.lunch_start&&row.lunch_minutes?Math.max(0,parseInt(row.lunch_minutes,10)||0):0})),
          p_grant:staffFormData.role==='staff'?[...moduleAccess].filter(key=>!initialModuleAccess.has(key)):[],
          p_revoke:staffFormData.role==='staff'?[...initialModuleAccess].filter(key=>!moduleAccess.has(key)):[],
        };
        const body=JSON.stringify(payload);
        if(saveOperation.current?.body!==body)saveOperation.current={body,id:crypto.randomUUID()};
        const {error}=await supabase.rpc('vihem_save_staff_editor',{...payload,p_operation:saveOperation.current.id});
        if(error)throw error;
        setShowStaffModal(false);
        setEditingStaff(null);
        resetForm();
        fetchStaff();
      } else {
        const result = await createUserAccount({
          name: staffFormData.name,
          email: staffFormData.email,
          phone: staffFormData.phone,
          role: staffFormData.role as Profile['role'],
          organisation_id: user?.organisation_id,
        });
        // Personnummer isn't part of vihem-create-user's own input --
        // written as a direct follow-up update instead, same as every
        // other admin-editable profile field this page manages post-creation.
        if (normalizedPno && result.user_id) {
          const { error: pnoError } = await supabase.from('vihem_profiles').update({ bankid_personal_number: normalizedPno }).eq('id', result.user_id);
          if (pnoError) throw pnoError;
        }
        setShowStaffModal(false);
        resetForm();
        fetchStaff();
        // Show the temporary password to the admin
        setCreatedCredentials({ email: staffFormData.email, tempPassword: result.temp_password });
      }
    } catch (err: any) {
      setSaveError(err.message || 'Ett fel inträffade');
    } finally {
      saveLock.current=false;
      setSaving(false);
    }
  };

  const resetForm = () => {
    saveOperation.current=null;setCopySource(null);setCopyTargets([]);
    setStaffFormData({ name: '', email: '', phone: '', role: 'staff', active: true, bankid_personal_number: '', is_system_admin: false });
    setScheduleRows(defaultScheduleRows());
    setModuleAccess(new Set());
    setInitialModuleAccess(new Set());
    setSaveError('');
  };

  function defaultScheduleRows(): ScheduleFormRow[] {
    return WEEKDAYS.map(({ weekday }) => ({
      weekday,
      active: weekday <= 5,
      work_start: '08:00',
      work_end: '17:00',
      lunch_start: weekday === 5 ? '' : '12:00',
      lunch_minutes: weekday === 5 ? '' : '45',
    }));
  }

  async function fetchStaffSchedule(staffId: string) {
    const { data, error } = await supabase
      .from('vihem_staff_work_schedules')
      .select('*')
      .eq('user_id', staffId)
      .order('weekday');
    if (error) {
      throw new Error('Arbetsschemat kunde inte hämtas. Försök igen innan du redigerar.');

    }
    const existing = (data || []) as StaffWorkSchedule[];
    const rows = defaultScheduleRows().map((row) => {
      const match = existing.find((schedule) => schedule.weekday === row.weekday);
      if (!match) return row;
      return {
        weekday: match.weekday,
        active: match.active,
        work_start: match.work_start?.slice(0, 5) || row.work_start,
        work_end: match.work_end?.slice(0, 5) || row.work_end,
        lunch_start: match.lunch_start?.slice(0, 5) || '',
        lunch_minutes: match.lunch_minutes ? String(match.lunch_minutes) : '',
      };
    });
    setScheduleRows(rows);
  }

  function validateStaffSchedule() {
    const scheduleError = scheduleRows.find((row) => {
      if (!row.active) return false;
      if (!row.work_start || !row.work_end) return true;
      return row.work_end <= row.work_start;
    });
    if (scheduleError) {
      throw new Error('Kontrollera arbetsschemat. Aktiva dagar behöver start och slut, och sluttiden måste vara efter starttiden.');
    }
  }

  function updateScheduleRow(weekday: number, patch: Partial<ScheduleFormRow>) {
    setScheduleRows((rows) => rows.map((row) => row.weekday === weekday ? { ...row, ...patch } : row));
  }

  const openEditStaffModal = async (staffMember: Profile) => {
    if(openingStaff)return;
    setOpeningStaff(true);setEditorLoadError('');
    const results=await Promise.allSettled([fetchStaffSchedule(staffMember.id),fetchModuleAccess(staffMember.id)]);
    setOpeningStaff(false);
    if(results.some(result=>result.status==='rejected')){setEditorLoadError('Schema och behörigheter kunde inte hämtas. Försök öppna medarbetaren igen.');return;}
    saveOperation.current=null;setCopySource(null);setCopyTargets([]);
    setEditorStep('contact');
    setStaffFormData({
      name: staffMember.name || '',
      email: staffMember.email || '',
      phone: staffMember.phone || '',
      role: staffMember.role || 'staff',
      active: staffMember.active !== false,
      bankid_personal_number: staffMember.bankid_personal_number || '',
      is_system_admin: staffMember.is_system_admin === true,
    });
    setEditingStaff(staffMember);
    setSaveError('');
    setShowStaffModal(true);
  };

  async function fetchModuleAccess(staffId: string) {
    const { data,error } = await supabase.from('vihem_permission_grants').select('permission_key').eq('user_id', staffId).like('permission_key', 'module.%');
    if(error)throw error;
    const granted = new Set((data || []).map((row) => row.permission_key.replace('module.', '') as ModuleKey));
    setModuleAccess(granted);
    setInitialModuleAccess(new Set(granted));
  }

  function toggleModuleAccess(key: ModuleKey) {
    setModuleAccess((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const handleResetPassword = async (staffMember: Profile) => {
    try {
      setResettingUserId(staffMember.id);
      const result = await sendUserPasswordResetEmail(staffMember.id);
      setResetCredentials({ email: result.email });
    } catch (err: any) {
      alert(err.message || 'Kunde inte återställa lösenordet');
    } finally {
      setResettingUserId('');
    }
  };

  // Generates a new temporary password directly, for sharing with the
  // staff member (e.g. verbally, SMS) instead of relying on them
  // receiving a reset email -- separate action from handleResetPassword
  // above, which just sends a link. They change it themselves after
  // logging in, same as the temp password shown right after creation.
  const handleGeneratePassword = async (staffMember: Profile) => {
    try {
      setResettingUserId(staffMember.id);
      const result = await resetUserPassword(staffMember.id);
      setGeneratedCredentials({ email: result.email, tempPassword: result.temp_password });
    } catch (err: any) {
      alert(err.message || 'Kunde inte generera nytt lösenord');
    } finally {
      setResettingUserId('');
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <div>
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Personal"
          subtitle="Hantera personal och administratörer"
          action={
            <Button
              onClick={() => {
                setEditingStaff(null);
                resetForm();setEditorStep('contact');
                setShowStaffModal(true);
              }}
              variant="primary"
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              Ny personal
            </Button>
          }
        />

        <div className="mb-6 min-w-0">
          <SearchInput
            placeholder="Sök personal..."
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </div>

        <details className="mb-6 rounded-xl border border-vihem-line bg-white">
          <summary className="vihem-touch-target cursor-pointer px-4 py-3 text-sm font-medium text-vihem-ink">Organisationens notisinställningar</summary>
          <div className="px-4 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="sr-only">Organisationens notisinställningar</h2>
              <p className="mt-1 text-sm text-vihem-muted">
                Styr vilka systemnotiser organisationen ska använda. Schemapåminnelser använder personalens arbetsschema och lunchinställningar.
              </p>
            </div>
            <Button variant="secondary" size="sm" loading={savingNotificationSettings} onClick={saveNotificationSettings}>
              Spara notiser
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {NOTIFICATION_SETTING_LABELS.map((setting) => (
              <label key={setting.key} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <input
                  type="checkbox"
                  checked={Boolean(notificationSettings[setting.key])}
                  onChange={(event) => updateNotificationSetting(setting.key, event.target.checked)}
                  className="mt-1 rounded border-slate-300 accent-blue-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{setting.label}</span>
                  <span className="block text-xs text-slate-500">{setting.description}</span>
                </span>
              </label>
            ))}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Input
                label="Standardpåminnelse efter lunch (minuter)"
                type="number"
                min={0}
                max={240}
                value={notificationSettings.default_lunch_return_minutes}
                onChange={(event) => updateNotificationSetting('default_lunch_return_minutes', Math.max(0, parseInt(event.target.value, 10) || 0))}
              />
            </div>
          </div>
        </div>
        </details>

        {editorLoadError&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{editorLoadError}</p>}
        {openingStaff&&<p role="status" className="mb-4 text-sm text-vihem-muted">Hämtar schema och behörigheter…</p>}
        {filteredStaff.length === 0 ? (
          <EmptyState
            icon={<Users className="w-12 h-12" />}
            title="Ingen personal"
            description="Börja med att skapa din första personalmedlem"
          />
        ) : (
          <Card>
            <div className="md:hidden divide-y divide-slate-100">
              {filteredStaff.map((staffMember) => (
                <div key={staffMember.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3"><Avatar name={staffMember.name} userId={staffMember.id} src={staffMember.avatar_url}/><p className="font-semibold text-slate-900 break-words">{staffMember.name}</p></div>
                      <p className="mt-1 text-sm text-slate-600 break-all">{staffMember.email}</p>
                      {staffMember.phone && <p className="mt-0.5 text-sm text-slate-500">{staffMember.phone}</p>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleResetPassword(staffMember)}
                        title="Skicka lösenordsåterställning"
                        disabled={resettingUserId === staffMember.id}
                        className="vihem-icon-button disabled:opacity-50"
                      >
                        <KeyRound className="w-4 h-4 text-slate-500" />
                      </button>
                      <button
                        onClick={() => handleGeneratePassword(staffMember)}
                        title="Generera nytt lösenord"
                        disabled={resettingUserId === staffMember.id}
                        className="vihem-icon-button disabled:opacity-50"
                      >
                        <RefreshCw className="w-4 h-4 text-slate-500" />
                      </button>
                      <button
                        type="button"
                        disabled={openingStaff} aria-label={`Redigera ${staffMember.name}`}
                        onClick={() => openEditStaffModal(staffMember)}
                        className="vihem-icon-button"
                      >
                        <Edit2 className="w-4 h-4 text-slate-600" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className={ROLE_COLORS[staffMember.role] || 'text-slate-600 bg-slate-100'}>
                      {ROLE_LABELS[staffMember.role] || staffMember.role}
                    </Badge>
                    <Badge className={staffMember.active ? 'text-green-700 bg-green-100' : 'text-slate-600 bg-slate-100'}>
                      {staffMember.active ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                    {staffMember.auth_method === 'bankid' && (
                      <Badge className="text-teal-700 bg-teal-100 gap-1 flex items-center">
                        <ShieldCheck className="w-3 h-3" /> BankID
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Namn</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">E-post</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Telefon</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Roll</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStaff.map((staffMember) => (
                    <tr key={staffMember.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900"><div className="flex items-center gap-3"><Avatar name={staffMember.name} userId={staffMember.id} src={staffMember.avatar_url} size="sm"/>{staffMember.name}</div></td>
                      <td className="py-3 px-4 text-sm text-slate-600">{staffMember.email}</td>
                      <td className="py-3 px-4 text-sm text-slate-600">{staffMember.phone}</td>
                      <td className="py-3 px-4">
                        <Badge className={ROLE_COLORS[staffMember.role] || 'text-slate-600 bg-slate-100'}>
                          {ROLE_LABELS[staffMember.role] || staffMember.role}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Badge className={staffMember.active ? 'text-green-700 bg-green-100' : 'text-slate-600 bg-slate-100'}>
                            {staffMember.active ? 'Aktiv' : 'Inaktiv'}
                          </Badge>
                          {staffMember.auth_method === 'bankid' && (
                            <Badge className="text-teal-700 bg-teal-100 gap-1 flex items-center">
                              <ShieldCheck className="w-3 h-3" /> BankID
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleResetPassword(staffMember)}
                            title="Skicka lösenordsåterställning"
                            disabled={resettingUserId === staffMember.id}
                            className="vihem-icon-button disabled:opacity-50"
                          >
                            <KeyRound className="w-4 h-4 text-slate-500" />
                          </button>
                          <button
                            onClick={() => handleGeneratePassword(staffMember)}
                            title="Generera nytt lösenord"
                            disabled={resettingUserId === staffMember.id}
                            className="vihem-icon-button disabled:opacity-50"
                          >
                            <RefreshCw className="w-4 h-4 text-slate-500" />
                          </button>
                          <button
                            type="button"
                        disabled={openingStaff} aria-label={`Redigera ${staffMember.name}`}
                        onClick={() => openEditStaffModal(staffMember)}
                            className="vihem-icon-button"
                          >
                            <Edit2 className="w-4 h-4 text-slate-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal mobileFullscreen
        open={showStaffModal}
        onClose={closeEditor}
        title={editingStaff ? editingStaff.name : 'Ny personal'} size="lg"
        toolbar={saveError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
        footer={<><Button variant="secondary" disabled={saving} onClick={closeEditor}>Avbryt</Button><Button loading={saving} onClick={handleSaveStaff}>{editingStaff?'Spara ändringar':'Skapa konto'}</Button></>}
      >
        <fieldset disabled={saving} className="space-y-5">
          {editingStaff&&<Tabs tabs={[{key:'contact',label:'Kontakt'},{key:'access',label:'Behörighet'},{key:'schedule',label:'Schema'}]} active={editorStep} onChange={setEditorStep}/>}
          <div hidden={editingStaff!==null&&editorStep!=='contact'} className="space-y-4">
          <Input
            label="Namn"
            value={staffFormData.name}
            onChange={(e) => setStaffFormData({ ...staffFormData, name: e.target.value })}
            placeholder="T.ex. Anna Svensson"
          />
          {!editingStaff && (
            <Input
              label="E-post"
              type="email"
              value={staffFormData.email}
              onChange={(e) => setStaffFormData({ ...staffFormData, email: e.target.value })}
              placeholder="T.ex. anna@exempel.se"
            />
          )}
          <Input
            label="Telefon" type="tel" autoComplete="tel"
            value={staffFormData.phone}
            onChange={(e) => setStaffFormData({ ...staffFormData, phone: e.target.value })}
            placeholder="T.ex. 070-123 45 67"
          />
          <Input
            label="Personnummer (för BankID-inloggning)" inputMode="numeric"
            value={staffFormData.bankid_personal_number}
            onChange={(e) => setStaffFormData({ ...staffFormData, bankid_personal_number: e.target.value })}
            placeholder="T.ex. 199001011234 eller 900101-1234"
          />
          </div><div hidden={editingStaff!==null&&editorStep!=='access'} className="space-y-4">
          <Select label="Roll" value={staffFormData.role} onChange={e=>setStaffFormData({...staffFormData,role:e.target.value})} options={[{value:'staff',label:'Personal'},{value:'admin',label:'Admin'},{value:'screen',label:'TV-skärm'},...(user?.role==='superadmin'?[{value:'superadmin',label:'Superadmin'}]:[])]}/>
          {editingStaff && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={staffFormData.active}
                onChange={(e) => setStaffFormData({ ...staffFormData, active: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Aktiv</span>
            </label>
          )}
          {editingStaff && staffFormData.role === 'admin' && canManageSystemAdminFlag && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={staffFormData.is_system_admin}
                onChange={(e) => setStaffFormData({ ...staffFormData, is_system_admin: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-slate-300"
              />
              <span>
                <span className="block text-sm text-slate-700">Systemadmin (API-åtkomst)</span>
                <span className="block text-xs text-slate-500">Ger tillgång till Inställningar, Google Workspace och Cellsynt SMS -- annars kan admin inte nå dessa.</span>
              </span>
            </label>
          )}
          {editingStaff && staffFormData.role === 'staff' && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-800">Modulåtkomst</p>
              <p className="text-xs text-slate-500">
                Personal har som standard inte tillgång till dessa moduler även om organisationen har aktiverat dem -- kryssa i det som gäller för {staffFormData.name || 'den här personen'}.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {GRANTABLE_MODULES.map((module) => (
                  <label key={module.key} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={moduleAccess.has(module.key)}
                      onChange={() => toggleModuleAccess(module.key)}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                    {module.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          </div>
          {editingStaff && (
            <div hidden={editorStep!=='schedule'} className="space-y-4">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-slate-500" />
                <div><p className="text-sm font-semibold text-slate-800">Veckoschema</p><p className="text-sm text-vihem-muted">{formatScheduleMinutes(scheduleRows.reduce((sum,row)=>sum+scheduleMinutes(row),0))} arbete / vecka · lunch avdragen</p></div>
              </div>
              <div className="divide-y divide-vihem-line">
                {scheduleRows.map((row) => (
                  <details key={row.weekday} open={activeScheduleDay===row.weekday} className="bg-white"><summary onClick={e=>{e.preventDefault();setActiveScheduleDay(current=>current===row.weekday?null:row.weekday);}} className="vihem-touch-target vihem-focus cursor-pointer px-4 py-3 text-sm font-medium"><span>{WEEKDAYS.find(day=>day.weekday===row.weekday)?.label}</span><span className="ml-3 font-normal text-vihem-muted">{row.active?`${row.work_start}–${row.work_end} · ${formatScheduleMinutes(scheduleMinutes(row))}`:'Ledig'}</span></summary><div className="grid grid-cols-2 gap-3 border-t border-vihem-line p-4">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(event) => updateScheduleRow(row.weekday, { active: event.target.checked })}
                        className="rounded border-slate-300 accent-blue-600"
                      />
                      {WEEKDAYS.find((day) => day.weekday === row.weekday)?.label}
                    </label>
                    <span className={`text-xs font-medium ${row.active ? 'text-green-700' : 'text-slate-400'}`}>
                      {row.active ? 'Arbetsdag' : 'Ledig'}
                    </span>
                    <Input label="Start" type="time" value={row.work_start} onChange={(event) => updateScheduleRow(row.weekday, { work_start: event.target.value })} disabled={!row.active} />
                    <Input label="Slut" type="time" value={row.work_end} onChange={(event) => updateScheduleRow(row.weekday, { work_end: event.target.value })} disabled={!row.active} />
                    <Input label="Lunchstart" type="time" value={row.lunch_start} onChange={(event) => updateScheduleRow(row.weekday, { lunch_start: event.target.value })} disabled={!row.active} />
                    <Input label="Lunch (minuter)"
                      type="number"
                      min={0}
                      max={240}
                      value={row.lunch_minutes}
                      placeholder="Ingen"
                      onChange={(event) => updateScheduleRow(row.weekday, { lunch_minutes: event.target.value })}
                      disabled={!row.active || !row.lunch_start}
                    />
                    <div className="col-span-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm text-vihem-muted">Tider och lunch kopieras tillsammans.</span><Button variant="secondary" className="whitespace-nowrap" onClick={()=>{setCopySource(row.weekday);setCopyTargets(scheduleRows.filter(day=>day.weekday!==row.weekday&&day.active).map(day=>day.weekday));}}>Kopiera dagen</Button></div>
                  </div></details>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Lämna lunchstart och längd tomma för dagar utan lunch. Lediga dagar sparas enligt befintliga schemaregler.
              </p>
            </div>
          )}
          {!editingStaff && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              Ett konto skapas med ett tillfälligt lösenord. Dela lösenordet säkert
              och be användaren byta det efter inloggning.
            </div>
          )}
        </fieldset>
      </Modal>

      <Modal open={copySource!==null} onClose={()=>setCopySource(null)} title={`Kopiera ${WEEKDAYS.find(day=>day.weekday===copySource)?.label.toLowerCase()||'dag'}`} footer={<><Button variant="secondary" onClick={()=>setCopySource(null)}>Avbryt</Button><Button disabled={!copyTargets.length} onClick={()=>{const source=scheduleRows.find(row=>row.weekday===copySource);if(source)setScheduleRows(rows=>rows.map(row=>copyTargets.includes(row.weekday)?{...source,weekday:row.weekday}:row));setCopySource(null);}}>Kopiera till {copyTargets.length} dagar</Button></>}>
        <p className="mb-3 text-sm text-vihem-muted">Välj dagar som ska få samma arbetstid, lunch och aktiv status. Ändringen sparas först med personalprofilen.</p>
        <div className="divide-y divide-vihem-line">{WEEKDAYS.filter(day=>day.weekday!==copySource).map(day=><label key={day.weekday} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={copyTargets.includes(day.weekday)} onChange={e=>setCopyTargets(days=>e.target.checked?[...days,day.weekday]:days.filter(value=>value!==day.weekday))}/>{day.label}</label>)}</div>
      </Modal>
      <Modal open={discard} onClose={()=>setDiscard(false)} title="Lämna osparade ändringar?" footer={<><Button variant="secondary" onClick={()=>setDiscard(false)}>Fortsätt redigera</Button><Button variant="danger" onClick={()=>{setDiscard(false);setShowStaffModal(false);setEditingStaff(null);resetForm();}}>Lämna utan att spara</Button></>}><p>Kontaktuppgifter, schema och behörigheter har inte sparats.</p></Modal>
      {/* Show temporary credentials after creation */}
      <Modal
        open={!!createdCredentials}
        onClose={() => setCreatedCredentials(null)}
        title="Konto skapat"
      >
        {createdCredentials && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900 mb-1">Kontot har skapats!</p>
              <p className="text-sm text-green-800">
                Användaren kan logga in med <strong>{createdCredentials.email}</strong> och lösenordet nedan.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-amber-900 uppercase mb-2">
                Tillfälligt lösenord (vid behov)
              </p>
              <p className="text-xs text-amber-700 mb-2">
                Om e-postmeddelandet inte levereras kan du dela detta lösenord på ett säkert sätt.
                Uppmana användaren att byta lösenord direkt.
              </p>
              <code className="block bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono text-amber-900 select-all">
                {createdCredentials.tempPassword}
              </code>
            </div>
            <Button variant="primary" className="w-full" onClick={() => setCreatedCredentials(null)}>
              Stäng
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        open={!!resetCredentials}
        onClose={() => setResetCredentials(null)}
        title="Återställningsmejl skickat"
      >
        {resetCredentials && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900 mb-1">Mejl skickat</p>
              <p className="text-sm text-green-800">
                Ett mejl med länk för att välja nytt lösenord har skickats till <strong>{resetCredentials.email}</strong>.
              </p>
            </div>
            <Button variant="primary" className="w-full" onClick={() => setResetCredentials(null)}>
              Stäng
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        open={!!generatedCredentials}
        onClose={() => setGeneratedCredentials(null)}
        title="Nytt lösenord genererat"
      >
        {generatedCredentials && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900 mb-1">Lösenordet är uppdaterat</p>
              <p className="text-sm text-green-800">
                Användaren kan logga in med <strong>{generatedCredentials.email}</strong> och lösenordet nedan.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-amber-900 uppercase mb-2">Tillfälligt lösenord</p>
              <p className="text-xs text-amber-700 mb-2">Dela lösenordet säkert och be användaren byta det efter inloggning.</p>
              <code className="block bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono text-amber-900 select-all">
                {generatedCredentials.tempPassword}
              </code>
            </div>
            <Button variant="primary" className="w-full" onClick={() => setGeneratedCredentials(null)}>
              Stäng
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
