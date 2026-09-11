import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit2, Home, Mail, Phone, KeyRound, RefreshCw, FileSignature, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createUserAccount, resetUserPassword, sendUserPasswordResetEmail } from '../lib/userAdmin';
import { normalizePersonalNumber, lastDiscountEligibleMonthEnd } from '../lib/bankid';
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Select,
  PageHeader,
  EmptyState,
  LoadingPage,
  SearchInput,
} from '../components/ui';
import { formatDate, formatCurrency, RENT_VAT_OPTIONS } from '../lib/utils';
import { Profile, Tenancy, Apartment, Property, FinanceCompany } from '../types';
import { listEntityAgreements } from '../modules/agreements-v2/api';
import type { AgreementListItem } from '../modules/agreements-v2/types';

interface Addon { description: string; amount: string; }
const emptyAddon: Addon = { description: '', amount: '' };

interface AdminTenantsPageProps { onNavigate: (page: string) => void; }
export function AdminTenantsPage({ onNavigate }: AdminTenantsPageProps) {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<Profile[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [companies, setCompanies] = useState<FinanceCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<Profile | null>(null);
  const [tenantAgreements, setTenantAgreements] = useState<AgreementListItem[]>([]);
  const [editingTenant, setEditingTenant] = useState<Profile | null>(null);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showLinkTenancyModal, setShowLinkTenancyModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [resetCredentials, setResetCredentials] = useState<{ email: string } | null>(null);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState('');
  const [tenantFormData, setTenantFormData] = useState({
    name: '',
    email: '',
    phone: '',
    active: true,
    bankid_personal_number: '',
    // Tenancy fields (for new tenant)
    property_id: '',
    apartment_id: '',
    start_date: '',
    monthly_rent: '',
    rent_vat_rate: '0',
    company_id: '',
    addons: [] as Addon[],
    rent_override_choice: '' as '' | 'update_apartment' | 'temporary_note',
    discount_percent: '',
    discount_age_based: false,
    discount_age_limit: '25',
  });
  const [linkTenancyFormData, setLinkTenancyFormData] = useState({
    apartment_id: '',
    start_date: '',
    monthly_rent: '',
    rent_vat_rate: '0',
    company_id: '',
    addons: [] as Addon[],
    rent_override_choice: '' as '' | 'update_apartment' | 'temporary_note',
    discount_percent: '',
    discount_age_based: false,
    discount_age_limit: '25',
  });

  useEffect(() => {
    fetchData();
  }, []);

  // Avtal V2 (beta): agreements linked to the selected tenant via the
  // generic entity-link table. Best-effort -- never blocks the rest of
  // the tenant detail view from rendering.
  useEffect(() => {
    if (!selectedTenant) { setTenantAgreements([]); return; }
    listEntityAgreements('tenant', selectedTenant.id).then(setTenantAgreements).catch(() => setTenantAgreements([]));
  }, [selectedTenant]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [tenantsRes, tenanciesRes, aptsRes, propsRes, companiesRes] = await Promise.all([
        supabase.from('vihem_profiles').select('*').eq('role', 'tenant').order('name'),
        supabase.from('vihem_tenancies').select('*'),
        supabase.from('vihem_apartments').select('*'),
        supabase.from('vihem_properties').select('*'),
        supabase.from('vihem_companies').select('id, name').order('name'),
      ]);
      if (tenantsRes.data) setTenants(tenantsRes.data);
      if (tenanciesRes.data) setTenancies(tenanciesRes.data);
      if (aptsRes.data) setApartments(aptsRes.data);
      if (propsRes.data) setProperties(propsRes.data);
      if (companiesRes.data) setCompanies(companiesRes.data as FinanceCompany[]);
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

  // Grouped by fastighet, each group sorted by lägenhetsnummer -- otherwise
  // apartments from every property show up interleaved in one flat list.
  const getAvailableApartmentsByProperty = () => {
    const groups = new Map<string, Apartment[]>();
    for (const apt of getAvailableApartments()) {
      const list = groups.get(apt.property_id) || [];
      list.push(apt);
      groups.set(apt.property_id, list);
    }
    return Array.from(groups.entries())
      .map(([propertyId, apts]) => ({
        property: getPropertyInfo(propertyId),
        apartments: apts.slice().sort((a, b) => a.apartment_number.localeCompare(b.apartment_number, 'sv', { numeric: true })),
      }))
      .sort((a, b) => (a.property?.name || '').localeCompare(b.property?.name || '', 'sv'));
  };

  // A lease's "bolag" (for its tillval invoicing) defaults to whatever the
  // apartment/property is already tagged with, when that's set -- staff can
  // still override it, since many existing properties have no company_id yet.
  const resolveCompanyId = (apt?: Apartment) => {
    if (!apt) return '';
    const prop = getPropertyInfo(apt.property_id);
    return apt.company_id || prop?.company_id || '';
  };

  const saveAddonsForTenancy = async (tenancyId: string, companyId: string, startDate: string, addons: Addon[], vatRate: number) => {
    const period = `${startDate.slice(0, 7)}-01`;
    const rows = addons
      .filter((a) => a.description.trim() && Number(a.amount) !== 0 && !Number.isNaN(Number(a.amount)))
      .map((a) => ({
        organisation_id: user?.organisation_id,
        company_id: companyId,
        tenancy_id: tenancyId,
        rent_period: period,
        description: a.description.trim(),
        amount: Number(a.amount),
        vat_rate: vatRate,
        adjustment_type: 'recurring',
        start_period: period,
        end_period: null,
        status: 'active',
        created_by: user?.id,
      }));
    if (rows.length === 0) return;
    const { error } = await supabase.from('vihem_rent_adjustments').insert(rows);
    if (error) throw error;
  };

  const saveDiscountForTenancy = async (
    tenancyId: string,
    companyId: string,
    startDate: string,
    discountPercent: string,
    ageBased: boolean,
    ageLimit: string,
    personalNumber: string,
  ) => {
    const percent = Number(discountPercent);
    if (!percent) return;
    const period = `${startDate.slice(0, 7)}-01`;
    let endPeriod: string | null = null;
    if (ageBased) {
      const cutoff = lastDiscountEligibleMonthEnd(personalNumber, Number(ageLimit) || 25);
      if (!cutoff) throw new Error('Kunde inte räkna ut åldersgränsen för rabatten.');
      endPeriod = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    }
    const description = ageBased ? `Rabatt ${percent}% (till fyllda ${ageLimit} år)` : `Rabatt ${percent}%`;
    const { error } = await supabase.from('vihem_rent_adjustments').insert({
      organisation_id: user?.organisation_id,
      company_id: companyId,
      tenancy_id: tenancyId,
      rent_period: period,
      description,
      amount: 0,
      percentage_rate: -Math.abs(percent),
      vat_rate: 0,
      adjustment_type: 'indexed',
      start_period: period,
      end_period: endPeriod,
      status: 'active',
      created_by: user?.id,
    });
    if (error) throw error;
  };

  const applyRentOverride = async (
    apt: Apartment,
    choice: '' | 'update_apartment' | 'temporary_note',
    newRent: number,
    tenantName: string,
    startDate: string,
  ) => {
    if (!choice || newRent === apt.rent) return;
    if (choice === 'update_apartment') {
      const { error } = await supabase.from('vihem_apartments').update({ rent: newRent }).eq('id', apt.id);
      if (error) throw error;
    } else {
      const direction = newRent > apt.rent ? 'höjning' : 'sänkning';
      const note = `Tillfällig ${direction}: ${tenantName} betalar ${newRent.toLocaleString('sv-SE')} kr fr.o.m. ${startDate} (ordinarie hyra ${apt.rent.toLocaleString('sv-SE')} kr).`;
      const combined = apt.notes ? `${apt.notes}\n${note}` : note;
      const { error } = await supabase.from('vihem_apartments').update({ notes: combined }).eq('id', apt.id);
      if (error) throw error;
    }
  };

  const handleSaveTenant = async () => {
    const rawPno = tenantFormData.bankid_personal_number.trim();
    const normalizedPno = rawPno ? normalizePersonalNumber(rawPno) : null;
    if (rawPno && !normalizedPno) {
      setSaveError('Personnumret måste vara 10 eller 12 siffror, t.ex. 199001011234 eller 900101-1234.');
      return;
    }
    if (!editingTenant) {
      const needsCompany = tenantFormData.addons.some((a) => a.description.trim()) || !!Number(tenantFormData.discount_percent);
      if (needsCompany && !tenantFormData.company_id) {
        setSaveError('Välj bolag för att kunna lägga till tillval eller rabatt.');
        return;
      }
      const aptForTenancy = apartments.find((a) => a.id === tenantFormData.apartment_id);
      const typedRent = Number(tenantFormData.monthly_rent) || 0;
      if (aptForTenancy && aptForTenancy.rent > 0 && typedRent > 0 && typedRent !== aptForTenancy.rent && !tenantFormData.rent_override_choice) {
        setSaveError('Ange om den ändrade hyran ska uppdatera lägenhetens ordinarie hyra eller bara gälla tillfälligt.');
        return;
      }
      if (tenantFormData.discount_age_based && Number(tenantFormData.discount_percent) && !normalizePersonalNumber(tenantFormData.bankid_personal_number)) {
        setSaveError('Ange hyresgästens personnummer för att kunna räkna ut en åldersrelaterad rabatt.');
        return;
      }
    }
    setSaving(true);
    setSaveError('');
    try {
      if (editingTenant) {
        const { error } = await supabase
          .from('vihem_profiles')
          .update({ name: tenantFormData.name, phone: tenantFormData.phone, active: tenantFormData.active, bankid_personal_number: normalizedPno })
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

        // Personnummer isn't part of vihem-create-user's own input --
        // written as a direct follow-up update instead, same as every
        // other admin-editable profile field this page manages post-creation.
        if (normalizedPno && newAccount.user_id) {
          const { error: pnoError } = await supabase.from('vihem_profiles').update({ bankid_personal_number: normalizedPno }).eq('id', newAccount.user_id);
          if (pnoError) throw pnoError;
        }

        // Create tenancy if apartment selected
        if (newAccount.user_id && tenantFormData.apartment_id && tenantFormData.start_date) {
          const rentVatRate = parseFloat(tenantFormData.rent_vat_rate) || 0;
          const { data: newTenancy, error: tenancyError } = await supabase.from('vihem_tenancies').insert({
            tenant_id: newAccount.user_id,
            apartment_id: tenantFormData.apartment_id,
            property_id: tenantFormData.property_id || null,
            organisation_id: user?.organisation_id,
            company_id: tenantFormData.company_id || null,
            start_date: tenantFormData.start_date,
            monthly_rent: parseFloat(tenantFormData.monthly_rent) || 0,
            rent_vat_rate: rentVatRate,
            status: 'active',
          }).select('id').single();
          if (tenancyError) throw tenancyError;

          // Mark apartment as rented
          const { error: apartmentError } = await supabase
            .from('vihem_apartments')
            .update({ status: 'rented' })
            .eq('id', tenantFormData.apartment_id);
          if (apartmentError) throw apartmentError;

          if (newTenancy && tenantFormData.addons.some((a) => a.description.trim())) {
            await saveAddonsForTenancy(newTenancy.id, tenantFormData.company_id, tenantFormData.start_date, tenantFormData.addons, rentVatRate);
          }
          if (newTenancy && Number(tenantFormData.discount_percent)) {
            await saveDiscountForTenancy(newTenancy.id, tenantFormData.company_id, tenantFormData.start_date, tenantFormData.discount_percent, tenantFormData.discount_age_based, tenantFormData.discount_age_limit, normalizedPno || '');
          }
          const aptForTenancy = apartments.find((a) => a.id === tenantFormData.apartment_id);
          if (aptForTenancy) {
            await applyRentOverride(aptForTenancy, tenantFormData.rent_override_choice, parseFloat(tenantFormData.monthly_rent) || 0, tenantFormData.name, tenantFormData.start_date);
          }
        }

        setCreatedCredentials({ email: tenantFormData.email, tempPassword: newAccount.temp_password });
      }
      setShowTenantModal(false);
      setEditingTenant(null);
      setTenantFormData({ name: '', email: '', phone: '', active: true, bankid_personal_number: '', property_id: '', apartment_id: '', start_date: '', monthly_rent: '', rent_vat_rate: '0', company_id: '', addons: [], rent_override_choice: '', discount_percent: '', discount_age_based: false, discount_age_limit: '25' });
      fetchData();
    } catch (error: any) {
      console.error('Error saving tenant:', error);
      setSaveError(error.message || 'Kunde inte spara hyresgästen');
    } finally {
      setSaving(false);
    }
  };

  const handleLinkTenancy = async () => {
    if (!selectedTenant) return;
    const needsCompany = linkTenancyFormData.addons.some((a) => a.description.trim()) || !!Number(linkTenancyFormData.discount_percent);
    if (needsCompany && !linkTenancyFormData.company_id) {
      setSaveError('Välj bolag för att kunna lägga till tillval eller rabatt.');
      return;
    }
    const aptForLink = getApartmentInfo(linkTenancyFormData.apartment_id);
    const typedRent = Number(linkTenancyFormData.monthly_rent) || 0;
    if (aptForLink && aptForLink.rent > 0 && typedRent > 0 && typedRent !== aptForLink.rent && !linkTenancyFormData.rent_override_choice) {
      setSaveError('Ange om den ändrade hyran ska uppdatera lägenhetens ordinarie hyra eller bara gälla tillfälligt.');
      return;
    }
    const tenantPno = normalizePersonalNumber(selectedTenant.bankid_personal_number || '');
    if (linkTenancyFormData.discount_age_based && Number(linkTenancyFormData.discount_percent) && !tenantPno) {
      setSaveError('Hyresgästen saknar personnummer -- kan inte räkna ut en åldersrelaterad rabatt.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const apt = getApartmentInfo(linkTenancyFormData.apartment_id);
      const rentVatRate = parseFloat(linkTenancyFormData.rent_vat_rate) || 0;
      const { data: newTenancy, error } = await supabase.from('vihem_tenancies').insert({
        tenant_id: selectedTenant.id,
        apartment_id: linkTenancyFormData.apartment_id,
        property_id: apt?.property_id || null,
        organisation_id: user?.organisation_id,
        company_id: linkTenancyFormData.company_id || null,
        start_date: linkTenancyFormData.start_date,
        monthly_rent: parseFloat(linkTenancyFormData.monthly_rent),
        rent_vat_rate: rentVatRate,
        status: 'active',
      }).select('id').single();
      if (error) throw error;

      // Unlike the "Ny hyresgäst" flow, linking an existing tenant to an
      // apartment never marked it rented -- it stayed "Ledig" and could be
      // linked to a second tenant at the same time.
      const { error: apartmentError } = await supabase
        .from('vihem_apartments')
        .update({ status: 'rented' })
        .eq('id', linkTenancyFormData.apartment_id);
      if (apartmentError) throw apartmentError;

      if (newTenancy && linkTenancyFormData.addons.some((a) => a.description.trim())) {
        await saveAddonsForTenancy(newTenancy.id, linkTenancyFormData.company_id, linkTenancyFormData.start_date, linkTenancyFormData.addons, rentVatRate);
      }
      if (newTenancy && Number(linkTenancyFormData.discount_percent)) {
        await saveDiscountForTenancy(newTenancy.id, linkTenancyFormData.company_id, linkTenancyFormData.start_date, linkTenancyFormData.discount_percent, linkTenancyFormData.discount_age_based, linkTenancyFormData.discount_age_limit, tenantPno);
      }
      if (apt) {
        await applyRentOverride(apt, linkTenancyFormData.rent_override_choice, typedRent, selectedTenant.name || '', linkTenancyFormData.start_date);
      }

      setShowLinkTenancyModal(false);
      setLinkTenancyFormData({ apartment_id: '', start_date: '', monthly_rent: '', rent_vat_rate: '0', company_id: '', addons: [], rent_override_choice: '', discount_percent: '', discount_age_based: false, discount_age_limit: '25' });
      fetchData();
    } catch (error: any) {
      console.error('Error linking tenancy:', error);
      setSaveError(error.message || 'Kunde inte länka hyresförhållandet');
    } finally {
      setSaving(false);
    }
  };

  const openEditTenantModal = (tenant: Profile) => {
    setTenantFormData({
      name: tenant.name || '',
      email: tenant.email || '',
      phone: tenant.phone || '',
      active: tenant.active !== false,
      bankid_personal_number: tenant.bankid_personal_number || '',
      property_id: '',
      apartment_id: '',
      start_date: '',
      monthly_rent: '',
      rent_vat_rate: '0',
      company_id: '',
      addons: [],
      rent_override_choice: '',
      discount_percent: '',
      discount_age_based: false,
      discount_age_limit: '25',
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

  // Generates a new temporary password directly, for sharing with the
  // tenant (e.g. verbally, SMS) instead of relying on them receiving a
  // reset email -- separate action from handleResetPassword above, which
  // just sends a link. The tenant changes it themselves after logging in,
  // same as the temp password shown right after creating an account.
  const handleGeneratePassword = async (tenant: Profile) => {
    try {
      setResettingUserId(tenant.id);
      const result = await resetUserPassword(tenant.id);
      setGeneratedCredentials({ email: result.email, tempPassword: result.temp_password });
    } catch (err: any) {
      alert(err.message || 'Kunde inte generera nytt lösenord');
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
                setTenantFormData({ name: '', email: '', phone: '', active: true, bankid_personal_number: '', property_id: '', apartment_id: '', start_date: '', monthly_rent: '', rent_vat_rate: '0', company_id: '', addons: [], rent_override_choice: '', discount_percent: '', discount_age_based: false, discount_age_limit: '25' });
                setSaveError('');
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
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleResetPassword(tenant);
                              }}
                              disabled={resettingUserId === tenant.id}
                              title="Skicka återställningslänk via e-post"
                              className="p-2 hover:bg-slate-100 rounded-lg inline-block transition-colors disabled:opacity-50"
                            >
                              <KeyRound className="w-4 h-4 text-slate-500" />
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleGeneratePassword(tenant);
                              }}
                              disabled={resettingUserId === tenant.id}
                              title="Generera nytt lösenord"
                              className="p-2 hover:bg-slate-100 rounded-lg inline-block transition-colors disabled:opacity-50"
                            >
                              <RefreshCw className="w-4 h-4 text-slate-500" />
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
                    title="Skicka återställningslänk via e-post"
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <KeyRound className="w-4 h-4 text-slate-600" />
                  </button>
                  <button
                    onClick={() => handleGeneratePassword(selectedTenant)}
                    disabled={resettingUserId === selectedTenant.id}
                    title="Generera nytt lösenord"
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4 text-slate-600" />
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
                onClick={() => { setSaveError(''); setShowLinkTenancyModal(true); }}
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
                            <p className="font-medium text-slate-800">
                              {formatCurrency(tenancy.monthly_rent)}
                              {tenancy.rent_vat_rate > 0 && <span className="text-slate-500 font-normal"> + {tenancy.rent_vat_rate}% moms</span>}
                            </p>
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

            {/* Avtal V2 (beta) -- linked via the generic entity-link
                table (entity_type='tenant'), never a dedicated FK column
                here. "+ Skapa avtal" just opens the module; it doesn't
                deep-link a prefilled draft yet (the app's navigation is a
                flat page-key switch with no query-param/context passing
                between pages), so the admin picks/links this tenant from
                inside Avtal V2 itself for now -- see docs/agreements-v2.md
                "Öppna frågor" for the deferred deep-prefill flow. */}
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                  <FileSignature className="h-4 w-4 text-blue-600" /> Avtal
                </h3>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('agreements-v2')} className="gap-2">
                  <Plus className="w-4 h-4" /> Skapa avtal
                </Button>
              </div>
              {tenantAgreements.length === 0 ? (
                <p className="text-sm text-slate-500">Inga avtal kopplade till denna hyresgäst ännu.</p>
              ) : (
                <div className="space-y-2">
                  {tenantAgreements.map((doc) => (
                    <Card key={doc.id} className="flex items-center justify-between p-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{doc.title || doc.document_number}</p>
                        <p className="text-xs text-slate-500">{doc.document_number}</p>
                      </div>
                      <Badge className="bg-slate-100 text-slate-600">{doc.status}</Badge>
                    </Card>
                  ))}
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
              <Input
                label="Personnummer (för BankID-inloggning)"
                value={tenantFormData.bankid_personal_number}
                onChange={(e) => setTenantFormData({ ...tenantFormData, bankid_personal_number: e.target.value })}
                placeholder="T.ex. 199001011234 eller 900101-1234"
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
                    {properties.slice().sort((a, b) => a.name.localeCompare(b.name, 'sv')).map((p) => (
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
                        company_id: resolveCompanyId(apt),
                        rent_override_choice: '',
                      });
                    }}
                    disabled={!tenantFormData.property_id}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Välj lägenhet</option>
                    {apartments
                      .filter((a) => a.property_id === tenantFormData.property_id && a.status !== 'rented')
                      .sort((a, b) => a.apartment_number.localeCompare(b.apartment_number, 'sv', { numeric: true }))
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
                <Select
                  label="Moms på hyra"
                  value={tenantFormData.rent_vat_rate}
                  onChange={(e) => setTenantFormData({ ...tenantFormData, rent_vat_rate: e.target.value })}
                  options={RENT_VAT_OPTIONS}
                  hint="Endast vid uthyrning till momsregistrerat företag (frivillig skattskyldighet). Annars momsfritt."
                />

                {!tenantFormData.apartment_id && (
                  <p className="text-xs text-slate-400">Lämna lägenhet tom för att skapa hyresgästen utan hyresförhållande.</p>
                )}

                {tenantFormData.apartment_id && (
                  <>
                    <RentAdjustmentSection
                      apartment={apartments.find((a) => a.id === tenantFormData.apartment_id)}
                      monthlyRent={tenantFormData.monthly_rent}
                      personalNumber={normalizePersonalNumber(tenantFormData.bankid_personal_number)}
                      fields={tenantFormData}
                      onChange={(patch) => setTenantFormData({ ...tenantFormData, ...patch })}
                    />
                    <AddonsEditor
                      companyId={tenantFormData.company_id}
                      onCompanyChange={(v) => setTenantFormData({ ...tenantFormData, company_id: v })}
                      companies={companies}
                      addons={tenantFormData.addons}
                      onAddonsChange={(addons) => setTenantFormData({ ...tenantFormData, addons })}
                    />
                  </>
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
        onClose={() => { setShowLinkTenancyModal(false); setSaveError(''); }}
        title="Länka hyresförhållande"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Lägenhet</label>
            <select
              value={linkTenancyFormData.apartment_id}
              onChange={(e) => {
                const apt = apartments.find((a) => a.id === e.target.value);
                setLinkTenancyFormData({
                  ...linkTenancyFormData,
                  apartment_id: e.target.value,
                  monthly_rent: apt?.rent ? String(apt.rent) : linkTenancyFormData.monthly_rent,
                  company_id: resolveCompanyId(apt),
                  rent_override_choice: '',
                });
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Välj en lägenhet</option>
              {getAvailableApartmentsByProperty().map((group) => (
                <optgroup key={group.property?.id || 'unknown'} label={group.property?.name || 'Okänd fastighet'}>
                  {group.apartments.map((apt) => (
                    <option key={apt.id} value={apt.id}>
                      Lägenhet {apt.apartment_number} ({apt.size} m²)
                    </option>
                  ))}
                </optgroup>
              ))}
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
          <Select
            label="Moms på hyra"
            value={linkTenancyFormData.rent_vat_rate}
            onChange={(e) => setLinkTenancyFormData({ ...linkTenancyFormData, rent_vat_rate: e.target.value })}
            options={RENT_VAT_OPTIONS}
            hint="Endast vid uthyrning till momsregistrerat företag (frivillig skattskyldighet). Annars momsfritt."
          />

          {linkTenancyFormData.apartment_id && (
            <>
              <RentAdjustmentSection
                apartment={apartments.find((a) => a.id === linkTenancyFormData.apartment_id)}
                monthlyRent={linkTenancyFormData.monthly_rent}
                personalNumber={normalizePersonalNumber(selectedTenant?.bankid_personal_number || '')}
                fields={linkTenancyFormData}
                onChange={(patch) => setLinkTenancyFormData({ ...linkTenancyFormData, ...patch })}
              />
              <AddonsEditor
                companyId={linkTenancyFormData.company_id}
                onCompanyChange={(v) => setLinkTenancyFormData({ ...linkTenancyFormData, company_id: v })}
                companies={companies}
                addons={linkTenancyFormData.addons}
                onAddonsChange={(addons) => setLinkTenancyFormData({ ...linkTenancyFormData, addons })}
              />
            </>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {saveError}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => { setShowLinkTenancyModal(false); setSaveError(''); }}>Avbryt</Button>
            <Button variant="primary" onClick={handleLinkTenancy} loading={saving}>Länka</Button>
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

      <Modal
        open={!!generatedCredentials}
        onClose={() => setGeneratedCredentials(null)}
        title="Nytt lösenord genererat"
      >
        {generatedCredentials && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900 mb-1">Lösenordet är uppdaterat</p>
              <p className="text-sm text-green-800">
                Hyresgästen kan logga in med <strong>{generatedCredentials.email}</strong> och lösenordet nedan.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-amber-900 uppercase mb-2">Tillfälligt lösenord</p>
              <p className="text-xs text-amber-700 mb-2">Dela lösenordet säkert och be hyresgästen byta det efter inloggning.</p>
              <code className="block bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono text-amber-900 select-all">
                {generatedCredentials.tempPassword}
              </code>
            </div>
            <Button variant="primary" className="w-full" onClick={() => setGeneratedCredentials(null)}>
              Stäng
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface RentAdjustmentFields {
  rent_override_choice: '' | 'update_apartment' | 'temporary_note';
  discount_percent: string;
  discount_age_based: boolean;
  discount_age_limit: string;
}

// Surfaces when the typed rent differs from the apartment's own rent (staff
// must explicitly say whether that's a permanent change to the apartment's
// rent or a note-only, tenant-specific deviation), plus an optional
// percentage rent discount -- either open-ended or automatically cut off
// the month before the tenant turns a given age, computed from their
// personnummer.
function RentAdjustmentSection({ apartment, monthlyRent, personalNumber, fields, onChange }: {
  apartment?: Apartment;
  monthlyRent: string;
  personalNumber: string;
  fields: RentAdjustmentFields;
  onChange: (patch: Partial<RentAdjustmentFields>) => void;
}) {
  const typedRent = Number(monthlyRent) || 0;
  const hasConflict = !!apartment && apartment.rent > 0 && typedRent > 0 && typedRent !== apartment.rent;

  const ageCutoff = fields.discount_age_based && personalNumber
    ? lastDiscountEligibleMonthEnd(personalNumber, Number(fields.discount_age_limit) || 25)
    : null;

  return (
    <div className="space-y-4">
      {hasConflict && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <p className="text-sm font-medium text-amber-900">
            Hyran ({typedRent.toLocaleString('sv-SE')} kr) skiljer sig från lägenhetens ordinarie hyra ({apartment!.rent.toLocaleString('sv-SE')} kr).
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="rent-override-choice"
              checked={fields.rent_override_choice === 'update_apartment'}
              onChange={() => onChange({ rent_override_choice: 'update_apartment' })}
              className="mt-1"
            />
            <span className="text-sm text-amber-900">Uppdatera lägenhetens ordinarie hyra till {typedRent.toLocaleString('sv-SE')} kr</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="rent-override-choice"
              checked={fields.rent_override_choice === 'temporary_note'}
              onChange={() => onChange({ rent_override_choice: 'temporary_note' })}
              className="mt-1"
            />
            <span className="text-sm text-amber-900">Nej, tillfällig {typedRent > apartment!.rent ? 'höjning' : 'sänkning'} -- lägg till en anmärkning på lägenheten så båda beloppen syns</span>
          </label>
        </div>
      )}

      <div className="border-t border-slate-200 pt-3 space-y-3">
        <p className="text-sm font-medium text-slate-700">Rabatt på hyran</p>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Rabatt (%)"
            type="number"
            value={fields.discount_percent}
            onChange={(e) => onChange({ discount_percent: e.target.value })}
            placeholder="T.ex. 10"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={fields.discount_age_based}
            onChange={(e) => onChange({ discount_age_based: e.target.checked })}
            className="w-4 h-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Åldersrelaterad -- upphör automatiskt vid en viss ålder</span>
        </label>
        {fields.discount_age_based && (
          <div className="pl-6 space-y-1">
            <Input
              label="Gäller till fyllda år"
              type="number"
              value={fields.discount_age_limit}
              onChange={(e) => onChange({ discount_age_limit: e.target.value })}
              placeholder="25"
            />
            {!personalNumber && (
              <p className="text-xs text-red-600">Hyresgästen saknar personnummer -- kan inte räkna ut åldern automatiskt.</p>
            )}
            {personalNumber && !ageCutoff && (
              <p className="text-xs text-red-600">Kunde inte tolka personnumret.</p>
            )}
            {ageCutoff && (
              <p className="text-xs text-slate-500">
                Rabatten läggs på hyror t.o.m. {ageCutoff.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long' })}.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Bolag + tillval (parkering, extra förråd, etc.) for a lease being created
// or linked -- each tillval becomes a recurring vihem_rent_adjustments row
// once the tenancy is saved, so it flows into the same monthly fakturaunderlag
// as the rent itself instead of being tracked separately.
function AddonsEditor({ companyId, onCompanyChange, companies, addons, onAddonsChange }: {
  companyId: string;
  onCompanyChange: (value: string) => void;
  companies: FinanceCompany[];
  addons: Addon[];
  onAddonsChange: (addons: Addon[]) => void;
}) {
  const updateAddon = (index: number, patch: Partial<Addon>) => {
    onAddonsChange(addons.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  const removeAddon = (index: number) => {
    onAddonsChange(addons.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-slate-200 pt-3 space-y-3">
      <Select
        label="Bolag"
        value={companyId}
        onChange={(e) => onCompanyChange(e.target.value)}
        options={[{ value: '', label: 'Välj bolag' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
        hint="Krävs bara om tillval läggs till nedan -- avgör vilket bolag som fakturerar dem."
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-slate-700">Tillval utöver hyran</p>
          <button
            type="button"
            onClick={() => onAddonsChange([...addons, { ...emptyAddon }])}
            className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
          >
            <Plus className="w-3.5 h-3.5" /> Lägg till tillval
          </button>
        </div>
        {addons.length === 0 ? (
          <p className="text-xs text-slate-400">T.ex. parkeringsplats eller extra förråd -- läggs till som ett återkommande tillägg på hyresavin.</p>
        ) : (
          <div className="space-y-2">
            {addons.map((addon, index) => (
              <div key={index} className="flex gap-2 items-start">
                <div className="flex-1">
                  <Input
                    value={addon.description}
                    onChange={(e) => updateAddon(index, { description: e.target.value })}
                    placeholder="T.ex. Parkeringsplats"
                  />
                </div>
                <div className="w-28">
                  <Input
                    type="number"
                    value={addon.amount}
                    onChange={(e) => updateAddon(index, { amount: e.target.value })}
                    placeholder="Kr/mån"
                  />
                </div>
                <button type="button" onClick={() => removeAddon(index)} className="p-2 mt-0.5 hover:bg-red-50 rounded-lg shrink-0">
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
