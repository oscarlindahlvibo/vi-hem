import React, { useState, useEffect } from 'react';
import { FileX, Calendar, CheckCircle, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Input,
  Modal,
  Textarea,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatDate } from '../lib/utils';
import { TerminationRequest, Tenancy, Profile, Apartment, Property } from '../types';

const TERMINATION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Inlämnad',
  received: 'Mottagen',
  processing: 'Under handläggning',
  approved: 'Godkänd',
  closed: 'Stängd',
};

const TERMINATION_STATUS_COLORS: Record<string, string> = {
  submitted: 'text-blue-700 bg-blue-100',
  received: 'text-teal-700 bg-teal-100',
  processing: 'text-amber-700 bg-amber-100',
  approved: 'text-green-700 bg-green-100',
  closed: 'text-slate-600 bg-slate-100',
};

interface AdminTerminationsPageProps { onNavigate: (page: string) => void; }
export function AdminTerminationsPage({ onNavigate: _onNavigate }: AdminTerminationsPageProps) {
  const { user } = useAuth();
  const [terminationRequests, setTerminationRequests] = useState<TerminationRequest[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<TerminationRequest | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [createForm, setCreateForm] = useState({
    tenancy_id: '',
    requested_move_out_date: '',
    new_address: '',
    message: '',
    internal_notes: '',
    status: 'received',
    update_tenancy: true,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reqRes, tenanciesRes, profilesRes, aptsRes, propsRes] = await Promise.all([
        supabase.from('termination_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('tenancies').select('*'),
        supabase.from('profiles').select('*'),
        supabase.from('apartments').select('*'),
        supabase.from('properties').select('*'),
      ]);
      if (reqRes.data) setTerminationRequests(reqRes.data);
      if (tenanciesRes.data) setTenancies(tenanciesRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data);
      if (aptsRes.data) setApartments(aptsRes.data);
      if (propsRes.data) setProperties(propsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredRequests = terminationRequests.filter(
    (r) => !statusFilter || r.status === statusFilter
  );

  const getTenancyInfo = (tenancyId: string | null) =>
    tenancyId ? tenancies.find((t) => t.id === tenancyId) : undefined;

  const getProfileInfo = (profileId: string | null) =>
    profileId ? profiles.find((p) => p.id === profileId) : undefined;

  const getApartmentInfo = (apartmentId: string | null) =>
    apartmentId ? apartments.find((a) => a.id === apartmentId) : undefined;

  const getPropertyInfo = (propertyId: string | null) =>
    propertyId ? properties.find((p) => p.id === propertyId) : undefined;

  const activeTenancies = tenancies
    .filter((tenancy) => tenancy.status === 'active')
    .sort((a, b) => {
      const tenantA = getProfileInfo(a.tenant_id)?.name || '';
      const tenantB = getProfileInfo(b.tenant_id)?.name || '';
      return tenantA.localeCompare(tenantB, 'sv-SE');
    });

  const resetCreateForm = () => {
    setCreateForm({
      tenancy_id: '',
      requested_move_out_date: '',
      new_address: '',
      message: '',
      internal_notes: '',
      status: 'received',
      update_tenancy: true,
    });
    setCreateError('');
    setSavingCreate(false);
  };

  const handleOpenDetail = (request: TerminationRequest) => {
    setSelectedRequest(request);
    setInternalNotes(request.internal_notes || '');
    setNewStatus(request.status);
    setShowDetailModal(true);
  };

  const handleCreateTermination = async () => {
    const tenancy = getTenancyInfo(createForm.tenancy_id);
    if (!user || !tenancy) {
      setCreateError('Välj ett hyresförhållande.');
      return;
    }

    if (!createForm.requested_move_out_date) {
      setCreateError('Ange utflyttningsdatum.');
      return;
    }

    try {
      setSavingCreate(true);
      setCreateError('');

      const { error: insertError } = await supabase
        .from('termination_requests')
        .insert({
          organisation_id: user.organisation_id,
          tenant_id: tenancy.tenant_id,
          tenancy_id: tenancy.id,
          requested_move_out_date: createForm.requested_move_out_date,
          new_address: createForm.new_address,
          message: createForm.message || 'Uppsägning registrerad av admin efter besked utanför appen.',
          status: createForm.status,
          internal_notes: createForm.internal_notes,
          confirmed_by: user.id,
          confirmed_at: new Date().toISOString(),
        });

      if (insertError) throw insertError;

      if (createForm.update_tenancy) {
        const { error: tenancyError } = await supabase
          .from('tenancies')
          .update({
            status: 'terminated',
            end_date: createForm.requested_move_out_date,
          })
          .eq('id', tenancy.id);

        if (tenancyError) throw tenancyError;
      }

      resetCreateForm();
      setShowCreateModal(false);
      fetchData();
    } catch (error: any) {
      console.error('Error creating termination:', error);
      setCreateError(error.message || 'Kunde inte skapa uppsägningen.');
    } finally {
      setSavingCreate(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedRequest) return;
    try {
      await supabase
        .from('termination_requests')
        .update({ internal_notes: internalNotes })
        .eq('id', selectedRequest.id);
      setSelectedRequest({ ...selectedRequest, internal_notes: internalNotes });
      fetchData();
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  };

  const handleStatusChange = async () => {
    if (!selectedRequest) return;
    try {
      await supabase
        .from('termination_requests')
        .update({ status: newStatus })
        .eq('id', selectedRequest.id);
      setSelectedRequest({ ...selectedRequest, status: newStatus as TerminationRequest['status'] });
      fetchData();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title="Uppsägningar"
          subtitle="Hantera hyresgästers uppsägningsärenden"
          action={
            <Button variant="primary" onClick={() => setShowCreateModal(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Registrera uppsägning
            </Button>
          }
        />

        <div className="flex items-center gap-3 mb-6">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Alla status</option>
            <option value="submitted">Inlämnad</option>
            <option value="received">Mottagen</option>
            <option value="processing">Under handläggning</option>
            <option value="approved">Godkänd</option>
            <option value="closed">Stängd</option>
          </select>

          {statusFilter && (
            <button
              onClick={() => setStatusFilter('')}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Rensa filter
            </button>
          )}
        </div>

        {filteredRequests.length === 0 ? (
          <EmptyState
            icon={<FileX className="w-12 h-12" />}
            title="Inga uppsägningar"
            description={statusFilter ? `Inga uppsägningar med status "${TERMINATION_STATUS_LABELS[statusFilter] || statusFilter}"` : 'Inga uppsägningsärenden registrerade'}
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Hyresgäst</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Lägenhet</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Utflyttningsdatum</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Skapat</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequests.map((request) => {
                    const tenantProfile = getProfileInfo(request.tenant_id);
                    const tenancy = getTenancyInfo(request.tenancy_id);
                    const apt = tenancy ? getApartmentInfo(tenancy.apartment_id) : null;
                    const prop = apt ? getPropertyInfo(apt.property_id) : null;

                    return (
                      <tr key={request.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {tenantProfile?.name || '—'}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {prop && apt ? `${prop.name} — Lgh ${apt.apartment_number}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <div className="flex items-center gap-2 text-slate-700">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            {formatDate(request.requested_move_out_date)}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className={TERMINATION_STATUS_COLORS[request.status] || 'text-slate-600 bg-slate-100'}>
                            {TERMINATION_STATUS_LABELS[request.status] || request.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-500">
                          {formatDate(request.created_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleOpenDetail(request)}
                            className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                          >
                            Visa detaljer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Modal
        open={showCreateModal}
        onClose={() => { setShowCreateModal(false); resetCreateForm(); }}
        title="Registrera uppsägning"
        size="lg"
      >
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hyresförhållande</label>
            <select
              value={createForm.tenancy_id}
              onChange={(e) => setCreateForm({ ...createForm, tenancy_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Välj hyresgäst och lägenhet</option>
              {activeTenancies.map((tenancy) => {
                const tenant = getProfileInfo(tenancy.tenant_id);
                const apt = getApartmentInfo(tenancy.apartment_id);
                const prop = getPropertyInfo(tenancy.property_id || apt?.property_id || null);
                return (
                  <option key={tenancy.id} value={tenancy.id}>
                    {tenant?.name || 'Okänd hyresgäst'} — {prop?.name || 'Fastighet'} Lgh {apt?.apartment_number || '—'}
                  </option>
                );
              })}
            </select>
            {activeTenancies.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">Det finns inga aktiva hyresförhållanden att säga upp.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Utflyttningsdatum"
              type="date"
              value={createForm.requested_move_out_date}
              onChange={(e) => setCreateForm({ ...createForm, requested_move_out_date: e.target.value })}
            />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                value={createForm.status}
                onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="received">Mottagen</option>
                <option value="processing">Under handläggning</option>
                <option value="approved">Godkänd</option>
                <option value="closed">Stängd</option>
              </select>
            </div>
          </div>

          <Input
            label="Ny adress"
            value={createForm.new_address}
            onChange={(e) => setCreateForm({ ...createForm, new_address: e.target.value })}
            placeholder="Valfritt"
          />

          <Textarea
            label="Meddelande / hur uppsägningen inkom"
            value={createForm.message}
            onChange={(e) => setCreateForm({ ...createForm, message: e.target.value })}
            placeholder="T.ex. Uppsägning mottagen via e-post eller telefon."
            rows={3}
          />

          <Textarea
            label="Intern anteckning"
            value={createForm.internal_notes}
            onChange={(e) => setCreateForm({ ...createForm, internal_notes: e.target.value })}
            placeholder="Valfritt, visas bara internt"
            rows={3}
          />

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={createForm.update_tenancy}
              onChange={(e) => setCreateForm({ ...createForm, update_tenancy: e.target.checked })}
              className="w-4 h-4 mt-0.5 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">
              Markera hyresförhållandet som uppsagt och sätt slutdatum till utflyttningsdatum.
            </span>
          </label>

          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {createError}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
              Avbryt
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateTermination}
              loading={savingCreate}
              disabled={activeTenancies.length === 0}
            >
              Registrera
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedRequest(null); setInternalNotes(''); setNewStatus(''); }}
        title="Uppsägningsdetaljer"
        size="lg"
      >
        {selectedRequest && (() => {
          const tenantProfile = getProfileInfo(selectedRequest.tenant_id);
          const tenancy = getTenancyInfo(selectedRequest.tenancy_id);
          const apt = tenancy ? getApartmentInfo(tenancy.apartment_id) : null;
          const prop = apt ? getPropertyInfo(apt.property_id) : null;

          return (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase mb-3">Grundläggande information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">Hyresgäst</span>
                    <p className="font-medium text-slate-900 mt-0.5">{tenantProfile?.name || '—'}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Lägenhet</span>
                    <p className="font-medium text-slate-900 mt-0.5">
                      {prop && apt ? `${prop.name} — Lgh ${apt.apartment_number}` : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Utflyttningsdatum</span>
                    <p className="font-medium text-slate-900 mt-0.5">{formatDate(selectedRequest.requested_move_out_date)}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Nuvarande status</span>
                    <div className="mt-0.5">
                      <Badge className={TERMINATION_STATUS_COLORS[selectedRequest.status] || 'text-slate-600 bg-slate-100'}>
                        {TERMINATION_STATUS_LABELS[selectedRequest.status] || selectedRequest.status}
                      </Badge>
                    </div>
                  </div>
                  {selectedRequest.new_address && (
                    <div className="col-span-2">
                      <span className="text-slate-500">Ny adress</span>
                      <p className="font-medium text-slate-900 mt-0.5">{selectedRequest.new_address}</p>
                    </div>
                  )}
                  {selectedRequest.message && (
                    <div className="col-span-2">
                      <span className="text-slate-500">Meddelande från hyresgäst</span>
                      <p className="text-slate-700 mt-0.5 bg-slate-50 p-3 rounded-lg">{selectedRequest.message}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-700 uppercase mb-3">Uppdatera status</h3>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="submitted">Inlämnad</option>
                      <option value="received">Mottagen</option>
                      <option value="processing">Under handläggning</option>
                      <option value="approved">Godkänd</option>
                      <option value="closed">Stängd</option>
                    </select>
                  </div>
                  <Button
                    variant={newStatus === selectedRequest.status ? 'secondary' : 'primary'}
                    disabled={newStatus === selectedRequest.status}
                    onClick={handleStatusChange}
                  >
                    Spara status
                  </Button>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-700 uppercase mb-3">Interna anteckningar</h3>
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Lägg till noteringar om denna uppsägning..."
                  rows={4}
                />
                <div className="flex justify-end pt-3">
                  <Button variant="primary" onClick={handleSaveNotes} className="gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Spara anteckningar
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
