// Administration av ekangensvandrarhem.se (publik sajt + direktbokning). Monteras i VI-HEM med inloggad Supabase-klient.
// Samma modell som Vibo hemsida: allt innehåll, priser och bokningar ägs av VI-HEM; sajten läser bara publika RPC:er.
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Globe, HelpCircle, ImagePlus, Plus, Settings2, Trash2, CalendarCheck, BedDouble, FileText } from 'lucide-react';
import { Badge, Button, Card, Input, LoadingPage, PageHeader, SegmentedControl, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';

type Tab = 'bookings' | 'units' | 'content' | 'faq' | 'settings';
interface Img { url: string; alt: string }
interface UnitPayload { title?: string; slug?: string; kind?: string; shortDescription?: string; description?: string; beds?: string; features?: string[]; images?: Img[] }
interface Unit { unit_id: string; name: string; max_guests: number; is_active: boolean; published: boolean; sort_order: number; payload: UnitPayload; revision: number; has_prices: boolean }
interface Faq { category: string; question: string; answer: string }
interface Content { company: Record<string, string>; text: Record<string, string>; faq: Faq[]; images?: Record<string, string> }
interface Settings {
  booking_enabled: boolean; discount_percent: number; free_cancel_days: number; hold_minutes: number; min_nights: number; max_nights: number;
  check_in_time: string; check_out_time: string; notification_email: string; sender_email: string; revision: number;
}
interface Snapshot { content: { content: Content; revision: number }; settings: Settings; units: Unit[] }
interface BookingRow { id: string; reference: string; unit: string; start_date: string; end_date: string; guests: number; guest_name: string; guest_email: string; guest_phone: string; message: string; total: number; currency: string; status: string; free_cancel_until: string | null; paid_at: string | null; created_at: string }

const BUCKET = 'vihem-ekangen-images';
const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Väntar på betalning', tone: 'bg-amber-100 text-amber-800' },
  paid: { label: 'Betald', tone: 'bg-emerald-100 text-emerald-700' },
  expired: { label: 'Utgången', tone: 'bg-slate-100 text-slate-600' },
  cancelled: { label: 'Avbokad', tone: 'bg-slate-100 text-slate-600' },
  refunded: { label: 'Återbetald', tone: 'bg-blue-100 text-blue-700' },
  conflict: { label: 'Behöver åtgärd', tone: 'bg-red-100 text-red-700' },
};

function errorText(error: unknown, fallback: string) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (code === '40001') return 'Någon annan har ändrat samma sak. Ladda om sidan och försök igen.';
  if (code === '42501') return 'Du saknar behörighet. Du behöver vara aktiv administratör i Vibogruppen AB.';
  if (code === '23514') return 'Rummet saknar rubrik, beskrivning eller bild och kan inte publiceras.';
  if (message?.includes('Missing prices')) return 'Rummet saknar priser i Korttid. Lägg in priser innan du publicerar det.';
  return message || fallback;
}

export function EkangenAdmin({ client }: { client: SupabaseClient }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('bookings');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const [site, list] = await Promise.all([client.rpc('vihem_ekangen_admin_site'), client.rpc('vihem_ekangen_admin_bookings')]);
    if (site.error) throw site.error;
    setSnap(site.data as Snapshot);
    setBookings((list.data || []) as BookingRow[]);
  }, [client]);

  useEffect(() => { load().catch((e) => setLoadError(errorText(e, 'Kunde inte läsa hemsidans inställningar.'))); }, [load]);

  if (loadError) return <Card className="p-6 text-sm text-red-700">{loadError}</Card>;
  if (!snap) return <LoadingPage />;

  const attention = bookings.filter((b) => b.status === 'conflict').length;
  return (
    <div className="space-y-5">
      <PageHeader title="Ekängens hemsida" subtitle="ekangensvandrarhem.se – innehåll, rum, priser och direktbokningar" icon={Globe} />
      {!snap.settings.booking_enabled && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Direktbokning är avstängd. Hemsidan visar information men går inte att boka förrän du slår på den under Inställningar.</p>
      )}
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'bookings', label: attention ? `Bokningar (${attention}!)` : 'Bokningar' },
          { value: 'units', label: 'Rum' },
          { value: 'content', label: 'Texter' },
          { value: 'faq', label: 'Frågor' },
          { value: 'settings', label: 'Inställningar' },
        ]}
      />
      {tab === 'bookings' && <Bookings rows={bookings} />}
      {tab === 'units' && <Units client={client} units={snap.units} reload={load} toast={toast.show} />}
      {tab === 'content' && <ContentTab client={client} snap={snap} reload={load} toast={toast.show} />}
      {tab === 'faq' && <FaqTab client={client} snap={snap} reload={load} toast={toast.show} />}
      {tab === 'settings' && <SettingsTab client={client} settings={snap.settings} reload={load} toast={toast.show} />}
    </div>
  );
}

type ToastFn = (message: string, options?: { tone?: 'success' | 'error' | 'info' }) => void;

// ── Bokningar ──────────────────────────────────────────────────────────────
function Bookings({ rows }: { rows: BookingRow[] }) {
  if (!rows.length) return <Card className="p-8 text-center text-sm text-slate-500"><CalendarCheck className="mx-auto mb-2 h-8 w-8 text-slate-300" />Inga direktbokningar än.</Card>;
  return (
    <div className="space-y-2.5">
      {rows.map((b) => {
        const s = STATUS[b.status] || { label: b.status, tone: 'bg-slate-100 text-slate-600' };
        return (
          <Card key={b.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-slate-900">{b.guest_name} <span className="font-mono text-xs font-semibold text-slate-400">{b.reference}</span></p>
                <p className="text-sm text-slate-600">{b.unit} · {b.start_date} → {b.end_date} · {b.guests} gäst{b.guests > 1 ? 'er' : ''}</p>
                <p className="text-xs text-slate-500">{b.guest_email}{b.guest_phone ? ` · ${b.guest_phone}` : ''}</p>
                {b.message && <p className="mt-1 text-xs italic text-slate-500">”{b.message}”</p>}
              </div>
              <div className="text-right">
                <Badge className={s.tone}>{s.label}</Badge>
                <p className="mt-1 text-sm font-bold text-slate-900">{Number(b.total).toLocaleString('sv-SE')} {b.currency}</p>
                {b.free_cancel_until && b.status === 'paid' && <p className="text-xs text-slate-500">Gratis avbokning till {b.free_cancel_until}</p>}
              </div>
            </div>
            {b.status === 'conflict' && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Gästen har betalat men datumen hann bli upptagna. Återbetala i Stripe och kontakta gästen.</p>}
          </Card>
        );
      })}
    </div>
  );
}

// ── Bilder ─────────────────────────────────────────────────────────────────
async function uploadImage(client: SupabaseClient, file: File, folder: string): Promise<string> {
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[file.type];
  if (!ext || file.size > 10 * 1024 * 1024) throw new Error('Välj en JPG, PNG eller WebP på högst 10 MB.');
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000' });
  if (error) throw error;
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function ImageEditor({ client, folder, images, onChange, toast }: { client: SupabaseClient; folder: string; images: Img[]; onChange: (next: Img[]) => void; toast: ToastFn }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {images.map((img, i) => (
          <div key={img.url} className="group relative overflow-hidden rounded-xl ring-1 ring-slate-200">
            <img src={img.url} alt={img.alt} className="aspect-[4/3] w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              <button type="button" disabled={i === 0} onClick={() => { const n = [...images]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} className="px-1.5 text-xs font-bold disabled:opacity-30">←</button>
              <button type="button" onClick={() => onChange(images.filter((_, j) => j !== i))} aria-label="Ta bort bild" className="px-1.5"><Trash2 className="h-3.5 w-3.5" /></button>
              <button type="button" disabled={i === images.length - 1} onClick={() => { const n = [...images]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); }} className="px-1.5 text-xs font-bold disabled:opacity-30">→</button>
            </div>
            {i === 0 && <span className="absolute left-1 top-1 rounded-full bg-vihem-blue px-2 py-0.5 text-[10px] font-bold text-white">Huvudbild</span>}
          </div>
        ))}
        <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-xs font-semibold text-slate-500 hover:bg-slate-50">
          <ImagePlus className="h-5 w-5" />{busy ? 'Laddar upp...' : 'Lägg till bild'}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={busy} onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (!files.length) return;
            setBusy(true);
            try {
              const added: Img[] = [];
              for (const f of files) added.push({ url: await uploadImage(client, f, folder), alt: '' });
              onChange([...images, ...added]);
            } catch (err) { toast(errorText(err, 'Kunde inte ladda upp bilden.'), { tone: 'error' }); }
            finally { setBusy(false); }
          }} />
        </label>
      </div>
    </div>
  );
}

// ── Rum ────────────────────────────────────────────────────────────────────
function Units({ client, units, reload, toast }: { client: SupabaseClient; units: Unit[]; reload: () => Promise<void>; toast: ToastFn }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Alla korttidsenheter finns här. Bara enheter du publicerar (och som har priser i Korttid) visas och kan bokas på hemsidan. Priser och tillgänglighet styrs i Korttid.</p>
      {units.map((u) => <UnitCard key={u.unit_id} client={client} unit={u} reload={reload} toast={toast} />)}
    </div>
  );
}

function UnitCard({ client, unit, reload, toast }: { client: SupabaseClient; unit: Unit; reload: () => Promise<void>; toast: ToastFn }) {
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState(unit.published);
  const [p, setP] = useState<UnitPayload>({ kind: 'room', features: [], images: [], ...unit.payload, title: unit.payload.title ?? unit.name });
  const [sort, setSort] = useState(String(unit.sort_order));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<UnitPayload>) => setP((cur) => ({ ...cur, ...patch }));

  async function save() {
    setBusy(true);
    try {
      const payload = { ...p, slug: (p.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') };
      const { error } = await client.rpc('vihem_ekangen_save_unit', { p_unit_id: unit.unit_id, p_published: published, p_payload: payload, p_sort: Number(sort) || 0, p_revision: unit.revision });
      if (error) throw error;
      toast(published ? 'Sparat. Rummet visas på hemsidan.' : 'Sparat som utkast.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte spara.'), { tone: 'error' }); }
    finally { setBusy(false); }
  }

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <BedDouble className="h-5 w-5 shrink-0 text-vihem-blue" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{unit.name}</p>
            <p className="text-xs text-slate-500">Upp till {unit.max_guests} gäster{unit.has_prices ? '' : ' · saknar priser i Korttid'}</p>
          </div>
        </div>
        <Badge className={unit.published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>{unit.published ? 'Publicerad' : 'Utkast'}</Badge>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="h-4 w-4 accent-blue-600" /> Visa och tillåt bokning på hemsidan
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Rubrik" value={p.title || ''} onChange={(e) => set({ title: e.target.value })} />
            <Input label="Adress på sajten (t.ex. rum-1)" value={p.slug || ''} onChange={(e) => set({ slug: e.target.value })} />
            <Select label="Typ" value={p.kind || 'room'} onChange={(e) => set({ kind: e.target.value })} options={[{ value: 'room', label: 'Rum' }, { value: 'apartment', label: 'Lägenhet' }]} />
            <Input label="Sängar (t.ex. 2 enkelsängar + 1 bäddsoffa)" value={p.beds || ''} onChange={(e) => set({ beds: e.target.value })} />
            <Input label="Sorteringsordning" type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
          </div>
          <Input label="Kort beskrivning (visas i listan)" value={p.shortDescription || ''} onChange={(e) => set({ shortDescription: e.target.value })} />
          <Textarea label="Beskrivning" rows={5} value={p.description || ''} onChange={(e) => set({ description: e.target.value })} />
          <Textarea label="Bekvämligheter (en per rad)" rows={4} value={(p.features || []).join('\n')} onChange={(e) => set({ features: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700">Bilder (första bilden är huvudbild)</p>
            <ImageEditor client={client} folder={`units/${unit.unit_id}`} images={p.images || []} onChange={(images) => set({ images })} toast={toast} />
          </div>
          <Button onClick={save} loading={busy}>Spara rum</Button>
        </div>
      )}
    </Card>
  );
}

// ── Texter ─────────────────────────────────────────────────────────────────
function ContentTab({ client, snap, reload, toast }: { client: SupabaseClient; snap: Snapshot; reload: () => Promise<void>; toast: ToastFn }) {
  const [content, setContent] = useState<Content>(snap.content.content);
  const [busy, setBusy] = useState(false);
  const company = (k: string) => content.company?.[k] ?? '';
  const text = (k: string) => content.text?.[k] ?? '';
  const setCompany = (k: string, v: string) => setContent((c) => ({ ...c, company: { ...c.company, [k]: v } }));
  const setText = (k: string, v: string) => setContent((c) => ({ ...c, text: { ...c.text, [k]: v } }));
  const hero: Img[] = content.images?.hero ? [{ url: content.images.hero, alt: '' }] : [];

  async function save() {
    setBusy(true);
    try {
      const { error } = await client.rpc('vihem_ekangen_save_content', { p_content: content, p_revision: snap.content.revision });
      if (error) throw error;
      toast('Sparat. Hemsidan visar ändringarna inom en minut.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte spara.'), { tone: 'error' }); }
    finally { setBusy(false); }
  }
  return (
    <Card className="space-y-5 p-5">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><FileText className="h-4 w-4" />Företagsuppgifter</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Namn" value={company('name')} onChange={(e) => setCompany('name', e.target.value)} />
        <Input label="Slogan" value={company('tagline')} onChange={(e) => setCompany('tagline', e.target.value)} />
        <Input label="Adress" value={company('address')} onChange={(e) => setCompany('address', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Postnummer" value={company('postalCode')} onChange={(e) => setCompany('postalCode', e.target.value)} />
          <Input label="Ort" value={company('city')} onChange={(e) => setCompany('city', e.target.value)} />
        </div>
        <Input label="Telefon" value={company('phone')} onChange={(e) => setCompany('phone', e.target.value)} />
        <Input label="E-post" value={company('email')} onChange={(e) => setCompany('email', e.target.value)} />
      </div>
      <Textarea label="Incheckningsinformation" rows={2} value={company('checkInInfo')} onChange={(e) => setCompany('checkInInfo', e.target.value)} />
      <h3 className="font-semibold text-slate-900">Startsidan och sidor</h3>
      <Input label="Rubrik på startsidan" value={text('heroTitle')} onChange={(e) => setText('heroTitle', e.target.value)} />
      <Textarea label="Text under rubriken" rows={2} value={text('heroText')} onChange={(e) => setText('heroText', e.target.value)} />
      <div>
        <p className="mb-1.5 text-sm font-semibold text-slate-700">Bild på startsidan</p>
        <ImageEditor client={client} folder="site" images={hero} onChange={(imgs) => setContent((c) => ({ ...c, images: { ...(c.images || {}), hero: imgs[imgs.length - 1]?.url || '' } }))} toast={toast} />
      </div>
      <Input label="Rubrik: Om oss" value={text('aboutTitle')} onChange={(e) => setText('aboutTitle', e.target.value)} />
      <Textarea label="Text: Om oss" rows={6} value={text('aboutText')} onChange={(e) => setText('aboutText', e.target.value)} />
      <Textarea label="Text ovanför bokningsformuläret" rows={2} value={text('bookingIntro')} onChange={(e) => setText('bookingIntro', e.target.value)} />
      <Textarea label="Bokningsvillkor (visas vid bokning och på egen sida)" rows={8} value={text('terms')} onChange={(e) => setText('terms', e.target.value)} />
      <Button onClick={save} loading={busy}>Spara texter</Button>
    </Card>
  );
}

// ── Vanliga frågor ─────────────────────────────────────────────────────────
function FaqTab({ client, snap, reload, toast }: { client: SupabaseClient; snap: Snapshot; reload: () => Promise<void>; toast: ToastFn }) {
  const [faq, setFaq] = useState<Faq[]>(snap.content.content.faq || []);
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Faq>) => setFaq((cur) => cur.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  async function save() {
    setBusy(true);
    try {
      const cleaned = faq.filter((f) => f.question.trim() && f.answer.trim());
      const { error } = await client.rpc('vihem_ekangen_save_content', { p_content: { ...snap.content.content, faq: cleaned }, p_revision: snap.content.revision });
      if (error) throw error;
      toast('Frågorna är sparade.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte spara.'), { tone: 'error' }); }
    finally { setBusy(false); }
  }
  return (
    <Card className="space-y-4 p-5">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><HelpCircle className="h-4 w-4" />Vanliga frågor och svar</h3>
      {faq.map((f, i) => (
        <div key={i} className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <Input label="Kategori" value={f.category} onChange={(e) => update(i, { category: e.target.value })} />
            <Input label="Fråga" value={f.question} onChange={(e) => update(i, { question: e.target.value })} />
          </div>
          <Textarea label="Svar" rows={3} value={f.answer} onChange={(e) => update(i, { answer: e.target.value })} />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setFaq((c) => { const n = [...c]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>Flytta upp</Button>
            <Button size="sm" variant="ghost" onClick={() => setFaq((c) => c.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" />Ta bort</Button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setFaq((c) => [...c, { category: c[c.length - 1]?.category || 'Allmänt', question: '', answer: '' }])}><Plus className="h-4 w-4" />Ny fråga</Button>
        <Button onClick={save} loading={busy}>Spara frågor</Button>
      </div>
    </Card>
  );
}

// ── Inställningar ──────────────────────────────────────────────────────────
function SettingsTab({ client, settings, reload, toast }: { client: SupabaseClient; settings: Settings; reload: () => Promise<void>; toast: ToastFn }) {
  const [s, setS] = useState<Settings>(settings);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS((c) => ({ ...c, [k]: Number(e.target.value) }));
  async function save() {
    setBusy(true);
    try {
      const { error } = await client.rpc('vihem_ekangen_save_settings', { p_settings: s, p_revision: settings.revision });
      if (error) throw error;
      toast('Inställningarna är sparade.');
      await reload();
    } catch (e) { toast(errorText(e, 'Kunde inte spara.'), { tone: 'error' }); }
    finally { setBusy(false); }
  }
  return (
    <Card className="space-y-4 p-5">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Settings2 className="h-4 w-4" />Direktbokning</h3>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <input type="checkbox" checked={s.booking_enabled} onChange={(e) => setS({ ...s, booking_enabled: e.target.checked })} className="h-4 w-4 accent-blue-600" />
        Öppna för bokning och betalning på hemsidan
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Direktrabatt jämfört med VI-HEM-priset (%)" type="number" value={s.discount_percent} onChange={num('discount_percent')} hint="Dras av ovanpå priser och längdrabatter i Korttid." />
        <Input label="Gratis avbokning (dagar före ankomst)" type="number" value={s.free_cancel_days} onChange={num('free_cancel_days')} hint="0 = ingen gratis avbokning." />
        <Input label="Minsta antal nätter" type="number" value={s.min_nights} onChange={num('min_nights')} />
        <Input label="Längsta antal nätter" type="number" value={s.max_nights} onChange={num('max_nights')} />
        <Input label="Incheckning från" value={s.check_in_time} onChange={(e) => setS({ ...s, check_in_time: e.target.value })} placeholder="15:00" />
        <Input label="Utcheckning senast" value={s.check_out_time} onChange={(e) => setS({ ...s, check_out_time: e.target.value })} placeholder="11:00" />
        <Input label="Avsändare för bekräftelsemejl" value={s.sender_email} onChange={(e) => setS({ ...s, sender_email: e.target.value })} hint="Måste vara en Google Workspace-adress, t.ex. info@ekangensvandrarhem.se. Tomt = inga mejl." />
        <Input label="Mejla nya bokningar till" value={s.notification_email} onChange={(e) => setS({ ...s, notification_email: e.target.value })} hint="Admins får alltid en notis i VI-HEM." />
      </div>
      <Button onClick={save} loading={busy}>Spara inställningar</Button>
    </Card>
  );
}
