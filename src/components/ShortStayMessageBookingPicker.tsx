import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { messageBookingColumns, messageBookings, type GuestMessageBooking } from '../lib/shortStayMessageBookings';
import { Button, Input } from './ui';

export function ShortStayMessageBookingPicker({ organisationId, onSelect }: {
  organisationId: string; onSelect: (booking: GuestMessageBooking) => void;
}) {
  const [search, setSearch] = useState('');
  const [past, setPast] = useState(false);
  const [limit, setLimit] = useState(50);
  const [rows, setRows] = useState<GuestMessageBooking[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(''); setRows([]);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          let query = supabase.from('vihem_short_stay_bookings').select(messageBookingColumns)
            .eq('organisation_id', organisationId).eq('booking_type', 'booking')
            .not('beds24_booking_id', 'is', null).neq('beds24_booking_id', '')
            .order('start_date', { ascending: !past }).order('created_at', { ascending: false }).range(0, limit);
          if (!past) query = query.gte('end_date', new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
          if (search.trim()) query = query.ilike('guest_name', `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
          const { data, error: loadError } = await query;
          if (loadError) throw loadError;
          if (live) { setRows(messageBookings((data || []).slice(0, limit))); setMore((data?.length || 0) > limit); }
        } catch { if (live) setError('Kunde inte hämta bokningarna. Försök igen.'); }
        finally { if (live) setLoading(false); }
      })();
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [organisationId, search, past, limit, revision]);
  return <div className="space-y-4">
    <p className="text-sm text-slate-600">Välj en bokning för att skriva till gästen, även om gästen inte har skickat något tidigare. Utskicket går via bokningskanalen i Beds24.</p>
    <Input label="Sök gäst" placeholder="Gästens namn" value={search} onChange={e => { setSearch(e.target.value); setLimit(50); }} />
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={past} onChange={e => { setPast(e.target.checked); setLimit(50); }} />Visa även tidigare vistelser</label>
    {loading ? <p role="status" className="text-sm text-slate-500">Hämtar bokningar…</p> : error ? <div role="alert"><p className="text-sm text-red-700">{error}</p><Button variant="secondary" onClick={() => setRevision(v => v + 1)}>Försök igen</Button></div> : <>
      {!rows.length && <p className="py-5 text-sm text-slate-500">Inga matchande Beds24-bokningar. Prova ett annat namn eller visa tidigare vistelser. Manuella bokningar utan Beds24-koppling kan inte kontaktas här.</p>}
      <div className="divide-y rounded-xl border bg-white">{rows.map(booking => <button key={booking.beds24_booking_id} type="button" onClick={() => onSelect(booking)} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left hover:bg-blue-50 focus-visible:outline-blue-500">
        <span className="min-w-0"><strong className="block break-words">{booking.guest_name || 'Gästnamn saknas'}</strong><span className="block text-sm text-slate-600">{booking.unit_name} · {booking.start_date} – {booking.end_date}</span><span className="text-xs text-slate-500">{booking.channel_name || 'Beds24'} · Bokning {booking.beds24_booking_id}</span></span><span className="text-sm font-medium text-blue-700">Skriv meddelande →</span>
      </button>)}</div>
      {more && <Button variant="secondary" onClick={() => setLimit(v => v + 50)}>Visa fler bokningar</Button>}
    </>}
  </div>;
}
