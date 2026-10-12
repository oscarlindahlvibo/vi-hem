import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ImagePlus, Send, X } from 'lucide-react';
import { navigate } from '@/lib/router';
import { submitQuote } from '@/lib/api';
import { useSite } from '@/lib/site-content';

const WHEN = ['Så snart som möjligt', 'Inom en månad', 'Inom ett par månader', 'Flexibelt'];
const MAX_IMAGES = 4;

/** Förminskar en bild i webbläsaren (max 1600 px, JPEG) så att uppladdningen blir snabb och ryms i formuläret. */
async function shrink(file: File): Promise<{ type: string; data: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const data = dataUrl.split(',')[1];
    if (data.length * 0.75 <= 1_400_000) return { type: 'image/jpeg', data, preview: dataUrl };
  }
  throw new Error('Bilden är för stor. Välj en mindre bild.');
}

export function QuoteForm() {
  const { site } = useSite();
  const services = site?.content.services.map((s) => s.title) || [];
  const [form, setForm] = useState({ name: '', email: '', phone: '', location: '', service: '', message: '', preferred_time: WHEN[0], website: '' });
  const [images, setImages] = useState<{ type: string; data: string; preview: string }[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(Date.now());
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const closed = site && !site.settings.formEnabled;
  const options = useMemo(() => [...services, 'Annat'], [services.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    try {
      const next = [...images];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_IMAGES) break;
        if (!file.type.startsWith('image/')) continue;
        next.push(await shrink(file));
      }
      setImages(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte läsa bilden.'); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const ref = await submitQuote({ ...form, consent, elapsed_ms: Date.now() - started.current, images: images.map(({ type, data }) => ({ type, data })) });
      navigate(`/tack?ref=${encodeURIComponent(ref)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Det gick inte att skicka. Försök igen eller ring oss.');
      setBusy(false);
    }
  }

  if (closed) return <div className="card p-6 text-ink-700">Offertformuläret är tillfälligt stängt. Ring oss så hjälper vi dig.</div>;

  return (
    <form onSubmit={submit} className="card space-y-5 p-5 sm:p-8" noValidate={false}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label className="label" htmlFor="q-name">Namn *</label><input id="q-name" className="field" autoComplete="name" required value={form.name} onChange={set('name')} /></div>
        <div><label className="label" htmlFor="q-phone">Telefon *</label><input id="q-phone" type="tel" className="field" autoComplete="tel" required minLength={5} value={form.phone} onChange={set('phone')} /></div>
        <div><label className="label" htmlFor="q-email">E-post *</label><input id="q-email" type="email" className="field" autoComplete="email" required value={form.email} onChange={set('email')} /></div>
        <div><label className="label" htmlFor="q-loc">Plats / adress för jobbet *</label><input id="q-loc" className="field" required value={form.location} onChange={set('location')} placeholder="T.ex. Storgatan 1, Virserum" /></div>
        <div>
          <label className="label" htmlFor="q-service">Typ av jobb</label>
          <select id="q-service" className="field" value={form.service} onChange={set('service')}>
            <option value="">Välj…</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="q-when">Önskad tid</label>
          <select id="q-when" className="field" value={form.preferred_time} onChange={set('preferred_time')}>{WHEN.map((w) => <option key={w}>{w}</option>)}</select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="q-msg">Beskriv jobbet *</label>
        <textarea id="q-msg" className="field min-h-[9rem]" required minLength={10} maxLength={4000} value={form.message} onChange={set('message')} placeholder="Vad ska göras, ungefärlig storlek, hur kommer man åt platsen, önskat resultat…" />
      </div>
      <div>
        <p className="label">Bilder (valfritt, upp till {MAX_IMAGES})</p>
        <div className="flex flex-wrap gap-3">
          {images.map((img, i) => (
            <div key={i} className="relative h-24 w-24 overflow-hidden rounded-lg ring-1 ring-ink-200">
              <img src={img.preview} alt={`Vald bild ${i + 1}`} className="h-full w-full object-cover" />
              <button type="button" aria-label="Ta bort bild" onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-ink-900/80 p-1 text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-ink-300 text-xs font-semibold text-ink-500 hover:bg-ink-50">
              <ImagePlus className="h-6 w-6" />Lägg till
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>
      </div>
      {/* Honeypot: dolt för människor, ifyllt av enkla botar. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Webbplats<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label></div>
      <label className="flex items-start gap-3 text-sm text-ink-700">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-brand-600" />
        <span>Jag godkänner att mina uppgifter används för att besvara förfrågan, enligt <a href="/integritet" target="_blank" rel="noreferrer" className="font-semibold underline">integritetspolicyn</a>.</span>
      </label>
      {error && <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      <button type="submit" disabled={busy || !consent} className="btn btn-primary w-full sm:w-auto">{busy ? 'Skickar…' : <><Send className="h-4 w-4" />Skicka förfrågan</>}</button>
    </form>
  );
}
