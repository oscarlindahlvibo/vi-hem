import { ContextChatLauncher } from '../components/chat/ContextChatLauncher';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Plus, Edit2, Home, Users, ChevronRight,
  Key, Network, Zap, Droplets, Thermometer, Wind,
  Lock, MailOpen, CarFront, Package, Layers, KeyRound, BookOpen, Trash2, FileSignature,
} from 'lucide-react';
import { useToast } from '../components/toast';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card, Badge, Button, Modal, Input, Textarea, Select,
  PageHeader, EmptyState, LoadingPage, SearchInput, Tabs, Avatar,
} from '../components/ui';
import {
  formatCurrency, APARTMENT_STATUS_LABELS, getAptStatusColor,
  unitTypeLabel, floorLabel, UNIT_TYPE_OPTIONS, newUnitLabel, FLOOR_OPTIONS, unitNumberLabel,
} from '../lib/utils';
import { Property, Apartment, Tenancy, Profile, KeyRecord, NetworkOutlet, Organisation } from '../types';
import { OperationsAccessPage } from './OperationsAccessPage';
import { OperationsRoutinesPage } from './OperationsRoutinesPage';
import { listEntityAgreements } from '../modules/agreements-v2/api';
import type { AgreementListItem } from '../modules/agreements-v2/types';

const APARTMENT_STATUS_OPTIONS = [
  { value: 'vacant', label: 'Ledig' },
  { value: 'rented', label: 'Uthyrd' },
  { value: 'renovation', label: 'Renovering' },
  { value: 'blocked', label: 'Spärrad' },
  { value: 'terminated', label: 'Uppsagd' },
];

const defaultAptForm = {
  // Basic
  unit_type: 'apartment' as 'apartment' | 'commercial' | 'storage' | 'garage',
  apartment_number: '', size: '', rooms: '', rent: '', floor: '',
  storage: false, parking: false, balcony: false, balcony_size: '',
  status: 'vacant' as string,
  // IDs
  storage_id: '', parking_spot_id: '', cellar_id: '', mailbox_id: '',
  // Locks
  lock_cylinder_id: '', door_code: '',
  // Utilities
  electricity_fuse_box: '', electricity_meter_id: '',
  water_meter_id: '', heat_meter_id: '', ventilation_unit_id: '',
  // Misc
  last_renovation_year: '', technical_notes: '',
};

type AptFormData = typeof defaultAptForm;

interface AdminPropertiesPageProps { onNavigate: (page: string) => void; }

export function AdminPropertiesPage({ onNavigate }: AdminPropertiesPageProps) {
  const { user } = useAuth();
  const toast=useToast();
  const [properties, setProperties] = useState<Property[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [orgLimits, setOrgLimits] = useState<{ max_properties: number; max_apartments: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError]=useState('');
  const [saveError,setSaveError]=useState('');
  const [saving,setSaving]=useState(false);
  const [discard,setDiscard]=useState<'property'|'apartment'|null>(null);
  const [unitQuery,setUnitQuery]=useState('');
  const [unitStatus,setUnitStatus]=useState('all');
  const [propertyTab,setPropertyTab]=useState('units');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [editingApartment, setEditingApartment] = useState<Apartment | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showApartmentModal, setShowApartmentModal] = useState(false);
  const [aptTab, setAptTab] = useState<'basic' | 'technical'>('basic');
  const [operationsEnabled, setOperationsEnabled] = useState(false);
  const [driftTab, setDriftTab] = useState<'access' | 'routines'>('access');

  // Key IDs dynamic list
  const [keyIds, setKeyIds] = useState<KeyRecord[]>([]);
  // Network outlets dynamic list
  const [networkOutlets, setNetworkOutlets] = useState<NetworkOutlet[]>([]);

  const [propertyFormData, setPropertyFormData] = useState({
    name: '', address: '', city: '', zip: '',
    description: '', emergency_info: '', contact_info: '',
  });
  const [apartmentFormData, setApartmentFormData] = useState<AptFormData>(defaultAptForm);

  const propertyDirty=useUnsavedChanges(propertyFormData,showPropertyModal);
  const apartmentDirty=useUnsavedChanges({apartmentFormData,keyIds,networkOutlets},showApartmentModal);
  const closeEditor=(kind:'property'|'apartment',force=false)=>{if(saving)return;if(!force&&(kind==='property'?propertyDirty:apartmentDirty)){setDiscard(kind);return;}setDiscard(null);setSaveError('');if(kind==='property'){setShowPropertyModal(false);setEditingProperty(null);}else{setShowApartmentModal(false);setEditingApartment(null);}};

  const fetchData = useCallback(async () => {
    try {
      setLoading(true); setLoadError('');
      const [propsRes, aptsRes, tenanciesRes, profilesRes] = await Promise.all([
        supabase.from('vihem_properties').select('*').order('name'),
        supabase.from('vihem_apartments').select('*').order('apartment_number'),
        supabase.from('vihem_tenancies').select('*'),
        supabase.from('vihem_profiles').select('id, name, email'),
      ]);
      for(const result of [propsRes,aptsRes,tenanciesRes,profilesRes])if(result.error)throw result.error;
      if (propsRes.data) {setProperties(propsRes.data);setSelectedProperty(previous=>previous?propsRes.data.find(p=>p.id===previous.id)||null:null);}
      if (aptsRes.data) setApartments(aptsRes.data);
      if (tenanciesRes.data) setTenancies(tenanciesRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);

      // Fetch org quota limits
      if (user?.organisation_id) {
        const { data: org } = await supabase
          .from('vihem_organisations')
          .select('max_properties, max_apartments')
          .eq('id', user.organisation_id)
          .maybeSingle();
        if (org) setOrgLimits(org);

        const { data: operationsModule } = await supabase
          .from('vihem_organisation_modules')
          .select('enabled')
          .eq('organisation_id', user.organisation_id)
          .eq('module_key', 'operations')
          .maybeSingle();
        setOperationsEnabled(Boolean(operationsModule?.enabled));
      }
    } catch (error) {
      setLoadError('Fastigheterna kunde inte hämtas. Försök igen.');
    } finally {
      setLoading(false);
    }
  },[user?.organisation_id]);
  useEffect(()=>{void fetchData();},[fetchData]);

  const filteredProperties = properties.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const UNIT_TYPE_SORT_ORDER: Record<string, number> = { apartment: 0, commercial: 1, storage: 2, garage: 3 };

  const getPropertyApartments = (propertyId: string) =>
    apartments
      .filter((a) => a.property_id === propertyId)
      .slice()
      .sort((a, b) => {
        const typeDiff = (UNIT_TYPE_SORT_ORDER[a.unit_type] ?? 0) - (UNIT_TYPE_SORT_ORDER[b.unit_type] ?? 0);
        return typeDiff !== 0 ? typeDiff : a.apartment_number.localeCompare(b.apartment_number, 'sv');
      });

  const getCurrentTenancy = (apartmentId: string): Tenancy | undefined =>
    tenancies.find((t) => t.apartment_id === apartmentId && t.status === 'active');

  const getCurrentTenant = (apartmentId: string): Profile | undefined => {
    const t = getCurrentTenancy(apartmentId);
    if (!t) return undefined;
    return profiles.find((p) => p.id === t.tenant_id);
  };

  // ── Property save ──────────────────────────────────────────────────────────
  const handleSaveProperty = async () => {
    if(saving)return;
    if(!propertyFormData.name.trim()||!propertyFormData.address.trim()){setSaveError('Ange fastighetens namn och adress.');return;}
    if (!editingProperty && orgLimits && properties.length >= orgLimits.max_properties) {
      alert(`Licensgränsen för fastigheter är nådd (${orgLimits.max_properties} st). Uppgradera licensen för att lägga till fler.`);
      return;
    }

    setSaving(true);setSaveError('');
    try {
    const lines = propertyFormData.contact_info.split('\n');
    const contactInfo = {
      property_manager: lines[0] || '',
      phone: lines[1] || '',
      email: lines[2] || '',
    };
    if (editingProperty) {
      const result=await supabase.from('vihem_properties').update({
        name: propertyFormData.name, address: propertyFormData.address,
        city: propertyFormData.city, zip: propertyFormData.zip,
        description: propertyFormData.description,
        emergency_info: propertyFormData.emergency_info,
        contact_info: contactInfo,
      }).eq('id', editingProperty.id).select('id').single();
      if(result.error)throw result.error;
      setSelectedProperty(previous=>previous?.id===editingProperty.id?{...previous,...propertyFormData,contact_info:contactInfo}:previous);
    } else {
      const result=await supabase.from('vihem_properties').insert({
        name: propertyFormData.name, address: propertyFormData.address,
        city: propertyFormData.city, zip: propertyFormData.zip,
        description: propertyFormData.description,
        emergency_info: propertyFormData.emergency_info,
        contact_info: contactInfo,
        organisation_id: user?.organisation_id,
      }).select('id').single();
      if(result.error)throw result.error;
    }
    setShowPropertyModal(false);
    setEditingProperty(null);
    setPropertyFormData({ name: '', address: '', city: '', zip: '', description: '', emergency_info: '', contact_info: '' });
    toast.show('Uppgifterna är sparade');
    await fetchData();
    }catch{setSaveError('Fastigheten kunde inte sparas. Dina uppgifter finns kvar. Försök igen.');}finally{setSaving(false);}
  };

  const deleteProperty = async (property: Property) => {
    const unitCount = getPropertyApartments(property.id).length;
    if (unitCount > 0) {
      alert(`Fastigheten har ${unitCount} enhet${unitCount === 1 ? '' : 'er'} kvar. Ta bort alla lägenheter, lokaler, förråd och garage i fastigheten innan den kan raderas.`);
      return;
    }
    if (!window.confirm(`Ta bort fastigheten "${property.name}"? Detta går inte att ångra.`)) return;
    const { error } = await supabase.from('vihem_properties').delete().eq('id', property.id);
    if (error) {
      alert(error.code === '23503'
        ? 'Kan inte ta bort fastigheten — det finns fortfarande kopplad information (t.ex. felanmälningar, arbetsordrar eller dokument) som måste tas bort eller flyttas först.'
        : `Kunde inte ta bort fastigheten: ${error.message}`);
      return;
    }
    if (selectedProperty?.id === property.id) setSelectedProperty(null);
    fetchData();
  };

  // ── Apartment save ─────────────────────────────────────────────────────────
  const handleSaveApartment = async () => {
    if (!selectedProperty||saving) return;
    if(!apartmentFormData.apartment_number.trim()){setSaveError('Ange enhetens nummer.');return;}

    // Enforce apartment quota for new vihem_apartments
    if (!editingApartment && orgLimits) {
      if (apartments.length >= orgLimits.max_apartments) {
        alert(`Licensgränsen för enheter är nådd (${orgLimits.max_apartments} st). Uppgradera licensen för att lägga till fler.`);
        return;
      }
    }
    setSaving(true);setSaveError('');
    try {
    const payload = {
      unit_type: apartmentFormData.unit_type,
      apartment_number: apartmentFormData.apartment_number,
      size: parseFloat(apartmentFormData.size) || 0,
      rooms: parseFloat(apartmentFormData.rooms) || 0,
      rent: parseFloat(apartmentFormData.rent) || 0,
      floor: parseInt(String(apartmentFormData.floor)) || 0,
      storage: apartmentFormData.storage,
      parking: apartmentFormData.parking,
      balcony: apartmentFormData.balcony,
      balcony_size: parseFloat(apartmentFormData.balcony_size) || 0,
      status: apartmentFormData.status,
      storage_id: apartmentFormData.storage_id,
      parking_spot_id: apartmentFormData.parking_spot_id,
      cellar_id: apartmentFormData.cellar_id,
      mailbox_id: apartmentFormData.mailbox_id,
      lock_cylinder_id: apartmentFormData.lock_cylinder_id,
      door_code: apartmentFormData.door_code,
      key_ids: keyIds,
      network_outlet_ids: networkOutlets,
      electricity_fuse_box: apartmentFormData.electricity_fuse_box,
      electricity_meter_id: apartmentFormData.electricity_meter_id,
      water_meter_id: apartmentFormData.water_meter_id,
      heat_meter_id: apartmentFormData.heat_meter_id,
      ventilation_unit_id: apartmentFormData.ventilation_unit_id,
      last_renovation_year: apartmentFormData.last_renovation_year
        ? parseInt(apartmentFormData.last_renovation_year) : null,
      technical_notes: apartmentFormData.technical_notes,
    };
    if (editingApartment) {
      const result=await supabase.from('vihem_apartments').update(payload).eq('id', editingApartment.id).select('id').single();if(result.error)throw result.error;
    } else {
      const result=await supabase.from('vihem_apartments').insert({
        ...payload,
        property_id: selectedProperty.id,
        organisation_id: user?.organisation_id,
      }).select('id').single();if(result.error)throw result.error;
    }
    setShowApartmentModal(false);
    setEditingApartment(null);
    setApartmentFormData(defaultAptForm);
    setKeyIds([]);
    setNetworkOutlets([]);
    toast.show('Uppgifterna är sparade');
    await fetchData();
    }catch{setSaveError('Enheten kunde inte sparas. Dina uppgifter finns kvar. Försök igen.');}finally{setSaving(false);}
  };

  const deleteApartment = async (apt: Apartment) => {
    const label = unitTypeLabel(apt.unit_type).toLowerCase();
    if (getCurrentTenant(apt.id)) {
      alert(`${unitTypeLabel(apt.unit_type)} ${apt.apartment_number} har ett aktivt hyresförhållande. Avsluta det under Hyresgäster innan enheten kan tas bort.`);
      return;
    }
    if (!window.confirm(`Ta bort ${label} ${apt.apartment_number}? Detta går inte att ångra.`)) return;
    const { error } = await supabase.from('vihem_apartments').delete().eq('id', apt.id);
    if (error) {
      alert(error.code === '23503'
        ? `Kan inte ta bort — det finns fortfarande kopplade arbetsordrar, felanmälningar, besiktningar eller dokument. Ta bort eller flytta dessa först.`
        : `Kunde inte ta bort: ${error.message}`);
      return;
    }
    fetchData();
  };

  const openEditPropertyModal = (property: Property) => {
    const ci = property.contact_info as any;
    setPropertyFormData({
      name: property.name, address: property.address,
      city: property.city, zip: property.zip || '',
      description: property.description || '',
      emergency_info: property.emergency_info || '',
      contact_info: `${ci?.property_manager || ''}\n${ci?.phone || ''}\n${ci?.email || ''}`,
    });
    setEditingProperty(property);
    setSaveError('');setShowPropertyModal(true);
  };

  const openEditApartmentModal = (apt: Apartment) => {
    setApartmentFormData({
      unit_type: apt.unit_type || 'apartment',
      apartment_number: apt.apartment_number,
      size: String(apt.size), rooms: String(apt.rooms), rent: String(apt.rent),
      floor: apt.floor !== null && apt.floor !== undefined ? String(apt.floor) : '',
      storage: !!apt.storage, parking: !!apt.parking,
      balcony: apt.balcony || false,
      balcony_size: String(apt.balcony_size || ''),
      status: apt.status,
      storage_id: apt.storage_id || '', parking_spot_id: apt.parking_spot_id || '',
      cellar_id: apt.cellar_id || '', mailbox_id: apt.mailbox_id || '',
      lock_cylinder_id: apt.lock_cylinder_id || '', door_code: apt.door_code || '',
      electricity_fuse_box: apt.electricity_fuse_box || '',
      electricity_meter_id: apt.electricity_meter_id || '',
      water_meter_id: apt.water_meter_id || '',
      heat_meter_id: apt.heat_meter_id || '',
      ventilation_unit_id: apt.ventilation_unit_id || '',
      last_renovation_year: apt.last_renovation_year ? String(apt.last_renovation_year) : '',
      technical_notes: apt.technical_notes || '',
    });
    setKeyIds(Array.isArray(apt.key_ids) ? apt.key_ids : []);
    setNetworkOutlets(Array.isArray(apt.network_outlet_ids) ? apt.network_outlet_ids : []);
    setEditingApartment(apt);
    setAptTab('basic');
    setSaveError('');setShowApartmentModal(true);
  };

  const openCreateApartmentModal = () => {
    setApartmentFormData(defaultAptForm);
    setKeyIds([]);
    setNetworkOutlets([]);
    setEditingApartment(null);
    setAptTab('basic');
    setSaveError('');setShowApartmentModal(true);
  };

  const setF = (key: keyof AptFormData, value: any) =>
    setApartmentFormData(prev => ({ ...prev, [key]: value }));

  const visibleUnits=selectedProperty?getPropertyApartments(selectedProperty.id).filter(apt=>(unitStatus==='all'||apt.status===unitStatus)&&`${apt.apartment_number} ${getCurrentTenant(apt.id)?.name||''}`.toLocaleLowerCase('sv').includes(unitQuery.toLocaleLowerCase('sv'))):[];
  if (loading) return <LoadingPage />;
  if(loadError)return <div role="alert" className="space-y-4"><PageHeader title="Fastigheter"/><p>{loadError}</p><Button onClick={()=>void fetchData()}>Försök igen</Button></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={selectedProperty?.name||"Fastigheter"} subtitle={selectedProperty?selectedProperty.address:"Dina fastigheter och uthyrningsobjekt"} />
        {!selectedProperty&&<Button
          onClick={() => {
            if (orgLimits && properties.length >= orgLimits.max_properties) {
              alert(`Licensgränsen för fastigheter är nådd (${orgLimits.max_properties} st). Uppgradera licensen för att lägga till fler.`);
              return;
            }
            setEditingProperty(null);
            setPropertyFormData({ name: '', address: '', city: '', zip: '', description: '', emergency_info: '', contact_info: '' });
            setSaveError('');setShowPropertyModal(true);
          }}
          variant="primary"
          className="flex items-center gap-2"
          disabled={!!(orgLimits && properties.length >= orgLimits.max_properties)}
          title={orgLimits && properties.length >= orgLimits.max_properties ? `Licensgräns nådd (${orgLimits.max_properties} fastigheter)` : undefined}
        >
          <Plus className="w-4 h-4" />
          Ny fastighet
        </Button>}
      </div>

      {!selectedProperty ? (
        <>
          <SearchInput placeholder="Sök fastigheter..." value={searchQuery} onChange={setSearchQuery} />
          {orgLimits && (
            <div className={`flex flex-wrap items-center gap-2 text-xs px-3 py-2 rounded-lg w-fit ${properties.length >= orgLimits.max_properties ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
              <Building2 className="w-3.5 h-3.5" />
              <span>Fastigheter: <strong>{properties.length}</strong> / {orgLimits.max_properties}</span>
              {properties.length >= orgLimits.max_properties && <span className="font-semibold">- licensgräns nådd</span>}
            </div>
          )}
          {filteredProperties.length === 0 ? (
            <EmptyState icon={<Building2 className="w-12 h-12" />} title={searchQuery?"Inga träffar":"Inga fastigheter"} description={searchQuery?"Prova ett annat namn eller en annan adress.":"Börja med att skapa din första fastighet"} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredProperties.map((property) => {
                const apts = getPropertyApartments(property.id);
                const occupied = apts.filter(a => a.status === 'rented').length;
                return (
                  <Card key={property.id} className="p-4 sm:p-5">
                    {property.image_url&&<img src={property.image_url} alt="" loading="lazy" className="mb-4 h-32 w-full rounded-xl object-cover"/>}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h3 className="text-base font-semibold text-vihem-ink">{property.name}</h3><p className="mt-1 text-sm text-vihem-muted">{property.address}</p>{property.city&&<p className="text-sm text-vihem-muted">{property.zip} {property.city}</p>}</div>
                      <button aria-label={`Redigera ${property.name}`} onClick={()=>openEditPropertyModal(property)} className="vihem-icon-button shrink-0"><Edit2 size={18}/></button>
                    </div>
                    <button onClick={()=>{setSelectedProperty(property);setPropertyTab('units');setUnitQuery('');setUnitStatus('all');}} aria-label={`Öppna fastighet ${property.name}`} className="vihem-focus vihem-touch-target mt-3 flex w-full items-center justify-between gap-3 rounded-xl text-left">
                      <span className="text-sm text-vihem-muted">{apts.length?`${apts.length} enheter · ${occupied} uthyrda · ${apts.filter(a=>a.status==='vacant').length} lediga`:'Inga enheter ännu'}</span><ChevronRight size={18} className="shrink-0 text-vihem-muted"/>
                    </button>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <button onClick={() => setSelectedProperty(null)} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
            <ChevronRight className="w-4 h-4 rotate-180" /> Tillbaka
          </button>

          <Card className="p-5">
            <div className="flex flex-col gap-4 mb-2 lg:flex-row lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-vihem-ink">Förvaltning</h2>
                <p className="mt-1 text-sm text-vihem-muted">{getPropertyApartments(selectedProperty.id).length} enheter{selectedProperty.city?` · ${selectedProperty.city}`:''}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ContextChatLauncher type="property" id={selectedProperty.id} name={selectedProperty.name} onNavigate={onNavigate} />
                <Button variant="secondary" onClick={() => openEditPropertyModal(selectedProperty)} className="gap-1">
                  <Edit2 className="w-3.5 h-3.5" /> Redigera
                </Button>
                <Button variant="ghost" onClick={() => deleteProperty(selectedProperty)} className="gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Radera
                </Button>
                <Button
                  variant="primary"
                  onClick={openCreateApartmentModal}
                  className="gap-1"
                  disabled={!!(orgLimits && apartments.length >= orgLimits.max_apartments)}
                  title={orgLimits && apartments.length >= orgLimits.max_apartments ? `Licensgräns nådd (${orgLimits.max_apartments} enheter)` : undefined}
                >
                  <Plus className="w-3.5 h-3.5" /> Ny enhet
                </Button>
              </div>
            </div>
            {selectedProperty.description && <p className="text-sm text-slate-600 mt-2">{selectedProperty.description}</p>}
            {(selectedProperty.emergency_info||selectedProperty.contact_info?.property_manager)&&<details className="mt-4 border-t border-vihem-line pt-3"><summary className="vihem-focus vihem-touch-target cursor-pointer text-sm font-medium">Kontakt & fastighetsinformation</summary><div className="mt-3 space-y-2 text-sm text-vihem-muted">{selectedProperty.contact_info?.property_manager&&<p>{selectedProperty.contact_info.property_manager}</p>}{selectedProperty.contact_info?.phone&&<p>{selectedProperty.contact_info.phone}</p>}{selectedProperty.contact_info?.email&&<p>{selectedProperty.contact_info.email}</p>}{selectedProperty.emergency_info&&<p className="whitespace-pre-line">{selectedProperty.emergency_info}</p>}</div></details>}
            {orgLimits && apartments.length >= orgLimits.max_apartments && (
              <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg w-fit ${apartments.length >= orgLimits.max_apartments ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
                <Home className="w-3.5 h-3.5" />
                <span>Enheter (org-total): <strong>{apartments.length}</strong> / {orgLimits.max_apartments}</span>
                {apartments.length >= orgLimits.max_apartments && <span className="font-semibold">— licensgräns nådd</span>}
              </div>
            )}
          </Card>

          {operationsEnabled&&<Tabs tabs={[{key:'units',label:'Enheter'},...(operationsEnabled?[{key:'operations',label:'Drift'}]:[])]} active={propertyTab} onChange={setPropertyTab}/>}
          {operationsEnabled && propertyTab==='operations' && (
            <Card className="p-5">
              <h3 className="mb-3 text-lg font-black text-slate-950">Driftinformation</h3>
              <Tabs
                tabs={[{ key: 'access', label: 'Åtkomst' }, { key: 'routines', label: 'Rutiner' }]}
                active={driftTab}
                onChange={key => setDriftTab(key as 'access' | 'routines')}
                className="mb-4"
              />
              {driftTab === 'access' ? (
                <OperationsAccessPage propertyId={selectedProperty.id} />
              ) : (
                <OperationsRoutinesPage propertyId={selectedProperty.id} />
              )}
            </Card>
          )}

          {propertyTab==='units'&&<><div className="flex flex-col gap-3 sm:flex-row"><SearchInput placeholder="Sök nummer eller hyresgäst…" value={unitQuery} onChange={setUnitQuery}/><Select aria-label="Uthyrningsstatus" value={unitStatus} onChange={e=>setUnitStatus(e.target.value)} options={[{value:'all',label:'Alla statusar'},...APARTMENT_STATUS_OPTIONS]}/></div>
          <div className="space-y-3">
            {visibleUnits.length === 0 ? (
              <EmptyState icon={<Home className="w-12 h-12" />} title={unitQuery||unitStatus!=='all'?"Inga matchande enheter":"Inga enheter"} description={unitQuery||unitStatus!=='all'?"Ändra sökningen eller välj alla statusar.":"Lägg till en lägenhet, lokal eller förråd"} />
            ) : (
              visibleUnits.map((apt) => {
                const tenant = getCurrentTenant(apt.id);
                return (
                  <Card key={apt.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h4 className="font-semibold text-slate-900">{unitTypeLabel(apt.unit_type)} {apt.apartment_number}</h4>
                          <Badge className={getAptStatusColor(apt.status) + ' text-xs'}>
                            {APARTMENT_STATUS_LABELS[apt.status as keyof typeof APARTMENT_STATUS_LABELS] || apt.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-2">
                          <div><span className="text-slate-500">Storlek</span><p className="font-medium">{apt.size} m²</p></div>
                          <div><span className="text-slate-500">Rum</span><p className="font-medium">{apt.rooms}</p></div>
                          <div><span className="text-slate-500">Hyra</span><p className="font-medium">{formatCurrency(apt.rent)}</p></div>
                          {apt.floor !== null && apt.floor !== undefined ? <div><span className="text-slate-500">Våning</span><p className="font-medium">{floorLabel(apt.floor)}</p></div> : null}
                        </div>
                        {/* Technical badges */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {apt.lock_cylinder_id && (
                            <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                              <Lock className="w-3 h-3" /> {apt.lock_cylinder_id}
                            </span>
                          )}
                          {apt.mailbox_id && (
                            <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                              <MailOpen className="w-3 h-3" /> Brevlåda {apt.mailbox_id}
                            </span>
                          )}
                          {apt.electricity_meter_id && (
                            <span className="inline-flex items-center gap-1 text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">
                              <Zap className="w-3 h-3" /> {apt.electricity_meter_id}
                            </span>
                          )}
                          {Array.isArray(apt.key_ids) && apt.key_ids.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                              <Key className="w-3 h-3" /> {apt.key_ids.length} nyckel{apt.key_ids.length !== 1 ? 'ar' : ''}
                            </span>
                          )}
                          {Array.isArray(apt.network_outlet_ids) && apt.network_outlet_ids.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">
                              <Network className="w-3 h-3" /> {apt.network_outlet_ids.length} nätverksuttag
                            </span>
                          )}
                        </div>
                        {tenant && (
                          <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg mt-2 w-fit">
                            <Avatar name={tenant.name||tenant.email} userId={tenant.id} size="xs"/>
                            <span>{tenant.name || tenant.email}</span>
                          </div>
                        )}
                        {apt.notes && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mt-2 whitespace-pre-line">
                            {apt.notes}
                          </p>
                        )}
                        <ApartmentAgreementsLink
                          apartmentId={apt.id}
                          onCreateAgreement={() => {
                            const tenancy = getCurrentTenancy(apt.id);
                            onNavigate(tenancy ? `agreements-v2/new/tenancy/${tenancy.id}` : `agreements-v2/new/apartment/${apt.id}`);
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-1 ml-3">
                        <button aria-label={`Redigera ${unitTypeLabel(apt.unit_type)} ${apt.apartment_number}`} onClick={() => openEditApartmentModal(apt)} className="vihem-icon-button">
                          <Edit2 className="w-4 h-4 text-slate-500" />
                        </button>
                        <button aria-label={`Radera ${unitTypeLabel(apt.unit_type)} ${apt.apartment_number}`} onClick={() => deleteApartment(apt)} className="vihem-icon-button text-vihem-danger">
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div></>}
        </>
      )}

      {/* ── Property Modal ──────────────────────────────────────────────── */}
      <Modal mobileFullscreen open={showPropertyModal} onClose={()=>closeEditor('property')} title={editingProperty ? 'Redigera fastighet' : 'Ny fastighet'} size="md" footer={<><Button variant="secondary" disabled={saving} onClick={()=>closeEditor('property')}>Avbryt</Button><Button loading={saving} onClick={handleSaveProperty}>Spara fastighet</Button></>}>
        <fieldset disabled={saving} className="space-y-4"><p className="text-sm text-vihem-muted">Grunduppgifterna hjälper dig att hitta och organisera fastighetens enheter.</p>{saveError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-vihem-danger">{saveError}</p>}
          <Input label="Namn" value={propertyFormData.name} onChange={(e) => setPropertyFormData({ ...propertyFormData, name: e.target.value })} placeholder="T.ex. Storgatan Fastigheter" />
          <Input label="Adress" value={propertyFormData.address} onChange={(e) => setPropertyFormData({ ...propertyFormData, address: e.target.value })} placeholder="T.ex. Storgatan 123" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Postnummer" value={propertyFormData.zip} onChange={(e) => setPropertyFormData({ ...propertyFormData, zip: e.target.value })} placeholder="123 45" />
            <Input label="Stad" value={propertyFormData.city} onChange={(e) => setPropertyFormData({ ...propertyFormData, city: e.target.value })} placeholder="Stockholm" />
          </div>
          <Textarea label="Beskrivning" value={propertyFormData.description} onChange={(e) => setPropertyFormData({ ...propertyFormData, description: e.target.value })} rows={3} />
          <Textarea label="Nödinformation" value={propertyFormData.emergency_info} onChange={(e) => setPropertyFormData({ ...propertyFormData, emergency_info: e.target.value })} rows={2} />
          <section className="space-y-3 border-t border-vihem-line pt-4"><h3 className="text-base font-semibold">Kontaktperson</h3>{[{label:'Namn på kontaktperson',type:'text'},{label:'Telefon',type:'tel'},{label:'E-post',type:'email'}].map((field,index)=><Input key={field.label} label={field.label} type={field.type} value={propertyFormData.contact_info.split('\n')[index]||''} onChange={e=>setPropertyFormData(previous=>{const lines=previous.contact_info.split('\n');while(lines.length<3)lines.push('');lines[index]=e.target.value;return {...previous,contact_info:lines.join('\n')};})}/>)}</section>
        </fieldset>
      </Modal>

      {/* ── Apartment Modal ─────────────────────────────────────────────── */}
      <Modal mobileFullscreen open={showApartmentModal} onClose={()=>closeEditor('apartment')} title={editingApartment ? `Redigera ${unitTypeLabel(apartmentFormData.unit_type).toLowerCase()}` : newUnitLabel(apartmentFormData.unit_type)} size="xl" toolbar={<Tabs tabs={[{key:'basic',label:'Grunduppgifter'},{key:'technical',label:'Teknik & åtkomst'}]} active={aptTab} onChange={tab=>setAptTab(tab as typeof aptTab)}/>} footer={<><Button variant="secondary" disabled={saving} onClick={()=>closeEditor('apartment')}>Avbryt</Button><Button loading={saving} onClick={handleSaveApartment}>Spara enhet</Button></>}>
        <fieldset disabled={saving} className="space-y-4 max-w-3xl mx-auto">{saveError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-vihem-danger">{saveError}</p>}
        {aptTab === 'basic' && (
          <div className="space-y-4">
            <Select label="Typ" value={apartmentFormData.unit_type} onChange={(e) => setF('unit_type', e.target.value as AptFormData['unit_type'])} options={UNIT_TYPE_OPTIONS} />
            <div className="grid grid-cols-2 gap-4">
              <Input label={unitNumberLabel(apartmentFormData.unit_type)} value={apartmentFormData.apartment_number} onChange={(e) => setF('apartment_number', e.target.value)} placeholder="T.ex. 101" />
              <Select label="Våning" value={apartmentFormData.floor} onChange={(e) => setF('floor', e.target.value)} options={FLOOR_OPTIONS} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Input label="Storlek (m²)" type="number" value={apartmentFormData.size} onChange={(e) => setF('size', e.target.value)} placeholder="75" />
              <Input label="Antal rum" type="number" step="0.5" value={apartmentFormData.rooms} onChange={(e) => setF('rooms', e.target.value)} placeholder="T.ex. 2.5" />
              <div className="col-span-2 sm:col-span-1"><Input label="Månadshyra (kr)" type="number" value={apartmentFormData.rent} onChange={(e) => setF('rent', e.target.value)} placeholder="12000" /></div>
            </div>
            <Select label="Status" value={apartmentFormData.status} onChange={e=>setF('status',e.target.value)} options={APARTMENT_STATUS_OPTIONS}/>
            <div className="grid grid-cols-2 gap-4 pt-1">
              {[
                { key: 'storage', label: 'Förråd' },
                { key: 'parking', label: 'Parkering' },
                { key: 'balcony', label: 'Balkong/uteplats' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!(apartmentFormData as any)[key]} onChange={(e) => setF(key as keyof AptFormData, e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
              {apartmentFormData.balcony && (
                <Input label="Balkongsyta (m²)" type="number" value={apartmentFormData.balcony_size} onChange={(e) => setF('balcony_size', e.target.value)} placeholder="8" />
              )}
            </div>
          </div>
        )}

        {aptTab === 'technical' && (
          <div className="space-y-5">
            {/* Locking */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Lås & Åtkomst
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Låscylinder-ID" value={apartmentFormData.lock_cylinder_id} onChange={(e) => setF('lock_cylinder_id', e.target.value)} placeholder="T.ex. ASSA 3000 / Cyl-42A" />
                <Input label="Portkodstelefon / portkod" value={apartmentFormData.door_code} onChange={(e) => setF('door_code', e.target.value)} placeholder="T.ex. #1234" />
                <Input label="Brevlåde-ID" value={apartmentFormData.mailbox_id} onChange={(e) => setF('mailbox_id', e.target.value)} placeholder="T.ex. B12" />
                <Input label="Förråds-ID" value={apartmentFormData.storage_id} onChange={(e) => setF('storage_id', e.target.value)} placeholder="T.ex. F-04" />
                <Input label="Parkeringsplats-ID" value={apartmentFormData.parking_spot_id} onChange={(e) => setF('parking_spot_id', e.target.value)} placeholder="T.ex. P-22" />
                <Input label="Källarplats-ID" value={apartmentFormData.cellar_id} onChange={(e) => setF('cellar_id', e.target.value)} placeholder="T.ex. K-07" />
              </div>
            </div>

            {/* Keys */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" /> Nycklar
                </p>
                <Button size="sm" variant="secondary" onClick={() => setKeyIds(prev => [...prev, { id: '', label: '', copies: 1 }])}><Plus size={16}/>Nyckel</Button>
              </div>
              {keyIds.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Inga nycklar registrerade</p>
              ) : (
                <div className="space-y-2">
                  {keyIds.map((k, i) => (
                    <div key={i} className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                      <Input label="Nyckel-ID" value={k.id} onChange={(e) => setKeyIds(prev => prev.map((x, j) => j === i ? { ...x, id: e.target.value } : x))} placeholder="ID" />
                      <Input label="Beskrivning" value={k.label} onChange={(e) => setKeyIds(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="T.ex. Ytterdörr" />
                      <div className="flex gap-2 items-end">
                        <Input label="Kopior" type="number" value={String(k.copies)} onChange={(e) => setKeyIds(prev => prev.map((x, j) => j === i ? { ...x, copies: parseInt(e.target.value) || 1 } : x))} placeholder="1" />
                        <button aria-label={`Ta bort nyckel ${i+1}`} onClick={() => setKeyIds(prev => prev.filter((_, j) => j !== i))} className="vihem-icon-button text-vihem-danger"><Trash2 size={16}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Network */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5" /> Nätverksuttag
                </p>
                <Button size="sm" variant="secondary" onClick={() => setNetworkOutlets(prev => [...prev, { room: '', port_id: '', switch: '', vlan: '' }])}><Plus size={16}/>Uttag</Button>
              </div>
              {networkOutlets.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Inga nätverksuttag registrerade</p>
              ) : (
                <div className="space-y-2">
                  {networkOutlets.map((n, i) => (
                    <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                      <Input label="Rum" value={n.room} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, room: e.target.value } : x))} placeholder="Vardagsrum" />
                      <Input label="Port-ID" value={n.port_id} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, port_id: e.target.value } : x))} placeholder="P-24" />
                      <Input label="Switch" value={n.switch || ''} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, switch: e.target.value } : x))} placeholder="SW-02" />
                      <div className="flex gap-2 items-end">
                        <Input label="VLAN" value={n.vlan || ''} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, vlan: e.target.value } : x))} placeholder="100" />
                        <button aria-label={`Ta bort uttag ${i+1}`} onClick={() => setNetworkOutlets(prev => prev.filter((_, j) => j !== i))} className="vihem-icon-button text-vihem-danger"><Trash2 size={16}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Utilities */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> Mätare & Installation
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Elcentral / säkringsplats" value={apartmentFormData.electricity_fuse_box} onChange={(e) => setF('electricity_fuse_box', e.target.value)} placeholder="T.ex. Skåp 3, krets 12" />
                <Input label="Elmätarnummer" value={apartmentFormData.electricity_meter_id} onChange={(e) => setF('electricity_meter_id', e.target.value)} placeholder="T.ex. 735999..." />
                <Input label="Vattenmätarnummer" value={apartmentFormData.water_meter_id} onChange={(e) => setF('water_meter_id', e.target.value)} placeholder="T.ex. WM-..." />
                <Input label="Värmemätarnummer" value={apartmentFormData.heat_meter_id} onChange={(e) => setF('heat_meter_id', e.target.value)} placeholder="T.ex. HM-..." />
                <Input label="Ventilationsaggregat-ID" value={apartmentFormData.ventilation_unit_id} onChange={(e) => setF('ventilation_unit_id', e.target.value)} placeholder="T.ex. FTX-04" />
                <Input label="Senaste renovering (år)" type="number" value={apartmentFormData.last_renovation_year} onChange={(e) => setF('last_renovation_year', e.target.value)} placeholder="T.ex. 2019" />
              </div>
            </div>

            {/* Notes */}
            <div>
              <Textarea label="Interna anteckningar" value={apartmentFormData.technical_notes} onChange={(e) => setF('technical_notes', e.target.value)} rows={3} placeholder="Övrig teknisk info för personal..." />
            </div>
          </div>
        )}

        </fieldset>
      </Modal>
      <Modal open={!!discard} onClose={()=>setDiscard(null)} title="Lämna utan att spara?" size="sm" footer={<><Button variant="secondary" onClick={()=>setDiscard(null)}>Fortsätt redigera</Button><Button variant="danger" onClick={()=>discard&&closeEditor(discard,true)}>Lämna utan att spara</Button></>}><p className="text-sm text-vihem-muted">Du har ändrat uppgifter. Spara dem innan du lämnar för att behålla ändringarna.</p></Modal>
    </div>
  );
}

// Same "Avtal" pattern AdminTenantsPage.tsx already has for a hyresgäst --
// a lightweight count (not the full list; that lives in Avtal V2 itself)
// plus a "Skapa avtal" deep link, via the generic entity-link table
// (entity_type='apartment').
function ApartmentAgreementsLink({ apartmentId, onCreateAgreement }: { apartmentId: string; onCreateAgreement: () => void }) {
  const [agreements, setAgreements] = useState<AgreementListItem[]>([]);

  useEffect(() => {
    listEntityAgreements('apartment', apartmentId).then(setAgreements).catch(() => setAgreements([]));
  }, [apartmentId]);

  return (
    <div className="flex items-center gap-2 text-xs mt-2">
      <Button size="sm" variant="ghost" onClick={onCreateAgreement}>
        <FileSignature className="w-4 h-4" /> Skapa avtal
      </Button>
      {agreements.length > 0 && (
        <span className="text-slate-400">· {agreements.length} kopplat{agreements.length === 1 ? '' : 'e'} avtal</span>
      )}
    </div>
  );
}
