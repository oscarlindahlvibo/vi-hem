import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, RevealSecret, SearchInput, Select, Textarea } from '../components/ui';
import { ACCESS_ENTRY_TYPE_LABELS, type AccessEntry, type AccessEntryType } from '../lib/operations';

interface PropertyOption { id: string; name: string }
interface ApartmentOption { id: string; apartment_number: string; property_id: string }

const EMPTY_FORM = {
  id: '',
  name: '',
  entry_type: 'portkod' as AccessEntryType,
  property_id: '',
  apartment_id: '',
  location_note: '',
  instructions: '',
  comments: '',
  secret: '',
  valid_from: '',
  valid_to: '',
  active: true,
};

export function OperationsAccessPage({ propertyId }: { propertyId?: string }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [apartments, setApartments] = useState<ApartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => { fetchAll(); }, [user?.organisation_id, propertyId]);

  async function fetchAll() {
    if (!user?.organisation_id) { setLoading(false); return; }
    setLoading(true);
    setError('');

    let query = supabase
      .from('vihem_access_entries')
      .select('*, property:vihem_properties(name), apartment:vihem_apartments(apartment_number)')
      .eq('organisation_id', user.organisation_id)
      .order('name');
    if (propertyId) query = query.eq('property_id', propertyId);

    const [entriesResult, propertiesResult, apartmentsResult] = await Promise.all([
      query,
      supabase.from('vihem_properties').select('id,name').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_apartments').select('id,apartment_number,property_id').eq('organisation_id', user.organisation_id),
    ]);

    if (entriesResult.error) setError(entriesResult.error.message);
    else setEntries((entriesResult.data || []) as AccessEntry[]);
    setProperties((propertiesResult.data || []) as PropertyOption[]);
    setApartments((apartmentsResult.data || []) as ApartmentOption[]);
    setLoading(false);
  }

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(entry =>
      entry.name.toLowerCase().includes(q) ||
      ACCESS_ENTRY_TYPE_LABELS[entry.entry_type].toLowerCase().includes(q) ||
      (entry.property?.name || '').toLowerCase().includes(q) ||
      entry.location_note.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const apartmentsForProperty = apartments.filter(a => a.property_id === form.property_id);

  function openCreate() {
    setForm({ ...EMPTY_FORM, property_id: propertyId || '' });
    setShowModal(true);
  }

  function openEdit(entry: AccessEntry) {
    setForm({
      id: entry.id,
      name: entry.name,
      entry_type: entry.entry_type,
      property_id: entry.property_id || '',
      apartment_id: entry.apartment_id || '',
      location_note: entry.location_note,
      instructions: entry.instructions,
      comments: entry.comments,
      secret: '',
      valid_from: entry.valid_from || '',
      valid_to: entry.valid_to || '',
      active: entry.active,
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Namn krävs.'); return; }
    if (!form.property_id && !form.apartment_id) { setError('Välj minst en fastighet eller lägenhet.'); return; }
    setSaving(true);
    setError('');

    const { data, error: invokeError } = await supabase.functions.invoke('vihem-access-entries', {
      body: {
        action: form.id ? 'update' : 'create',
        id: form.id || undefined,
        name: form.name.trim(),
        entry_type: form.entry_type,
        property_id: form.property_id || null,
        apartment_id: form.apartment_id || null,
        location_note: form.location_note,
        instructions: form.instructions,
        comments: form.comments,
        secret: form.secret || undefined,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        active: form.active,
      },
    });

    setSaving(false);
    if (invokeError || data?.error) { setError(data?.error || invokeError?.message || 'Kunde inte spara.'); return; }
    setShowModal(false);
    fetchAll();
  }

  async function handleDeactivate(entry: AccessEntry) {
    if (!window.confirm(`Inaktivera "${entry.name}"?`)) return;
    const { data, error: invokeError } = await supabase.functions.invoke('vihem-access-entries', {
      body: { action: 'update', id: entry.id, name: entry.name, entry_type: entry.entry_type, property_id: entry.property_id, apartment_id: entry.apartment_id, location_note: entry.location_note, instructions: entry.instructions, comments: entry.comments, valid_from: entry.valid_from, valid_to: entry.valid_to, active: false },
    });
    if (invokeError || data?.error) { setError(data?.error || invokeError?.message || 'Kunde inte inaktivera.'); return; }
    fetchAll();
  }

  async function revealSecret(entryId: string): Promise<string> {
    const { data, error: invokeError } = await supabase.functions.invoke('vihem-access-entries', { body: { action: 'reveal', id: entryId } });
    if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || 'Kunde inte visa koden.');
    if (data.step_up_required) throw new Error('Denna post kräver extra verifiering (ej aktiverat ännu).');
    return data.secret as string;
  }

  function logCopy(entryId: string) {
    void supabase.functions.invoke('vihem-access-entries', { body: { action: 'log_copy', id: entryId } });
  }

  if (loading) return <LoadingPage />;

  return (
    <div className={propertyId ? '' : 'min-h-screen bg-slate-50'}>
      {!propertyId && (
        <PageHeader
          title="Åtkomst"
          subtitle="Portkoder, larmkoder, nycklar och andra åtkomstuppgifter. Känsliga koder visas maskerade tills du väljer att visa dem."
          icon={KeyRound}
          action={canManage ? <Button onClick={openCreate}><Plus className="h-4 w-4" />Ny åtkomstpost</Button> : undefined}
        />
      )}
      {propertyId && canManage && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" />Ny åtkomstpost</Button>
        </div>
      )}

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      {!propertyId && (
        <div className="mb-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Sök namn, typ, fastighet..." />
        </div>
      )}

      {filteredEntries.length === 0 ? (
        <EmptyState icon={KeyRound} title="Inga åtkomstuppgifter" description="Lägg till portkoder, larmkoder och andra åtkomstuppgifter för fastigheten." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredEntries.map(entry => (
            <Card key={entry.id} className={`p-4 ${!entry.active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-blue-600">{ACCESS_ENTRY_TYPE_LABELS[entry.entry_type]}</p>
                  <h3 className="truncate font-black text-slate-950">{entry.name}</h3>
                  {!propertyId && entry.property?.name && <p className="text-xs text-slate-500">{entry.property.name}{entry.apartment?.apartment_number ? ` · lgh ${entry.apartment.apartment_number}` : ''}</p>}
                  {entry.location_note && <p className="mt-0.5 text-xs text-slate-500">{entry.location_note}</p>}
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => openEdit(entry)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Redigera">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    {entry.active && (
                      <button onClick={() => handleDeactivate(entry)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Inaktivera">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3">
                {entry.secret_hint ? (
                  <RevealSecret hint={entry.secret_hint} onReveal={() => revealSecret(entry.id)} onCopied={() => logCopy(entry.id)} />
                ) : (
                  <p className="text-xs text-slate-400">Ingen kod sparad -- se instruktion.</p>
                )}
              </div>

              {entry.instructions && <p className="mt-2 text-sm leading-5 text-slate-600">{entry.instructions}</p>}
              {entry.comments && <p className="mt-1 text-xs italic text-slate-400">{entry.comments}</p>}
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={form.id ? 'Redigera åtkomstpost' : 'Ny åtkomstpost'} size="lg">
        <div className="space-y-4">
          <Input label="Namn" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex. Portkod trapphus A" />
          <Select
            label="Typ"
            value={form.entry_type}
            onChange={e => setForm({ ...form, entry_type: e.target.value as AccessEntryType })}
            options={Object.entries(ACCESS_ENTRY_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Fastighet"
              value={form.property_id}
              onChange={e => setForm({ ...form, property_id: e.target.value, apartment_id: '' })}
              options={[{ value: '', label: 'Ingen' }, ...properties.map(p => ({ value: p.id, label: p.name }))]}
              disabled={Boolean(propertyId)}
            />
            <Select
              label="Lägenhet/lokal"
              value={form.apartment_id}
              onChange={e => setForm({ ...form, apartment_id: e.target.value })}
              options={[{ value: '', label: 'Ingen (gäller hela fastigheten)' }, ...apartmentsForProperty.map(a => ({ value: a.id, label: `Lgh ${a.apartment_number}` }))]}
            />
          </div>
          <Input label="Plats/instruktion om läge" value={form.location_note} onChange={e => setForm({ ...form, location_note: e.target.value })} placeholder="Ex. Entré mot gatan" />
          <Input
            label={form.id ? 'Ny kod (lämna tomt för att behålla nuvarande)' : 'Kod/hemlig uppgift'}
            value={form.secret}
            onChange={e => setForm({ ...form, secret: e.target.value })}
            placeholder="Ex. 4832"
            type="text"
          />
          <Textarea label="Instruktion" value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} placeholder="Ex. Kod används efter kl 18." rows={3} />
          <Textarea label="Kommentarer" value={form.comments} onChange={e => setForm({ ...form, comments: e.target.value })} rows={2} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Giltig från" type="date" value={form.valid_from} onChange={e => setForm({ ...form, valid_from: e.target.value })} />
            <Input label="Giltig till" type="date" value={form.valid_to} onChange={e => setForm({ ...form, valid_to: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Avbryt</Button>
            <Button type="button" onClick={handleSave} loading={saving}>Spara</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
