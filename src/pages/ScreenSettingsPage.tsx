import React, { useEffect, useState } from 'react';
import { Monitor, Plus, Save, Settings, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState, Input, LoadingPage, PageHeader, Select } from '../components/ui';
import {
  DEFAULT_SCREEN_KEY,
  normalizePresentationSettings,
  screenViewLabel,
  type PresentationSettings,
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
  const [screenView, setScreenView] = useState<ScreenView>('presentation');
  const [settings, setSettings] = useState<PresentationSettings>(() => normalizePresentationSettings({}));

  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

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

    const { data, error: fetchError } = await supabase
      .from('vihem_screen_settings')
      .select('screen_view, presentation_settings')
      .eq('organisation_id', user.organisation_id)
      .eq('screen_key', DEFAULT_SCREEN_KEY)
      .maybeSingle();

    if (fetchError) {
      setError(fetchError.message);
    } else if (data) {
      setScreenView(data.screen_view as ScreenView);
      setSettings(normalizePresentationSettings(data.presentation_settings));
    }

    setLoading(false);
  }

  function updateSetting<K extends keyof PresentationSettings>(key: K, value: PresentationSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function updateTickerItem(index: number, value: string) {
    setSettings(prev => {
      const nextItems = [...prev.customTickerItems];
      nextItems[index] = value;
      return { ...prev, customTickerItems: nextItems };
    });
  }

  async function saveSettings() {
    if (!user?.organisation_id || !canManage) return;

    setSaving(true);
    setError('');
    setSuccess('');

    const cleanedSettings: PresentationSettings = {
      ...settings,
      customTickerText: '',
      customTickerItems: settings.customTickerItems.map(item => item.trim()).filter(Boolean),
    };

    const now = new Date().toISOString();
    const { error: saveError } = await supabase
      .from('vihem_screen_settings')
      .upsert({
        organisation_id: user.organisation_id,
        screen_key: DEFAULT_SCREEN_KEY,
        screen_view: screenView,
        presentation_settings: cleanedSettings,
        created_by: user.id,
        updated_by: user.id,
        updated_at: now,
      }, { onConflict: 'organisation_id,screen_key' });

    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setSettings(cleanedSettings);
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
            <div className="mb-4 flex items-center gap-2">
              <Settings className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-black text-slate-950">Skärmläge</h2>
            </div>
            <Select
              label="Vad ska TV:n visa?"
              value={screenView}
              onChange={(event) => setScreenView(event.target.value as ScreenView)}
              options={[
                { value: 'presentation', label: screenViewLabel('presentation') },
                { value: 'short-stay', label: screenViewLabel('short-stay') },
                { value: 'work-orders', label: screenViewLabel('work-orders') },
              ]}
            />
            <p className="mt-3 text-sm leading-6 text-slate-500">
              När TV-skärmen är inloggad hämtar den det här valet automatiskt vid uppdatering.
            </p>
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
