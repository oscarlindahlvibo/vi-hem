import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, ShieldCheck, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createUserAccount, resetUserPassword } from '../lib/userAdmin';
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
import { Profile } from '../types';

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
  const [resetCredentials, setResetCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState('');
  const [staffFormData, setStaffFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'staff',
    active: true,
  });

  useEffect(() => {
    fetchStaff();
  }, []);

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
    setSaveError('');
  };

  const openEditStaffModal = (staffMember: Profile) => {
    setStaffFormData({
      name: staffMember.name || '',
      email: staffMember.email || '',
      phone: staffMember.phone || '',
      role: staffMember.role || 'staff',
      active: staffMember.active !== false,
    });
    setEditingStaff(staffMember);
    setSaveError('');
    setShowStaffModal(true);
  };

  const handleResetPassword = async (staffMember: Profile) => {
    try {
      setResettingUserId(staffMember.id);
      const result = await resetUserPassword(staffMember.id);
      setResetCredentials({ email: result.email, tempPassword: result.temp_password });
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

        <div className="mb-6">
          <SearchInput
            placeholder="Sök personal..."
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </div>

        {filteredStaff.length === 0 ? (
          <EmptyState
            icon={<Users className="w-12 h-12" />}
            title="Ingen personal"
            description="Börja med att skapa din första personalmedlem"
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
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
        title="Lösenord återställt"
      >
        {resetCredentials && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900 mb-1">Nytt tillfälligt lösenord skapat</p>
              <p className="text-sm text-green-800">
                Dela lösenordet säkert med <strong>{resetCredentials.email}</strong> och be användaren byta det efter inloggning.
              </p>
            </div>
            <code className="block bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono text-slate-900 select-all">
              {resetCredentials.tempPassword}
            </code>
            <Button variant="primary" className="w-full" onClick={() => setResetCredentials(null)}>
              Stäng
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
