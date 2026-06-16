import React, { useState, useEffect } from 'react';
import {
  Building2, Plus, Edit2, Home, Users, ChevronRight,
  Key, Network, Zap, Droplets, Thermometer, Wind,
  Lock, MailOpen, CarFront, Package, Layers,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card, Badge, Button, Modal, Input, Textarea,
  PageHeader, EmptyState, LoadingPage, SearchInput,
} from '../components/ui';
import {
  formatCurrency, APARTMENT_STATUS_LABELS, getAptStatusColor,
} from '../lib/utils';
import { Property, Apartment, Tenancy, Profile, KeyRecord, NetworkOutlet, Organisation } from '../types';

const APARTMENT_STATUS_OPTIONS = [
  { value: 'vacant', label: 'Ledig' },
  { value: 'rented', label: 'Uthyrd' },
  { value: 'renovation', label: 'Renovering' },
  { value: 'blocked', label: 'Spärrad' },
  { value: 'terminated', label: 'Uppsagd' },
];

const defaultAptForm = {
  // Basic
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

export function AdminPropertiesPage({ onNavigate: _onNavigate }: AdminPropertiesPageProps) {
  const { user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [orgLimits, setOrgLimits] = useState<{ max_properties: number; max_apartments: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [editingApartment, setEditingApartment] = useState<Apartment | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showApartmentModal, setShowApartmentModal] = useState(false);
  const [aptTab, setAptTab] = useState<'basic' | 'technical'>('basic');

  // Key IDs dynamic list
  const [keyIds, setKeyIds] = useState<KeyRecord[]>([]);
  // Network outlets dynamic list
  const [networkOutlets, setNetworkOutlets] = useState<NetworkOutlet[]>([]);

  const [propertyFormData, setPropertyFormData] = useState({
    name: '', address: '', city: '', zip: '',
    description: '', emergency_info: '', contact_info: '',
  });
  const [apartmentFormData, setApartmentFormData] = useState<AptFormData>(defaultAptForm);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [propsRes, aptsRes, tenanciesRes, profilesRes] = await Promise.all([
        supabase.from('vihem_properties').select('*').order('name'),
        supabase.from('vihem_apartments').select('*').order('apartment_number'),
        supabase.from('vihem_tenancies').select('*'),
        supabase.from('vihem_profiles').select('id, name, email'),
      ]);
      if (propsRes.data) setProperties(propsRes.data);
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
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProperties = properties.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getPropertyApartments = (propertyId: string) =>
    apartments.filter((a) => a.property_id === propertyId);

  const getCurrentTenant = (apartmentId: string): Profile | undefined => {
    const t = tenancies.find(
      (t) => t.apartment_id === apartmentId && t.status === 'active'
    );
    if (!t) return undefined;
    return profiles.find((p) => p.id === t.tenant_id);
  };

  // ── Property save ──────────────────────────────────────────────────────────
  const handleSaveProperty = async () => {
    if (!editingProperty && orgLimits && properties.length >= orgLimits.max_properties) {
      alert(`Licensgränsen för fastigheter är nådd (${orgLimits.max_properties} st). Uppgradera licensen för att lägga till fler.`);
      return;
    }

    const lines = propertyFormData.contact_info.split('\n');
    const contactInfo = {
      property_manager: lines[0] || '',
      phone: lines[1] || '',
      email: lines[2] || '',
    };
    if (editingProperty) {
      await supabase.from('vihem_properties').update({
        name: propertyFormData.name, address: propertyFormData.address,
        city: propertyFormData.city, zip: propertyFormData.zip,
        description: propertyFormData.description,
        emergency_info: propertyFormData.emergency_info,
        contact_info: contactInfo,
      }).eq('id', editingProperty.id);
    } else {
      await supabase.from('vihem_properties').insert({
        name: propertyFormData.name, address: propertyFormData.address,
        city: propertyFormData.city, zip: propertyFormData.zip,
        description: propertyFormData.description,
        emergency_info: propertyFormData.emergency_info,
        contact_info: contactInfo,
        organisation_id: user?.organisation_id,
      });
    }
    setShowPropertyModal(false);
    setEditingProperty(null);
    setPropertyFormData({ name: '', address: '', city: '', zip: '', description: '', emergency_info: '', contact_info: '' });
    fetchData();
  };

  // ── Apartment save ─────────────────────────────────────────────────────────
  const handleSaveApartment = async () => {
    if (!selectedProperty) return;

    // Enforce apartment quota for new vihem_apartments
    if (!editingApartment && orgLimits) {
      if (apartments.length >= orgLimits.max_apartments) {
        alert(`Licensgränsen för lägenheter är nådd (${orgLimits.max_apartments} st). Uppgradera licensen för att lägga till fler.`);
        return;
      }
    }
    const payload = {
      apartment_number: apartmentFormData.apartment_number,
      size: parseFloat(apartmentFormData.size) || 0,
      rooms: parseInt(apartmentFormData.rooms) || 0,
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
      await supabase.from('vihem_apartments').update(payload).eq('id', editingApartment.id);
    } else {
      await supabase.from('vihem_apartments').insert({
        ...payload,
        property_id: selectedProperty.id,
        organisation_id: user?.organisation_id,
      });
    }
    setShowApartmentModal(false);
    setEditingApartment(null);
    setApartmentFormData(defaultAptForm);
    setKeyIds([]);
    setNetworkOutlets([]);
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
    setShowPropertyModal(true);
  };

  const openEditApartmentModal = (apt: Apartment) => {
    setApartmentFormData({
      apartment_number: apt.apartment_number,
      size: String(apt.size), rooms: String(apt.rooms), rent: String(apt.rent),
      floor: String(apt.floor || ''),
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
    setShowApartmentModal(true);
  };

  const openCreateApartmentModal = () => {
    setApartmentFormData(defaultAptForm);
    setKeyIds([]);
    setNetworkOutlets([]);
    setEditingApartment(null);
    setAptTab('basic');
    setShowApartmentModal(true);
  };

  const setF = (key: keyof AptFormData, value: any) =>
    setApartmentFormData(prev => ({ ...prev, [key]: value }));

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Fastigheter" subtitle="Hantera fastigheter och lägenheter" />
        <Button
          onClick={() => {
            if (orgLimits && properties.length >= orgLimits.max_properties) {
              alert(`Licensgränsen för fastigheter är nådd (${orgLimits.max_properties} st). Uppgradera licensen för att lägga till fler.`);
              return;
            }
            setEditingProperty(null);
            setPropertyFormData({ name: '', address: '', city: '', zip: '', description: '', emergency_info: '', contact_info: '' });
            setShowPropertyModal(true);
          }}
          variant="primary"
          className="flex items-center gap-2"
          disabled={!!(orgLimits && properties.length >= orgLimits.max_properties)}
          title={orgLimits && properties.length >= orgLimits.max_properties ? `Licensgräns nådd (${orgLimits.max_properties} fastigheter)` : undefined}
        >
          <Plus className="w-4 h-4" />
          Ny fastighet
        </Button>
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
            <EmptyState icon={<Building2 className="w-12 h-12" />} title="Inga fastigheter" description="Börja med att skapa din första fastighet" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredProperties.map((property) => {
                const apts = getPropertyApartments(property.id);
                const occupied = apts.filter(a => a.status === 'rented').length;
                return (
                  <Card key={property.id} className="cursor-pointer hover:shadow-md transition-shadow p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg mb-1">{property.name}</h3>
                        <p className="text-sm text-slate-600">{property.address}</p>
                        <p className="text-sm text-slate-500">{property.zip} {property.city}</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); openEditPropertyModal(property); }} className="shrink-0 p-2 hover:bg-slate-100 rounded-lg">
                        <Edit2 className="w-4 h-4 text-slate-600" />
                      </button>
                    </div>
                    {property.description && <p className="text-sm text-slate-600 mb-4 leading-relaxed">{property.description}</p>}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 border-t border-b border-slate-100 text-sm">
                      <div className="flex items-center gap-2">
                        <Home className="w-4 h-4 text-blue-500" />
                        <span className="font-medium">{apts.length}</span>
                        <span className="text-slate-500">lägenheter</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-green-500" />
                        <span className="font-medium">{occupied}</span>
                        <span className="text-slate-500">uthyrda</span>
                      </div>
                    </div>
                    <button onClick={() => setSelectedProperty(property)} className="w-full mt-4 flex items-center justify-between text-blue-600 hover:text-blue-700 font-medium text-sm">
                      <span>Visa lägenheter</span>
                      <ChevronRight className="w-4 h-4" />
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
            <div className="flex items-start justify-between mb-2">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedProperty.name}</h2>
                <p className="text-slate-500 text-sm">{selectedProperty.address}, {selectedProperty.zip} {selectedProperty.city}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => openEditPropertyModal(selectedProperty)} className="gap-1">
                  <Edit2 className="w-3.5 h-3.5" /> Redigera
                </Button>
                <Button
                  variant="primary"
                  onClick={openCreateApartmentModal}
                  className="gap-1"
                  disabled={!!(orgLimits && apartments.length >= orgLimits.max_apartments)}
                  title={orgLimits && apartments.length >= orgLimits.max_apartments ? `Licensgräns nådd (${orgLimits.max_apartments} lägenheter)` : undefined}
                >
                  <Plus className="w-3.5 h-3.5" /> Ny lägenhet
                </Button>
              </div>
            </div>
            {selectedProperty.description && <p className="text-sm text-slate-600 mt-2">{selectedProperty.description}</p>}
            {orgLimits && (
              <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg w-fit ${apartments.length >= orgLimits.max_apartments ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
                <Home className="w-3.5 h-3.5" />
                <span>Lägenheter (org-total): <strong>{apartments.length}</strong> / {orgLimits.max_apartments}</span>
                {apartments.length >= orgLimits.max_apartments && <span className="font-semibold">— licensgräns nådd</span>}
              </div>
            )}
          </Card>

          <div className="space-y-3">
            {getPropertyApartments(selectedProperty.id).length === 0 ? (
              <EmptyState icon={<Home className="w-12 h-12" />} title="Inga lägenheter" description="Lägg till din första lägenhet" />
            ) : (
              getPropertyApartments(selectedProperty.id).map((apt) => {
                const tenant = getCurrentTenant(apt.id);
                return (
                  <Card key={apt.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-semibold text-slate-900">Lägenhet {apt.apartment_number}</h4>
                          <Badge className={getAptStatusColor(apt.status) + ' text-xs'}>
                            {APARTMENT_STATUS_LABELS[apt.status as keyof typeof APARTMENT_STATUS_LABELS] || apt.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-2">
                          <div><span className="text-slate-500">Storlek</span><p className="font-medium">{apt.size} m²</p></div>
                          <div><span className="text-slate-500">Rum</span><p className="font-medium">{apt.rooms}</p></div>
                          <div><span className="text-slate-500">Hyra</span><p className="font-medium">{formatCurrency(apt.rent)}</p></div>
                          {apt.floor ? <div><span className="text-slate-500">Våning</span><p className="font-medium">{apt.floor}</p></div> : null}
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
                            <Users className="w-3.5 h-3.5" />
                            <span>Uthyrd till {tenant.name || tenant.email}</span>
                          </div>
                        )}
                      </div>
                      <button onClick={() => openEditApartmentModal(apt)} className="p-2 hover:bg-slate-100 rounded-lg ml-3">
                        <Edit2 className="w-4 h-4 text-slate-500" />
                      </button>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── Property Modal ──────────────────────────────────────────────── */}
      <Modal open={showPropertyModal} onClose={() => { setShowPropertyModal(false); setEditingProperty(null); }} title={editingProperty ? 'Redigera fastighet' : 'Ny fastighet'} size="md">
        <div className="space-y-4">
          <Input label="Namn" value={propertyFormData.name} onChange={(e) => setPropertyFormData({ ...propertyFormData, name: e.target.value })} placeholder="T.ex. Storgatan Fastigheter" />
          <Input label="Adress" value={propertyFormData.address} onChange={(e) => setPropertyFormData({ ...propertyFormData, address: e.target.value })} placeholder="T.ex. Storgatan 123" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Postnummer" value={propertyFormData.zip} onChange={(e) => setPropertyFormData({ ...propertyFormData, zip: e.target.value })} placeholder="123 45" />
            <Input label="Stad" value={propertyFormData.city} onChange={(e) => setPropertyFormData({ ...propertyFormData, city: e.target.value })} placeholder="Stockholm" />
          </div>
          <Textarea label="Beskrivning" value={propertyFormData.description} onChange={(e) => setPropertyFormData({ ...propertyFormData, description: e.target.value })} rows={3} />
          <Textarea label="Nödinformation" value={propertyFormData.emergency_info} onChange={(e) => setPropertyFormData({ ...propertyFormData, emergency_info: e.target.value })} rows={2} />
          <Textarea label="Kontaktuppgifter (namn, telefon, e-post — en per rad)" value={propertyFormData.contact_info} onChange={(e) => setPropertyFormData({ ...propertyFormData, contact_info: e.target.value })} placeholder={"Anna Svensson\n070-123 45 67\nanna@exempel.se"} rows={3} />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => { setShowPropertyModal(false); setEditingProperty(null); }}>Avbryt</Button>
            <Button variant="primary" onClick={handleSaveProperty}>Spara</Button>
          </div>
        </div>
      </Modal>

      {/* ── Apartment Modal ─────────────────────────────────────────────── */}
      <Modal open={showApartmentModal} onClose={() => { setShowApartmentModal(false); setEditingApartment(null); }} title={editingApartment ? 'Redigera lägenhet' : 'Ny lägenhet'} size="xl">
        {/* Tab bar */}
        <div className="flex gap-1 mb-5 p-1 bg-slate-100 rounded-xl">
          {(['basic', 'technical'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setAptTab(tab)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${aptTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab === 'basic' ? 'Grunduppgifter' : 'Teknisk information'}
            </button>
          ))}
        </div>

        {aptTab === 'basic' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Lägenhetsnummer" value={apartmentFormData.apartment_number} onChange={(e) => setF('apartment_number', e.target.value)} placeholder="T.ex. 101" />
              <Input label="Våning" type="number" value={apartmentFormData.floor} onChange={(e) => setF('floor', e.target.value)} placeholder="T.ex. 2" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Input label="Storlek (m²)" type="number" value={apartmentFormData.size} onChange={(e) => setF('size', e.target.value)} placeholder="75" />
              <Input label="Antal rum" type="number" value={apartmentFormData.rooms} onChange={(e) => setF('rooms', e.target.value)} placeholder="3" />
              <Input label="Månadshyra (kr)" type="number" value={apartmentFormData.rent} onChange={(e) => setF('rent', e.target.value)} placeholder="12000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select value={apartmentFormData.status} onChange={(e) => setF('status', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {APARTMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
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
                <button onClick={() => setKeyIds(prev => [...prev, { id: '', label: '', copies: 1 }])} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Lägg till nyckel</button>
              </div>
              {keyIds.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Inga nycklar registrerade</p>
              ) : (
                <div className="space-y-2">
                  {keyIds.map((k, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 items-end">
                      <Input label={i === 0 ? 'Nyckel-ID' : ''} value={k.id} onChange={(e) => setKeyIds(prev => prev.map((x, j) => j === i ? { ...x, id: e.target.value } : x))} placeholder="ID" />
                      <Input label={i === 0 ? 'Beskrivning' : ''} value={k.label} onChange={(e) => setKeyIds(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="T.ex. Ytterdörr" />
                      <div className="flex gap-2 items-end">
                        <Input label={i === 0 ? 'Kopior' : ''} type="number" value={String(k.copies)} onChange={(e) => setKeyIds(prev => prev.map((x, j) => j === i ? { ...x, copies: parseInt(e.target.value) || 1 } : x))} placeholder="1" />
                        <button onClick={() => setKeyIds(prev => prev.filter((_, j) => j !== i))} className="pb-2 text-red-400 hover:text-red-600 text-lg leading-none">×</button>
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
                <button onClick={() => setNetworkOutlets(prev => [...prev, { room: '', port_id: '', switch: '', vlan: '' }])} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Lägg till uttag</button>
              </div>
              {networkOutlets.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Inga nätverksuttag registrerade</p>
              ) : (
                <div className="space-y-2">
                  {networkOutlets.map((n, i) => (
                    <div key={i} className="grid grid-cols-4 gap-2 items-end">
                      <Input label={i === 0 ? 'Rum' : ''} value={n.room} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, room: e.target.value } : x))} placeholder="Vardagsrum" />
                      <Input label={i === 0 ? 'Port-ID' : ''} value={n.port_id} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, port_id: e.target.value } : x))} placeholder="P-24" />
                      <Input label={i === 0 ? 'Switch' : ''} value={n.switch || ''} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, switch: e.target.value } : x))} placeholder="SW-02" />
                      <div className="flex gap-2 items-end">
                        <Input label={i === 0 ? 'VLAN' : ''} value={n.vlan || ''} onChange={(e) => setNetworkOutlets(prev => prev.map((x, j) => j === i ? { ...x, vlan: e.target.value } : x))} placeholder="100" />
                        <button onClick={() => setNetworkOutlets(prev => prev.filter((_, j) => j !== i))} className="pb-2 text-red-400 hover:text-red-600 text-lg leading-none">×</button>
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
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Interna anteckningar</p>
              <Textarea value={apartmentFormData.technical_notes} onChange={(e) => setF('technical_notes', e.target.value)} rows={3} placeholder="Övrig teknisk info för personal..." />
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-5 mt-2 border-t border-slate-100">
          <Button variant="secondary" onClick={() => { setShowApartmentModal(false); setEditingApartment(null); }}>Avbryt</Button>
          <Button variant="primary" onClick={handleSaveApartment}>Spara lägenhet</Button>
        </div>
      </Modal>
    </div>
  );
}
