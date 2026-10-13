import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, StatusBadge, Textarea } from '../../components/ui';
import { TabProps } from './KompetensportalenPage';
import { QUESTION_TYPES, QuestionModal } from './QuestionEditor';
import { clean, db, dt, kpAdmin, STATUS_LABEL, tone, uploadMedia } from './api';

const TYPES = [['single', 'Envalsfråga'], ['multiple', 'Flervalsfråga'], ['true_false', 'Sant/falskt'], ['image', 'Bildfråga (ett svar)']];
const blank = { topic: '', type: 'single', prompt: '', explanation: '', difficulty: 'medium', points: '1', active: true, image_asset_id: '' as string };

export function QuestionsTab({ organisationId, isAdmin }: TabProps) {
  const [view, setView] = useState<'bank' | 'attempts'>('bank');
  return <div className="space-y-4"><div className="flex gap-2"><Button size="sm" variant={view === 'bank' ? 'primary' : 'secondary'} onClick={() => setView('bank')}>Frågebank</Button><Button size="sm" variant={view === 'attempts' ? 'primary' : 'secondary'} onClick={() => setView('attempts')}>Provresultat</Button></div>{view === 'bank' ? <Bank organisationId={organisationId} isAdmin={isAdmin} /> : <Attempts isAdmin={isAdmin} />}</div>;
}

function Bank({ organisationId, isAdmin }: { organisationId: string; isAdmin: boolean }) {
  const [qs, setQs] = useState<any[]>([]); const [counts, setCounts] = useState<Record<string, number>>({}); const [q, setQ] = useState(''); const [topic, setTopic] = useState(''); const [edit, setEdit] = useState<any | null>(null);
  const load = useCallback(async () => { const [a, b] = await Promise.all([db.from('vihem_kp_questions').select('*').order('topic').order('created_at', { ascending: false }), db.from('vihem_kp_question_options').select('question_id')]); setQs(a.data || []); const m: Record<string, number> = {}; (b.data || []).forEach((o: any) => { m[o.question_id] = (m[o.question_id] ?? 0) + 1; }); setCounts(m); }, []);
  useEffect(() => { void load(); }, [load]);
  const topics = useMemo(() => [...new Set(qs.map(x => x.topic).filter(Boolean))].sort() as string[], [qs]);
  const list = qs.filter(x => (!topic || x.topic === topic) && (!q || x.prompt.toLowerCase().includes(q.toLowerCase())));
  return <div className="space-y-4"><div className="flex flex-wrap items-end gap-3"><Input label="Sök fråga" value={q} onChange={e => setQ(e.target.value)} /><Select label="Ämne" value={topic} onChange={e => setTopic(e.target.value)} options={[{ value: '', label: 'Alla ämnen' }, ...topics.map(t => ({ value: t, label: t }))]} />{isAdmin && <Button className="ml-auto" onClick={() => setEdit({})}><Plus className="h-4 w-4" /> Ny fråga</Button>}</div>
    {!list.length ? <EmptyState title="Inga frågor" description="Frågor i banken kan återanvändas i flera prov och kurser." /> : <div className="space-y-2">{list.map(x => <Card key={x.id} className="flex items-start justify-between gap-3 p-3"><div><p className="font-medium">{x.prompt}</p><p className="text-xs text-slate-500">{QUESTION_TYPES.find(t => t[0] === x.type)?.[1]} · {x.topic || 'utan ämne'} · {x.points} p · {counts[x.id] ?? 0} alternativ{x.image_asset_id ? ' · bild' : ''}</p></div><div className="flex items-center gap-2">{!x.active && <Badge className="bg-slate-100 text-slate-600">Inaktiv</Badge>}{isAdmin && <Button size="sm" variant="secondary" onClick={() => setEdit(x)}>Redigera</Button>}</div></Card>)}</div>}
    <QuestionModal organisationId={organisationId} question={edit} topics={topics} onClose={() => setEdit(null)} onSaved={load} /></div>;
}

function Attempts({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<any[]>([]); const [people, setPeople] = useState<Record<string, any>>({}); const [review, setReview] = useState<any>(null); const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data } = await db.from('vihem_kp_exam_attempts').select('id,exam_id,enrollment_id,attempt_no,status,percent,passed,started_at,submitted_at,pass_percent_snapshot').order('started_at', { ascending: false }).limit(300); setRows(data || []);
    const ids = [...new Set((data || []).map((x: any) => x.enrollment_id))]; if (ids.length) { const { data: en } = await db.from('vihem_kp_enrollments').select('id,user_id,course:vihem_kp_courses(title)').in('id', ids); const uids = [...new Set((en || []).map((e: any) => e.user_id))]; const { data: p } = await db.from('vihem_kp_participants').select('user_id,first_name,last_name,email').in('user_id', uids); const pm = new Map((p || []).map((x: any) => [x.user_id, x])); setPeople(Object.fromEntries((en || []).map((e: any) => [e.id, { person: pm.get(e.user_id), course: (Array.isArray(e.course) ? e.course[0] : e.course)?.title }]))); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => { try { setReview(await kpAdmin('attempt_review', { attempt_id: id })); } catch (e) { setError((e as Error).message); } };
  const override = async (id: string, passed: boolean) => { const reason = prompt(`Orsak till att markera försöket som ${passed ? 'godkänt' : 'underkänt'} (sparas i revisionsspåret):`); if (!reason) return; try { await kpAdmin('exam_override', { attempt_id: id, passed, reason }); setReview(null); await load(); } catch (e) { setError((e as Error).message); } };
  return <div className="space-y-3">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="p-2">Deltagare</th><th>Kurs</th><th>Försök</th><th>Resultat</th><th>Status</th><th>Tid</th><th /></tr></thead><tbody>{rows.map(r => { const pe = people[r.enrollment_id]; return <tr key={r.id} className="border-t border-slate-100"><td className="p-2">{pe?.person ? `${pe.person.first_name} ${pe.person.last_name}` : '–'}<br /><span className="text-xs text-slate-500">{pe?.person?.email}</span></td><td>{pe?.course}</td><td>{r.attempt_no}</td><td>{r.percent != null ? `${Math.round(r.percent)} % (krav ${r.pass_percent_snapshot} %)` : '–'}</td><td>{r.status === 'in_progress' ? <StatusBadge tone="info">Pågår</StatusBadge> : <StatusBadge tone={r.passed ? 'success' : 'danger'}>{r.passed ? 'Godkänd' : r.status === 'expired' ? 'Utgången' : 'Underkänd'}</StatusBadge>}</td><td>{dt(r.submitted_at ?? r.started_at)}</td><td><Button size="sm" variant="ghost" onClick={() => open(r.id)}>Granska</Button></td></tr>; })}</tbody></table></div>
    <Modal open={!!review} onClose={() => setReview(null)} size="xl" title={review ? `Försök ${review.attempt.attempt_no} – ${Math.round(review.attempt.percent ?? 0)} %` : ''} footer={review && isAdmin && review.attempt.status !== 'in_progress' ? <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => override(review.attempt.id, true)}>Markera godkänt…</Button><Button variant="secondary" onClick={() => override(review.attempt.id, false)}>Markera underkänt…</Button></div> : undefined}>
      {review && <div className="space-y-3">{review.questions.map((q: any, i: number) => <div key={q.question_id} className="rounded-xl border border-slate-200 p-3"><p className="font-medium">{i + 1}. {q.prompt} <StatusBadge tone={q.answer?.correct ? 'success' : 'danger'}>{q.answer?.correct ? 'Rätt' : 'Fel/obesvarad'}</StatusBadge></p><ul className="mt-1 text-sm">{q.options.map((o: any) => <li key={o.id} className={o.is_correct ? 'font-semibold text-emerald-700' : ''}>{(q.answer?.option_ids ?? []).includes(o.id) ? '◉' : '○'} {o.label}{o.is_correct ? ' ✓' : ''}</li>)}</ul></div>)}
        <h3 className="font-semibold">Händelser (revisionsspår)</h3><ul className="text-sm text-slate-600">{review.events.map((e: any, i: number) => <li key={i}>{dt(e.created_at)} · {e.event_type}{e.detail?.reason ? ` – ${e.detail.reason}` : ''}</li>)}</ul></div>}</Modal></div>;
}
