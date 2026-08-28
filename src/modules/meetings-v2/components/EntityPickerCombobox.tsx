// Sökbar väljare för att koppla en dagordningspunkt till en arbetsorder,
// felanmälan eller ett kundprojekt -- ersätter legacys platta <select>.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input, Modal } from '../../../components/ui';
import type { SystemLinkOption } from '../types';

const subtitleOrder = ['Arbetsorder', 'Felanmälan', 'Kundprojekt'];

export function EntityPickerCombobox({ open, onClose, options, onSelect }: {
  open: boolean; onClose: () => void; options: SystemLinkOption[]; onSelect: (option: SystemLinkOption) => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? options.filter((o) => o.title.toLowerCase().includes(q)) : options;
    return rows.slice().sort((a, b) => subtitleOrder.indexOf(a.subtitle) - subtitleOrder.indexOf(b.subtitle)).slice(0, 60);
  }, [options, query]);

  const handleSelect = (option: SystemLinkOption) => {
    onSelect(option);
    setQuery('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Koppla objekt">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sök arbetsorder, felanmälan, kundprojekt..." className="pl-9" autoFocus />
        </div>
        <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {filtered.length ? filtered.map((option) => (
            <button
              key={`${option.type}:${option.id}`}
              type="button"
              onClick={() => handleSelect(option)}
              className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">{option.title}</span>
                <span className="text-xs text-slate-500">{option.subtitle}{option.status ? ` · ${option.status}` : ''}</span>
              </span>
            </button>
          )) : (
            <p className="p-4 text-center text-sm text-slate-400">Inga träffar.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
