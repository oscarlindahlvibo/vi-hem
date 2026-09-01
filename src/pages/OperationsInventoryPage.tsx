import React, { useEffect, useState } from 'react';
import { Package, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select } from '../components/ui';
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

  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => { fetchAll(); }, [user?.organisation_id]);

  async function fetchAll() {
    if (!user?.organisation_id) { setLoading(false); return; }
    setLoading(true);
    const [templatesResult, stockResult] = await Promise.all([
      supabase.from('vihem_inventory_templates').select('*, items:vihem_inventory_template_items(*)').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_inventory_stock_items').select('id,name,unit').eq('organisation_id', user.organisation_id).eq('active', true).order('name'),
    ]);
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
    setChecking(template);
    setActualQuantities({});
    setCheckResult(null);
    setMessage('');
  }

  async function submitCheck() {
    if (!checking || !user?.organisation_id) return;
    const items = checking.items || [];
    const { data: check, error: checkError } = await supabase
      .from('vihem_inventory_checks')
      .insert({ organisation_id: user.organisation_id, template_id: checking.id, performed_by: user.id })
      .select('id')
      .single();
    if (checkError || !check) { setError(checkError?.message || 'Kunde inte spara.'); return; }

    const rows = items.map(item => ({
      check_id: check.id,
      template_item_id: item.id,
      label: item.label,
      desired_quantity: item.desired_quantity,
      unit: item.unit,
      actual_quantity: actualQuantities[item.id] !== undefined ? Number(actualQuantities[item.id]) : item.desired_quantity,
    }));
    const { data: savedItems, error: itemsError } = await supabase.from('vihem_inventory_check_items').insert(rows).select('*');
    if (itemsError) { setError(itemsError.message); return; }

    setCheckResult({ id: check.id, items: savedItems || [] });
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
      const shortages = checkResult.items.filter((i: any) => Number(i.shortage) > 0);
      return (
        <div className="min-h-screen bg-slate-50">
          <PageHeader title={`Kontroll: ${checking.name}`} subtitle="Resultat av kontrollen." icon={Package} backButton={() => setChecking(null)} />
          {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</div>}
          {shortages.length === 0 ? (
            <EmptyState icon={Package} title="Allt finns" description="Inga brister hittades vid kontrollen." />
          ) : (
            <div className="space-y-3">
              {shortages.map((item: any) => {
                return (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-black text-slate-950">{item.label}</h3>
                        <p className="text-sm text-slate-500">Önskat: {item.desired_quantity} {item.unit} · Finns: {item.actual_quantity} {item.unit} · Saknas: {item.shortage} {item.unit}</p>
                      </div>
                      {item.action === 'added_to_purchase_list' ? (
                        <span className="text-xs font-black text-emerald-600">På inköpslistan</span>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => addShortageToPurchaseList(item)}>
                          <ShoppingCart className="h-4 w-4" />Lägg till inköpslista
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50">
        <PageHeader title={`Kontrollera: ${checking.name}`} subtitle="Ange vad som faktiskt finns för varje artikel." icon={Package} backButton={() => setChecking(null)} />
        <div className="space-y-3">
          {(checking.items || []).map(item => (
            <Card key={item.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-black text-slate-950">{item.label}</h3>
                  <p className="text-xs text-slate-500">Önskat: {item.desired_quantity} {item.unit}</p>
                </div>
                <Input
                  type="number"
                  value={actualQuantities[item.id] ?? ''}
                  onChange={e => setActualQuantities({ ...actualQuantities, [item.id]: e.target.value })}
                  placeholder={String(item.desired_quantity)}
                  className="w-24"
                />
              </div>
            </Card>
          ))}
          <Button onClick={submitCheck}>Slutför kontroll</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Inventarielistor" subtitle="Städvagnar och andra inventarielistor." icon={Package} action={canManage ? <Button onClick={openCreateTemplate}><Plus className="h-4 w-4" />Ny inventarielista</Button> : undefined} />
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      {templates.length === 0 ? (
        <EmptyState icon={Package} title="Inga inventarielistor" description="Skapa en lista, t.ex. Standard städvagn." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map(template => (
            <Card key={template.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-black text-slate-950">{template.name}</h3>
                  <p className="text-xs text-slate-500">{(template.items || []).length} artiklar</p>
                </div>
                {canManage && (
                  <button onClick={() => openEditTemplate(template)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Redigera">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                )}
              </div>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => startCheck(template)}>Kontrollera</Button>
            </Card>
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
