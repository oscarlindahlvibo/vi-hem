import React, { useState, useEffect } from 'react';
import {
  Home,
  Building2,
  Ruler,
  DoorOpen,
  Car,
  Package,
  Phone,
  Mail,
  Calendar,
  AlertCircle,
  Wrench,
  FileText,
  ClipboardCheck,
  PenLine,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  PageHeader,
  EmptyState,
  LoadingPage,
  Button,
  Badge,
  Modal,
} from '../components/ui';
import { formatDate, formatCurrency } from '../lib/utils';
import { BANKID_ENABLED } from '../lib/bankid';
import { buildGeneratedDocument } from '../lib/generatedDocuments';
import { Tenancy, Apartment, Property } from '../types';

interface ContactInfo {
  property_manager?: string;
  phone?: string;
  email?: string;
}

interface ApartmentPageProps { onNavigate: (page: string) => void; }
export function ApartmentPage({ onNavigate }: ApartmentPageProps) {
  const { user } = useAuth();
  const [tenancy, setTenancy] = useState<Tenancy | null>(null);
  const [apartment, setApartment] = useState<Apartment | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [inspections, setInspections] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signingContract, setSigningContract] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const [signing, setSigning] = useState(false);
  const [signMethod, setSignMethod] = useState<'name' | 'bankid'>('name');

  useEffect(() => {
    fetchData();
  }, [user?.id]);

  const fetchData = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      const { data: tenancyData } = await supabase
        .from('vihem_tenancies')
        .select('*')
        .eq('tenant_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (tenancyData) {
        setTenancy(tenancyData);

        const [aptRes, inspRes, contractRes] = await Promise.all([
          supabase.from('vihem_apartments').select('*').eq('id', tenancyData.apartment_id).maybeSingle(),
          supabase.from('vihem_apartment_inspections')
            .select('*, inspector:vihem_profiles!apartment_inspections_inspector_id_fkey(name)')
            .eq('tenancy_id', tenancyData.id)
            .order('inspection_date', { ascending: false }),
          supabase.from('vihem_contract_signatures')
            .select('*')
            .eq('tenancy_id', tenancyData.id)
            .order('created_at', { ascending: false }),
        ]);

        if (aptRes.data) {
          setApartment(aptRes.data);
          const propRes = await supabase.from('vihem_properties').select('*').eq('id', aptRes.data.property_id).maybeSingle();
          if (propRes.data) setProperty(propRes.data);
        }
        setInspections(inspRes.data || []);
        setContracts(contractRes.data || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignContract = async () => {
    if (!signingContract) return;
    if (signMethod === 'name' && !signature.trim()) return;
    setSigning(true);
    try {
      if (signMethod === 'bankid') {
        // BankID signing flow — placeholder until Edge Function is deployed.
        // When ready: initiate BankID sign order, poll for completion, then
        // persist the signature token and personal number.
        alert('BankID-signering är inte aktiverat ännu. Kontakta administratören.');
        return;
      }
      const signedAt = new Date().toISOString();
      let generatedDocumentId = signingContract.document_id || null;

      if (!signingContract.document_id && tenancy && apartment) {
        const documentPayload = buildGeneratedDocument({
          title: `Signerat hyresavtal - ${user?.name || 'Hyresgast'}`,
          fileName: `signerat-hyresavtal-${apartment.apartment_number || signingContract.id}.pdf`,
          documentType: 'contract',
          description: `Signerat hyresavtal for ${property?.address || 'bostad'}${apartment.apartment_number ? `, lgh ${apartment.apartment_number}` : ''}.`,
          body: `${signingContract.contract_content || ''}

SIGNERING
Hyresgast: ${signature}
Signerat: ${new Date(signedAt).toLocaleString('sv-SE')}
Signeringsmetod: Namnunderskrift`,
          organisationId: user?.organisation_id,
          tenantId: user?.id,
          propertyId: apartment.property_id,
          apartmentId: apartment.id,
          createdBy: user?.id,
        });
        const { data: documentData, error: documentError } = await supabase.from('vihem_documents').insert(documentPayload).select('id').single();
        if (documentError) throw documentError;
        generatedDocumentId = documentData.id;
      }

      const { error: contractError } = await supabase.from('vihem_contract_signatures').update({
        tenant_signature: signature,
        tenant_signed_at: signedAt,
        tenant_signature_method: 'name',
        status: 'signed',
        document_id: generatedDocumentId,
      }).eq('id', signingContract.id);

      if (contractError) throw contractError;
      setShowSignModal(false);
      setSignature('');
      setSigningContract(null);
      fetchData();
    } catch (error) {
      console.error('Error signing contract:', error);
    } finally {
      setSigning(false);
    }
  };

  const openSignModal = (contract: any) => {
    setSigningContract(contract);
    setSignMethod('name');
    setSignature('');
    setShowSignModal(true);
  };

  const conditionLabel: Record<string, string> = {
    excellent: 'Utmärkt',
    good: 'Bra',
    fair: 'Godkänd',
    poor: 'Dålig',
  };

  const conditionClass: Record<string, string> = {
    excellent: 'bg-green-100 text-green-700',
    good: 'bg-blue-100 text-blue-700',
    fair: 'bg-amber-100 text-amber-700',
    poor: 'bg-red-100 text-red-700',
  };

  const contractStatusLabel: Record<string, string> = {
    draft: 'Utkast',
    pending_tenant: 'Inväntar signatur',
    signed: 'Signerat',
    cancelled: 'Annullerat',
  };

  const contractStatusClass: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    pending_tenant: 'bg-amber-100 text-amber-700',
    signed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-600',
  };

  const inspectionTypeLabel: Record<string, string> = {
    move_in: 'Inflyttning',
    move_out: 'Utflyttning',
    routine: 'Rutinbesiktning',
    complaint: 'Reklamation',
  };

  if (loading) return <LoadingPage />;

  if (!tenancy || !apartment || !property) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <PageHeader title="Min lägenhet" subtitle="Information om din lägenhet" />
          <EmptyState
            icon={<Home className="w-12 h-12" />}
            title="Ingen aktiv lägenhet"
            description="Du har för närvarande ingen aktiv hyresförbindelse"
          />
        </div>
      </div>
    );
  }

  const contactInfo = property.contact_info as unknown as ContactInfo | null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <PageHeader title="Min lägenhet" subtitle="Information om din lägenhet och ditt hyresavtal" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Property Overview */}
            <Card className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 mb-1">{property.name}</h2>
                  <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <Building2 className="w-4 h-4" />
                    <span>{property.address}, {property.zip} {property.city}</span>
                  </div>
                </div>
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <Home className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              {property.description && (
                <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{property.description}</p>
              )}
            </Card>

            {/* Apartment Details */}
            <Card className="p-6">
              <h3 className="text-base font-semibold text-slate-800 mb-4">Lägenhetsinformation</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg"><DoorOpen className="w-4 h-4 text-blue-600" /></div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase font-medium">Lägenhetsnr</p>
                    <p className="font-semibold text-slate-800">{apartment.apartment_number}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-green-50 rounded-lg"><Ruler className="w-4 h-4 text-green-600" /></div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase font-medium">Storlek</p>
                    <p className="font-semibold text-slate-800">{apartment.size} m²</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-teal-50 rounded-lg"><Home className="w-4 h-4 text-teal-600" /></div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase font-medium">Rum</p>
                    <p className="font-semibold text-slate-800">{apartment.rooms}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-orange-50 rounded-lg"><FileText className="w-4 h-4 text-orange-600" /></div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase font-medium">Hyra/mån</p>
                    <p className="font-semibold text-slate-800">{formatCurrency(apartment.rent)}</p>
                  </div>
                </div>
                {apartment.floor != null && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-50 rounded-lg"><Building2 className="w-4 h-4 text-red-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase font-medium">Våning</p>
                      <p className="font-semibold text-slate-800">{apartment.floor}</p>
                    </div>
                  </div>
                )}
                {apartment.storage && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-yellow-50 rounded-lg"><Package className="w-4 h-4 text-yellow-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase font-medium">Förråd</p>
                      <p className="font-semibold text-slate-800">Ja</p>
                    </div>
                  </div>
                )}
                {apartment.parking && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg"><Car className="w-4 h-4 text-slate-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase font-medium">Parkering</p>
                      <p className="font-semibold text-slate-800">Ja</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Tenancy Information */}
            <Card className="p-6">
              <h3 className="text-base font-semibold text-slate-800 mb-4">Hyresförhållande</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg"><Calendar className="w-4 h-4 text-blue-600" /></div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase font-medium">Startdatum</p>
                    <p className="font-semibold text-slate-800">{formatDate(tenancy.start_date)}</p>
                  </div>
                </div>
                {tenancy.end_date && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-50 rounded-lg"><Calendar className="w-4 h-4 text-red-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase font-medium">Slutdatum</p>
                      <p className="font-semibold text-slate-800">{formatDate(tenancy.end_date)}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Contracts */}
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <PenLine className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-800">Hyresavtal</h3>
              </div>
              {contracts.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">Inga hyresavtal</p>
              ) : (
                <div className="space-y-3">
                  {contracts.map((contract) => (
                    <div key={contract.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          Hyresavtal {formatDate(contract.created_at)}
                        </p>
                        {contract.valid_until && (
                          <p className="text-xs text-slate-500">Giltigt till: {formatDate(contract.valid_until)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={contractStatusClass[contract.status] || 'bg-slate-100 text-slate-600'}>
                          {contractStatusLabel[contract.status] || contract.status}
                        </Badge>
                        {contract.status === 'pending_tenant' && (
                          <Button size="sm" variant="primary" onClick={() => openSignModal(contract)} className="gap-1">
                            <PenLine size={13} />
                            Signera
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Inspections */}
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <ClipboardCheck className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-800">Besiktningsprotokoll</h3>
              </div>
              {inspections.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">Inga besiktningar genomförda</p>
              ) : (
                <div className="space-y-3">
                  {inspections.map((insp) => (
                    <div key={insp.id} className="p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">
                            {inspectionTypeLabel[insp.inspection_type] || insp.inspection_type}
                          </span>
                          <Badge className={conditionClass[insp.overall_condition] || 'bg-slate-100 text-slate-600'}>
                            {conditionLabel[insp.overall_condition] || insp.overall_condition}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-400">{formatDate(insp.inspection_date)}</span>
                      </div>
                      {insp.inspector?.name && (
                        <p className="text-xs text-slate-500">Besiktad av: {insp.inspector.name}</p>
                      )}
                      {insp.notes && <p className="text-xs text-slate-600 mt-1">{insp.notes}</p>}
                      {insp.action_required && (
                        <p className="text-xs text-amber-700 mt-1 font-medium">Åtgärd krävs: {insp.action_required}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Emergency info */}
            {property.emergency_info && (
              <Card className="p-4 border-orange-200 bg-orange-50">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-orange-900 mb-1">Nödinformation</h3>
                    <p className="text-sm text-orange-800 whitespace-pre-wrap">{property.emergency_info}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="p-5">
              <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Phone className="w-4 h-4 text-blue-600" />
                Kontakt
              </h3>
              <div className="space-y-3">
                {contactInfo?.property_manager && (
                  <div>
                    <p className="text-xs text-slate-500 uppercase font-medium mb-0.5">Fastighetsskötare</p>
                    <p className="text-sm font-medium text-slate-800">{contactInfo.property_manager}</p>
                  </div>
                )}
                {contactInfo?.phone && (
                  <a href={`tel:${contactInfo.phone}`} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-blue-600 font-medium">{contactInfo.phone}</span>
                  </a>
                )}
                {contactInfo?.email && (
                  <a href={`mailto:${contactInfo.email}`} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                    <Mail className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-blue-600 font-medium break-all">{contactInfo.email}</span>
                  </a>
                )}
                {!contactInfo?.phone && !contactInfo?.email && !contactInfo?.property_manager && (
                  <p className="text-sm text-slate-400">Ingen kontaktinfo tillgänglig</p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-base font-semibold text-slate-800 mb-4">Snabblänkar</h3>
              <div className="space-y-2">
                <Button onClick={() => onNavigate('documents')} variant="secondary" className="w-full justify-start text-sm gap-2">
                  <FileText className="w-4 h-4" />
                  Dokument
                </Button>
                <Button onClick={() => onNavigate('maintenance')} variant="secondary" className="w-full justify-start text-sm gap-2">
                  <Wrench className="w-4 h-4" />
                  Felanmälningar
                </Button>
                <Button onClick={() => onNavigate('termination')} variant="secondary" className="w-full justify-start text-sm gap-2">
                  <FileText className="w-4 h-4" />
                  Säg upp lägenhet
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Sign Contract Modal */}
      <Modal open={showSignModal} onClose={() => { setShowSignModal(false); setSignature(''); setSigningContract(null); }} title="Signera hyresavtal" size="lg">
        {signingContract && (
          <div className="space-y-4">
            {signingContract.contract_content && (
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 max-h-64 overflow-y-auto">
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{signingContract.contract_content}</pre>
              </div>
            )}

            {/* Signature method selector */}
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Välj signeringsmetod</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSignMethod('name')}
                  className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                    signMethod === 'name'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <PenLine className="w-4 h-4 flex-shrink-0" />
                  Namnunderskrift
                </button>
                <button
                  type="button"
                  onClick={() => BANKID_ENABLED && setSignMethod('bankid')}
                  className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                    signMethod === 'bankid'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : BANKID_ENABLED
                      ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                  }`}
                  title={BANKID_ENABLED ? 'Signera med BankID' : 'BankID-integration är inte aktiverad ännu'}
                >
                  <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                  <span>BankID</span>
                  {!BANKID_ENABLED && (
                    <span className="ml-auto text-xs bg-slate-200 text-slate-400 px-1.5 py-0.5 rounded-full font-normal leading-none">
                      Snart
                    </span>
                  )}
                </button>
              </div>
            </div>

            {signMethod === 'name' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Skriv ditt fullständiga namn som signatur
                </label>
                <input
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Ditt fullständiga namn"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">Genom att skriva ditt namn bekräftar du att du läst och godkänner avtalet.</p>
              </div>
            )}

            {signMethod === 'bankid' && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center space-y-2">
                <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-medium text-slate-700">Signera med BankID</p>
                <p className="text-xs text-slate-500">
                  Du omdirigeras till BankID-appen för att signera avtalet med din elektroniska ID-handling.
                  Signaturen är rättsligt bindande.
                </p>
                {!BANKID_ENABLED && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    BankID-integration är inte aktiverad i det här systemet ännu.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => { setShowSignModal(false); setSignature(''); setSigningContract(null); }} className="flex-1">
                Avbryt
              </Button>
              <Button
                variant="primary"
                onClick={handleSignContract}
                disabled={(signMethod === 'name' && !signature.trim()) || (signMethod === 'bankid' && !BANKID_ENABLED) || signing}
                loading={signing}
                className="flex-1 gap-1"
              >
                {signMethod === 'bankid' ? (
                  <><ShieldCheck size={14} /> Öppna BankID</>
                ) : (
                  <><PenLine size={14} /> Signera avtal</>
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
