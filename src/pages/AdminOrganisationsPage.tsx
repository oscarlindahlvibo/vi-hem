import React, { useState, useEffect } from 'react';
import {
  Building2, Plus, Edit2, Check, X, Globe,
  Users, Home, ChevronRight, AlertTriangle, Shield,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Card, Badge, Button, Modal, Input, PageHeader,
  EmptyState, LoadingPage, SearchInput,
} from '../components/ui';
import { formatDate } from '../lib/utils';
import { Organisation } from '../types';

const PLAN_LABELS: Record<string, string> = {
  trial: 'Testperiod',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

const PLAN_COLORS: Record<string, string> = {
  trial: 'bg-slate-100 text-slate-600',
  starter: 'bg-blue-100 text-blue-700',
  professional: 'bg-teal-100 text-teal-700',
  enterprise: 'bg-amber-100 text-amber-700',
};

const PLAN_LIMITS: Record<string, { users: number; apartments: number }> = {
  trial:        { users: 10,  apartments: 5   },
  starter:      { users: 25,  apartments: 25  },
  professional: { users: 100, apartments: 200 },
  enterprise:   { users: 500, apartments: 999 },
};

interface OrgStats {
  id: string;
  member_count: number;
  apartment_count: number;
}

interface OrgFormData {
  name: string;
  slug: string;
  contact_email: string;
  contact_phone: string;
  plan: string;
  max_users: string;
  max_apartments: string;
  active: boolean;
}

const defaultForm: OrgFormData = {
  name: '', slug: '', contact_email: '', contact_phone: '',
  plan: 'trial', max_users: '10', max_apartments: '5', active: true,
};

interface AdminOrganisationsPageProps { onNavigate: (page: string) => void; }

export function AdminOrganisationsPage({ onNavigate: _onNavigate }: AdminOrganisationsPageProps) {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [stats, setStats] = useState<OrgStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organisation | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<OrgFormData>(defaultForm);

  useEffect(() => { fetchOrgs(); }, []);

  const fetchOrgs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('organisations')
      .select('*')
      .order('name');

    if (data) {
      setOrgs(data);
      // Fetch member and apartment counts for each org
      const orgStats = await Promise.all(
        data.map(async (org) => {
          const [membersRes, aptsRes] = await Promise.all([
            supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organisation_id', org.id),
            supabase.from('apartments').select('id', { count: 'exact', head: true }).eq('organisation_id', org.id),
          ]);
          return {
            id: org.id,
            member_count: membersRes.count ?? 0,
            apartment_count: aptsRes.count ?? 0,
          };
        })
      );
      setStats(orgStats);
    }
    setLoading(false);
  };

  const getStats = (orgId: string): OrgStats =>
    stats.find(s => s.id === orgId) ?? { id: orgId, member_count: 0, apartment_count: 0 };

  const handlePlanChange = (plan: string) => {
    const limits = PLAN_LIMITS[plan] ?? { users: 10, apartments: 5 };
    setForm(prev => ({
      ...prev,
      plan,
      max_users: String(limits.users),
      max_apartments: String(limits.apartments),
    }));
  };

  const handleSave = async () => {
    setSaveError('');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        slug: form.slug.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        contact_email: form.contact_email,
        contact_phone: form.contact_phone,
        plan: form.plan,
        max_users: parseInt(form.max_users) || 10,
        max_apartments: parseInt(form.max_apartments) || 5,
        active: form.active,
      };
      if (editingOrg) {
        const { error } = await supabase.from('organisations').update(payload).eq('id', editingOrg.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('organisations').insert(payload);
        if (error) throw error;
      }
      setShowModal(false);
      setEditingOrg(null);
      setForm(defaultForm);
      fetchOrgs();
    } catch (err: any) {
      setSaveError(err.message || 'Ett fel inträffade');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (org: Organisation) => {
    setForm({
      name: org.name, slug: org.slug,
      contact_email: org.contact_email, contact_phone: org.contact_phone,
      plan: org.plan,
      max_users: String(org.max_users),
      max_apartments: String(org.max_apartments),
      active: org.active,
    });
    setEditingOrg(org);
    setSaveError('');
    setShowModal(true);
  };

  const openCreate = () => {
    setForm(defaultForm);
    setEditingOrg(null);
    setSaveError('');
    setShowModal(true);
  };

  const filtered = orgs.filter(
    o => o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
         o.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Superadmin</h1>
            <p className="text-xs text-slate-500">Plattformsadministration</p>
          </div>
        </div>

        <div className="mt-6">
          <PageHeader
            title="Organisationer"
            subtitle="Hantera kundkonton, licenser och kvoter"
            action={
              <Button variant="primary" className="gap-2" onClick={openCreate}>
                <Plus className="w-4 h-4" /> Ny organisation
              </Button>
            }
          />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <p className="text-xs text-slate-500 mb-1">Totalt organisationer</p>
            <p className="text-2xl font-bold text-slate-900">{orgs.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500 mb-1">Aktiva</p>
            <p className="text-2xl font-bold text-green-600">{orgs.filter(o => o.active).length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500 mb-1">Totalt användare</p>
            <p className="text-2xl font-bold text-blue-600">{stats.reduce((s, o) => s + o.member_count, 0)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500 mb-1">Totalt lägenheter</p>
            <p className="text-2xl font-bold text-teal-600">{stats.reduce((s, o) => s + o.apartment_count, 0)}</p>
          </Card>
        </div>

        <div className="mb-5">
          <SearchInput placeholder="Sök organisation..." value={searchQuery} onChange={setSearchQuery} />
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Globe className="w-12 h-12" />} title="Inga organisationer" description="Skapa din första kundorganisation" />
        ) : (
          <div className="space-y-3">
            {filtered.map((org) => {
              const s = getStats(org.id);
              const userPct = org.max_users > 0 ? (s.member_count / org.max_users) * 100 : 0;
              const aptPct = org.max_apartments > 0 ? (s.apartment_count / org.max_apartments) * 100 : 0;
              const userWarning = userPct >= 90;
              const aptWarning = aptPct >= 90;
              const aptAtLimit = s.apartment_count >= org.max_apartments;

              return (
                <Card key={org.id} className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Icon + name */}
                    <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-slate-900">{org.name}</h3>
                        <Badge className={PLAN_COLORS[org.plan]}>
                          {PLAN_LABELS[org.plan] || org.plan}
                        </Badge>
                        {org.active ? (
                          <Badge className="bg-green-100 text-green-700 gap-1 flex items-center">
                            <Check className="w-3 h-3" /> Aktiv
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-500 gap-1 flex items-center">
                            <X className="w-3 h-3" /> Inaktiv
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-mono mb-3">{org.slug}</p>

                      {/* Quota bars */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Users quota */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Users className="w-3 h-3" /> Användare
                            </span>
                            <span className={`text-xs font-medium ${userWarning ? 'text-amber-600' : 'text-slate-600'}`}>
                              {s.member_count} / {org.max_users}
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${userWarning ? 'bg-amber-400' : 'bg-blue-400'}`}
                              style={{ width: `${Math.min(userPct, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Apartments quota */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Home className="w-3 h-3" /> Lägenheter
                              {aptAtLimit && <AlertTriangle className="w-3 h-3 text-red-500" />}
                            </span>
                            <span className={`text-xs font-medium ${aptWarning ? 'text-red-600' : 'text-slate-600'}`}>
                              {s.apartment_count} / {org.max_apartments}
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${aptAtLimit ? 'bg-red-500' : aptWarning ? 'bg-amber-400' : 'bg-teal-400'}`}
                              style={{ width: `${Math.min(aptPct, 100)}%` }}
                            />
                          </div>
                          {aptAtLimit && (
                            <p className="text-xs text-red-600 mt-0.5">Lägenhetskvoten är nådd</p>
                          )}
                        </div>
                      </div>

                      {/* Contact + created */}
                      <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                        <span>{org.contact_email}</span>
                        {org.contact_phone && <span>{org.contact_phone}</span>}
                        <span>Skapad {formatDate(org.created_at)}</span>
                      </div>
                    </div>

                    {/* Edit button */}
                    <button
                      onClick={() => openEdit(org)}
                      className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
                    >
                      <Edit2 className="w-4 h-4 text-slate-500" />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditingOrg(null); }}
        title={editingOrg ? 'Redigera organisation' : 'Ny organisation'}
      >
        <div className="space-y-4">
          <Input
            label="Organisationsnamn"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="T.ex. Bergström Fastigheter AB"
          />
          <Input
            label="Slug (unik URL-identifierare)"
            value={form.slug}
            onChange={e => setForm({ ...form, slug: e.target.value })}
            placeholder="bergstrom-fastigheter"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Kontakt-e-post"
              type="email"
              value={form.contact_email}
              onChange={e => setForm({ ...form, contact_email: e.target.value })}
              placeholder="admin@foretag.se"
            />
            <Input
              label="Telefon"
              value={form.contact_phone}
              onChange={e => setForm({ ...form, contact_phone: e.target.value })}
              placeholder="08-123 456"
            />
          </div>

          {/* Plan + auto-fill limits */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Plan</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(PLAN_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handlePlanChange(value)}
                  className={`py-2 px-2 rounded-lg border text-xs font-medium transition-all ${
                    form.plan === value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Välj plan för att fylla i rekommenderade kvoter automatiskt — eller justera nedan.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input
                label="Max användare"
                type="number"
                value={form.max_users}
                onChange={e => setForm({ ...form, max_users: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-0.5">Personal + admins + hyresgäster</p>
            </div>
            <div>
              <Input
                label="Max lägenheter"
                type="number"
                value={form.max_apartments}
                onChange={e => setForm({ ...form, max_apartments: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-0.5">Totalt i alla fastigheter</p>
            </div>
          </div>

          {editingOrg && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Aktiv (inaktiv = inloggning blockeras)</span>
            </label>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {saveError}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => { setShowModal(false); setEditingOrg(null); }}>
              Avbryt
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              {editingOrg ? 'Spara ändringar' : 'Skapa organisation'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
