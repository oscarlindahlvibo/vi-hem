// Fredagsmöte-ombygget: parkopplingssidan för en mötesskärm. Medvetet
// fristående från ScreenDisplayPage.tsx (som kräver fullständig
// Supabase Auth-inloggning som role='screen') -- den här sidan kräver
// ALDRIG inloggning, bara en kort kod från mötesledarens kontrollvy. Se
// vihem-meeting-screen-pair (inlösen) och vihem-meeting-screen-data
// (den faktiska datavägen, säkerhetsgränsen för allt en skärm får se).
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'vihem.meetingScreenSession';
const POLL_INTERVAL_MS = 12000;

interface StoredSession {
  session_token: string;
  meeting_id: string;
  segment_key: string;
  display_role: 'meeting_main' | 'staff_week_plan';
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function ScreenPairPage() {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());

  function handlePaired(next: StoredSession) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }

  function handleDisconnected() {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }

  if (!session) {
    return <PairingForm onPaired={handlePaired} />;
  }
  return <ScreenSegmentView session={session} onDisconnected={handleDisconnected} />;
}

function PairingForm({ onPaired }: { onPaired: (s: StoredSession) => void }) {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Ange den 6-siffriga koden.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('vihem-meeting-screen-pair', {
        body: { action: 'redeem', code },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      onPaired({
        session_token: data.session_token,
        meeting_id: data.meeting_id,
        segment_key: data.segment_key,
        display_role: data.display_role,
      });
    } catch (err: any) {
      setError(err.message || 'Kunde inte ansluta skärmen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5 text-center">
        <h1 className="text-2xl font-bold text-white">Anslut mötesskärm</h1>
        <p className="text-sm text-slate-400">Ange koden från mötesledarens kontrollvy.</p>
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoFocus
          className="w-full rounded-xl border-2 border-slate-700 bg-slate-900 px-4 py-4 text-center text-3xl font-bold tracking-[0.3em] text-white outline-none focus:border-blue-500"
          placeholder="000000"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50">
          {loading ? 'Ansluter...' : 'Anslut'}
        </button>
      </form>
    </div>
  );
}

function ScreenSegmentView({ session, onDisconnected }: { session: StoredSession; onDisconnected: () => void }) {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'disconnected'>('loading');
  const [displayRole, setDisplayRole] = useState<'meeting_main' | 'staff_week_plan'>(session.display_role);

  const fetchData = useCallback(async () => {
    try {
      const { data: res, error } = await supabase.functions.invoke('vihem-meeting-screen-data', {
        body: { session_token: session.session_token },
      });
      if (error) throw error;
      if (res?.error === 'disconnected') {
        setStatus('disconnected');
        return;
      }
      setData(res);
      setDisplayRole(res.display_role);
      setStatus('ok');
    } catch {
      setStatus('disconnected');
    }
  }, [session.session_token]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (status === 'disconnected') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-center text-white">
        <p className="text-2xl font-bold">Skärmen är frånkopplad</p>
        <p className="text-slate-400">Sessionen har gått ut eller återkallats.</p>
        <button onClick={onDisconnected} className="rounded-xl bg-blue-600 px-5 py-2.5 font-semibold">Anslut igen</button>
      </div>
    );
  }

  if (status === 'loading' || !data) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Laddar...</div>;
  }

  if (displayRole === 'staff_week_plan') {
    return <WeekPlanScreen data={data} />;
  }
  return <MeetingMainScreen data={data} />;
}

function MeetingMainScreen({ data }: { data: any }) {
  return (
    <div className="min-h-screen bg-slate-950 p-10 text-white">
      <h1 className="mb-1 text-4xl font-bold">{data.meeting?.title}</h1>
      <p className="mb-8 text-lg text-slate-400">{data.meeting?.status}</p>

      {data.incoming_handoffs?.length > 0 && (
        <div className="mb-8 rounded-2xl border border-blue-800 bg-blue-950/50 p-6">
          <h2 className="mb-2 text-xl font-semibold text-blue-300">Från föregående delmöte</h2>
          {data.incoming_handoffs.map((h: any) => <p key={h.id} className="text-lg text-slate-200">{h.forwarded_text}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-8">
        <div>
          <h2 className="mb-3 text-2xl font-semibold text-slate-300">Agenda</h2>
          <div className="space-y-2">
            {data.agenda_items?.map((item: any) => (
              <div key={item.id} className="rounded-xl bg-slate-900 p-4">
                <p className="text-xl font-semibold">{item.title}</p>
                {item.note && <p className="mt-1 text-base text-slate-400">{item.note}</p>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-2xl font-semibold text-slate-300">Beslut &amp; åtgärder</h2>
          <div className="space-y-2">
            {data.decisions?.map((d: any) => <p key={d.id} className="rounded-xl bg-emerald-950/40 p-3 text-lg text-emerald-200">{d.title}</p>)}
            {data.action_items?.map((a: any) => <p key={a.id} className="rounded-xl bg-amber-950/40 p-3 text-lg text-amber-200">{a.title}{a.due_date ? ` · ${a.due_date}` : ''}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekPlanScreen({ data }: { data: any }) {
  return (
    <div className="min-h-screen bg-slate-950 p-10 text-white">
      <h1 className="mb-8 text-4xl font-bold">Veckoplan</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data.items || []).map((item: any) => (
          <div key={item.id} className={`rounded-2xl p-5 ${item.highlighted ? 'bg-blue-900 ring-4 ring-blue-500' : 'bg-slate-900'}`}>
            <p className="text-xl font-semibold">{item.title}</p>
            <p className="mt-1 text-base text-slate-400">{item.responsible_name || 'Ej tilldelad'} {item.planned_date ? `· ${item.planned_date}` : ''}</p>
            {item.material_needed && <p className="mt-2 text-sm text-slate-300">Material: {item.material_needed}</p>}
            {item.blockers && <p className="mt-2 text-sm text-red-300">Hinder: {item.blockers}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
