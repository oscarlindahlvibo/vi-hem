// Fredagsmöte-ombygget: enkel operativ planeringstavla för personalmötets
// andra skärm. Redigerbar version här (kontrollvyn); skärm 2 självt visar
// en read-only variant via vihem-meeting-screen-data. "highlighted"-fältet
// styrs härifrån och framhävs på skärmen.
import React, { useState } from 'react';
import { Card, Button, Badge, Input, Select, Textarea } from '../../../components/ui';
import type { WeekPlanItem } from '../types';
import type { Profile } from '../../../types';

const STATUS_LABEL: Record<string, string> = { planned: 'Planerad', in_progress: 'Pågår', blocked: 'Blockerad', done: 'Klar' };
const STATUS_COLOR: Record<string, string> = {
  planned: 'bg-slate-100 text-slate-600', in_progress: 'bg-blue-100 text-blue-700',
  blocked: 'bg-red-100 text-red-700', done: 'bg-emerald-100 text-emerald-700',
};

interface WeekPlanBoardProps {
  items: WeekPlanItem[];
  staff: Pick<Profile, 'id' | 'name'>[];
  onAdd: (item: { title: string; responsible_user_id: string | null; planned_date: string | null; deadline: string | null; material_needed: string; blockers: string }) => Promise<void>;
  onUpdate: (id: string, patch: Partial<WeekPlanItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onHighlight: (id: string | null) => Promise<void>;
}

export function WeekPlanBoard({ items, staff, onAdd, onUpdate, onDelete, onHighlight }: WeekPlanBoardProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', responsible_user_id: '', planned_date: '', deadline: '', material_needed: '', blockers: '' });
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        title: form.title,
        responsible_user_id: form.responsible_user_id || null,
        planned_date: form.planned_date || null,
        deadline: form.deadline || null,
        material_needed: form.material_needed,
        blockers: form.blockers,
      });
      setForm({ title: '', responsible_user_id: '', planned_date: '', deadline: '', material_needed: '', blockers: '' });
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Veckoplan (skärm 2)</h4>
        <Button size="sm" onClick={() => setShowForm(s => !s)}>{showForm ? 'Stäng' : '+ Lägg till'}</Button>
      </div>

      {showForm && (
        <Card className="space-y-3 p-3">
          <Input label="Vad ska göras" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Ansvarig" value={form.responsible_user_id} onChange={e => setForm({ ...form, responsible_user_id: e.target.value })}
              options={[{ value: '', label: 'Ingen' }, ...staff.map(s => ({ value: s.id, label: s.name }))]} />
            <Input label="Planerad dag" type="date" value={form.planned_date} onChange={e => setForm({ ...form, planned_date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Deadline" type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
            <Input label="Materialbehov" value={form.material_needed} onChange={e => setForm({ ...form, material_needed: e.target.value })} />
          </div>
          <Textarea label="Hinder" value={form.blockers} onChange={e => setForm({ ...form, blockers: e.target.value })} rows={2} />
          <Button variant="primary" loading={saving} onClick={handleAdd}>Spara rad</Button>
        </Card>
      )}

      {items.length === 0 && <p className="text-sm text-slate-400">Inga rader i veckoplanen ännu.</p>}

      <div className="space-y-2">
        {items.map(item => {
          const respName = staff.find(s => s.id === item.responsible_user_id)?.name || 'Ej tilldelad';
          return (
            <Card key={item.id} className={`p-3 ${item.highlighted ? 'ring-2 ring-blue-500' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                    <Badge className={STATUS_COLOR[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {respName} · {item.planned_date || 'Ej planerad'} {item.deadline ? `· Deadline ${item.deadline}` : ''}
                  </p>
                  {item.material_needed && <p className="mt-1 text-xs text-slate-500">Material: {item.material_needed}</p>}
                  {item.blockers && <p className="mt-1 text-xs text-red-600">Hinder: {item.blockers}</p>}
                </div>
                <div className="flex flex-shrink-0 flex-col gap-1">
                  <Select
                    value={item.status}
                    onChange={e => onUpdate(item.id, { status: e.target.value as WeekPlanItem['status'] })}
                    options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                  <Button size="sm" variant={item.highlighted ? 'primary' : 'ghost'} onClick={() => onHighlight(item.highlighted ? null : item.id)}>
                    {item.highlighted ? 'Framhävd' : 'Framhäv'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(item.id)}>Ta bort</Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
