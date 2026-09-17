import { useEffect, useState } from 'react';
import { MessageSquareText, Send, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, Input, Select, Textarea } from '../components/ui';

type SmsMessage = { id: string; recipient: string; message: string; status: string; created_at: string; error: string; delivery_status?: string; delivery_received_at?: string | null };
type SmsBroadcast = { id: string; property_name: string; message: string; recipient_count: number; failed_count: number; created_at: string };
type PropertyOption = { id: string; name: string };

export function SmsPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'single' | 'group'>('single');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<SmsMessage[]>([]);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [groupPropertyId, setGroupPropertyId] = useState('');
  const [groupMessage, setGroupMessage] = useState('');
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupFeedback, setGroupFeedback] = useState('');
  const [broadcasts, setBroadcasts] = useState<SmsBroadcast[]>([]);

  const loadHistory = async () => {
    if (!user?.organisation_id) return;
    const { data } = await supabase.from('vihem_sms_messages').select('id,recipient,message,status,created_at,error,delivery_status,delivery_received_at').eq('organisation_id', user.organisation_id).order('created_at', { ascending: false }).limit(25);
    setHistory((data || []) as SmsMessage[]);
  };

  const loadBroadcasts = async () => {
    if (!user?.organisation_id) return;
    const { data } = await supabase.from('vihem_sms_broadcasts').select('id,property_name,message,recipient_count,failed_count,created_at').eq('organisation_id', user.organisation_id).order('created_at', { ascending: false }).limit(15);
    setBroadcasts((data || []) as SmsBroadcast[]);
  };

  const loadProperties = async () => {
    if (!user?.organisation_id) return;
    const { data } = await supabase.from('vihem_properties').select('id,name').eq('organisation_id', user.organisation_id).order('name');
    setProperties((data || []) as PropertyOption[]);
  };

  useEffect(() => { void loadHistory(); void loadBroadcasts(); void loadProperties(); }, [user?.organisation_id]);

  const sendSms = async () => {
    if (!user?.organisation_id || !recipient.trim() || !message.trim()) return;
    setLoading(true); setFeedback('');
    const { error } = await supabase.functions.invoke('vihem-send-sms', { body: { organisation_id: user.organisation_id, recipient, message } });
    setLoading(false);
    setFeedback(error ? await getFunctionErrorMessage(error, 'SMS-utskicket misslyckades.') : 'SMS skickat.');
    if (!error) { setRecipient(''); setMessage(''); await loadHistory(); }
  };

  const sendGroupSms = async () => {
    if (!user?.organisation_id || !groupMessage.trim()) return;
    const propertyName = properties.find(p => p.id === groupPropertyId)?.name || 'Alla fastigheter';
    if (!window.confirm(`Skicka SMS till alla hyresgäster i ${propertyName}?\n\n"${groupMessage.trim()}"`)) return;
    setGroupLoading(true); setGroupFeedback('');
    const { data, error } = await supabase.functions.invoke('vihem-sms-group-broadcast', { body: { property_id: groupPropertyId || null, message: groupMessage } });
    setGroupLoading(false);
    if (error) {
      setGroupFeedback(await getFunctionErrorMessage(error, 'Grupputskicket misslyckades.'));
      return;
    }
    const failed = data?.failed || 0;
    setGroupFeedback(failed > 0 ? `Skickat till ${data?.sent || 0} av ${data?.recipient_count || 0} hyresgäster (${failed} misslyckades).` : `Skickat till ${data?.sent || 0} hyresgäster.`);
    setGroupMessage('');
    await loadBroadcasts();
    await loadHistory();
  };

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-24">
    <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">SMS</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Cellsynt SMS</h1><p className="mt-2 text-slate-600">Skicka SMS från VI-HEM och följ leveranshistoriken.</p></div>

    <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-1">
      <button type="button" onClick={() => setMode('single')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === 'single' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Enskilt SMS</button>
      <button type="button" onClick={() => setMode('group')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === 'group' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Massutskick till fastighet</button>
    </div>

    {mode === 'single' ? (
      <Card className="p-5"><div className="flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-blue-600" /><h2 className="text-lg font-bold text-slate-950">Nytt SMS</h2></div><div className="mt-5 grid gap-4"><Input label="Mottagare" placeholder="0701234567" value={recipient} onChange={e => setRecipient(e.target.value)} /><Textarea label="Meddelande" rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="Skriv meddelande..." /><div className="flex flex-wrap items-center gap-3"><Button onClick={sendSms} loading={loading} disabled={!recipient.trim() || !message.trim()}><Send className="h-4 w-4" /> Skicka SMS</Button>{feedback && <span className="text-sm font-semibold text-slate-600">{feedback}</span>}</div></div></Card>
    ) : (
      <Card className="p-5">
        <div className="flex items-center gap-2"><Users className="h-5 w-5 text-blue-600" /><h2 className="text-lg font-bold text-slate-950">Massutskick till fastighet</h2></div>
        <p className="mt-1 text-sm text-slate-500">Skickas till alla hyresgäster med aktivt hyresförhållande och telefonnummer registrerat.</p>
        <div className="mt-5 grid gap-4">
          <Select label="Fastighet" value={groupPropertyId} onChange={e => setGroupPropertyId(e.target.value)} options={[{ value: '', label: 'Alla fastigheter' }, ...properties.map(p => ({ value: p.id, label: p.name }))]} />
          <Textarea label="Meddelande" rows={4} value={groupMessage} onChange={e => setGroupMessage(e.target.value)} placeholder="Viktigt meddelande till hyresgästerna..." />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={sendGroupSms} loading={groupLoading} disabled={!groupMessage.trim()}><Send className="h-4 w-4" /> Skicka till fastighet</Button>
            {groupFeedback && <span className="text-sm font-semibold text-slate-600">{groupFeedback}</span>}
          </div>
        </div>
      </Card>
    )}

    {mode === 'group' && (
      <Card className="p-5"><h2 className="text-lg font-bold text-slate-950">Tidigare massutskick</h2><div className="mt-4 divide-y divide-slate-100">{broadcasts.length === 0 ? <p className="py-6 text-sm text-slate-500">Inga massutskick ännu.</p> : broadcasts.map(item => <div key={item.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-slate-900">{item.property_name}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.message}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.created_at).toLocaleString('sv-SE')}</p></div><Badge className={item.failed_count > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}>{item.recipient_count} mottagare{item.failed_count > 0 ? ` · ${item.failed_count} misslyckades` : ''}</Badge></div>)}</div></Card>
    )}

    <Card className="p-5"><h2 className="text-lg font-bold text-slate-950">Senaste SMS</h2><div className="mt-4 divide-y divide-slate-100">{history.length === 0 ? <p className="py-6 text-sm text-slate-500">Inga SMS skickade ännu.</p> : history.map(item => <div key={item.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-slate-900">{item.recipient}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.message}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.created_at).toLocaleString('sv-SE')}</p>{item.delivery_received_at && <p className="mt-1 text-xs text-slate-400">Leveransrapport {new Date(item.delivery_received_at).toLocaleString('sv-SE')}</p>}</div><Badge className={item.status === 'delivered' ? 'bg-emerald-50 text-emerald-700' : item.status === 'sent' ? 'bg-blue-50 text-blue-700' : item.status === 'delivery_failed' || item.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}>{item.status === 'delivered' ? 'Levererat' : item.status === 'sent' ? 'Skickat' : item.status === 'delivery_failed' ? 'Leverans misslyckades' : item.status === 'failed' ? 'Misslyckat' : 'Pågår'}</Badge></div>)}</div></Card>
  </div>;
}

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: Response })?.context;
  if (context) {
    const payload = await context.clone().json().catch(() => null);
    if (payload?.error) return String(payload.error);
  }
  return (error as Error)?.message || fallback;
}
