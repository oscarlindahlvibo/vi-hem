import React, { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Card, ChecklistItem, EmptyState, LoadingPage, PageHeader, Tabs } from '../components/ui';
import type { ChecklistInstance, ChecklistInstanceItem } from '../lib/operations';

export function OperationsChecklistsPage({ workOrderId }: { workOrderId?: string }) {
  const { user } = useAuth();
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'in_progress' | 'completed'>('in_progress');

  useEffect(() => { fetchInstances(); }, [user?.organisation_id, workOrderId]);

  async function fetchInstances() {
    if (!user?.organisation_id) { setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from('vihem_checklist_instances')
      .select('*, items:vihem_checklist_instance_items(*)')
      .eq('organisation_id', user.organisation_id)
      .order('created_at', { ascending: false });
    if (workOrderId) query = query.eq('work_order_id', workOrderId);
    const { data, error } = await query;
    if (!error) setInstances((data || []).map((row: any) => ({ ...row, items: (row.items || []).sort((a: ChecklistInstanceItem, b: ChecklistInstanceItem) => a.sort_order - b.sort_order) })) as ChecklistInstance[]);
    setLoading(false);
  }

  async function toggleItem(instance: ChecklistInstance, itemId: string, completed: boolean) {
    if (!user) return;
    await supabase.from('vihem_checklist_instance_items').update({ completed_by: completed ? user.id : null, completed_at: completed ? new Date().toISOString() : null }).eq('id', itemId);

    const updatedItems = (instance.items || []).map(item => item.id === itemId ? { ...item, completed_at: completed ? new Date().toISOString() : null } : item);
    const allRequiredDone = updatedItems.filter(i => i.required).every(i => Boolean(i.completed_at));
    const allDone = updatedItems.every(i => Boolean(i.completed_at));
    if (allDone && allRequiredDone && instance.status !== 'completed') {
      await supabase.from('vihem_checklist_instances').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', instance.id);
    }
    fetchInstances();
  }

  if (loading) return <LoadingPage />;

  const filtered = instances.filter(i => i.status === tab);

  return (
    <div className={workOrderId ? '' : 'min-h-screen bg-slate-50'}>
      {!workOrderId && <PageHeader title="Checklistor" subtitle="Pågående och avslutade arbetschecklistor." icon={ClipboardCheck} />}

      {!workOrderId && (
        <div className="mb-4">
          <Tabs tabs={[{ key: 'in_progress', label: 'Pågående' }, { key: 'completed', label: 'Avslutade' }]} active={tab} onChange={key => setTab(key as 'in_progress' | 'completed')} />
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Inga checklistor" description={workOrderId ? 'Ingen checklista kopplad till denna arbetsorder ännu.' : 'Inga checklistor i denna vy.'} />
      ) : (
        <div className="space-y-4">
          {filtered.map(instance => {
            const items = instance.items || [];
            const doneCount = items.filter(i => Boolean(i.completed_at)).length;
            return (
              <Card key={instance.id} className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-black text-slate-950">{instance.title}</h3>
                  <Badge className={instance.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                    {doneCount}/{items.length} klara
                  </Badge>
                </div>
                <div className="space-y-2">
                  {items.map(item => (
                    <ChecklistItem
                      key={item.id}
                      item={{ id: item.id, label: item.label, required: item.required, completed: Boolean(item.completed_at) }}
                      onToggle={(itemId, completed) => toggleItem(instance, itemId, completed)}
                      disabled={instance.status === 'completed'}
                    />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
