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
} from '../components/ui';
import { formatDate } from '../lib/utils';
import { buildGeneratedDocumentWithImages } from '../lib/generatedDocuments';
import { archiveFileInGoogleDrive } from '../lib/googleDriveStorage';
import {
  ClipboardCheck,
  Plus,
  FileText,
  PenLine,
  CheckCircle,
  Eye,
  Send,
  Camera,
  X,
  Image,
  Building2,
  Home,
  WalletCards,
  SlidersHorizontal,
  ListChecks,
  Users,
  ChevronRight,
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

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  pending_tenant: 'Inväntar signatur',
  signed: 'Signerat',
  cancelled: 'Annullerat',
};

const CONTRACT_STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_tenant: 'bg-amber-100 text-amber-700',
  signed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const DEFAULT_ROOMS = [
  { name: 'Hall/Entré', condition: 'good', notes: '', photos: [] as string[] },
  { name: 'Kök', condition: 'good', notes: '', photos: [] as string[] },
  { name: 'Vardagsrum', condition: 'good', notes: '', photos: [] as string[] },
  { name: 'Sovrum 1', condition: 'good', notes: '', photos: [] as string[] },
  { name: 'Badrum', condition: 'good', notes: '', photos: [] as string[] },
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
    <div className="fixed inset-0 z-[100] bg-slate-950 text-white">
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
    </div>
  );
}

// Default apartment contract data
const DEFAULT_APARTMENT_CONTRACT: Record<string, any> = {
  notice_months: 3,
  heat_included: true,
  hot_water_included: true,
  water_included: true,
  electricity_included: false,
  electricity_own_subscription: false,
  internet_included: false,
  internet_own_subscription: false,
  parking_included: false,
  parking_fee: '',
  storage_included: false,
  laundry_access: true,
  pets_allowed: false,
  smoking_allowed: false,
  subletting_allowed: false,
  index_clause: false,
  rent_adjustment_method: 'negotiated',
  rent_adjustment_text: 'Hyran följer inte automatiskt index. Eventuell ändring av hyran hanteras genom förhandling enligt gällande regler och meddelas skriftligen.',
  deposit_months: 1,
  deposit_amount: '',
  renovated_on_entry: false,
  tenant_responsible_painting: false,
  special_terms: '',
};

// Default premises (lokal) contract data
const DEFAULT_PREMISES_CONTRACT: Record<string, any> = {
  notice_months: 6,
  contract_term_months: 24,
  auto_renew: true,
  auto_renew_months: 12,
  vat_included: false,
  vat_rate: 25,
  index_clause: true,
  index_type: 'KPI',
  rent_adjustment_method: 'indexed',
  rent_adjustment_text: '',
  heat_included: false,
  electricity_included: false,
  water_included: false,
  internet_included: false,
  parking_included: false,
  parking_spots: '',
  maintenance_tenant: true,
  maintenance_landlord: true,
  signage_allowed: true,
  subletting_allowed: false,
  deposit_months: 3,
  deposit_amount: '',
  permitted_use: '',
  operating_hours: '',
  special_terms: '',
};

const CONTRACT_BUILDER_SECTIONS = [
  { key: 'basics', label: 'Grunduppgifter', description: 'Avtalstyp, hyresgäst och giltighet', icon: FileText },
  { key: 'economy', label: 'Hyra & deposition', description: 'Hyra, uppsägning och deposition', icon: WalletCards },
  { key: 'adjustment', label: 'Hyresjustering', description: 'Förhandling, index eller fast hyra', icon: SlidersHorizontal },
  { key: 'included', label: 'Det som ingår', description: 'Drift, service och tillval', icon: ListChecks },
  { key: 'rules', label: 'Regler & ansvar', description: 'Nyttjande och särskilda villkor', icon: Users },
];

function generateApartmentContractText(data: Record<string, any>, tenancy: any): string {
  const tenant = tenancy?.tenant as any;
  const apt = tenancy?.apartment as any;
  const prop = tenancy?.property as any;
  const today = new Date().toLocaleDateString('sv-SE');
  const adjustmentMethod = data.rent_adjustment_method || (data.index_clause ? 'indexed' : 'fixed');

  const included = [
    data.heat_included && 'värme',
    data.hot_water_included && 'varmvatten',
    data.water_included && 'kallvatten',
    data.electricity_included && 'el',
    data.internet_included && 'internet',
    data.parking_included && 'parkeringsplats',
    data.storage_included && 'förråd',
    data.laundry_access && 'tillgång till tvättstuga',
  ].filter(Boolean).join(', ');

  return `HYRESAVTAL FÖR BOSTADSLÄGENHET
(enligt Jordabalken 12 kap, Hyreslagen)

Upprättat: ${today}

§1 PARTER
Hyresvärd: [Fastighetsägare/Bolagsnamn]
Hyresgäst: ${tenant?.name || ''}
Personnummer/Org.nr: ___________________________
Adress: ${prop?.address || ''}, ${prop?.city || ''}
Lägenhetsnummer: ${apt?.apartment_number || ''}

§2 HYRESOBJEKT
Lägenheten omfattar ca ${tenancy?.apartment?.size || '___'} m² och är belägen på ovan angiven adress.
Hyresgästen hyr lägenheten för bostadsändamål.

§3 HYRESTID
Hyresavtalet gäller från och med ${formatDate(tenancy?.start_date)} tills vidare.
Uppsägningstid: ${data.notice_months} månader för båda parter.

§4 HYRA
Månadshyra: ${tenancy?.monthly_rent || '___'} kr
Hyran betalas senast den sista dagen i månaden före hyresmånaden.
${data.deposit_amount ? `Deposition: ${data.deposit_amount} kr (motsvarar ${data.deposit_months} månads hyra).` : `Deposition: ${data.deposit_months} månads hyra.`}

§5 I HYRAN INGÅR
${included ? `Följande ingår i hyran: ${included}.` : 'Inga tilläggstjänster ingår i hyran.'}
${data.electricity_own_subscription ? 'El: Hyresgästen tecknar eget elavtal.' : ''}
${data.internet_own_subscription ? 'Internet: Hyresgästen tecknar eget bredbandsavtal.' : ''}
${data.parking_fee ? `Parkering debiteras separat: ${data.parking_fee} kr/mån.` : ''}

§6 HYRESJUSTERING
${adjustmentMethod === 'negotiated'
    ? (data.rent_adjustment_text || 'Hyran följer inte automatiskt index. Eventuell ändring av hyran hanteras genom förhandling enligt gällande regler och meddelas skriftligen.')
    : adjustmentMethod === 'indexed'
      ? `Hyran justeras årligen enligt ${data.index_type || 'konsumentprisindex (KPI)'}.`
      : 'Hyran är fast och justeras inte automatiskt under avtalsperioden.'}

§7 SKICK VID TILLTRÄDE
${data.renovated_on_entry ? 'Lägenheten överlämnas nyrenoverad.' : 'Lägenheten överlämnas i befintligt skick (se bifogat besiktningsprotokoll).'}
${data.tenant_responsible_painting ? 'Hyresgästen ansvarar för målning vid avflyttning.' : ''}

§8 ORDNINGSREGLER OCH NYTTJANDE
Hyresgästen förbinder sig att vårda lägenheten väl och följa fastighetsägarens ordningsregler.
${data.pets_allowed ? 'Husdjur är tillåtna med hyresvärdens godkännande.' : 'Husdjur är inte tillåtna utan skriftligt godkännande.'}
${data.smoking_allowed ? 'Rökning är tillåten i lägenheten.' : 'Rökning är inte tillåten i lägenheten eller gemensamma utrymmen.'}
${data.subletting_allowed ? 'Andrahandsuthyrning är tillåten med hyresvärdens skriftliga godkännande.' : 'Andrahandsuthyrning är inte tillåten utan skriftligt godkännande.'}

§9 UNDERHÅLL
Hyresgästen ansvarar för enklare underhåll av lägenheten. Hyresvärden ansvarar för yttre underhåll och stamledningar.

§10 ÖVRIGT
${data.special_terms || 'Inga särskilda villkor.'}

Parterna har tagit del av och godkänt samtliga villkor i detta avtal.

Ort och datum: ___________________________ den ___________________________

Hyresvärd: ___________________________    Hyresgäst: ___________________________

Namnförtydligande: ___________________    Namnförtydligande: ___________________
`;
}

function generatePremisesContractText(data: Record<string, any>, tenancy: any): string {
  const tenant = tenancy?.tenant as any;
  const apt = tenancy?.apartment as any;
  const prop = tenancy?.property as any;
  const today = new Date().toLocaleDateString('sv-SE');
  const adjustmentMethod = data.rent_adjustment_method || (data.index_clause ? 'indexed' : 'fixed');

  return `HYRESAVTAL FÖR LOKAL
(enligt Jordabalken 12 kap)

Upprättat: ${today}

§1 PARTER
Hyresvärd: [Fastighetsägare/Bolagsnamn]
Hyresgäst/Hyresgästföretag: ${tenant?.name || ''}
Organisationsnummer: ___________________________
Kontaktperson: ___________________________
Adress: ${prop?.address || ''}, ${prop?.city || ''}
Lokalnummer/benämning: ${apt?.apartment_number || ''}

§2 HYRESOBJEKT
Lokalen om ca ${tenancy?.apartment?.size || '___'} m² uthyres för ${data.permitted_use || 'verksamhet enligt överenskommelse'}.

§3 HYRESTID
Hyresavtalet gäller från och med ${formatDate(tenancy?.start_date)}.
Avtalsperiod: ${data.contract_term_months} månader.
${data.auto_renew ? `Avtalet förlängs automatiskt med ${data.auto_renew_months} månader om det inte sägs upp.` : 'Avtalet löper utan automatisk förlängning.'}
Uppsägningstid: ${data.notice_months} månader.

§4 HYRA
Månadshyra: ${tenancy?.monthly_rent || '___'} kr ${data.vat_included ? `+ moms ${data.vat_rate}%` : '(exkl. moms om ej moms tillkommer)'}
Hyran betalas senast den sista dagen i månaden före hyresmånaden.
Deposition: ${data.deposit_amount ? `${data.deposit_amount} kr` : `${data.deposit_months} månaders hyra`}.

§5 HYRESJUSTERING
${adjustmentMethod === 'negotiated'
    ? (data.rent_adjustment_text || 'Hyran följer inte automatiskt index. Eventuell ändring av hyran ska förhandlas mellan parterna och meddelas skriftligen.')
    : adjustmentMethod === 'indexed'
      ? `Hyran justeras årligen den 1 januari enligt ${data.index_type || 'KPI'}. Basår är avtalets startår.`
      : 'Hyran är fast under avtalsperioden.'}

§6 DRIFT OCH KOSTNADER
${data.heat_included ? 'Värme ingår i hyran.' : 'Värme debiteras separat efter förbrukning.'}
${data.electricity_included ? 'El ingår i hyran.' : 'El debiteras separat efter förbrukning.'}
${data.water_included ? 'Vatten ingår i hyran.' : 'Vatten debiteras separat.'}
${data.internet_included ? 'Internet ingår i hyran.' : 'Internet bekostas av hyresgästen.'}
${data.parking_included ? `Parkering ingår: ${data.parking_spots || 'se bilaga'}.` : 'Parkering ingår ej.'}

§7 UNDERHÅLL OCH SKÖTSEL
${data.maintenance_tenant ? 'Hyresgästen ansvarar för det inre underhållet av lokalen.' : ''}
${data.maintenance_landlord ? 'Hyresvärden ansvarar för yttre underhåll och gemensamma utrymmen.' : ''}

§8 SKYLTAR OCH PROFIL
${data.signage_allowed ? 'Hyresgästen har rätt att sätta upp skyltar och profilmarkering efter godkännande av hyresvärden.' : 'Ingen skyltning utanför lokalen utan skriftligt godkännande.'}

§9 ANDRAHANDSUTHYRNING
${data.subletting_allowed ? 'Andrahandsuthyrning tillåts med hyresvärdens skriftliga godkännande.' : 'Andrahandsuthyrning är ej tillåten.'}

§10 ÖPPETTIDER/NYTTJANDETID
${data.operating_hours ? `Lokalen får nyttjas: ${data.operating_hours}.` : 'Lokalen får nyttjas utan tidsbegränsning.'}

§11 ÖVRIGT
${data.special_terms || 'Inga särskilda villkor.'}

Parterna har tagit del av och godkänt samtliga villkor i detta avtal.

Ort och datum: ___________________________ den ___________________________

Hyresvärd: ___________________________    Hyresgäst/Firmatecknare: ___________________________

Namnförtydligande: ___________________    Namnförtydligande: ___________________
`;
}

export function InspectionsPage({ onNavigate: _onNavigate }: InspectionsPageProps) {
  const { user } = useAuth();
  const [view, setView] = useState<'inspections' | 'contracts'>('inspections');
  const [inspections, setInspections] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
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
    inspection_date: new Date().toISOString().split('T')[0],
    tenant_present: false,
    overall_condition: 'good',
    notes: '',
    action_required: '',
    rooms: DEFAULT_ROOMS.map(r => ({ ...r, photos: [] as string[] })),
    photo_urls: [] as string[],
  });
  const [savingInspection, setSavingInspection] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [inspectionCameraRoomIndex, setInspectionCameraRoomIndex] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const roomPhotoRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Contract state
  const [showContractModal, setShowContractModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [contractType, setContractType] = useState<'apartment' | 'premises'>('apartment');
  const [contractForm, setContractForm] = useState({
    tenancy_id: '',
    valid_until: '',
    notice_months: 3,
  });
  const [contractData, setContractData] = useState<Record<string, any>>(DEFAULT_APARTMENT_CONTRACT);
  const [savingContract, setSavingContract] = useState(false);
  const [previewContract, setPreviewContract] = useState(false);
  const [activeContractSection, setActiveContractSection] = useState('basics');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [inspRes, contractRes, tenancyRes, propertyRes, apartmentRes] = await Promise.all([
        supabase
          .from('vihem_apartment_inspections')
          .select(`*, inspector:vihem_profiles!apartment_inspections_inspector_id_fkey(name), tenancy:vihem_tenancies!apartment_inspections_tenancy_id_fkey(id, start_date, tenant:vihem_profiles!tenancies_tenant_id_fkey(id, name, email), apartment:vihem_apartments!tenancies_apartment_id_fkey(apartment_number), property:vihem_properties!tenancies_property_id_fkey(name, address))`)
          .order('inspection_date', { ascending: false }),
        supabase
          .from('vihem_contract_signatures')
          .select(`*, creator:vihem_profiles!contract_signatures_created_by_fkey(name), tenant:vihem_profiles!contract_signatures_tenant_id_fkey(id, name, email), tenancy:vihem_tenancies!contract_signatures_tenancy_id_fkey(id, apartment:vihem_apartments!tenancies_apartment_id_fkey(apartment_number), property:vihem_properties!tenancies_property_id_fkey(name, address))`)
          .order('created_at', { ascending: false }),
        supabase
          .from('vihem_tenancies')
          .select(`id, apartment_id, property_id, start_date, monthly_rent, tenant:vihem_profiles!tenancies_tenant_id_fkey(id, name, email), apartment:vihem_apartments!tenancies_apartment_id_fkey(apartment_number, size), property:vihem_properties!tenancies_property_id_fkey(name, address, city)`)
          .eq('status', 'active'),
        supabase.from('vihem_properties').select('id, name, address, city').order('name'),
        supabase.from('vihem_apartments').select('id, property_id, apartment_number, size').order('apartment_number'),
      ]);
      setInspections(inspRes.data || []);
      setContracts(contractRes.data || []);
      setTenancies(tenancyRes.data || []);
      setProperties(propertyRes.data || []);
      setApartments(apartmentRes.data || []);
    } catch (err) {
      console.error(err);
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

  // ─── Photo upload ─────────────────────────────────────────────────────────
  const uploadPhotos = async (files: File[], roomIndex?: number) => {
    if (files.length === 0) return;
    setUploadingPhoto(true);
    try {
      const uploadedUrls = await Promise.all(files.map(async (file, index) => {
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `inspections/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from('vihem-inspection-photos').upload(path, file, { upsert: false });
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('vihem-inspection-photos').getPublicUrl(path);
        if (user?.organisation_id) {
          try {
            await archiveFileInGoogleDrive({ file, folder: 'Besiktningar/Foton', organisation_id: user.organisation_id, source_type: 'inspection_photo', source_key: path, created_by: user.id });
          } catch (driveError) {
            console.warn('Kunde inte arkivera besiktningsfotot i Google Drive:', driveError);
          }
        }
        return urlData.publicUrl;
      }));

      setInspectionForm(previous => {
        if (roomIndex !== undefined) {
          const rooms = [...previous.rooms];
          rooms[roomIndex] = { ...rooms[roomIndex], photos: [...(rooms[roomIndex].photos || []), ...uploadedUrls] };
          return { ...previous, rooms };
        }
        return { ...previous, photo_urls: [...previous.photo_urls, ...uploadedUrls] };
      });
    } catch (err) {
      console.error('Photo upload failed:', err);
    } finally {
      setUploadingPhoto(false);
    }
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

  const buildInspectionDocumentBody = (inspection: any, tenancy: any, property: any, apartment: any) => {
    const tenant = tenancy?.tenant as any;
    const apt = apartment || tenancy?.apartment as any;
    const prop = property || tenancy?.property as any;
    const rooms = Array.isArray(inspection.rooms) ? inspection.rooms : [];
    const roomRows = rooms.map((room: any) =>
      `${room.name || 'Rum'}: ${CONDITION_LABELS[room.condition] || room.condition || '-'}${room.notes ? ` - ${room.notes}` : ''}`
    ).join('\n');
    const photoCount = (inspection.photo_urls?.length || 0) + rooms.reduce((sum: number, room: any) => sum + (room.photos?.length || 0), 0);

    return `BESIKTNINGSPROTOKOLL

Hyresgast: ${tenant?.name || '-'}
Fastighet: ${prop?.address || '-'}${prop?.city ? `, ${prop.city}` : ''}
Lagenhet: ${apt?.apartment_number || '-'}
Typ: ${INSPECTION_TYPE_LABELS[inspection.inspection_type] || inspection.inspection_type}
Datum: ${formatDate(inspection.inspection_date)}
Hyresgast narvarande: ${inspection.tenant_present ? 'Ja' : 'Nej'}
Overgripande skick: ${CONDITION_LABELS[inspection.overall_condition] || inspection.overall_condition}
Besiktad av: ${user?.name || ''}

RUM OCH SKICK
${roomRows || 'Inga rum registrerade.'}

ANTECKNINGAR
${inspection.notes || 'Inga anteckningar.'}

ATGARD KRAVS
${inspection.action_required || 'Ingen atgard registrerad.'}

Foton bifogade i systemet: ${photoCount}
`;
  };

  const createOrUpdateInspectionDocument = async (inspection: any, tenancy: any, property: any, apartment: any) => {
    const tenant = tenancy?.tenant as any;
    const apt = apartment || tenancy?.apartment as any;
    const prop = property || tenancy?.property as any;
    const title = `${INSPECTION_TYPE_LABELS[inspection.inspection_type] || 'Besiktning'} - ${tenant?.name || 'Hyresgast'}`;
    const photoUrls = [
      ...(Array.isArray(inspection.photo_urls) ? inspection.photo_urls : []),
      ...(Array.isArray(inspection.rooms) ? inspection.rooms.flatMap((room: any) => Array.isArray(room.photos) ? room.photos : []) : []),
    ];
    const documentPayload = await buildGeneratedDocumentWithImages({
      title,
      fileName: `besiktning-${apt?.apartment_number || inspection.id}.pdf`,
      documentType: 'inspection',
      description: `Besiktningsprotokoll for ${prop?.address || 'fastighet'}${apt?.apartment_number ? `, lgh ${apt.apartment_number}` : ''}.`,
      body: buildInspectionDocumentBody(inspection, tenancy, prop, apt),
      organisationId: user?.organisation_id,
      tenantId: tenant?.id,
      propertyId: inspection.property_id || tenancy?.property_id,
      apartmentId: inspection.apartment_id || tenancy?.apartment_id,
      createdBy: user?.id,
    }, photoUrls);

    if (inspection.document_id) {
      const { error } = await supabase.from('vihem_documents').update(documentPayload).eq('id', inspection.document_id);
      if (error) throw error;
      return inspection.document_id;
    }

    const { data, error } = await supabase.from('vihem_documents').insert(documentPayload).select('id').single();
    if (error) throw error;
    return data.id;
  };

  // ─── Inspection save ──────────────────────────────────────────────────────
  const handleSaveInspection = async (status: 'draft' | 'completed') => {
    if (!inspectionForm.property_id || !inspectionForm.apartment_id) return;
    setSavingInspection(true);
    try {
      const tenancy = tenancies.find((t) => t.id === inspectionForm.tenancy_id);
      const property = properties.find((item) => item.id === inspectionForm.property_id);
      const apartment = apartments.find((item) => item.id === inspectionForm.apartment_id);
      const payload = {
        apartment_id: inspectionForm.apartment_id,
        property_id: inspectionForm.property_id,
        tenancy_id: inspectionForm.tenancy_id || null,
        inspection_type: inspectionForm.inspection_type,
        inspection_date: inspectionForm.inspection_date,
        inspector_id: user!.id,
        tenant_present: inspectionForm.tenant_present,
        overall_condition: inspectionForm.overall_condition,
        rooms: inspectionForm.rooms,
        notes: inspectionForm.notes,
        action_required: inspectionForm.action_required,
        photo_urls: inspectionForm.photo_urls,
        status,
      };
      let savedInspection = selectedInspection ? { ...selectedInspection, ...payload } : null;
      if (selectedInspection) {
        const { data, error } = await supabase.from('vihem_apartment_inspections').update(payload).eq('id', selectedInspection.id).select('*').single();
        if (error) throw error;
        savedInspection = data;
      } else {
        const { data, error } = await supabase.from('vihem_apartment_inspections').insert(payload).select('*').single();
        if (error) throw error;
        savedInspection = data;
      }

      if (status === 'completed' && savedInspection) {
        const documentId = await createOrUpdateInspectionDocument(savedInspection, tenancy, property, apartment);
        await supabase.from('vihem_apartment_inspections').update({ document_id: documentId }).eq('id', savedInspection.id);
      }
      setShowInspectionModal(false);
      resetInspectionForm();
      fetchAll();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingInspection(false);
    }
  };

  const resetInspectionForm = () => {
    setInspectionForm({
      tenancy_id: '',
      property_id: '',
      apartment_id: '',
      inspection_type: 'routine',
      inspection_date: new Date().toISOString().split('T')[0],
      tenant_present: false,
      overall_condition: 'good',
      notes: '',
      action_required: '',
      rooms: DEFAULT_ROOMS.map(r => ({ ...r, photos: [] })),
      photo_urls: [],
    });
    setSelectedInspection(null);
  };

  const openEditInspection = (insp: any) => {
    setSelectedInspection(insp);
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
      rooms: Array.isArray(insp.rooms) && insp.rooms.length > 0 ? insp.rooms.map((r: any) => ({ ...r, photos: r.photos || [] })) : DEFAULT_ROOMS.map(r => ({ ...r, photos: [] })),
      photo_urls: Array.isArray(insp.photo_urls) ? insp.photo_urls : [],
    });
    setShowInspectionModal(true);
  };

  const updateRoomField = (index: number, field: string, value: string) => {
    const updated = [...inspectionForm.rooms];
    updated[index] = { ...updated[index], [field]: value };
    setInspectionForm({ ...inspectionForm, rooms: updated });
  };

  const addRoom = () => {
    setInspectionForm({ ...inspectionForm, rooms: [...inspectionForm.rooms, { name: '', condition: 'good', notes: '', photos: [] }] });
  };

  const removeRoom = (index: number) => {
    setInspectionForm({ ...inspectionForm, rooms: inspectionForm.rooms.filter((_, i) => i !== index) });
  };

  // ─── Contract save ────────────────────────────────────────────────────────
  const handleSaveContract = async (statusOverride?: string) => {
    if (!contractForm.tenancy_id) return;
    setSavingContract(true);
    try {
      const tenancy = tenancies.find((t) => t.id === contractForm.tenancy_id);
      const generatedText = contractType === 'apartment'
        ? generateApartmentContractText(contractData, tenancy)
        : generatePremisesContractText(contractData, tenancy);

      const payload: any = {
        tenancy_id: contractForm.tenancy_id,
        created_by: user!.id,
        tenant_id: (tenancy?.tenant as any)?.id,
        contract_content: generatedText,
        contract_type: contractType,
        contract_data: contractData,
        valid_until: contractForm.valid_until || null,
        status: statusOverride || 'draft',
      };

      if (selectedContract) {
        await supabase.from('vihem_contract_signatures').update({
          contract_content: generatedText,
          contract_type: contractType,
          contract_data: contractData,
          valid_until: contractForm.valid_until || null,
          status: statusOverride || selectedContract.status,
        }).eq('id', selectedContract.id);
      } else {
        await supabase.from('vihem_contract_signatures').insert(payload);
      }
      setShowContractModal(false);
      resetContractForm();
      fetchAll();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingContract(false);
    }
  };

  const resetContractForm = () => {
    setContractForm({ tenancy_id: '', valid_until: '', notice_months: 3 });
    setContractData(DEFAULT_APARTMENT_CONTRACT);
    setContractType('apartment');
    setSelectedContract(null);
    setPreviewContract(false);
    setActiveContractSection('basics');
  };

  const openEditContract = (contract: any) => {
    setSelectedContract(contract);
    const ct = contract.contract_type || 'apartment';
    setContractType(ct);
    setContractData(contract.contract_data || (ct === 'apartment' ? DEFAULT_APARTMENT_CONTRACT : DEFAULT_PREMISES_CONTRACT));
    setContractForm({
      tenancy_id: contract.tenancy_id || '',
      valid_until: contract.valid_until || '',
      notice_months: contract.contract_data?.notice_months || (ct === 'apartment' ? 3 : 6),
    });
    setShowContractModal(true);
    setActiveContractSection('basics');
  };

  const sendContractForSigning = async (contract: any) => {
    await supabase.from('vihem_contract_signatures').update({ status: 'pending_tenant' }).eq('id', contract.id);
    if (contract.tenant?.id) {
      await supabase.from('vihem_notifications').insert({
        user_id: contract.tenant.id,
        title: 'Nytt hyresavtal att signera',
        message: 'Ett hyresavtal har skickats till dig för signering. Gå till Min lägenhet för att granska och signera avtalet.',
        type: 'info',
        link: 'apartment',
      });
    }
    fetchAll();
  };

  const handleContractTypeChange = (ct: 'apartment' | 'premises') => {
    setContractType(ct);
    setContractData(ct === 'apartment' ? DEFAULT_APARTMENT_CONTRACT : DEFAULT_PREMISES_CONTRACT);
    setActiveContractSection('basics');
  };

  const cd = contractData;
  const setcd = (key: string, value: any) => setContractData(prev => ({ ...prev, [key]: value }));

  const filteredInspections = searchQuery
    ? inspections.filter(i =>
        (i.tenancy?.tenant?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        getInspectionLocation(i).toLowerCase().includes(searchQuery.toLowerCase()))
    : inspections;

  const filteredContracts = searchQuery
    ? contracts.filter(c =>
        (c.tenant?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.tenancy?.property?.address || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : contracts;

  if (loading) return <LoadingPage />;

  const previewText = contractForm.tenancy_id
    ? (contractType === 'apartment'
        ? generateApartmentContractText(contractData, tenancies.find(t => t.id === contractForm.tenancy_id))
        : generatePremisesContractText(contractData, tenancies.find(t => t.id === contractForm.tenancy_id)))
    : '';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title="Besiktningar & Avtal"
          subtitle="Hantera besiktningsprotokoll och hyresavtal"
          action={
            <Button
              onClick={() => {
                if (view === 'inspections') { resetInspectionForm(); setShowInspectionModal(true); }
                else { resetContractForm(); setShowContractModal(true); }
              }}
              variant="primary"
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              {view === 'inspections' ? 'Ny besiktning' : 'Nytt avtal'}
            </Button>
          }
        />

        {/* Tab switcher */}
        <div className="grid grid-cols-2 gap-2 mb-6 sm:flex">
          <button onClick={() => setView('inspections')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === 'inspections' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            <ClipboardCheck className="w-4 h-4" /> Besiktningar
          </button>
          <button onClick={() => setView('contracts')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === 'contracts' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            <PenLine className="w-4 h-4" /> Hyresavtal
          </button>
        </div>

        <div className="mb-5">
          <SearchInput placeholder="Sök hyresgäst eller adress..." value={searchQuery} onChange={setSearchQuery} />
        </div>

        {/* INSPECTIONS LIST */}
        {view === 'inspections' && (
          filteredInspections.length === 0 ? (
            <EmptyState icon={<ClipboardCheck className="w-12 h-12" />} title="Inga besiktningar" description="Skapa din första besiktning" />
          ) : (
            <Card>
              <div className="divide-y divide-slate-100 md:hidden">
                {filteredInspections.map((insp) => {
                  const totalPhotos = (insp.photo_urls?.length || 0) + (insp.rooms || []).reduce((s: number, r: any) => s + (r.photos?.length || 0), 0);
                  return (
                    <div key={insp.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-slate-900">{insp.tenancy?.tenant?.name || '—'}</p>
                          <p className="mt-1 break-words text-sm text-slate-600">{getInspectionLocation(insp) || '—'}</p>
                          <p className="mt-1 text-xs text-slate-500">{INSPECTION_TYPE_LABELS[insp.inspection_type] || insp.inspection_type}</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => openEditInspection(insp)} className="flex-shrink-0 gap-1">
                          <Eye className="w-3.5 h-3.5" /> Öppna
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{formatDate(insp.inspection_date)}</span>
                        <Badge className={CONDITION_CLASS[insp.overall_condition] || 'bg-slate-100 text-slate-600'}>
                          {CONDITION_LABELS[insp.overall_condition] || insp.overall_condition}
                        </Badge>
                        <Badge className={insp.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>
                          {insp.status === 'completed' ? 'Slutförd' : 'Utkast'}
                        </Badge>
                        {totalPhotos > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                            <Image className="w-3.5 h-3.5" /> {totalPhotos}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Hyresgäst</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Adress / Lgh</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Typ</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Datum</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Skick</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Foton</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                      <th className="py-3 px-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInspections.map((insp) => {
                      const totalPhotos = (insp.photo_urls?.length || 0) + (insp.rooms || []).reduce((s: number, r: any) => s + (r.photos?.length || 0), 0);
                      return (
                        <tr key={insp.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-900 text-sm">{insp.tenancy?.tenant?.name || '—'}</td>
                          <td className="py-3 px-4 text-sm text-slate-600">{getInspectionLocation(insp) || '—'}</td>
                          <td className="py-3 px-4 text-sm text-slate-600">{INSPECTION_TYPE_LABELS[insp.inspection_type] || insp.inspection_type}</td>
                          <td className="py-3 px-4 text-sm text-slate-600">{formatDate(insp.inspection_date)}</td>
                          <td className="py-3 px-4">
                            <Badge className={CONDITION_CLASS[insp.overall_condition] || 'bg-slate-100 text-slate-600'}>
                              {CONDITION_LABELS[insp.overall_condition] || insp.overall_condition}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-500">
                            {totalPhotos > 0 ? (
                              <span className="flex items-center gap-1"><Image className="w-3.5 h-3.5" />{totalPhotos}</span>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-4">
                            <Badge className={insp.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>
                              {insp.status === 'completed' ? 'Slutförd' : 'Utkast'}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button size="sm" variant="ghost" onClick={() => openEditInspection(insp)} className="gap-1">
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

        {/* CONTRACTS LIST */}
        {view === 'contracts' && (
          filteredContracts.length === 0 ? (
            <EmptyState icon={<FileText className="w-12 h-12" />} title="Inga hyresavtal" description="Skapa ett nytt hyresavtal" />
          ) : (
            <Card>
              <div className="divide-y divide-slate-100 md:hidden">
                {filteredContracts.map((contract) => (
                  <div key={contract.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-slate-900">{contract.tenant?.name || '—'}</p>
                        <p className="mt-1 break-words text-sm text-slate-600">
                          {contract.tenancy?.property?.address || '—'}
                          {contract.tenancy?.apartment?.apartment_number && <span className="text-slate-400">, Lgh {contract.tenancy.apartment.apartment_number}</span>}
                        </p>
                        <span className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                          {contract.contract_type === 'premises' ? <Building2 className="w-3.5 h-3.5" /> : <Home className="w-3.5 h-3.5" />}
                          {contract.contract_type === 'premises' ? 'Lokal' : 'Bostad'}
                        </span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => openEditContract(contract)} className="flex-shrink-0 gap-1">
                        <Eye className="w-3.5 h-3.5" /> Öppna
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Skapat {formatDate(contract.created_at)}</span>
                      {contract.valid_until && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Giltigt {formatDate(contract.valid_until)}</span>
                      )}
                      <Badge className={CONTRACT_STATUS_CLASS[contract.status] || 'bg-slate-100 text-slate-600'}>
                        {CONTRACT_STATUS_LABELS[contract.status] || contract.status}
                      </Badge>
                    </div>
                    {contract.status === 'draft' && (
                      <Button size="sm" variant="secondary" onClick={() => sendContractForSigning(contract)} className="mt-3 w-full gap-1">
                        <Send className="w-3.5 h-3.5" /> Skicka för signering
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Hyresgäst</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Typ</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Adress / Lgh</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Skapat</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Giltigt till</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                      <th className="py-3 px-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredContracts.map((contract) => (
                      <tr key={contract.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900 text-sm">{contract.tenant?.name || '—'}</td>
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            {contract.contract_type === 'premises' ? <Building2 className="w-3.5 h-3.5" /> : <Home className="w-3.5 h-3.5" />}
                            {contract.contract_type === 'premises' ? 'Lokal' : 'Bostad'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {contract.tenancy?.property?.address || '—'}
                          {contract.tenancy?.apartment?.apartment_number && <span className="text-slate-400 ml-1">Lgh {contract.tenancy.apartment.apartment_number}</span>}
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">{formatDate(contract.created_at)}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">{formatDate(contract.valid_until) || '—'}</td>
                        <td className="py-3 px-4">
                          <Badge className={CONTRACT_STATUS_CLASS[contract.status] || 'bg-slate-100 text-slate-600'}>
                            {CONTRACT_STATUS_LABELS[contract.status] || contract.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {contract.status === 'draft' && (
                              <Button size="sm" variant="secondary" onClick={() => sendContractForSigning(contract)} className="gap-1">
                                <Send className="w-3.5 h-3.5" /> Skicka för signering
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => openEditContract(contract)} className="gap-1">
                              <Eye className="w-3.5 h-3.5" /> Öppna
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        )}
      </div>

      {/* ═══ INSPECTION MODAL ═══════════════════════════════════════════════ */}
      <Modal open={showInspectionModal} onClose={() => { setInspectionCameraRoomIndex(null); setShowInspectionModal(false); resetInspectionForm(); }} title={selectedInspection ? 'Redigera besiktning' : 'Ny besiktning'} size="xl">
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Byggnad</label>
              <select value={inspectionForm.property_id} onChange={(e) => setInspectionForm({ ...inspectionForm, property_id: e.target.value, apartment_id: '', tenancy_id: '' })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Välj byggnad</option>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.address}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Lägenhet</label>
              <select value={inspectionForm.apartment_id} onChange={(e) => setInspectionForm({ ...inspectionForm, apartment_id: e.target.value, tenancy_id: '' })} disabled={!inspectionForm.property_id} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-50">
                <option value="">Välj lägenhet</option>
                {apartments.filter(apartment => apartment.property_id === inspectionForm.property_id).map((apartment) => <option key={apartment.id} value={apartment.id}>Lgh {apartment.apartment_number}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Hyresgäst (valfritt)</label>
              <select value={inspectionForm.tenancy_id} onChange={(e) => {
                const tenancy = tenancies.find(item => item.id === e.target.value);
                setInspectionForm({
                  ...inspectionForm,
                  tenancy_id: e.target.value,
                  property_id: tenancy?.property_id || inspectionForm.property_id,
                  apartment_id: tenancy?.apartment_id || inspectionForm.apartment_id,
                });
              }} disabled={!inspectionForm.apartment_id} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-50">
                <option value="">Ingen hyresgäst kopplad ännu</option>
                {tenancies.filter(t => t.property_id === inspectionForm.property_id && t.apartment_id === inspectionForm.apartment_id).map((t) => <option key={t.id} value={t.id}>{getTenancyLabel(t)}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-500">Hyresgästen kan kopplas senare genom att öppna protokollet igen.</p>
            </div>
            <Select label="Besiktningstyp" value={inspectionForm.inspection_type} onChange={(e) => setInspectionForm({ ...inspectionForm, inspection_type: e.target.value })} options={Object.entries(INSPECTION_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            <Input label="Besiktningsdatum" type="date" value={inspectionForm.inspection_date} onChange={(e) => setInspectionForm({ ...inspectionForm, inspection_date: e.target.value })} />
            <Select label="Övergripande skick" value={inspectionForm.overall_condition} onChange={(e) => setInspectionForm({ ...inspectionForm, overall_condition: e.target.value })} options={Object.entries(CONDITION_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={inspectionForm.tenant_present} onChange={(e) => setInspectionForm({ ...inspectionForm, tenant_present: e.target.checked })} className="w-4 h-4 rounded border-slate-300" />
            <span className="text-sm text-slate-700">Hyresgäst närvarande vid besiktning</span>
          </label>

          {/* Room observations */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">Rumsobservationer</p>
              <button onClick={addRoom} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Lägg till rum
              </button>
            </div>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {inspectionForm.rooms.map((room, i) => (
                <div key={i} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                    <input type="text" value={room.name} onChange={(e) => updateRoomField(i, 'name', e.target.value)} placeholder="Rumsnamn" className="min-w-0 text-sm font-medium text-slate-800 bg-transparent border-0 focus:outline-none flex-1" />
                    <button onClick={() => removeRoom(i)} className="text-slate-300 hover:text-red-400 ml-2 text-xs">✕</button>
                  </div>
                  <div className="flex flex-col gap-2 mb-2 sm:flex-row">
                    <select value={room.condition} onChange={(e) => updateRoomField(i, 'condition', e.target.value)} className="w-full sm:w-auto text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                      {Object.entries(CONDITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input type="text" value={room.notes} onChange={(e) => updateRoomField(i, 'notes', e.target.value)} placeholder="Noteringar..." className="min-w-0 flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                  {/* Room photos */}
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(room.photos || []).map((url: string, pi: number) => (
                      <div key={pi} className="relative group">
                        <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                        <button onClick={() => removePhoto(url, i)} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setInspectionCameraRoomIndex(i)} className="h-16 w-16 rounded-lg border-2 border-blue-200 bg-blue-50 flex flex-col items-center justify-center hover:border-blue-400 hover:bg-blue-100 transition-colors">
                      <Camera className="w-4 h-4 text-blue-600" />
                      <span className="text-[10px] text-center leading-tight text-blue-700 mt-0.5">Fota<br />flera</span>
                    </button>
                    <label className="w-16 h-16 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                      <Image className="w-4 h-4 text-slate-400" />
                      <span className="text-[10px] text-center leading-tight text-slate-400 mt-0.5">Välj<br />bilder</span>
                      <input ref={el => { roomPhotoRefs.current[i] = el; }} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoFile(e, i)} />
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">Fota flera i samma kamerafönster eller välj flera från bildbiblioteket.</p>
                </div>
              ))}
            </div>
          </div>

          {/* General photos */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Allmänna bilder</p>
            <div className="flex flex-wrap gap-2">
              {inspectionForm.photo_urls.map((url, pi) => (
                <div key={pi} className="relative group">
                  <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                  <button onClick={() => removePhoto(url)} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                </div>
              ))}
              <label className="w-20 h-20 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                {uploadingPhoto ? <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : <>
                  <Camera className="w-5 h-5 text-slate-400" />
                  <span className="text-[10px] text-center leading-tight text-slate-400 mt-1">Lägg till<br />bilder</span>
                </>}
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoFile(e)} />
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-1">Välj flera bilder samtidigt. Bilderna sparas automatiskt när de laddats upp.</p>
          </div>

          <Textarea label="Allmänna noteringar" value={inspectionForm.notes} onChange={(e) => setInspectionForm({ ...inspectionForm, notes: e.target.value })} placeholder="Övergripande noteringar om lägenheten..." rows={3} />
          <Textarea label="Åtgärder krävs" value={inspectionForm.action_required} onChange={(e) => setInspectionForm({ ...inspectionForm, action_required: e.target.value })} placeholder="Beskriv åtgärder som behöver genomföras..." rows={2} />

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => { setShowInspectionModal(false); resetInspectionForm(); }} className="w-full sm:w-auto">Avbryt</Button>
            <Button variant="secondary" onClick={() => handleSaveInspection('draft')} loading={savingInspection} disabled={!inspectionForm.apartment_id} className="w-full sm:w-auto">Spara utkast</Button>
            <Button variant="primary" onClick={() => handleSaveInspection('completed')} loading={savingInspection} disabled={!inspectionForm.apartment_id} className="gap-1 w-full sm:w-auto">
              <CheckCircle className="w-4 h-4" /> Slutför besiktning
            </Button>
          </div>
        </div>
      </Modal>

      <InspectionCamera
        open={inspectionCameraRoomIndex !== null}
        roomName={inspectionCameraRoomIndex === null ? 'rum' : inspectionForm.rooms[inspectionCameraRoomIndex]?.name || 'rum'}
        onClose={() => setInspectionCameraRoomIndex(null)}
        onCapture={(files) => {
          if (inspectionCameraRoomIndex !== null) void uploadPhotos(files, inspectionCameraRoomIndex);
        }}
      />

      {/* ═══ CONTRACT MODAL ═══════════════════════════════════════════════════ */}
      <Modal open={showContractModal} onClose={() => { setShowContractModal(false); resetContractForm(); }} title={selectedContract ? 'Redigera hyresavtal' : 'Nytt hyresavtal'} size="xl">
        {!previewContract ? (
          <div className="space-y-5">
            {/* Contract type picker */}
            {!selectedContract && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Avtalstyp</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button onClick={() => handleContractTypeChange('apartment')} className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all justify-center ${contractType === 'apartment' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                    <Home className="w-5 h-5" /> Bostadslägenhet
                  </button>
                  <button onClick={() => handleContractTypeChange('premises')} className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all justify-center ${contractType === 'premises' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                    <Building2 className="w-5 h-5" /> Lokal
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Bygg avtalet i moduler</p>
                  <p className="mt-1 text-xs text-slate-500">Fyll i de delar som ska ingå. Du kan hoppa mellan modulerna utan att förlora dina ändringar.</p>
                </div>
                <Badge className="shrink-0 bg-blue-100 text-blue-700">{CONTRACT_BUILDER_SECTIONS.length} delar</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CONTRACT_BUILDER_SECTIONS.map(({ key, label, description, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setActiveContractSection(key);
                      document.getElementById(`contract-section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`group flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${activeContractSection === key ? 'border-blue-400 bg-white shadow-sm ring-1 ring-blue-100' : 'border-slate-200 bg-white/70 hover:border-blue-300'}`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${activeContractSection === key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800">{label}</span>
                      <span className="block truncate text-xs text-slate-500">{description}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
              {contractType === 'apartment' && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
                  <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><strong>Privat bostad:</strong> hyresjustering är inställd på förhandling som standard. Index används bara när du väljer det uttryckligen.</span>
                </div>
              )}
            </div>

            <div id="contract-section-basics" className="scroll-mt-4 grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hyresgäst</label>
                <select value={contractForm.tenancy_id} onChange={(e) => setContractForm({ ...contractForm, tenancy_id: e.target.value })} disabled={!!selectedContract} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-50">
                  <option value="">Välj hyresgäst</option>
                  {tenancies.map((t) => <option key={t.id} value={t.id}>{getTenancyLabel(t)}</option>)}
                </select>
              </div>
              <Input label="Giltigt till (valfritt)" type="date" value={contractForm.valid_until} onChange={(e) => setContractForm({ ...contractForm, valid_until: e.target.value })} />
            </div>

            {/* ── Apartment contract form ── */}
            {contractType === 'apartment' && (
              <div className="space-y-4">
                <p id="contract-section-economy" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2">Hyra, uppsägning & deposition</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Uppsägningstid (mån)</label>
                    <input type="number" min={1} max={12} value={cd.notice_months} onChange={e => setcd('notice_months', Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Deposition (månader)</label>
                    <input type="number" min={0} max={6} value={cd.deposit_months} onChange={e => setcd('deposit_months', Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Depositionsbelopp (SEK, valfritt)</label>
                    <input type="text" value={cd.deposit_amount} onChange={e => setcd('deposit_amount', e.target.value)} placeholder="T.ex. 15 000 kr" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <p id="contract-section-included" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 pt-1">Det som ingår i hyran</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: 'heat_included', label: 'Värme' },
                    { key: 'hot_water_included', label: 'Varmvatten' },
                    { key: 'water_included', label: 'Kallvatten' },
                    { key: 'electricity_included', label: 'El' },
                    { key: 'internet_included', label: 'Internet' },
                    { key: 'parking_included', label: 'Parkering' },
                    { key: 'storage_included', label: 'Förråd' },
                    { key: 'laundry_access', label: 'Tvättstuga' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!cd[key]} onChange={e => setcd(key, e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>

                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 pb-2 pt-1">Egna abonnemang</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!cd.electricity_own_subscription} onChange={e => setcd('electricity_own_subscription', e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                    <span className="text-sm text-slate-700">Eget elavtal</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!cd.internet_own_subscription} onChange={e => setcd('internet_own_subscription', e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                    <span className="text-sm text-slate-700">Eget bredbandsavtal</span>
                  </label>
                </div>

                {cd.parking_included === false && (
                  <Input label="Parkeringsavgift (kr/mån)" value={cd.parking_fee} onChange={e => setcd('parking_fee', e.target.value)} placeholder="T.ex. 500" />
                )}

                <p id="contract-section-adjustment" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 pt-1">Hyresjustering</p>
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <label className="block text-sm font-semibold text-slate-800">Hur ska hyran kunna ändras?</label>
                  <p className="mt-1 text-xs text-slate-600">För privata lägenheter används normalt förhandling och inte automatisk indexuppräkning.</p>
                  <select value={cd.rent_adjustment_method || (cd.index_clause ? 'indexed' : 'negotiated')} onChange={e => { const method = e.target.value; setcd('rent_adjustment_method', method); setcd('index_clause', method === 'indexed'); }} className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="negotiated">Förhandlad hyresjustering</option>
                    <option value="indexed">Indexjustering (KPI)</option>
                    <option value="fixed">Fast hyra under avtalsperioden</option>
                  </select>
                  {cd.rent_adjustment_method === 'indexed' && <Input className="mt-3" label="Index (t.ex. KPI)" value={cd.index_type || 'KPI'} onChange={e => setcd('index_type', e.target.value)} />}
                  {cd.rent_adjustment_method === 'negotiated' && <Textarea className="mt-3" label="Förtydligande i avtalet" value={cd.rent_adjustment_text || ''} onChange={e => setcd('rent_adjustment_text', e.target.value)} rows={3} />}
                </div>

                <p id="contract-section-rules" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 pt-1">Regler & villkor</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: 'pets_allowed', label: 'Husdjur tillåtna' },
                    { key: 'smoking_allowed', label: 'Rökning tillåten' },
                    { key: 'subletting_allowed', label: 'Andrahand tillåten' },
                    { key: 'renovated_on_entry', label: 'Nyrenoverad vid tillträde' },
                    { key: 'tenant_responsible_painting', label: 'Hyresgäst ansvarar för målning' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!cd[key]} onChange={e => setcd(key, e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>

                <Textarea label="Särskilda villkor" value={cd.special_terms} onChange={e => setcd('special_terms', e.target.value)} placeholder="Eventuella tilläggsvillkor..." rows={3} />
              </div>
            )}

            {/* ── Premises contract form ── */}
            {contractType === 'premises' && (
              <div className="space-y-4">
                <p id="contract-section-economy" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2">Hyra, uppsägning & deposition</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Uppsägningstid (mån)</label>
                    <input type="number" min={1} max={24} value={cd.notice_months} onChange={e => setcd('notice_months', Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Avtalsperiod (mån)</label>
                    <input type="number" min={1} value={cd.contract_term_months} onChange={e => setcd('contract_term_months', Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Förlängning (mån)</label>
                    <input type="number" min={1} value={cd.auto_renew_months} onChange={e => setcd('auto_renew_months', Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Deposition (månader)</label>
                    <input type="number" min={0} max={12} value={cd.deposit_months} onChange={e => setcd('deposit_months', Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Depositionsbelopp (SEK, valfritt)" value={cd.deposit_amount} onChange={e => setcd('deposit_amount', e.target.value)} placeholder="T.ex. 45 000 kr" />
                  <Input label="Tillåten verksamhet" value={cd.permitted_use} onChange={e => setcd('permitted_use', e.target.value)} placeholder="T.ex. kontor, butik..." />
                </div>
                <Input label="Öppettider/nyttjandetid (valfritt)" value={cd.operating_hours} onChange={e => setcd('operating_hours', e.target.value)} placeholder="T.ex. mån–fre 07–22, lör–sön 09–18" />

                <p id="contract-section-adjustment" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 pt-1">Hyresjustering</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Metod</label>
                    <select value={cd.rent_adjustment_method || (cd.index_clause ? 'indexed' : 'fixed')} onChange={e => { const method = e.target.value; setcd('rent_adjustment_method', method); setcd('index_clause', method === 'indexed'); }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="indexed">Indexjustering</option>
                      <option value="negotiated">Förhandlad justering</option>
                      <option value="fixed">Fast hyra</option>
                    </select>
                  </div>
                  {cd.rent_adjustment_method === 'negotiated' ? <Textarea label="Förtydligande i avtalet" value={cd.rent_adjustment_text || ''} onChange={e => setcd('rent_adjustment_text', e.target.value)} rows={3} /> : <Input label="Index (t.ex. KPI)" value={cd.index_type || 'KPI'} onChange={e => setcd('index_type', e.target.value)} />}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!cd.vat_included} onChange={e => setcd('vat_included', e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                    <span className="text-sm text-slate-700">Moms tillkommer</span>
                  </label>
                  {cd.vat_included && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Momssats (%)</label>
                      <input type="number" value={cd.vat_rate} onChange={e => setcd('vat_rate', Number(e.target.value))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                </div>

                <p id="contract-section-included" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 pt-1">Det som ingår i hyran</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: 'heat_included', label: 'Värme' },
                    { key: 'electricity_included', label: 'El' },
                    { key: 'water_included', label: 'Vatten' },
                    { key: 'internet_included', label: 'Internet' },
                    { key: 'parking_included', label: 'Parkering' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!cd[key]} onChange={e => setcd(key, e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>
                {cd.parking_included && (
                  <Input label="Antal parkeringsplatser / beskrivning" value={cd.parking_spots} onChange={e => setcd('parking_spots', e.target.value)} placeholder="T.ex. 2 platser, nummer 14 och 15" />
                )}

                <p id="contract-section-rules" className="scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 pt-1">Regler & ansvar</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: 'auto_renew', label: 'Automatisk förlängning' },
                    { key: 'maintenance_tenant', label: 'Hyresgäst ansvar inre underhåll' },
                    { key: 'maintenance_landlord', label: 'Hyresvärd ansvar yttre underhåll' },
                    { key: 'signage_allowed', label: 'Skyltning tillåten' },
                    { key: 'subletting_allowed', label: 'Andrahand tillåten' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!cd[key]} onChange={e => setcd(key, e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>

                <Textarea label="Särskilda villkor" value={cd.special_terms} onChange={e => setcd('special_terms', e.target.value)} placeholder="Eventuella tilläggsvillkor..." rows={3} />
              </div>
            )}

            {selectedContract?.tenant_signed_at && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                <p className="font-medium text-green-800">Signerat av hyresgäst</p>
                <p className="text-green-700">{new Date(selectedContract.tenant_signed_at).toLocaleString('sv-SE')} — "{selectedContract.tenant_signature}"</p>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button variant="secondary" onClick={() => { setShowContractModal(false); resetContractForm(); }} className="w-full sm:w-auto">Avbryt</Button>
              <Button variant="secondary" onClick={() => setPreviewContract(true)} disabled={!contractForm.tenancy_id} className="w-full sm:w-auto">
                <Eye className="w-4 h-4" /> Förhandsgranska
              </Button>
              <Button variant="secondary" onClick={() => handleSaveContract('draft')} loading={savingContract} disabled={!contractForm.tenancy_id} className="w-full sm:w-auto">Spara utkast</Button>
              {(!selectedContract || selectedContract.status === 'draft') && (
                <Button variant="primary" onClick={() => handleSaveContract('pending_tenant')} loading={savingContract} disabled={!contractForm.tenancy_id} className="gap-1 w-full sm:w-auto">
                  <Send className="w-4 h-4" /> Skicka för signering
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* Preview mode */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Förhandsgranskning</h3>
              <button onClick={() => setPreviewContract(false)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">← Tillbaka till formulär</button>
            </div>
            <div className="border border-slate-200 rounded-lg p-5 bg-white max-h-96 overflow-y-auto">
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{previewText}</pre>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setPreviewContract(false)} className="w-full sm:w-auto">Redigera</Button>
              <Button variant="secondary" onClick={() => handleSaveContract('draft')} loading={savingContract} disabled={!contractForm.tenancy_id} className="w-full sm:w-auto">Spara utkast</Button>
              {(!selectedContract || selectedContract.status === 'draft') && (
                <Button variant="primary" onClick={() => handleSaveContract('pending_tenant')} loading={savingContract} disabled={!contractForm.tenancy_id} className="gap-1 w-full sm:w-auto">
                  <Send className="w-4 h-4" /> Skicka för signering
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
