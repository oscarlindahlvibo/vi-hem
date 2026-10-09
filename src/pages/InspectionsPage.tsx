import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Textarea,
  Select,
  PageHeader,
  EmptyState,
  LoadingPage,
  SearchInput,
  Tabs,
} from '../components/ui';
import { useToast } from '../components/toast';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { InspectionRooms } from '../components/inspections/InspectionRooms';
import { formatDate } from '../lib/utils';
import { archiveInspectionFile, prepareInspectionPhoto, inspectionFile } from '../lib/inspections/archive';
import { storeQueuedPhoto, queuedPhotos, removeQueuedPhoto, inspectionFormKey as stableInspectionFormKey } from '../lib/inspections/uploadQueue';
import { InspectionArchive } from '../components/inspections/InspectionArchive';
import { InspectionImage } from '../components/inspections/InspectionImage';
import {
  ClipboardCheck,
  Plus,
  CheckCircle,
  Eye,
  Camera,
  X,
  Image,
} from 'lucide-react';

interface InspectionsPageProps { onNavigate: (page: string) => void; }

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  move_in: 'Inflyttningsbesiktning',
  move_out: 'Utflyttningsbesiktning',
  routine: 'Rutinbesiktning',
  complaint: 'Reklamationsbesiktning',
};

const CONDITION_LABELS: Record<string, string> = {
  excellent: 'Utmärkt',
  good: 'Bra',
  fair: 'Godkänd',
  poor: 'Dålig',
};

const CONDITION_CLASS: Record<string, string> = {
  excellent: 'bg-green-100 text-green-700',
  good: 'bg-blue-100 text-blue-700',
  fair: 'bg-amber-100 text-amber-700',
  poor: 'bg-red-100 text-red-700',
};

const DEFAULT_ROOMS = [
  { name: 'Hall/Entré', condition: 'good', notes: '', photos: [] as string[], reviewed: false },
  { name: 'Kök', condition: 'good', notes: '', photos: [] as string[], reviewed: false },
  { name: 'Vardagsrum', condition: 'good', notes: '', photos: [] as string[], reviewed: false },
  { name: 'Sovrum 1', condition: 'good', notes: '', photos: [] as string[], reviewed: false },
  { name: 'Badrum', condition: 'good', notes: '', photos: [] as string[], reviewed: false },
];

interface InspectionCameraProps {
  open: boolean;
  roomName: string;
  onClose: () => void;
  onCapture: (files: File[]) => void;
}

function InspectionCamera({ open, roomName, onClose, onCapture }: InspectionCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('Startar kamera...');
  const [captures, setCaptures] = useState<Array<{ file: File; preview: string }>>([]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const videoElement = videoRef.current;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kameran stöds inte i denna webbläsare.');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
        setMessage('Kameran är redo. Ta så många bilder du behöver.');
      } catch (error) {
        setReady(false);
        setMessage(error instanceof Error ? error.message : 'Kunde inte starta kameran.');
      }
    };
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoElement) videoElement.srcObject = null;
      setReady(false);
    };
  }, [open]);

  if (!open) return null;

  const takePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !ready || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) return;
    const file = new File([blob], `besiktning-${Date.now()}.jpg`, { type: 'image/jpeg' });
    setCaptures(previous => [...previous, { file, preview: URL.createObjectURL(blob) }]);
    setMessage('Bild sparad. Du kan ta en till utan att öppna kameran igen.');
  };

  const finish = () => {
    if (captures.length > 0) onCapture(captures.map(capture => capture.file));
    captures.forEach(capture => URL.revokeObjectURL(capture.preview));
    setCaptures([]);
    onClose();
  };

  const closeWithoutSaving = () => {
    captures.forEach(capture => URL.revokeObjectURL(capture.preview));
    setCaptures([]);
    onClose();
  };

  return (
    <Modal open={open} onClose={closeWithoutSaving} title={`Fota ${roomName}`} size="fullscreen"><div className="relative h-full bg-slate-950 text-white">
      <canvas ref={canvasRef} className="hidden" />
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-slate-950/80 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-sm font-bold">Fota {roomName}</p>
          <p className="text-xs text-slate-300">{captures.length} {captures.length === 1 ? 'bild' : 'bilder'} tagna</p>
        </div>
        <Button variant="secondary" size="sm" onClick={closeWithoutSaving}><X className="h-4 w-4" /> Stäng</Button>
      </div>
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
        <div className="pointer-events-none absolute inset-0 bg-slate-950/15" />
        <div className="pointer-events-none absolute inset-x-8 top-24 bottom-52 rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(15,23,42,0.4)]" />
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+16px)] left-4 right-4 flex flex-col gap-3">
          <div className="rounded-xl bg-slate-950/80 px-4 py-3 text-center text-sm font-semibold">{message}</div>
          {captures.length > 0 && (
            <div className="flex max-h-20 gap-2 overflow-x-auto">
              {captures.map((capture, index) => (
                <div key={`${capture.file.name}-${index}`} className="relative shrink-0">
                  <img src={capture.preview} alt={`Bild ${index + 1}`} className="h-16 w-16 rounded-lg object-cover ring-2 ring-white/70" />
                  <button
                    type="button"
                    aria-label={`Ta bort bild ${index + 1}`}
                    onClick={() => {
                      URL.revokeObjectURL(capture.preview);
                      setCaptures(previous => previous.filter((_, captureIndex) => captureIndex !== index));
                    }}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-1 text-white"
                  ><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => void takePhoto()} disabled={!ready} className="justify-center py-4"><Camera className="h-5 w-5" /> Ta bild</Button>
            <Button onClick={finish} variant={captures.length ? 'primary' : 'secondary'} disabled={!captures.length} className="justify-center py-4">Klar ({captures.length})</Button>
          </div>
        </div>
      </div>
    </div></Modal>
  );
}

export function InspectionsPage({ onNavigate: _onNavigate }: InspectionsPageProps) {
  const { user } = useAuth();
  const toast = useToast();
  const [inspections, setInspections] = useState<any[]>([]);
  const [tenancies, setTenancies] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [apartments, setApartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Inspection state
  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<any>(null);
  const [inspectionForm, setInspectionForm] = useState({
    tenancy_id: '',
    property_id: '',
    apartment_id: '',
    inspection_type: 'routine',
    inspection_date: new Date().toLocaleDateString('sv-SE'),
    tenant_present: false,
    overall_condition: 'good',
    notes: '',
    action_required: '',
    rooms: DEFAULT_ROOMS.map(r => ({ ...r, id: crypto.randomUUID() as string, photos: [] as string[], reviewed: false })),
    photo_urls: [] as string[],
  });
  const inspectionFormKey = stableInspectionFormKey(inspectionForm);
  const [archiveRevision, setArchiveRevision] = useState(0);
  const [inspectionError, setInspectionError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [inspectionStep,setInspectionStep]=useState('object');
  const saveLock = useRef(false), uploadLock = useRef(false);
  const inspectionSaveId = useRef(crypto.randomUUID());
  const protocolAttempt = useRef<{ id: string; file: File; form: string } | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<{id:string;file:File;room:number|undefined;error:boolean;progress:number}[]>([]);
  const [savingInspection, setSavingInspection] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [inspectionCameraRoomIndex, setInspectionCameraRoomIndex] = useState<number | null>(null);
  const inspectionDirty = useUnsavedChanges(inspectionForm, showInspectionModal);
  const [confirmDiscard,setConfirmDiscard]=useState(false);
  const closeInspection=()=>{setInspectionCameraRoomIndex(null);setShowInspectionModal(false);setConfirmDiscard(false);resetInspectionForm();};
  const requestInspectionClose=()=>{if(savingInspection||uploadingPhoto)return;if(inspectionDirty)setConfirmDiscard(true);else closeInspection();};
  const photoInputRef = useRef<HTMLInputElement>(null);
  const roomPhotoRefs = useRef<(HTMLInputElement | null)[]>([]);


  useEffect(() => { fetchAll(); }, []);
  useEffect(() => {
    if (!showInspectionModal || !selectedInspection?.id || !user?.id || uploadLock.current) return;
    let active = true;
    queuedPhotos(user.id, selectedInspection.id).then(items => {
      if (active) {
        const protocol = items.find(item => item.roomKey === 'protocol' && item.form === inspectionFormKey);
        if (protocol) protocolAttempt.current = { id: protocol.id, file: protocol.file, form: protocol.form! };
        setPendingPhotos(items.filter(item => item.roomKey !== 'protocol').map(item => ({ id: item.id, file: item.file, room: item.roomKey === 'general' ? undefined : inspectionForm.rooms.findIndex(room => room.id === item.roomKey), error: true, progress: 0 })));
      }
    }).catch(() => { if (active) setInspectionError('Lokala väntande bilder kunde inte läsas.'); });
    return () => { active = false; };
  }, [showInspectionModal, selectedInspection?.id, user?.id, inspectionForm.rooms, inspectionFormKey]);

  const fetchAll = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [inspRes, tenancyRes, propertyRes, apartmentRes] = await Promise.all([
        supabase
          .from('vihem_apartment_inspections')
          .select(`*, inspector:vihem_profiles!apartment_inspections_inspector_id_fkey(name), tenancy:vihem_tenancies!apartment_inspections_tenancy_id_fkey(id, start_date, tenant:vihem_profiles!tenancies_tenant_id_fkey(id, name, email), apartment:vihem_apartments!tenancies_apartment_id_fkey(apartment_number), property:vihem_properties!tenancies_property_id_fkey(name, address))`)
          .order('inspection_date', { ascending: false }),
        supabase
          .from('vihem_tenancies')
          .select(`id, apartment_id, property_id, start_date, monthly_rent, tenant:vihem_profiles!tenancies_tenant_id_fkey(id, name, email), apartment:vihem_apartments!tenancies_apartment_id_fkey(apartment_number, size), property:vihem_properties!tenancies_property_id_fkey(name, address, city)`)
          .eq('status', 'active'),
        supabase.from('vihem_properties').select('id, name, address, city').order('name'),
        supabase.from('vihem_apartments').select('id, property_id, apartment_number, size').order('apartment_number'),
      ]);
      for (const result of [inspRes, tenancyRes, propertyRes, apartmentRes]) {
        if (result.error) throw result.error;
      }
      setInspections(inspRes.data || []);
      setTenancies(tenancyRes.data || []);
      setProperties(propertyRes.data || []);
      setApartments(apartmentRes.data || []);
    } catch (err) {
      console.error(err);
      setLoadError('Besiktningarna kunde inte hämtas. Kontrollera anslutningen och försök igen.');
    } finally {
      setLoading(false);
    }
  };

  const getTenancyLabel = (t: any) =>
    `${(t.tenant as any)?.name || 'Okänd'} — ${(t.property as any)?.address || ''} Lgh ${(t.apartment as any)?.apartment_number || ''}`;

  const getInspectionProperty = (inspection: any) =>
    inspection.property || properties.find(property => property.id === inspection.property_id);

  const getInspectionApartment = (inspection: any) =>
    inspection.apartment || apartments.find(apartment => apartment.id === inspection.apartment_id);

  const getInspectionLocation = (inspection: any) => {
    const property = getInspectionProperty(inspection);
    const apartment = getInspectionApartment(inspection);
    return `${property?.address || property?.name || ''} ${apartment?.apartment_number ? `Lgh ${apartment.apartment_number}` : ''}`.trim();
  };

  const saveDraft = async () => {
    if (!inspectionForm.property_id || !inspectionForm.apartment_id) throw Error('Välj byggnad och lägenhet först.');
    const { data, error } = await supabase.rpc('vihem_save_inspection', {
      p_id: selectedInspection?.id || inspectionSaveId.current,
      p_form: { ...inspectionForm, tenancy_id: inspectionForm.tenancy_id || null, inspector_id: user!.id, status: 'draft' },
      p_document: null, p_document_id: null,
    });
    if (error) throw error;
    setSelectedInspection(data); return data;
  };
  const uploadPhotos = async (files: File[], roomIndex?: number) => {
    if (!files.length || uploadLock.current) return;
    uploadLock.current = true; setUploadingPhoto(true); setInspectionError('');
    try {
      const saved = await saveDraft();
      for (const original of files) {
        const file = await prepareInspectionPhoto(original), id = crypto.randomUUID();
        await storeQueuedPhoto({ id, file, owner: user!.id, inspection: saved.id, roomKey: roomIndex === undefined ? 'general' : inspectionForm.rooms[roomIndex].id, created: Date.now() });
        setPendingPhotos(previous => [...previous, { id, file, room: roomIndex, error: false, progress: 0 }]);
        await uploadOnePhoto(id, file, roomIndex, saved.id);
      }
    } catch (error) { setInspectionError(error instanceof Error ? error.message : 'Bilderna kunde inte sparas. Utkastet finns kvar.'); }
    finally { uploadLock.current = false; setUploadingPhoto(false); }
  };
  const uploadOnePhoto = async (id: string, file: File, room: number | undefined, inspection: string) => {
    try {
      const reference = await archiveInspectionFile(id, inspection, 'photo', room === undefined ? 'general' : inspectionForm.rooms[room].id, file,
        progress => setPendingPhotos(previous => previous.map(item => item.id === id ? { ...item, progress, error: false } : item)));
      setInspectionForm(previous => room === undefined ? { ...previous, photo_urls: [...new Set([...previous.photo_urls, reference])] } : {
        ...previous, rooms: previous.rooms.map((value, i) => i === room ? { ...value, photos: [...new Set([...value.photos, reference])] } : value),
      });
      await removeQueuedPhoto(id);
      setPendingPhotos(previous => previous.filter(item => item.id !== id));
    } catch { setPendingPhotos(previous => previous.map(item => item.id === id ? { ...item, error: true } : item)); }
  };
  const retryPhoto = async (item: typeof pendingPhotos[number]) => {
    if (item.room !== undefined && item.room < 0) { setInspectionError('Bildens rum saknas. Återställ rummet innan du försöker igen.'); return; }
    if (uploadLock.current) return;
    uploadLock.current = true; setUploadingPhoto(true);
    try { await uploadOnePhoto(item.id, item.file, item.room, selectedInspection?.id || inspectionSaveId.current); }
    finally { uploadLock.current = false; setUploadingPhoto(false); }
  };

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>, roomIndex?: number) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await uploadPhotos(files, roomIndex);
    e.target.value = '';
  };

  const removePhoto = (url: string, roomIndex?: number) => {
    if (roomIndex !== undefined) {
      const updated = [...inspectionForm.rooms];
      updated[roomIndex] = { ...updated[roomIndex], photos: updated[roomIndex].photos.filter((p) => p !== url) };
      setInspectionForm({ ...inspectionForm, rooms: updated });
    } else {
      setInspectionForm({ ...inspectionForm, photo_urls: inspectionForm.photo_urls.filter((p) => p !== url) });
    }
  };

  const handleSaveInspection = async (status: 'draft' | 'completed') => {
    if (saveLock.current || uploadLock.current) return;
    if (status === 'completed' && pendingPhotos.length) { setInspectionError('Försök igen med väntande bilder innan protokollet färdigställs.'); return; }
    saveLock.current = true; setSavingInspection(true); setInspectionError('');
    try {
      const saved = await saveDraft();
      if (status === 'completed') {
        const formKey = stableInspectionFormKey(inspectionForm);
        if (!protocolAttempt.current || protocolAttempt.current.form !== formKey) {
          const { inspectionProtocol } = await import('../lib/inspections/protocol');
          const property = properties.find(item => item.id === inspectionForm.property_id);
          const apartment = apartments.find(item => item.id === inspectionForm.apartment_id);
          const tenancy = tenancies.find(item => item.id === inspectionForm.tenancy_id);
          const id = crypto.randomUUID();
          const bytes = await inspectionProtocol({
            id: saved.id, version: id, organisation: 'VI-HEM', address: property?.address || property?.name || '', apartment: apartment?.apartment_number || '',
            type: INSPECTION_TYPE_LABELS[inspectionForm.inspection_type] || inspectionForm.inspection_type, date: inspectionForm.inspection_date,
            inspector: user!.name, tenant: (tenancy?.tenant as any)?.name, tenantPresent: inspectionForm.tenant_present,
            condition: CONDITION_LABELS[inspectionForm.overall_condition], notes: inspectionForm.notes, action: inspectionForm.action_required,
            rooms: inspectionForm.rooms.map(room => ({ ...room, condition: CONDITION_LABELS[room.condition] })), photos: inspectionForm.photo_urls,
          }, async reference => new Uint8Array(await (await inspectionFile(reference)).arrayBuffer()));
          protocolAttempt.current = { id, file: new File([bytes.slice().buffer], `besiktningsprotokoll-${saved.id.slice(0, 8)}.pdf`, { type: 'application/pdf' }), form: formKey };
          await storeQueuedPhoto({ id, file: protocolAttempt.current.file, owner: user!.id, inspection: saved.id, roomKey: 'protocol', created: Date.now(), form: formKey });
        }
        await archiveInspectionFile(protocolAttempt.current.id, saved.id, 'protocol', 'general', protocolAttempt.current.file);
        await removeQueuedPhoto(protocolAttempt.current.id);
      }
      setShowInspectionModal(false); resetInspectionForm();
      toast.show(status === 'draft' ? 'Besiktningsutkastet är sparat' : 'Protokollet är verifierat och sparat i Google Drive');
      void fetchAll();
    } catch (error) {
      setInspectionError(error instanceof Error && (error.message.startsWith('Protokollet') || error.message.startsWith('Google Drive')) ? error.message : 'Kunde inte färdigställa eller spara. Utkastets uppgifter finns kvar. Kontrollera anslutningen och försök igen.');
    } finally { saveLock.current = false; setSavingInspection(false); setArchiveRevision(value => value + 1); }
  };

  const resetInspectionForm = () => {
    inspectionSaveId.current = crypto.randomUUID();
    protocolAttempt.current = null;
    setPendingPhotos([]);
    setInspectionForm({
      tenancy_id: '',
      property_id: '',
      apartment_id: '',
      inspection_type: 'routine',
      inspection_date: new Date().toLocaleDateString('sv-SE'),
      tenant_present: false,
      overall_condition: 'good',
      notes: '',
      action_required: '',
      rooms: DEFAULT_ROOMS.map(r => ({ ...r, id: crypto.randomUUID() as string, photos: [] })),
      photo_urls: [],
    });
    setSelectedInspection(null);
    setInspectionStep('object');
    setInspectionError('');
  };

  const openEditInspection = (insp: any) => {
    setSelectedInspection(insp);
    setInspectionStep('rooms');
    setInspectionForm({
      tenancy_id: insp.tenancy_id || '',
      property_id: insp.property_id || insp.tenancy?.property_id || '',
      apartment_id: insp.apartment_id || insp.tenancy?.apartment_id || '',
      inspection_type: insp.inspection_type,
      inspection_date: insp.inspection_date,
      tenant_present: insp.tenant_present || false,
      overall_condition: insp.overall_condition,
      notes: insp.notes || '',
      action_required: insp.action_required || '',
      rooms: Array.isArray(insp.rooms) && insp.rooms.length > 0 ? insp.rooms.map((r: any) => ({ ...r, id: crypto.randomUUID() as string, photos: r.photos || [], reviewed: Boolean(r.reviewed) })) : DEFAULT_ROOMS.map(r => ({ ...r, id: crypto.randomUUID() as string, photos: [] })),
      photo_urls: Array.isArray(insp.photo_urls) ? insp.photo_urls : [],
    });
    setShowInspectionModal(true);
  };

  const addRoom = () => {
    setInspectionForm({ ...inspectionForm, rooms: [...inspectionForm.rooms, { id: crypto.randomUUID(), name: '', condition: 'good', notes: '', photos: [], reviewed: false }] });
  };

  const removeRoom = (index: number) => {
    setInspectionForm({ ...inspectionForm, rooms: inspectionForm.rooms.filter((_, i) => i !== index) });
  };

  const filteredInspections = searchQuery
    ? inspections.filter(i =>
        (i.tenancy?.tenant?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        getInspectionLocation(i).toLowerCase().includes(searchQuery.toLowerCase()))
    : inspections;

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto py-2 sm:py-4">
        <PageHeader
          title="Besiktningar"
          subtitle="Hantera besiktningsprotokoll"
          action={
            <Button
              onClick={() => { resetInspectionForm(); setShowInspectionModal(true); }}
              variant="primary"
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              Ny besiktning
            </Button>
          }
        />

        <div className="mb-5">
          <SearchInput placeholder="Sök hyresgäst eller adress..." value={searchQuery} onChange={setSearchQuery} />
        </div>

        {loadError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm text-vihem-danger">{loadError}</p><Button variant="secondary" onClick={fetchAll}>Försök igen</Button></div>}
        {/* INSPECTIONS LIST */}
        {(
          loadError ? null : filteredInspections.length === 0 ? (
            <EmptyState icon={<ClipboardCheck className="w-12 h-12" />} title={searchQuery ? 'Inga träffar' : 'Inga besiktningar ännu'} description={searchQuery ? 'Prova ett annat namn eller en annan adress.' : 'Skapa en besiktning för att dokumentera ett objekt.'} />
          ) : (
            <Card>
              <div className="divide-y divide-slate-100 xl:hidden">
                {filteredInspections.map((insp) => {
                  const totalPhotos = (insp.photo_urls?.length || 0) + (insp.rooms || []).reduce((s: number, r: any) => s + (r.photos?.length || 0), 0);
                  return (
                    <div key={insp.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-vihem-ink">{getInspectionLocation(insp) || 'Besiktning'}</p>
                          {insp.tenancy?.tenant?.name && <p className="mt-1 text-sm text-vihem-muted">{insp.tenancy.tenant.name}</p>}
                          <p className="mt-1 text-xs text-slate-500">{INSPECTION_TYPE_LABELS[insp.inspection_type] || insp.inspection_type}</p>
                        </div>
                        <Button size="sm" variant="ghost" aria-label={`Öppna besiktning ${getInspectionLocation(insp)} ${formatDate(insp.inspection_date)}`} onClick={() => openEditInspection(insp)} className="flex-shrink-0 gap-1">
                          <Eye className="w-3.5 h-3.5" /> Öppna
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="py-1 text-xs font-medium text-vihem-muted">{formatDate(insp.inspection_date)}</span>
                        <Badge className={insp.overall_condition === 'poor' ? 'bg-red-50 text-red-700' : 'bg-transparent text-vihem-muted'}>
                          {CONDITION_LABELS[insp.overall_condition] || insp.overall_condition}
                        </Badge>
                        <Badge className={insp.status === 'completed' ? 'bg-transparent text-vihem-muted' : 'bg-slate-100 text-vihem-ink'}>
                          {insp.status === 'completed' ? 'Slutförd' : 'Utkast'}
                        </Badge>
                        {totalPhotos > 0 && (
                          <span className="inline-flex items-center gap-1 py-1 text-xs font-medium text-vihem-muted">
                            <Image className="w-3.5 h-3.5" /> {totalPhotos}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto xl:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Objekt</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Hyresgäst</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Typ</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Datum</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Skick</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Foton</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                      <th className="py-3 px-4"><span className="sr-only">Åtgärder</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInspections.map((insp) => {
                      const totalPhotos = (insp.photo_urls?.length || 0) + (insp.rooms || []).reduce((s: number, r: any) => s + (r.photos?.length || 0), 0);
                      return (
                        <tr key={insp.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-medium text-vihem-ink text-sm">{getInspectionLocation(insp) || '—'}</td>
                          <td className="py-3 px-4 text-sm text-vihem-muted">{insp.tenancy?.tenant?.name || '—'}</td>
                          <td className="py-3 px-4 text-sm text-slate-600">{INSPECTION_TYPE_LABELS[insp.inspection_type] || insp.inspection_type}</td>
                          <td className="py-3 px-4 text-sm text-slate-600">{formatDate(insp.inspection_date)}</td>
                          <td className="py-3 px-4">
                            <Badge className={insp.overall_condition === 'poor' ? 'bg-red-50 text-red-700' : 'bg-transparent text-vihem-muted'}>
                              {CONDITION_LABELS[insp.overall_condition] || insp.overall_condition}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-500">
                            {totalPhotos > 0 ? (
                              <span className="flex items-center gap-1"><Image className="w-3.5 h-3.5" />{totalPhotos}</span>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-4">
                            <Badge className={insp.status === 'completed' ? 'bg-transparent text-vihem-muted' : 'bg-slate-100 text-vihem-ink'}>
                              {insp.status === 'completed' ? 'Slutförd' : 'Utkast'}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button size="sm" variant="ghost" aria-label={`Öppna besiktning ${getInspectionLocation(insp)} ${formatDate(insp.inspection_date)}`} onClick={() => openEditInspection(insp)} className="gap-1">
                              <Eye className="w-3.5 h-3.5" /> Öppna
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        )}
      </div>

      {/* ═══ INSPECTION MODAL ═══════════════════════════════════════════════ */}
      <Modal open={showInspectionModal} onClose={requestInspectionClose} title={selectedInspection ? 'Redigera besiktning' : 'Ny besiktning'} size="xl" toolbar={<nav aria-label="Besiktningssteg"><Tabs tabs={[{key:'object',label:'Objekt'},{key:'rooms',label:'Rum'},{key:'summary',label:'Sammanfattning'}]} active={inspectionStep} onChange={step=>{if(!savingInspection&&!uploadingPhoto)setInspectionStep(step);}}/></nav>} footer={<>
          {inspectionError&&<p role="alert" className="mb-3 text-sm text-red-700">{inspectionError}</p>}
          {uploadingPhoto&&<p role="status" className="mb-3 text-sm text-vihem-muted">Laddar upp bilder…</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={savingInspection||uploadingPhoto} onClick={requestInspectionClose} size="sm" className="flex-1 sm:flex-none">Avbryt</Button>
            <Button variant="secondary" onClick={() => handleSaveInspection('draft')} loading={savingInspection} disabled={!inspectionForm.apartment_id||uploadingPhoto} size="sm" className="flex-1 sm:flex-none">Spara utkast</Button>
            <Button variant="primary" onClick={() => inspectionStep==='summary' ? handleSaveInspection('completed') : setInspectionStep('summary')} loading={savingInspection} disabled={!inspectionForm.apartment_id||uploadingPhoto} size="sm" className="gap-1 flex-1 sm:flex-none">
              <CheckCircle className="w-4 h-4" />{inspectionStep==='summary' ? 'Slutför' : 'Granska'}
            </Button>
          </div>
        </>}>
        <fieldset disabled={savingInspection||uploadingPhoto} className="mx-auto min-w-0 max-w-3xl space-y-5">
          {inspectionStep==='object'&&<>
          <h3 className="text-base font-semibold text-vihem-ink">Objekt och tid</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label="Byggnad" value={inspectionForm.property_id}
              onChange={e=>setInspectionForm({...inspectionForm,property_id:e.target.value,apartment_id:'',tenancy_id:''})}
              options={[{value:'',label:'Välj byggnad'},...properties.map(property=>({value:property.id,label:`${property.name} · ${property.address}`}))]} />
            <Select label="Lägenhet" value={inspectionForm.apartment_id} disabled={!inspectionForm.property_id}
              onChange={e=>setInspectionForm({...inspectionForm,apartment_id:e.target.value,tenancy_id:''})}
              options={[{value:'',label:'Välj lägenhet'},...apartments.filter(apartment=>apartment.property_id===inspectionForm.property_id).map(apartment=>({value:apartment.id,label:`Lgh ${apartment.apartment_number}`}))]} />
            <div className="md:col-span-2">
              <Select label="Hyresgäst (valfritt)" value={inspectionForm.tenancy_id} disabled={!inspectionForm.apartment_id}
                onChange={e=>setInspectionForm({...inspectionForm,tenancy_id:e.target.value})}
                options={[{value:'',label:'Ingen hyresgäst kopplad ännu'},...tenancies.filter(t=>t.property_id===inspectionForm.property_id&&t.apartment_id===inspectionForm.apartment_id).map(t=>({value:t.id,label:getTenancyLabel(t)}))]} />
              <p className="mt-2 text-sm text-vihem-muted">Hyresgästen kan kopplas senare genom att öppna protokollet igen.</p>
            </div>
            <Select label="Besiktningstyp" value={inspectionForm.inspection_type} onChange={(e) => setInspectionForm({ ...inspectionForm, inspection_type: e.target.value })} options={Object.entries(INSPECTION_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            <Input label="Besiktningsdatum" type="date" value={inspectionForm.inspection_date} onChange={(e) => setInspectionForm({ ...inspectionForm, inspection_date: e.target.value })} />

          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={inspectionForm.tenant_present} onChange={(e) => setInspectionForm({ ...inspectionForm, tenant_present: e.target.checked })} className="w-4 h-4 rounded border-slate-300" />
            <span className="text-sm text-slate-700">Hyresgäst närvarande vid besiktning</span>
          </label>

          <div className="flex justify-end"><Button onClick={()=>setInspectionStep('rooms')}>Till rummen</Button></div>
          </>}
          {inspectionStep==='rooms'&&<>
          {pendingPhotos.length > 0 && <section aria-label="Bildarkivering" className="space-y-2 rounded-xl border border-vihem-line p-4"><h3 className="text-sm font-semibold">Bilder som väntar på arkivering</h3><p className="text-sm text-vihem-muted">Bilderna behålls lokalt i denna webbläsare för samma konto tills arkiveringen lyckas. 100 % överföring betyder att arkivering fortfarande kontrolleras.</p>{pendingPhotos.map(item => <div key={item.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate">{item.file.name} · {item.error ? 'Uppladdningen misslyckades' : item.progress < 100 ? `Laddar upp ${item.progress} %` : 'Verifierar Google Drive…'}</span>{item.error && <Button size="sm" variant="secondary" disabled={uploadingPhoto} onClick={() => void retryPhoto(item)}>Försök igen</Button>}</div>)}</section>}
          <InspectionRooms rooms={inspectionForm.rooms} change={(index,patch)=>setInspectionForm(previous=>({...previous,rooms:previous.rooms.map((room,i)=>i===index?{...room,...patch}:room)}))} add={addRoom} remove={removeRoom} camera={setInspectionCameraRoomIndex} upload={(files,index)=>void uploadPhotos(files,index)} removePhoto={removePhoto} busy={uploadingPhoto||savingInspection||pendingPhotos.length>0}/>
          <div className="flex justify-end"><Button variant="secondary" onClick={()=>setInspectionStep('summary')}>Visa sammanfattning</Button></div>
          </>}
          {inspectionStep==='summary'&&<>
            <section aria-label="Besiktningsobjekt" className="border-b border-vihem-line pb-4">
              <h3 className="text-base font-semibold text-vihem-ink">{properties.find(p=>p.id===inspectionForm.property_id)?.name || 'Besiktningsobjekt'} · Lgh {apartments.find(a=>a.id===inspectionForm.apartment_id)?.apartment_number || '—'}</h3>
              <p className="mt-1 text-sm text-vihem-muted">{INSPECTION_TYPE_LABELS[inspectionForm.inspection_type]} · {formatDate(inspectionForm.inspection_date)}</p>
              {inspectionForm.rooms.some(room=>!room.reviewed) && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{inspectionForm.rooms.filter(room=>!room.reviewed).length} rum är ännu inte markerade som genomgångna. Kontrollera rummen eller spara ett utkast för att fortsätta senare.</p>}
            </section>
            <Select label="Övergripande skick" value={inspectionForm.overall_condition} onChange={(e) => setInspectionForm({ ...inspectionForm, overall_condition: e.target.value })} options={Object.entries(CONDITION_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          {/* General photos */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Allmänna bilder</p>
            <div className="flex flex-wrap gap-2">
              {inspectionForm.photo_urls.map((url, pi) => (
                <div key={pi} className="relative group">
                  <InspectionImage reference={url} label={`Allmän bild ${pi+1}`} />
                  <button type="button" aria-label={`Ta bort allmän bild ${pi+1}`} onClick={() => removePhoto(url)} className="vihem-icon-button absolute -top-2 -right-2 rounded-full bg-white text-vihem-danger shadow-sm"><X className="h-4 w-4" /></button>
                </div>
              ))}
              <label className="vihem-touch-target vihem-focus relative flex cursor-pointer items-center gap-2 rounded-xl border border-vihem-line px-3 py-2 text-sm font-medium text-vihem-ink hover:bg-vihem-canvas focus-within:ring-2 focus-within:ring-vihem-blue">
                <Image className="h-4 w-4" /> Välj bilder
                <input ref={photoInputRef} type="file" accept="image/*" multiple aria-label="Välj allmänna bilder" className="sr-only" onChange={(e) => handlePhotoFile(e)} />
              </label>
            </div>
            <p className="text-sm text-vihem-muted mt-2">Välj flera bilder samtidigt, högst 10 MB per bild. Spara utkastet för att behålla bilderna i besiktningen.</p>
          </div>

          <Textarea label="Allmänna noteringar" value={inspectionForm.notes} onChange={(e) => setInspectionForm({ ...inspectionForm, notes: e.target.value })} placeholder="Övergripande noteringar om lägenheten..." rows={3} />
          <Textarea label="Åtgärder krävs" value={inspectionForm.action_required} onChange={(e) => setInspectionForm({ ...inspectionForm, action_required: e.target.value })} placeholder="Beskriv åtgärder som behöver genomföras..." rows={2} />

          <section className="rounded-xl bg-vihem-canvas p-4" aria-label="Sammanfattning"><h3 className="text-base font-semibold text-vihem-ink">Sammanfattning</h3><p className="mt-2 text-sm text-vihem-muted">{inspectionForm.rooms.filter(r=>r.reviewed).length} av {inspectionForm.rooms.length} rum markerade som genomgångna · {inspectionForm.rooms.filter(r=>r.condition==='poor').length} med dåligt skick · {inspectionForm.photo_urls.length+inspectionForm.rooms.reduce((n,r)=>n+r.photos.length,0)} bilder</p><p className="mt-2 text-sm text-vihem-muted">Spara ett utkast för att fortsätta senare. Slutför skapar en ny PDF-version. Besiktningen färdigställs först när protokollet har verifierats i Google Drive.</p></section>

          </>}
        </fieldset>
        {selectedInspection?.id && <div className="mx-auto mt-5 max-w-3xl"><InspectionArchive key={`${selectedInspection.id}:${archiveRevision}`} inspection={selectedInspection.id} canRetry={true}/></div>}
      </Modal>

      <Modal open={confirmDiscard} onClose={()=>setConfirmDiscard(false)} title="Lämna utan att spara?" size="sm"><p className="text-sm text-vihem-muted">Du har ändrat besiktningen. Spara ett utkast för att kunna fortsätta senare.</p><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={()=>setConfirmDiscard(false)}>Fortsätt redigera</Button><Button variant="danger" onClick={closeInspection}>Lämna utan att spara</Button></div></Modal>
      <InspectionCamera
        open={inspectionCameraRoomIndex !== null}
        roomName={inspectionCameraRoomIndex === null ? 'rum' : inspectionForm.rooms[inspectionCameraRoomIndex]?.name || 'rum'}
        onClose={() => setInspectionCameraRoomIndex(null)}
        onCapture={(files) => {
          if (inspectionCameraRoomIndex !== null) void uploadPhotos(files, inspectionCameraRoomIndex);
        }}
      />
    </div>
  );
}
