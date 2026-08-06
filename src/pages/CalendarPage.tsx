import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Link2, MapPin, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';
import type { CalendarEvent, CalendarEventCategory, CalendarEventVisibility, CalendarSource, Profile } from '../types';

type CalendarFilter = 'all' | 'mine' | 'organisation';

interface CalendarForm {
  title: string;
  description: string;
  location: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  all_day: boolean;
  visibility: CalendarEventVisibility;
  participant_ids: string[];
  category: CalendarEventCategory;
  color: string;
}

interface SourceForm {
  user_id: string;
  name: string;
  ical_url: string;
  category: CalendarEventCategory;
  color: string;
  active: boolean;
}

const categoryLabels: Record<CalendarEventCategory, string> = {
  general: 'Allmänt',
  operations: 'Drift',
  staff: 'Personal',
  maintenance: 'Underhåll',
  customer_project: 'Kundprojekt',
  short_stay: 'Korttidsuthyrning',
  meeting: 'Möte',
  deadline: 'Deadline',
  private: 'Privat',
};

const visibilityLabels: Record<CalendarEventVisibility, string> = {
  organisation: 'Hela organisationen',
  selected_users: 'Utvalda personer',
  private: 'Bara mig',
};

const categoryColors: Record<CalendarEventCategory, string> = {
  general: '#2563eb',
  operations: '#0891b2',
  staff: '#7c3aed',
  maintenance: '#ea580c',
  customer_project: '#ca8a04',
  short_stay: '#16a34a',
  meeting: '#4f46e5',
  deadline: '#dc2626',
  private: '#64748b',
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toInputDateTime(date: string, time: string) {
  return new Date(`${date}T${time || '00:00'}`).toISOString();
}

function monthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const gridStart = addDays(start, -((start.getDay() + 6) % 7));
  const end = addDays(gridStart, 42);
  return { gridStart, end };
}

function eventOverlapsDay(event: CalendarEvent, day: string) {
  const startDay = localDateKey(new Date(event.starts_at));
  const endDay = localDateKey(new Date(event.ends_at));
  return startDay <= day && endDay >= day;
}

function eventTimeLabel(event: CalendarEvent) {
  if (event.all_day) return 'Heldag';
  const start = new Date(event.starts_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const end = new Date(event.ends_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return `${start}-${end}`;
}

function defaultForm(date = localDateKey()): CalendarForm {
  return {
    title: '',
    description: '',
    location: '',
    start_date: date,
    start_time: '09:00',
    end_date: date,
    end_time: '10:00',
    all_day: false,
    visibility: 'organisation',
    participant_ids: [],
    category: 'general',
    color: categoryColors.general,
  };
}

const defaultSourceForm: SourceForm = {
  user_id: '',
  name: '',
  ical_url: '',
  category: 'staff',
  color: categoryColors.staff,
  active: true,
};

export function CalendarPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingSource, setEditingSource] = useState<CalendarSource | null>(null);
  const [form, setForm] = useState<CalendarForm>(() => defaultForm());
  const [sourceForm, setSourceForm] = useState<SourceForm>(defaultSourceForm);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [filter, setFilter] = useState<CalendarFilter>('all');

  const { gridStart, end } = useMemo(() => monthRange(currentMonth), [currentMonth]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => localDateKey(addDays(gridStart, index))), [gridStart]);
  const monthLabel = currentMonth.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

  useEffect(() => {
    fetchData();
  }, [user?.organisation_id, currentMonth]);

  useEffect(() => {
    if (!user?.organisation_id) return;
    const channel = supabase
      .channel(`calendar-events-${user.organisation_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vihem_calendar_events' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.organisation_id, currentMonth]);

  async function fetchData() {
    if (!user?.organisation_id) return;
    setLoading(true);
    setError('');
    const start = gridStart.toISOString();
    const stop = end.toISOString();
    const [eventsResult, staffResult, sourcesResult] = await Promise.all([
      supabase
        .from('vihem_calendar_events')
        .select('*, creator:created_by(id, name, email)')
        .eq('organisation_id', user.organisation_id)
        .lt('starts_at', stop)
        .gt('ends_at', start)
        .order('starts_at', { ascending: true }),
      supabase
        .from('vihem_profiles')
        .select('*')
        .eq('organisation_id', user.organisation_id)
        .in('role', ['staff', 'admin'])
        .eq('active', true)
        .order('name'),
      user.role === 'admin'
        ? supabase
            .from('vihem_calendar_sources')
            .select('*, user:user_id(id, name, email)')
            .eq('organisation_id', user.organisation_id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (eventsResult.error) {
      setError(eventsResult.error.message);
    } else {
      setEvents((eventsResult.data || []) as CalendarEvent[]);
    }
    if (!staffResult.error) setStaff((staffResult.data || []) as Profile[]);
    if (!sourcesResult.error) setSources((sourcesResult.data || []) as CalendarSource[]);
    setLoading(false);
  }

  const visibleEvents = events.filter(event => {
    if (filter === 'organisation') return event.visibility === 'organisation';
    if (filter === 'mine') return event.created_by === user?.id || event.participant_ids.includes(user?.id || '') || event.visibility === 'private';
    return true;
  });

  const selectedEvents = visibleEvents
    .filter(event => eventOverlapsDay(event, selectedDate))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  function openCreate(date = selectedDate) {
    setEditingEvent(null);
    setForm(defaultForm(date));
    setError('');
    setModalOpen(true);
  }

  function openEdit(event: CalendarEvent) {
    setEditingEvent(event);
    const start = new Date(event.starts_at);
    const endDate = new Date(event.ends_at);
    setForm({
      title: event.title,
      description: event.description || '',
      location: event.location || '',
      start_date: localDateKey(start),
      start_time: start.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
      end_date: localDateKey(endDate),
      end_time: endDate.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
      all_day: event.all_day,
      visibility: event.visibility,
      participant_ids: event.participant_ids || [],
      category: event.category,
      color: event.color || categoryColors[event.category],
    });
    setError('');
    setModalOpen(true);
  }

  function toggleParticipant(id: string) {
    setForm(current => ({
      ...current,
      participant_ids: current.participant_ids.includes(id)
        ? current.participant_ids.filter(item => item !== id)
        : [...current.participant_ids, id],
    }));
  }

  async function saveEvent() {
    if (!user?.organisation_id || !user?.id) return;
    setError('');
    if (!form.title.trim()) {
      setError('Ange en rubrik.');
      return;
    }

    const startsAt = form.all_day ? toInputDateTime(form.start_date, '00:00') : toInputDateTime(form.start_date, form.start_time);
    const endsAt = form.all_day ? toInputDateTime(form.end_date, '23:59') : toInputDateTime(form.end_date, form.end_time);
    if (endsAt <= startsAt) {
      setError('Sluttiden måste vara efter starttiden.');
      return;
    }

    const payload = {
      organisation_id: user.organisation_id,
      title: form.title.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: form.all_day,
      visibility: form.visibility,
      participant_ids: form.visibility === 'selected_users' ? form.participant_ids : form.visibility === 'private' ? [user.id] : [],
      category: form.category,
      color: form.color || categoryColors[form.category],
      created_by: editingEvent?.created_by || user.id,
      updated_by: user.id,
    };

    setSaving(true);
    const result = editingEvent
      ? await supabase.from('vihem_calendar_events').update(payload).eq('id', editingEvent.id)
      : await supabase.from('vihem_calendar_events').insert(payload);
    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }
    setModalOpen(false);
    await fetchData();
  }

  async function deleteEvent() {
    if (!editingEvent || !window.confirm('Vill du ta bort kalenderhändelsen?')) return;
    setSaving(true);
    const { error: deleteError } = await supabase.from('vihem_calendar_events').delete().eq('id', editingEvent.id);
    setSaving(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setModalOpen(false);
    await fetchData();
  }

  function openCreateSource() {
    setEditingSource(null);
    setSourceForm({ ...defaultSourceForm, user_id: staff[0]?.id || '' });
    setError('');
    setSourceModalOpen(true);
  }

  function openEditSource(source: CalendarSource) {
    setEditingSource(source);
    setSourceForm({
      user_id: source.user_id,
      name: source.name,
      ical_url: source.ical_url,
      category: source.category,
      color: source.color,
      active: source.active,
    });
    setError('');
    setSourceModalOpen(true);
  }

  async function saveSource() {
    if (!user?.organisation_id || !user?.id || user.role !== 'admin') return;
    setError('');
    if (!sourceForm.user_id) {
      setError('Välj vilken person kalendern hör till.');
      return;
    }
    if (!sourceForm.name.trim() || !sourceForm.ical_url.trim()) {
      setError('Ange namn och iCal-länk.');
      return;
    }

    const payload = {
      organisation_id: user.organisation_id,
      user_id: sourceForm.user_id,
      name: sourceForm.name.trim(),
      ical_url: sourceForm.ical_url.trim(),
      category: sourceForm.category,
      color: sourceForm.color || categoryColors[sourceForm.category],
      active: sourceForm.active,
      created_by: editingSource?.created_by || user.id,
      updated_by: user.id,
    };

    setSaving(true);
    const result = editingSource
      ? await supabase.from('vihem_calendar_sources').update(payload).eq('id', editingSource.id)
      : await supabase.from('vihem_calendar_sources').insert(payload);
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setSourceModalOpen(false);
    await fetchData();
  }

  async function deleteSource() {
    if (!editingSource || !window.confirm('Vill du ta bort iCal-kanalen och importerade händelser från den?')) return;
    setSaving(true);
    const { error: deleteError } = await supabase.from('vihem_calendar_sources').delete().eq('id', editingSource.id);
    setSaving(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setSourceModalOpen(false);
    await fetchData();
  }

  async function syncSource(sourceId?: string) {
    setSyncingSourceId(sourceId || 'all');
    setError('');
    const { data, error: syncError } = await supabase.functions.invoke('vihem-sync-calendar-ical', {
      body: sourceId ? { source_id: sourceId } : {},
    });
    setSyncingSourceId(null);
    if (syncError || data?.error) {
      setError(data?.error || syncError?.message || 'Kunde inte synka iCal.');
      return;
    }
    await fetchData();
  }

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kalender"
        subtitle="Gemensamma händelser för organisationen och personliga händelser för personal."
        action={<Button onClick={() => openCreate()}><Plus className="h-4 w-4" /> Ny händelse</Button>}
      />

      {error && !modalOpen && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_0.8fr]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="min-w-48 text-center text-lg font-black capitalize text-slate-950">{monthLabel}</h2>
              <Button variant="secondary" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setCurrentMonth(new Date()); setSelectedDate(localDateKey()); }}>Idag</Button>
            </div>
            <Select
              value={filter}
              onChange={event => setFilter(event.target.value as CalendarFilter)}
              options={[
                { value: 'all', label: 'Alla händelser' },
                { value: 'mine', label: 'Mina händelser' },
                { value: 'organisation', label: 'Gemensamma' },
              ]}
            />
          </div>
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-xs font-black uppercase tracking-wide text-slate-500">
            {['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'].map(day => <div key={day} className="py-2">{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map(day => {
              const dayEvents = visibleEvents.filter(event => eventOverlapsDay(event, day));
              const inMonth = new Date(`${day}T12:00:00`).getMonth() === currentMonth.getMonth();
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDate(day)}
                  onDoubleClick={() => openCreate(day)}
                  className={`min-h-28 border-b border-r border-slate-100 p-2 text-left transition-colors hover:bg-blue-50 ${
                    day === selectedDate ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : 'bg-white'
                  } ${!inMonth ? 'text-slate-300' : 'text-slate-900'}`}
                >
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-black ${day === localDateKey() ? 'bg-blue-600 text-white' : ''}`}>
                    {new Date(`${day}T12:00:00`).getDate()}
                  </span>
                  <span className="mt-2 block space-y-1">
                    {dayEvents.slice(0, 3).map(event => (
                      <span key={event.id} className="block truncate rounded-md px-2 py-1 text-xs font-bold text-white" style={{ backgroundColor: event.color }}>
                        {eventTimeLabel(event)} · {event.title}
                      </span>
                    ))}
                    {dayEvents.length > 3 && <span className="block text-xs font-bold text-slate-500">+{dayEvents.length - 3} fler</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-500">Valt datum</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {selectedEvents.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<CalendarDays className="h-10 w-10" />}
                  title="Inga händelser"
                  description="Lägg upp något gemensamt eller personligt för dagen."
                  action={<Button variant="secondary" onClick={() => openCreate(selectedDate)}><Plus className="h-4 w-4" /> Lägg till</Button>}
                />
              </div>
            ) : selectedEvents.map(event => (
              <button key={event.id} onClick={() => openEdit(event)} className="block w-full p-4 text-left transition-colors hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: event.color }} />
                      <p className="truncate font-black text-slate-950">{event.title}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {eventTimeLabel(event)}</span>
                      {event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {event.location}</span>}
                    </div>
                    {event.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{event.description}</p>}
                  </div>
                  <Badge className="bg-slate-100 text-slate-700">{visibilityLabels[event.visibility]}</Badge>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {user?.role === 'admin' && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">iCal-kanaler för personal</h2>
              <p className="mt-1 text-sm text-slate-500">
                Koppla externa kalenderflöden till en person. Importerade händelser visas i kalendern för personen och admin.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => syncSource()} loading={syncingSourceId === 'all'}>
                <RefreshCw className="h-4 w-4" /> Synka alla
              </Button>
              <Button onClick={openCreateSource}>
                <Plus className="h-4 w-4" /> Lägg till kanal
              </Button>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {sources.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">Inga iCal-kanaler är upplagda ännu.</div>
            ) : sources.map(source => (
              <div key={source.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <button type="button" onClick={() => openEditSource(source)} className="min-w-0 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: source.color }} />
                    <p className="font-black text-slate-950">{source.name}</p>
                    <Badge className={source.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                      {source.active ? 'Aktiv' : 'Avstängd'}
                    </Badge>
                    <Badge className="bg-blue-100 text-blue-700">{source.user?.name || 'Personal'}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-500">{source.ical_url}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {source.last_synced_at ? `Senast synkad ${new Date(source.last_synced_at).toLocaleString('sv-SE')}` : 'Aldrig synkad'}
                    {source.sync_error ? ` · Fel: ${source.sync_error}` : ''}
                  </p>
                </button>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => syncSource(source.id)} loading={syncingSourceId === source.id}>
                    <RefreshCw className="h-4 w-4" /> Synka
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openEditSource(source)}>Redigera</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingEvent ? 'Redigera händelse' : 'Ny händelse'} size="lg">
        <div className="space-y-4">
          <Input label="Rubrik" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} />
          <Textarea label="Beskrivning" rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
          <Input label="Plats" value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Startdatum" type="date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value, end_date: form.end_date < event.target.value ? event.target.value : form.end_date })} />
            <Input label="Slutdatum" type="date" value={form.end_date} onChange={event => setForm({ ...form, end_date: event.target.value })} />
            {!form.all_day && (
              <>
                <Input label="Starttid" type="time" value={form.start_time} onChange={event => setForm({ ...form, start_time: event.target.value })} />
                <Input label="Sluttid" type="time" value={form.end_time} onChange={event => setForm({ ...form, end_time: event.target.value })} />
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={form.all_day} onChange={event => setForm({ ...form, all_day: event.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            Heldag
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Typ"
              value={form.category}
              onChange={event => {
                const category = event.target.value as CalendarEventCategory;
                setForm({ ...form, category, color: categoryColors[category] });
              }}
              options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))}
            />
            <Select
              label="Synlighet"
              value={form.visibility}
              onChange={event => setForm({ ...form, visibility: event.target.value as CalendarEventVisibility })}
              options={Object.entries(visibilityLabels).map(([value, label]) => ({ value, label }))}
            />
          </div>
          {form.visibility === 'selected_users' && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800"><Users className="h-4 w-4" /> Personer</p>
              <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                {staff.map(person => (
                  <label key={person.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <input type="checkbox" checked={form.participant_ids.includes(person.id)} onChange={() => toggleParticipant(person.id)} className="h-4 w-4 rounded border-slate-300" />
                    <span className="min-w-0 truncate">{person.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            {editingEvent ? <Button variant="danger" onClick={deleteEvent} loading={saving}><Trash2 className="h-4 w-4" /> Ta bort</Button> : <span />}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>Avbryt</Button>
              <Button onClick={saveEvent} loading={saving}>{editingEvent ? 'Spara' : 'Skapa'}</Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={sourceModalOpen} onClose={() => setSourceModalOpen(false)} title={editingSource ? 'Redigera iCal-kanal' : 'Ny iCal-kanal'} size="lg">
        <div className="space-y-4">
          <Select
            label="Person"
            value={sourceForm.user_id}
            onChange={event => setSourceForm({ ...sourceForm, user_id: event.target.value })}
            options={staff.map(person => ({ value: person.id, label: person.name }))}
          />
          <Input label="Namn" value={sourceForm.name} onChange={event => setSourceForm({ ...sourceForm, name: event.target.value })} placeholder="Ex. Oscars Google Kalender" />
          <Input label="iCal-länk" value={sourceForm.ical_url} onChange={event => setSourceForm({ ...sourceForm, ical_url: event.target.value })} placeholder="https://..." />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Kategori"
              value={sourceForm.category}
              onChange={event => {
                const category = event.target.value as CalendarEventCategory;
                setSourceForm({ ...sourceForm, category, color: categoryColors[category] });
              }}
              options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))}
            />
            <Input label="Färg" type="color" value={sourceForm.color} onChange={event => setSourceForm({ ...sourceForm, color: event.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={sourceForm.active} onChange={event => setSourceForm({ ...sourceForm, active: event.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            Aktiv kanal
          </label>
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
            <div className="flex gap-2">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Händelser importeras som personliga/tilldelade händelser för vald person. Admin kan synka alla kanaler manuellt här.</p>
            </div>
          </div>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            {editingSource ? <Button variant="danger" onClick={deleteSource} loading={saving}><Trash2 className="h-4 w-4" /> Ta bort</Button> : <span />}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setSourceModalOpen(false)}>Avbryt</Button>
              <Button onClick={saveSource} loading={saving}>{editingSource ? 'Spara' : 'Skapa'}</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
