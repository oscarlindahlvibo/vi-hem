import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Plus, Trash2, RefreshCw, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, SearchInput, Select, Tabs, Textarea } from '../components/ui';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
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

export function OperationsRoutinesPage({ propertyId, initialRoutineId, onNavigate }: { propertyId?: string; initialRoutineId?: string; onNavigate?: (page:string)=>void }) {
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

  const [editorStep,setEditorStep]=useState('content'), [discard,setDiscard]=useState(false), [archiveTarget,setArchiveTarget]=useState<Routine|null>(null);
  const saveLock=useRef(false), checklistLock=useRef(false), checklistOperation=useRef<string|null>(null);
  const dirty=useUnsavedChanges(form,showModal);
  const closeEditor=()=>{if(saveLock.current)return;if(dirty)setDiscard(true);else setShowModal(false);};
  const loadVersion=useRef(0), templateVersion=useRef(0);
  useEffect(()=>{if(initialRoutineId && routines.length){ const found=routines.find(r=>r.id===initialRoutineId); if(found)setSelected(found); else setError('Rutinen hittades inte eller är inte tillgänglig.'); }},[initialRoutineId,routines]);
  const canEdit = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => { void fetchAll(); return invalidateLoads; }, [user?.id,user?.organisation_id]);
  useEffect(() => { if (selected && propertyId) fetchLocalNote(selected.id); }, [selected?.id, propertyId]);
  useEffect(() => {
    setChecklistStarted(false); checklistOperation.current=null;
    if (selected?.current_version_id) fetchChecklistTemplate(selected.current_version_id);
    else {templateVersion.current++;setChecklistTemplate([]);}
  }, [selected?.current_version_id]);

  function invalidateLoads(){loadVersion.current++;templateVersion.current++;}
  async function fetchChecklistTemplate(versionId: string) {
    const request=++templateVersion.current;setChecklistTemplate([]);
    const { data, error:templateError } = await supabase.from('vihem_routine_checklist_templates').select('id,label,required,requires_photo').eq('routine_version_id', versionId).order('sort_order');
    if(request!==templateVersion.current)return;
    if(templateError){setError('Checklistan kunde inte hämtas. Öppna rutinen igen för att försöka på nytt.');return;}
    setChecklistTemplate((data || []) as RoutineChecklistTemplateItem[]);
  }

  async function startChecklist() {
    if (!selected?.current_version_id || !user?.organisation_id || checklistLock.current) return;
    if(!checklistOperation.current)checklistOperation.current=crypto.randomUUID();
    checklistLock.current=true;setStartingChecklist(true);setError('');
    try { const result=await supabase.rpc('vihem_start_routine_checklist',{p_operation:checklistOperation.current,p_version:selected.current_version_id}); if(result.error || !result.data) throw result.error || new Error('Checklistan kunde inte bekräftas.'); setChecklistStarted(true); }
    catch(e) {setError(`${(e as {message?:string})?.message || 'Checklistan kunde inte startas.'} Försök igen.`);}
    finally {checklistLock.current=false;setStartingChecklist(false);}
  }

  async function fetchAll() {
    if (!user?.organisation_id) { setLoading(false); return; }
    const version=++loadVersion.current;
    setLoading(true);
    setError('');

    const [routinesResult, propertiesResult, ackResult] = await Promise.all([
      supabase.from('vihem_routines').select('*, current_version:vihem_routine_versions!vihem_routines_current_version_fk(*)').eq('organisation_id', user.organisation_id).order('is_emergency', { ascending: false }).order('title'),
      supabase.from('vihem_properties').select('id,name').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_routine_acknowledgements').select('routine_id,routine_version_id,user_id'),
    ]);

    if(version!==loadVersion.current)return;
    if (routinesResult.error) setError('Rutinerna kunde inte hämtas. Försök igen.');
    else setRoutines((routinesResult.data || []) as unknown as Routine[]);
    setProperties((propertiesResult.data || []) as PropertyOption[]);

    if (!ackResult.error) {
      const mine = new Set<string>();
      const counts: Record<string, number> = {};
      for (const row of ackResult.data || []) {
        counts[row.routine_version_id] = (counts[row.routine_version_id] || 0) + 1;
        if (row.user_id === user.id) mine.add(row.routine_version_id);
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
    setError('');setEditorStep('content');setForm(EMPTY_FORM);
    setShowModal(true);
  }

  async function openEdit(routine: Routine) {
    if(saveLock.current)return;
    const v = routine.current_version;
    const templates = v ? await supabase.from('vihem_routine_checklist_templates').select('id,label,required,requires_photo').eq('routine_version_id',v.id).order('sort_order') : {data:[],error:null};
    if(templates.error){setError('Checklistraderna kunde inte hämtas. Ingenting har ändrats. Försök igen.');return;}
    setError('');setEditorStep('content');
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
      checklist_items: (templates.data || []) as RoutineChecklistTemplateItem[],
    });
    setShowModal(true);
  }

  async function handleSave(status: RoutineStatus) {
    if(saveLock.current)return;
    if (!form.title.trim()) { setEditorStep('content'); setError('Titel krävs.'); return; }
    saveLock.current=true;
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

    setSaving(false);saveLock.current=false;
    if (invokeError || data?.error) { setError(data?.error || invokeError?.message || 'Kunde inte spara.'); return; }
    setShowModal(false); setSelected(null);
    setStatusTab(status);
    fetchAll();
  }

  async function handleArchive(routine: Routine) {
    if(saveLock.current)return;saveLock.current=true;setSaving(true);
    const { data, error: invokeError } = await supabase.functions.invoke('vihem-routines', { body: { action: 'archive', id: routine.id } });
    saveLock.current=false;setSaving(false);
    if (invokeError || data?.error) { setError(data?.error || invokeError?.message || 'Kunde inte arkivera.'); return; }
    setArchiveTarget(null);
    setSelected(null);
    fetchAll();
  }

  async function handleAcknowledge(routine: Routine) {
    if (!user || !routine.current_version_id) return;
    const { error: ackError } = await supabase.from('vihem_routine_acknowledgements').insert({ routine_id: routine.id, routine_version_id: routine.current_version_id, user_id: user.id });
    if(ackError){setError('Kvitteringen kunde inte sparas. Försök igen.');return;}
    if (!ackError) { setMyAcknowledgements(prev => new Set(prev).add(routine.current_version_id!)); setAckCounts(prev => ({ ...prev, [routine.current_version_id!]: (prev[routine.current_version_id!] || 0) + 1 })); }
  }

  async function saveLocalNote() {
    if (!selected || !propertyId || !user) return;
    const {error:noteError}=await supabase.from('vihem_routine_local_notes').upsert({ routine_id: selected.id, property_id: propertyId, note: localNote, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'routine_id,property_id' });
    if(noteError)setError('Tillägget kunde inte sparas. Texten finns kvar. Försök igen.');
  }

  const dialogs=(<>      <Modal open={showModal} onClose={closeEditor} title={form.id ? 'Redigera rutin' : 'Ny rutin'} size="lg" mobileFullscreen>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <Tabs tabs={[{key:'content',label:'Instruktion'},{key:'checklist',label:'Checklista'},{key:'publish',label:'Publicering'}]} active={editorStep} onChange={setEditorStep}/>
        <fieldset disabled={saving} className="mt-5 space-y-4"><div hidden={editorStep!=='content'} className="space-y-4">
          <Input label="Titel" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <Select label="Kategori" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={ROUTINE_CATEGORY_OPTIONS} />
          <Textarea label="Kort sammanfattning" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={2} />
          <Textarea label="Full instruktion" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={4} />

          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700">Steg för steg</p>
            <div className="space-y-2">
              {form.steps.map((step, index) => (
                <div key={index} className="flex gap-2">
                  <Input aria-label={`Steg ${index+1}`} value={step} onChange={e => setForm({ ...form, steps: form.steps.map((s, i) => i === index ? e.target.value : s) })} className="min-w-0" />
                  <Button type="button" variant="outline" onClick={() => setForm({ ...form, steps: form.steps.filter((_, i) => i !== index) })} aria-label="Ta bort steg"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setForm({ ...form, steps: [...form.steps, ''] })}><Plus className="h-4 w-4" />Lägg till steg</Button>
            </div>
          </div>

          </div><div hidden={editorStep!=='checklist'} className="space-y-4"><p className="text-sm text-vihem-muted">Checklistan följer denna version av rutinen. Tidigare versioner bevaras.</p>
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700">Checklista</p>
            <div className="space-y-2">
              {form.checklist_items.map((item, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                  <Input aria-label={`Checklistrad ${index+1}`} value={item.label} onChange={e => setForm({ ...form, checklist_items: form.checklist_items.map((it, i) => i === index ? { ...it, label: e.target.value } : it) })} placeholder="Ex. Byt sängkläder" className="min-w-[160px] flex-1" />
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

          </div><div hidden={editorStep!=='content'} className="space-y-4">
          <Textarea label="Varningar" value={form.warnings} onChange={e => setForm({ ...form, warnings: e.target.value })} rows={2} />
          <Textarea label="Tips" value={form.tips} onChange={e => setForm({ ...form, tips: e.target.value })} rows={2} />

          </div><div hidden={editorStep!=='publish'} className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.is_emergency} onChange={e => setForm({ ...form, is_emergency: e.target.checked })} />Akutrutin</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.requires_acknowledgement} onChange={e => setForm({ ...form, requires_acknowledgement: e.target.checked })} />Kräver kvittering</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.applies_to_staff} onChange={e => setForm({ ...form, applies_to_staff: e.target.checked })} />Gäller personal</label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.applies_to_admin} onChange={e => setForm({ ...form, applies_to_admin: e.target.checked })} />Gäller admin</label>
          </div>

          {form.id && <Input label="Kommentar till denna ändring" value={form.change_comment} onChange={e => setForm({ ...form, change_comment: e.target.value })} placeholder="Vad ändrades och varför?" />}

          </div><div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={closeEditor}>Avbryt</Button>
            <Button type="button" variant="outline" onClick={() => handleSave('draft')} loading={saving}>Spara som utkast</Button>
            <Button type="button" onClick={() => handleSave('published')} loading={saving}>Publicera</Button>
          </div>
        </fieldset>
      </Modal><Modal open={discard} onClose={()=>setDiscard(false)} title="Lämna rutinredigeringen?" footer={<><Button variant="secondary" onClick={()=>setDiscard(false)}>Fortsätt redigera</Button><Button variant="danger" onClick={()=>{setDiscard(false);setShowModal(false);}}>Lämna</Button></>}><p>Osparade ändringar försvinner.</p></Modal><Modal open={!!archiveTarget} onClose={()=>{if(!saving)setArchiveTarget(null);}} title="Arkivera rutin?" footer={<><Button variant="secondary" disabled={saving} onClick={()=>setArchiveTarget(null)}>Avbryt</Button><Button variant="danger" loading={saving} onClick={()=>{if(archiveTarget)void handleArchive(archiveTarget);}}>Arkivera</Button></>}><p>{archiveTarget?.title}. Tidigare versioner och kvitteringar bevaras.</p>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</Modal></>);
  if (loading) return <LoadingPage />;

  if (selected) {
    const v = selected.current_version;
    const needsAck = selected.requires_acknowledgement && !myAcknowledgements.has(selected.current_version_id || '');
    return (
      <div className={propertyId ? '' : 'mx-auto max-w-5xl pb-6'}>
        <PageHeader
          title={selected.title}
          subtitle={selected.summary}
          icon={BookOpen}
          backButton={() => setSelected(null)}
          action={canEdit ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => openEdit(selected)}>Redigera</Button>
              {selected.status !== 'archived' && <Button variant="outline" size="sm" onClick={() => {setError('');setArchiveTarget(selected);}}>Arkivera</Button>}
            </div>
          ) : undefined}
        />
        {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}<Button variant="ghost" className="ml-3" onClick={()=>void fetchAll()}><RefreshCw className="h-4 w-4"/>Hämta igen</Button></div>}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <Badge className="bg-slate-100 text-slate-600">{STATUS_LABELS[selected.status]}</Badge>
            {v && <Badge className="bg-slate-100 text-slate-600">Version {v.version_number}</Badge>}
            {selected.is_emergency && <Badge className="bg-red-100 text-red-700">Akut</Badge>}
            {canEdit && selected.requires_acknowledgement && <Badge className="bg-blue-100 text-blue-700">{ackCounts[selected.current_version_id || ''] || 0} har kvitterat</Badge>}
          </div>

          {needsAck && (
            <Card className="bg-blue-50 p-4 lg:col-span-2">
              <p className="mb-3 text-sm font-semibold text-blue-800">Denna rutin kräver att du bekräftar att du läst och förstått den.</p>
              <Button size="sm" onClick={() => handleAcknowledge(selected)}>Jag har läst och förstått</Button>
            </Card>
          )}

          <div className="min-w-0 space-y-5 rounded-2xl bg-white p-5 sm:p-6">
          {v?.warnings && (
            <Card className="border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-black text-amber-800"><AlertTriangle className="h-4 w-4" />Varning</p>
              <p className="mt-1 text-sm text-amber-800">{v.warnings}</p>
            </Card>
          )}

          {v?.body && <section><h2 className="mb-3 font-semibold text-vihem-navy">Instruktion</h2><p className="max-w-prose whitespace-pre-line text-base leading-relaxed text-vihem-muted">{v.body}</p></section>}

          {Boolean(v?.steps?.length) && (
            <section className="border-t border-slate-100 pt-5">
              <h3 className="mb-3 font-semibold text-vihem-navy">Steg för steg</h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
                {v!.steps.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
            </section>
          )}

          {v?.tips && <p className="border-t border-slate-100 pt-5 text-sm text-vihem-muted"><span className="font-semibold">Tips: </span>{v.tips}</p>}

          </div><aside className="space-y-4 lg:sticky lg:top-4">
          {checklistTemplate.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-vihem-navy">Checklista</h3>
                {!checklistStarted ? (
                  <Button size="sm" variant="secondary" onClick={startChecklist} loading={startingChecklist}>Starta checklista</Button>
                ) : (
                  <span className="text-sm text-emerald-700"><Check className="mr-1 inline h-4 w-4"/>Startad{onNavigate && <Button variant="ghost" size="sm" onClick={()=>onNavigate('operations-checklists')}>Öppna checklistor</Button>}</span>
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
          </aside>
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className={propertyId ? '' : 'mx-auto max-w-5xl pb-6'}>
      {!propertyId && (
        <PageHeader title="Rutiner" subtitle="Driftrutiner och instruktioner för verksamheten." icon={BookOpen} action={canEdit ? <Button onClick={openCreate}><Plus className="h-4 w-4" />Ny rutin</Button> : undefined} />
      )}
      {propertyId && canEdit && <div className="mb-4 flex justify-end"><Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" />Ny rutin</Button></div>}

      {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}<Button variant="ghost" className="ml-3" onClick={()=>void fetchAll()}><RefreshCw className="h-4 w-4"/>Hämta igen</Button></div>}

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
                  <h3 className="break-words font-semibold text-vihem-navy">{routine.title}</h3>
                  {routine.summary && <p className="mt-0.5 text-sm text-slate-500">{routine.summary}</p>}
                </div>
                {routine.is_emergency && <Badge className="shrink-0 bg-red-100 text-red-700">Akut</Badge>}
              </div>
              {!isRoutineCurrentlyValid(routine) && <p className="mt-2 text-xs font-semibold text-amber-600">Utanför giltighetsperiod</p>}
            </Card>
          ))}
        </div>
      )}

      {dialogs}

    </div>
  );
}
