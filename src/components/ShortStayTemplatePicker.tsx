import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from './ui';
import { languageLabel, MessageTemplate } from '../lib/shortStayMessageTemplates';

export function ShortStayTemplatePicker({ organisationId, bookingId, unitId, disabled, hasDraft, onApply }: {
  organisationId: string; bookingId: string; unitId?: string; disabled: boolean; hasDraft: boolean; onApply: (text: string) => void;
}) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selected, setSelected] = useState('');
  const [language, setLanguage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setTemplates([]); setSelected(''); setLanguage('');
    async function load() {
      let resolved = unitId;
      if (!resolved) {
        const { data, error } = await supabase.from('vihem_short_stay_bookings').select('unit_id').eq('organisation_id', organisationId).eq('beds24_booking_id', bookingId).order('created_at', { ascending: false }).limit(1);
        if (error) throw new Error('Kunde inte hitta lägenheten för mallarna.');
        resolved = data?.[0]?.unit_id;
      }
      if (!resolved) return;
      const { data, error } = await supabase.from('vihem_short_stay_message_templates').select('*').eq('organisation_id', organisationId).eq('unit_id', resolved).order('name');
      if (error) throw new Error('Meddelandemallarna kunde inte hämtas.');
      if (live) setTemplates(data || []);
    }
    void load().catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [organisationId, bookingId, unitId]);
  const template = templates.find(value => value.id === selected);
  const languages = Object.keys(template?.translations || {});
  return <div className="space-y-2 rounded-lg bg-slate-50 p-3">
    <p className="text-sm font-medium">Använd meddelandemall</p>
    {loading ? <p className="text-sm text-slate-500">Hämtar lägenhetens mallar…</p> : error ? <p className="text-sm text-amber-700">{error}</p> : !templates.length ? <p className="text-sm text-slate-500">Inga mallar för den här lägenheten. Skapa dem under Meddelandemallar.</p> : <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[140px] flex-1 text-sm">Mall<select aria-label="Välj meddelandemall" value={selected} disabled={disabled} onChange={event => {
          setSelected(event.target.value);
          const translations = templates.find(value => value.id === event.target.value)?.translations || {};
          setLanguage(Object.prototype.hasOwnProperty.call(translations, language) ? language : Object.prototype.hasOwnProperty.call(translations, 'sv') ? 'sv' : Object.keys(translations)[0] || '');
        }} className="mt-1 block w-full rounded-lg border p-2 text-base"><option value="">Välj mall</option>{templates.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <label className="min-w-[120px] flex-1 text-sm">Språk<select aria-label="Välj mallspråk" value={language} disabled={disabled || !template} onChange={event => setLanguage(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-base">{!template && <option value="">Välj språk</option>}{languages.map(code => <option key={code} value={code}>{languageLabel(code)}</option>)}</select></label>
        <Button type="button" variant="secondary" disabled={disabled || !template?.translations[language]} onClick={() => {
          if (hasDraft && !window.confirm('Ersätta texten i svarsfältet med mallen?')) return;
          onApply(template!.translations[language]);
        }}>Lägg in mall</Button>
      </div>
      {template?.translations[language] && <details className="text-sm"><summary className="cursor-pointer text-slate-500">Förhandsvisa mall</summary><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{template.translations[language]}</p></details>}
    </>}
  </div>;
}
