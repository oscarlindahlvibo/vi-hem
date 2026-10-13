import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';
import { clean, db, uploadMedia } from './api';

export const QUESTION_TYPES = [['single', 'Envalsfråga'], ['multiple', 'Flervalsfråga'], ['true_false', 'Sant/falskt'], ['image', 'Bildfråga (ett svar)']];
const blank = { topic: '', type: 'single', prompt: '', explanation: '', difficulty: 'medium', points: '1', active: true, image_asset_id: '' as string };
const twoBlank = () => [{ label: '', is_correct: true, feedback: '' }, { label: '', is_correct: false, feedback: '' }];

/** Skapa eller redigera en fråga (med svarsalternativ). Används både i frågebanken och direkt från provredigeraren i kursbyggaren. */
export function QuestionModal({ organisationId, question, topics, defaultTopic, onClose, onSaved }: { organisationId: string; question: any | null; topics: string[]; defaultTopic?: string; onClose: () => void; onSaved: (id: string) => void | Promise<void> }) {
  const [f, setF] = useState<any>(blank); const [options, setOptions] = useState<any[]>(twoBlank()); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState('');
  useEffect(() => {
    if (!question) return;
    setError('');
    if (!question.id) { setF({ ...blank, topic: defaultTopic ?? '' }); setOptions(twoBlank()); return; }
    setF({ ...blank, ...question, points: String(question.points), image_asset_id: question.image_asset_id ?? '' });
    void db.from('vihem_kp_question_options').select('*').eq('question_id', question.id).order('sort_order').then(({ data }) => setOptions((data || []).map((o: any) => ({ id: o.id, label: o.label, is_correct: o.is_correct, feedback: o.feedback }))));
  }, [question?.id, !!question]); // eslint-disable-line react-hooks/exhaustive-deps
  const setType = (type: string) => { setF({ ...f, type }); if (type === 'true_false') setOptions([{ label: 'Sant', is_correct: true, feedback: '' }, { label: 'Falskt', is_correct: false, feedback: '' }]); };
  const toggleCorrect = (i: number) => setOptions(options.map((o, j) => (f.type === 'multiple' ? (j === i ? { ...o, is_correct: !o.is_correct } : o) : { ...o, is_correct: j === i })));
  const save = async () => {
    const filled = options.filter(o => o.label.trim());
    if (!f.prompt.trim()) return setError('Skriv frågan.'); if (filled.length < 2) return setError('Minst två svarsalternativ krävs.'); if (!filled.some(o => o.is_correct)) return setError('Markera minst ett rätt svar.');
    if (f.type !== 'multiple' && filled.filter(o => o.is_correct).length > 1) return setError('Bara ett svar får vara rätt för den här frågetypen.');
    setBusy(true); setError('');
    const payload = { organisation_id: organisationId, topic: f.topic.trim(), type: f.type, prompt: f.prompt.trim(), explanation: f.explanation, difficulty: f.difficulty, points: Math.max(1, Number(f.points) || 1), active: f.active, image_asset_id: f.image_asset_id || null };
    const res = question?.id ? await db.from('vihem_kp_questions').update(payload).eq('id', question.id).select('id').single() : await db.from('vihem_kp_questions').insert(payload).select('id').single();
    if (res.error) { setBusy(false); return setError(clean(res.error.message)); }
    await db.from('vihem_kp_question_options').delete().eq('question_id', res.data.id);
    const { error: e2 } = await db.from('vihem_kp_question_options').insert(filled.map((o, i) => ({ organisation_id: organisationId, question_id: res.data.id, label: o.label.trim(), is_correct: o.is_correct, feedback: o.feedback ?? '', sort_order: i + 1 })));
    setBusy(false); if (e2) return setError(clean(e2.message));
    await onSaved(res.data.id); onClose();
  };
  const upload = async (file?: File) => { if (!file) return; try { const a = await uploadMedia(file, 'image', { alt: f.prompt.slice(0, 80), onProgress: setUploading }); setF((x: any) => ({ ...x, image_asset_id: a.asset_id })); } catch (e) { setError((e as Error).message); } setUploading(''); };
  return <Modal open={!!question} onClose={onClose} size="lg" title={question?.id ? 'Redigera fråga' : 'Ny fråga'} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Avbryt</Button><Button loading={busy} onClick={save}>Spara</Button></div>}>
    <div className="space-y-3">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-4"><Select label="Typ" value={f.type} onChange={e => setType(e.target.value)} options={QUESTION_TYPES.map(([value, label]) => ({ value, label }))} /><Input label="Ämne" value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} list="kp-topics" /><Select label="Svårighet" value={f.difficulty} onChange={e => setF({ ...f, difficulty: e.target.value })} options={[{ value: 'easy', label: 'Lätt' }, { value: 'medium', label: 'Medel' }, { value: 'hard', label: 'Svår' }]} /><Input label="Poäng" type="number" min="1" value={f.points} onChange={e => setF({ ...f, points: e.target.value })} /></div>
      <datalist id="kp-topics">{topics.map(t => <option key={t} value={t} />)}</datalist>
      <Textarea label="Fråga" rows={3} value={f.prompt} onChange={e => setF({ ...f, prompt: e.target.value })} />
      {f.type === 'image' && <div className="space-y-1 text-sm"><p className="font-medium">Bild till frågan (privat lagring)</p>{f.image_asset_id && <p className="text-xs text-emerald-700">✓ Bild uppladdad</p>}<input type="file" accept="image/*" onChange={e => upload(e.target.files?.[0])} />{uploading && <p className="text-xs text-slate-500">{uploading}</p>}</div>}
      <div className="space-y-2"><p className="text-sm font-medium">Svarsalternativ ({f.type === 'multiple' ? 'markera alla rätta' : 'markera det rätta'})</p>
        {options.map((o, i) => <div key={i} className="flex items-center gap-2"><input type={f.type === 'multiple' ? 'checkbox' : 'radio'} name="correct" checked={o.is_correct} onChange={() => toggleCorrect(i)} aria-label={`Alternativ ${i + 1} är rätt`} /><input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={o.label} disabled={f.type === 'true_false'} onChange={e => setOptions(options.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder={`Alternativ ${i + 1}`} />{f.type !== 'true_false' && options.length > 2 && <button type="button" aria-label="Ta bort alternativ" onClick={() => setOptions(options.filter((_, j) => j !== i))}>✕</button>}</div>)}
        {f.type !== 'true_false' && options.length < 8 && <Button size="sm" variant="secondary" onClick={() => setOptions([...options, { label: '', is_correct: false, feedback: '' }])}>+ Alternativ</Button>}</div>
      <Textarea label="Förklaring (visas som återkoppling)" rows={2} value={f.explanation} onChange={e => setF({ ...f, explanation: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Aktiv (kan användas i prov)</label>
      <p className="text-xs text-slate-500">Ändringar påverkar bara nya provförsök. Redan genomförda försök sparar frågan som den såg ut vid provtillfället.</p></div></Modal>;
}
