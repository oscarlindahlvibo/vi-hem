// Fleet Manager: register över fordon/maskiner/släp, med skador,
// service, besiktningar, mätarhistorik, däck, dokument, kostnader,
// checklistor och telematik-förberedelse. Återanvänder befintliga
// system istället för att bygga parallella: vihem_companies (ägande
// bolag), vihem_inventory_locations (ombord-lager i fordonet, type =
// 'vehicle'), vihem_work_orders/vihem_time_entries (vehicle_id-kolumn
// tillagd), vihem_notifications (create_notification/notification_enabled,
// samma mönster som Jour), och samma storage-uppladdningsmönster som
// WorkOrdersPage/InventoryPage (bucket + valfri Google Drive-arkivering).
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Activity, AlertTriangle, ArrowLeft, Banknote, Calendar, Camera, Car, Check, CheckSquare,
  ChevronRight, Circle, ClipboardList, FileText, Gauge, History,
  Plus, QrCode, Radio, Search, Settings, Trash2, Upload, Wrench, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { archiveFileInGoogleDrive } from '../lib/googleDriveStorage';
import { WO_PRIORITY_LABELS, WO_STATUS_LABELS } from '../lib/utils';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';
import type {
  AttachmentItem, FleetAssetType, FleetChecklistRun, FleetChecklistRunItem, FleetChecklistTemplate, FleetChecklistTemplateItem,
  FleetCost, FleetCostType, FleetDamageReport, FleetDamageSeverity, FleetEvent, FleetInspection, FleetMeterReading,
  FleetServiceRecord, FleetServiceSchedule, FleetTelematicsDevice, FleetTire, FleetVehicle, FleetVehicleStatus,
  Profile, WorkOrder,
} from '../types';

// ── Konstanter ───────────────────────────────────────────────────────────

const ASSET_TYPES: FleetAssetType[] = ['car', 'van', 'truck', 'trailer', 'excavator', 'tractor', 'implement', 'other'];
const ASSET_TYPE_LABELS: Record<FleetAssetType, string> = { car: 'Bil', van: 'Transportbil', truck: 'Lastbil', trailer: 'Släpvagn', excavator: 'Grävmaskin', tractor: 'Traktor', implement: 'Redskap', other: 'Övrigt' };
const ASSET_TYPES_WITH_ODOMETER: FleetAssetType[] = ['car', 'van', 'truck', 'trailer'];
const ASSET_TYPES_WITH_ENGINE_HOURS: FleetAssetType[] = ['excavator', 'tractor', 'implement', 'truck'];
const ASSET_TYPES_WITH_REGISTRATION: FleetAssetType[] = ['car', 'van', 'truck', 'trailer', 'tractor'];
const ASSET_TYPES_WITH_TIRES: FleetAssetType[] = ['car', 'van', 'truck', 'trailer', 'tractor'];

const STATUS_ORDER: FleetVehicleStatus[] = ['in_service', 'workshop', 'out_of_service', 'driving_ban', 'laid_up', 'rented_out', 'sold'];
const STATUS_LABELS: Record<FleetVehicleStatus, string> = { in_service: 'I drift', workshop: 'På verkstad', out_of_service: 'Ur drift', driving_ban: 'Körförbud', laid_up: 'Avställd', rented_out: 'Uthyrd', sold: 'Såld' };
const STATUS_CLASS: Record<FleetVehicleStatus, string> = { in_service: 'bg-emerald-100 text-emerald-700', workshop: 'bg-amber-100 text-amber-700', out_of_service: 'bg-slate-200 text-slate-700', driving_ban: 'bg-red-100 text-red-700', laid_up: 'bg-slate-100 text-slate-500', rented_out: 'bg-blue-100 text-blue-700', sold: 'bg-slate-100 text-slate-400' };
const STATUS_DOT: Record<FleetVehicleStatus, string> = { in_service: 'bg-emerald-500', workshop: 'bg-amber-500', out_of_service: 'bg-slate-400', driving_ban: 'bg-red-500', laid_up: 'bg-slate-300', rented_out: 'bg-blue-500', sold: 'bg-slate-300' };

const FUEL_LABELS: Record<string, string> = { petrol: 'Bensin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', hvo: 'HVO', other: 'Övrigt' };
const FINANCING_LABELS: Record<string, string> = { owned: 'Ägt', leasing: 'Leasing', loan: 'Lån', rental: 'Hyrt' };
const SEVERITY_LABELS: Record<FleetDamageSeverity, string> = { info: 'Information', should_fix: 'Bör åtgärdas', urgent: 'Brådskande', no_use: 'Får ej användas' };
const SEVERITY_CLASS: Record<FleetDamageSeverity, string> = { info: 'bg-slate-100 text-slate-600', should_fix: 'bg-amber-100 text-amber-700', urgent: 'bg-orange-100 text-orange-700', no_use: 'bg-red-100 text-red-700' };
const COST_TYPE_LABELS: Record<FleetCostType, string> = { service: 'Service', repair: 'Reparation', parts: 'Reservdelar', tires: 'Däck', insurance: 'Försäkring', tax: 'Skatt', leasing: 'Leasing', inspection: 'Besiktning', fuel: 'Bränsle', charging: 'Laddning', other: 'Övrigt' };
const EVENT_LABELS: Record<string, string> = { created: 'Tillgång skapad', status_changed: 'Status ändrad', odometer_updated: 'Mätarställning uppdaterad', damage_reported: 'Skada rapporterad', damage_converted: 'Felrapport omvandlad till arbetsorder', work_order_created: 'Arbetsorder skapad', inspection_recorded: 'Kontroll registrerad', service_recorded: 'Service registrerad', device_assigned: 'Telematikenhet kopplad', device_unassigned: 'Telematikenhet frånkopplad', updated: 'Uppdaterad' };

type Urgency = 'overdue' | 'soon' | 'later' | 'ok';
const URGENCY_LABEL: Record<Urgency, string> = { overdue: 'Förfallen', soon: 'Inom 30 dagar', later: 'Inom 90 dagar', ok: 'OK' };
const URGENCY_CLASS: Record<Urgency, string> = { overdue: 'bg-red-100 text-red-700', soon: 'bg-amber-100 text-amber-700', later: 'bg-blue-50 text-blue-700', ok: 'bg-emerald-50 text-emerald-700' };

function formatNumber(value: number | null | undefined, decimals = 0) { return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: decimals }).format(value || 0); }
function fmtDate(value: string | null | undefined) { return value ? new Date(value).toLocaleDateString('sv-SE') : '-'; }
function fmtDateTime(value: string | null | undefined) { return value ? new Date(value).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '-'; }
function daysUntil(dateStr: string | null | undefined) { if (!dateStr) return null; const ms = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0); return Math.round(ms / 86400000); }
function urgencyFromDays(days: number | null): Urgency { if (days === null) return 'ok'; if (days < 0) return 'overdue'; if (days <= 30) return 'soon'; if (days <= 90) return 'later'; return 'ok'; }
function vehicleLabel(v: Pick<FleetVehicle, 'name' | 'registration_number'>) { return v.registration_number ? `${v.registration_number} -- ${v.name}` : v.name; }
function describeError(err: unknown): string { if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message); return 'Något gick fel.'; }

async function uploadFleetFile(
  file: File, bucket: string, orgId: string, folder: string, userId: string, sourceType: string, sourceId: string
): Promise<AttachmentItem> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${orgId}/${folder}/${crypto.randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type });
  if (upload.error) throw new Error(`Kunde inte ladda upp ${file.name}: ${upload.error.message}`);
  const url = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  try {
    await archiveFileInGoogleDrive({ file, folder: 'Fleet', organisation_id: orgId, source_type: sourceType, source_id: sourceId, source_key: path, created_by: userId });
  } catch (driveError) {
    console.warn('Kunde inte arkivera filen i Google Drive:', driveError);
  }
  return { id: crypto.randomUUID(), name: file.name, url, path, type: file.type, size: file.size, uploaded_at: new Date().toISOString(), uploaded_by: userId };
}

// ── Huvudkomponent ────────────────────────────────────────────────────────

type FleetView = 'dashboard' | 'list' | 'detail';
type ListFilter = { status?: FleetVehicleStatus; inspectionsDue?: boolean; serviceDue?: boolean; damageOpen?: boolean; workOrdersOpen?: boolean } | null;

export function FleetPage({ onNavigate, initialVehicleId }: { onNavigate: (page: string) => void; initialVehicleId?: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [view, setView] = useState<FleetView>(initialVehicleId ? 'detail' : 'dashboard');
  const [selectedVehicleId, setSelectedVehicleId] = useState(initialVehicleId || '');
  const [listFilter, setListFilter] = useState<ListFilter>(null);
  const [search, setSearch] = useState('');

  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'name'>[]>([]);
  const [damageReports, setDamageReports] = useState<FleetDamageReport[]>([]);
  const [serviceSchedules, setServiceSchedules] = useState<FleetServiceSchedule[]>([]);
  const [inspections, setInspections] = useState<FleetInspection[]>([]);
  const [fleetWorkOrders, setFleetWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleModal, setVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<FleetVehicle | null>(null);

  const load = useCallback(async () => {
    if (!user?.organisation_id) return;
    setLoading(true);
    const [vehiclesRes, companiesRes, propertiesRes, profilesRes, damageRes, scheduleRes, inspectionRes, woRes] = await Promise.all([
      supabase.from('vihem_fleet_vehicles').select('*').eq('organisation_id', user.organisation_id).eq('active', true).order('name'),
      supabase.from('vihem_companies').select('id,name').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_properties').select('id,name').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_profiles').select('id,name').eq('organisation_id', user.organisation_id).eq('active', true).order('name'),
      supabase.from('vihem_fleet_damage_reports').select('*').eq('organisation_id', user.organisation_id).order('created_at', { ascending: false }),
      supabase.from('vihem_fleet_service_schedules').select('*').eq('organisation_id', user.organisation_id).eq('active', true),
      supabase.from('vihem_fleet_inspections').select('*').eq('organisation_id', user.organisation_id).eq('active', true),
      supabase.from('vihem_work_orders').select('*').eq('organisation_id', user.organisation_id).not('vehicle_id', 'is', null),
    ]);
    setVehicles((vehiclesRes.data || []) as FleetVehicle[]);
    setCompanies(companiesRes.data || []);
    setProperties(propertiesRes.data || []);
    setProfiles(profilesRes.data || []);
    setDamageReports((damageRes.data || []) as FleetDamageReport[]);
    setServiceSchedules((scheduleRes.data || []) as FleetServiceSchedule[]);
    setInspections((inspectionRes.data || []) as FleetInspection[]);
    setFleetWorkOrders((woRes.data || []) as WorkOrder[]);
    setLoading(false);
  }, [user?.organisation_id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vehicleParam = params.get('fleet_vehicle');
    if (vehicleParam && vehicles.some((v) => v.id === vehicleParam)) {
      setSelectedVehicleId(vehicleParam);
      setView('detail');
    }
  }, [vehicles]);

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const companiesById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const propertiesById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const stats = useMemo(() => {
    const inspectionUrgencies = inspections.map((i) => urgencyFromDays(daysUntil(i.next_inspection_date)));
    const serviceUrgencies = serviceSchedules.map((s) => {
      const v = vehicles.find((veh) => veh.id === s.vehicle_id);
      const dayU = urgencyFromDays(daysUntil(s.next_due_date));
      let odoU: Urgency = 'ok';
      if (v && s.next_due_odometer) { const remaining = s.next_due_odometer - v.current_odometer; odoU = remaining < 0 ? 'overdue' : remaining <= 300 ? 'soon' : remaining <= 1000 ? 'later' : 'ok'; }
      let hrsU: Urgency = 'ok';
      if (v && s.next_due_hours) { const remaining = s.next_due_hours - v.engine_hours; hrsU = remaining < 0 ? 'overdue' : remaining <= 20 ? 'soon' : remaining <= 100 ? 'later' : 'ok'; }
      const rank: Record<Urgency, number> = { overdue: 3, soon: 2, later: 1, ok: 0 };
      return [dayU, odoU, hrsU].sort((a, b) => rank[b] - rank[a])[0];
    });
    return {
      total: vehicles.length,
      byStatus: STATUS_ORDER.reduce((acc, s) => ({ ...acc, [s]: vehicles.filter((v) => v.status === s).length }), {} as Record<FleetVehicleStatus, number>),
      inspectionsOverdue: inspectionUrgencies.filter((u) => u === 'overdue').length,
      inspectionsSoon: inspectionUrgencies.filter((u) => u === 'soon').length,
      serviceOverdue: serviceUrgencies.filter((u) => u === 'overdue').length,
      serviceSoon: serviceUrgencies.filter((u) => u === 'soon').length,
      damageOpen: damageReports.filter((d) => d.status === 'open').length,
      damageUrgent: damageReports.filter((d) => d.status === 'open' && (d.severity === 'urgent' || d.severity === 'no_use')).length,
      workOrdersOpen: fleetWorkOrders.filter((w) => w.status !== 'completed' && w.status !== 'cancelled').length,
    };
  }, [vehicles, inspections, serviceSchedules, damageReports, fleetWorkOrders]);

  const openVehicle = (id: string) => { setSelectedVehicleId(id); setView('detail'); };
  const goToList = (filter: ListFilter) => { setListFilter(filter); setSearch(''); setView('list'); };

  if (!user?.organisation_id) return <LoadingPage />;
  if (loading) return <LoadingPage />;

  if (view === 'detail' && selectedVehicleId) {
    const vehicle = vehicles.find((v) => v.id === selectedVehicleId);
    if (!vehicle) { setView('list'); return null; }
    return (
      <VehicleDetail
        vehicle={vehicle}
        isAdmin={isAdmin}
        userId={user.id}
        organisationId={user.organisation_id}
        companies={companies}
        properties={properties}
        profiles={profiles}
        profilesById={profilesById}
        onBack={() => setView('list')}
        onChanged={load}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Fleet Manager"
        subtitle="Bilar, transportbilar, lastbilar, släp och maskiner -- ett register."
        icon={Car}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant={view === 'dashboard' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('dashboard')}><Activity className="h-4 w-4" /> Översikt</Button>
            <Button variant={view === 'list' ? 'primary' : 'secondary'} size="sm" onClick={() => goToList(null)}><Car className="h-4 w-4" /> Register</Button>
            {isAdmin && <Button size="sm" onClick={() => { setEditingVehicle(null); setVehicleModal(true); }}><Plus className="h-4 w-4" /> Ny tillgång</Button>}
          </div>
        }
      />

      {view === 'dashboard' && <FleetDashboard stats={stats} onFilter={goToList} vehicles={vehicles} inspections={inspections} serviceSchedules={serviceSchedules} damageReports={damageReports} onOpenVehicle={openVehicle} />}
      {view === 'list' && (
        <FleetList
          vehicles={vehicles}
          companiesById={companiesById}
          propertiesById={propertiesById}
          profilesById={profilesById}
          filter={listFilter}
          inspections={inspections}
          serviceSchedules={serviceSchedules}
          damageReports={damageReports}
          fleetWorkOrders={fleetWorkOrders}
          search={search}
          setSearch={setSearch}
          onOpen={openVehicle}
          isAdmin={isAdmin}
          onEdit={(v) => { setEditingVehicle(v); setVehicleModal(true); }}
        />
      )}

      {isAdmin && (
        <VehicleFormModal
          open={vehicleModal}
          onClose={() => setVehicleModal(false)}
          vehicle={editingVehicle}
          organisationId={user.organisation_id}
          userId={user.id}
          companies={companies}
          properties={properties}
          profiles={profiles}
          onSaved={() => { setVehicleModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────

function FleetDashboard({ stats, onFilter, vehicles, inspections, serviceSchedules, damageReports, onOpenVehicle }: {
  stats: any; onFilter: (filter: ListFilter) => void; vehicles: FleetVehicle[]; inspections: FleetInspection[]; serviceSchedules: FleetServiceSchedule[]; damageReports: FleetDamageReport[]; onOpenVehicle: (id: string) => void;
}) {
  const cards: { label: string; value: number; icon: any; className: string; onClick: () => void }[] = [
    { label: 'Antal tillgångar', value: stats.total, icon: Car, className: 'text-slate-900', onClick: () => onFilter(null) },
    { label: 'I drift', value: stats.byStatus.in_service, icon: Check, className: 'text-emerald-600', onClick: () => onFilter({ status: 'in_service' }) },
    { label: 'På verkstad', value: stats.byStatus.workshop, icon: Wrench, className: 'text-amber-600', onClick: () => onFilter({ status: 'workshop' }) },
    { label: 'Ur drift', value: stats.byStatus.out_of_service, icon: X, className: 'text-slate-500', onClick: () => onFilter({ status: 'out_of_service' }) },
    { label: 'Körförbud', value: stats.byStatus.driving_ban, icon: AlertTriangle, className: 'text-red-600', onClick: () => onFilter({ status: 'driving_ban' }) },
    { label: 'Besiktning förfallen', value: stats.inspectionsOverdue, icon: Calendar, className: 'text-red-600', onClick: () => onFilter({ inspectionsDue: true }) },
    { label: 'Besiktning inom 30 dagar', value: stats.inspectionsSoon, icon: Calendar, className: 'text-amber-600', onClick: () => onFilter({ inspectionsDue: true }) },
    { label: 'Service förfallen', value: stats.serviceOverdue, icon: Wrench, className: 'text-red-600', onClick: () => onFilter({ serviceDue: true }) },
    { label: 'Service snart', value: stats.serviceSoon, icon: Wrench, className: 'text-amber-600', onClick: () => onFilter({ serviceDue: true }) },
    { label: 'Öppna skador/fel', value: stats.damageOpen, icon: AlertTriangle, className: stats.damageUrgent > 0 ? 'text-red-600' : 'text-slate-900', onClick: () => onFilter({ damageOpen: true }) },
    { label: 'Öppna arbetsordrar', value: stats.workOrdersOpen, icon: ClipboardList, className: 'text-slate-900', onClick: () => onFilter({ workOrdersOpen: true }) },
  ];

  const urgentDamage = damageReports.filter((d) => d.status === 'open' && (d.severity === 'urgent' || d.severity === 'no_use')).slice(0, 6);
  const dueInspections = inspections
    .map((i) => ({ i, days: daysUntil(i.next_inspection_date), urgency: urgencyFromDays(daysUntil(i.next_inspection_date)) }))
    .filter((x) => x.urgency === 'overdue' || x.urgency === 'soon')
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <button key={c.label} onClick={c.onClick} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40">
            <div className="mb-2 flex items-center justify-between">
              <c.icon className={`h-5 w-5 ${c.className}`} />
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </div>
            <p className={`text-2xl font-bold ${c.className}`}>{c.value}</p>
            <p className="text-xs font-medium text-slate-500">{c.label}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-4"><h2 className="font-semibold text-slate-900">Allvarliga skador/fel som kräver åtgärd</h2></div>
          {urgentDamage.length ? (
            <div className="divide-y divide-slate-100">
              {urgentDamage.map((d) => {
                const v = vehicles.find((veh) => veh.id === d.vehicle_id);
                return (
                  <button key={d.id} onClick={() => v && onOpenVehicle(v.id)} className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{v ? vehicleLabel(v) : 'Okänt fordon'}</p>
                      <p className="truncate text-sm text-slate-500">{d.description}</p>
                    </div>
                    <Badge className={SEVERITY_CLASS[d.severity]}>{SEVERITY_LABELS[d.severity]}</Badge>
                  </button>
                );
              })}
            </div>
          ) : <EmptyState icon={<CheckSquare className="w-10 h-10" />} title="Inga allvarliga skador" description="Allt ser bra ut just nu." />}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-4"><h2 className="font-semibold text-slate-900">Besiktningar som snart går ut</h2></div>
          {dueInspections.length ? (
            <div className="divide-y divide-slate-100">
              {dueInspections.map(({ i, days, urgency }) => {
                const v = vehicles.find((veh) => veh.id === i.vehicle_id);
                return (
                  <button key={i.id} onClick={() => v && onOpenVehicle(v.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{v ? vehicleLabel(v) : 'Okänt fordon'}</p>
                      <p className="text-sm text-slate-500">{i.inspection_type} -- {fmtDate(i.next_inspection_date)}{days !== null && ` (${days < 0 ? `${Math.abs(days)} dagar sedan` : `om ${days} dagar`})`}</p>
                    </div>
                    <Badge className={URGENCY_CLASS[urgency]}>{URGENCY_LABEL[urgency]}</Badge>
                  </button>
                );
              })}
            </div>
          ) : <EmptyState icon={<CheckSquare className="w-10 h-10" />} title="Inga besiktningar snart" description="Inget att bevaka just nu." />}
        </Card>
      </div>
    </div>
  );
}

// ── Register (lista) ──────────────────────────────────────────────────

function FleetList({ vehicles, companiesById, propertiesById, profilesById, filter, inspections, serviceSchedules, damageReports, fleetWorkOrders, search, setSearch, onOpen, isAdmin, onEdit }: {
  vehicles: FleetVehicle[]; companiesById: Map<string, { id: string; name: string }>; propertiesById: Map<string, { id: string; name: string }>; profilesById: Map<string, Pick<Profile, 'id' | 'name'>>;
  filter: ListFilter; inspections: FleetInspection[]; serviceSchedules: FleetServiceSchedule[]; damageReports: FleetDamageReport[]; fleetWorkOrders: WorkOrder[];
  search: string; setSearch: (v: string) => void; onOpen: (id: string) => void; isAdmin: boolean; onEdit: (v: FleetVehicle) => void;
}) {
  const filtered = useMemo(() => {
    let rows = vehicles;
    if (filter?.status) rows = rows.filter((v) => v.status === filter.status);
    if (filter?.inspectionsDue) { const ids = new Set(inspections.filter((i) => { const u = urgencyFromDays(daysUntil(i.next_inspection_date)); return u === 'overdue' || u === 'soon'; }).map((i) => i.vehicle_id)); rows = rows.filter((v) => ids.has(v.id)); }
    if (filter?.serviceDue) { const ids = new Set(serviceSchedules.filter((s) => urgencyFromDays(daysUntil(s.next_due_date)) === 'overdue' || urgencyFromDays(daysUntil(s.next_due_date)) === 'soon').map((s) => s.vehicle_id)); rows = rows.filter((v) => ids.has(v.id)); }
    if (filter?.damageOpen) { const ids = new Set(damageReports.filter((d) => d.status === 'open').map((d) => d.vehicle_id)); rows = rows.filter((v) => ids.has(v.id)); }
    if (filter?.workOrdersOpen) { const ids = new Set(fleetWorkOrders.filter((w) => w.status !== 'completed' && w.status !== 'cancelled').map((w) => w.vehicle_id).filter(Boolean) as string[]); rows = rows.filter((v) => ids.has(v.id)); }
    if (search.trim()) { const q = search.toLowerCase(); rows = rows.filter((v) => `${v.name} ${v.registration_number} ${v.internal_number} ${v.make} ${v.model}`.toLowerCase().includes(q)); }
    return rows;
  }, [vehicles, filter, inspections, serviceSchedules, damageReports, fleetWorkOrders, search]);

  const openDamageCount = (vehicleId: string) => damageReports.filter((d) => d.vehicle_id === vehicleId && d.status === 'open').length;
  const openWoCount = (vehicleId: string) => fleetWorkOrders.filter((w) => w.vehicle_id === vehicleId && w.status !== 'completed' && w.status !== 'cancelled').length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sök reg.nr, namn, märke, modell..." className="pl-9" />
        </div>
        {filter && <Badge className="bg-blue-100 text-blue-700">Filtrerat</Badge>}
      </div>
      {filtered.length ? (
        <div className="divide-y divide-slate-100">
          {filtered.map((v) => {
            const damageCount = openDamageCount(v.id);
            const woCount = openWoCount(v.id);
            return (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-slate-50">
                <button onClick={() => onOpen(v.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[v.status]}`} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{v.registration_number && <span className="mr-2 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-white">{v.registration_number}</span>}{v.name}</p>
                    <p className="truncate text-sm text-slate-500">{ASSET_TYPE_LABELS[v.asset_type]} · {v.make} {v.model} {v.model_year || ''} · {companiesById.get(v.company_id || '')?.name || 'Inget bolag'}</p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_CLASS[v.status]}>{STATUS_LABELS[v.status]}</Badge>
                  {damageCount > 0 && <Badge className="bg-red-100 text-red-700"><AlertTriangle className="mr-1 inline h-3 w-3" />{damageCount}</Badge>}
                  {woCount > 0 && <Badge className="bg-blue-100 text-blue-700"><ClipboardList className="mr-1 inline h-3 w-3" />{woCount}</Badge>}
                  {isAdmin && <button onClick={() => onEdit(v)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Settings className="h-4 w-4" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyState icon={<Car className="w-12 h-12" />} title="Inga tillgångar" description="Skapa den första tillgången eller ändra sökningen/filtret." />}
    </Card>
  );
}

// ── Fordonsformulär (skapa/redigera) ────────────────────────────────────

type VehicleForm = {
  asset_type: FleetAssetType; registration_number: string; internal_number: string; name: string; make: string; model: string; model_year: string;
  vin: string; serial_number: string; company_id: string; responsible_user_id: string; property_id: string; purchase_date: string; purchase_price: string;
  financing_type: string; financing_notes: string; current_odometer: string; odometer_unit: string; engine_hours: string; fuel_type: string;
  registration_status: string; status: string; notes: string;
};
const EMPTY_VEHICLE_FORM: VehicleForm = { asset_type: 'car', registration_number: '', internal_number: '', name: '', make: '', model: '', model_year: '', vin: '', serial_number: '', company_id: '', responsible_user_id: '', property_id: '', purchase_date: '', purchase_price: '', financing_type: 'owned', financing_notes: '', current_odometer: '0', odometer_unit: 'mil', engine_hours: '0', fuel_type: 'diesel', registration_status: 'registered', status: 'in_service', notes: '' };

function VehicleFormModal({ open, onClose, vehicle, organisationId, userId, companies, properties, profiles, onSaved }: {
  open: boolean; onClose: () => void; vehicle: FleetVehicle | null; organisationId: string; userId: string;
  companies: { id: string; name: string }[]; properties: { id: string; name: string }[]; profiles: Pick<Profile, 'id' | 'name'>[]; onSaved: () => void;
}) {
  const [form, setForm] = useState<VehicleForm>(EMPTY_VEHICLE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (vehicle) {
      setForm({
        asset_type: vehicle.asset_type, registration_number: vehicle.registration_number, internal_number: vehicle.internal_number, name: vehicle.name,
        make: vehicle.make, model: vehicle.model, model_year: vehicle.model_year ? String(vehicle.model_year) : '', vin: vehicle.vin, serial_number: vehicle.serial_number,
        company_id: vehicle.company_id || '', responsible_user_id: vehicle.responsible_user_id || '', property_id: vehicle.property_id || '',
        purchase_date: vehicle.purchase_date || '', purchase_price: vehicle.purchase_price ? String(vehicle.purchase_price) : '', financing_type: vehicle.financing_type,
        financing_notes: vehicle.financing_notes, current_odometer: String(vehicle.current_odometer), odometer_unit: vehicle.odometer_unit, engine_hours: String(vehicle.engine_hours),
        fuel_type: vehicle.fuel_type, registration_status: vehicle.registration_status, status: vehicle.status, notes: vehicle.notes,
      });
    } else {
      setForm(EMPTY_VEHICLE_FORM);
    }
    setError('');
  }, [open, vehicle]);

  const showOdometer = ASSET_TYPES_WITH_ODOMETER.includes(form.asset_type);
  const showEngineHours = ASSET_TYPES_WITH_ENGINE_HOURS.includes(form.asset_type);
  const showRegistration = ASSET_TYPES_WITH_REGISTRATION.includes(form.asset_type);

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Ange ett namn.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        organisation_id: organisationId, asset_type: form.asset_type, registration_number: form.registration_number.trim(), internal_number: form.internal_number.trim(),
        name: form.name.trim(), make: form.make.trim(), model: form.model.trim(), model_year: form.model_year ? Number(form.model_year) : null,
        vin: form.vin.trim(), serial_number: form.serial_number.trim(), company_id: form.company_id || null, responsible_user_id: form.responsible_user_id || null,
        property_id: form.property_id || null, purchase_date: form.purchase_date || null, purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        financing_type: form.financing_type, financing_notes: form.financing_notes.trim(), current_odometer: Number(form.current_odometer) || 0, odometer_unit: form.odometer_unit,
        engine_hours: Number(form.engine_hours) || 0, fuel_type: form.fuel_type, registration_status: form.registration_status, status: form.status, notes: form.notes.trim(),
      };
      if (vehicle) {
        const { error: err } = await supabase.from('vihem_fleet_vehicles').update(payload).eq('id', vehicle.id);
        if (err) throw err;
        if (vehicle.status !== form.status) {
          await supabase.from('vihem_fleet_events').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, event_type: 'status_changed', summary: `Status ändrad: ${STATUS_LABELS[vehicle.status]} -> ${STATUS_LABELS[form.status as FleetVehicleStatus]}`, actor_id: userId });
        }
      } else {
        const { data, error: err } = await supabase.from('vihem_fleet_vehicles').insert({ ...payload, created_by: userId }).select('id').single();
        if (err) throw err;
        await supabase.from('vihem_fleet_events').insert({ organisation_id: organisationId, vehicle_id: data.id, event_type: 'created', summary: 'Tillgång skapad', actor_id: userId });
      }
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={vehicle ? 'Redigera tillgång' : 'Ny tillgång'} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Typ" value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value as FleetAssetType })} options={ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }))} />
          <Input label="Namn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="T.ex. Ford Transit" />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {showRegistration && <Input label="Registreringsnummer" value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value.toUpperCase() })} />}
          <Input label="Internt inventarienummer" value={form.internal_number} onChange={(e) => setForm({ ...form, internal_number: e.target.value })} />
          <Select label="Ägande bolag" value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })} options={[{ value: '', label: 'Inget valt' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Märke" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
          <Input label="Modell" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <Input label="Årsmodell" type="number" value={form.model_year} onChange={(e) => setForm({ ...form, model_year: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="VIN/chassinummer" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
          <Input label="Serienummer" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Ansvarig person" value={form.responsible_user_id} onChange={(e) => setForm({ ...form, responsible_user_id: e.target.value })} options={[{ value: '', label: 'Ingen vald' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} />
          <Select label="Placering" value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })} options={[{ value: '', label: 'Ingen vald' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]} />
          <Select label="Drivmedel" value={form.fuel_type} onChange={(e) => setForm({ ...form, fuel_type: e.target.value })} options={Object.entries(FUEL_LABELS).map(([value, label]) => ({ value, label }))} />
        </div>
        {showOdometer && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Aktuell mätarställning" type="number" value={form.current_odometer} onChange={(e) => setForm({ ...form, current_odometer: e.target.value })} />
            <Select label="Enhet" value={form.odometer_unit} onChange={(e) => setForm({ ...form, odometer_unit: e.target.value })} options={[{ value: 'mil', label: 'Mil' }, { value: 'km', label: 'Km' }]} />
          </div>
        )}
        {showEngineHours && <Input label="Maskintimmar" type="number" value={form.engine_hours} onChange={(e) => setForm({ ...form, engine_hours: e.target.value })} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Inköpsdatum" type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
          <Input label="Inköpspris" type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Leasing/finansiering" value={form.financing_type} onChange={(e) => setForm({ ...form, financing_type: e.target.value })} options={Object.entries(FINANCING_LABELS).map(([value, label]) => ({ value, label }))} />
          {showRegistration && <Select label="Registreringsstatus" value={form.registration_status} onChange={(e) => setForm({ ...form, registration_status: e.target.value })} options={[{ value: 'registered', label: 'Registrerad' }, { value: 'deregistered', label: 'Avregistrerad' }, { value: 'not_applicable', label: 'Ej tillämpligt' }]} />}
        </div>
        <Textarea label="Anteckningar" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Avbryt</Button>
          <Button onClick={handleSave} loading={saving}>Spara</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Tillgångskort (detaljvy) ─────────────────────────────────────────────

type DetailTab = 'overview' | 'workorders' | 'damage' | 'service' | 'inspections' | 'meters' | 'tires' | 'documents' | 'costs' | 'telematics' | 'history';

function VehicleDetail({ vehicle, isAdmin, userId, organisationId, companies, properties, profiles, profilesById, onBack, onChanged, onNavigate }: {
  vehicle: FleetVehicle; isAdmin: boolean; userId: string; organisationId: string; companies: { id: string; name: string }[]; properties: { id: string; name: string }[];
  profiles: Pick<Profile, 'id' | 'name'>[]; profilesById: Map<string, Pick<Profile, 'id' | 'name'>>; onBack: () => void; onChanged: () => void; onNavigate: (page: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [damageReports, setDamageReports] = useState<FleetDamageReport[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [serviceSchedules, setServiceSchedules] = useState<FleetServiceSchedule[]>([]);
  const [serviceRecords, setServiceRecords] = useState<FleetServiceRecord[]>([]);
  const [inspections, setInspections] = useState<FleetInspection[]>([]);
  const [meterReadings, setMeterReadings] = useState<FleetMeterReading[]>([]);
  const [tires, setTires] = useState<FleetTire[]>([]);
  const [costs, setCosts] = useState<FleetCost[]>([]);
  const [telematicsDevice, setTelematicsDevice] = useState<FleetTelematicsDevice | null>(null);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportModal, setReportModal] = useState(false);
  const [qrModal, setQrModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [dmg, wo, sched, srec, insp, meters, tir, cst, dev, evt] = await Promise.all([
      supabase.from('vihem_fleet_damage_reports').select('*').eq('vehicle_id', vehicle.id).order('created_at', { ascending: false }),
      supabase.from('vihem_work_orders').select('*').eq('vehicle_id', vehicle.id).order('created_at', { ascending: false }),
      supabase.from('vihem_fleet_service_schedules').select('*').eq('vehicle_id', vehicle.id).eq('active', true).order('name'),
      supabase.from('vihem_fleet_service_records').select('*').eq('vehicle_id', vehicle.id).order('performed_at', { ascending: false }),
      supabase.from('vihem_fleet_inspections').select('*').eq('vehicle_id', vehicle.id).eq('active', true).order('next_inspection_date'),
      supabase.from('vihem_fleet_meter_readings').select('*').eq('vehicle_id', vehicle.id).order('recorded_at', { ascending: false }).limit(100),
      supabase.from('vihem_fleet_tires').select('*').eq('vehicle_id', vehicle.id).order('created_at', { ascending: false }),
      isAdmin ? supabase.from('vihem_fleet_costs').select('*').eq('vehicle_id', vehicle.id).order('cost_date', { ascending: false }) : Promise.resolve({ data: [] }),
      supabase.from('vihem_fleet_telematics_devices').select('*').eq('vehicle_id', vehicle.id).eq('active', true).maybeSingle(),
      supabase.from('vihem_fleet_events').select('*').eq('vehicle_id', vehicle.id).order('created_at', { ascending: false }).limit(60),
    ]);
    setDamageReports((dmg.data || []) as FleetDamageReport[]);
    setWorkOrders((wo.data || []) as WorkOrder[]);
    setServiceSchedules((sched.data || []) as FleetServiceSchedule[]);
    setServiceRecords((srec.data || []) as FleetServiceRecord[]);
    setInspections((insp.data || []) as FleetInspection[]);
    setMeterReadings((meters.data || []) as FleetMeterReading[]);
    setTires((tir.data || []) as FleetTire[]);
    setCosts((cst.data || []) as FleetCost[]);
    setTelematicsDevice((dev.data || null) as FleetTelematicsDevice | null);
    setEvents((evt.data || []) as FleetEvent[]);
    setLoading(false);
  }, [vehicle.id, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const reload = () => { load(); onChanged(); };

  const openDamage = damageReports.filter((d) => d.status === 'open');
  const openWo = workOrders.filter((w) => w.status !== 'completed' && w.status !== 'cancelled');
  const nextInspection = inspections.filter((i) => i.next_inspection_date).sort((a, b) => (a.next_inspection_date || '').localeCompare(b.next_inspection_date || ''))[0];
  const nextService = serviceSchedules.filter((s) => s.next_due_date).sort((a, b) => (a.next_due_date || '').localeCompare(b.next_due_date || ''))[0];

  const showQr = async () => {
    const url = `${window.location.origin}${window.location.pathname}?fleet_vehicle=${vehicle.id}`;
    const data = await QRCode.toDataURL(url, { width: 240, margin: 1 });
    setQrDataUrl(data);
    setQrModal(true);
  };
  const printQr = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>${vehicle.name}</title><style>body{font-family:Arial;text-align:center;padding:24px}.label{width:280px;border:1px solid #ddd;padding:16px;margin:0 auto}img{width:200px}small{display:block;color:#475569;margin-top:8px}</style></head><body><div class="label"><strong>${vehicle.registration_number || vehicle.internal_number}</strong><br/>${vehicle.name}<img src="${qrDataUrl}" /><small>Skanna för att öppna i VI-HEM Fleet</small></div><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  const TABS: { key: DetailTab; label: string; icon: any }[] = [
    { key: 'overview', label: 'Översikt', icon: Activity },
    { key: 'workorders', label: 'Arbetsordrar', icon: ClipboardList },
    { key: 'damage', label: 'Skador & fel', icon: AlertTriangle },
    { key: 'service', label: 'Service', icon: Wrench },
    { key: 'inspections', label: 'Besiktningar', icon: Calendar },
    { key: 'meters', label: 'Mätarhistorik', icon: Gauge },
    ...(ASSET_TYPES_WITH_TIRES.includes(vehicle.asset_type) ? [{ key: 'tires' as DetailTab, label: 'Däck', icon: Circle }] : []),
    { key: 'documents', label: 'Dokument', icon: FileText },
    ...(isAdmin ? [{ key: 'costs' as DetailTab, label: 'Kostnader', icon: Banknote }] : []),
    { key: 'telematics', label: 'Telematik', icon: Radio },
    { key: 'history', label: 'Historik', icon: History },
  ];

  if (loading) return <div className="mx-auto max-w-7xl px-4 py-6"><LoadingPage /></div>;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Tillbaka till registret</button>

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {vehicle.registration_number && <span className="rounded bg-slate-900 px-2 py-1 font-mono text-sm font-bold text-white">{vehicle.registration_number}</span>}
              <h1 className="text-xl font-bold text-slate-900">{vehicle.name}</h1>
              <Badge className={STATUS_CLASS[vehicle.status]}>{STATUS_LABELS[vehicle.status]}</Badge>
            </div>
            <p className="text-sm text-slate-500">{ASSET_TYPE_LABELS[vehicle.asset_type]} · {vehicle.make} {vehicle.model} {vehicle.model_year || ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={showQr}><QrCode className="h-4 w-4" /> QR-etikett</Button>
            <Button size="sm" onClick={() => setReportModal(true)}><Camera className="h-4 w-4" /> Rapportera skada/fel</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ASSET_TYPES_WITH_ODOMETER.includes(vehicle.asset_type) ? { label: 'Mätarställning', value: `${formatNumber(vehicle.current_odometer)} ${vehicle.odometer_unit}` } : null,
            ASSET_TYPES_WITH_ENGINE_HOURS.includes(vehicle.asset_type) ? { label: 'Maskintimmar', value: `${formatNumber(vehicle.engine_hours)} h` } : null,
            { label: 'Nästa besiktning', value: nextInspection ? fmtDate(nextInspection.next_inspection_date) : '-' },
            { label: 'Nästa service', value: nextService ? fmtDate(nextService.next_due_date) : '-' },
            { label: 'Öppna fel', value: String(openDamage.length) },
            { label: 'Öppna arbetsordrar', value: String(openWo.length) },
          ].filter(Boolean).map((cell: any) => (
            <div key={cell.label} className="bg-white p-3"><p className="text-xs text-slate-500">{cell.label}</p><p className="font-semibold text-slate-900">{cell.value}</p></div>
          ))}
        </div>
      </Card>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab vehicle={vehicle} companies={companies} properties={properties} profilesById={profilesById} openDamage={openDamage} openWo={openWo} serviceSchedules={serviceSchedules} inspections={inspections} organisationId={organisationId} userId={userId} isAdmin={isAdmin} onChanged={reload} />}
      {tab === 'workorders' && <WorkOrdersTab vehicle={vehicle} workOrders={workOrders} organisationId={organisationId} userId={userId} onNavigate={onNavigate} onChanged={reload} />}
      {tab === 'damage' && <DamageTab vehicle={vehicle} reports={damageReports} isAdmin={isAdmin} organisationId={organisationId} onChanged={reload} onNavigate={onNavigate} />}
      {tab === 'service' && <ServiceTab vehicle={vehicle} schedules={serviceSchedules} records={serviceRecords} isAdmin={isAdmin} organisationId={organisationId} userId={userId} onChanged={reload} />}
      {tab === 'inspections' && <InspectionsTab vehicle={vehicle} inspections={inspections} isAdmin={isAdmin} organisationId={organisationId} userId={userId} onChanged={reload} />}
      {tab === 'meters' && <MetersTab vehicle={vehicle} readings={meterReadings} profilesById={profilesById} organisationId={organisationId} onChanged={reload} />}
      {tab === 'tires' && <TiresTab vehicle={vehicle} tires={tires} organisationId={organisationId} userId={userId} onChanged={reload} />}
      {tab === 'documents' && <DocumentsTab vehicle={vehicle} organisationId={organisationId} userId={userId} onChanged={reload} />}
      {tab === 'costs' && isAdmin && <CostsTab vehicle={vehicle} costs={costs} organisationId={organisationId} userId={userId} onChanged={reload} />}
      {tab === 'telematics' && <TelematicsTab vehicle={vehicle} device={telematicsDevice} isAdmin={isAdmin} organisationId={organisationId} userId={userId} onChanged={reload} />}
      {tab === 'history' && <HistoryTab events={events} profilesById={profilesById} />}

      <DamageReportModal open={reportModal} onClose={() => setReportModal(false)} vehicle={vehicle} organisationId={organisationId} userId={userId} onSaved={() => { setReportModal(false); reload(); }} />

      <Modal open={qrModal} onClose={() => setQrModal(false)} title="QR-etikett">
        <div className="space-y-4 text-center">
          {qrDataUrl && <img src={qrDataUrl} alt="QR" className="mx-auto h-48 w-48" />}
          <p className="text-sm text-slate-500">Skanna för att öppna {vehicleLabel(vehicle)} direkt i VI-HEM.</p>
          <div className="flex justify-center gap-2"><Button variant="secondary" onClick={() => setQrModal(false)}>Stäng</Button><Button onClick={printQr}>Skriv ut</Button></div>
        </div>
      </Modal>
    </div>
  );
}

// ── Översikt ───────────────────────────────────────────────────────────

function OverviewTab({ vehicle, companies, properties, profilesById, openDamage, openWo, serviceSchedules, inspections, organisationId, userId, isAdmin, onChanged }: {
  vehicle: FleetVehicle; companies: { id: string; name: string }[]; properties: { id: string; name: string }[]; profilesById: Map<string, Pick<Profile, 'id' | 'name'>>;
  openDamage: FleetDamageReport[]; openWo: WorkOrder[]; serviceSchedules: FleetServiceSchedule[]; inspections: FleetInspection[]; organisationId: string; userId: string; isAdmin: boolean; onChanged: () => void;
}) {
  const [creatingLocation, setCreatingLocation] = useState(false);
  const company = companies.find((c) => c.id === vehicle.company_id);
  const property = properties.find((p) => p.id === vehicle.property_id);
  const responsible = vehicle.responsible_user_id ? profilesById.get(vehicle.responsible_user_id) : null;

  const createInventoryLocation = async () => {
    setCreatingLocation(true);
    try {
      const { data, error } = await supabase.from('vihem_inventory_locations').insert({ organisation_id: organisationId, name: `Fordon: ${vehicle.name}`, type: 'vehicle', code: vehicle.registration_number || vehicle.internal_number, created_by: userId }).select('id').single();
      if (error) throw error;
      const { error: updErr } = await supabase.from('vihem_fleet_vehicles').update({ inventory_location_id: data.id }).eq('id', vehicle.id);
      if (updErr) throw updErr;
      onChanged();
    } catch (err) {
      window.alert(describeError(err));
    } finally {
      setCreatingLocation(false);
    }
  };

  const fields: { label: string; value: string }[] = [
    { label: 'Ägande bolag', value: company?.name || '-' },
    { label: 'Ansvarig person', value: responsible?.name || '-' },
    { label: 'Placering', value: property?.name || '-' },
    { label: 'VIN/chassinummer', value: vehicle.vin || '-' },
    { label: 'Serienummer', value: vehicle.serial_number || '-' },
    { label: 'Drivmedel', value: FUEL_LABELS[vehicle.fuel_type] || vehicle.fuel_type },
    { label: 'Inköpsdatum', value: fmtDate(vehicle.purchase_date) },
    { label: 'Inköpspris', value: vehicle.purchase_price ? `${formatNumber(vehicle.purchase_price)} kr` : '-' },
    { label: 'Finansiering', value: FINANCING_LABELS[vehicle.financing_type] || vehicle.financing_type },
    { label: 'Registreringsstatus', value: vehicle.registration_status === 'registered' ? 'Registrerad' : vehicle.registration_status === 'deregistered' ? 'Avregistrerad' : 'Ej tillämpligt' },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h3 className="mb-4 font-semibold text-slate-900">Fakta</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f.label}><dt className="text-xs text-slate-500">{f.label}</dt><dd className="font-medium text-slate-800">{f.value}</dd></div>
          ))}
        </dl>
        {vehicle.notes && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">Anteckningar</p><p className="whitespace-pre-wrap text-sm text-slate-700">{vehicle.notes}</p></div>}
      </Card>
      <div className="space-y-4">
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><Wrench className="h-4 w-4" /> Ombord-lager</h3>
          {vehicle.inventory_location_id ? (
            <p className="text-sm text-slate-600">Fordonet har en kopplad lagerplats. Hantera bestånd under Lager & inköp.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-500">Skapa en lagerplats för fordonet så att material/verktyg ombord kan hanteras i det vanliga lagersystemet.</p>
              {isAdmin && <Button size="sm" variant="secondary" onClick={createInventoryLocation} loading={creatingLocation}>Skapa lagerplats</Button>}
            </>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 font-semibold text-slate-900">Status</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Öppna skador/fel</span><span className="font-semibold">{openDamage.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Öppna arbetsordrar</span><span className="font-semibold">{openWo.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Serviceplaner</span><span className="font-semibold">{serviceSchedules.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Kontroller</span><span className="font-semibold">{inspections.length}</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Arbetsordrar ───────────────────────────────────────────────────────

function WorkOrdersTab({ vehicle, workOrders, organisationId, userId, onNavigate, onChanged }: {
  vehicle: FleetVehicle; workOrders: WorkOrder[]; organisationId: string; userId: string; onNavigate: (page: string) => void; onChanged: () => void;
}) {
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!title.trim()) { setError('Ange en titel.'); return; }
    setSaving(true);
    setError('');
    try {
      const { error: err } = await supabase.from('vihem_work_orders').insert({
        title: title.trim(), description: description.trim(), category: 'Fordon', priority, status: 'new',
        vehicle_id: vehicle.id, property_id: vehicle.property_id, assigned_to_ids: [], checklist: [], materials: [], attachments: [],
        created_by: userId, organisation_id: organisationId,
      });
      if (err) throw err;
      await supabase.from('vihem_fleet_events').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, event_type: 'work_order_created', summary: `Arbetsorder skapad: ${title.trim()}`, actor_id: userId });
      setModal(false); setTitle(''); setDescription(''); setPriority('normal');
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">Arbetsordrar</h3>
        <Button size="sm" onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Skapa arbetsorder</Button>
      </div>
      {workOrders.length ? (
        <div className="divide-y divide-slate-100">
          {workOrders.map((wo) => (
            <button key={wo.id} onClick={() => onNavigate('workorder/' + wo.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800">{wo.title}</p>
                <p className="text-xs text-slate-500">{fmtDate(wo.created_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-slate-100 text-slate-600">{WO_PRIORITY_LABELS[wo.priority]}</Badge>
                <Badge className="bg-blue-100 text-blue-700">{WO_STATUS_LABELS[wo.status]}</Badge>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </div>
            </button>
          ))}
        </div>
      ) : <EmptyState icon={<ClipboardList className="w-10 h-10" />} title="Inga arbetsordrar" description="Skapa en arbetsorder kopplad till detta fordon." />}

      <Modal open={modal} onClose={() => setModal(false)} title="Skapa arbetsorder">
        <div className="space-y-4">
          <Input label="Titel" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`T.ex. ${vehicleLabel(vehicle)} -- Byt bromsbelägg`} />
          <Select label="Prioritet" value={priority} onChange={(e) => setPriority(e.target.value)} options={Object.entries(WO_PRIORITY_LABELS).map(([value, label]) => ({ value, label: String(label) }))} />
          <Textarea label="Beskrivning" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal(false)}>Avbryt</Button><Button onClick={create} loading={saving}>Skapa</Button></div>
        </div>
      </Modal>
    </Card>
  );
}

// ── Skador & fel ───────────────────────────────────────────────────────

function DamageTab({ vehicle, reports, isAdmin, organisationId, onChanged, onNavigate }: {
  vehicle: FleetVehicle; reports: FleetDamageReport[]; isAdmin: boolean; organisationId: string; onChanged: () => void; onNavigate: (page: string) => void;
}) {
  const [converting, setConverting] = useState<string | null>(null);

  const convert = async (report: FleetDamageReport) => {
    setConverting(report.id);
    try {
      const { data, error } = await supabase.rpc('vihem_fleet_convert_damage_to_work_order', { p_damage_report_id: report.id });
      if (error) throw error;
      onChanged();
      if (data) onNavigate('workorder/' + data);
    } catch (err) {
      window.alert(describeError(err));
    } finally {
      setConverting(null);
    }
  };

  const resolve = async (report: FleetDamageReport) => {
    const { error } = await supabase.from('vihem_fleet_damage_reports').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', report.id);
    if (error) window.alert(describeError(error)); else onChanged();
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Skador & fel</h3></div>
      {reports.length ? (
        <div className="divide-y divide-slate-100">
          {reports.map((d) => (
            <div key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge className={SEVERITY_CLASS[d.severity]}>{SEVERITY_LABELS[d.severity]}</Badge>
                    {!d.usable && <Badge className="bg-red-100 text-red-700">Ej användbar</Badge>}
                    <Badge className={d.status === 'open' ? 'bg-amber-100 text-amber-700' : d.status === 'converted' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}>
                      {d.status === 'open' ? 'Öppen' : d.status === 'converted' ? 'Omvandlad' : d.status === 'resolved' ? 'Åtgärdad' : 'Avfärdad'}
                    </Badge>
                    <span className="text-xs text-slate-400">{fmtDateTime(d.created_at)}</span>
                  </div>
                  <p className="text-sm text-slate-700">{d.description}</p>
                  {d.photos?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(d.photos as unknown as AttachmentItem[]).map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.name} className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" /></a>)}
                    </div>
                  )}
                </div>
                {d.status === 'open' && isAdmin && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => resolve(d)}>Markera åtgärdad</Button>
                    <Button size="sm" onClick={() => convert(d)} loading={converting === d.id}>Skapa arbetsorder</Button>
                  </div>
                )}
                {d.work_order_id && <Button size="sm" variant="secondary" onClick={() => onNavigate('workorder/' + d.work_order_id)}>Visa arbetsorder</Button>}
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={<AlertTriangle className="w-10 h-10" />} title="Inga skador rapporterade" description="Använd Rapportera skada/fel-knappen ovan." />}
    </Card>
  );
}

function DamageReportModal({ open, onClose, vehicle, organisationId, userId, onSaved }: {
  open: boolean; onClose: () => void; vehicle: FleetVehicle; organisationId: string; userId: string; onSaved: () => void;
}) {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FleetDamageSeverity>('should_fix');
  const [usable, setUsable] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setDescription(''); setSeverity('should_fix'); setUsable(true); setFiles([]); setError(''); } }, [open]);

  const save = async () => {
    if (!description.trim()) { setError('Beskriv skadan/felet.'); return; }
    setSaving(true);
    setError('');
    try {
      const photos: AttachmentItem[] = [];
      for (const file of files) photos.push(await uploadFleetFile(file, 'vihem-fleet-images', organisationId, 'skador', userId, 'fleet_damage_photo', vehicle.id));
      const { error: err } = await supabase.from('vihem_fleet_damage_reports').insert({
        organisation_id: organisationId, vehicle_id: vehicle.id, reported_by: userId, description: description.trim(), severity, usable, photos,
      });
      if (err) throw err;
      if (severity === 'no_use' || !usable) {
        await supabase.from('vihem_fleet_vehicles').update({ status: 'driving_ban' }).eq('id', vehicle.id).eq('status', 'in_service');
      }
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Rapportera skada/fel -- ${vehicleLabel(vehicle)}`}>
      <div className="space-y-4">
        <Textarea label="Beskrivning" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Vad är fel? Var på fordonet?" />
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">Foto</label>
          <input type="file" accept="image/*" multiple capture="environment" onChange={(e) => setFiles(Array.from(e.target.files || []))} className="block w-full text-sm text-slate-600" />
        </div>
        <Select label="Allvarlighetsgrad" value={severity} onChange={(e) => setSeverity(e.target.value as FleetDamageSeverity)} options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))} />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={usable} onChange={(e) => setUsable(e.target.checked)} className="h-4 w-4 rounded border-slate-300" /> Fordonet är fortfarande användbart
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Avbryt</Button><Button onClick={save} loading={saving}>Rapportera</Button></div>
      </div>
    </Modal>
  );
}

// ── Service ────────────────────────────────────────────────────────────

type ScheduleForm = { name: string; interval_km: string; interval_hours: string; interval_months: string; notes: string };
const EMPTY_SCHEDULE_FORM: ScheduleForm = { name: '', interval_km: '', interval_hours: '', interval_months: '', notes: '' };

function ServiceTab({ vehicle, schedules, records, isAdmin, organisationId, userId, onChanged }: {
  vehicle: FleetVehicle; schedules: FleetServiceSchedule[]; records: FleetServiceRecord[]; isAdmin: boolean; organisationId: string; userId: string; onChanged: () => void;
}) {
  const [scheduleModal, setScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>(EMPTY_SCHEDULE_FORM);
  const [recordModal, setRecordModal] = useState<FleetServiceSchedule | 'adhoc' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const saveSchedule = async () => {
    if (!scheduleForm.name.trim() || (!scheduleForm.interval_km && !scheduleForm.interval_hours && !scheduleForm.interval_months)) { setError('Ange namn och minst ett intervall.'); return; }
    setSaving(true); setError('');
    try {
      const interval_km = scheduleForm.interval_km ? Number(scheduleForm.interval_km) : null;
      const interval_hours = scheduleForm.interval_hours ? Number(scheduleForm.interval_hours) : null;
      const interval_months = scheduleForm.interval_months ? Number(scheduleForm.interval_months) : null;
      const next_due_date = interval_months ? new Date(Date.now() + interval_months * 30 * 86400000).toISOString().slice(0, 10) : null;
      const next_due_odometer = interval_km ? vehicle.current_odometer + interval_km : null;
      const next_due_hours = interval_hours ? vehicle.engine_hours + interval_hours : null;
      const { error: err } = await supabase.from('vihem_fleet_service_schedules').insert({
        organisation_id: organisationId, vehicle_id: vehicle.id, name: scheduleForm.name.trim(), interval_km, interval_hours, interval_months,
        next_due_date, next_due_odometer, next_due_hours, notes: scheduleForm.notes.trim(), created_by: userId,
      });
      if (err) throw err;
      setScheduleModal(false); setScheduleForm(EMPTY_SCHEDULE_FORM); onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Serviceplaner</h3>
          <div className="flex gap-2">
            {isAdmin && <Button size="sm" variant="secondary" onClick={() => setScheduleModal(true)}><Plus className="h-4 w-4" /> Ny plan</Button>}
            <Button size="sm" onClick={() => setRecordModal('adhoc')}>Registrera service</Button>
          </div>
        </div>
        {schedules.length ? (
          <div className="divide-y divide-slate-100">
            {schedules.map((s) => {
              const dayU = urgencyFromDays(daysUntil(s.next_due_date));
              const kmRemaining = s.next_due_odometer ? s.next_due_odometer - vehicle.current_odometer : null;
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {[s.interval_km ? `${formatNumber(s.interval_km)} ${vehicle.odometer_unit}` : null, s.interval_hours ? `${formatNumber(s.interval_hours)} h` : null, s.interval_months ? `${s.interval_months} mån` : null].filter(Boolean).join(' · ')}
                      {s.next_due_date && ` -- nästa: ${fmtDate(s.next_due_date)}`}
                      {kmRemaining !== null && ` (${formatNumber(kmRemaining)} ${vehicle.odometer_unit} kvar)`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={URGENCY_CLASS[dayU]}>{URGENCY_LABEL[dayU]}</Badge>
                    <Button size="sm" variant="secondary" onClick={() => setRecordModal(s)}>Registrera utförd</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState icon={<Wrench className="w-10 h-10" />} title="Inga serviceplaner" description="Lägg upp en plan baserad på datum, km eller maskintimmar." />}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Servicehistorik</h3></div>
        {records.length ? (
          <div className="divide-y divide-slate-100">
            {records.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0"><p className="font-medium text-slate-800">{r.description || 'Service'}</p><p className="text-xs text-slate-500">{fmtDate(r.performed_at)} · {r.performed_by_text || '-'}{r.odometer ? ` · ${formatNumber(r.odometer)} ${vehicle.odometer_unit}` : ''}</p></div>
                {r.cost != null && <span className="text-sm font-semibold text-slate-700">{formatNumber(r.cost)} kr</span>}
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<History className="w-10 h-10" />} title="Ingen servicehistorik ännu" />}
      </Card>

      <Modal open={scheduleModal} onClose={() => setScheduleModal(false)} title="Ny serviceplan">
        <div className="space-y-4">
          <Input label="Namn" value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} placeholder="T.ex. Motorservice" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label={`Intervall (${vehicle.odometer_unit})`} type="number" value={scheduleForm.interval_km} onChange={(e) => setScheduleForm({ ...scheduleForm, interval_km: e.target.value })} />
            <Input label="Intervall (maskintimmar)" type="number" value={scheduleForm.interval_hours} onChange={(e) => setScheduleForm({ ...scheduleForm, interval_hours: e.target.value })} />
            <Input label="Intervall (månader)" type="number" value={scheduleForm.interval_months} onChange={(e) => setScheduleForm({ ...scheduleForm, interval_months: e.target.value })} />
          </div>
          <p className="text-xs text-slate-500">Villkoret som inträffar först utlöser servicebehov.</p>
          <Textarea label="Anteckningar" value={scheduleForm.notes} onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setScheduleModal(false)}>Avbryt</Button><Button onClick={saveSchedule} loading={saving}>Spara</Button></div>
        </div>
      </Modal>

      <ServiceRecordModal open={recordModal !== null} onClose={() => setRecordModal(null)} vehicle={vehicle} schedule={recordModal === 'adhoc' ? null : recordModal} organisationId={organisationId} userId={userId} onSaved={() => { setRecordModal(null); onChanged(); }} />
    </div>
  );
}

function ServiceRecordModal({ open, onClose, vehicle, schedule, organisationId, userId, onSaved }: {
  open: boolean; onClose: () => void; vehicle: FleetVehicle; schedule: FleetServiceSchedule | null; organisationId: string; userId: string; onSaved: () => void;
}) {
  const [performedAt, setPerformedAt] = useState(new Date().toISOString().slice(0, 10));
  const [odometer, setOdometer] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [cost, setCost] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setPerformedAt(new Date().toISOString().slice(0, 10)); setOdometer(String(vehicle.current_odometer || '')); setPerformedBy(''); setCost(''); setDescription(schedule?.name || ''); setError(''); } }, [open, schedule, vehicle.current_odometer]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const odo = odometer ? Number(odometer) : null;
      const { error: err } = await supabase.from('vihem_fleet_service_records').insert({
        organisation_id: organisationId, vehicle_id: vehicle.id, schedule_id: schedule?.id || null, performed_at: performedAt, odometer: odo,
        performed_by_text: performedBy.trim(), cost: cost ? Number(cost) : null, description: description.trim(), created_by: userId,
      });
      if (err) throw err;
      if (schedule) {
        const next_due_date = schedule.interval_months ? new Date(new Date(performedAt).getTime() + schedule.interval_months * 30 * 86400000).toISOString().slice(0, 10) : null;
        const next_due_odometer = schedule.interval_km && odo != null ? odo + schedule.interval_km : null;
        await supabase.from('vihem_fleet_service_schedules').update({ last_done_at: performedAt, last_done_odometer: odo, next_due_date, next_due_odometer }).eq('id', schedule.id);
      }
      if (odo != null && odo >= vehicle.current_odometer) await supabase.from('vihem_fleet_vehicles').update({ current_odometer: odo }).eq('id', vehicle.id);
      if (cost) await supabase.from('vihem_fleet_costs').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, cost_type: 'service', amount: Number(cost), cost_date: performedAt, description: description.trim(), created_by: userId });
      await supabase.from('vihem_fleet_events').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, event_type: 'service_recorded', summary: description.trim() || 'Service registrerad', actor_id: userId });
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Registrera utförd service">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Utfört datum" type="date" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
          <Input label={`Mätarställning (${vehicle.odometer_unit})`} type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Utförd av" value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder="Verkstad/person" />
          <Input label="Kostnad (kr)" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <Textarea label="Beskrivning" value={description} onChange={(e) => setDescription(e.target.value)} />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Avbryt</Button><Button onClick={save} loading={saving}>Spara</Button></div>
      </div>
    </Modal>
  );
}

// ── Besiktningar ───────────────────────────────────────────────────────

type InspectionForm = { inspection_type: string; interval_months: string; next_inspection_date: string; notes: string };
const EMPTY_INSPECTION_FORM: InspectionForm = { inspection_type: '', interval_months: '', next_inspection_date: '', notes: '' };

function InspectionsTab({ vehicle, inspections, isAdmin, organisationId, userId, onChanged }: {
  vehicle: FleetVehicle; inspections: FleetInspection[]; isAdmin: boolean; organisationId: string; userId: string; onChanged: () => void;
}) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<InspectionForm>(EMPTY_INSPECTION_FORM);
  const [resultModal, setResultModal] = useState<FleetInspection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!form.inspection_type.trim()) { setError('Ange typ av kontroll.'); return; }
    setSaving(true); setError('');
    try {
      const { error: err } = await supabase.from('vihem_fleet_inspections').insert({
        organisation_id: organisationId, vehicle_id: vehicle.id, inspection_type: form.inspection_type.trim(),
        interval_months: form.interval_months ? Number(form.interval_months) : null, next_inspection_date: form.next_inspection_date || null,
        notes: form.notes.trim(), created_by: userId,
      });
      if (err) throw err;
      setModal(false); setForm(EMPTY_INSPECTION_FORM); onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">Besiktningar & återkommande kontroller</h3>
        {isAdmin && <Button size="sm" onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Ny kontroll</Button>}
      </div>
      {inspections.length ? (
        <div className="divide-y divide-slate-100">
          {inspections.map((i) => {
            const u = urgencyFromDays(daysUntil(i.next_inspection_date));
            return (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{i.inspection_type}</p>
                  <p className="text-xs text-slate-500">Senast: {fmtDate(i.last_inspection_date)} · Nästa: {fmtDate(i.next_inspection_date)}{i.result && ` · Resultat: ${i.result === 'passed' ? 'Godkänd' : i.result === 'passed_with_remarks' ? 'Godkänd med anmärkning' : 'Underkänd'}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={URGENCY_CLASS[u]}>{URGENCY_LABEL[u]}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setResultModal(i)}>Registrera resultat</Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyState icon={<Calendar className="w-10 h-10" />} title="Inga kontroller" description="Lägg till kontrollbesiktning, kranbesiktning, brandsläckare m.m." />}

      <Modal open={modal} onClose={() => setModal(false)} title="Ny kontroll">
        <div className="space-y-4">
          <Input label="Typ av kontroll" value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })} placeholder="T.ex. Kontrollbesiktning, Kranbesiktning, Brandsläckare" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Intervall (månader)" type="number" value={form.interval_months} onChange={(e) => setForm({ ...form, interval_months: e.target.value })} />
            <Input label="Nästa kontroll" type="date" value={form.next_inspection_date} onChange={(e) => setForm({ ...form, next_inspection_date: e.target.value })} />
          </div>
          <Textarea label="Anteckning" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal(false)}>Avbryt</Button><Button onClick={create} loading={saving}>Spara</Button></div>
        </div>
      </Modal>

      <InspectionResultModal open={resultModal !== null} onClose={() => setResultModal(null)} vehicle={vehicle} inspection={resultModal} organisationId={organisationId} userId={userId} onSaved={() => { setResultModal(null); onChanged(); }} />
    </Card>
  );
}

function InspectionResultModal({ open, onClose, vehicle, inspection, organisationId, userId, onSaved }: {
  open: boolean; onClose: () => void; vehicle: FleetVehicle; inspection: FleetInspection | null; organisationId: string; userId: string; onSaved: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState('passed');
  const [performedBy, setPerformedBy] = useState('');
  const [cost, setCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setDate(new Date().toISOString().slice(0, 10)); setResult('passed'); setPerformedBy(''); setCost(''); setError(''); } }, [open]);

  const save = async () => {
    if (!inspection) return;
    setSaving(true); setError('');
    try {
      const next = inspection.interval_months ? new Date(new Date(date).getTime() + inspection.interval_months * 30 * 86400000).toISOString().slice(0, 10) : null;
      const { error: err } = await supabase.from('vihem_fleet_inspections').update({ last_inspection_date: date, next_inspection_date: next, result, performed_by_text: performedBy.trim(), cost: cost ? Number(cost) : null }).eq('id', inspection.id);
      if (err) throw err;
      if (cost) await supabase.from('vihem_fleet_costs').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, cost_type: 'inspection', amount: Number(cost), cost_date: date, description: inspection.inspection_type, created_by: userId });
      await supabase.from('vihem_fleet_events').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, event_type: 'inspection_recorded', summary: `${inspection.inspection_type}: ${result === 'passed' ? 'Godkänd' : result === 'passed_with_remarks' ? 'Godkänd med anmärkning' : 'Underkänd'}`, actor_id: userId });
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Registrera resultat -- ${inspection?.inspection_type || ''}`}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Datum" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select label="Resultat" value={result} onChange={(e) => setResult(e.target.value)} options={[{ value: 'passed', label: 'Godkänd' }, { value: 'passed_with_remarks', label: 'Godkänd med anmärkning' }, { value: 'failed', label: 'Underkänd' }]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Utförd av" value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} />
          <Input label="Kostnad (kr)" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Avbryt</Button><Button onClick={save} loading={saving}>Spara</Button></div>
      </div>
    </Modal>
  );
}

// ── Mätarhistorik ──────────────────────────────────────────────────────

function MetersTab({ vehicle, readings, profilesById, organisationId, onChanged }: {
  vehicle: FleetVehicle; readings: FleetMeterReading[]; profilesById: Map<string, Pick<Profile, 'id' | 'name'>>; organisationId: string; onChanged: () => void;
}) {
  const [type, setType] = useState<'odometer' | 'engine_hours'>(ASSET_TYPES_WITH_ODOMETER.includes(vehicle.asset_type) ? 'odometer' : 'engine_hours');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!value || Number(value) < 0) { setError('Ange ett giltigt värde.'); return; }
    setSaving(true); setError('');
    try {
      const { error: err } = await supabase.rpc('vihem_fleet_record_meter_reading', { p_vehicle_id: vehicle.id, p_reading_type: type, p_value: Number(value) });
      if (err) throw err;
      setValue(''); onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const SOURCE_LABEL: Record<string, string> = { manual: 'Manuell', telematics: 'Telematik', service: 'Service', import: 'Import' };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h3 className="mb-3 font-semibold text-slate-900">Registrera mätarställning</h3>
        <div className="flex flex-wrap items-end gap-3">
          {ASSET_TYPES_WITH_ODOMETER.includes(vehicle.asset_type) && ASSET_TYPES_WITH_ENGINE_HOURS.includes(vehicle.asset_type) && (
            <Select label="Typ" value={type} onChange={(e) => setType(e.target.value as 'odometer' | 'engine_hours')} options={[{ value: 'odometer', label: `Mätarställning (${vehicle.odometer_unit})` }, { value: 'engine_hours', label: 'Maskintimmar' }]} className="w-56" />
          )}
          <Input label="Värde" type="number" value={value} onChange={(e) => setValue(e.target.value)} className="w-40" />
          <Button onClick={save} loading={saving}>Registrera</Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Historik</h3></div>
        {readings.length ? (
          <div className="divide-y divide-slate-100">
            {readings.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3">
                <div><p className="font-medium text-slate-800">{formatNumber(r.value, 1)} {r.reading_type === 'odometer' ? vehicle.odometer_unit : 'h'}</p><p className="text-xs text-slate-500">{fmtDateTime(r.recorded_at)} · {SOURCE_LABEL[r.source] || r.source}{r.recorded_by ? ` · ${profilesById.get(r.recorded_by)?.name || ''}` : ''}</p></div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<Gauge className="w-10 h-10" />} title="Ingen historik ännu" />}
      </Card>
    </div>
  );
}

// ── Däck ───────────────────────────────────────────────────────────────

type TireForm = { season: string; dimension: string; brand: string; dot: string; tread_depth_mm: string; position: string; mounted: boolean; storage_location: string };
const EMPTY_TIRE_FORM: TireForm = { season: 'summer', dimension: '', brand: '', dot: '', tread_depth_mm: '', position: 'storage', mounted: false, storage_location: '' };
const TIRE_POSITION_LABELS: Record<string, string> = { front_left: 'Vänster fram', front_right: 'Höger fram', rear_left: 'Vänster bak', rear_right: 'Höger bak', spare: 'Reserv', storage: 'Lager' };

function TiresTab({ vehicle, tires, organisationId, userId, onChanged }: {
  vehicle: FleetVehicle; tires: FleetTire[]; organisationId: string; userId: string; onChanged: () => void;
}) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<TireForm>(EMPTY_TIRE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      const { error: err } = await supabase.from('vihem_fleet_tires').insert({
        organisation_id: organisationId, vehicle_id: vehicle.id, season: form.season, dimension: form.dimension.trim(), brand: form.brand.trim(),
        dot: form.dot.trim(), tread_depth_mm: form.tread_depth_mm ? Number(form.tread_depth_mm) : null, position: form.position, mounted: form.mounted,
        storage_location: form.storage_location.trim(), mounted_at: form.mounted ? new Date().toISOString().slice(0, 10) : null,
        mounted_odometer: form.mounted ? vehicle.current_odometer : null, created_by: userId,
      });
      if (err) throw err;
      setModal(false); setForm(EMPTY_TIRE_FORM); onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tire: FleetTire) => {
    if (!window.confirm('Ta bort däckuppsättningen?')) return;
    const { error } = await supabase.from('vihem_fleet_tires').delete().eq('id', tire.id);
    if (error) window.alert(describeError(error)); else onChanged();
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">Däck</h3>
        <Button size="sm" onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Lägg till</Button>
      </div>
      {tires.length ? (
        <div className="divide-y divide-slate-100">
          {tires.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold text-slate-800">{t.season === 'summer' ? 'Sommardäck' : t.season === 'winter' ? 'Vinterdäck' : 'Helårsdäck'} -- {t.dimension} {t.brand}</p>
                <p className="text-xs text-slate-500">DOT {t.dot || '-'} · Mönsterdjup {t.tread_depth_mm ?? '-'} mm · {t.mounted ? `Monterat: ${TIRE_POSITION_LABELS[t.position || ''] || t.position}` : `Lagrat: ${t.storage_location || '-'}`}</p>
              </div>
              <button onClick={() => remove(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={<Circle className="w-10 h-10" />} title="Inga däck registrerade" />}

      <Modal open={modal} onClose={() => setModal(false)} title="Lägg till däck">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Säsong" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} options={[{ value: 'summer', label: 'Sommardäck' }, { value: 'winter', label: 'Vinterdäck' }, { value: 'all_season', label: 'Helårsdäck' }]} />
            <Input label="Dimension" value={form.dimension} onChange={(e) => setForm({ ...form, dimension: e.target.value })} placeholder="T.ex. 205/55R16" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Fabrikat" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            <Input label="DOT" value={form.dot} onChange={(e) => setForm({ ...form, dot: e.target.value })} />
          </div>
          <Input label="Mönsterdjup (mm)" type="number" value={form.tread_depth_mm} onChange={(e) => setForm({ ...form, tread_depth_mm: e.target.value })} />
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.mounted} onChange={(e) => setForm({ ...form, mounted: e.target.checked })} className="h-4 w-4 rounded border-slate-300" /> Monterat på fordonet nu
          </label>
          {form.mounted ? (
            <Select label="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} options={Object.entries(TIRE_POSITION_LABELS).filter(([v]) => v !== 'storage').map(([value, label]) => ({ value, label }))} />
          ) : (
            <Input label="Lagringsplats" value={form.storage_location} onChange={(e) => setForm({ ...form, storage_location: e.target.value })} />
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal(false)}>Avbryt</Button><Button onClick={save} loading={saving}>Spara</Button></div>
        </div>
      </Modal>
    </Card>
  );
}

// ── Dokument ───────────────────────────────────────────────────────────

function DocumentsTab({ vehicle, organisationId, userId, onChanged }: { vehicle: FleetVehicle; organisationId: string; userId: string; onChanged: () => void }) {
  const docs = vehicle.documents || [];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setError('');
    try {
      const uploaded: AttachmentItem[] = [];
      for (const file of Array.from(files)) uploaded.push(await uploadFleetFile(file, 'vihem-fleet-documents', organisationId, 'dokument', userId, 'fleet_document', vehicle.id));
      const next = [...docs, ...uploaded];
      const { error: err } = await supabase.from('vihem_fleet_vehicles').update({ documents: next }).eq('id', vehicle.id);
      if (err) throw err;
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = async (doc: AttachmentItem) => {
    const next = docs.filter((d) => d.id !== doc.id);
    const { error: err } = await supabase.from('vihem_fleet_vehicles').update({ documents: next }).eq('id', vehicle.id);
    if (err) { window.alert(describeError(err)); return; }
    if (doc.path) await supabase.storage.from('vihem-fleet-documents').remove([doc.path]);
    onChanged();
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">Dokument</h3>
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Upload className="h-4 w-4" /> Ladda upp</span>
          <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => upload(e.target.files)} disabled={uploading} />
        </label>
      </div>
      {error && <p className="px-4 pt-3 text-sm text-red-700">{error}</p>}
      {docs.length ? (
        <div className="divide-y divide-slate-100">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 p-4">
              <a href={d.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-sm font-medium text-blue-700 hover:underline"><FileText className="h-4 w-4 shrink-0" /> <span className="truncate">{d.name}</span></a>
              <button onClick={() => removeDoc(d)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={<FileText className="w-10 h-10" />} title="Inga dokument" description="Registreringsbevis, försäkringsbrev, leasingavtal, protokoll m.m." />}
    </Card>
  );
}

// ── Kostnader ──────────────────────────────────────────────────────────

type CostForm = { cost_type: FleetCostType; amount: string; cost_date: string; description: string };
const EMPTY_COST_FORM: CostForm = { cost_type: 'other', amount: '', cost_date: new Date().toISOString().slice(0, 10), description: '' };

function CostsTab({ vehicle, costs, organisationId, userId, onChanged }: { vehicle: FleetVehicle; costs: FleetCost[]; organisationId: string; userId: string; onChanged: () => void }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<CostForm>(EMPTY_COST_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const totals = useMemo(() => {
    const since12mo = new Date(); since12mo.setMonth(since12mo.getMonth() - 12);
    const last12 = costs.filter((c) => new Date(c.cost_date) >= since12mo).reduce((s, c) => s + c.amount, 0);
    const total = costs.reduce((s, c) => s + c.amount, 0);
    const repair = costs.filter((c) => c.cost_type === 'repair' || c.cost_type === 'parts').reduce((s, c) => s + c.amount, 0);
    const service = costs.filter((c) => c.cost_type === 'service').reduce((s, c) => s + c.amount, 0);
    const perDistance = vehicle.current_odometer > 0 ? total / vehicle.current_odometer : 0;
    return { last12, total, repair, service, perDistance };
  }, [costs, vehicle.current_odometer]);

  const save = async () => {
    if (!form.amount || Number(form.amount) <= 0) { setError('Ange ett belopp.'); return; }
    setSaving(true); setError('');
    try {
      const { error: err } = await supabase.from('vihem_fleet_costs').insert({
        organisation_id: organisationId, vehicle_id: vehicle.id, cost_type: form.cost_type, amount: Number(form.amount), cost_date: form.cost_date, description: form.description.trim(), created_by: userId,
      });
      if (err) throw err;
      setModal(false); setForm(EMPTY_COST_FORM); onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-slate-500">Senaste 12 mån</p><p className="text-lg font-bold text-slate-900">{formatNumber(totals.last12)} kr</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-500">Total kostnad</p><p className="text-lg font-bold text-slate-900">{formatNumber(totals.total)} kr</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-500">Reparation/delar</p><p className="text-lg font-bold text-slate-900">{formatNumber(totals.repair)} kr</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-500">Kostnad / {vehicle.odometer_unit}</p><p className="text-lg font-bold text-slate-900">{formatNumber(totals.perDistance, 1)} kr</p></Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Kostnadsposter</h3>
          <Button size="sm" onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Ny kostnad</Button>
        </div>
        {costs.length ? (
          <div className="divide-y divide-slate-100">
            {costs.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0"><p className="font-medium text-slate-800">{COST_TYPE_LABELS[c.cost_type]}{c.description ? ` -- ${c.description}` : ''}</p><p className="text-xs text-slate-500">{fmtDate(c.cost_date)}</p></div>
                <span className="font-semibold text-slate-800">{formatNumber(c.amount)} kr</span>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<Banknote className="w-10 h-10" />} title="Inga kostnader registrerade" />}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Ny kostnad">
        <div className="space-y-4">
          <Select label="Typ" value={form.cost_type} onChange={(e) => setForm({ ...form, cost_type: e.target.value as FleetCostType })} options={Object.entries(COST_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Belopp (kr)" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Input label="Datum" type="date" value={form.cost_date} onChange={(e) => setForm({ ...form, cost_date: e.target.value })} />
          </div>
          <Input label="Beskrivning" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal(false)}>Avbryt</Button><Button onClick={save} loading={saving}>Spara</Button></div>
        </div>
      </Modal>
    </div>
  );
}

// ── Telematik ──────────────────────────────────────────────────────────

function TelematicsTab({ vehicle, device, isAdmin, organisationId, userId, onChanged }: {
  vehicle: FleetVehicle; device: FleetTelematicsDevice | null; isAdmin: boolean; organisationId: string; userId: string; onChanged: () => void;
}) {
  const [modal, setModal] = useState(false);
  const [provider, setProvider] = useState('teltonika');
  const [deviceModel, setDeviceModel] = useState('');
  const [imei, setImei] = useState('');
  const [simNumber, setSimNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pair = async () => {
    if (!imei.trim()) { setError('Ange IMEI.'); return; }
    setSaving(true); setError('');
    try {
      const { data, error: err } = await supabase.from('vihem_fleet_telematics_devices').insert({
        organisation_id: organisationId, vehicle_id: vehicle.id, provider, device_model: deviceModel.trim(), imei: imei.trim(), sim_number: simNumber.trim(), created_by: userId,
      }).select('id').single();
      if (err) throw err;
      await supabase.from('vihem_fleet_telematics_device_assignments').insert({ device_id: data.id, vehicle_id: vehicle.id, created_by: userId });
      await supabase.from('vihem_fleet_events').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, event_type: 'device_assigned', summary: `Telematikenhet kopplad (IMEI ${imei.trim()})`, actor_id: userId });
      setModal(false); setDeviceModel(''); setImei(''); setSimNumber('');
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const unpair = async () => {
    if (!device || !window.confirm('Koppla bort telematikenheten från fordonet? Historisk data bevaras.')) return;
    await supabase.from('vihem_fleet_telematics_device_assignments').update({ unassigned_at: new Date().toISOString() }).eq('device_id', device.id).eq('vehicle_id', vehicle.id).is('unassigned_at', null);
    await supabase.from('vihem_fleet_telematics_devices').update({ vehicle_id: null }).eq('id', device.id);
    await supabase.from('vihem_fleet_events').insert({ organisation_id: organisationId, vehicle_id: vehicle.id, event_type: 'device_unassigned', summary: 'Telematikenhet frånkopplad', actor_id: userId });
    onChanged();
  };

  return (
    <Card className="p-5">
      <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900"><Radio className="h-4 w-4" /> Telematikenhet</h3>
      {device ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">Leverantör</dt><dd className="font-medium">{device.provider}</dd></div>
            <div><dt className="text-xs text-slate-500">Modell</dt><dd className="font-medium">{device.device_model || '-'}</dd></div>
            <div><dt className="text-xs text-slate-500">IMEI</dt><dd className="font-medium">{device.imei}</dd></div>
            <div><dt className="text-xs text-slate-500">SIM</dt><dd className="font-medium">{device.sim_number || '-'}</dd></div>
            <div><dt className="text-xs text-slate-500">Status</dt><dd><Badge className={device.status === 'online' ? 'bg-emerald-100 text-emerald-700' : device.status === 'offline' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}>{device.status === 'online' ? 'Online' : device.status === 'offline' ? 'Offline' : 'Okänd'}</Badge></dd></div>
            <div><dt className="text-xs text-slate-500">Senast kontakt</dt><dd className="font-medium">{fmtDateTime(device.last_contact_at)}</dd></div>
          </dl>
          {isAdmin && <Button size="sm" variant="secondary" onClick={unpair}>Koppla bort</Button>}
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-slate-500">Ingen telematikenhet kopplad. Koppla en Teltonika- eller annan GPS/OBD-enhet för automatisk positionering och mätarställning.</p>
          {isAdmin && <Button size="sm" onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Koppla enhet</Button>}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Koppla telematikenhet">
        <div className="space-y-4">
          <Select label="Leverantör" value={provider} onChange={(e) => setProvider(e.target.value)} options={[{ value: 'teltonika', label: 'Teltonika' }, { value: 'generic_obd', label: 'Generisk OBD' }, { value: 'generic_gps', label: 'Generisk GPS' }, { value: 'other', label: 'Övrigt' }]} />
          <Input label="Modell" value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)} placeholder="T.ex. FMC003" />
          <Input label="IMEI" value={imei} onChange={(e) => setImei(e.target.value)} />
          <Input label="SIM-nummer" value={simNumber} onChange={(e) => setSimNumber(e.target.value)} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal(false)}>Avbryt</Button><Button onClick={pair} loading={saving}>Koppla</Button></div>
        </div>
      </Modal>
    </Card>
  );
}

// ── Historik ───────────────────────────────────────────────────────────

function HistoryTab({ events, profilesById }: { events: FleetEvent[]; profilesById: Map<string, Pick<Profile, 'id' | 'name'>> }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-4"><h3 className="font-semibold text-slate-900">Historik</h3></div>
      {events.length ? (
        <div className="divide-y divide-slate-100">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-3 p-4">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{e.summary && e.summary !== EVENT_LABELS[e.event_type] ? e.summary : (EVENT_LABELS[e.event_type] || e.event_type)}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(e.created_at)}{e.actor_id ? ` · ${profilesById.get(e.actor_id)?.name || ''}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={<History className="w-10 h-10" />} title="Ingen historik ännu" />}
    </Card>
  );
}
