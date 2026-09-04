import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Edit2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { calculateStayPrice, findSeasonForDate, getBaseNightlyPrice } from '../lib/shortStayPricing';
import { Badge, Button, Card, EmptyState, Input, Select } from './ui';
import type { ShortStayLosDiscount, ShortStayPriceSyncLog, ShortStayRate, ShortStaySeason, ShortStayUnit } from '../types';

type Props = {
  organisationId: string;
  units: ShortStayUnit[];
};

const money = (value: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(Number(value || 0));

// Local-date formatting deliberately avoids toISOString(): that converts
// to UTC, which silently shifts the date by a day in any timezone ahead of
// UTC (Europe/Stockholm included) once local midnight crosses into the
// previous UTC day.
function formatLocalIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIso() {
  return formatLocalIso(new Date());
}

function addDaysIso(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return formatLocalIso(d);
}

async function edgeFunctionErrorMessage(error: any, fallback: string) {
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.clone().json();
      if (body?.error) return body.error;
    } catch { /* fall through to generic message */ }
  }
  return error?.message || fallback;
}

type SeasonForm = { id: string | null; name: string; start_date: string; end_date: string; priority: string };
const emptySeasonForm: SeasonForm = { id: null, name: '', start_date: todayIso(), end_date: todayIso(), priority: '0' };

type DiscountForm = { id: string | null; seasonId: string | ''; minNights: string; discountPercent: string };
const emptyDiscountForm: DiscountForm = { id: null, seasonId: '', minNights: '2', discountPercent: '10' };

export function ShortStayPricingPanel({ organisationId, units }: Props) {
  const [seasons, setSeasons] = useState<ShortStaySeason[]>([]);
  const [rates, setRates] = useState<ShortStayRate[]>([]);
  const [discounts, setDiscounts] = useState<ShortStayLosDiscount[]>([]);
  const [syncLog, setSyncLog] = useState<ShortStayPriceSyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [selectedUnitId, setSelectedUnitId] = useState(units[0]?.id ?? '');
  const [defaultPriceDraft, setDefaultPriceDraft] = useState('');
  const [seasonPriceDrafts, setSeasonPriceDrafts] = useState<Record<string, string>>({});

  const [showSeasonForm, setShowSeasonForm] = useState(false);
  const [seasonForm, setSeasonForm] = useState<SeasonForm>(emptySeasonForm);

  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountForm, setDiscountForm] = useState<DiscountForm>(emptyDiscountForm);

  const [calendarStart, setCalendarStart] = useState(todayIso());

  const selectedUnit = units.find(unit => unit.id === selectedUnitId) || null;

  const refresh = async () => {
    setLoading(true);
    setError('');
    const [seasonsRes, ratesRes, discountsRes, logRes] = await Promise.all([
      supabase.from('vihem_short_stay_seasons').select('*').eq('organisation_id', organisationId).order('start_date'),
      supabase.from('vihem_short_stay_rates').select('*').eq('organisation_id', organisationId),
      supabase.from('vihem_short_stay_los_discounts').select('*').eq('organisation_id', organisationId),
      supabase.from('vihem_short_stay_price_sync_log').select('*').eq('organisation_id', organisationId).order('created_at', { ascending: false }).limit(10),
    ]);
    if (seasonsRes.error) setError(seasonsRes.error.message);
    setSeasons((seasonsRes.data || []) as ShortStaySeason[]);
    setRates((ratesRes.data || []) as ShortStayRate[]);
    setDiscounts((discountsRes.data || []) as ShortStayLosDiscount[]);
    setSyncLog((logRes.data || []) as ShortStayPriceSyncLog[]);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [organisationId]);

  useEffect(() => {
    if (!selectedUnitId && units[0]) setSelectedUnitId(units[0].id);
  }, [units, selectedUnitId]);

  useEffect(() => {
    if (!selectedUnitId) return;
    const defaultRate = rates.find(rate => rate.unit_id === selectedUnitId && rate.season_id === null);
    setDefaultPriceDraft(defaultRate ? String(defaultRate.price_per_night) : '');
    const drafts: Record<string, string> = {};
    for (const season of seasons) {
      const rate = rates.find(item => item.unit_id === selectedUnitId && item.season_id === season.id);
      drafts[season.id] = rate ? String(rate.price_per_night) : '';
    }
    setSeasonPriceDrafts(drafts);
  }, [selectedUnitId, rates, seasons]);

  const unitDiscounts = useMemo(() => discounts.filter(row => row.unit_id === selectedUnitId).sort((a, b) => a.min_nights - b.min_nights), [discounts, selectedUnitId]);

  const calendarDays = useMemo(() => Array.from({ length: 31 }, (_, i) => addDaysIso(calendarStart, i)), [calendarStart]);

  const saveSeason = async () => {
    if (!seasonForm.name.trim() || !seasonForm.start_date || !seasonForm.end_date) { setError('Fyll i namn och datumintervall.'); return; }
    if (seasonForm.end_date < seasonForm.start_date) { setError('Slutdatum måste vara efter startdatum.'); return; }
    setSaving(true); setError('');
    const payload = { organisation_id: organisationId, name: seasonForm.name.trim(), start_date: seasonForm.start_date, end_date: seasonForm.end_date, priority: Math.round(Number(seasonForm.priority) || 0) };
    const query = seasonForm.id
      ? supabase.from('vihem_short_stay_seasons').update(payload).eq('id', seasonForm.id)
      : supabase.from('vihem_short_stay_seasons').insert(payload);
    const { error: saveError } = await query;
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    setShowSeasonForm(false); setSeasonForm(emptySeasonForm);
    await refresh();
  };

  const editSeason = (season: ShortStaySeason) => {
    setSeasonForm({ id: season.id, name: season.name, start_date: season.start_date, end_date: season.end_date, priority: String(season.priority) });
    setShowSeasonForm(true);
  };

  const deleteSeason = async (season: ShortStaySeason) => {
    if (!window.confirm(`Ta bort säsongen "${season.name}"? Priser och rabatter kopplade till säsongen tas bort samtidigt.`)) return;
    setSaving(true);
    const { error: deleteError } = await supabase.from('vihem_short_stay_seasons').delete().eq('id', season.id);
    setSaving(false);
    if (deleteError) { setError(deleteError.message); return; }
    await refresh();
  };

  const saveDefaultPrice = async () => {
    if (!selectedUnitId) return;
    const price = Number(defaultPriceDraft);
    if (!(price >= 0)) { setError('Ange ett giltigt standardpris.'); return; }
    setSaving(true); setError('');
    const { error: saveError } = await supabase.from('vihem_short_stay_rates').upsert(
      { organisation_id: organisationId, unit_id: selectedUnitId, season_id: null, price_per_night: price },
      { onConflict: 'unit_id,season_id' },
    );
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    setNotice('Standardpriset sparades.');
    await refresh();
  };

  const saveSeasonPrice = async (seasonId: string) => {
    if (!selectedUnitId) return;
    const raw = seasonPriceDrafts[seasonId] ?? '';
    setSaving(true); setError('');
    if (raw.trim() === '') {
      const { error: deleteError } = await supabase.from('vihem_short_stay_rates').delete().eq('unit_id', selectedUnitId).eq('season_id', seasonId);
      setSaving(false);
      if (deleteError) { setError(deleteError.message); return; }
      await refresh();
      return;
    }
    const price = Number(raw);
    if (!(price >= 0)) { setSaving(false); setError('Ange ett giltigt pris.'); return; }
    const { error: saveError } = await supabase.from('vihem_short_stay_rates').upsert(
      { organisation_id: organisationId, unit_id: selectedUnitId, season_id: seasonId, price_per_night: price },
      { onConflict: 'unit_id,season_id' },
    );
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    setNotice('Säsongspriset sparades.');
    await refresh();
  };

  const saveDiscount = async () => {
    if (!selectedUnitId) return;
    const minNights = Math.round(Number(discountForm.minNights));
    const discountPercent = Number(discountForm.discountPercent);
    if (!(minNights >= 1) || !(discountPercent >= 0 && discountPercent <= 100)) { setError('Ange giltigt antal nätter och rabatt (0–100%).'); return; }
    setSaving(true); setError('');
    const payload = { organisation_id: organisationId, unit_id: selectedUnitId, season_id: discountForm.seasonId || null, min_nights: minNights, discount_percent: discountPercent };
    const query = discountForm.id
      ? supabase.from('vihem_short_stay_los_discounts').update(payload).eq('id', discountForm.id)
      : supabase.from('vihem_short_stay_los_discounts').upsert(payload, { onConflict: 'unit_id,season_id,min_nights' });
    const { error: saveError } = await query;
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    setShowDiscountForm(false); setDiscountForm(emptyDiscountForm);
    await refresh();
  };

  const editDiscount = (discount: ShortStayLosDiscount) => {
    setDiscountForm({ id: discount.id, seasonId: discount.season_id || '', minNights: String(discount.min_nights), discountPercent: String(discount.discount_percent) });
    setShowDiscountForm(true);
  };

  const deleteDiscount = async (discount: ShortStayLosDiscount) => {
    if (!window.confirm('Ta bort rabattnivån?')) return;
    setSaving(true);
    const { error: deleteError } = await supabase.from('vihem_short_stay_los_discounts').delete().eq('id', discount.id);
    setSaving(false);
    if (deleteError) { setError(deleteError.message); return; }
    await refresh();
  };

  const syncToBeds24 = async () => {
    setSyncing(true); setError(''); setNotice('');
    const { data, error: syncError } = await supabase.functions.invoke('vihem-sync-beds24-prices', { body: {} });
    setSyncing(false);
    if (syncError || data?.error) {
      setError(data?.error || await edgeFunctionErrorMessage(syncError, 'Kunde inte synka priser till Beds24.'));
      return;
    }
    const failed = (data.results || []).filter((row: any) => row.error);
    if (failed.length > 0) {
      setError(failed.map((row: any) => `${row.unit_name}: ${row.error}`).join(' · '));
    }
    setNotice(`${data.synced_units || 0} enheter synkade till Beds24.`);
    await refresh();
  };

  if (loading) return <Card><p className="text-sm text-slate-500">Laddar priser...</p></Card>;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Priser &amp; rabattregler</h2>
            <p className="mt-1 text-sm text-slate-500">Grundpris per säsong och rum/lägenhet, plus rabatt vid längre vistelser. Skickas till Beds24 och alla anslutna kanaler.</p>
          </div>
          <Button onClick={() => void syncToBeds24()} loading={syncing}>
            <RefreshCw className="h-4 w-4" /> Synka priser till Beds24
          </Button>
        </div>
        {notice && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{notice}</p>}
        {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
        {syncLog.length > 0 && (
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            {syncLog.slice(0, 3).map(row => (
              <p key={row.id}>
                {new Date(row.created_at).toLocaleString('sv-SE')} · {row.status === 'ok' ? <span className="text-emerald-700">OK</span> : <span className="text-red-700">Fel</span>} · {row.message}
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-950">Säsonger</h3>
            <p className="mt-1 text-sm text-slate-500">Namngivna datumintervall som styr både grundpris och rabattnivåer.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => { setSeasonForm(emptySeasonForm); setShowSeasonForm(value => !value); }}>
            <Plus className="h-4 w-4" /> Ny säsong
          </Button>
        </div>
        {showSeasonForm && (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input label="Namn" value={seasonForm.name} onChange={e => setSeasonForm(current => ({ ...current, name: e.target.value }))} placeholder="Lågsäsong" />
              <Input label="Startdatum" type="date" value={seasonForm.start_date} onChange={e => setSeasonForm(current => ({ ...current, start_date: e.target.value }))} />
              <Input label="Slutdatum" type="date" value={seasonForm.end_date} onChange={e => setSeasonForm(current => ({ ...current, end_date: e.target.value }))} />
              <Input label="Prioritet vid överlapp" type="number" value={seasonForm.priority} onChange={e => setSeasonForm(current => ({ ...current, priority: e.target.value }))} hint="Högre vinner" />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => void saveSeason()} loading={saving}>{seasonForm.id ? 'Spara ändringar' : 'Skapa säsong'}</Button>
              <Button size="sm" variant="secondary" onClick={() => { setShowSeasonForm(false); setSeasonForm(emptySeasonForm); }}>Avbryt</Button>
            </div>
          </div>
        )}
        {seasons.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Inga säsonger skapade. Utan säsong används standardpriset året runt.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {seasons.map(season => (
              <div key={season.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{season.name}</p>
                  <p className="text-xs text-slate-500">{season.start_date} – {season.end_date}{season.priority ? ` · prioritet ${season.priority}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => editSeason(season)}><Edit2 className="h-3.5 w-3.5" /> Redigera</Button>
                  <Button size="sm" variant="secondary" onClick={() => void deleteSeason(season)} className="text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {units.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="w-12 h-12" />} title="Inga korttidsenheter" description="Lägg upp en lägenhet eller ett rum först." /></Card>
      ) : (
        <>
          <Card className="p-5">
            <Select label="Rum/lägenhet" value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)} options={units.map(unit => ({ value: unit.id, label: unit.name }))} className="max-w-sm" />

            <div className="mt-5">
              <h3 className="font-bold text-slate-950">Grundpris per natt</h3>
              <div className="mt-3 grid gap-2">
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
                  <span className="w-40 text-sm font-semibold text-slate-700">Standard (utan säsong)</span>
                  <Input value={defaultPriceDraft} onChange={e => setDefaultPriceDraft(e.target.value)} type="number" min="0" className="max-w-[140px]" />
                  <Button size="sm" variant="secondary" onClick={() => void saveDefaultPrice()} loading={saving}>Spara</Button>
                </div>
                {seasons.map(season => (
                  <div key={season.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
                    <span className="w-40 truncate text-sm font-semibold text-slate-700">{season.name}</span>
                    <Input value={seasonPriceDrafts[season.id] ?? ''} onChange={e => setSeasonPriceDrafts(current => ({ ...current, [season.id]: e.target.value }))} type="number" min="0" placeholder="Använd standard" className="max-w-[140px]" />
                    <Button size="sm" variant="secondary" onClick={() => void saveSeasonPrice(season.id)} loading={saving}>Spara</Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-950">Rabatt vid längre vistelse</h3>
                  <p className="mt-1 text-sm text-slate-500">T.ex. billigare från natt 2 på en viss säsong, ännu billigare från en vecka.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => { setDiscountForm(emptyDiscountForm); setShowDiscountForm(value => !value); }}><Plus className="h-4 w-4" /> Ny rabattnivå</Button>
              </div>
              {showDiscountForm && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Select label="Gäller säsong" value={discountForm.seasonId} onChange={e => setDiscountForm(current => ({ ...current, seasonId: e.target.value }))} options={[{ value: '', label: 'Alla säsonger (standard)' }, ...seasons.map(season => ({ value: season.id, label: season.name }))]} />
                    <Input label="Från antal nätter" type="number" min="1" value={discountForm.minNights} onChange={e => setDiscountForm(current => ({ ...current, minNights: e.target.value }))} />
                    <Input label="Rabatt (%)" type="number" min="0" max="100" value={discountForm.discountPercent} onChange={e => setDiscountForm(current => ({ ...current, discountPercent: e.target.value }))} />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => void saveDiscount()} loading={saving}>{discountForm.id ? 'Spara ändringar' : 'Skapa rabattnivå'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => { setShowDiscountForm(false); setDiscountForm(emptyDiscountForm); }}>Avbryt</Button>
                  </div>
                </div>
              )}
              {unitDiscounts.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Inga rabattnivåer för den här enheten.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {unitDiscounts.map(discount => (
                    <div key={discount.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                      <div>
                        <p className="font-semibold text-slate-900">Från {discount.min_nights} nätter · {discount.discount_percent}% rabatt</p>
                        <p className="text-xs text-slate-500">{discount.season_id ? seasons.find(s => s.id === discount.season_id)?.name || 'Okänd säsong' : 'Alla säsonger'}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => editDiscount(discount)}><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="secondary" onClick={() => void deleteDiscount(discount)} className="text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="font-bold text-slate-950">Priskalender{selectedUnit ? ` · ${selectedUnit.name}` : ''}</h3>
                <p className="text-sm text-slate-500">31 dagar från valt startdatum.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setCalendarStart(addDaysIso(calendarStart, -31))}>Föregående</Button>
                <Button size="sm" variant="secondary" onClick={() => setCalendarStart(todayIso())}>Idag</Button>
                <Button size="sm" variant="secondary" onClick={() => setCalendarStart(addDaysIso(calendarStart, 31))}>Nästa</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="flex min-w-max">
                {calendarDays.map(date => {
                  const season = findSeasonForDate(seasons, date);
                  const price = selectedUnitId ? getBaseNightlyPrice(rates, selectedUnitId, season?.id ?? null) : null;
                  const isToday = date === todayIso();
                  return (
                    <div key={date} className={`w-[92px] shrink-0 border-r border-slate-100 px-2 py-3 text-center ${isToday ? 'bg-blue-50' : ''}`}>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">{new Date(`${date}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'short' })}</p>
                      <p className="text-sm font-bold text-slate-900">{new Date(`${date}T12:00:00`).getDate()}/{new Date(`${date}T12:00:00`).getMonth() + 1}</p>
                      {season && <p className="mt-1 truncate text-[10px] font-semibold text-violet-700">{season.name}</p>}
                      <p className={`mt-1 text-sm font-bold ${price === null ? 'text-slate-300' : 'text-emerald-700'}`}>{price === null ? '–' : money(price)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          <PriceExamplePreview unitId={selectedUnitId} seasons={seasons} rates={rates} discounts={discounts} />
        </>
      )}
    </div>
  );
}

/** Small "what would a stay cost" preview so admin can sanity-check the rules without opening the booking form. */
function PriceExamplePreview({ unitId, seasons, rates, discounts }: { unitId: string; seasons: ShortStaySeason[]; rates: ShortStayRate[]; discounts: ShortStayLosDiscount[] }) {
  const [startDate, setStartDate] = useState(todayIso());
  const [nights, setNights] = useState('2');
  const nightsNum = Math.max(1, Math.round(Number(nights) || 1));
  const endDate = addDaysIso(startDate, nightsNum);
  const result = unitId ? calculateStayPrice(unitId, startDate, endDate, seasons, rates, discounts) : null;

  return (
    <Card className="p-5">
      <h3 className="font-bold text-slate-950">Testa ett pris</h3>
      <p className="mt-1 text-sm text-slate-500">Se hur säsong och rabattregler slår för en tänkt vistelse.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Input label="Ankomst" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <Input label="Antal nätter" type="number" min="1" value={nights} onChange={e => setNights(e.target.value)} />
      </div>
      {result && (
        <div className="mt-4 rounded-xl bg-slate-900 p-4 text-white">
          {result.missingPriceDates.length > 0 ? (
            <p className="text-sm text-amber-300">Saknar pris för: {result.missingPriceDates.join(', ')}</p>
          ) : (
            <>
              <p className="text-xs text-slate-300">{nightsNum} nätter{result.discountPercent > 0 ? ` · ${result.discountPercent}% rabatt` : ''}</p>
              <p className="text-2xl font-bold">{money(result.total)}</p>
              {result.discountAmount > 0 && <p className="text-xs text-emerald-300">Du sparar {money(result.discountAmount)} jämfört med {money(result.subtotal)}.</p>}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
