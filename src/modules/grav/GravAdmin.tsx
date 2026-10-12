// Administration av gavirserum.se (Gräv & Allservice i Virserum AB): inkomna offertförfrågningar, hemsidans innehåll och inställningar.
// Samma modell som Vibo hemsida och Ekängens hemsida: allt ägs av VI-HEM, sajten läser bara publika RPC:er.
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Globe, ImagePlus, Inbox, Mail, Phone, Plus, Settings2, Trash2, FileText } from 'lucide-react';
import { Badge, Button, Card, Input, LoadingPage, PageHeader, SegmentedControl, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';

type Tab = 'requests' | 'site' | 'settings';
type Status = 'new' | 'contacted' | 'quoted' | 'won' | 'lost' | 'spam';
interface RequestRow {
  id: string; reference: string; name: string; email: string; phone: string; location: string; service: string; message: string;
  preferred_time: string; images: { path: string; type: string; size: number }[]; status: Status; internal_note: string; created_at: string;
}
interface Service { title: string; description: string; icon: string }
interface Faq { question: string; answer: string }
interface GalleryImage { url: string; alt: string }
interface Content {
  company: Record<string, string>; text: Record<string, string>; services: Service[]; faq: Faq[];
  images: { hero: string; about: string; gallery: GalleryImage[] };
}
interface Settings { form_enabled: boolean; confirm_customer: boolean; notification_email: string; sender_email: string; revision: number }
interface Snapshot { content: { content: Content; revision: number }; settings: Settings; counts: Record<string, number> | null }
type ToastFn = (message: string, options?: { tone?: 'success' | 'error' | 'info' }) => void;

const IMAGE_BUCKET = 'vihem-grav-images';
const REQUEST_BUCKET = 'vihem-grav-requests';
const STATUS: Record<Status, { label: string; tone: string }> = {
  new: { label: 'Ny', tone: 'bg-red-100 text-red-700' },
  contacted: { label: 'Kontaktad', tone: 'bg-amber-100 text-amber-800' },
  quoted: { label: 'Offert skickad', tone: 'bg-blue-100 text-blue-700' },
  won: { label: 'Vunnen', tone: 'bg-emerald-100 text-emerald-700' },
  lost: { label: 'Förlorad', tone: 'bg-slate-100 text-slate-600' },
  spam: { label: 'Skräp', tone: 'bg-slate-100 text-slate-500' },
};
const ICONS = [
  { value: 'shovel', label: 'Spade (grävning)' }, { value: 'mountain', label: 'Berg (markarbete)' }, { value: 'wrench', label: 'Nyckel (service)' },
  { value: 'truck', label: 'Lastbil (transport)' }, { value: 'tree', label: 'Gran (skog/trädgård)' }, { value: 'trees', label: 'Träd' },
  { value: 'water', label: 'Vatten (dränering)' }, { value: 'snow', label: 'Snö (snöröjning)' }, { value: 'hammer', label: 'Hammare (bygg)' },
  { value: 'construction', label: 'Byggarbete' }, { value: 'hardhat', label: 'Hjälm' }, { value: 'waves', label: 'Vågor' },
];

function errorText(error: unknown, fallback: string) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (code === '40001') return 'Någon annan har ändrat samma sak. Ladda om sidan och försök igen.';
  if (code === '42501') return 'Du saknar behörighet. Du behöver vara aktiv administratör i Vibogruppen AB.';
  return message || fallback;
}
const normalizeImages = (i?: Partial<Content['images']>): Content['images'] => ({ hero: i?.hero ?? '', about: i?.about ?? '', gallery: i?.gallery ?? [] });
const when = (iso: string) => new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });

export function GravAdmin({ client }: { client: SupabaseClient }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('requests');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const [site, list] = await Promise.all([client.rpc('vihem_grav_admin_site'), client.rpc('vihem_grav_admin_requests')]);
    if (site.error) throw site.error;
    setSnap(site.data as Snapshot);
    setRequests((list.data || []) as RequestRow[]);
  }, [client]);
  useEffect(() => { load().catch((e) => setLoadError(errorText(e, 'Kunde inte läsa hemsidans inställningar.'))); }, [load]);

  if (loadError) return <Card className="p-6 text-sm text-red-700">{loadError}</Card>;
  if (!snap) return <LoadingPage />;
  const fresh = requests.filter((r) => r.status === 'new').length;

  return (
    <div className="space-y-5">
      <PageHeader title="Gräv & Allservice – hemsida" subtitle="gavirserum.se – offertförfrågningar, innehåll och inställningar" icon={Globe} />
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'requests', label: fresh ? `Förfrågningar (${fresh})` : 'Förfrågningar' },
          { value: 'site', label: 'Hemsida' },
          { value: 'settings', label: 'Inställningar' },
        ]}
      />
      {tab === 'requests' && <Requests client={client} rows={requests} reload={load} toast={toast.show} />}
      {tab === 'site' && <SiteTab client={client} snap={snap} reload={load} toast={toast.show} />}
      {tab === 'settings' && <SettingsTab client={client} settings={snap.settings} reload={load} toast={toast.show} />}
    </div>
  );
}

// ── Förfrågningar ──────────────────────────────────────────────────────────
function Requests({ client, rows, reload, toast }: { client: SupabaseClient; rows: RequestRow[]; reload: () => Promise<void>; toast: ToastFn }) {
  const [filter, setFilter] = useState<'open' | 'all' | Status>('open');
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'open' ? r.status === 'new' || r.status === 'contacted' || r.status === 'quoted' : r.status === filter));
  const chips: { key: typeof filter; label: string }[] = [
    { key: 'open', label: 'Pågående' }, { key: 'new', label: 'Nya' }, { key: 'won', label: 'Vunna' }, { key: 'lost', label: 'Förlorade' }, { key: 'spam', label: 'Skräp' }, { key: 'all', label: 'Alla' },
  ];
  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {chips.map((c) => (
          <button key={c.key} onClick={() => setFilter(c.key)} aria-pressed={filter === c.key} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${filter === c.key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
            {c.label} <span className="opacity-60">{c.key === 'all' ? rows.length : c.key === 'open' ? rows.filter((r) => ['new', 'contacted', 'quoted'].includes(r.status)).length : rows.filter((r) => r.status === c.key).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <Card className="p-8 text-center text-sm text-slate-500"><Inbox className="mx-auto mb-2 h-8 w-8 text-slate-300" />Inga förfrågningar här.</Card>}
      {shown.map((r) => <RequestCard key={r.id} client={client} row={r} reload={reload} toast={toast} />)}
    </div>
  );
}

function RequestCard({ client, row, reload, toast }: { client: SupabaseClient; row: RequestRow; reload: () => Promise<void>; toast: ToastFn }) {
  const [open, setOpen] = useState(row.status === 'new');
  const [status, setStatus] = useState<Status>(row.status);
  const [note, setNote] = useState(row.internal_note);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const dirty = useUnsavedChanges({ status, note }, true, { status: row.status, note: row.internal_note });

  useEffect(() => {
    if (!open || !row.images.length) return;
    let alive = true;
    Promise.all(row.images.map((i) => client.storage.from(REQUEST_BUCKET).createSignedUrl(i.path, 3600)))
      .then((res) => alive && setUrls(res.map((r) => r.data?.signedUrl || '').filter(Boolean)));
    return () => { alive = false; };
  }, [open, row.images, client]);

  async function save() {
    setBusy(true);
    try {
      const { error } = await client.rpc('vihem_grav_update_request', { p_id: row.id, p_status: status, p_note: note });
      if (error) throw error;
      toast('Sparat.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte spara.'), { tone: 'error' }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Radera förfrågan ${row.reference} från ${row.name} permanent? Det går inte att ångra.`)) return;
    setBusy(true);
    try {
      const { data, error } = await client.rpc('vihem_grav_delete_request', { p_id: row.id });
      if (error) throw error;
      const paths = ((data || []) as { path: string }[]).map((i) => i.path);
      if (paths.length) await client.storage.from(REQUEST_BUCKET).remove(paths);
      toast('Förfrågan är raderad.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte radera.'), { tone: 'error' }); setBusy(false); }
  }

  const s = STATUS[row.status];
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-3 p-4 text-left">
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-900">{row.name} <span className="font-mono text-xs font-semibold text-slate-400">{row.reference}</span></p>
          <p className="truncate text-sm text-slate-600">{[row.service, row.location].filter(Boolean).join(' · ')}</p>
          <p className="text-xs text-slate-500">{when(row.created_at)}{row.images.length ? ` · ${row.images.length} bild${row.images.length > 1 ? 'er' : ''}` : ''}</p>
        </div>
        <Badge className={s.tone}>{s.label}</Badge>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-800">{row.message}</p>
          <div className="flex flex-wrap gap-2 text-sm">
            {row.phone && <a href={`tel:${row.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 font-semibold text-slate-800 ring-1 ring-slate-200"><Phone className="h-4 w-4" />{row.phone}</a>}
            <a href={`mailto:${row.email}?subject=${encodeURIComponent('Din förfrågan ' + row.reference)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 font-semibold text-slate-800 ring-1 ring-slate-200"><Mail className="h-4 w-4" />{row.email}</a>
            {row.preferred_time && <span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-600">Önskad tid: {row.preferred_time}</span>}
          </div>
          {urls.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Kundens bild" loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover ring-1 ring-slate-200" /></a>)}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)} options={(Object.keys(STATUS) as Status[]).map((k) => ({ value: k, label: STATUS[k].label }))} />
            <Textarea label="Intern anteckning" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="T.ex. ringde 12/10, kommer och tittar på platsen torsdag" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button onClick={save} loading={busy} disabled={!dirty}>Spara</Button>
            <Button variant="ghost" size="sm" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" />Radera (GDPR)</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Hemsida: innehåll, tjänster, frågor och bilder (ett formulär, en sparning) ──
async function uploadImage(client: SupabaseClient, file: File, folder: string): Promise<string> {
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[file.type];
  if (!ext || file.size > 10 * 1024 * 1024) throw new Error('Välj en JPG, PNG eller WebP på högst 10 MB.');
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000' });
  if (error) throw error;
  return client.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

function ImagePicker({ client, label, value, onChange, toast }: { client: SupabaseClient; label: string; value: string; onChange: (url: string) => void; toast: ToastFn }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-slate-700">{label}</p>
      <div className="flex items-center gap-3">
        {value ? <img src={value} alt="" className="h-20 w-32 rounded-lg object-cover ring-1 ring-slate-200" /> : <div className="flex h-20 w-32 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Ingen bild</div>}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
          <ImagePlus className="h-4 w-4" />{busy ? 'Laddar upp…' : value ? 'Byt bild' : 'Välj bild'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            setBusy(true);
            try { onChange(await uploadImage(client, f, 'site')); } catch (err) { toast(errorText(err, 'Kunde inte ladda upp bilden.'), { tone: 'error' }); } finally { setBusy(false); }
          }} />
        </label>
        {value && <Button size="sm" variant="ghost" onClick={() => onChange('')}><Trash2 className="h-4 w-4" />Ta bort</Button>}
      </div>
    </div>
  );
}

function SiteTab({ client, snap, reload, toast }: { client: SupabaseClient; snap: Snapshot; reload: () => Promise<void>; toast: ToastFn }) {
  const saved = snap.content.content;
  const [c, setC] = useState<Content>({ ...saved, images: normalizeImages(saved.images), services: saved.services || [], faq: saved.faq || [] });
  const [busy, setBusy] = useState(false);
  const dirty = useUnsavedChanges(c, true, { ...saved, images: normalizeImages(saved.images) });
  const company = (k: string) => c.company?.[k] ?? '';
  const text = (k: string) => c.text?.[k] ?? '';
  const setCompany = (k: string, v: string) => setC((x) => ({ ...x, company: { ...x.company, [k]: v } }));
  const setText = (k: string, v: string) => setC((x) => ({ ...x, text: { ...x.text, [k]: v } }));
  const updateService = (i: number, p: Partial<Service>) => setC((x) => ({ ...x, services: x.services.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const updateFaq = (i: number, p: Partial<Faq>) => setC((x) => ({ ...x, faq: x.faq.map((f, j) => (j === i ? { ...f, ...p } : f)) }));

  async function save() {
    setBusy(true);
    try {
      const clean: Content = { ...c, services: c.services.filter((s) => s.title.trim()), faq: c.faq.filter((f) => f.question.trim() && f.answer.trim()) };
      const { error } = await client.rpc('vihem_grav_save_content', { p_content: clean, p_revision: snap.content.revision });
      if (error) throw error;
      toast('Sparat. Hemsidan visar ändringarna inom en minut.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte spara.'), { tone: 'error' }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900"><FileText className="h-4 w-4" />Företagsuppgifter</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Företagsnamn" value={company('name')} onChange={(e) => setCompany('name', e.target.value)} />
          <Input label="Slogan (visas i sidfoten)" value={company('tagline')} onChange={(e) => setCompany('tagline', e.target.value)} />
          <Input label="Telefon" value={company('phone')} onChange={(e) => setCompany('phone', e.target.value)} />
          <Input label="E-post" value={company('email')} onChange={(e) => setCompany('email', e.target.value)} />
          <Input label="Adress" value={company('address')} onChange={(e) => setCompany('address', e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Postnummer" value={company('postalCode')} onChange={(e) => setCompany('postalCode', e.target.value)} />
            <Input label="Ort" value={company('city')} onChange={(e) => setCompany('city', e.target.value)} />
          </div>
          <Input label="Organisationsnummer" value={company('orgNumber')} onChange={(e) => setCompany('orgNumber', e.target.value)} />
          <Input label="Verksamhetsområde" value={company('serviceArea')} onChange={(e) => setCompany('serviceArea', e.target.value)} />
        </div>
        <Textarea label="Öppettider / anträffbar (valfritt)" rows={2} value={company('openingHours')} onChange={(e) => setCompany('openingHours', e.target.value)} />
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-semibold text-slate-900">Texter</h3>
        <Input label="Rubrik på startsidan" value={text('heroTitle')} onChange={(e) => setText('heroTitle', e.target.value)} />
        <Textarea label="Text under rubriken" rows={2} value={text('heroText')} onChange={(e) => setText('heroText', e.target.value)} />
        <Input label="Rubrik: Om oss" value={text('aboutTitle')} onChange={(e) => setText('aboutTitle', e.target.value)} />
        <Textarea label="Text: Om oss" rows={6} value={text('aboutText')} onChange={(e) => setText('aboutText', e.target.value)} />
        <Textarea label="Text ovanför offertformuläret" rows={2} value={text('quoteIntro')} onChange={(e) => setText('quoteIntro', e.target.value)} />
        <Textarea label="Tack-text efter skickad förfrågan" rows={2} value={text('quoteThanks')} onChange={(e) => setText('quoteThanks', e.target.value)} />
        <Textarea label="Integritetspolicy (visas på /integritet)" rows={6} value={text('privacy')} onChange={(e) => setText('privacy', e.target.value)} />
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-semibold text-slate-900">Tjänster</h3>
        {c.services.map((s, i) => (
          <div key={i} className="space-y-2 rounded-2xl bg-slate-50 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
              <Input label="Namn" value={s.title} onChange={(e) => updateService(i, { title: e.target.value })} />
              <Select label="Ikon" value={s.icon || 'hardhat'} onChange={(e) => updateService(i, { icon: e.target.value })} options={ICONS} />
            </div>
            <Textarea label="Beskrivning" rows={3} value={s.description} onChange={(e) => updateService(i, { description: e.target.value })} />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setC((x) => { const n = [...x.services]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return { ...x, services: n }; })}>Flytta upp</Button>
              <Button size="sm" variant="ghost" onClick={() => setC((x) => ({ ...x, services: x.services.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" />Ta bort</Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setC((x) => ({ ...x, services: [...x.services, { title: '', description: '', icon: 'hardhat' }] }))}><Plus className="h-4 w-4" />Ny tjänst</Button>
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-semibold text-slate-900">Vanliga frågor (visas på sidan Tjänster)</h3>
        {c.faq.map((f, i) => (
          <div key={i} className="space-y-2 rounded-2xl bg-slate-50 p-3">
            <Input label="Fråga" value={f.question} onChange={(e) => updateFaq(i, { question: e.target.value })} />
            <Textarea label="Svar" rows={3} value={f.answer} onChange={(e) => updateFaq(i, { answer: e.target.value })} />
            <Button size="sm" variant="ghost" onClick={() => setC((x) => ({ ...x, faq: x.faq.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" />Ta bort</Button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setC((x) => ({ ...x, faq: [...x.faq, { question: '', answer: '' }] }))}><Plus className="h-4 w-4" />Ny fråga</Button>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-semibold text-slate-900">Bilder</h3>
        <ImagePicker client={client} label="Bakgrundsbild på startsidan" value={c.images.hero} onChange={(url) => setC((x) => ({ ...x, images: { ...x.images, hero: url } }))} toast={toast} />
        <ImagePicker client={client} label="Bild på sidan Om oss" value={c.images.about} onChange={(url) => setC((x) => ({ ...x, images: { ...x.images, about: url } }))} toast={toast} />
        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-700">Bildgalleri (visas på startsidan)</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {c.images.gallery.map((g, i) => (
              <div key={g.url} className="relative overflow-hidden rounded-lg ring-1 ring-slate-200">
                <img src={g.url} alt="" className="aspect-[4/3] w-full object-cover" />
                <button type="button" aria-label="Ta bort bild" onClick={() => setC((x) => ({ ...x, images: { ...x.images, gallery: x.images.gallery.filter((_, j) => j !== i) } }))} className="absolute right-1 top-1 rounded-full bg-slate-900/80 p-1 text-white"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs font-semibold text-slate-500 hover:bg-slate-50">
              <ImagePlus className="h-5 w-5" />Lägg till
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={async (e) => {
                const files = Array.from(e.target.files || []); e.target.value = '';
                const added: GalleryImage[] = [];
                for (const f of files) { try { added.push({ url: await uploadImage(client, f, 'gallery'), alt: '' }); } catch (err) { toast(errorText(err, 'Kunde inte ladda upp en bild.'), { tone: 'error' }); } }
                if (added.length) setC((x) => ({ ...x, images: { ...x.images, gallery: [...x.images.gallery, ...added] } }));
              }} />
            </label>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-24 z-10 flex items-center gap-3 rounded-2xl bg-white/95 p-3 shadow-float ring-1 ring-slate-200 backdrop-blur lg:bottom-4">
        <Button onClick={save} loading={busy} disabled={!dirty}>Spara hemsidan</Button>
        <span className="text-xs text-slate-500">{dirty ? 'Du har osparade ändringar.' : 'Allt är sparat.'}</span>
      </div>
    </div>
  );
}

// ── Inställningar ──────────────────────────────────────────────────────────
function SettingsTab({ client, settings, reload, toast }: { client: SupabaseClient; settings: Settings; reload: () => Promise<void>; toast: ToastFn }) {
  const [s, setS] = useState<Settings>(settings);
  const [busy, setBusy] = useState(false);
  const dirty = useUnsavedChanges(s, true, settings);
  async function save() {
    setBusy(true);
    try {
      const { error } = await client.rpc('vihem_grav_save_settings', { p_settings: s, p_revision: settings.revision });
      if (error) throw error;
      toast('Inställningarna är sparade.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte spara.'), { tone: 'error' }); }
    finally { setBusy(false); }
  }
  return (
    <Card className="space-y-4 p-5">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Settings2 className="h-4 w-4" />Offertformulär</h3>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <input type="checkbox" checked={s.form_enabled} onChange={(e) => setS({ ...s, form_enabled: e.target.checked })} className="h-4 w-4 accent-blue-600" />
        Formuläret är öppet på hemsidan
      </label>
      <label className="flex items-start gap-2 text-sm font-semibold text-slate-800">
        <input type="checkbox" checked={s.confirm_customer} onChange={(e) => setS({ ...s, confirm_customer: e.target.checked })} className="mt-0.5 h-4 w-4 accent-blue-600" />
        <span>Skicka en bekräftelse till kunden<span className="block text-xs font-normal text-slate-500">Kräver att en avsändaradress är ifylld nedan.</span></span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Mejla nya förfrågningar till" value={s.notification_email} onChange={(e) => setS({ ...s, notification_email: e.target.value })} hint="Admins får alltid en notis i VI-HEM." />
        <Input label="Avsändaradress för mejl" value={s.sender_email} onChange={(e) => setS({ ...s, sender_email: e.target.value })} hint="Måste vara en Google Workspace-adress, t.ex. kontakt@gavirserum.se. Tomt = inga mejl skickas." />
      </div>
      <Button onClick={save} loading={busy} disabled={!dirty}>Spara inställningar</Button>
    </Card>
  );
}
