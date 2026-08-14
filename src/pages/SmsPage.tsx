import { useEffect, useState } from 'react';
import { MessageSquareText, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, Input, Textarea } from '../components/ui';

type SmsMessage = { id: string; recipient: string; message: string; status: string; created_at: string; error: string };

export function SmsPage() {
  const { user } = useAuth();
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<SmsMessage[]>([]);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const loadHistory = async () => {
    if (!user?.organisation_id) return;
    const { data } = await supabase.from('vihem_sms_messages').select('id,recipient,message,status,created_at,error').eq('organisation_id', user.organisation_id).order('created_at', { ascending: false }).limit(25);
    setHistory((data || []) as SmsMessage[]);
  };

  useEffect(() => { void loadHistory(); }, [user?.organisation_id]);

  const sendSms = async () => {
    if (!user?.organisation_id || !recipient.trim() || !message.trim()) return;
    setLoading(true); setFeedback('');
    const { error } = await supabase.functions.invoke('vihem-send-sms', { body: { organisation_id: user.organisation_id, recipient, message } });
    setLoading(false);
    setFeedback(error ? error.message : 'SMS skickat.');
    if (!error) { setRecipient(''); setMessage(''); await loadHistory(); }
  };

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-24">
    <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">SMS</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Cellsynt SMS</h1><p className="mt-2 text-slate-600">Skicka SMS från VI-HEM och följ leveranshistoriken.</p></div>
    <Card className="p-5"><div className="flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-blue-600" /><h2 className="text-lg font-bold text-slate-950">Nytt SMS</h2></div><div className="mt-5 grid gap-4"><Input label="Mottagare" placeholder="0701234567" value={recipient} onChange={e => setRecipient(e.target.value)} /><Textarea label="Meddelande" rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="Skriv meddelande..." /><div className="flex flex-wrap items-center gap-3"><Button onClick={sendSms} loading={loading} disabled={!recipient.trim() || !message.trim()}><Send className="h-4 w-4" /> Skicka SMS</Button>{feedback && <span className="text-sm font-semibold text-slate-600">{feedback}</span>}</div></div></Card>
    <Card className="p-5"><h2 className="text-lg font-bold text-slate-950">Senaste SMS</h2><div className="mt-4 divide-y divide-slate-100">{history.length === 0 ? <p className="py-6 text-sm text-slate-500">Inga SMS skickade ännu.</p> : history.map(item => <div key={item.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-slate-900">{item.recipient}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.message}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.created_at).toLocaleString('sv-SE')}</p></div><Badge className={item.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : item.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}>{item.status === 'sent' ? 'Skickat' : item.status === 'failed' ? 'Misslyckat' : 'Pågår'}</Badge></div>)}</div></Card>
  </div>;
}
