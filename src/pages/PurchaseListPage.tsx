import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useToast } from '../components/toast';
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  Check,
  ExternalLink,
  Pencil,
  Plus,
  ShoppingCart,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea, SearchInput, Tabs, Avatar } from '../components/ui';
import { formatDateTime } from '../lib/utils';
import type { PurchaseItem } from '../types';

type PurchaseStatusFilter = 'open' | 'all' | 'purchased' | 'cancelled';
type PurchaseForm = {
  store_name: string;
  item_name: string;
  quantity: string;
  product_url: string;
  notes: string;
  priority: PurchaseItem['priority'];
};

const defaultForm: PurchaseForm = {
  store_name: '',
  item_name: '',
  quantity: '',
  product_url: '',
  notes: '',
  priority: 'normal',
};

const priorityOptions = [
  { value: 'low', label: 'Låg' },
  { value: 'normal', label: 'Normal' },
  { value: 'urgent', label: 'Brådskande' },
];

const statusOptions = [
  { value: 'open', label: 'Att köpa' },
  { value: 'all', label: 'Alla' },
  { value: 'purchased', label: 'Inköpta' },
  { value: 'cancelled', label: 'Avbrutna' },
];

const priorityClasses: Record<PurchaseItem['priority'], string> = {
  low: 'bg-slate-100 text-slate-600',
  normal: 'bg-blue-100 text-blue-700',
  urgent: 'bg-red-100 text-red-700',
};

const priorityLabels: Record<PurchaseItem['priority'], string> = {
  low: 'Låg',
  normal: 'Normal',
  urgent: 'Brådskande',
};

const statusClasses: Record<PurchaseItem['status'], string> = {
  open: 'bg-amber-100 text-amber-700',
  purchased: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

const statusLabels: Record<PurchaseItem['status'], string> = {
  open: 'Att köpa',
  purchased: 'Inköpt',
  cancelled: 'Avbruten',
};

export function PurchaseListPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<PurchaseItem | null>(null);
  const [form, setForm] = useState<PurchaseForm>(defaultForm);
  const [saveError, setSaveError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseStatusFilter>('open');
  const [loadError,setLoadError]=useState('');
  const [actionError,setActionError]=useState('');
  const [pending,setPending]=useState<Set<string>>(new Set());
  const pendingOperations=useRef(new Set<string>());
  const [discard,setDiscard]=useState(false);
  const dirty=useUnsavedChanges(form,showModal);
  const toast=useToast();
  const closeEditor=()=>{if(saving)return;if(dirty){setDiscard(true);return;}setShowModal(false);setEditingItem(null);setForm(defaultForm);};

  const fetchItems=useCallback(async () => {
    if(!user?.organisation_id) return;
    try {
      setLoading(true);setLoadError('');
      const { data, error } = await supabase
        .from('vihem_purchase_items')
        .select(`
          *,
          creator:vihem_profiles!created_by(id, name, email, phone, role),
          purchaser:vihem_profiles!purchased_by(id, name, email, phone, role)
        `)
        .eq('organisation_id', user.organisation_id)
        .order('store_name', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setItems((data || []) as unknown as PurchaseItem[]);
    } catch (error) {
      setLoadError('Inköpslistan kunde inte hämtas. Försök igen.');
    } finally {
      setLoading(false);
    }
  },[user?.organisation_id]);
  useEffect(()=>{void fetchItems();},[fetchItems]);

  function openCreateModal() {
    setEditingItem(null);
    setForm(defaultForm);
    setSaveError('');
    setShowModal(true);
  }

  function openEditModal(item: PurchaseItem) {
    setEditingItem(item);
    setForm({
      store_name: item.store_name,
      item_name: item.item_name,
      quantity: item.quantity || '',
      product_url: item.product_url || '',
      notes: item.notes || '',
      priority: item.priority,
    });
    setSaveError('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!user||saving) return;
    setSaveError('');

    const storeName = form.store_name.trim();
    const itemName = form.item_name.trim();
    const productUrl = form.product_url.trim();

    if (!storeName) {
      setSaveError('Ange butik.');
      return;
    }

    if (!itemName) {
      setSaveError('Ange vad som ska köpas.');
      return;
    }

    if (productUrl && !/^https?:\/\//i.test(productUrl)) {
      setSaveError('Länken måste börja med http:// eller https://.');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        organisation_id: user.organisation_id,
        store_name: storeName,
        item_name: itemName,
        quantity: form.quantity.trim(),
        product_url: productUrl,
        notes: form.notes.trim(),
        priority: form.priority,
      };

      if (editingItem) {
        const { error } = await supabase
          .from('vihem_purchase_items')
          .update(payload)
          .eq('id', editingItem.id).select('id').single();
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('vihem_purchase_items')
          .insert({ ...payload, created_by: user.id }).select('id').single();
        if (error) throw error;
      }

      setShowModal(false);
      setEditingItem(null);
      setForm(defaultForm);
      await fetchItems();
      toast.show(editingItem?'Inköpet har sparats':'Inköpet har lagts till',{tone:'success'});
    } catch (error: any) {
      setSaveError(error.message || 'Kunde inte spara inköpet.');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(item: PurchaseItem, status: PurchaseItem['status']) {
    if(!user||pendingOperations.current.has(item.id))return;
    pendingOperations.current.add(item.id);setPending(new Set(pendingOperations.current));setActionError('');
    const payload=status==='purchased'?{status,purchased_by:user.id,purchased_at:new Date().toISOString()}:{status,purchased_by:null,purchased_at:null};
    try{const {error}=await supabase.from('vihem_purchase_items').update(payload).eq('id',item.id).select('id').single();if(error)throw error;setItems(current=>current.map(row=>row.id===item.id?{...row,...payload} as PurchaseItem:row));toast.show(status==='purchased'?'Markerat som inköpt':status==='open'?'Tillbaka på inköpslistan':'Inköpet har avbrutits',{tone:'success'});}catch{setActionError('Inköpet kunde inte uppdateras. Uppgifterna finns kvar; försök igen.');}finally{pendingOperations.current.delete(item.id);setPending(new Set(pendingOperations.current));}
  }

  async function deleteItem(item: PurchaseItem) {
    if (!window.confirm(`Ta bort "${item.item_name}" från inköpslistan?`)) return;
    const { error } = await supabase.from('vihem_purchase_items').delete().eq('id', item.id);
    if (error) {
      alert('Kunde inte ta bort inköpsraden. Endast admin kan ta bort.');
      return;
    }
    setItems((current) => current.filter((row) => row.id !== item.id));
  }

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesSearch = !query
        || item.item_name.toLowerCase().includes(query)
        || item.store_name.toLowerCase().includes(query)
        || item.notes.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [items, searchQuery, statusFilter]);

  const groupedItems = useMemo(() => {
    return filteredItems.reduce<Record<string, PurchaseItem[]>>((groups, item) => {
      const key = item.store_name.trim() || 'Okänd butik';
      groups[key] = groups[key] || [];
      groups[key].push(item);
      return groups;
    }, {});
  }, [filteredItems]);

  const openCount = items.filter((item) => item.status === 'open').length;
  const purchasedCount = items.filter((item) => item.status === 'purchased').length;
  const urgentCount = items.filter((item) => item.status === 'open' && item.priority === 'urgent').length;

  if (loading) return <LoadingPage />;
  if(loadError)return <div role="alert" className="space-y-4"><PageHeader title="Inköpslista"/><p>{loadError}</p><Button onClick={()=>void fetchItems()}>Försök igen</Button></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inköpslista"
        subtitle="Gemensam lista för personalens inköp, sorterad per butik"
        action={
          <Button variant="primary" onClick={openCreateModal}>
            <Plus className="w-4 h-4" />
            Lägg till
          </Button>
        }
      />

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-vihem-muted"><span><strong className="text-vihem-ink">{openCount}</strong> att köpa</span>{urgentCount>0&&<span className="text-red-700"><strong>{urgentCount}</strong> brådskande</span>}{purchasedCount>0&&<span>{purchasedCount} inköpta</span>}</div>
      <div className="space-y-3"><SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Sök produkt, butik eller kommentar…"/><Tabs tabs={statusOptions.map(option=>({key:option.value,label:option.label}))} active={statusFilter} onChange={key=>setStatusFilter(key as PurchaseStatusFilter)}/></div>
      {actionError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
      {filteredItems.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingCart className="w-12 h-12" />}
            title="Inga inköp att visa"
            description={searchQuery||statusFilter!=='open'?"Ändra sökningen eller välj en annan status.":"Lägg till något som behöver köpas. Listan grupperas efter butik."}
            action={<Button onClick={openCreateModal}><Plus className="w-4 h-4" /> Lägg till inköp</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {Object.entries(groupedItems).map(([storeName, storeItems]) => (
            <section key={storeName}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Store className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">{storeName}</h2>
                  <p className="text-xs text-slate-500">{storeItems.length} {storeItems.length === 1 ? 'sak' : 'saker'}</p>
                </div>
              </div>

              <div className="grid gap-3">
                {storeItems.map((item) => (
                  <Card key={item.id} className="p-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className={`font-semibold break-words ${item.status === 'purchased' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                            {item.item_name}
                          </h3>
                          <Badge className={statusClasses[item.status]}>{statusLabels[item.status]}</Badge>
                          {item.priority!=='normal'&&<Badge className={priorityClasses[item.priority]}>{priorityLabels[item.priority]}</Badge>}
                          {item.quantity && (
                            <Badge className="bg-slate-100 text-slate-600">
                              {item.quantity}
                            </Badge>
                          )}
                        </div>

                        {item.notes && (
                          <p className="text-sm text-slate-600 leading-relaxed break-words">{item.notes}</p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                          <span>Skapad {formatDateTime(item.created_at)}</span>
                          {item.creator?.name && <span className="inline-flex items-center gap-2"><Avatar userId={item.created_by} name={item.creator.name} size="xs"/>{item.creator.name}</span>}
                          {item.purchased_at && (
                            <span>Inköpt {formatDateTime(item.purchased_at)}{item.purchaser?.name ? ` av ${item.purchaser.name}` : ''}</span>
                          )}
                          {item.product_url && (
                            <a
                              href={item.product_url}
                              target="_blank"
                              rel="noreferrer"
                              className="vihem-focus vihem-touch-target inline-flex items-center gap-2 rounded-lg px-2 text-vihem-primary font-medium"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Produktlänk
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {item.status !== 'purchased' ? (
                          <Button size="sm" variant="secondary" loading={pending.has(item.id)} onClick={() => updateStatus(item, 'purchased')}>
                            <Check className="w-3.5 h-3.5" />
                            Inköpt
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" loading={pending.has(item.id)} onClick={() => updateStatus(item, 'open')}>
                            <X className="w-3.5 h-3.5" />
                            Ångra
                          </Button>
                        )}
                        {item.status !== 'cancelled' && (
                          <Button size="sm" variant="ghost" disabled={pending.has(item.id)} onClick={() => updateStatus(item, 'cancelled')}>
                            Avbryt
                          </Button>
                        )}
                        <Button size="sm" variant="outline" aria-label={`Redigera ${item.item_name}`} disabled={pending.has(item.id)} onClick={() => openEditModal(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {user?.role === 'admin' && (
                          <Button size="sm" variant="ghost" aria-label={`Ta bort ${item.item_name}`} disabled={pending.has(item.id)} className="text-red-600 hover:bg-red-50" onClick={() => deleteItem(item)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal mobileFullscreen
        open={showModal}
        onClose={closeEditor}
        title={editingItem ? 'Redigera inköp' : 'Lägg till inköp'}
        size="md"
        toolbar={saveError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
        footer={<><Button variant="secondary" disabled={saving} onClick={closeEditor}>Avbryt</Button><Button loading={saving} onClick={handleSave}>{editingItem?'Spara inköp':'Lägg till inköp'}</Button></>}
      >
        <fieldset disabled={saving} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Butik"
              value={form.store_name}
              onChange={(event) => setForm({ ...form, store_name: event.target.value })}
              placeholder="T.ex. Bauhaus, IKEA, Ahlsell"
            />
            <Input
              label="Produkt"
              value={form.item_name}
              onChange={(event) => setForm({ ...form, item_name: event.target.value })}
              placeholder="Vad behöver köpas?"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Antal / mängd"
              value={form.quantity}
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              placeholder="T.ex. 2 st, 10 meter, 1 paket"
            />
            <Select
              label="Prioritet"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value as PurchaseItem['priority'] })}
              options={priorityOptions}
            />
          </div>

          <Input
            label="Länk till produkt eller webbutik"
            value={form.product_url}
            onChange={(event) => setForm({ ...form, product_url: event.target.value })}
            placeholder="https://..."
            hint="Valfritt. Används för webbutik eller direktlänk till produkten."
          />

          <Textarea
            label="Kommentar"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="T.ex. dimension, färg, var i fastigheten det behövs..."
            rows={3}
          />

        </fieldset>
      </Modal>
      <Modal open={discard} onClose={()=>setDiscard(false)} title="Lämna osparade ändringar?" footer={<><Button variant="secondary" onClick={()=>setDiscard(false)}>Fortsätt redigera</Button><Button variant="danger" onClick={()=>{setDiscard(false);setShowModal(false);setEditingItem(null);setForm(defaultForm);}}>Lämna utan att spara</Button></>}><p>Inköpsuppgifterna har inte sparats.</p></Modal>
    </div>
  );
}

export default PurchaseListPage;
