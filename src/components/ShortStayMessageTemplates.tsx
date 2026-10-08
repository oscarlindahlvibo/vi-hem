import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Input } from './ui';
import { languageLabel, MessageTemplate, templateLanguages, validateTemplate } from '../lib/shortStayMessageTemplates';

export function ShortStayMessageTemplates({ organisationId, units, canManage }: {
  organisationId: string; units: { id: string; name: string }[]; canManage: boolean;
}) {
  const [unitId, setUnitId] = useState(units[0]?.id || '');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState('');
  const [variants, setVariants] = useState([{ language: 'sv', text: '' }]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    void supabase.from('vihem_short_stay_message_templates').select('*').eq('organisation_id', organisationId).eq('unit_id', unitId).order('name').then(({ data, error }) => {
      if (!live) return;
      if (error) setError('Kunde inte hämta mallarna. Kontrollera att mallfunktionen är installerad.');
      else setTemplates(data || []);
      setLoading(false);
    });
    return () => { live = false; };
  }, [organisationId, unitId, revision]);
  function open(template: MessageTemplate | null) {
    if (canManage && opened && !window.confirm('Öppna en annan mall och lämna det nuvarande utkastet?')) return;
    setEditing(template); setName(template?.name || '');
    setVariants(template ? Object.entries(template.translations).map(([language, text]) => ({ language, text })) : [{ language: 'sv', text: '' }]);
    setOpened(true); setError(''); setNotice('');
  }
  async function save() {
    if (busy || !canManage) return;
    let translations;
    try { translations = validateTemplate(name, variants); } catch (err) { setError((err as Error).message); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { name: name.trim(), translations };
      const result = editing
        ? await supabase.from('vihem_short_stay_message_templates').update(payload).eq('organisation_id', organisationId).eq('unit_id', unitId).eq('id', editing.id).eq('updated_at', editing.updated_at).select('id')
        : await supabase.from('vihem_short_stay_message_templates').insert({ ...payload, organisation_id: organisationId, unit_id: unitId }).select('id');
      if (result.error) throw new Error(result.error.code === '23505' ? 'En mall med det namnet finns redan för lägenheten.' : 'Kunde inte spara mallen.');
      if (!result.data?.length) throw new Error('Mallen har ändrats av någon annan. Öppna den igen innan du sparar.');
      setOpened(false); setEditing(null); setNotice('Mallen är sparad.'); setRevision(value => value + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(template: MessageTemplate) {
    if (busy || !canManage || !window.confirm(`Ta bort mallen ”${template.name}” med alla språk?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error } = await supabase.from('vihem_short_stay_message_templates').delete().eq('organisation_id', organisationId).eq('unit_id', unitId).eq('id', template.id).eq('updated_at', template.updated_at).select('id');
      if (error || !data?.length) throw new Error('Kunde inte ta bort mallen. Den kan ha ändrats av någon annan.');
      setOpened(false); setNotice('Mallen är borttagen.'); setRevision(value => value + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4">
    <div><h2 className="text-lg font-semibold">Meddelandemallar</h2><p className="text-sm text-slate-500">Skapa exempelvis välkomst- och incheckningsmallar per lägenhet. Skriv en egen text för varje språk och välj sedan mallen i gästens konversation.</p></div>
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-medium">Lägenhet / rum<select value={unitId} disabled={busy} onChange={event => {
      if (canManage && opened && !window.confirm('Byta lägenhet och lämna det nuvarande utkastet?')) return;
      setUnitId(event.target.value); setOpened(false); setTemplates([]); setNotice('');
    }} className="mt-1 block w-full rounded-lg border p-3 text-base">{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>{canManage && <Button onClick={() => open(null)} disabled={busy || !unitId}>Ny mall</Button>}</div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
      <div className="space-y-2">{loading ? <p>Hämtar mallar…</p> : !templates.length ? <p className="text-sm text-slate-500">Den här lägenheten har inga mallar ännu.</p> : templates.map(template => <button key={template.id} disabled={busy} onClick={() => open(template)} className={`w-full rounded-xl border bg-white p-4 text-left ${editing?.id === template.id && opened ? 'ring-2 ring-blue-500' : ''}`}><span className="font-semibold">{template.name}</span><span className="mt-1 block text-sm text-slate-500">{Object.keys(template.translations).map(languageLabel).join(' · ')}</span></button>)}</div>
      {opened && <form className="min-w-0 space-y-4 rounded-xl border bg-white p-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <Input label="Mallnamn" placeholder="Exempelvis Incheckning" value={name} maxLength={120} disabled={!canManage || busy} onChange={event => setName(event.target.value)} />
        {variants.map((variant, index) => <div key={index} className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-end gap-2"><label className="flex-1 text-sm font-medium">Språk<input aria-label={`Språkkod ${index + 1}`} list="short-stay-template-languages" value={variant.language} disabled={!canManage || busy} onChange={event => setVariants(values => values.map((value, i) => i === index ? { ...value, language: event.target.value } : value))} className="mt-1 block w-full rounded-lg border p-2 text-base" /></label><span className="py-2 text-sm text-slate-500">{languageLabel(variant.language)}</span>{canManage && variants.length > 1 && <Button type="button" variant="ghost" disabled={busy} onClick={() => setVariants(values => values.filter((_, i) => i !== index))}>Ta bort språk</Button>}</div>
          <label className="block text-sm font-medium">Meddelandetext<textarea value={variant.text} rows={7} maxLength={5000} disabled={!canManage || busy} onChange={event => setVariants(values => values.map((value, i) => i === index ? { ...value, text: event.target.value } : value))} className="mt-1 w-full rounded-lg border p-3 text-base" /></label><p className="text-xs text-slate-500">{variant.text.length}/5 000 tecken</p>
        </div>)}
        <datalist id="short-stay-template-languages">{templateLanguages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</datalist>
        {canManage && <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setVariants(values => [...values, { language: templateLanguages.find(([code]) => !values.some(value => value.language === code))?.[0] || '', text: '' }])}>Lägg till språk</Button><Button type="submit" loading={busy}>Spara mall</Button>{editing && <Button type="button" variant="danger" disabled={busy} onClick={() => void remove(editing)}>Ta bort mall</Button>}</div>}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => { if (!canManage || window.confirm('Stänga mallen och lämna utkastet?')) setOpened(false); }}>Stäng</Button>
      </form>}
    </div>
  </section>;
}
