import React, { useEffect, useState } from 'react';
import { Bell, Send, Users2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Input, LoadingPage, PageHeader, Select, Textarea } from '../components/ui';

type Audience = 'tenant' | 'staff' | 'all';

interface BroadcastRow {
  id: string;
  audience: Audience;
  title: string;
  message: string;
  recipient_count: number;
  created_at: string;
}

const AUDIENCE_LABELS: Record<Audience, string> = {
  tenant: 'Hyresgäster',
  staff: 'Personal',
  all: 'Alla',
};

const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 500;

export function AdminBroadcastPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

  const [audience, setAudience] = useState<Audience>('all');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [user?.organisation_id]);

  async function fetchHistory() {
    if (!user?.organisation_id) {
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    const { data, error: fetchError } = await supabase
      .from('vihem_admin_broadcasts')
      .select('id, audience, title, message, recipient_count, created_at')
      .eq('organisation_id', user.organisation_id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!fetchError) setHistory((data || []) as BroadcastRow[]);
    setLoadingHistory(false);
  }

  async function handleSend() {
    setError('');
    setSuccess('');

    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    if (!trimmedTitle) { setError('Skriv en rubrik.'); return; }
    if (!trimmedMessage) { setError('Skriv ett meddelande.'); return; }

    if (!window.confirm(`Skicka "${trimmedTitle}" till ${AUDIENCE_LABELS[audience].toLowerCase()}?`)) return;

    setSending(true);
    const { data, error: invokeError } = await supabase.functions.invoke('vihem-admin-broadcast', {
      body: { title: trimmedTitle, message: trimmedMessage, audience },
    });
    setSending(false);

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'Utskicket misslyckades.');
      return;
    }

    setSuccess(`Skickat till ${data.recipient_count} mottagare.`);
    setTitle('');
    setMessage('');
    fetchHistory();
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={Bell}
        title="Endast admin kan skicka utskick"
        description="Be en administratör öppna den här sidan för att skicka push-meddelanden."
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Push-meddelande"
        subtitle="Skicka ett meddelande direkt till hyresgäster, personal eller alla i organisationen. Det dyker upp i mottagarens notiser och som push på telefonen."
        icon={Bell}
      />

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users2 className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-black text-slate-950">Nytt meddelande</h2>
          </div>

          <div className="space-y-4">
            <Select
              label="Mottagare"
              value={audience}
              onChange={(event) => setAudience(event.target.value as Audience)}
              options={[
                { value: 'all', label: 'Alla' },
                { value: 'tenant', label: 'Hyresgäster' },
                { value: 'staff', label: 'Personal' },
              ]}
            />
            <Input
              label="Rubrik"
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, MAX_TITLE_LENGTH))}
              placeholder="Ex. Vattenavstängning imorgon"
              hint={`${title.length}/${MAX_TITLE_LENGTH} tecken`}
            />
            <Textarea
              label="Meddelande"
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              placeholder="Skriv innehållet i meddelandet..."
              rows={5}
            />
            <p className="text-xs text-slate-500">{message.length}/{MAX_MESSAGE_LENGTH} tecken</p>

            <Button onClick={handleSend} loading={sending} disabled={!title.trim() || !message.trim()}>
              <Send className="h-4 w-4" />
              Skicka
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-lg font-black text-slate-950">Tidigare utskick</h2>
          {loadingHistory ? (
            <LoadingPage />
          ) : history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
              Inga utskick ännu.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-black text-slate-900">{row.title}</h3>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-500">
                      {AUDIENCE_LABELS[row.audience]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-slate-600">{row.message}</p>
                  <p className="mt-2 text-xs font-semibold text-slate-400">
                    {new Date(row.created_at).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })} · {row.recipient_count} mottagare
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
