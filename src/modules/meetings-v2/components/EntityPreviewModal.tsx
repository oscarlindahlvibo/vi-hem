// Popup-förhandsvisning av ett länkat objekt (arbetsorder/felanmälan/
// kundprojekt) direkt i mötesvyn -- man behöver inte navigera bort från
// mötet för att se vad en koppling faktiskt gäller.
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge, Button, LoadingPage, Modal } from '../../../components/ui';
import { MR_PRIORITY_LABELS, MR_STATUS_LABELS, WO_PRIORITY_LABELS, WO_STATUS_LABELS, formatDate } from '../../../lib/utils';
import type { MeetingObjectLinkEntityType } from '../types';

const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast', quote_created: 'Offert skapad', quote_sent: 'Offert skickad', quote_accepted: 'Offert godkänd',
  planned: 'Planerat', in_progress: 'Pågående', paused: 'Pausat', waiting_customer: 'Väntar kund',
  waiting_material: 'Väntar material', ready_for_inspection: 'Redo för besiktning', inspected_with_remarks: 'Besiktigat med anmärkning',
  approved: 'Godkänt', invoiced: 'Fakturerat', completed: 'Avslutat', archived: 'Arkiverat', cancelled: 'Avbrutet',
};

type PreviewData = { title: string; statusLabel: string; priorityLabel?: string; dueDate?: string | null; description?: string; navigatePage: string } | null;

export function EntityPreviewModal({ open, onClose, entityType, entityId, onNavigate }: {
  open: boolean; onClose: () => void; entityType: MeetingObjectLinkEntityType | null; entityId: string | null; onNavigate: (page: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<PreviewData>(null);

  useEffect(() => {
    if (!open || !entityType || !entityId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    (async () => {
      try {
        if (entityType === 'work_order') {
          const { data: row, error: err } = await supabase.from('vihem_work_orders').select('*').eq('id', entityId).single();
          if (err) throw err;
          if (!cancelled) setData({ title: row.title, statusLabel: WO_STATUS_LABELS[row.status as keyof typeof WO_STATUS_LABELS] || row.status, priorityLabel: WO_PRIORITY_LABELS[row.priority as keyof typeof WO_PRIORITY_LABELS] || row.priority, dueDate: row.due_date, description: row.description, navigatePage: `workorder/${row.id}` });
        } else if (entityType === 'maintenance_request') {
          const { data: row, error: err } = await supabase.from('vihem_maintenance_requests').select('*').eq('id', entityId).single();
          if (err) throw err;
          if (!cancelled) setData({ title: row.title, statusLabel: MR_STATUS_LABELS[row.status as keyof typeof MR_STATUS_LABELS] || row.status, priorityLabel: MR_PRIORITY_LABELS[row.priority as keyof typeof MR_PRIORITY_LABELS] || row.priority, description: row.description, navigatePage: 'maintenance' });
        } else if (entityType === 'customer_project') {
          const { data: row, error: err } = await supabase.from('vihem_customer_projects').select('*').eq('id', entityId).single();
          if (err) throw err;
          const title = row.title || row.name || row.customer_name || 'Kundprojekt';
          if (!cancelled) setData({ title, statusLabel: PROJECT_STATUS_LABELS[row.status] || row.status, description: row.description, navigatePage: 'customer-projects' });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Kunde inte hämta objektet.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, entityType, entityId]);

  return (
    <Modal open={open} onClose={onClose} title={data?.title || 'Kopplat objekt'}>
      {loading && <LoadingPage />}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && !loading && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge className="bg-slate-100 text-slate-700">{data.statusLabel}</Badge>
            {data.priorityLabel && <Badge className="bg-amber-50 text-amber-700">{data.priorityLabel}</Badge>}
            {data.dueDate && <Badge className="bg-slate-100 text-slate-600">Deadline {formatDate(data.dueDate)}</Badge>}
          </div>
          {data.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{data.description}</p>}
          <div className="flex justify-end">
            <Button size="sm" onClick={() => onNavigate(data.navigatePage)}><ExternalLink className="h-4 w-4" /> Öppna i fullvy</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
