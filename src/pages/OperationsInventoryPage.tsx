import React, { useEffect, useRef, useState } from 'react';
import { Package, Plus, ShoppingCart, Trash2, Check, Pencil, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, EmptyState, Input, LoadingPage, Modal, PageHeader, Select } from '../components/ui';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import type { InventoryTemplate } from '../lib/operations';

interface StockItemOption { id: string; name: string; unit: string }

const EMPTY_TEMPLATE_FORM = { id: '', name: '', items: [] as { label: string; desired_quantity: number; unit: string; stock_item_id: string }[] };

export function OperationsInventoryPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<InventoryTemplate[]>([]);
  const [stockItems, setStockItems] = useState<StockItemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<InventoryTemplate | null>(null);
  const [actualQuantities, setActualQuantities] = useState<Record<string, string>>({});
  const [checkResult, setCheckResult] = useState<{ id: string; items: any[] } | null>(null);

  const checkLock=useRef(false), checkOperation=useRef<{body:string;id:string}|null>(null);
  const [checkingBusy,setCheckingBusy]=useState(false), [discardCheck,setDiscardCheck]=useState(false);
  const checkDirty=useUnsavedChanges(actualQuantities,!!checking && !checkResult);
  const closeCheck=()=>{if(checkLock.current)return;if(checkDirty)setDiscardCheck(true);else setChecking(null);};
  const discardDialog=<Modal open={discardCheck} onClose={()=>setDiscardCheck(false)} title="Lämna kontrollen?" footer={<><Button variant="secondary" onClick={()=>setDiscardCheck(false)}>Fortsätt kontrollera</Button><Button variant="danger" onClick={()=>{setDiscardCheck(false);setChecking(null);}}>Lämna</Button></>}><p>Osparade antal försvinner.</p></Modal>;
  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

  const loadGeneration=useRef(0);
  function invalidateLoads(){loadGeneration.current++;}
  useEffect(() => { void fetchAll(); return invalidateLoads; }, [user?.id,user?.organisation_id]);

  async function fetchAll() {
    if (!user?.organisation_id) { setLoading(false); return; }
    const request=++loadGeneration.current;setLoading(true); setError('');
    const [templatesResult, stockResult] = await Promise.all([
      supabase.from('vihem_inventory_templates').select('*, items:vihem_inventory_template_items(*)').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_inventory_stock_items').select('id,name,unit').eq('organisation_id', user.organisation_id).eq('active', true).order('name'),
    ]);
    if(request!==loadGeneration.current)return;
    if (templatesResult.error) setError('Inventarielistorna kunde inte hämtas. Försök igen.');
    if (!templatesResult.error) setTemplates((templatesResult.data || []).map((t: any) => ({ ...t, items: (t.items || []).sort((a: any, b: any) => a.sort_order - b.sort_order) })) as InventoryTemplate[]);
    setStockItems((stockResult.data || []) as StockItemOption[]);
    setLoading(false);
  }

  function openCreateTemplate() {
    setTemplateForm(EMPTY_TEMPLATE_FORM);
    setShowTemplateModal(true);
  }

  function openEditTemplate(template: InventoryTemplate) {
    setTemplateForm({
      id: template.id,
      name: template.name,
      items: (template.items || []).map(i => ({ label: i.label, desired_quantity: i.desired_quantity, unit: i.unit, stock_item_id: i.stock_item_id || '' })),
    });
    setShowTemplateModal(true);
  }

  async function saveTemplate() {
    if (!templateForm.name.trim() || !user?.organisation_id) { setError('Namn krävs.'); return; }
    setSaving(true);
    setError('');

    let templateId = templateForm.id;
    if (!templateId) {
      const { data, error: createError } = await supabase.from('vihem_inventory_templates').insert({ organisation_id: user.organisation_id, name: templateForm.name.trim(), created_by: user.id }).select('id').single();
      if (createError) { setError(createError.message); setSaving(false); return; }
      templateId = data.id;
    } else {
      const { error: updateError } = await supabase.from('vihem_inventory_templates').update({ name: templateForm.name.trim() }).eq('id', templateId);
      if (updateError) { setError(updateError.message); setSaving(false); return; }
      await supabase.from('vihem_inventory_template_items').delete().eq('template_id', templateId);
    }

    const rows = templateForm.items
      .filter(i => i.label.trim())
      .map((item, index) => ({ template_id: templateId, sort_order: index, label: item.label.trim(), desired_quantity: item.desired_quantity || 0, unit: item.unit || 'st', stock_item_id: item.stock_item_id || null }));
    if (rows.length) {
      const { error: itemsError } = await supabase.from('vihem_inventory_template_items').insert(rows);
      if (itemsError) { setError(itemsError.message); setSaving(false); return; }
    }

    setSaving(false);
    setShowTemplateModal(false);
    fetchAll();
  }

  function startCheck(template: InventoryTemplate) {
    checkOperation.current=null; setError('');
    setChecking(template);
    setActualQuantities({});
    setCheckResult(null);
    setMessage('');
  }

  async function submitCheck() {
    if (!checking || !user?.organisation_id || checkLock.current) return;
    const items = checking.items || [];
    if (!items.length || items.some(i => !actualQuantities[i.id]?.trim() || !Number.isFinite(Number(actualQuantities[i.id])) || Number(actualQuantities[i.id])<0)) { setError('Ange antal för varje artikel. Ange noll om den saknas.'); return; }
    const snapshot=[...items].sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id)).map(({id,label,desired_quantity,unit})=>({id,label,desired_quantity,unit}));
    const request={p_template:checking.id,p_snapshot:snapshot,p_counts:Object.fromEntries(items.map(i=>[i.id,Number(actualQuantities[i.id])]))};
    const body=JSON.stringify(request); if(checkOperation.current?.body!==body)checkOperation.current={body,id:crypto.randomUUID()};
    checkLock.current=true;setCheckingBusy(true);setError('');
    try {
      const result=await supabase.rpc('vihem_complete_inventory_check',{...request,p_operation:checkOperation.current.id});
      if(result.error || !result.data?.id) throw result.error || new Error('Kontrollen kunde inte bekräftas.');
      setCheckResult({...result.data,items:[...result.data.items].sort((a:any,b:any)=>items.findIndex(i=>i.id===a.template_item_id)-items.findIndex(i=>i.id===b.template_item_id))});
    } catch(e) { setError(`${e instanceof Error ? e.message : (e as {message?:string})?.message || 'Kontrollen kunde inte sparas.'} Dina antal finns kvar. Försök igen.`); }
    finally {checkLock.current=false;setCheckingBusy(false);}
  }

  async function addShortageToPurchaseList(checkItem: any) {
    if (!user?.organisation_id) return;
    const itemName = checkItem.label;
    const { data: existing } = await supabase.from('vihem_purchase_items').select('id').eq('organisation_id', user.organisation_id).eq('status', 'open').ilike('item_name', itemName).maybeSingle();
    const result = existing
      ? await supabase.from('vihem_purchase_items').update({ quantity: String(checkItem.shortage), notes: `Brist vid kontroll av städvagn (${checking?.name || ''})` }).eq('id', existing.id)
      : await supabase.from('vihem_purchase_items').insert({ organisation_id: user.organisation_id, store_name: 'Övrigt', item_name: itemName, quantity: String(checkItem.shortage), notes: `Brist vid kontroll av städvagn (${checking?.name || ''})`, priority: 'normal', created_by: user.id });
    if (!result.error) {
      await supabase.from('vihem_inventory_check_items').update({ action: 'added_to_purchase_list' }).eq('id', checkItem.id);
      setCheckResult(prev => prev ? { ...prev, items: prev.items.map((i: any) => i.id === checkItem.id ? { ...i, action: 'added_to_purchase_list' } : i) } : prev);
      setMessage(`${itemName} tillagd på inköpslistan.`);
    }
  }

  if (loading) return <LoadingPage />;

  if (checking) {
    if (checkResult) {
      const shortages=checkResult.items.filter((i:{shortage:number})=>Number(i.shortage)>0);
      return <div className="mx-auto max-w-4xl pb-6">
        <PageHeader title={checking.name} subtitle={`Sparad kontroll · ${checkResult.items.length} artiklar · ${shortages.length} ${shortages.length===1 ? "brist" : "brister"}`} icon={Package} backButton={closeCheck}/>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="mb-4 text-sm text-emerald-700">{message}</p>}
        {!shortages.length && <p className="mb-4 flex items-center gap-2 text-sm text-emerald-700"><Check className="h-4 w-4"/>Alla artiklar finns enligt din kontroll.</p>}
        <div className="divide-y divide-slate-100 rounded-2xl bg-white px-4 sm:px-6">{checkResult.items.map((item:any)=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h2 className="text-base font-medium text-vihem-navy">{item.label}</h2><p className="mt-1 text-sm text-vihem-muted">Finns {item.actual_quantity} av {item.desired_quantity} {item.unit}{Number(item.shortage)>0 && ` · Saknas ${item.shortage}`}</p></div>{Number(item.shortage)>0 && (item.action==='added_to_purchase_list' ? <span className="text-sm text-emerald-700">På inköpslistan</span> : <Button variant="secondary" size="sm" onClick={()=>void addShortageToPurchaseList(item)}><ShoppingCart className="h-4 w-4"/>Lägg till inköpslista</Button>)}</div>)}</div>
      </div>;
    }
    const items=checking.items || [];

    const reviewed=items.filter(i=>actualQuantities[i.id]?.trim() && Number.isFinite(Number(actualQuantities[i.id])) && Number(actualQuantities[i.id])>=0).length;
    return (
      <div className="mx-auto max-w-4xl pb-8">
        <PageHeader title={checking.name} subtitle="Kontrollera innehållet innan du sparar resultatet." icon={Package} backButton={closeCheck}/>
        <div className="sticky top-0 z-10 mb-5 rounded-2xl bg-vihem-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-vihem-navy">{reviewed} av {items.length} artiklar kontrollerade</p><p className="mt-1 text-sm text-vihem-muted">Tomma antal är inte en bedömning. Ange noll när något saknas.</p></div><Button variant="secondary" size="sm" disabled={checkingBusy} onClick={()=>setActualQuantities(Object.fromEntries(items.map(i=>[i.id,String(i.desired_quantity)])))}><Check className="h-4 w-4"/>Alla finns</Button></div>
          <div role="progressbar" aria-label="Kontrollerade artiklar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={reviewed} className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-vihem-blue motion-safe:transition-all" style={{width:`${reviewed/(items.length || 1)*100}%`}}/></div>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="overflow-hidden rounded-2xl bg-white px-4 sm:px-6">
          <div className="hidden grid-cols-[minmax(0,1fr)_100px_140px] gap-4 border-b border-slate-200 py-3 text-xs font-medium uppercase tracking-wide text-vihem-muted sm:grid"><span>Artikel</span><span>Behövs</span><span>Finns på plats</span></div>
          <div className="divide-y divide-slate-100">{items.map(item=><div key={item.id} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_100px_140px]"><div className="min-w-0"><h2 className="break-words text-base font-medium text-vihem-navy">{item.label}</h2><p className="mt-1 text-sm text-vihem-muted sm:hidden">Behövs {item.desired_quantity} {item.unit}</p></div><p className="hidden text-sm tabular-nums text-vihem-muted sm:block">{item.desired_quantity} {item.unit}</p><Input aria-label={`Antal ${item.label}`} type="number" inputMode="decimal" min="0" step="any" disabled={checkingBusy} value={actualQuantities[item.id] ?? ''} onChange={e=>setActualQuantities({...actualQuantities,[item.id]:e.target.value})} placeholder="Ange antal"/></div>)}</div>
        </div>
        {!items.length && <EmptyState icon={Package} title="Listan saknar artiklar" description="Administratören behöver lägga till innehåll före en kontroll."/>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-vihem-muted">Resultatet och alla artikelantal sparas tillsammans.</p><Button loading={checkingBusy} disabled={reviewed!==items.length || !items.length} onClick={()=>void submitCheck()}>Spara kontroll</Button></div>
        {discardDialog}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl pb-6">
      <PageHeader title="Inventarielistor" subtitle="Städvagnar och andra inventarielistor." icon={Package} action={canManage ? <Button onClick={openCreateTemplate}><Plus className="h-4 w-4" />Ny inventarielista</Button> : undefined} />
      {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}<Button className="ml-3" variant="ghost" onClick={()=>void fetchAll()}><RefreshCw className="h-4 w-4"/>Försök igen</Button></div>}

      {templates.length === 0 ? (
        <EmptyState icon={Package} title="Inga inventarielistor" description="Skapa en lista, t.ex. Standard städvagn." />
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white">
          {templates.map(template => (
            <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-vihem-navy">{template.name}</h3>
                  <p className="text-xs text-slate-500">{(template.items || []).length} artiklar</p>
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={()=>openEditTemplate(template)} aria-label={`Redigera ${template.name}`}><Pencil className="h-4 w-4"/></Button>
                )}
              </div>
              <Button size="sm" variant="secondary" onClick={() => startCheck(template)}>Kontrollera</Button>
            </div>
          ))}
        </div>
      )}

      <Modal open={showTemplateModal} onClose={() => setShowTemplateModal(false)} title={templateForm.id ? 'Redigera inventarielista' : 'Ny inventarielista'} size="lg">
        <div className="space-y-4">
          <Input label="Namn" value={templateForm.name} onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder="Ex. Standard städvagn -- Airbnb" />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700">Artiklar</p>
            <div className="space-y-2">
              {templateForm.items.map((item, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                  <Input value={item.label} onChange={e => setTemplateForm({ ...templateForm, items: templateForm.items.map((it, i) => i === index ? { ...it, label: e.target.value } : it) })} placeholder="Ex. Mikrofiberdukar" className="min-w-[140px] flex-1" />
                  <Input type="number" value={item.desired_quantity || ''} onChange={e => setTemplateForm({ ...templateForm, items: templateForm.items.map((it, i) => i === index ? { ...it, desired_quantity: Number(e.target.value) } : it) })} placeholder="Antal" className="w-20" />
                  <Input value={item.unit} onChange={e => setTemplateForm({ ...templateForm, items: templateForm.items.map((it, i) => i === index ? { ...it, unit: e.target.value } : it) })} placeholder="st" className="w-16" />
                  <Select
                    value={item.stock_item_id}
                    onChange={e => setTemplateForm({ ...templateForm, items: templateForm.items.map((it, i) => i === index ? { ...it, stock_item_id: e.target.value } : it) })}
                    options={[{ value: '', label: 'Ingen lagerkoppling' }, ...stockItems.map(s => ({ value: s.id, label: s.name }))]}
                    className="min-w-[140px]"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setTemplateForm({ ...templateForm, items: templateForm.items.filter((_, i) => i !== index) })} aria-label="Ta bort"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setTemplateForm({ ...templateForm, items: [...templateForm.items, { label: '', desired_quantity: 1, unit: 'st', stock_item_id: '' }] })}>
                <Plus className="h-4 w-4" />Lägg till artikel
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowTemplateModal(false)}>Avbryt</Button>
            <Button type="button" onClick={saveTemplate} loading={saving}>Spara</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
