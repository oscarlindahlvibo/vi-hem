import React, { useCallback, useEffect, useState } from 'react';
import { Bot, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, Input, Select, Textarea } from '../components/ui';

type OcrProviderSettings = {
  provider: 'google_vision' | 'none';
  enabled: boolean;
  has_openai_key: boolean;
  openai_key_hint: string;
  openai_key_rotated_at: string | null;
  has_google_vision_key: boolean;
  google_vision_key_hint: string;
  google_vision_key_rotated_at: string | null;
  ai_model: string;
  vision_model: string;
  min_text_length: number;
  min_confidence: number;
  enable_vision_fallback: boolean;
  last_tested_at: string | null;
  last_test_result: string;
  last_test_openai?: { ok?: boolean; message?: string } | null;
  last_test_google_vision?: { ok?: boolean; message?: string } | null;
};
type GoogleWorkspaceSettings = { has_service_account: boolean; service_account_hint: string; rotated_at: string | null };

const emptyOcrSettingsForm = {
  provider: 'google_vision' as 'google_vision' | 'none',
  enabled: true,
  openai_key: '',
  google_vision_key: '',
  ai_model: 'gpt-5-nano',
  vision_model: 'gpt-5-mini',
  min_text_length: '250',
  min_confidence: '0.72',
  enable_vision_fallback: true,
};

const emptyBankIdForm = {
  enabled: false,
  environment: 'test',
  login_enabled: false,
  signing_enabled: false,
  provider_note: '',
  api_user: '',
  password: '',
  company_api_guid: '',
};

const emptySmsForm = { enabled: false, sender: '' };

export function PlatformSettingsPage({ initialSection = 'ai', onNavigate }: { initialSection?: 'ai' | 'bankid' | 'cellsynth' | 'services' | 'google'; onNavigate?: (page: string) => void } = {}) {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<'ai' | 'bankid' | 'cellsynth' | 'services' | 'google'>(initialSection);
  const [ocrSettings, setOcrSettings] = useState<OcrProviderSettings | null>(null);
  const [ocrSettingsForm, setOcrSettingsForm] = useState(emptyOcrSettingsForm);
  const [ocrSettingsMessage, setOcrSettingsMessage] = useState('');
  const [bankIdForm, setBankIdForm] = useState(emptyBankIdForm);
  const [bankIdMessage, setBankIdMessage] = useState('');
  const [smsForm, setSmsForm] = useState(emptySmsForm);
  const [smsMessage, setSmsMessage] = useState('');
  const [googleSettings, setGoogleSettings] = useState<GoogleWorkspaceSettings | null>(null);
  const [googleJson, setGoogleJson] = useState('');
  const [googleMessage, setGoogleMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const organisationId = user?.organisation_id || '';

  const applyOcrSettings = useCallback((settings: OcrProviderSettings | null) => {
    setOcrSettings(settings);
    setOcrSettingsForm({
      provider: settings?.provider ?? 'google_vision',
      enabled: settings?.enabled ?? true,
      openai_key: '',
      google_vision_key: '',
      ai_model: settings?.ai_model || 'gpt-5-nano',
      vision_model: settings?.vision_model || 'gpt-5-mini',
      min_text_length: String(settings?.min_text_length ?? 250),
      min_confidence: String(settings?.min_confidence ?? 0.72),
      enable_vision_fallback: settings?.enable_vision_fallback ?? true,
    });
  }, []);

  const loadSettings = useCallback(async () => {
    if (!organisationId) return;
    setLoading(true);
    setOcrSettingsMessage('');
    setBankIdMessage('');
    setSmsMessage('');
    setGoogleMessage('');

    const [ocrResult, organisationResult, googleResult, bankIdResult] = await Promise.all([
      supabase.functions.invoke('vihem-manage-ocr-settings', { body: { action: 'get' } }),
      supabase
        .from('vihem_organisations')
        .select('settings')
        .eq('id', organisationId)
        .maybeSingle(),
      supabase.functions.invoke('vihem-manage-google-workspace-settings', { body: { action: 'get' } }),
      supabase.functions.invoke('vihem-bankid', { body: { action: 'get_settings' } }),
    ]);

    if (ocrResult.error) {
      setOcrSettingsMessage(ocrResult.error.message || 'Kunde inte hämta AI/OCR-inställningar.');
    } else {
      applyOcrSettings((ocrResult.data?.settings ?? null) as OcrProviderSettings | null);
    }

    const { data: smsSettings, error: smsError } = await supabase.from('vihem_sms_settings').select('enabled,sender').eq('organisation_id', organisationId).maybeSingle();
    setSmsForm({ enabled: Boolean(smsSettings?.enabled), sender: String(smsSettings?.sender || '') });
    if (!googleResult.error) {
      setGoogleSettings((googleResult.data?.settings ?? null) as GoogleWorkspaceSettings | null);
    } else {
      setGoogleMessage(googleResult.error.message || 'Kunde inte hämta Google Workspace-inställningar.');
    }
    if (smsError && !smsError.message.includes('schema cache')) setSmsMessage(smsError.message);

    if (bankIdResult.error) {
      setBankIdMessage(bankIdResult.error.message || 'Kunde inte hämta BankID-inställningar.');
    } else if (bankIdResult.data?.settings) {
      const settings = bankIdResult.data.settings;
      setBankIdForm(prev => ({ ...prev, enabled: Boolean(settings.enabled), environment: String(settings.environment || 'test'), login_enabled: Boolean(settings.login_enabled), signing_enabled: Boolean(settings.signing_enabled), provider_note: String(settings.provider_note || '') }));
    } else if (organisationResult.error) {
      setBankIdMessage(organisationResult.error.message || 'Kunde inte hämta organisationsinställningar.');
    } else {
      const settings = (organisationResult.data?.settings || {}) as Record<string, any>;
      const bankid = (settings.bankid || {}) as Record<string, any>;
      setBankIdForm({
        enabled: Boolean(bankid.enabled),
        environment: String(bankid.environment || 'test'),
        login_enabled: Boolean(bankid.login_enabled),
        signing_enabled: Boolean(bankid.signing_enabled),
        provider_note: String(bankid.provider_note || ''),
        api_user: '',
        password: '',
        company_api_guid: '',
      });
    }

    setLoading(false);
  }, [applyOcrSettings, organisationId]);

  const saveGoogleSettings = async () => {
    setSaving(true); setGoogleMessage('');
    const { data, error } = await supabase.functions.invoke('vihem-manage-google-workspace-settings', { body: { action: 'save', service_account_json: googleJson } });
    setSaving(false);
    if (error) { setGoogleMessage(data?.error || error.message || 'Kunde inte spara Google-kopplingen.'); return; }
    setGoogleSettings((data?.settings ?? null) as GoogleWorkspaceSettings | null); setGoogleJson(''); setGoogleMessage('Google service account är sparad krypterat.');
  };

  const deleteGoogleSettings = async () => {
    setSaving(true); setGoogleMessage('');
    const { error } = await supabase.functions.invoke('vihem-manage-google-workspace-settings', { body: { action: 'delete' } });
    setSaving(false); setGoogleMessage(error ? error.message : 'Google-kopplingen är borttagen.');
    if (!error) setGoogleSettings(null);
  };

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // The settings route is reused when a user switches between the admin
  // shortcut and a specific integration shortcut. Keep the selected tab in
  // sync with the route instead of only reading it during the first mount.
  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const saveOcrSettings = async () => {
    setSaving(true);
    setOcrSettingsMessage('');
    const { data, error } = await supabase.functions.invoke('vihem-manage-ocr-settings', {
      body: {
        action: 'save',
        provider: ocrSettingsForm.provider,
        enabled: ocrSettingsForm.enabled,
        openai_key: ocrSettingsForm.openai_key.trim(),
        google_vision_key: ocrSettingsForm.google_vision_key.trim(),
        ai_model: ocrSettingsForm.ai_model.trim(),
        vision_model: ocrSettingsForm.vision_model.trim(),
        min_text_length: Number(ocrSettingsForm.min_text_length || 250),
        min_confidence: Number(ocrSettingsForm.min_confidence || 0.72),
        enable_vision_fallback: ocrSettingsForm.enable_vision_fallback,
      },
    });
    setSaving(false);
    if (error) {
      setOcrSettingsMessage(await getFunctionErrorMessage(error, 'Kunde inte spara AI/OCR-inställningarna.'));
      return;
    }
    applyOcrSettings((data?.settings ?? null) as OcrProviderSettings | null);
    setOcrSettingsMessage('AI/OCR-kopplingen är sparad.');
  };

  const testOcrSettings = async () => {
    setSaving(true);
    setOcrSettingsMessage('');
    const { data, error } = await supabase.functions.invoke('vihem-manage-ocr-settings', {
      body: { action: 'test' },
    });
    setSaving(false);
    if (error) {
      setOcrSettingsMessage(await getFunctionErrorMessage(error, 'Testet misslyckades.'));
      return;
    }
    applyOcrSettings((data?.settings ?? null) as OcrProviderSettings | null);
    setOcrSettingsMessage(data?.ok ? 'Kopplingen fungerar.' : 'Kopplingen behöver kontrolleras.');
  };

  const deleteOcrSecret = async (deleteSecretName: 'openai' | 'google_vision') => {
    setSaving(true);
    setOcrSettingsMessage('');
    const { data, error } = await supabase.functions.invoke('vihem-manage-ocr-settings', {
      body: { action: 'delete_secret', delete_secret_name: deleteSecretName },
    });
    setSaving(false);
    if (error) {
      setOcrSettingsMessage(await getFunctionErrorMessage(error, 'Kunde inte ta bort nyckeln.'));
      return;
    }
    applyOcrSettings((data?.settings ?? null) as OcrProviderSettings | null);
    setOcrSettingsMessage('Nyckeln är borttagen.');
  };

  const saveBankIdSettings = async () => {
    if (!organisationId) return;
    setSaving(true);
    setBankIdMessage('');

    const { error: updateError } = await supabase.functions.invoke('vihem-bankid', { body: { action: 'save_settings', enabled: bankIdForm.enabled, environment: bankIdForm.environment, login_enabled: bankIdForm.login_enabled, signing_enabled: bankIdForm.signing_enabled, provider_note: bankIdForm.provider_note.trim(), api_user: bankIdForm.api_user.trim(), password: bankIdForm.password.trim(), company_api_guid: bankIdForm.company_api_guid.trim() } });

    setSaving(false);
    setBankIdMessage(updateError ? updateError.message : 'BankID-inställningarna är sparade krypterat.');
  };

  const saveSmsSettings = async () => {
    if (!organisationId) return;
    setSaving(true); setSmsMessage('');
    const { error } = await supabase.from('vihem_sms_settings').upsert({ organisation_id: organisationId, provider: 'cellsynt', enabled: smsForm.enabled, sender: smsForm.sender.trim(), updated_at: new Date().toISOString() }, { onConflict: 'organisation_id' });
    setSaving(false); setSmsMessage(error ? error.message : 'Cellsynt-inställningarna är sparade. API-nycklarna läggs som Supabase secrets.');
  };

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-24">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Inställningar</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Tilläggstjänster & automationer</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Samla nycklar, AI-modeller, BankID och andra externa tjänster på organisationsnivå. Modulerna använder sedan dessa inställningar utan att nycklar exponeras i frontend.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          ['ai', 'AI & OCR'],
          ['google', 'Google Workspace / E-post'],
          ['bankid', 'BankID'],
          ['cellsynth', 'Cellsynt SMS'],
          ['services', 'Tilläggstjänster'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSection(key as typeof activeSection)}
            className={[
              'whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition',
              activeSection === key ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setActiveSection('google')}
          className="flex min-w-0 items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-950">Google Workspace / E-post</span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              {googleSettings?.has_service_account ? `Ansluten (${googleSettings.service_account_hint})` : 'Ingen koppling sparad'}
            </span>
          </span>
          <Badge className={googleSettings?.has_service_account ? 'shrink-0 bg-emerald-50 text-emerald-700' : 'shrink-0 bg-amber-50 text-amber-700'}>
            {googleSettings?.has_service_account ? 'Aktiv' : 'Saknas'}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('cellsynth')}
          className="flex min-w-0 items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-950">Cellsynt SMS</span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              {smsForm.sender ? `Avsändare: ${smsForm.sender}` : 'Ingen avsändare konfigurerad'}
            </span>
          </span>
          <Badge className={smsForm.enabled ? 'shrink-0 bg-emerald-50 text-emerald-700' : 'shrink-0 bg-slate-100 text-slate-600'}>
            {smsForm.enabled ? 'Aktiv' : 'Avstängd'}
          </Badge>
        </button>
      </div>

      {activeSection === 'ai' && (
        <Card className="p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-950">AI/OCR-kopplingar</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                OpenAI och Google Vision används av kvitto- och fakturatolkning nu, och kan senare återanvändas av andra automationer.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className={ocrSettings?.has_openai_key ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                  OpenAI {ocrSettings?.has_openai_key ? `aktiv ${ocrSettings.openai_key_hint ? `(${ocrSettings.openai_key_hint})` : ''}` : 'saknas'}
                </Badge>
                <Badge className={ocrSettings?.has_google_vision_key ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                  Google Vision {ocrSettings?.has_google_vision_key ? `aktiv ${ocrSettings.google_vision_key_hint ? `(${ocrSettings.google_vision_key_hint})` : ''}` : 'saknas'}
                </Badge>
                <Badge className={ocrSettingsForm.enabled ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}>
                  {ocrSettingsForm.enabled ? 'Extern tolkning på' : 'Extern tolkning av'}
                </Badge>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={testOcrSettings} loading={saving}>Testa koppling</Button>
                <Button onClick={saveOcrSettings} loading={saving}>Spara koppling</Button>
              </div>
              {ocrSettingsMessage && (
                <p className={[
                  'rounded-xl px-3 py-2 text-sm font-semibold',
                  ocrSettingsMessage.toLowerCase().includes('kunde') || ocrSettingsMessage.toLowerCase().includes('misslyckades')
                    ? 'bg-red-50 text-red-700'
                    : 'bg-emerald-50 text-emerald-700',
                ].join(' ')}>
                  {ocrSettingsMessage}
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Select
              label="OCR-provider"
              value={ocrSettingsForm.provider}
              options={[
                { value: 'google_vision', label: 'Google Vision' },
                { value: 'none', label: 'Ingen extern OCR' },
              ]}
              onChange={event => setOcrSettingsForm(prev => ({ ...prev, provider: event.target.value as 'google_vision' | 'none' }))}
            />
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={ocrSettingsForm.enabled}
                onChange={event => setOcrSettingsForm(prev => ({ ...prev, enabled: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Tillåt extern OCR/AI för dokumenttolkning
            </label>
            <Input
              label="OpenAI API-nyckel"
              type="password"
              value={ocrSettingsForm.openai_key}
              placeholder={ocrSettings?.has_openai_key ? 'Nyckel finns sparad. Fyll bara i om den ska bytas.' : 'sk-...'}
              onChange={event => setOcrSettingsForm(prev => ({ ...prev, openai_key: event.target.value }))}
            />
            <Input
              label="Google Vision API-nyckel"
              type="password"
              value={ocrSettingsForm.google_vision_key}
              placeholder={ocrSettings?.has_google_vision_key ? 'Nyckel finns sparad. Fyll bara i om den ska bytas.' : 'AIza...'}
              onChange={event => setOcrSettingsForm(prev => ({ ...prev, google_vision_key: event.target.value }))}
            />
            <Input label="Billig AI-modell" value={ocrSettingsForm.ai_model} onChange={event => setOcrSettingsForm(prev => ({ ...prev, ai_model: event.target.value }))} />
            <Input label="Vision fallback-modell" value={ocrSettingsForm.vision_model} onChange={event => setOcrSettingsForm(prev => ({ ...prev, vision_model: event.target.value }))} />
            <Input label="Minsta PDF-text innan OCR" type="number" value={ocrSettingsForm.min_text_length} onChange={event => setOcrSettingsForm(prev => ({ ...prev, min_text_length: event.target.value }))} />
            <Input label="Minsta confidence före fallback" type="number" step="0.01" min="0" max="1" value={ocrSettingsForm.min_confidence} onChange={event => setOcrSettingsForm(prev => ({ ...prev, min_confidence: event.target.value }))} />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={ocrSettingsForm.enable_vision_fallback}
                onChange={event => setOcrSettingsForm(prev => ({ ...prev, enable_vision_fallback: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Använd dyrare visionmodell bara när billig pipeline inte räcker
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => deleteOcrSecret('openai')} disabled={!ocrSettings?.has_openai_key || saving}>Ta bort OpenAI-nyckel</Button>
              <Button variant="secondary" size="sm" onClick={() => deleteOcrSecret('google_vision')} disabled={!ocrSettings?.has_google_vision_key || saving}>Ta bort Google-nyckel</Button>
            </div>
          </div>

          {ocrSettings?.last_tested_at && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="grid gap-1">
                <p>Senast testad: {new Date(ocrSettings.last_tested_at).toLocaleString('sv-SE')}</p>
                {ocrSettings.last_test_openai?.message && <p>OpenAI: {ocrSettings.last_test_openai.message}</p>}
                {ocrSettings.last_test_google_vision?.message && <p>Google Vision: {ocrSettings.last_test_google_vision.message}</p>}
              </div>
            </div>
          )}
        </Card>
      )}

      {activeSection === 'google' && (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 text-blue-600" />
            <div>
              <h2 className="text-lg font-bold text-slate-950">Google Workspace / E-post</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Koppla godkända Workspace-mailboxar för read-only-sökning efter fakturor, kvitton och underlag. JSON-nyckeln krypteras och lagras server-side och visas aldrig igen i frontend.
              </p>
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                Gmail-integrationen använder endast <code>gmail.readonly</code>. Den kan inte skicka, radera, arkivera eller ändra e-post.
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 p-4">
                <p className="font-semibold text-slate-900">Service account</p>
                <p className="mt-1 text-sm text-slate-500">{googleSettings?.has_service_account ? `Sparad: ${googleSettings.service_account_hint}` : 'Ingen service account är sparad ännu.'}</p>
                <Textarea className="mt-3" label="Service account-JSON" value={googleJson} onChange={e => setGoogleJson(e.target.value)} placeholder="Klistra in hela JSON-filen från Google Cloud" />
                <div className="mt-3 flex flex-wrap gap-2"><Button onClick={saveGoogleSettings} loading={saving}>Spara krypterat</Button>{googleSettings?.has_service_account && <Button variant="secondary" onClick={deleteGoogleSettings} loading={saving}>Ta bort koppling</Button>}</div>
                {googleMessage && <p className="mt-3 text-sm font-semibold text-slate-700">{googleMessage}</p>}
              </div>
              <Button className="mt-4" onClick={() => onNavigate?.('mail-search')}>
                Öppna E-post & underlag
              </Button>
            </div>
          </div>
        </Card>
      )}

      {activeSection === 'bankid' && (
        <Card className="p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-950">BankID</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Grundinställningar för kommande BankID-inloggning och signering. Certifikat och hemligheter ska fortsatt hanteras server-side.
              </p>
            </div>
            <Button onClick={saveBankIdSettings} loading={saving}>Spara BankID</Button>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Select
              label="Miljö"
              value={bankIdForm.environment}
              options={[
                { value: 'test', label: 'Test' },
                { value: 'production', label: 'Produktion' },
              ]}
              onChange={event => setBankIdForm(prev => ({ ...prev, environment: event.target.value }))}
            />
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={bankIdForm.enabled} onChange={event => setBankIdForm(prev => ({ ...prev, enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
              BankID aktiverat för organisationen
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={bankIdForm.login_enabled} onChange={event => setBankIdForm(prev => ({ ...prev, login_enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
              Tillåt BankID-inloggning
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={bankIdForm.signing_enabled} onChange={event => setBankIdForm(prev => ({ ...prev, signing_enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
              Tillåt BankID-signering
            </label>
            <Input label="BankSignering API-användare" type="text" autoComplete="off" value={bankIdForm.api_user} onChange={event => setBankIdForm(prev => ({ ...prev, api_user: event.target.value }))} placeholder="Klistra in API-användare" />
            <Input label="BankSignering lösenord" type="password" autoComplete="new-password" value={bankIdForm.password} onChange={event => setBankIdForm(prev => ({ ...prev, password: event.target.value }))} placeholder="Klistra in lösenord" />
            <Input label="Company API GUID" type="password" autoComplete="new-password" value={bankIdForm.company_api_guid} onChange={event => setBankIdForm(prev => ({ ...prev, company_api_guid: event.target.value }))} placeholder="Klistra in Company API GUID" />
            <Textarea className="lg:col-span-2" label="Anteckning/provider" value={bankIdForm.provider_note} onChange={event => setBankIdForm(prev => ({ ...prev, provider_note: event.target.value }))} rows={3} />
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Nycklarna krypteras server-side och visas aldrig igen. Testmiljön använder BankSignerings test-API. Produktion kräver att servern har <code>BANKSIGN_PRODUCTION_SIGN_URL</code> och <code>BANKSIGN_PRODUCTION_COLLECT_URL</code> konfigurerade.
          </div>
          {bankIdMessage && <p className="mt-4 text-sm font-semibold text-slate-700">{bankIdMessage}</p>}
        </Card>
      )}

      {activeSection === 'cellsynth' && (
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">SMS-INTEGRATION</p>
          <h2 className="mt-2 text-lg font-bold text-slate-950">Cellsynt</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Aktivera SMS för organisationen och ange avsändarnamnet. Cellsynts användarnamn och lösenord hanteras som serverhemligheter och visas aldrig i appen.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Input label="Avsändare (max 11 tecken)" maxLength={11} value={smsForm.sender} onChange={event => setSmsForm(prev => ({ ...prev, sender: event.target.value }))} />
            <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 p-3 text-sm font-semibold"><input type="checkbox" checked={smsForm.enabled} onChange={event => setSmsForm(prev => ({ ...prev, enabled: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-blue-600" /> Tillåt SMS från VI-HEM</label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3"><Button onClick={saveSmsSettings} loading={saving}>Spara Cellsynt</Button>{smsMessage && <span className="text-sm font-semibold text-slate-600">{smsMessage}</span>}</div>
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Serverkonfiguration</p>
            <p className="mt-1">Sätt <code>CELLSYNT_USERNAME</code>, <code>CELLSYNT_PASSWORD</code> och valfritt <code>CELLSYNT_API_URL</code> som Supabase secrets. SMS skickas via Edge Function <code>vihem-send-sms</code>.</p>
          </div>
        </Card>
      )}

      {activeSection === 'services' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
          {[
            ['AI-automationer', 'Gemensam OpenAI-konfiguration för framtida sammanfattningar, mötesprotokoll, dokumenttolkning och förslag.', Sparkles],
            ['OCR och dokument', 'Leverantörsfakturor och kvitton använder samma pipeline och kostnadslogg.', KeyRound],
            ['BankID', 'Inloggning och signering styrs från BankID-sektionen när serverkopplingen är färdig.', ShieldCheck],
          ].map(([title, description, Icon]) => (
            <Card key={String(title)} className="p-5">
              <Icon className="h-6 w-6 text-blue-600" />
              <h3 className="mt-4 font-bold text-slate-950">{String(title)}</h3>
              <p className="mt-2 text-sm text-slate-500">{String(description)}</p>
            </Card>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: Response })?.context;
  if (context) {
    const payload = await context.clone().json().catch(() => null);
    if (payload?.error) return String(payload.error);
  }
  return (error as Error)?.message || fallback;
}
