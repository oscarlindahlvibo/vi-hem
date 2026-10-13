import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, StatusBadge, Textarea } from '../../components/ui';
import { TabProps } from './KompetensportalenPage';
import { clean, db, dt, money, STATUS_LABEL, tone, uploadMedia } from './api';

const FORMS = [['self_paced', 'Digital (egen takt)'], ['instructor_led', 'Lärarledd'], ['hybrid', 'Blandad']];
const empty = { code: '', slug: '', title: '', subtitle: '', summary: '', description: '', category: '', tags: '', delivery_form: 'self_paced', language: 'sv', target_audience: '', objectives: '', prerequisites: '', exam_info: '', estimated_minutes: '60', validity_months: '', renewal_notice_days: '90,30', requires_identity_verification: false, certificate_kind: 'training_certificate', id06_enabled: false, id06_competence_code: '', certificate_template_id: '', image_url: '', seo_title: '', seo_description: '', sort_order: '0', status: 'draft' };
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function CoursesTab({ organisationId, isAdmin, onOpenBuilder }: TabProps & { onOpenBuilder: (id: string) => void }) {
  const [courses, setCourses] = useState<any[]>([]); const [products, setProducts] = useState<any[]>([]); const [templates, setTemplates] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<any | null>(null); const [form, setForm] = useState<any>(empty); const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState('');
  const [priceFor, setPriceFor] = useState<any | null>(null);
  const load = useCallback(async () => {
    const [c, p, t] = await Promise.all([db.from('vihem_kp_courses').select('*').order('sort_order').order('title'), db.from('vihem_kp_products').select('*').eq('kind', 'course'), db.from('vihem_kp_certificate_templates').select('id,name,kind').eq('active', true)]);
    setCourses(c.data || []); setProducts(p.data || []); setTemplates(t.data || []); setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = (c?: any) => { setError(''); setEdit(c ?? {}); setForm(c ? { ...empty, ...Object.fromEntries(Object.keys(empty).map(k => [k, Array.isArray(c[k]) ? (k === 'renewal_notice_days' ? c[k].join(',') : c[k].join(k === 'objectives' ? '\n' : ', ')) : (c[k] ?? (typeof (empty as any)[k] === 'boolean' ? false : ''))])) } : empty); };
  const save = async () => {
    if (!form.code.trim() || !form.title.trim()) return setError('Kurskod och titel krävs.');
    setSaving(true); setError('');
    const payload: any = { ...form, organisation_id: organisationId, code: form.code.trim().toUpperCase(), slug: (form.slug || slugify(form.title)).trim(), tags: form.tags.split(',').map((x: string) => x.trim()).filter(Boolean), objectives: form.objectives.split('\n').map((x: string) => x.trim()).filter(Boolean),
      estimated_minutes: Math.max(0, Number(form.estimated_minutes) || 0), validity_months: form.validity_months === '' ? null : Math.max(1, Number(form.validity_months)), renewal_notice_days: form.renewal_notice_days.split(',').map((x: string) => Number(x.trim())).filter((n: number) => n > 0), sort_order: Number(form.sort_order) || 0,
      certificate_template_id: form.certificate_template_id || null, id06_competence_code: form.id06_enabled ? form.id06_competence_code || null : null, image_url: form.image_url || null, og_image_url: form.image_url || null };
    delete payload.status; // status ändras via publicering/arkivering, aldrig fritt i formuläret
    const res = edit?.id ? await db.from('vihem_kp_courses').update(payload).eq('id', edit.id).select('id').single() : await db.from('vihem_kp_courses').insert({ ...payload, status: 'draft' }).select('id').single();
    if (res.error) { setSaving(false); setError(clean(res.error.message)); return; }
    if (!edit?.id) await db.from('vihem_kp_course_versions').insert({ organisation_id: organisationId, course_id: res.data.id, version: 1, status: 'draft' });
    const created = !edit?.id; setSaving(false); setEdit(null); await load();
    if (created) onOpenBuilder(res.data.id); // ny kurs: gå direkt till kursbyggaren för att lägga in innehåll
  };
  const setStatus = async (c: any, status: string) => { const { error } = await db.from('vihem_kp_courses').update({ status }).eq('id', c.id); if (error) alert(clean(error.message)); await load(); };
  const dup = async (c: any) => { const code = prompt('Kurskod för kopian', `${c.code}-2`); if (!code) return; const { error } = await db.rpc('vihem_kp_duplicate_course', { p_course: c.id, p_code: code.toUpperCase(), p_slug: slugify(`${c.slug}-${code}`) }); if (error) alert(clean(error.message)); await load(); };
  const upload = async (file?: File) => { if (!file) return; try { const a = await uploadMedia(file, 'image', { isPublic: true, alt: form.title, onProgress: setUploading }); setForm((f: any) => ({ ...f, image_url: a.publicUrl })); } catch (e) { setError((e as Error).message); } setUploading(''); };
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  if (loading) return <p className="text-sm text-slate-500">Laddar…</p>;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{isAdmin && <Button onClick={() => open()}><Plus className="h-4 w-4" /> Ny kurs</Button>}</div>
      {!courses.length ? <EmptyState title="Inga kurser ännu" description="Skapa din första kurs och bygg innehållet i Kursbyggaren." /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="p-2">Kurs</th><th>Form</th><th>Status</th><th>Pris (exkl. moms)</th><th>Giltighet</th><th /></tr></thead><tbody>
          {courses.map(c => { const p = products.find(x => x.course_id === c.id); return <tr key={c.id} className="border-t border-slate-100 align-top"><td className="p-2"><strong>{c.title}</strong><br /><span className="text-xs text-slate-500">{c.code} · /{c.slug}</span></td><td>{FORMS.find(f => f[0] === c.delivery_form)?.[1]}</td>
            <td><StatusBadge tone={tone(c.status)}>{STATUS_LABEL[c.status]}</StatusBadge>{c.id06_enabled && <Badge className="ml-1 bg-orange-50 text-orange-700">ID06</Badge>}</td><td>{p ? money(p.price) : <span className="text-slate-400">Ingen produkt</span>}</td><td>{c.validity_months ? `${c.validity_months} mån` : 'Obegränsad'}</td>
            <td className="space-x-1 whitespace-nowrap p-2 text-right"><Button size="sm" variant="secondary" onClick={() => onOpenBuilder(c.id)}>Bygg</Button>{isAdmin && <><Button size="sm" variant="secondary" onClick={() => open(c)}>Redigera</Button><Button size="sm" variant="secondary" onClick={() => setPriceFor(c)}>Pris</Button><Button size="sm" variant="ghost" onClick={() => dup(c)}>Duplicera</Button>
              {c.status === 'archived' ? <Button size="sm" variant="ghost" onClick={() => setStatus(c, c.published_version_id ? 'published' : 'draft')}>Återställ</Button> : <Button size="sm" variant="ghost" onClick={() => confirm('Arkivera kursen? Den döljs från webbplatsen men befintliga deltagare behåller åtkomst.') && setStatus(c, 'archived')}>Arkivera</Button>}
              {c.status === 'draft' && c.published_version_id && <Button size="sm" variant="ghost" onClick={() => setStatus(c, 'coming_soon')}>Kommer snart</Button>}</>}</td></tr>; })}
        </tbody></table></div>)}
      <Modal open={!!edit} onClose={() => setEdit(null)} size="xl" title={edit?.id ? `Redigera ${edit.title}` : 'Ny kurs'} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Avbryt</Button><Button onClick={save} loading={saving}>Spara kurs</Button></div>}>
        <div className="space-y-4">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-3"><Input label="Kurskod" value={form.code} onChange={set('code')} /><Input label="Webbadress (slug)" value={form.slug} onChange={set('slug')} placeholder={slugify(form.title)} /><Select label="Utbildningsform" value={form.delivery_form} onChange={set('delivery_form')} options={FORMS.map(([value, label]) => ({ value, label }))} /></div>
          <Input label="Titel" value={form.title} onChange={set('title')} /><Input label="Underrubrik" value={form.subtitle} onChange={set('subtitle')} /><Textarea label="Sammanfattning (kurskort)" rows={2} value={form.summary} onChange={set('summary')} />
          <Textarea label="Beskrivning (markdown)" rows={6} value={form.description} onChange={set('description')} />
          <div className="grid gap-4 sm:grid-cols-2"><Textarea label="Målgrupp" rows={3} value={form.target_audience} onChange={set('target_audience')} /><Textarea label="Förkunskapskrav" rows={3} value={form.prerequisites} onChange={set('prerequisites')} /></div>
          <Textarea label="Kursmål (ett per rad)" rows={4} value={form.objectives} onChange={set('objectives')} /><Textarea label="Examinationsform (visas på kurssidan)" rows={2} value={form.exam_info} onChange={set('exam_info')} />
          <div className="grid gap-4 sm:grid-cols-3"><Input label="Ämneskategori" value={form.category} onChange={set('category')} /><Input label="Taggar (komma)" value={form.tags} onChange={set('tags')} /><Input label="Uppskattad tid (min)" type="number" value={form.estimated_minutes} onChange={set('estimated_minutes')} /></div>
          <div className="grid gap-4 sm:grid-cols-3"><Input label="Giltighet (månader, tomt = obegränsad)" type="number" value={form.validity_months} onChange={set('validity_months')} /><Input label="Förnyelsepåminnelser (dagar före, komma)" value={form.renewal_notice_days} onChange={set('renewal_notice_days')} /><Select label="Dokumenttyp" value={form.certificate_kind} onChange={set('certificate_kind')} options={[{ value: 'training_certificate', label: 'Utbildningsintyg' }, { value: 'competence_proof', label: 'Kompetensbevis' }]} /></div>
          <div className="grid gap-4 sm:grid-cols-2"><Select label="Certifikatmall (tomt = standard)" value={form.certificate_template_id} onChange={set('certificate_template_id')} options={[{ value: '', label: 'Standardmall för typen' }, ...templates.map(t => ({ value: t.id, label: t.name }))]} /><Input label="Sorteringsordning" type="number" value={form.sort_order} onChange={set('sort_order')} /></div>
          <div className="space-y-2 rounded-xl border border-slate-200 p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requires_identity_verification} onChange={set('requires_identity_verification')} /> Kräver verifierad identitet innan intyg utfärdas</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.id06_enabled} onChange={set('id06_enabled')} /> Kompetensen ska registreras i ID06 Kompetensdatabas (visas bara på webbplatsen när detta är aktivt)</label>
            {form.id06_enabled && <Input label="ID06 kompetenskod" value={form.id06_competence_code} onChange={set('id06_competence_code')} />}</div>
          <div className="space-y-2"><p className="text-sm font-medium">Kursbild (publik)</p>{form.image_url && <img src={form.image_url} alt="" className="h-28 rounded-lg object-cover" />}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => upload(e.target.files?.[0])} />{uploading && <p className="text-xs text-slate-500">{uploading}</p>}</div>
          <div className="grid gap-4 sm:grid-cols-2"><Input label="SEO-titel" value={form.seo_title} onChange={set('seo_title')} /><Input label="SEO-beskrivning" value={form.seo_description} onChange={set('seo_description')} /></div>
        </div>
      </Modal>
      {priceFor && <PriceModal course={priceFor} product={products.find(p => p.course_id === priceFor.id)} organisationId={organisationId} onClose={() => { setPriceFor(null); void load(); }} />}
    </div>
  );
}

function PriceModal({ course, product, organisationId, onClose }: { course: any; product?: any; organisationId: string; onClose: () => void }) {
  const [p, setP] = useState({ price: String(product?.price ?? ''), vat_rate: String(product?.vat_rate ?? 25), sku: product?.sku ?? course.code, active: product?.active ?? true });
  const [rules, setRules] = useState<any[]>([]); const [customers, setCustomers] = useState<any[]>([]); const [error, setError] = useState(''); const [prodId, setProdId] = useState<string | undefined>(product?.id);
  const [r, setR] = useState({ label: '', min_quantity: '1', unit_price: '', customer_id: '', valid_from: '', valid_until: '' });
  const loadRules = useCallback(async (id?: string) => { if (!id) return; const { data } = await db.from('vihem_kp_price_rules').select('*').eq('product_id', id).order('min_quantity'); setRules(data || []); }, []);
  useEffect(() => { void loadRules(prodId); db.from('vihem_kp_customers').select('id,name').order('name').then(({ data }) => setCustomers(data || [])); }, [prodId]);
  const saveProduct = async () => {
    setError(''); const payload = { organisation_id: organisationId, kind: 'course', course_id: course.id, sku: p.sku.trim(), name: course.title, price: Number(p.price), vat_rate: Number(p.vat_rate), active: p.active };
    if (!(payload.price >= 0) || !p.sku.trim()) return setError('Ange pris och SKU.');
    const res = prodId ? await db.from('vihem_kp_products').update(payload).eq('id', prodId).select('id').single() : await db.from('vihem_kp_products').insert(payload).select('id').single();
    if (res.error) return setError(clean(res.error.message)); setProdId(res.data.id); void loadRules(res.data.id);
  };
  const addRule = async () => { if (!prodId || !(Number(r.unit_price) >= 0) || r.unit_price === '') return setError('Spara produkten och ange pris.'); const { error } = await db.from('vihem_kp_price_rules').insert({ organisation_id: organisationId, product_id: prodId, label: r.label, min_quantity: Math.max(1, Number(r.min_quantity) || 1), unit_price: Number(r.unit_price), customer_id: r.customer_id || null, valid_from: r.valid_from || null, valid_until: r.valid_until || null }); if (error) return setError(clean(error.message)); setR({ label: '', min_quantity: '1', unit_price: '', customer_id: '', valid_from: '', valid_until: '' }); void loadRules(prodId); };
  return <Modal open onClose={onClose} size="lg" title={`Pris – ${course.title}`} footer={<div className="flex justify-end"><Button onClick={onClose}>Stäng</Button></div>}>
    <div className="space-y-5">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-4"><Input label="Pris exkl. moms (kr)" type="number" min="0" value={p.price} onChange={e => setP({ ...p, price: e.target.value })} /><Input label="Moms %" type="number" value={p.vat_rate} onChange={e => setP({ ...p, vat_rate: e.target.value })} /><Input label="SKU" value={p.sku} onChange={e => setP({ ...p, sku: e.target.value })} /><label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={p.active} onChange={e => setP({ ...p, active: e.target.checked })} /> Säljbar</label></div>
      <Button onClick={saveProduct}>Spara produkt</Button>
      {prodId && <><h3 className="font-semibold">Volym-, kampanj- och företagspriser</h3><p className="text-xs text-slate-500">Kunden får alltid lägsta giltiga pris. Företagspris gäller bara för valt företag.</p>
        <div className="grid gap-3 sm:grid-cols-6"><Input label="Etikett" value={r.label} onChange={e => setR({ ...r, label: e.target.value })} placeholder="Volym 10+" /><Input label="Från antal" type="number" min="1" value={r.min_quantity} onChange={e => setR({ ...r, min_quantity: e.target.value })} /><Input label="Pris/plats" type="number" min="0" value={r.unit_price} onChange={e => setR({ ...r, unit_price: e.target.value })} /><Select label="Företag" value={r.customer_id} onChange={e => setR({ ...r, customer_id: e.target.value })} options={[{ value: '', label: 'Alla' }, ...customers.map(c => ({ value: c.id, label: c.name }))]} /><Input label="Från datum" type="date" value={r.valid_from} onChange={e => setR({ ...r, valid_from: e.target.value })} /><Input label="Till datum" type="date" value={r.valid_until} onChange={e => setR({ ...r, valid_until: e.target.value })} /></div>
        <Button variant="secondary" onClick={addRule}>Lägg till prisregel</Button>
        <table className="w-full text-sm"><tbody>{rules.map(x => <tr key={x.id} className="border-t border-slate-100"><td className="py-1.5">{x.label || 'Prisregel'}</td><td>från {x.min_quantity} st</td><td>{money(x.unit_price)}</td><td>{customers.find(c => c.id === x.customer_id)?.name ?? 'Alla kunder'}</td><td className="text-xs text-slate-500">{x.valid_from ? dt(x.valid_from) : ''} {x.valid_until ? `– ${dt(x.valid_until)}` : ''}</td><td className="text-right"><Button size="sm" variant="ghost" onClick={async () => { await db.from('vihem_kp_price_rules').delete().eq('id', x.id); void loadRules(prodId); }}>Ta bort</Button></td></tr>)}</tbody></table></>}
    </div></Modal>;
}
