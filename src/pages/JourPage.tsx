// Jour: fastighetsjour och snöjour. En datamodell (duty_type-fält på
// varje pass) med fem vyer: ett Gantt-liknande dagbesked, en bytesmarknad
// (annonsera/plocka, helt eller delat pass), inloggad users eget schema,
// och två admin-vyer (behörighet per jourtyp, grundschema/rotation).
// All affärslogik som måste vara atomär (klaim, dubbelbokningsspärr) körs
// server-side i databasen (se supabase/migrations/20260826100000_jour_module.sql)
// -- detta är bara läsningar/skrivningar direkt via supabase-js + RLS,
// samma mönster som AdminStaffPage.tsx/listMyAgreements().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select } from '../components/ui';
import type { JourDutyType, JourEligibility, JourRotationTemplate, JourRotationTemplateSlot, JourShift, JourSwapOffer, Profile } from '../types';
import { ArrowLeft, ArrowRight, Plus, RefreshCw, ShieldAlert, ShieldCheck, Snowflake, Trash2, Users } from 'lucide-react';

const DUTY_LABELS: Record<JourDutyType, string> = { fastighet: 'Fastighetsjour', sno: 'Snöjour' };
const DUTY_BAR_CLASS: Record<JourDutyType, string> = { fastighet: 'bg-blue-500 hover:bg-blue-600', sno: 'bg-orange-500 hover:bg-orange-600' };
const DUTY_BADGE_CLASS: Record<JourDutyType, string> = { fastighet: 'bg-blue-100 text-blue-700', sno: 'bg-orange-100 text-orange-700' };
const WINDOW_DAYS = 14;

function dateKey(value: Date) { return value.toISOString().slice(0, 10); }
function startOfWeek(value: Date) { const result = new Date(value); result.setHours(0, 0, 0, 0); const day = result.getDay() || 7; result.setDate(result.getDate() - day + 1); return result; }
function fmtDateTime(value: string) { return new Date(value).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }); }
function fmtDate(value: string) { return new Date(value).toLocaleDateString('sv-SE', { dateStyle: 'short' }); }
function toLocalInputValue(value: string) { const d = new Date(value); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Något gick fel.';
}

export function JourPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [tab, setTab] = useState<'dagbesked' | 'byten' | 'schema' | 'behorighet' | 'grundschema'>('dagbesked');
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'name'>[]>([]);
  const [myEligibility, setMyEligibility] = useState<JourEligibility[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!user?.organisation_id) return;
    supabase.from('vihem_profiles').select('id, name').eq('organisation_id', user.organisation_id).in('role', ['staff', 'admin', 'superadmin']).eq('active', true).order('name')
      .then(({ data }) => setProfiles(data || []));
    supabase.from('vihem_jour_eligibility').select('*').eq('user_id', user.id)
      .then(({ data }) => setMyEligibility((data || []) as JourEligibility[]));
  }, [user?.organisation_id, user?.id, reloadKey]);

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const myDutyTypes = useMemo(() => myEligibility.filter((e) => e.active).map((e) => e.duty_type), [myEligibility]);

  if (!user?.organisation_id) return <LoadingPage />;

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'dagbesked', label: 'Dagbesked' },
    { key: 'byten', label: 'Byten' },
    { key: 'schema', label: 'Mitt schema' },
    ...(isAdmin ? [{ key: 'behorighet' as const, label: 'Behörighet' }, { key: 'grundschema' as const, label: 'Grundschema' }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <PageHeader title="Jour" subtitle="Fastighetsjour och snöjour -- schema, dagbesked och passbyten" icon={ShieldAlert} />
        <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'dagbesked' && <DagbeskedTab organisationId={user.organisation_id} profilesById={profilesById} />}
        {tab === 'byten' && <BytenTab userId={user.id} organisationId={user.organisation_id} profilesById={profilesById} onChanged={reload} />}
        {tab === 'schema' && <MittSchemaTab userId={user.id} myDutyTypes={myDutyTypes} onChanged={reload} />}
        {isAdmin && tab === 'behorighet' && <BehorighetTab organisationId={user.organisation_id} userId={user.id} profiles={profiles} />}
        {isAdmin && tab === 'grundschema' && <GrundschemaTab organisationId={user.organisation_id} userId={user.id} profiles={profiles} />}
      </div>
    </div>
  );
}

// ── Dagbesked: Gantt-liknande tidslinje ─────────────────────────────────

function DagbeskedTab({ organisationId, profilesById }: { organisationId: string; profilesById: Map<string, Pick<Profile, 'id' | 'name'>> }) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [shifts, setShifts] = useState<JourShift[]>([]);
  const [loading, setLoading] = useState(true);
  const days = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, i) => { const d = new Date(anchor); d.setDate(anchor.getDate() + i); return d; }), [anchor]);

  useEffect(() => {
    setLoading(true);
    const from = days[0].toISOString();
    const to = new Date(days[WINDOW_DAYS - 1].getTime() + 86400000).toISOString();
    supabase.from('vihem_jour_shifts').select('*').eq('organisation_id', organisationId).lt('starts_at', to).gt('ends_at', from).order('starts_at')
      .then(({ data }) => { setShifts((data || []) as JourShift[]); setLoading(false); });
  }, [organisationId, days]);

  const position = (value: string) => Math.max(0, Math.min(WINDOW_DAYS - 1, Math.floor((new Date(value).getTime() - days[0].getTime()) / 86400000)));
  const span = (start: string, end: string) => Math.max(1, Math.min(WINDOW_DAYS - position(start), Math.ceil((new Date(end).getTime() - Math.max(new Date(start).getTime(), days[0].getTime())) / 86400000)));

  const rowKeys = useMemo(() => {
    const seen = new Map<string, { user_id: string; duty_type: JourDutyType }>();
    for (const s of shifts) seen.set(`${s.user_id}:${s.duty_type}`, { user_id: s.user_id, duty_type: s.duty_type });
    return Array.from(seen.values()).sort((a, b) => (profilesById.get(a.user_id)?.name || '').localeCompare(profilesById.get(b.user_id)?.name || ''));
  }, [shifts, profilesById]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="font-semibold text-slate-900">Dagbesked</h2>
          <p className="text-sm text-slate-500">Vem som har jour, {WINDOW_DAYS} dagar framåt från valt datum.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => { const next = new Date(anchor); next.setDate(anchor.getDate() - WINDOW_DAYS); setAnchor(next); }}><ArrowLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(startOfWeek(new Date()))}>Idag</Button>
          <Button size="sm" variant="secondary" onClick={() => { const next = new Date(anchor); next.setDate(anchor.getDate() + WINDOW_DAYS); setAnchor(next); }}><ArrowRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="flex items-center gap-4 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Fastighetsjour</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Snöjour</span>
      </div>
      {loading ? (
        <div className="p-10 text-center text-sm text-slate-500">Laddar...</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1120px]">
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `200px repeat(${WINDOW_DAYS}, minmax(64px, 1fr))` }}>
              <div className="p-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Person</div>
              {days.map((day) => (
                <div key={dateKey(day)} className={`border-l border-slate-200 p-2 text-center text-xs ${dateKey(day) === dateKey(new Date()) ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>
                  <div>{day.toLocaleDateString('sv-SE', { weekday: 'short' })}</div>
                  <strong>{day.getDate()} {day.toLocaleDateString('sv-SE', { month: 'short' })}</strong>
                </div>
              ))}
            </div>
            {rowKeys.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">Inga jourpass under den här perioden.</div>
            ) : (
              rowKeys.map((row) => {
                const rowShifts = shifts.filter((s) => s.user_id === row.user_id && s.duty_type === row.duty_type);
                return (
                  <div key={`${row.user_id}:${row.duty_type}`} className="grid min-h-[64px] border-b border-slate-200" style={{ gridTemplateColumns: `200px repeat(${WINDOW_DAYS}, minmax(64px, 1fr))` }}>
                    <div className="border-r border-slate-200 p-3">
                      <p className="truncate font-semibold text-slate-800">{profilesById.get(row.user_id)?.name || 'Okänd'}</p>
                      <Badge className={DUTY_BADGE_CLASS[row.duty_type]}>{DUTY_LABELS[row.duty_type]}</Badge>
                    </div>
                    <div className={`relative col-span-${WINDOW_DAYS} bg-white`} style={{ gridColumn: `2 / span ${WINDOW_DAYS}` }}>
                      {days.map((day) => <div key={dateKey(day)} className="absolute top-0 h-full border-l border-slate-100" style={{ left: `${(days.indexOf(day) / WINDOW_DAYS) * 100}%` }} />)}
                      {rowShifts.map((s) => (
                        <div
                          key={s.id}
                          title={`${fmtDateTime(s.starts_at)} - ${fmtDateTime(s.ends_at)}`}
                          className={`absolute z-10 mx-0.5 mt-3 h-8 overflow-hidden rounded-lg px-2 py-1 text-xs font-semibold text-white shadow-sm ${DUTY_BAR_CLASS[s.duty_type]}`}
                          style={{ left: `${(position(s.starts_at) / WINDOW_DAYS) * 100}%`, width: `${(span(s.starts_at, s.ends_at) / WINDOW_DAYS) * 100}%` }}
                        >
                          {fmtDate(s.starts_at)}-{fmtDate(s.ends_at)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Byten: bytesmarknad ──────────────────────────────────────────────────

function BytenTab({ userId, organisationId, profilesById, onChanged }: { userId: string; organisationId: string; profilesById: Map<string, Pick<Profile, 'id' | 'name'>>; onChanged: () => void }) {
  const [offers, setOffers] = useState<JourSwapOffer[]>([]);
  const [shiftsById, setShiftsById] = useState<Map<string, JourShift>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState<JourSwapOffer | null>(null);
  const [claimMode, setClaimMode] = useState<'whole' | 'partial'>('whole');
  const [claimStart, setClaimStart] = useState('');
  const [claimEnd, setClaimEnd] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimSaving, setClaimSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: offerRows } = await supabase.from('vihem_jour_swap_offers').select('*').eq('organisation_id', organisationId).eq('status', 'open').order('created_at', { ascending: false });
    const offersList = (offerRows || []) as JourSwapOffer[];
    setOffers(offersList);
    const shiftIds = [...new Set(offersList.map((o) => o.shift_id))];
    if (shiftIds.length > 0) {
      const { data: shiftRows } = await supabase.from('vihem_jour_shifts').select('*').in('id', shiftIds);
      setShiftsById(new Map((shiftRows || []).map((s: any) => [s.id, s as JourShift])));
    } else {
      setShiftsById(new Map());
    }
    setLoading(false);
  }, [organisationId]);

  useEffect(() => { load(); }, [load]);

  const openClaimModal = (offer: JourSwapOffer) => {
    setClaiming(offer);
    setClaimMode('whole');
    const shift = shiftsById.get(offer.shift_id);
    setClaimStart(shift ? toLocalInputValue(shift.starts_at) : '');
    setClaimEnd(shift ? toLocalInputValue(shift.ends_at) : '');
    setClaimError('');
  };

  const handleClaim = async () => {
    if (!claiming) return;
    setClaimSaving(true);
    setClaimError('');
    try {
      const patch: Record<string, unknown> = { status: 'claimed', claimed_by: userId };
      if (claimMode === 'partial') {
        patch.claim_start_at = new Date(claimStart).toISOString();
        patch.claim_end_at = new Date(claimEnd).toISOString();
      }
      const { data, error } = await supabase.from('vihem_jour_swap_offers').update(patch).eq('id', claiming.id).eq('status', 'open').select().maybeSingle();
      if (error) throw error;
      if (!data) { setClaimError('Passet hann bli taget av någon annan. Ladda om listan.'); return; }
      setClaiming(null);
      onChanged();
      load();
    } catch (err) {
      setClaimError(describeError(err));
    } finally {
      setClaimSaving(false);
    }
  };

  const handleCancel = async (offer: JourSwapOffer) => {
    if (!confirm('Avbryt annonsen? Passet stannar hos dig.')) return;
    const { error } = await supabase.from('vihem_jour_swap_offers').update({ status: 'cancelled' }).eq('id', offer.id).eq('status', 'open');
    if (error) { alert(describeError(error)); return; }
    load();
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {offers.length === 0 ? (
        <EmptyState icon={<Users className="w-12 h-12" />} title="Inga öppna byten" description="Det finns just nu inga jourpass ute för byte." />
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => {
            const shift = shiftsById.get(offer.shift_id);
            if (!shift) return null;
            const isOwn = offer.offered_by === userId;
            return (
              <Card key={offer.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Badge className={DUTY_BADGE_CLASS[shift.duty_type]}>{DUTY_LABELS[shift.duty_type]}</Badge>
                      {offer.allow_partial && <Badge className="bg-slate-100 text-slate-600">Del av pass tillåts</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-slate-800">{fmtDateTime(shift.starts_at)} - {fmtDateTime(shift.ends_at)}</p>
                    <p className="text-sm text-slate-500">Erbjuds av {profilesById.get(offer.offered_by)?.name || 'Okänd'}</p>
                    {offer.note && <p className="mt-1 text-sm text-slate-600">{offer.note}</p>}
                  </div>
                  {isOwn ? (
                    <Button size="sm" variant="secondary" onClick={() => handleCancel(offer)}>Avbryt annons</Button>
                  ) : (
                    <Button size="sm" onClick={() => openClaimModal(offer)}>Plocka pass</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!claiming} onClose={() => setClaiming(null)} title="Plocka jourpass">
        {claiming && (() => {
          const shift = shiftsById.get(claiming.shift_id);
          if (!shift) return null;
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">Passet gäller {fmtDateTime(shift.starts_at)} - {fmtDateTime(shift.ends_at)}.</p>
              {claiming.allow_partial && (
                <div className="flex gap-2">
                  <button onClick={() => setClaimMode('whole')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${claimMode === 'whole' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Ta hela passet</button>
                  <button onClick={() => setClaimMode('partial')} className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${claimMode === 'partial' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Ta del av pass</button>
                </div>
              )}
              {claimMode === 'partial' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Från" type="datetime-local" value={claimStart} onChange={(e) => setClaimStart(e.target.value)} min={toLocalInputValue(shift.starts_at)} max={toLocalInputValue(shift.ends_at)} />
                  <Input label="Till" type="datetime-local" value={claimEnd} onChange={(e) => setClaimEnd(e.target.value)} min={toLocalInputValue(shift.starts_at)} max={toLocalInputValue(shift.ends_at)} />
                </div>
              )}
              {claimError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{claimError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setClaiming(null)}>Avbryt</Button>
                <Button onClick={handleClaim} loading={claimSaving}>Bekräfta</Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

// ── Mitt schema ───────────────────────────────────────────────────────────

function MittSchemaTab({ userId, myDutyTypes, onChanged }: { userId: string; myDutyTypes: JourDutyType[]; onChanged: () => void }) {
  const [shifts, setShifts] = useState<JourShift[]>([]);
  const [openOfferShiftIds, setOpenOfferShiftIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState<JourShift | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: shiftRows }, { data: offerRows }] = await Promise.all([
      supabase.from('vihem_jour_shifts').select('*').eq('user_id', userId).gt('ends_at', nowIso).order('starts_at'),
      supabase.from('vihem_jour_swap_offers').select('shift_id').eq('offered_by', userId).eq('status', 'open'),
    ]);
    setShifts((shiftRows || []) as JourShift[]);
    setOpenOfferShiftIds(new Set((offerRows || []).map((o: any) => o.shift_id)));
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const openOfferModal = (shift: JourShift) => {
    setOffering(shift);
    setAllowPartial(false);
    setNote('');
    setError('');
  };

  const handleOffer = async () => {
    if (!offering) return;
    setSaving(true);
    setError('');
    try {
      const { error } = await supabase.from('vihem_jour_swap_offers').insert({
        organisation_id: (await supabase.from('vihem_jour_shifts').select('organisation_id').eq('id', offering.id).single()).data?.organisation_id,
        shift_id: offering.id,
        offered_by: userId,
        allow_partial: allowPartial,
        note,
      });
      if (error) throw error;
      setOffering(null);
      onChanged();
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-4">
      {myDutyTypes.length === 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Du är inte behörig för någon jourtyp än -- kontakta din admin om du ska ha jour.</div>
      )}
      {shifts.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="w-12 h-12" />} title="Inga kommande jourpass" description="Du har inga inbokade jourpass framöver." />
      ) : (
        <div className="space-y-3">
          {shifts.map((shift) => {
            const alreadyOffered = openOfferShiftIds.has(shift.id);
            return (
              <Card key={shift.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Badge className={DUTY_BADGE_CLASS[shift.duty_type]}>{DUTY_LABELS[shift.duty_type]}</Badge>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{fmtDateTime(shift.starts_at)} - {fmtDateTime(shift.ends_at)}</p>
                </div>
                {alreadyOffered ? (
                  <Badge className="bg-amber-100 text-amber-700">Ute för byte</Badge>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => openOfferModal(shift)}>Annonsera byte</Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!offering} onClose={() => setOffering(null)} title="Annonsera pass för byte">
        {offering && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{fmtDateTime(offering.starts_at)} - {fmtDateTime(offering.ends_at)}</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} className="rounded border-slate-300" />
              Tillåt att passet delas (annan person kan ta en del av tiden)
            </label>
            <Input label="Anmärkning (valfritt)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="T.ex. anledning till bytet" />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOffering(null)}>Avbryt</Button>
              <Button onClick={handleOffer} loading={saving}>Annonsera</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Admin: Behörighet ────────────────────────────────────────────────────

function BehorighetTab({ organisationId, userId, profiles }: { organisationId: string; userId: string; profiles: Pick<Profile, 'id' | 'name'>[] }) {
  const [rows, setRows] = useState<JourEligibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('vihem_jour_eligibility').select('*').eq('organisation_id', organisationId);
    setRows((data || []) as JourEligibility[]);
    setLoading(false);
  }, [organisationId]);

  useEffect(() => { load(); }, [load]);

  const isChecked = (profileId: string, dutyType: JourDutyType) => rows.some((r) => r.user_id === profileId && r.duty_type === dutyType && r.active);

  const toggle = async (profileId: string, dutyType: JourDutyType, checked: boolean) => {
    setSaving(`${profileId}:${dutyType}`);
    try {
      const existing = rows.find((r) => r.user_id === profileId && r.duty_type === dutyType);
      if (existing) {
        const { error } = await supabase.from('vihem_jour_eligibility').update({ active: checked }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vihem_jour_eligibility').insert({ organisation_id: organisationId, user_id: profileId, duty_type: dutyType, active: checked, created_by: userId });
        if (error) throw error;
      }
      load();
    } catch (err) {
      alert(describeError(err));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900">Behörighet per jourtyp</h2>
        <p className="text-sm text-slate-500">Vem som får schemaläggas och plocka byten för respektive jourtyp.</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
            <th className="px-4 py-2">Personal</th>
            <th className="px-4 py-2">Fastighetsjour</th>
            <th className="px-4 py-2">Snöjour</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="px-4 py-2.5 font-medium text-slate-800">{p.name}</td>
              {(['fastighet', 'sno'] as JourDutyType[]).map((dt) => (
                <td key={dt} className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={isChecked(p.id, dt)}
                    disabled={saving === `${p.id}:${dt}`}
                    onChange={(e) => toggle(p.id, dt, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Admin: Grundschema (rotationsmallar) ─────────────────────────────────

type SlotDraft = { user_id: string; duration_days: string };

function GrundschemaTab({ organisationId, userId, profiles }: { organisationId: string; userId: string; profiles: Pick<Profile, 'id' | 'name'>[] }) {
  const [templates, setTemplates] = useState<JourRotationTemplate[]>([]);
  const [slotsByTemplate, setSlotsByTemplate] = useState<Map<string, JourRotationTemplateSlot[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [dutyType, setDutyType] = useState<JourDutyType>('fastighet');
  const [anchorDate, setAnchorDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<SlotDraft[]>([{ user_id: '', duration_days: '7' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [untilDate, setUntilDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 3); return d.toISOString().slice(0, 10); });
  const [generateResult, setGenerateResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data: templateRows } = await supabase.from('vihem_jour_rotation_templates').select('*').eq('organisation_id', organisationId).order('created_at', { ascending: false });
    const list = (templateRows || []) as JourRotationTemplate[];
    setTemplates(list);
    if (list.length > 0) {
      const { data: slotRows } = await supabase.from('vihem_jour_rotation_template_slots').select('*').in('template_id', list.map((t) => t.id)).order('sort_order');
      const map = new Map<string, JourRotationTemplateSlot[]>();
      for (const s of (slotRows || []) as JourRotationTemplateSlot[]) map.set(s.template_id, [...(map.get(s.template_id) || []), s]);
      setSlotsByTemplate(map);
    }
    setLoading(false);
  }, [organisationId]);

  useEffect(() => { load(); }, [load]);

  const addSlot = () => setSlots([...slots, { user_id: '', duration_days: '7' }]);
  const removeSlot = (i: number) => setSlots(slots.filter((_, ii) => ii !== i));
  const updateSlot = (i: number, patch: Partial<SlotDraft>) => setSlots(slots.map((s, ii) => (ii === i ? { ...s, ...patch } : s)));

  const resetForm = () => {
    setName('');
    setDutyType('fastighet');
    setAnchorDate(new Date().toISOString().slice(0, 10));
    setSlots([{ user_id: '', duration_days: '7' }]);
    setError('');
  };

  const handleSave = async () => {
    if (slots.some((s) => !s.user_id || !s.duration_days || Number(s.duration_days) <= 0)) {
      setError('Varje segment behöver en person och ett positivt antal dagar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data: template, error: templateErr } = await supabase.from('vihem_jour_rotation_templates').insert({ organisation_id: organisationId, duty_type: dutyType, name, anchor_date: anchorDate, created_by: userId }).select('id').single();
      if (templateErr) throw templateErr;
      const { error: slotsErr } = await supabase.from('vihem_jour_rotation_template_slots').insert(
        slots.map((s, i) => ({ template_id: template.id, sort_order: i, user_id: s.user_id, duration_days: Number(s.duration_days) }))
      );
      if (slotsErr) throw slotsErr;
      setShowModal(false);
      resetForm();
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: JourRotationTemplate) => {
    if (!confirm(`Radera mallen "${template.name}"? Redan genererade jourpass påverkas inte.`)) return;
    const { error } = await supabase.from('vihem_jour_rotation_templates').delete().eq('id', template.id);
    if (error) { alert(describeError(error)); return; }
    load();
  };

  const handleGenerate = async (template: JourRotationTemplate) => {
    setGeneratingId(template.id);
    setGenerateResult('');
    try {
      const { data, error } = await supabase.rpc('vihem_generate_jour_shifts_from_template', { p_template_id: template.id, p_until_date: untilDate });
      if (error) throw error;
      setGenerateResult(`"${template.name}": ${data} nya jourpass skapade.`);
    } catch (err) {
      alert(describeError(err));
    } finally {
      setGeneratingId(null);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Input label="Generera pass t.o.m." type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} />
        </div>
        <Button onClick={() => { resetForm(); setShowModal(true); }}><Plus className="h-4 w-4" /> Ny rotationsmall</Button>
      </div>
      {generateResult && <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{generateResult}</p>}

      {templates.length === 0 ? (
        <EmptyState icon={<RefreshCw className="w-12 h-12" />} title="Inga grundscheman" description="Skapa en rotationsmall för att generera återkommande jourpass automatiskt." />
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const slotsList = slotsByTemplate.get(t.id) || [];
            const cycleDays = slotsList.reduce((sum, s) => sum + s.duration_days, 0);
            return (
              <Card key={t.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Badge className={DUTY_BADGE_CLASS[t.duty_type]}>{DUTY_LABELS[t.duty_type]}</Badge>
                      <h3 className="font-semibold text-slate-900">{t.name || 'Namnlös mall'}</h3>
                    </div>
                    <p className="text-sm text-slate-500">Ankardatum {fmtDate(t.anchor_date)}, {cycleDays}-dagarscykel</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {slotsList.map((s) => `${profiles.find((p) => p.id === s.user_id)?.name || 'Okänd'} (${s.duration_days}d)`).join(' → ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => handleGenerate(t)} loading={generatingId === t.id}><RefreshCw className="h-3.5 w-3.5" /> Generera jourpass</Button>
                    <button onClick={() => handleDelete(t)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Ny rotationsmall" size="lg">
        <div className="space-y-4">
          <Input label="Namn" value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Vintersäsong rotation" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Jourtyp" value={dutyType} onChange={(e) => setDutyType(e.target.value as JourDutyType)} options={[{ value: 'fastighet', label: 'Fastighetsjour' }, { value: 'sno', label: 'Snöjour' }]} />
            <Input label="Ankardatum (start på cykeln)" type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Segment i turordning (upprepas i cykel)</p>
            <div className="space-y-2">
              {slots.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={s.user_id} onChange={(e) => updateSlot(i, { user_id: e.target.value })} options={[{ value: '', label: 'Välj person' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} className="flex-1" />
                  <Input type="number" min={1} value={s.duration_days} onChange={(e) => updateSlot(i, { duration_days: e.target.value })} className="w-24" />
                  <span className="text-sm text-slate-500">dagar</span>
                  {slots.length > 1 && <button onClick={() => removeSlot(i)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="mt-2" onClick={addSlot}><Plus className="h-3.5 w-3.5" /> Lägg till segment</Button>
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Avbryt</Button>
            <Button onClick={handleSave} loading={saving}>Spara mall</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
