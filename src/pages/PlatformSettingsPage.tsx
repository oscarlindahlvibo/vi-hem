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
};

export function PlatformSettingsPage() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<'ai' | 'bankid' | 'services'>('ai');
  const [ocrSettings, setOcrSettings] = useState<OcrProviderSettings | null>(null);
  const [ocrSettingsForm, setOcrSettingsForm] = useState(emptyOcrSettingsForm);
  const [ocrSettingsMessage, setOcrSettingsMessage] = useState('');
  const [bankIdForm, setBankIdForm] = useState(emptyBankIdForm);
  const [bankIdMessage, setBankIdMessage] = useState('');
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

    const [ocrResult, organisationResult] = await Promise.all([
      supabase.functions.invoke('vihem-manage-ocr-settings', { body: { action: 'get' } }),
      supabase
        .from('vihem_organisations')
        .select('settings')
        .eq('id', organisationId)
        .maybeSingle(),
    ]);

    if (ocrResult.error) {
      setOcrSettingsMessage(ocrResult.error.message || 'Kunde inte hämta AI/OCR-inställningar.');
    } else {
      applyOcrSettings((ocrResult.data?.settings ?? null) as OcrProviderSettings | null);
    }

    if (organisationResult.error) {
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
      });
    }

    setLoading(false);
  }, [applyOcrSettings, organisationId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

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

    const { data: organisation, error: loadError } = await supabase
      .from('vihem_organisations')
      .select('settings')
      .eq('id', organisationId)
      .maybeSingle();

    if (loadError) {
      setBankIdMessage(loadError.message);
      setSaving(false);
      return;
    }

    const nextSettings = {
      ...((organisation?.settings || {}) as Record<string, unknown>),
      bankid: {
        enabled: bankIdForm.enabled,
        environment: bankIdForm.environment,
        login_enabled: bankIdForm.login_enabled,
        signing_enabled: bankIdForm.signing_enabled,
        provider_note: bankIdForm.provider_note.trim(),
        updated_at: new Date().toISOString(),
      },
    };

    const { error: updateError } = await supabase
      .from('vihem_organisations')
      .update({ settings: nextSettings })
      .eq('id', organisationId);

    setSaving(false);
    setBankIdMessage(updateError ? updateError.message : 'BankID-inställningarna är sparade.');
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
          ['bankid', 'BankID'],
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
            <Textarea className="lg:col-span-2" label="Anteckning/provider" value={bankIdForm.provider_note} onChange={event => setBankIdForm(prev => ({ ...prev, provider_note: event.target.value }))} rows={3} />
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Det här sparar organisationens val, men BankID kräver fortfarande edge function, RP-certifikat och serverhemligheter innan knapparna kan aktiveras i skarpt flöde.
          </div>
          {bankIdMessage && <p className="mt-4 text-sm font-semibold text-slate-700">{bankIdMessage}</p>}
        </Card>
      )}

      {activeSection === 'services' && (
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
