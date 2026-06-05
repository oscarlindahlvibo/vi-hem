import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, ShieldCheck, KeyRound, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createUserAccount, sendUserPasswordResetEmail } from '../lib/userAdmin';
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  PageHeader,
  EmptyState,
  LoadingPage,
  SearchInput,
} from '../components/ui';
import type { Profile, StaffWorkSchedule } from '../types';

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

type NotificationSettings = {
  work_order_assigned: boolean;
  work_order_unassigned: boolean;
  maintenance_created_staff: boolean;
  staff_absence_submitted: boolean;
  chat_message: boolean;
  shift_start_reminder: boolean;
  lunch_start_reminder: boolean;
  lunch_return_reminder: boolean;
  shift_end_reminder: boolean;
  default_lunch_return_minutes: number;
};

const defaultNotificationSettings: NotificationSettings = {
  work_order_assigned: true,
  work_order_unassigned: true,
  maintenance_created_staff: true,
  staff_absence_submitted: true,
  chat_message: true,
  shift_start_reminder: true,
  lunch_start_reminder: true,
  lunch_return_reminder: true,
  shift_end_reminder: true,
  default_lunch_return_minutes: 45,
};

type BooleanNotificationSettingKey = Exclude<keyof NotificationSettings, 'default_lunch_return_minutes'>;

const NOTIFICATION_SETTING_LABELS: { key: BooleanNotificationSettingKey; label: string; description: string }[] = [
  { key: 'work_order_assigned', label: 'Arbetsorder tilldelad', description: 'Notifiera när en arbetsorder tilldelas användaren.' },
  { key: 'work_order_unassigned', label: 'Otilldelad arbetsorder', description: 'Notifiera personal när en arbetsorder läggs upp utan ansvarig.' },
  { key: 'maintenance_created_staff', label: 'Ny felanmälan', description: 'Notifiera all personal när en felanmälan kommer in.' },
  { key: 'staff_absence_submitted', label: 'Frånvaro från personal', description: 'Notifiera admin när personal sjukanmäler sig eller ansöker om ledighet.' },
  { key: 'chat_message', label: 'Chattmeddelanden', description: 'Notifiera deltagare när nya chattmeddelanden skickas.' },
  { key: 'shift_start_reminder', label: 'Pass börjar', description: 'Påminn vid schemalagd starttid.' },
  { key: 'lunch_start_reminder', label: 'Lunch börjar', description: 'Påminn vid schemalagd lunchstart.' },
  { key: 'lunch_return_reminder', label: 'Lunch slutar', description: 'Påminn efter organisationens eller personalens lunchlängd.' },
  { key: 'shift_end_reminder', label: 'Pass slutar', description: 'Påminn om att stämpla ut vid schemalagt slut.' },
];

function isMissingSchemaError(error: any) {
  return error?.code === 'PGRST205' || String(error?.message || '').includes('schema cache');
}

const ROLE_LABELS: Record<string, string> = {
  staff: 'Personal',
  admin: 'Admin',
  superadmin: 'Superadmin',
};

const ROLE_COLORS: Record<string, string> = {
  staff: 'text-blue-700 bg-blue-100',
  admin: 'text-teal-700 bg-teal-100',
  superadmin: 'text-red-700 bg-red-100',
};

interface AdminStaffPageProps { onNavigate: (page: string) => void; }
export function AdminStaffPage({ onNavigate: _onNavigate }: AdminStaffPageProps) {
  const { user } = useAuth();
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingStaff, setEditingStaff] = useState<Profile | null>(null);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [resetCredentials, setResetCredentials] = useState<{ email: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState('');
  const [scheduleRows, setScheduleRows] = useState<ScheduleFormRow[]>([]);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [savingNotificationSettings, setSavingNotificationSettings] = useState(false);
  const [staffFormData, setStaffFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'staff',
    active: true,
  });

  useEffect(() => {
    fetchStaff();
    fetchNotificationSettings();
  }, []);

  async function fetchNotificationSettings() {
    if (!user?.organisation_id) return;
    const { data, error } = await supabase
      .from('organisation_notification_settings')
      .select('settings')
      .eq('organisation_id', user.organisation_id)
      .maybeSingle();
    if (error) {
      if (!isMissingSchemaError(error)) console.error('Error fetching notification settings:', error);
      return;
    }
    setNotificationSettings({ ...defaultNotificationSettings, ...(data?.settings || {}) });
  }

  async function saveNotificationSettings() {
    if (!user?.organisation_id) return;
    setSavingNotificationSettings(true);
    try {
      const { error } = await supabase
        .from('organisation_notification_settings')
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

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['staff', 'admin', 'superadmin'])
        .order('name');
      if (error) throw error;
      if (data) setStaff(data);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredStaff = staff.filter(
    (s) =>
      s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveStaff = async () => {
    setSaveError('');
    setSaving(true);
    try {
      if (editingStaff) {
        // Update existing profile — no auth changes needed
        const { error } = await supabase
          .from('profiles')
          .update({
            name: staffFormData.name,
            phone: staffFormData.phone,
            role: staffFormData.role,
            active: staffFormData.active,
          })
          .eq('id', editingStaff.id);
        if (error) throw error;
        await saveStaffSchedule(editingStaff.id);
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
        setShowStaffModal(false);
        resetForm();
        fetchStaff();
        // Show the temporary password to the admin
        setCreatedCredentials({ email: staffFormData.email, tempPassword: result.temp_password });
      }
    } catch (err: any) {
      setSaveError(err.message || 'Ett fel inträffade');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setStaffFormData({ name: '', email: '', phone: '', role: 'staff', active: true });
    setScheduleRows(defaultScheduleRows());
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
      .from('staff_work_schedules')
      .select('*')
      .eq('user_id', staffId)
      .order('weekday');
    if (error) {
      setScheduleRows(defaultScheduleRows());
      if (isMissingSchemaError(error)) {
        setSaveError('Arbetsschema-tabellen saknas i databasen. Kör senaste Supabase-migrationerna på miljön först.');
        return;
      }
      console.error('Error fetching staff schedule:', error);
      return;
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

  async function saveStaffSchedule(staffId: string) {
    if (!user?.organisation_id) return;
    const scheduleError = scheduleRows.find((row) => {
      if (!row.active) return false;
      if (!row.work_start || !row.work_end) return true;
      return row.work_end <= row.work_start;
    });
    if (scheduleError) {
      throw new Error('Kontrollera arbetsschemat. Aktiva dagar behöver start och slut, och sluttiden måste vara efter starttiden.');
    }
    const rows = scheduleRows.map((row) => ({
      organisation_id: user.organisation_id,
      user_id: staffId,
      weekday: row.weekday,
      active: row.active,
      work_start: row.work_start || '08:00',
      work_end: row.work_end || '17:00',
      lunch_start: row.active && row.lunch_start ? row.lunch_start : null,
      lunch_minutes: row.active && row.lunch_start && row.lunch_minutes ? Math.max(0, parseInt(row.lunch_minutes, 10) || 0) : 0,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('staff_work_schedules')
      .upsert(rows, { onConflict: 'user_id,weekday' });
    if (error) {
      if (isMissingSchemaError(error)) {
        throw new Error('Arbetsschema-tabellen saknas i databasen. Kör senaste Supabase-migrationerna på miljön först.');
      }
      throw error;
    }
  }

  function updateScheduleRow(weekday: number, patch: Partial<ScheduleFormRow>) {
    setScheduleRows((rows) => rows.map((row) => row.weekday === weekday ? { ...row, ...patch } : row));
  }

  const openEditStaffModal = (staffMember: Profile) => {
    setStaffFormData({
      name: staffMember.name || '',
      email: staffMember.email || '',
      phone: staffMember.phone || '',
      role: staffMember.role || 'staff',
      active: staffMember.active !== false,
    });
    setEditingStaff(staffMember);
    fetchStaffSchedule(staffMember.id);
    setSaveError('');
    setShowStaffModal(true);
  };

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

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title="Personal"
          subtitle="Hantera personal och administratörer"
          action={
            <Button
              onClick={() => {
                setEditingStaff(null);
                resetForm();
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

        <Card className="mb-6 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Notisinställningar</h2>
              <p className="mt-1 text-xs text-slate-500">
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
        </Card>

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
                      <p className="font-semibold text-slate-900 break-words">{staffMember.name}</p>
                      <p className="mt-1 text-sm text-slate-600 break-all">{staffMember.email}</p>
                      {staffMember.phone && <p className="mt-0.5 text-sm text-slate-500">{staffMember.phone}</p>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleResetPassword(staffMember)}
                        title="Skicka lösenordsåterställning"
                        disabled={resettingUserId === staffMember.id}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <KeyRound className="w-4 h-4 text-slate-500" />
                      </button>
                      <button
                        onClick={() => openEditStaffModal(staffMember)}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
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
                      <td className="py-3 px-4 font-medium text-slate-900">{staffMember.name}</td>
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
                            className="p-2 hover:bg-slate-100 rounded-lg inline-block transition-colors disabled:opacity-50"
                          >
                            <KeyRound className="w-4 h-4 text-slate-500" />
                          </button>
                          <button
                            onClick={() => openEditStaffModal(staffMember)}
                            className="p-2 hover:bg-slate-100 rounded-lg inline-block transition-colors"
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
      <Modal
        open={showStaffModal}
        onClose={() => { setShowStaffModal(false); setEditingStaff(null); resetForm(); }}
        title={editingStaff ? 'Redigera personal' : 'Ny personal'}
      >
        <div className="space-y-4">
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
            label="Telefon"
            value={staffFormData.phone}
            onChange={(e) => setStaffFormData({ ...staffFormData, phone: e.target.value })}
            placeholder="T.ex. 070-123 45 67"
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Roll</label>
            <select
              value={staffFormData.role}
              onChange={(e) => setStaffFormData({ ...staffFormData, role: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="staff">Personal</option>
              <option value="admin">Admin</option>
              {user?.role === 'superadmin' && <option value="superadmin">Superadmin</option>}
            </select>
          </div>
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
          {editingStaff && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-800">Arbetsschema och lunch</p>
              </div>
              <div className="space-y-2">
                {scheduleRows.map((row) => (
                  <div key={row.weekday} className="grid grid-cols-1 gap-2 rounded-lg bg-white p-2 sm:grid-cols-[110px_80px_1fr_1fr_1fr_90px] sm:items-center">
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
                    <Input type="time" value={row.work_start} onChange={(event) => updateScheduleRow(row.weekday, { work_start: event.target.value })} disabled={!row.active} />
                    <Input type="time" value={row.work_end} onChange={(event) => updateScheduleRow(row.weekday, { work_end: event.target.value })} disabled={!row.active} />
                    <Input type="time" value={row.lunch_start} onChange={(event) => updateScheduleRow(row.weekday, { lunch_start: event.target.value })} disabled={!row.active} />
                    <Input
                      type="number"
                      min={0}
                      max={240}
                      value={row.lunch_minutes}
                      placeholder="Ingen"
                      onChange={(event) => updateScheduleRow(row.weekday, { lunch_minutes: event.target.value })}
                      disabled={!row.active || !row.lunch_start}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Kolumnerna är: dag, status, start, slut, lunchstart och lunchlängd i minuter. Lämna lunchstart och längd tomma för dagar utan rast, till exempel kortare fredagar.
              </p>
            </div>
          )}
          {!editingStaff && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              Ett konto skapas med ett tillfälligt lösenord. Dela lösenordet säkert
              och be användaren byta det efter inloggning.
            </div>
          )}
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {saveError}
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => { setShowStaffModal(false); setEditingStaff(null); resetForm(); }}>
              Avbryt
            </Button>
            <Button variant="primary" onClick={handleSaveStaff} loading={saving}>
              {editingStaff ? 'Spara' : 'Skapa konto'}
            </Button>
          </div>
        </div>
      </Modal>

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
    </div>
  );
}
