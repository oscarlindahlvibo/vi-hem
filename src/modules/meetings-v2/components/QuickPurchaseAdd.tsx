// Snabbtillägg till inköpslistan direkt från mötesvyn -- oberoende av
// AI-analysen, samma minimala insert-form som redan används i
// InventoryPage.tsx/AI-apply-flödet (vihem_purchase_items).
import { useState } from 'react';
import { Plus, ShoppingCart } from 'lucide-react';
import { Button, Card, Input } from '../../../components/ui';
import { quickAddPurchaseItem } from '../api';
import type { QuickPurchaseForm } from '../types';

const EMPTY_FORM: QuickPurchaseForm = { item_name: '', quantity: '', store_name: '', notes: '' };

export function QuickPurchaseAdd({ organisationId, userId }: { organisationId: string; userId: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<QuickPurchaseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.item_name.trim()) { setError('Ange vad som ska köpas in.'); return; }
    setSaving(true);
    setError('');
    try {
      await quickAddPurchaseItem(organisationId, userId, form);
      setForm(EMPTY_FORM);
      setMessage('Tillagt i inköpslistan.');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte lägga till.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm font-semibold text-slate-500 hover:border-blue-300 hover:text-blue-700">
        <ShoppingCart className="h-4 w-4" /> Lägg till i inköpslistan
      </button>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-800"><ShoppingCart className="h-4 w-4" /> Lägg till i inköpslistan</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-700">Stäng</button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="Artikel" />
        <Input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="Antal (t.ex. 2 st)" />
        <Input value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} placeholder="Butik (valfritt)" />
        <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anteckning (valfritt)" />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {message && <p className="mt-2 text-xs text-emerald-600">{message}</p>}
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={submit} loading={saving}><Plus className="h-4 w-4" /> Lägg till</Button>
      </div>
    </Card>
  );
}
