import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { cancelBooking, fmtDate, getBooking, kr, type BookingView } from '@/lib/api';
import { Link } from '@/lib/router';

export function BookingStatusPage({ reference, query }: { reference: string; query: URLSearchParams }) {
  const token = query.get('token') || '';
  const justPaid = query.get('betalning') === 'ok';
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const tries = useRef(0);

  const load = useCallback(async () => {
    try { setBooking(await getBooking(reference, token)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte hämta bokningen.'); }
  }, [reference, token]);

  useEffect(() => { void load(); }, [load]);
  // Efter betalning kan bekräftelsen från Stripe dröja några sekunder: fråga om tills bokningen är betald.
  useEffect(() => {
    if (!booking || booking.status !== 'pending' || !justPaid) return;
    if (tries.current > 40) return;
    const t = window.setTimeout(() => { tries.current += 1; void load(); }, 3000);
    return () => window.clearTimeout(t);
  }, [booking, justPaid, load]);

  async function cancel() {
    setBusy(true);
    try { setBooking(await cancelBooking(reference, token)); setConfirmCancel(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Avbokningen misslyckades.'); }
    finally { setBusy(false); }
  }

  if (error && !booking) return <section className="mx-auto max-w-xl px-4 py-20 text-center"><XCircle className="mx-auto h-12 w-12 text-red-500" /><p className="mt-4 text-lg font-semibold">{error}</p><Link to="/" className="btn btn-primary mt-6">Till startsidan</Link></section>;
  if (!booking) return <section className="px-4 py-20 text-center text-fjord-600">Hämtar din bokning...</section>;

  const tone = booking.status === 'paid' ? { icon: CheckCircle2, color: 'text-green-600', title: 'Tack! Din bokning är bekräftad' }
    : booking.status === 'pending' ? { icon: Clock, color: 'text-amber-500', title: justPaid ? 'Vi bekräftar din betalning...' : 'Väntar på betalning' }
    : booking.status === 'refunded' || booking.status === 'cancelled' ? { icon: XCircle, color: 'text-fjord-500', title: 'Bokningen är avbokad' }
    : booking.status === 'conflict' ? { icon: Clock, color: 'text-amber-500', title: 'Vi behöver kontakta dig' }
    : { icon: XCircle, color: 'text-red-500', title: 'Bokningen gick ut' };
  const Icon = tone.icon;
  return (
    <section className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <div className="card p-6 text-center sm:p-8">
        <Icon className={`mx-auto h-14 w-14 ${tone.color}`} />
        <h1 className="mt-3 text-3xl font-semibold text-fjord-900">{tone.title}</h1>
        <p className="mt-1 font-mono text-sm font-semibold text-fjord-500">{booking.reference}</p>
        <dl className="mt-6 space-y-2 text-left text-sm">
          <div className="flex justify-between gap-4"><dt className="text-fjord-600">Boende</dt><dd className="text-right font-semibold">{booking.unit}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-fjord-600">Ankomst</dt><dd className="text-right font-semibold">{fmtDate(booking.start)} (från {booking.checkInTime})</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-fjord-600">Avresa</dt><dd className="text-right font-semibold">{fmtDate(booking.end)} (senast {booking.checkOutTime})</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-fjord-600">Gäster</dt><dd className="font-semibold">{booking.guests}</dd></div>
          <div className="flex justify-between gap-4 border-t border-fjord-100 pt-2 text-base"><dt className="font-semibold">Totalt</dt><dd className="font-bold">{kr(booking.total)}</dd></div>
        </dl>
        {booking.status === 'paid' && <p className="mt-5 text-sm text-fjord-700">En bekräftelse har skickats till din e-post. Spara den här länken om du vill se eller avboka bokningen.</p>}
        {booking.status === 'conflict' && <p className="mt-5 text-sm text-fjord-700">Det uppstod ett problem med datumen efter din betalning. Vi kontaktar dig och återbetalar vid behov.</p>}
        {error && <p className="mt-4 text-sm font-semibold text-red-700">{error}</p>}
        {booking.canCancel && !confirmCancel && <button className="btn btn-ghost mt-6" onClick={() => setConfirmCancel(true)}>Avboka (gratis till {booking.freeCancelUntil})</button>}
        {confirmCancel && (
          <div className="mt-6 rounded-xl bg-amber-50 p-4 text-left">
            <p className="text-sm font-semibold text-amber-900">Vill du avboka? Hela beloppet återbetalas till det kort du betalade med.</p>
            <div className="mt-3 flex gap-2"><button className="btn btn-primary min-h-10 px-4 text-sm" onClick={cancel} disabled={busy}>{busy ? 'Avbokar...' : 'Ja, avboka'}</button><button className="btn btn-ghost min-h-10 px-4 text-sm" onClick={() => setConfirmCancel(false)}>Behåll bokningen</button></div>
          </div>
        )}
        {booking.status === 'paid' && !booking.canCancel && <p className="mt-5 text-xs text-fjord-500">Gratis avbokning är inte längre möjlig. Kontakta oss om du behöver ändra något.</p>}
      </div>
    </section>
  );
}
