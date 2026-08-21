// Finance V2 -- built alongside the legacy FinancePage, not instead of it.
// Legacy FinancePage.tsx keeps handling all existing invoicing/accounting
// flows unchanged. This page is the foundation for the new architecture
// where Accounted (self-hosted) becomes the source of truth for the real
// customer invoice, and VI-HEM only computes what should be billed.
//
// This first stage only ships: company <-> Accounted linking (with
// connectivity test + webhook registration) and a read-only projection of
// invoices Finance V2 has created. Rent billing, adjustments, customer-
// project invoicing, portal sync and the scanner->Accounted bridge are
// deliberately not wired up yet -- see docs/accounted-v2-integration.md.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, PageHeader, Select } from '../../../components/ui';
import { formatCurrency, formatDateTime } from '../../../lib/utils';
import {
  AccountedIntegrationError,
  getCompanyLink,
  listInvoiceLinks,
  registerWebhooks,
  saveCompanyLink,
  testConnection,
} from '../api';
import type { AccountedCompanyLink, AccountedInvoiceLink } from '../types';
import { Landmark, Link2, ListChecks, RefreshCw, Sparkles } from 'lucide-react';

type VihemCompany = { id: string; name: string; legal_name: string };
type TabKey = 'overview' | 'company-link' | 'invoices' | 'upcoming';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Översikt' },
  { key: 'company-link', label: 'Bolagskoppling' },
  { key: 'invoices', label: 'Fakturor' },
  { key: 'upcoming', label: 'Kommande' },
];

const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  paid: 'Betald',
  partially_paid: 'Delvis betald',
  overdue: 'Förfallen',
  cancelled: 'Makulerad',
  credited: 'Krediterad',
};

export function FinanceV2Page() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('overview');
  const [companies, setCompanies] = useState<VihemCompany[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [companyLink, setCompanyLink] = useState<AccountedCompanyLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCompanies = useCallback(async () => {
    if (!user?.organisation_id) return;
    setLoading(true);
    setError('');
    const { data, error: fetchError } = await supabase
      .from('vihem_companies')
      .select('id, name, legal_name')
      .eq('organisation_id', user.organisation_id)
      .order('name', { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }
    setCompanies(data ?? []);
    if (data?.length && !companyId) setCompanyId(data[0].id);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organisation_id]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const loadCompanyLink = useCallback(async () => {
    if (!companyId) {
      setCompanyLink(null);
      return;
    }
    try {
      const link = await getCompanyLink(companyId);
      setCompanyLink(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte läsa bolagskopplingen.');
    }
  }, [companyId]);

  useEffect(() => {
    loadCompanyLink();
  }, [loadCompanyLink]);

  if (loading) return <LoadingPage />;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        icon={Landmark}
        title="Ekonomi V2 (beta)"
        subtitle="Grunden för Accounted-integrationen. Fakturering, avdrag/tillägg och underlag hanteras fortfarande i Ekonomi (legacy) tills de flyttas hit."
      />

      {companies.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={Landmark}
            title="Inga bolag ännu"
            description="Skapa ett bolag under Ekonomi (legacy) innan Accounted-kopplingen kan sättas upp."
          />
        </Card>
      ) : (
        <>
          <div className="mt-4 max-w-xs">
            <Select
              label="Bolag"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === 'overview' && <OverviewTab companyLink={companyLink} />}
            {tab === 'company-link' && (
              <CompanyLinkTab companyId={companyId} companyLink={companyLink} onSaved={loadCompanyLink} />
            )}
            {tab === 'invoices' && <InvoicesTab companyLink={companyLink} />}
            {tab === 'upcoming' && <UpcomingTab />}
          </div>
        </>
      )}
    </div>
  );
}

function OverviewTab({ companyLink }: { companyLink: AccountedCompanyLink | null }) {
  if (!companyLink) {
    return (
      <Card>
        <EmptyState
          icon={Link2}
          title="Ingen Accounted-koppling ännu"
          description="Gå till fliken Bolagskoppling för att koppla bolaget mot en självhostad Accounted-instans."
        />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <p className="text-xs font-medium uppercase text-slate-500">Status</p>
        <div className="mt-2">
          <Badge
            text={companyLink.enabled ? 'Aktiverad' : 'Inaktiverad'}
            className={companyLink.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}
          />
        </div>
      </Card>
      <Card>
        <p className="text-xs font-medium uppercase text-slate-500">Senaste hälsokontroll</p>
        <p className="mt-2 text-sm text-slate-700">
          {companyLink.last_health_status === 'ok' ? 'OK' : companyLink.last_health_status === 'error' ? 'Fel' : 'Ej testad'}
        </p>
        {companyLink.last_health_check_at && (
          <p className="mt-1 text-xs text-slate-400">{formatDateTime(companyLink.last_health_check_at)}</p>
        )}
      </Card>
      <Card>
        <p className="text-xs font-medium uppercase text-slate-500">Accounted company-id</p>
        <p className="mt-2 break-all text-sm text-slate-700">{companyLink.accounted_company_id}</p>
      </Card>
    </div>
  );
}

function CompanyLinkTab({
  companyId,
  companyLink,
  onSaved,
}: {
  companyId: string;
  companyLink: AccountedCompanyLink | null;
  onSaved: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(companyLink?.accounted_base_url ?? '');
  const [accountedCompanyId, setAccountedCompanyId] = useState(companyLink?.accounted_company_id ?? '');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(companyLink?.enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setBaseUrl(companyLink?.accounted_base_url ?? '');
    setAccountedCompanyId(companyLink?.accounted_company_id ?? '');
    setEnabled(companyLink?.enabled ?? false);
  }, [companyLink]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setErrorMessage('');
    try {
      await saveCompanyLink({
        companyId,
        accountedBaseUrl: baseUrl.trim(),
        accountedCompanyId: accountedCompanyId.trim(),
        apiKey: apiKey.trim() || undefined,
        enabled,
      });
      setApiKey('');
      setMessage('Bolagskopplingen sparades.');
      onSaved();
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage('');
    setErrorMessage('');
    try {
      await testConnection(companyId);
      setMessage('Anslutningen till Accounted fungerar.');
      onSaved();
    } catch (err) {
      setErrorMessage(describeError(err));
      onSaved();
    } finally {
      setTesting(false);
    }
  };

  const handleRegisterWebhooks = async () => {
    setRegistering(true);
    setMessage('');
    setErrorMessage('');
    try {
      const results = await registerWebhooks(companyId);
      const failed = Object.entries(results).filter(([, r]) => !r.ok);
      if (failed.length === 0) {
        setMessage('Webhook-prenumerationerna är registrerade.');
      } else {
        setErrorMessage(`Vissa webhooks kunde inte registreras: ${failed.map(([k]) => k).join(', ')}`);
      }
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setRegistering(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <div className="space-y-4">
        <Input
          label="Accounted API-bas-URL"
          placeholder="https://accounted.example.se"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          hint="Den självhostade Accounted-instansens publika URL, utan avslutande snedstreck."
        />
        <Input
          label="Accounted company-id"
          value={accountedCompanyId}
          onChange={(e) => setAccountedCompanyId(e.target.value)}
          hint="Hittas i Accounted under bolagets inställningar."
        />
        <Input
          label="Accounted API-nyckel"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={companyLink ? 'Lämna tomt för att behålla nuvarande nyckel' : 'gnubok_sk_...'}
          hint="Skapas i Accounted under Inställningar > API. Ge nyckeln minsta möjliga scope (companies:read, customers:read/write, invoices:read/write, documents:write, webhooks:manage)."
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Aktivera kopplingen (tillåt att fakturor skapas mot Accounted)
        </label>

        {message && <p className="text-sm text-green-700">{message}</p>}
        {errorMessage && <p className="text-sm text-red-700">{errorMessage}</p>}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={handleSave} loading={saving}>
            Spara
          </Button>
          <Button variant="secondary" onClick={handleTest} loading={testing} disabled={!companyLink}>
            Testa anslutning
          </Button>
          <Button variant="secondary" onClick={handleRegisterWebhooks} loading={registering} disabled={!companyLink}>
            Registrera webhooks
          </Button>
        </div>
      </div>
    </Card>
  );
}

function InvoicesTab({ companyLink }: { companyLink: AccountedCompanyLink | null }) {
  const [invoices, setInvoices] = useState<AccountedInvoiceLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!companyLink) {
      setInvoices([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await listInvoiceLinks(companyLink.id);
      setInvoices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte läsa fakturor.');
    } finally {
      setLoading(false);
    }
  }, [companyLink]);

  useEffect(() => {
    load();
  }, [load]);

  if (!companyLink) {
    return (
      <Card>
        <EmptyState icon={ListChecks} title="Koppla bolaget först" description="Fakturor visas här när bolaget är kopplat till Accounted." />
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Fakturor skapade via Finance V2</p>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Uppdatera
        </Button>
      </div>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {invoices.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Inga fakturor ännu"
          description="Rent- och kundprojektfakturering mot Accounted är inte kopplat in i det här steget."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                <th className="py-2 pr-4">Fakturanr</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Belopp</th>
                <th className="py-2 pr-4">Kvar att betala</th>
                <th className="py-2 pr-4">Senast synkad</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4">{inv.accounted_invoice_number || '(utkast)'}</td>
                  <td className="py-2 pr-4">
                    <Badge text={INVOICE_STATUS_LABELS[inv.status] ?? inv.status} />
                  </td>
                  <td className="py-2 pr-4">{inv.total !== null ? formatCurrency(inv.total) : '–'}</td>
                  <td className="py-2 pr-4">{inv.remaining_amount !== null ? formatCurrency(inv.remaining_amount) : '–'}</td>
                  <td className="py-2 pr-4 text-slate-500">{formatDateTime(inv.last_synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function UpcomingTab() {
  return (
    <Card>
      <EmptyState
        icon={Sparkles}
        title="Kommande i Finance V2"
        description="Hyresfakturering, avdrag & tillägg, kundprojektfakturering, hyresgästportalens fakturavy och scanner → Accounted byggs stegvis ovanpå den här grunden. Avbetalningsplaner hanteras tills vidare i Ekonomi (legacy)."
      />
    </Card>
  );
}

function describeError(err: unknown): string {
  if (err instanceof AccountedIntegrationError) {
    return err.recoveryHint ? `${err.message} (${err.recoveryHint})` : `${err.message} [${err.code}]`;
  }
  return err instanceof Error ? err.message : 'Okänt fel.';
}
