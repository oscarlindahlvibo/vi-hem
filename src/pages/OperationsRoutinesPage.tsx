import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, SearchInput, Select, Tabs, Textarea } from '../components/ui';
import { ROUTINE_CATEGORY_OPTIONS, isRoutineCurrentlyValid, type Routine, type RoutineChecklistTemplateItem, type RoutineStatus } from '../lib/operations';

interface PropertyOption { id: string; name: string }

const STATUS_LABELS: Record<RoutineStatus, string> = { draft: 'Utkast', published: 'Publicerad', archived: 'Arkiverad' };

const EMPTY_FORM = {
  id: '',
  title: '',
  category: 'ovrigt',
  summary: '',
  is_emergency: false,
  applies_to_staff: true,
  applies_to_admin: true,
  requires_acknowledgement: false,
  valid_from: '',
  valid_to: '',
  body: '',
  steps: [] as string[],
  warnings: '',
  tips: '',
  change_comment: '',
  checklist_items: [] as RoutineChecklistTemplateItem[],
};

export function OperationsRoutinesPage({ propertyId }: { propertyId?: string }) {
  const { user } = useAuth();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<RoutineStatus>('published');
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Routine | null>(null);
  const [myAcknowledgements, setMyAcknowledgements] = useState<Set<string>>(new Set());
  const [ackCounts, setAckCounts] = useState<Record<string, number>>({});
  const [localNote, setLocalNote] = useState('');
  const [checklistTemplate, setChecklistTemplate] = useState<RoutineChecklistTemplateItem[]>([]);
  const [startingChecklist, setStartingChecklist] = useState(false);
  const [checklistStarted, setChecklistStarted] = useState(false);

  const canEdit = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => { fetchAll(); }, [user?.organisation_id]);
  useEffect(() => { if (selected && propertyId) fetchLocalNote(selected.id); }, [selected?.id, propertyId]);
  useEffect(() => {
    setChecklistStarted(false);
    if (selected?.current_version_id) fetchChecklistTemplate(selected.current_version_id);
    else setChecklistTemplate([]);
  }, [selected?.current_version_id]);

  async function fetchChecklistTemplate(versionId: string) {
    const { data } = await supabase.from('vihem_routine_checklist_templates').select('id,label,required,requires_photo').eq('routine_version_id', versionId).order('sort_order');
    setChecklistTemplate((data || []) as RoutineChecklistTemplateItem[]);
  }

  async function startChecklist() {
    if (!selected?.current_version_id || !user?.organisation_id) return;
    setStartingChecklist(true);
    const { data: instance, error: instanceError } = await supabase
      .from('vihem_checklist_instances')
      .insert({ organisation_id: user.organisation_id, source_routine_version_id: selected.current_version_id, title: selected.title, created_by: user.id })
      .select('id')
      .single();
    if (!instanceError && instance) {
      const rows = checklistTemplate.map((item, index) => ({ instance_id: instance.id, sort_order: index, label: item.label, required: item.required, requires_photo: item.requires_photo }));
      if (rows.length) await supabase.from('vihem_checklist_instance_items').insert(rows);
      setChecklistStarted(true);
    }
    setStartingChecklist(false);
  }

  async function fetchAll() {
    if (!user?.organisation_id) { setLoading(false); return; }
    setLoading(true);
    setError('');

    const [routinesResult, propertiesResult, ackResult] = await Promise.all([
      supabase.from('vihem_routines').select('*, current_version:vihem_routine_versions!vihem_routines_current_version_fk(*)').eq('organisation_id', user.organisation_id).order('is_emergency', { ascending: false }).order('title'),
      supabase.from('vihem_properties').select('id,name').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_routine_acknowledgements').select('routine_id,user_id'),
    ]);

    if (routinesResult.error) setError(routinesResult.error.message);
    else setRoutines((routinesResult.data || []) as unknown as Routine[]);
    setProperties((propertiesResult.data || []) as PropertyOption[]);

    if (!ackResult.error) {
      const mine = new Set<string>();
      const counts: Record<string, number> = {};
      for (const row of ackResult.data || []) {
        counts[row.routine_id] = (counts[row.routine_id] || 0) + 1;
        if (row.user_id === user.id) mine.add(row.routine_id);
      }
      setMyAcknowledgements(mine);
      setAckCounts(counts);
    }
    setLoading(false);
  }

  async function fetchLocalNote(routineId: string) {
    if (!propertyId) return;
    const { data } = await supabase.from('vihem_routine_local_notes').select('note').eq('routine_id', routineId).eq('property_id', propertyId).maybeSingle();
    setLocalNote(data?.note || '');
  }

  const filteredRoutines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return routines.filter(routine => {
      if (routine.status !== statusTab) return false;
      if (!q) return true;
      return routine.title.toLowerCase().includes(q) || routine.summary.toLowerCase().includes(q);
    });
  }, [routines, search, statusTab]);

  const emergencyRoutines = useMemo(() => routines.filter(r => r.is_emergency && r.status === 'published'), [routines]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(routine: Routine) {
    const v = routine.current_version;
    setForm({
      id: routine.id,
      title: routine.title,
      category: routine.category,
      summary: routine.summary,
      is_emergency: routine.is_emergency,
      applies_to_staff: routine.applies_to_roles.includes('staff'),
      applies_to_admin: routine.applies_to_roles.includes('admin'),
      requires_acknowledgement: routine.requires_acknowledgement,
      valid_from: routine.valid_from || '',
      valid_to: routine.valid_to || '',
      body: v?.body || '',
      steps: v?.steps || [],
      warnings: v?.warnings || '',
      tips: v?.tips || '',
      change_comment: '',
      checklist_items: [],
    });
    setShowModal(true);
  }

  async function handleSave(status: RoutineStatus) {
    if (!form.title.trim()) { setError('Titel krävs.'); return; }
    setSaving(true);
    setError('');

    const applies_to_roles = [...(form.applies_to_staff ? ['staff'] : []), ...(form.applies_to_admin ? ['admin'] : [])];
    const { data, error: invokeError } = await supabase.functions.invoke('vihem-routines', {
      body: {
        action: 'save',
        id: form.id || undefined,
        title: form.title.trim(),
        category: form.category,
        summary: form.summary,
        is_emergency: form.is_emergency,
        applies_to_roles: applies_to_roles.length ? applies_to_roles : ['staff', 'admin'],
        requires_acknowledgement: form.requires_acknowledgement,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        status,
        body: form.body,
        steps: form.steps.filter(Boolean),
        warnings: form.warnings,
        tips: form.tips,
        change_comment: form.change_comment,
        checklist_items: form.checklist_items,
      },
    });

    setSaving(false);
    if (invokeError || data?.error) { setError(data?.error || invokeError?.message || 'Kunde inte spara.'); return; }
    setShowModal(false);
    setStatusTab(status);
    fetchAll();
  }

  async function handleArchive(routine: Routine) {
    if (!window.confirm(`Arkivera "${routine.title}"?`)) return;
    const { data, error: invokeError } = await supabase.functions.invoke('vihem-routines', { body: { action: 'archive', id: routine.id } });
    if (invokeError || data?.error) { setError(data?.error || invokeError?.message || 'Kunde inte arkivera.'); return; }
    setSelected(null);
    fetchAll();
  }

  async function handleAcknowledge(routine: Routine) {
    if (!user || !routine.current_version_id) return;
    const { error: ackError } = await supabase.from('vihem_routine_acknowledgements').insert({ routine_id: routine.id, routine_version_id: routine.current_version_id, user_id: user.id });
    if (!ackError) { setMyAcknowledgements(prev => new Set(prev).add(routine.id)); setAckCounts(prev => ({ ...prev, [routine.id]: (prev[routine.id] || 0) + 1 })); }
  }

  async function saveLocalNote() {
    if (!selected || !propertyId || !user) return;
    await supabase.from('vihem_routine_local_notes').upsert({ routine_id: selected.id, property_id: propertyId, note: localNote, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'routine_id,property_id' });
  }

  if (loading) return <LoadingPage />;

  if (selected) {
    const v = selected.current_version;
    const needsAck = selected.requires_acknowledgement && !myAcknowledgements.has(selected.id);
    return (
      <div className={propertyId ? '' : 'min-h-screen bg-slate-50'}>
        <PageHeader
          title={selected.title}
          subtitle={selected.summary}
          icon={BookOpen}
          backButton={() => setSelected(null)}
          action={canEdit ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => openEdit(selected)}>Redigera</Button>
              {selected.status !== 'archived' && <Button variant="outline" size="sm" onClick={() => handleArchive(selected)}>Arkivera</Button>}
            </div>
          ) : undefined}
        />
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-slate-100 text-slate-600">{STATUS_LABELS[selected.status]}</Badge>
            {v && <Badge className="bg-slate-100 text-slate-600">Version {v.version_number}</Badge>}
            {selected.is_emergency && <Badge className="bg-red-100 text-red-700">Akut</Badge>}
            {canEdit && selected.requires_acknowledgement && <Badge className="bg-blue-100 text-blue-700">{ackCounts[selected.id] || 0} har kvitterat</Badge>}
          </div>

          {needsAck && (
            <Card className="border-blue-200 bg-blue-50 p-4">
              <p className="mb-3 text-sm font-semibold text-blue-800">Denna rutin kräver att du bekräftar att du läst och förstått den.</p>
              <Button size="sm" onClick={() => handleAcknowledge(selected)}>Jag har läst och förstått</Button>
            </Card>
          )}

          {v?.warnings && (
            <Card className="border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-black text-amber-800"><AlertTriangle className="h-4 w-4" />Varning</p>
              <p className="mt-1 text-sm text-amber-800">{v.warnings}</p>
            </Card>
          )}

          {v?.body && <Card className="p-4"><p className="whitespace-pre-line text-sm leading-6 text-slate-700">{v.body}</p></Card>}

          {Boolean(v?.steps?.length) && (
            <Card className="p-4">
              <h3 className="mb-3 font-black text-slate-950">Steg för steg</h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
                {v!.steps.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
            </Card>
          )}

          {v?.tips && <Card className="p-4"><p className="text-sm text-slate-600"><span className="font-black">Tips: </span>{v.tips}</p></Card>}

          {checklistTemplate.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-black text-slate-950">Checklista</h3>
                {!checklistStarted ? (
                  <Button size="sm" variant="secondary" onClick={startChecklist} loading={startingChecklist}>Starta checklista</Button>
                ) : (
                  <span className="text-xs font-black text-emerald-600">Startad -- se Checklistor</span>
                )}
              </div>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {checklistTemplate.map(item => (
                  <li key={item.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    {item.label}
                    {item.required && <span className="text-red-500">*</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {propertyId && (
            <Card className="p-4">
              <h3 className="mb-2 font-black text-slate-950">Lokalt tillägg för denna fastighet</h3>
              {canEdit ? (
                <div className="space-y-2">
                  <Textarea value={localNote} onChange={e => setLocalNote(e.target.value)} rows={3} placeholder="Ex. Sängkläder finns i förråd plan 1." />
                  <Button size="sm" variant="secondary" onClick={saveLocalNote}>Spara tillägg</Button>
                </div>
              ) : localNote ? (
                <p className="text-sm text-slate-600">{localNote}</p>
              ) : (
                <p className="text-sm text-slate-400">Inget tillägg.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={propertyId ? '' : 'min-h-screen bg-slate-50'}>
      {!propertyId && (
        <PageHeader title="Rutiner" subtitle="Driftrutiner och instruktioner för verksamheten." icon={BookOpen} action={canEdit ? <Button onClick={openCreate}><Plus className="h-4 w-4" />Ny rutin</Button> : undefined} />
      )}
      {propertyId && canEdit && <div className="mb-4 flex justify-end"><Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" />Ny rutin</Button></div>}

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      {emergencyRoutines.length > 0 && !propertyId && (
        <Card className="mb-4 border-red-200 bg-red-50 p-4">
          <p className="mb-2 flex items-center gap-2 font-black text-red-800"><AlertTriangle className="h-4 w-4" />Akut hjälp</p>
          <div className="flex flex-wrap gap-2">
            {emergencyRoutines.map(r => (
              <button key={r.id} onClick={() => setSelected(r)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-100">{r.title}</button>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs tabs={[{ key: 'published', label: 'Publicerade' }, { key: 'draft', label: 'Utkast' }, { key: 'archived', label: 'Arkiverade' }]} active={statusTab} onChange={key => setStatusTab(key as RoutineStatus)} />
        <SearchInput value={search} onChange={setSearch} placeholder="Sök rutin..." className="sm:w-64" />
      </div>

      {filteredRoutines.length === 0 ? (
        <EmptyState icon={BookOpen} title="Inga rutiner" description="Inga rutiner matchar filtret." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredRoutines.map(routine => (
            <Card key={routine.id} onClick={() => setSelected(routine)} className="cursor-pointer p-4 hover:border-blue-300">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-blue-600">{ROUTINE_CATEGORY_OPTIONS.find(c => c.value === routine.category)?.label || routine.category}</p>
                  <h3 className="truncate font-black text-slate-950">{routine.title}</h3>
                  {routine.summary && <p className="mt-0.5 text-sm text-slate-500">{routine.summary}</p>}
                </div>
                {routine.is_emergency && <Badge className="shrink-0 bg-red-100 text-red-700">Akut</Badge>}
              </div>
              {!isRoutineCurrentlyValid(routine) && <p className="mt-2 text-xs font-semibold text-amber-600">Utanför giltighetsperiod</p>}
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={form.id ? 'Redigera rutin' : 'Ny rutin'} size="lg">
        <div className="space-y-4">
          <Input label="Titel" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <Select label="Kategori" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={ROUTINE_CATEGORY_OPTIONS} />
          <Textarea label="Kort sammanfattning" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={2} />
          <Textarea label="Full instruktion" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={4} />

          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700">Steg för steg</p>
            <div className="space-y-2">
              {form.steps.map((step, index) => (
                <div key={index} className="flex gap-2">
                  <Input value={step} onChange={e => setForm({ ...form, steps: form.steps.map((s, i) => i === index ? e.target.value : s) })} className="min-w-0" />
                  <Button type="button" variant="outline" onClick={() => setForm({ ...form, steps: form.steps.filter((_, i) => i !== index) })} aria-label="Ta bort steg"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setForm({ ...form, steps: [...form.steps, ''] })}><Plus className="h-4 w-4" />Lägg till steg</Button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700">Checklista</p>
            <div className="space-y-2">
              {form.checklist_items.map((item, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                  <Input value={item.label} onChange={e => setForm({ ...form, checklist_items: form.checklist_items.map((it, i) => i === index ? { ...it, label: e.target.value } : it) })} placeholder="Ex. Byt sängkläder" className="min-w-[160px] flex-1" />
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <input type="checkbox" checked={item.required} onChange={e => setForm({ ...form, checklist_items: form.checklist_items.map((it, i) => i === index ? { ...it, required: e.target.checked } : it) })} />
                    Obligatoriskt
                  </label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, checklist_items: form.checklist_items.filter((_, i) => i !== index) })} aria-label="Ta bort"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setForm({ ...form, checklist_items: [...form.checklist_items, { label: '', required: false, requires_photo: false }] })}><Plus className="h-4 w-4" />Lägg till checklistrad</Button>
            </div>
          </div>

          <Textarea label="Varningar" value={form.warnings} onChange={e => setForm({ ...form, warnings: e.target.value })} rows={2} />
          <Textarea label="Tips" value={form.tips} onChange={e => setForm({ ...form, tips: e.target.value })} rows={2} />

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.is_emergency} onChange={e => setForm({ ...form, is_emergency: e.target.checked })} />Akutrutin</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.requires_acknowledgement} onChange={e => setForm({ ...form, requires_acknowledgement: e.target.checked })} />Kräver kvittering</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.applies_to_staff} onChange={e => setForm({ ...form, applies_to_staff: e.target.checked })} />Gäller personal</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.applies_to_admin} onChange={e => setForm({ ...form, applies_to_admin: e.target.checked })} />Gäller admin</label>
          </div>

          {form.id && <Input label="Kommentar till denna ändring" value={form.change_comment} onChange={e => setForm({ ...form, change_comment: e.target.value })} placeholder="Vad ändrades och varför?" />}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Avbryt</Button>
            <Button type="button" variant="outline" onClick={() => handleSave('draft')} loading={saving}>Spara som utkast</Button>
            <Button type="button" onClick={() => handleSave('published')} loading={saving}>Publicera</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
