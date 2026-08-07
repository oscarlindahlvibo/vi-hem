import React, { useEffect, useState } from 'react';
import { Monitor, Plus, Save, Settings, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Input, LoadingPage, PageHeader, Select } from '../components/ui';
import type { LaundryRoom, Meeting } from '../types';
import {
  buildOrganisationScreenSettings,
  DEFAULT_SCREEN_KEY,
  defaultScreenConfig,
  isMissingScreenSettingsTable,
  isScreenSettingsTableUnsupported,
  mergeScreenConfigs,
  normalizePresentationSettings,
  normalizeScreenConfig,
  readOrganisationScreenConfigs,
  screenViewLabel,
  type MeetingScreenPart,
  type PresentationSettings,
  type ScreenConfig,
  type ScreenView,
} from '../lib/screenSettings';

interface ScreenSettingsPageProps {
  onNavigate: (page: string) => void;
}

const panelOptions: Array<{ key: keyof PresentationSettings; label: string; description: string }> = [
  { key: 'showNews', label: 'Nyheter', description: 'Visar publicerade nyheter i presentationsvyn.' },
  { key: 'showWorkOrders', label: 'Arbetsordrar', description: 'Visar aktiva arbetsordrar sorterade efter förfallodag och prioritet.' },
  { key: 'showClockedIn', label: 'Instämplad personal', description: 'Visar vilka som är instämplade just nu.' },
  { key: 'showMeetings', label: 'Kalenderhändelser', description: 'Visar kommande möten och uppföljningar.' },
];

const tickerOptions: Array<{ key: keyof PresentationSettings; label: string }> = [
  { key: 'showTickerWeather', label: 'Väder' },
  { key: 'showTickerCheckIns', label: 'Incheckningar idag' },
  { key: 'showTickerCheckOuts', label: 'Utcheckningar idag' },
  { key: 'showTickerClockedIn', label: 'Instämplade just nu' },
  { key: 'showTickerUpdated', label: 'Senast uppdaterad' },
];

export function ScreenSettingsPage({ onNavigate: _onNavigate }: ScreenSettingsPageProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [screens, setScreens] = useState<ScreenConfig[]>(() => [defaultScreenConfig(1)]);
  const [selectedScreenKey, setSelectedScreenKey] = useState(DEFAULT_SCREEN_KEY);
  const [organisationSettings, setOrganisationSettings] = useState<Record<string, unknown>>({});
  const [laundryRooms, setLaundryRooms] = useState<LaundryRoom[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  const canManage = user?.role === 'admin' || user?.role === 'superadmin';
  const selectedScreen = screens.find(screen => screen.screenKey === selectedScreenKey) || screens[0] || defaultScreenConfig(1);
  const screenView = selectedScreen.screenView;
  const settings = selectedScreen.presentationSettings;

  useEffect(() => {
    fetchSettings();
  }, [user?.organisation_id]);

  async function fetchSettings() {
    if (!user?.organisation_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    const [screenSettingsResult, organisationResult, laundryRoomsResult, meetingsResult] = await Promise.all([
      supabase
        .from('vihem_screen_settings')
        .select('screen_key, screen_view, presentation_settings')
        .eq('organisation_id', user.organisation_id)
        .order('screen_key'),
      supabase
        .from('vihem_organisations')
        .select('settings')
        .eq('id', user.organisation_id)
        .maybeSingle(),
      supabase
        .from('vihem_laundry_rooms')
        .select('*, property:vihem_properties(name)')
        .eq('organisation_id', user.organisation_id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('vihem_meetings')
        .select('id, title, meeting_type, status, starts_at, ends_at, location')
        .eq('organisation_id', user.organisation_id)
        .in('status', ['draft', 'planned', 'in_progress'])
        .order('starts_at', { ascending: true, nullsFirst: false })
        .limit(80),
    ]);

    const screenSettingsUnavailable = isMissingScreenSettingsTable(screenSettingsResult.error);

    if (organisationResult.data?.settings && typeof organisationResult.data.settings === 'object') {
      setOrganisationSettings(organisationResult.data.settings as Record<string, unknown>);
    }

    if (!laundryRoomsResult.error) {
      setLaundryRooms((laundryRoomsResult.data || []) as LaundryRoom[]);
    }

    if (!meetingsResult.error) {
      setMeetings((meetingsResult.data || []) as Meeting[]);
    }

    if (screenSettingsResult.error && !screenSettingsUnavailable) {
      setError(screenSettingsResult.error.message);
    } else if (organisationResult.error) {
      setError(organisationResult.error.message);
    } else if (laundryRoomsResult.error) {
      setError(laundryRoomsResult.error.message);
    } else if (meetingsResult.error) {
      setError(meetingsResult.error.message);
    } else if (screenSettingsResult.data?.length) {
      const dbScreens = screenSettingsResult.data.map((row: any, index: number) => normalizeScreenConfig(row, index + 1));
      const fallbackScreens = readOrganisationScreenConfigs(organisationResult.data?.settings);
      const nextScreens = mergeScreenConfigs(fallbackScreens, dbScreens);
      setScreens(nextScreens);
      setSelectedScreenKey(current => nextScreens.some(screen => screen.screenKey === current) ? current : nextScreens[0].screenKey);
    } else {
      const fallbackScreens = readOrganisationScreenConfigs(organisationResult.data?.settings);
      if (fallbackScreens.length > 0) {
        setScreens(fallbackScreens);
        setSelectedScreenKey(current => fallbackScreens.some(screen => screen.screenKey === current) ? current : fallbackScreens[0].screenKey);
      }
    }

    setLoading(false);
  }

  function updateSetting<K extends keyof PresentationSettings>(key: K, value: PresentationSettings[K]) {
    updateSelectedScreen({
      presentationSettings: { ...settings, [key]: value },
    });
  }

  function updateTickerItem(index: number, value: string) {
    const nextItems = [...settings.customTickerItems];
    nextItems[index] = value;
    updateSetting('customTickerItems', nextItems);
  }

  function updateSelectedScreen(updates: Partial<ScreenConfig>) {
    setScreens(prev => prev.map(screen => (
      screen.screenKey === selectedScreen.screenKey ? { ...screen, ...updates } : screen
    )));
  }

  function addScreen() {
    setError('');
    setSuccess('');
    const nextNumber = screens.length + 1;
    let nextScreen = defaultScreenConfig(nextNumber);
    while (screens.some(screen => screen.screenKey === nextScreen.screenKey)) {
      nextScreen = defaultScreenConfig(nextNumber + Math.floor(Math.random() * 1000));
    }
    setScreens(prev => [...prev, nextScreen]);
    setSelectedScreenKey(nextScreen.screenKey);
  }

  function deleteSelectedScreen() {
    if (screens.length <= 1) {
      setError('Det måste finnas minst en skärm.');
      return;
    }

    setScreens(prev => {
      const nextScreens = prev.filter(screen => screen.screenKey !== selectedScreen.screenKey);
      setSelectedScreenKey(nextScreens[0]?.screenKey || DEFAULT_SCREEN_KEY);
      return nextScreens;
    });
  }

  async function saveSettings() {
    if (!user?.organisation_id || !canManage) return;

    setSaving(true);
    setError('');
    setSuccess('');

    const cleanedScreens = screens.map(screen => ({
      ...screen,
      name: screen.name.trim() || screen.screenKey,
      presentationSettings: {
        ...screen.presentationSettings,
        customTickerText: '',
        customTickerItems: screen.presentationSettings.customTickerItems.map(item => item.trim()).filter(Boolean),
      },
      laundryRoomId: screen.laundryRoomId || '',
      meetingId: screen.meetingId || '',
      meetingPart: screen.meetingPart || 'full',
    }));

    const now = new Date().toISOString();
    const nextOrganisationSettings = buildOrganisationScreenSettings(organisationSettings, cleanedScreens);
    const saveResult = await supabase
      .from('vihem_screen_settings')
      .upsert(cleanedScreens.map(screen => ({
        organisation_id: user.organisation_id,
        screen_key: screen.screenKey,
        screen_view: screen.screenView,
        presentation_settings: {
          ...screen.presentationSettings,
          screen_name: screen.name,
          laundry_room_id: screen.laundryRoomId || '',
          meeting_id: screen.meetingId || '',
          meeting_part: screen.meetingPart || 'full',
        },
        created_by: user.id,
        updated_by: user.id,
        updated_at: now,
      })), { onConflict: 'organisation_id,screen_key' });

    if (saveResult.error && isScreenSettingsTableUnsupported(saveResult.error)) {
      const organisationSaveResult = await supabase
        .from('vihem_organisations')
        .update({ settings: nextOrganisationSettings })
        .eq('id', user.organisation_id);

      setSaving(false);

      if (organisationSaveResult.error) {
        setError(organisationSaveResult.error.message);
        return;
      }

      setOrganisationSettings(nextOrganisationSettings);
      setScreens(cleanedScreens);
      setSuccess('Skärminställningarna är sparade i organisationens inställningar. TV-skärmen uppdaterar automatiskt inom ungefär en minut.');
      return;
    }

    setSaving(false);

    if (saveResult.error) {
      setError(saveResult.error.message);
      return;
    }

    const organisationSaveResult = await supabase
      .from('vihem_organisations')
      .update({ settings: nextOrganisationSettings })
      .eq('id', user.organisation_id);

    if (organisationSaveResult.error) {
      setError(organisationSaveResult.error.message);
      return;
    }

    const screenKeys = cleanedScreens.map(screen => screen.screenKey);
    const deleteResult = await supabase
      .from('vihem_screen_settings')
      .delete()
      .eq('organisation_id', user.organisation_id)
      .not('screen_key', 'in', `(${screenKeys.join(',')})`);

    if (deleteResult.error) {
      setError(deleteResult.error.message);
      return;
    }

    setScreens(cleanedScreens);
    setOrganisationSettings(nextOrganisationSettings);
    setSuccess('Skärminställningarna är sparade. TV-skärmen uppdaterar automatiskt inom ungefär en minut.');
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={Monitor}
        title="Endast admin kan ändra TV-skärmen"
        description="Be en administratör öppna den här sidan för att styra presentationsvyn."
      />
    );
  }

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="TV-skärm"
        subtitle="Styr vad organisationens presentationsskärm visar utan att behöva skriva eller ändra något direkt på TV:n."
        icon={Monitor}
        action={(
          <Button onClick={saveSettings} loading={saving}>
            <Save className="h-4 w-4" />
            Spara
          </Button>
        )}
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

      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-950">Skärmar</h2>
              <Button type="button" size="sm" variant="secondary" onClick={addScreen}>
                <Plus className="h-4 w-4" />
                Lägg till
              </Button>
            </div>
            <div className="space-y-2">
              {screens.map(screen => (
                <button
                  key={screen.screenKey}
                  type="button"
                  onClick={() => setSelectedScreenKey(screen.screenKey)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    selectedScreen.screenKey === screen.screenKey
                      ? 'border-blue-300 bg-blue-50 text-blue-800 ring-1 ring-blue-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-black">{screen.name}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-slate-500">{screenViewLabel(screen.screenView)}</span>
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-500">{screen.screenKey}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Settings className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-black text-slate-950">Vald skärm</h2>
            </div>
            <Input
              label="Namn"
              value={selectedScreen.name}
              onChange={(event) => updateSelectedScreen({ name: event.target.value })}
              placeholder="Ex. Reception"
            />
            <div className="mt-4">
            <Select
              label="Vad ska TV:n visa?"
              value={screenView}
              onChange={(event) => updateSelectedScreen({ screenView: event.target.value as ScreenView })}
              options={[
                { value: 'presentation', label: screenViewLabel('presentation') },
                { value: 'short-stay', label: screenViewLabel('short-stay') },
                { value: 'work-orders', label: screenViewLabel('work-orders') },
                { value: 'meeting', label: screenViewLabel('meeting') },
                { value: 'laundry', label: screenViewLabel('laundry') },
              ]}
            />
            </div>
            {screenView === 'laundry' && (
              <div className="mt-4">
                <Select
                  label="Tvättstuga"
                  value={selectedScreen.laundryRoomId || ''}
                  onChange={(event) => updateSelectedScreen({ laundryRoomId: event.target.value })}
                  options={[
                    { value: '', label: 'Välj tvättstuga' },
                    ...laundryRooms.map(room => ({
                      value: room.id,
                      label: `${room.name}${room.property?.name ? ` · ${room.property.name}` : ''}`,
                    })),
                  ]}
                />
              </div>
            )}
            {screenView === 'meeting' && (
              <div className="mt-4 grid gap-4">
                <Select
                  label="Möte"
                  value={selectedScreen.meetingId || ''}
                  onChange={(event) => updateSelectedScreen({ meetingId: event.target.value })}
                  options={[
                    { value: '', label: 'Välj automatiskt aktivt/kommande möte' },
                    ...meetings.map(meeting => ({
                      value: meeting.id,
                      label: `${meeting.title}${meeting.starts_at ? ` · ${new Date(meeting.starts_at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}` : ''}`,
                    })),
                  ]}
                />
                <Select
                  label="Del som ska visas"
                  value={selectedScreen.meetingPart || 'full'}
                  onChange={(event) => updateSelectedScreen({ meetingPart: event.target.value as MeetingScreenPart })}
                  options={[
                    { value: 'full', label: 'Hela mötet på en skärm' },
                    { value: 'part-1', label: 'Del 1/2: dagordning och arbetsordrar' },
                    { value: 'part-2', label: 'Del 2/2: kundprojekt, frånvaro och kommande' },
                  ]}
                  hint="Använd två olika skärmprofiler om mötet ska delas över två TV-skärmar."
                />
              </div>
            )}
            <p className="mt-3 text-sm leading-6 text-slate-500">
              När TV:n har valts som {selectedScreen.name || selectedScreen.screenKey} hämtar den den här profilen automatiskt.
            </p>
            <Button type="button" variant="outline" className="mt-4" onClick={deleteSelectedScreen} disabled={screens.length <= 1}>
              <Trash2 className="h-4 w-4" />
              Ta bort vald skärm
            </Button>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-lg font-black text-slate-950">Väder</h2>
            <Input
              label="Plats"
              value={settings.weatherLocation}
              onChange={(event) => updateSetting('weatherLocation', event.target.value)}
              placeholder="Ex. Virserum"
              hint="Används både i väderboxen och i rullande bannern om väder är valt."
            />
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-4 text-lg font-black text-slate-950">Paneler i presentationsvyn</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {panelOptions.map(option => (
                <label key={option.key} className="flex min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(settings[option.key])}
                    onChange={(event) => updateSetting(option.key, event.target.checked as never)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="min-w-0">
                    <span className="block font-black text-slate-900">{option.label}</span>
                    <span className="mt-1 block text-sm leading-5 text-slate-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-lg font-black text-slate-950">Rullande banner</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tickerOptions.map(option => (
                <label key={option.key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(settings[option.key])}
                    onChange={(event) => updateSetting(option.key, event.target.checked as never)}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                  {option.label}
                </label>
              ))}
            </div>

            <div className="mt-5">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-black text-slate-900">Egna texter</h3>
                  <p className="text-sm text-slate-500">Skriv flera punkter som ska rulla tillsammans med valda automatiska värden.</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => updateSetting('customTickerItems', [...settings.customTickerItems, ''])}
                >
                  <Plus className="h-4 w-4" />
                  Lägg till
                </Button>
              </div>

              <div className="space-y-2">
                {settings.customTickerItems.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
                    Inga egna texter ännu.
                  </div>
                )}

                {settings.customTickerItems.map((item, index) => (
                  <div key={index} className="flex min-w-0 gap-2">
                    <Input
                      value={item}
                      onChange={(event) => updateTickerItem(index, event.target.value)}
                      placeholder="Ex. Välkommen till VI-HEM"
                      className="min-w-0"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateSetting('customTickerItems', settings.customTickerItems.filter((_, itemIndex) => itemIndex !== index))}
                      className="self-start"
                      aria-label="Ta bort text"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
