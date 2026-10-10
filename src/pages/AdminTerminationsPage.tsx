import React, { useState, useEffect, useRef } from 'react';
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
  Select, SearchInput, Avatar,
} from '../components/ui';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
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

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [savingDetail, setSavingDetail] = useState(false);
  const createLock = useRef(false);
  const detailLock = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const [discard, setDiscard] = useState<'create' | 'detail' | null>(null);
  const createDirty = useUnsavedChanges(createForm, showCreateModal);
  const detailDirty = useUnsavedChanges({internalNotes, newStatus}, showDetailModal, {internalNotes:selectedRequest?.internal_notes || '',newStatus:selectedRequest?.status || ''});
  const closeCreate = () => { if (savingCreate) return; if (createDirty) setDiscard('create'); else { setShowCreateModal(false); resetCreateForm(); } };
  const closeDetail = () => { if (savingDetail) return; if (detailDirty && (internalNotes !== (selectedRequest?.internal_notes || '') || newStatus !== selectedRequest?.status)) setDiscard('detail'); else setShowDetailModal(false); };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [reqRes, tenanciesRes, profilesRes, aptsRes, propsRes] = await Promise.all([
        supabase.from('vihem_termination_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('vihem_tenancies').select('*'),
        supabase.from('vihem_profiles').select('*'),
        supabase.from('vihem_apartments').select('*'),
        supabase.from('vihem_properties').select('*'),
      ]);
      for (const result of [reqRes, tenanciesRes, profilesRes, aptsRes, propsRes]) if (result.error) throw result.error;
      if (reqRes.data) setTerminationRequests(reqRes.data);
      if (tenanciesRes.data) setTenancies(tenanciesRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data);
      if (aptsRes.data) setApartments(aptsRes.data);
      if (propsRes.data) setProperties(propsRes.data);
    } catch (error) {
      setError('Kunde inte hämta uppsägningar. Försök igen.');
    } finally {
      setLoading(false);
    }
  };

  const filteredRequests = terminationRequests.filter(
    (r) => (!statusFilter || r.status === statusFilter) && (!search.trim() || [profiles.find(p => p.id === r.tenant_id)?.name, r.message, apartments.find(a => a.id === tenancies.find(t => t.id === r.tenancy_id)?.apartment_id)?.apartment_number].some(value => value?.toLocaleLowerCase('sv-SE').includes(search.trim().toLocaleLowerCase('sv-SE'))))
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
    requestId.current = crypto.randomUUID();
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
    if (createLock.current) return;
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

      createLock.current = true;
      const { error: saveError } = await supabase.rpc('vihem_register_termination', {
        p_request_id: requestId.current, p_tenancy_id: tenancy.id,
        p_move_out_date: createForm.requested_move_out_date, p_new_address: createForm.new_address,
        p_message: createForm.message || 'Uppsägning registrerad av admin efter besked utanför appen.',
        p_internal_notes: createForm.internal_notes, p_status: createForm.status,
        p_update_tenancy: createForm.update_tenancy,
      });
      if (saveError) throw saveError;
      setNotice('Uppsägningen har registrerats.');
      resetCreateForm();
      setShowCreateModal(false);
      fetchData();
    } catch (error: any) {
      console.error('Error creating termination:', error);
      setCreateError(error.message || 'Kunde inte skapa uppsägningen.');
    } finally {
      createLock.current = false;
      setSavingCreate(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedRequest || detailLock.current) return;
    detailLock.current = true; setSavingDetail(true); setError('');
    try {
      const { data, error: saveError } = await supabase.from('vihem_termination_requests')
        .update({ internal_notes: internalNotes }).eq('id', selectedRequest.id).select().single();
      if (saveError) throw saveError;
      setSelectedRequest(data as TerminationRequest);
      setTerminationRequests(current => current.map(row => row.id === data.id ? data as TerminationRequest : row));
      setNotice('Ändringarna har sparats.');
    } catch { setError('Kunde inte spara. Dina ändringar finns kvar.'); }
    finally { detailLock.current = false; setSavingDetail(false); }
  };

  const handleStatusChange = async () => {
    if (!selectedRequest || detailLock.current) return;
    detailLock.current = true; setSavingDetail(true); setError('');
    try {
      const { data, error: saveError } = await supabase.from('vihem_termination_requests')
        .update({ status: newStatus }).eq('id', selectedRequest.id).select().single();
      if (saveError) throw saveError;
      setSelectedRequest(data as TerminationRequest);
      setTerminationRequests(current => current.map(row => row.id === data.id ? data as TerminationRequest : row));
      setNotice('Ändringarna har sparats.');
    } catch { setError('Kunde inte spara. Dina ändringar finns kvar.'); }
    finally { detailLock.current = false; setSavingDetail(false); }
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

        {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}<Button variant="ghost" onClick={fetchData}>Försök igen</Button></div>}
        {notice && <p role="status" className="mb-4 text-sm text-green-700">{notice}</p>}
        <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <SearchInput value={search} onChange={setSearch} placeholder="Sök hyresgäst, lägenhet eller meddelande" />
          <Select label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} options={[{value:'',label:'Alla statusar'},...Object.entries(TERMINATION_STATUS_LABELS).map(([value,label]) => ({value,label}))]} />
        </div>
        <div className="mb-4 flex flex-wrap gap-4 text-sm text-slate-500"><span>{terminationRequests.filter(r => ['submitted','received','processing'].includes(r.status)).length} under handläggning</span><span>{filteredRequests.length} i urvalet</span></div>
        {filteredRequests.length === 0 ? (
          <EmptyState
            icon={<FileX className="w-12 h-12" />}
            title="Inga uppsägningar"
            description={statusFilter ? `Inga uppsägningar med status "${TERMINATION_STATUS_LABELS[statusFilter] || statusFilter}"` : 'Inga uppsägningsärenden registrerade'}
          />
        ) : (
          <Card>
            <div className="divide-y divide-slate-100 md:hidden">{filteredRequests.map(request => {
              const tenant = getProfileInfo(request.tenant_id); const tenancy = getTenancyInfo(request.tenancy_id); const apt = tenancy ? getApartmentInfo(tenancy.apartment_id) : null;
              return <button key={request.id} onClick={() => handleOpenDetail(request)} className="flex w-full items-start gap-3 py-4 text-left focus-visible:ring-2 focus-visible:ring-blue-600"><Avatar userId={request.tenant_id} name={tenant?.name || 'Hyresgäst'} size="sm" /><span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{tenant?.name || 'Hyresgäst'}</span><span className="block text-sm text-slate-500">{apt?.apartment_number} · {formatDate(request.requested_move_out_date)}</span><Badge className="mt-2 bg-slate-100 text-slate-700">{TERMINATION_STATUS_LABELS[request.status]}</Badge></span><span className="text-sm text-blue-700">Öppna</span></button>;
            })}</div>
            <div className="hidden overflow-x-auto md:block">
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
                            className="vihem-icon-button text-blue-700 text-sm"
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
        onClose={closeCreate}
        mobileFullscreen
        title="Registrera uppsägning"
        footer={<div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={closeCreate}>
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
          </div>}
        size="lg"
      >
        <div className="space-y-5">
          <div>
            <label htmlFor="termination-tenancy" className="block text-sm font-medium text-slate-700 mb-1">Hyresförhållande</label>
            <select
              id="termination-tenancy" value={createForm.tenancy_id}
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
              <label htmlFor="termination-status" className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                id="termination-status" value={createForm.status}
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


        </div>
      </Modal>

      <Modal
        open={showDetailModal}
        onClose={closeDetail}
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
                    loading={savingDetail}
                    onClick={handleStatusChange}
                  >
                    Spara status
                  </Button>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-700 uppercase mb-3">Interna anteckningar</h3>
                {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
                <Textarea
                  label="Intern anteckning"
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Lägg till noteringar om denna uppsägning..."
                  rows={4}
                />
                <div className="flex justify-end pt-3">
                  <Button variant="primary" onClick={handleSaveNotes} loading={savingDetail} className="gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Spara anteckningar
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
      <Modal open={Boolean(discard)} onClose={() => setDiscard(null)} title="Lämna osparade ändringar?" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDiscard(null)}>Fortsätt redigera</Button><Button variant="danger" onClick={() => { if (discard === 'create') { setShowCreateModal(false); resetCreateForm(); } else setShowDetailModal(false); setDiscard(null); }}>Kasta ändringar</Button></div>}>Ändringarna har inte sparats.</Modal>
    </div>
  );
}
