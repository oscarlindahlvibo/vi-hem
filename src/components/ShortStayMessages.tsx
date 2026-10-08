import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, MessageSquare, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Input } from './ui';

interface Thread {
  beds24_booking_id: string; booking_id: string | null; guest_name: string | null;
  unit_name: string; channel_name: string | null; start_date: string | null;
  end_date: string | null; last_message: string; last_message_at: string; message_count: number;
}
interface Message {
  id: string; source: 'guest' | 'host' | 'system' | 'internalNote'; message: string;
  sent_at: string; attachment_name: string | null; attachment_mime_type: string | null;
}
const labels = { guest: 'Gäst', host: 'Värd', system: 'System', internalNote: 'Intern anteckning' };
const dateTime = (value: string) => new Date(value).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

export function ShortStayMessages({ organisationId, bookingId, onOpenBooking }: {
  organisationId: string; bookingId?: string; onOpenBooking?: (id: string) => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(bookingId || null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [limit, setLimit] = useState(100);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => { setSelected(bookingId || null); }, [bookingId, organisationId]);
  useEffect(() => {
    let live = true;
    async function load() {
      setLoading(true);
      let query = supabase.from('vihem_short_stay_message_threads').select('*').eq('organisation_id', organisationId).order('last_message_at', { ascending: false }).range(0, limit);
      if (bookingId) query = query.eq('beds24_booking_id', bookingId);
      const { data, error: loadError } = await query;
      if (!live) return;
      if (loadError) setError('Kunde inte läsa gästmeddelanden. Kontrollera att chattkopplingen är installerad.');
      else { setThreads((data || []).slice(0, limit)); setHasMore((data?.length || 0) > limit); }
      setLoading(false);
    }
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => { live = false; window.clearInterval(timer); };
  }, [organisationId, bookingId, limit, revision]);

  async function sync() {
    setSyncing(true); setError(''); setNotice('');
    try {
      const { data, error: syncError } = await supabase.functions.invoke('vihem-sync-beds24-messages', { body: {} });
      if (syncError || data?.ok === false || data?.error) {
        let detail = data?.error;
        if (!detail && syncError && 'context' in syncError) {
          const body = await syncError.context.json().catch(() => ({}));
          detail = typeof body.error === 'string' ? body.error : body.error?.message;
        }
        throw new Error(detail || 'Kunde inte synka gästmeddelanden.');
      }
      setNotice(`Chattflödet är uppdaterat (${data?.imported || 0} meddelanden kontrollerade).`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Synkningen misslyckades.'); }
    finally { setSyncing(false); setRevision(value => value + 1); }
  }
  const filtered = useMemo(() => threads.filter(thread => `${thread.guest_name || ''} ${thread.unit_name} ${thread.beds24_booking_id} ${thread.channel_name || ''}`.toLowerCase().includes(search.toLowerCase())), [threads, search]);
  const current = threads.find(thread => thread.beds24_booking_id === selected);
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-slate-900 flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Gästmeddelanden</h2><p className="text-sm text-slate-500">Hämtas från Beds24 var 15:e minut. Svara direkt i konversationen för kanalbokningar.</p></div>
      <Button variant="secondary" onClick={() => void sync()} loading={syncing}><RefreshCw className="h-4 w-4" /> Hämta meddelanden</Button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <div className={`grid gap-3 ${bookingId ? '' : 'md:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]'}`}>
      {!bookingId && <div className={`rounded-xl border bg-white p-3 ${selected ? 'hidden md:block' : ''}`}>
        <Input aria-label="Sök konversation" placeholder="Sök gäst, rum eller bokning" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="mt-3 max-h-[65vh] overflow-y-auto space-y-1">
          {loading && !threads.length ? <p className="p-3 text-sm text-slate-500">Hämtar konversationer…</p> : !filtered.length ? <p className="p-3 text-sm text-slate-500">Inga konversationer hittades. Hämta meddelanden för att uppdatera från Beds24.</p> : filtered.map(thread => <button key={thread.beds24_booking_id} onClick={() => setSelected(thread.beds24_booking_id)} className={`w-full rounded-lg p-3 text-left ${selected === thread.beds24_booking_id ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}>
            <div className="font-medium text-slate-900">{thread.guest_name || `Bokning ${thread.beds24_booking_id}`}</div>
            <p className="text-xs text-slate-500">{thread.unit_name} · {thread.channel_name || 'Beds24'}</p>
            <p className="mt-1 truncate text-sm text-slate-600">{thread.last_message || 'Bilaga'}</p>
            <p className="mt-1 text-xs text-slate-400">{dateTime(thread.last_message_at)} · {thread.message_count} meddelanden</p>
          </button>)}
          {hasMore && <Button variant="secondary" onClick={() => setLimit(value => value + 100)}>Visa fler konversationer</Button>}
        </div>
      </div>}
      <div className={`min-w-0 rounded-xl border bg-white p-3 sm:p-4 ${!selected && !bookingId ? 'hidden md:block' : ''}`}>
        {selected ? <>
          {!bookingId && <button onClick={() => setSelected(null)} className="mb-3 flex items-center gap-1 text-sm text-blue-600 md:hidden"><ArrowLeft className="h-4 w-4" /> Konversationer</button>}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{current?.guest_name || `Bokning ${selected}`}</h3><p className="text-sm text-slate-500">{current?.unit_name} {current?.channel_name && `· ${current.channel_name}`}</p>{current?.start_date && <p className="text-xs text-slate-500">{current.start_date} – {current.end_date}</p>}</div>{current?.booking_id && onOpenBooking && <Button variant="secondary" onClick={() => onOpenBooking(current.booking_id!)}>Öppna bokning</Button>}</div>
          <ShortStayMessageThread key={`${organisationId}:${selected}`} organisationId={organisationId} bookingId={selected} revision={revision} onSent={() => setRevision(value => value + 1)} />
        </> : <p className="py-12 text-center text-sm text-slate-500">Välj en konversation för att läsa chattflödet.</p>}
      </div>
    </div>
  </section>;
}

function ShortStayMessageThread({ organisationId, bookingId, revision, onSent }: { organisationId: string; bookingId: string; revision: number; onSent: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendNotice, setSendNotice] = useState('');
  const [capability, setCapability] = useState<{ canSend: boolean; reason?: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let live = true;
    void supabase.functions.invoke('vihem-send-beds24-message', { body: { action: 'context', bookingId } }).then(({ data, error }) => {
      if (live) setCapability(error ? { canSend: false, reason: 'Kunde inte kontrollera skickafunktionen. Hämta meddelanden eller öppna konversationen igen.' } : data);
    });
    return () => { live = false; };
  }, [bookingId, organisationId, revision]);
  async function send() {
    if (inFlight.current || !draft.trim() || !capability?.canSend) return;
    inFlight.current = true; setSending(true); setSendError(''); setSendNotice('');
    requestId.current ||= crypto.randomUUID();
    try {
      const { data, error } = await supabase.functions.invoke('vihem-send-beds24-message', { body: { bookingId, requestId: requestId.current, message: draft.trim() } });
      if (error) {
        let detail = '';
        if ('context' in error) { const body = await error.context.json().catch(() => ({})); detail = body.error?.message || ''; }
        throw new Error(detail || 'Utskickets status kunde inte kontrolleras.');
      }
      if (data?.status === 'sent') {
        setDraft(''); requestId.current = null; setUncertain(false);
        setSendNotice('Beds24 har tagit emot meddelandet för utskick.'); onSent();
      } else if (data?.status === 'failed') {
        requestId.current = null; setUncertain(false);
        setSendError('Beds24 avvisade utskicket. Kontrollera anslutningens skrivbehörighet eller försök senare.');
      } else {
        setUncertain(true);
        setSendError('Utskicket är ännu inte bekräftat. Kontrollera i Beds24 innan du skickar igen. VI-HEM skickar inte samma utskick en gång till.');
      }
    } catch (err) {
      setUncertain(true);
      setSendError((err instanceof Error ? err.message : 'Kunde inte skicka.') + ' Kontrollera status med knappen nedan.');
    } finally { inFlight.current = false; setSending(false); }
  }
  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('vihem_short_stay_messages')
      .select('id, source, message, sent_at, attachment_name, attachment_mime_type')
      .eq('organisation_id', organisationId).eq('beds24_booking_id', bookingId)
      .order('sent_at', { ascending: false }).order('beds24_message_id', { ascending: false }).range(0, limit);
    return { data, loadError };
  }, [organisationId, bookingId, limit]);
  useEffect(() => {
    let live = true;
    async function refresh() {
      const { data, loadError } = await load();
      const { count } = await supabase.from('vihem_short_stay_message_sends').select('id', { count: 'exact', head: true }).eq('organisation_id', organisationId).eq('beds24_booking_id', bookingId).eq('status', 'pending');
      if (!live) return;
      setPendingCount(count || 0);
      if (loadError) setError('Kunde inte läsa konversationen.');
      else { setError(''); setMessages(((data || []).slice(0, limit) as Message[]).reverse()); setHasMore((data?.length || 0) > limit); }
      setLoading(false);
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => { live = false; window.clearInterval(timer); };
  }, [load, revision, limit]);
  async function attachment(message: Message) {
    setError('');
    const { data, error: downloadError } = await supabase.from('vihem_short_stay_messages').select('attachment_base64').eq('organisation_id', organisationId).eq('id', message.id).single();
    if (downloadError || !data?.attachment_base64) { setError('Bilagan kunde inte hämtas.'); return; }
    try {
      const bytes = Uint8Array.from(atob(data.attachment_base64), char => char.charCodeAt(0));
      const safeMime = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'].includes(message.attachment_mime_type || '') ? message.attachment_mime_type! : 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([bytes], { type: safeMime }));
      const link = document.createElement('a'); link.href = url; link.download = message.attachment_name || 'bilaga'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { setError('Bilagan kunde inte läsas.'); }
  }
  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {hasMore && <Button variant="secondary" onClick={() => setLimit(value => value + 100)}>Visa äldre meddelanden</Button>}
    <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
      {loading ? <p className="text-sm text-slate-500">Hämtar meddelanden…</p> : !messages.length ? <p className="text-sm text-slate-500">Inga meddelanden har hämtats för bokningen ännu.</p> : messages.map(message => <article key={message.id} className={`max-w-[95%] rounded-xl p-3 ${message.source === 'host' ? 'ml-auto bg-blue-50' : message.source === 'guest' ? 'bg-slate-100' : 'border border-amber-100 bg-amber-50'}`}>
        <div className="mb-1 flex flex-wrap gap-x-3 text-xs text-slate-500"><span className="font-medium">{labels[message.source]}</span><time dateTime={message.sent_at}>{dateTime(message.sent_at)}</time></div>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{message.message}</p>
        {message.attachment_name && <button onClick={() => void attachment(message)} className="mt-2 flex max-w-full items-center gap-1 break-all text-left text-sm text-blue-700"><Download className="h-4 w-4 shrink-0" /> {message.attachment_name}</button>}
      </article>)}
    </div>
    {pendingCount > 0 && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{pendingCount} utskick saknar bekräftelse. Kontrollera dem i Beds24 innan samma text skickas igen.</p>}
    <form className="space-y-2 border-t pt-3" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="block text-sm font-medium" htmlFor={`guest-reply-${bookingId}`}>Meddelande till gästen</label>
      <textarea id={`guest-reply-${bookingId}`} rows={4} maxLength={5000} value={draft} disabled={sending || uncertain || !capability?.canSend} onChange={event => setDraft(event.target.value)} placeholder="Skriv ditt svar…" className="w-full rounded-lg border border-slate-300 p-3 text-base disabled:bg-slate-50" />
      {!capability ? <p className="text-sm text-slate-500">Kontrollerar bokningskanalen…</p> : !capability.canSend && <p className="text-sm text-slate-500">{capability.reason}</p>}
      {sendError && <p role="alert" className="text-sm text-red-700">{sendError}</p>}
      {sendNotice && <p role="status" className="text-sm text-emerald-700">{sendNotice}</p>}
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">{draft.length}/5 000 tecken · via Beds24</span><Button type="submit" loading={sending} disabled={!capability?.canSend || !draft.trim()}>{uncertain ? 'Kontrollera utskickets status' : 'Skicka meddelande'}</Button></div>
    </form>
  </div>;
}
