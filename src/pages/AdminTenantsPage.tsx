import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, Home, Mail, Phone, KeyRound } from 'lucide-react';
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
import { formatDate, formatCurrency } from '../lib/utils';
import { Profile, Tenancy, Apartment, Property } from '../types';

interface AdminTenantsPageProps { onNavigate: (page: string) => void; }
export function AdminTenantsPage({ onNavigate: _onNavigate }: AdminTenantsPageProps) {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<Profile[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<Profile | null>(null);
  const [editingTenant, setEditingTenant] = useState<Profile | null>(null);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showLinkTenancyModal, setShowLinkTenancyModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [resetCredentials, setResetCredentials] = useState<{ email: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState('');
  const [tenantFormData, setTenantFormData] = useState({
    name: '',
    email: '',
    phone: '',
    active: true,
    // Tenancy fields (for new tenant)
    property_id: '',
    apartment_id: '',
    start_date: '',
    monthly_rent: '',
  });
  const [linkTenancyFormData, setLinkTenancyFormData] = useState({
    apartment_id: '',
    start_date: '',
    monthly_rent: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [tenantsRes, tenanciesRes, aptsRes, propsRes] = await Promise.all([
        supabase.from('vihem_profiles').select('*').eq('role', 'tenant').order('name'),
        supabase.from('vihem_tenancies').select('*'),
        supabase.from('vihem_apartments').select('*'),
        supabase.from('vihem_properties').select('*'),
      ]);
      if (tenantsRes.data) setTenants(tenantsRes.data);
      if (tenanciesRes.data) setTenancies(tenanciesRes.data);
      if (aptsRes.data) setApartments(aptsRes.data);
      if (propsRes.data) setProperties(propsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTenants = tenants.filter(
    (t) =>
      t.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getTenantTenancies = (tenantId: string) =>
    tenancies
      .filter((t) => t.tenant_id === tenantId)
      .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

  const getApartmentInfo = (apartmentId: string) =>
    apartments.find((a) => a.id === apartmentId);

  const getPropertyInfo = (propertyId: string) =>
    properties.find((p) => p.id === propertyId);

  const countActiveTenancies = (tenantId: string) =>
    tenancies.filter(
      (t) =>
        t.tenant_id === tenantId &&
        t.status === 'active' &&
        new Date(t.start_date) <= new Date() &&
        (!t.end_date || new Date(t.end_date) > new Date())
    ).length;

  const getAvailableApartments = () => {
    const rentedApartmentIds = tenancies.filter((t) => t.status === 'active').map((t) => t.apartment_id);
    return apartments.filter((a) => !rentedApartmentIds.includes(a.id) && a.status !== 'rented');
  };

  const handleSaveTenant = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (editingTenant) {
        const { error } = await supabase
          .from('vihem_profiles')
          .update({ name: tenantFormData.name, phone: tenantFormData.phone, active: tenantFormData.active })
          .eq('id', editingTenant.id);
        if (error) throw error;
      } else {
        const newAccount = await createUserAccount({
          name: tenantFormData.name,
          email: tenantFormData.email,
          phone: tenantFormData.phone,
          role: 'tenant',
          organisation_id: user?.organisation_id,
        });

        // Create tenancy if apartment selected
        if (newAccount.user_id && tenantFormData.apartment_id && tenantFormData.start_date) {
          const { error: tenancyError } = await supabase.from('vihem_tenancies').insert({
            tenant_id: newAccount.user_id,
            apartment_id: tenantFormData.apartment_id,
            property_id: tenantFormData.property_id || null,
            organisation_id: user?.organisation_id,
            start_date: tenantFormData.start_date,
            monthly_rent: parseFloat(tenantFormData.monthly_rent) || 0,
            status: 'active',
          });
          if (tenancyError) throw tenancyError;

          // Mark apartment as rented
          const { error: apartmentError } = await supabase
            .from('vihem_apartments')
            .update({ status: 'rented' })
            .eq('id', tenantFormData.apartment_id);
          if (apartmentError) throw apartmentError;
        }

        setCreatedCredentials({ email: tenantFormData.email, tempPassword: newAccount.temp_password });
      }
      setShowTenantModal(false);
      setEditingTenant(null);
      setTenantFormData({ name: '', email: '', phone: '', active: true, property_id: '', apartment_id: '', start_date: '', monthly_rent: '' });
      fetchData();
    } catch (error: any) {
      console.error('Error saving tenant:', error);
      setSaveError(error.message || 'Kunde inte spara hyresgästen');
    } finally {
      setSaving(false);
    }
  };

  const handleLinkTenancy = async () => {
    try {
      if (!selectedTenant) return;
      const apt = getApartmentInfo(linkTenancyFormData.apartment_id);
      await supabase.from('vihem_tenancies').insert({
        tenant_id: selectedTenant.id,
        apartment_id: linkTenancyFormData.apartment_id,
        property_id: apt?.property_id || null,
        organisation_id: user?.organisation_id,
        start_date: linkTenancyFormData.start_date,
        monthly_rent: parseFloat(linkTenancyFormData.monthly_rent),
        status: 'active',
      });
      setShowLinkTenancyModal(false);
      setLinkTenancyFormData({ apartment_id: '', start_date: '', monthly_rent: '' });
      fetchData();
    } catch (error) {
      console.error('Error linking tenancy:', error);
    }
  };

  const openEditTenantModal = (tenant: Profile) => {
    setTenantFormData({
      name: tenant.name || '',
      email: tenant.email || '',
      phone: tenant.phone || '',
      active: tenant.active !== false,
      property_id: '',
      apartment_id: '',
      start_date: '',
      monthly_rent: '',
    });
    setEditingTenant(tenant);
    setShowTenantModal(true);
  };

  const handleResetPassword = async (tenant: Profile) => {
    try {
      setResettingUserId(tenant.id);
      const result = await sendUserPasswordResetEmail(tenant.id);
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
          title="Hyresgäster"
          subtitle="Hantera hyresgäster och deras hyresförhållanden"
          action={
            <Button
              onClick={() => {
                setEditingTenant(null);
                setTenantFormData({ name: '', email: '', phone: '', active: true, property_id: '', apartment_id: '', start_date: '', monthly_rent: '' });
                setShowTenantModal(true);
              }}
              variant="primary"
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              Ny hyresgäst
            </Button>
          }
        />

        {!selectedTenant ? (
          <>
            <div className="mb-6">
              <SearchInput
                placeholder="Sök hyresgäster..."
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </div>

            {filteredTenants.length === 0 ? (
              <EmptyState
                icon={<Users className="w-12 h-12" />}
                title="Inga hyresgäster"
                description="Börja med att skapa din första hyresgäst"
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
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Aktiva avtal</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Åtgärd</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTenants.map((tenant) => (
                        <tr
                          key={tenant.id}
                          onClick={() => setSelectedTenant(tenant)}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-4 font-medium text-slate-900">{tenant.name}</td>
                          <td className="py-3 px-4 text-sm text-slate-600">{tenant.email}</td>
                          <td className="py-3 px-4 text-sm text-slate-600">{tenant.phone}</td>
                          <td className="py-3 px-4">
                            <Badge className={tenant.active ? 'text-green-700 bg-green-100' : 'text-slate-600 bg-slate-100'}>
                              {tenant.active ? 'Aktiv' : 'Inaktiv'}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-sm font-medium text-slate-700">
                            {countActiveTenancies(tenant.id)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleResetPassword(tenant);
                              }}
                              disabled={resettingUserId === tenant.id}
                              title="Återställ lösenord"
                              className="p-2 hover:bg-slate-100 rounded-lg inline-block transition-colors disabled:opacity-50"
                            >
                              <KeyRound className="w-4 h-4 text-slate-500" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => setSelectedTenant(null)}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 text-sm font-medium"
            >
              ← Tillbaka
            </button>

            <Card className="mb-6 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 mb-3">{selectedTenant.name}</h2>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Mail className="w-4 h-4" />
                      <span>{selectedTenant.email}</span>
                    </div>
                    {selectedTenant.phone && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Phone className="w-4 h-4" />
                        <span>{selectedTenant.phone}</span>
                      </div>
                    )}
                    <div className="pt-2">
                      <Badge className={selectedTenant.active ? 'text-green-700 bg-green-100' : 'text-slate-600 bg-slate-100'}>
                        {selectedTenant.active ? 'Aktiv' : 'Inaktiv'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleResetPassword(selectedTenant)}
                    disabled={resettingUserId === selectedTenant.id}
                    title="Återställ lösenord"
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <KeyRound className="w-4 h-4 text-slate-600" />
                  </button>
                  <button
                    onClick={() => openEditTenantModal(selectedTenant)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
              </div>

              <Button
                onClick={() => setShowLinkTenancyModal(true)}
                variant="secondary"
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Länka hyresförhållande
              </Button>
            </Card>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-800">Hyresförhållanden</h3>
              {getTenantTenancies(selectedTenant.id).length === 0 ? (
                <EmptyState
                  icon={<Home className="w-12 h-12" />}
                  title="Inga hyresförhållanden"
                  description="Länka denna hyresgäst till en lägenhet"
                />
              ) : (
                <div className="space-y-3">
                  {getTenantTenancies(selectedTenant.id).map((tenancy) => {
                    const apt = getApartmentInfo(tenancy.apartment_id);
                    const prop = apt ? getPropertyInfo(apt.property_id) : null;
                    return (
                      <Card key={tenancy.id} className="p-5">
                        <div className="flex items-start justify-between mb-3">
                          <h4 className="font-semibold text-slate-900">
                            {prop?.name} — Lägenhet {apt?.apartment_number}
                          </h4>
                          <Badge className={tenancy.status === 'active' ? 'text-green-700 bg-green-100' : 'text-slate-600 bg-slate-100'}>
                            {tenancy.status === 'active' ? 'Aktiv' : tenancy.status === 'terminated' ? 'Uppsagd' : 'Avslutad'}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-slate-500">Adress</span>
                            <p className="font-medium text-slate-800">{prop?.address}</p>
                          </div>
                          <div>
                            <span className="text-slate-500">Startdatum</span>
                            <p className="font-medium text-slate-800">{formatDate(tenancy.start_date)}</p>
                          </div>
                          <div>
                            <span className="text-slate-500">Månadshyra</span>
                            <p className="font-medium text-slate-800">{formatCurrency(tenancy.monthly_rent)}</p>
                          </div>
                          {tenancy.end_date && (
                            <div>
                              <span className="text-slate-500">Slutdatum</span>
                              <p className="font-medium text-slate-800">{formatDate(tenancy.end_date)}</p>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        open={showTenantModal}
        onClose={() => { setShowTenantModal(false); setEditingTenant(null); }}
        title={editingTenant ? 'Redigera hyresgäst' : 'Ny hyresgäst'}
        size="lg"
      >
        <div className="space-y-5">
          {/* Personal info section */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Personuppgifter</p>
            <div className="space-y-3">
              <Input
                label="Namn"
                value={tenantFormData.name}
                onChange={(e) => setTenantFormData({ ...tenantFormData, name: e.target.value })}
                placeholder="T.ex. Johan Andersson"
              />
              {!editingTenant && (
                <Input
                  label="E-post"
                  type="email"
                  value={tenantFormData.email}
                  onChange={(e) => setTenantFormData({ ...tenantFormData, email: e.target.value })}
                  placeholder="T.ex. johan@exempel.se"
                />
              )}
              <Input
                label="Telefon"
                value={tenantFormData.phone}
                onChange={(e) => setTenantFormData({ ...tenantFormData, phone: e.target.value })}
                placeholder="T.ex. 070-123 45 67"
              />
              {editingTenant && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tenantFormData.active}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, active: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700">Aktiv</span>
                </label>
              )}
            </div>
          </div>

          {/* Tenancy section — only for new tenants */}
          {!editingTenant && (
            <div className="border-t border-slate-200 pt-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Hyresförhållande</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fastighet</label>
                  <select
                    value={tenantFormData.property_id}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, property_id: e.target.value, apartment_id: '' })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Välj fastighet</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {p.address}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Lägenhet
                    {!tenantFormData.property_id && <span className="text-slate-400 ml-1">(välj fastighet först)</span>}
                  </label>
                  <select
                    value={tenantFormData.apartment_id}
                    onChange={(e) => {
                      const apt = apartments.find((a) => a.id === e.target.value);
                      setTenantFormData({
                        ...tenantFormData,
                        apartment_id: e.target.value,
                        monthly_rent: apt?.rent ? String(apt.rent) : tenantFormData.monthly_rent,
                      });
                    }}
                    disabled={!tenantFormData.property_id}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Välj lägenhet</option>
                    {apartments
                      .filter((a) => a.property_id === tenantFormData.property_id && a.status !== 'rented')
                      .map((apt) => (
                        <option key={apt.id} value={apt.id}>
                          Lgh {apt.apartment_number} — {apt.rooms} rok, {apt.size} m²{apt.rent ? ` — ${Number(apt.rent).toLocaleString('sv-SE')} kr/mån` : ''}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Inflyttningsdatum"
                    type="date"
                    value={tenantFormData.start_date}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, start_date: e.target.value })}
                  />
                  <Input
                    label="Månadshyra (SEK)"
                    type="number"
                    value={tenantFormData.monthly_rent}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, monthly_rent: e.target.value })}
                    placeholder="T.ex. 12000"
                  />
                </div>

                {!tenantFormData.apartment_id && (
                  <p className="text-xs text-slate-400">Lämna lägenhet tom för att skapa hyresgästen utan hyresförhållande.</p>
                )}
              </div>
            </div>
          )}

          {!editingTenant && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                Ett konto skapas med ett tillfälligt lösenord. Hyresgästen kan byta lösenord efter inloggning.
              </p>
            </div>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {saveError}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-1">
            <Button variant="secondary" onClick={() => { setShowTenantModal(false); setEditingTenant(null); }}>
              Avbryt
            </Button>
            <Button variant="primary" onClick={handleSaveTenant} loading={saving}>
              {editingTenant ? 'Spara' : 'Skapa konto'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showLinkTenancyModal}
        onClose={() => setShowLinkTenancyModal(false)}
        title="Länka hyresförhållande"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Lägenhet</label>
            <select
              value={linkTenancyFormData.apartment_id}
              onChange={(e) => setLinkTenancyFormData({ ...linkTenancyFormData, apartment_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Välj en lägenhet</option>
              {getAvailableApartments().map((apt) => {
                const prop = getPropertyInfo(apt.property_id);
                return (
                  <option key={apt.id} value={apt.id}>
                    {prop?.name} — Lägenhet {apt.apartment_number} ({apt.size} m²)
                  </option>
                );
              })}
            </select>
          </div>
          <Input
            label="Startdatum"
            type="date"
            value={linkTenancyFormData.start_date}
            onChange={(e) => setLinkTenancyFormData({ ...linkTenancyFormData, start_date: e.target.value })}
          />
          <Input
            label="Månadshyra (SEK)"
            type="number"
            value={linkTenancyFormData.monthly_rent}
            onChange={(e) => setLinkTenancyFormData({ ...linkTenancyFormData, monthly_rent: e.target.value })}
            placeholder="T.ex. 15000"
          />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowLinkTenancyModal(false)}>Avbryt</Button>
            <Button variant="primary" onClick={handleLinkTenancy}>Länka</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!createdCredentials}
        onClose={() => setCreatedCredentials(null)}
        title="Hyresgästkonto skapat"
      >
        {createdCredentials && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900 mb-1">Kontot har skapats</p>
              <p className="text-sm text-green-800">
                Hyresgästen kan logga in med <strong>{createdCredentials.email}</strong> och lösenordet nedan.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-amber-900 uppercase mb-2">Tillfälligt lösenord</p>
              <p className="text-xs text-amber-700 mb-2">Dela lösenordet säkert och be hyresgästen byta det efter inloggning.</p>
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
