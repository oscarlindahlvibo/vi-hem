import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, Lock, Users } from 'lucide-react';
import { checkAvailability, fmtDate, kr, startCheckout, type Availability, type Quote } from '@/lib/api';
import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';
import { StayPicker, type Stay } from '@/components/StayPicker';

export function BookingPage({ query }: { query: URLSearchParams }) {
  const { site } = useSite();
  const [stay, setStay] = useState<Stay | null>(() => {
    const start = query.get('start'), end = query.get('end'), guests = Number(query.get('guests') || 2);
    return start && end ? { start, end, guests } : null;
  });
  const [result, setResult] = useState<Availability | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<Quote | null>(null);
  const preferredUnit = query.get('unit');
  const unitMeta = useMemo(() => new Map((site?.units || []).map((u) => [u.id, u])), [site]);

  useEffect(() => {
    if (!stay) return;
    let alive = true;
    setSearching(true); setError(''); setChosen(null); setResult(null);
    checkAvailability(stay.start, stay.end, stay.guests)
      .then((r) => alive && setResult(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Kunde inte hämta lediga rum.'))
      .finally(() => alive && setSearching(false));
    return () => { alive = false; };
  }, [stay]);

  const intro = site?.content.text.bookingIntro;
  if (site && !site.settings.bookingEnabled) {
    return <section className="mx-auto max-w-2xl px-4 py-20 text-center"><h1 className="text-3xl font-semibold">Bokning öppnar snart</h1><p className="mt-3 text-fjord-700">Direktbokning är inte öppen just nu. Kontakta oss så hjälper vi dig.</p><Link to="/om-oss" className="btn btn-primary mt-6">Kontakta oss</Link></section>;
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-4xl font-semibold text-fjord-900">Boka direkt</h1>
      {intro && <p className="mt-2 text-fjord-700">{intro}</p>}
      {query.get('avbruten') && <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900"><AlertCircle className="h-4 w-4" />Betalningen avbröts. Din bokning är inte genomförd – välj rum och försök igen.</p>}

      <div className="card mt-6 p-5">
        <StayPicker initial={stay || undefined} busy={searching} submitLabel="Sök" onSubmit={setStay} />
      </div>

      {error && <p className="mt-6 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><AlertCircle className="h-4 w-4" />{error}</p>}
      {searching && <p className="mt-8 text-center text-fjord-600">Letar lediga rum...</p>}

      {result && !chosen && (
        <div className="mt-8 space-y-4">
          <p className="text-sm font-semibold text-fjord-700">{fmtDate(result.start)} → {fmtDate(result.end)} · {result.nights} natt{result.nights > 1 ? 'er' : ''} · {result.guests} gäst{result.guests > 1 ? 'er' : ''}</p>
          {result.units.length === 0 && <p className="card p-6 text-fjord-800">Tyvärr finns inget ledigt för de datumen och det antalet gäster. Prova andra datum eller kontakta oss.</p>}
          {result.units.map((q) => {
            const meta = unitMeta.get(q.unitId);
            return (
              <article key={q.unitId} className={`card overflow-hidden sm:flex ${preferredUnit === q.unitId ? 'ring-2 ring-amber-500' : ''}`}>
                {meta?.images[0] && <img src={meta.images[0].url} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover sm:aspect-[4/3] sm:w-56" />}
                <div className="flex flex-1 flex-col justify-between gap-4 p-5 sm:flex-row sm:items-end">
                  <div>
                    <h2 className="text-xl font-semibold text-fjord-900">{q.title}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-fjord-700"><Users className="h-4 w-4" />Upp till {q.maxGuests} gäster{meta?.beds ? ` · ${meta.beds}` : ''}</p>
                    <p className="mt-2 text-sm text-fjord-600">{kr(q.avgPerNight)} per natt i snitt</p>
                  </div>
                  <div className="text-right">
                    {q.directDiscount > 0 && <p className="text-sm text-fjord-500 line-through">{kr(q.baseTotal)}</p>}
                    <p className="text-2xl font-bold text-fjord-900">{kr(q.total)}</p>
                    {q.directDiscount > 0 && <p className="text-xs font-semibold text-green-700">Du sparar {kr(q.directDiscount)} direkt</p>}
                    <button className="btn btn-primary mt-3" onClick={() => setChosen(q)}>Välj</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {result && chosen && <Checkout availability={result} quote={chosen} onBack={() => setChosen(null)} />}
    </section>
  );
}

function Checkout({ availability, quote, onBack }: { availability: Availability; quote: Quote; onBack: () => void }) {
  const { site } = useSite();
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const top = useRef<HTMLFormElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { checkout_url } = await startCheckout({ unit_id: quote.unitId, start: availability.start, end: availability.end, guests: availability.guests, ...form, accept_terms: accept });
      window.location.href = checkout_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Betalningen kunde inte startas.');
      setBusy(false);
    }
  }

  return (
    <form ref={top} onSubmit={submit} className="mt-8 grid scroll-mt-20 gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="card space-y-4 p-5 sm:p-6">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-fjord-700 hover:underline"><ArrowLeft className="h-4 w-4" />Välj annat rum</button>
        <h2 className="text-2xl font-semibold text-fjord-900">Dina uppgifter</h2>
        <div><label className="label" htmlFor="b-name">Namn</label><input id="b-name" className="field" autoComplete="name" required value={form.name} onChange={set('name')} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="b-email">E-post (bekräftelsen skickas hit)</label><input id="b-email" type="email" className="field" autoComplete="email" required value={form.email} onChange={set('email')} /></div>
          <div><label className="label" htmlFor="b-phone">Telefon</label><input id="b-phone" type="tel" className="field" autoComplete="tel" value={form.phone} onChange={set('phone')} /></div>
        </div>
        <div><label className="label" htmlFor="b-msg">Meddelande till oss (valfritt)</label><textarea id="b-msg" rows={3} maxLength={500} className="field" value={form.message} onChange={set('message')} placeholder="T.ex. beräknad ankomsttid" /></div>
        <label className="flex items-start gap-3 text-sm text-fjord-800">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 h-5 w-5 accent-fjord-700" required />
          <span>Jag har läst och godkänner <a href="/villkor" target="_blank" rel="noreferrer" className="font-semibold underline">bokningsvillkoren</a>.</span>
        </label>
        {error && <p className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
      </div>
      <aside className="card h-fit space-y-3 p-5 sm:p-6">
        <h2 className="text-xl font-semibold text-fjord-900">{quote.title}</h2>
        <p className="text-sm text-fjord-700">{fmtDate(availability.start)}<br />till {fmtDate(availability.end)}<br />{availability.nights} natt{availability.nights > 1 ? 'er' : ''} · {availability.guests} gäst{availability.guests > 1 ? 'er' : ''}</p>
        <dl className="space-y-1.5 border-t border-fjord-100 pt-3 text-sm">
          <div className="flex justify-between"><dt>Pris före rabatt</dt><dd>{kr(quote.subtotal)}</dd></div>
          {quote.losAmount > 0 && <div className="flex justify-between text-green-700"><dt>Längdrabatt {quote.losPercent} %</dt><dd>−{kr(quote.losAmount)}</dd></div>}
          {quote.directDiscount > 0 && <div className="flex justify-between text-green-700"><dt>Direktrabatt {quote.directDiscountPercent} %</dt><dd>−{kr(quote.directDiscount)}</dd></div>}
          <div className="flex justify-between border-t border-fjord-100 pt-2 text-lg font-bold text-fjord-900"><dt>Att betala</dt><dd>{kr(quote.total)}</dd></div>
        </dl>
        <p className="text-xs text-fjord-600">Incheckning från {availability.checkInTime}, utcheckning senast {availability.checkOutTime}.{availability.freeCancelDays > 0 && ` Gratis avbokning till ${availability.freeCancelDays} dagar före ankomst.`}</p>
        <button type="submit" className="btn btn-amber w-full" disabled={busy || !accept}>{busy ? 'Skickar till betalning...' : <><Lock className="h-4 w-4" />Gå till betalning</>}</button>
        <p className="text-center text-xs text-fjord-500">Betalning sker säkert hos Stripe.{site ? '' : ''}</p>
      </aside>
    </form>
  );
}
