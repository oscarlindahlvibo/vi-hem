import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';
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

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vihem_purchase_items')
        .select(`
          *,
          creator:vihem_profiles!created_by(id, name, email, phone, role),
          purchaser:vihem_profiles!purchased_by(id, name, email, phone, role)
        `)
        .order('store_name', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setItems((data || []) as unknown as PurchaseItem[]);
    } catch (error) {
      console.error('Error fetching purchase items:', error);
    } finally {
      setLoading(false);
    }
  }

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
    if (!user) return;
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
          .eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('vihem_purchase_items')
          .insert({ ...payload, created_by: user.id });
        if (error) throw error;
      }

      setShowModal(false);
      setEditingItem(null);
      setForm(defaultForm);
      await fetchItems();
    } catch (error: any) {
      setSaveError(error.message || 'Kunde inte spara inköpet.');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(item: PurchaseItem, status: PurchaseItem['status']) {
    if (!user) return;
    const payload = status === 'purchased'
      ? { status, purchased_by: user.id, purchased_at: new Date().toISOString() }
      : { status, purchased_by: null, purchased_at: null };

    const { error } = await supabase
      .from('vihem_purchase_items')
      .update(payload)
      .eq('id', item.id);

    if (error) {
      alert('Kunde inte uppdatera inköpsraden.');
      return;
    }

    setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...payload } as PurchaseItem : row));
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500 mb-1">Att köpa</p>
          <p className="text-2xl font-bold text-amber-600">{openCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 mb-1">Brådskande</p>
          <p className="text-2xl font-bold text-red-600">{urgentCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 mb-1">Inköpta</p>
          <p className="text-2xl font-bold text-green-600">{purchasedCount}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Sök produkt, butik eller kommentar..."
              className="w-full border border-slate-300 bg-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as PurchaseStatusFilter)}
            options={statusOptions}
          />
        </div>
      </Card>

      {filteredItems.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingCart className="w-12 h-12" />}
            title="Inga inköp att visa"
            description="Lägg till något som behöver köpas, så sorteras det automatiskt under rätt butik."
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
                          <Badge className={priorityClasses[item.priority]}>{priorityLabels[item.priority]}</Badge>
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
                          {item.creator?.name && <span>av {item.creator.name}</span>}
                          {item.purchased_at && (
                            <span>Inköpt {formatDateTime(item.purchased_at)}{item.purchaser?.name ? ` av ${item.purchaser.name}` : ''}</span>
                          )}
                          {item.product_url && (
                            <a
                              href={item.product_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Produktlänk
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {item.status !== 'purchased' ? (
                          <Button size="sm" variant="secondary" onClick={() => updateStatus(item, 'purchased')}>
                            <Check className="w-3.5 h-3.5" />
                            Inköpt
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => updateStatus(item, 'open')}>
                            <X className="w-3.5 h-3.5" />
                            Ångra
                          </Button>
                        )}
                        {item.status !== 'cancelled' && (
                          <Button size="sm" variant="ghost" onClick={() => updateStatus(item, 'cancelled')}>
                            Avbryt
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => openEditModal(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {user?.role === 'admin' && (
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => deleteItem(item)}>
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

      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingItem(null);
          setForm(defaultForm);
        }}
        title={editingItem ? 'Redigera inköp' : 'Lägg till inköp'}
        size="lg"
      >
        <div className="space-y-4">
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

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {saveError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowModal(false);
                setEditingItem(null);
                setForm(defaultForm);
              }}
            >
              Avbryt
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              <PackagePlus className="w-4 h-4" />
              {editingItem ? 'Spara' : 'Lägg till'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default PurchaseListPage;
