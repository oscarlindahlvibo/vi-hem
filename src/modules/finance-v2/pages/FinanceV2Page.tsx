// Finance V2 -- built alongside the legacy FinancePage, not instead of it.
// Legacy FinancePage.tsx keeps handling all existing invoicing/accounting
// flows unchanged. This page is the foundation for the new architecture
// where Accounted (self-hosted) becomes the source of truth for the real
// customer invoice, and VI-HEM only computes what should be billed.
//
// This stage ships: company <-> Accounted linking (with connectivity test +
// webhook registration), a read-only projection of invoices Finance V2 has
// created, rent billing, customer-project billing, and a general-purpose
// avdrag & tillägg module (currently wired into rent billing only -- see
// docs/accounted-v2-integration.md). Portal sync and the scanner->Accounted
// bridge are deliberately not wired up yet.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select } from '../../../components/ui';
import { formatCurrency, formatDate, formatDateTime } from '../../../lib/utils';
import {
  AccountedIntegrationError,
  createBillingAdjustment,
  createOrGetRentBillingRun,
  createProjectBasisInvoice,
  createRentBillingInvoices,
  forwardScannedDocument,
  getCompanyLink,
  listActiveTenancies,
  listBillingAdjustmentApplications,
  listBillingAdjustments,
  listInvoiceableProjectBases,
  listInvoiceLinks,
  listRentBillingItems,
  listScannerUploads,
  registerWebhooks,
  saveCompanyLink,
  testConnection,
  updateBillingAdjustmentStatus,
} from '../api';
import type {
  AccountedCompanyLink,
  AccountedInvoiceLink,
  AccountedScannerUpload,
  BillingAdjustment,
  BillingAdjustmentApplication,
  BillingAdjustmentKind,
  ProjectInvoiceBasis,
  RentBillingItem,
  RentBillingItemResult,
  RentBillingRun,
  TenancyOption,
} from '../types';
import { Briefcase, CalendarClock, Landmark, Link2, ListChecks, MinusCircle, RefreshCw, ScanLine, Sparkles, Upload } from 'lucide-react';

type VihemCompany = { id: string; name: string; legal_name: string };
type TabKey = 'overview' | 'company-link' | 'billing' | 'project-billing' | 'adjustments' | 'scanner' | 'invoices' | 'upcoming';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Översikt' },
  { key: 'company-link', label: 'Bolagskoppling' },
  { key: 'billing', label: 'Fakturering' },
  { key: 'project-billing', label: 'Kundprojekt' },
  { key: 'adjustments', label: 'Avdrag & tillägg' },
  { key: 'scanner', label: 'Underlag' },
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
            {tab === 'billing' && <RentBillingTab companyId={companyId} companyLink={companyLink} />}
            {tab === 'project-billing' && <ProjectBillingTab companyId={companyId} companyLink={companyLink} />}
            {tab === 'adjustments' && <AdjustmentsTab companyId={companyId} />}
            {tab === 'scanner' && (
              <ScannerTab organisationId={user?.organisation_id ?? ''} companyId={companyId} companyLink={companyLink} />
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
  const [invoiceInboxEmail, setInvoiceInboxEmail] = useState(companyLink?.settings?.invoice_inbox_email ?? '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setBaseUrl(companyLink?.accounted_base_url ?? '');
    setAccountedCompanyId(companyLink?.accounted_company_id ?? '');
    setEnabled(companyLink?.enabled ?? false);
    setInvoiceInboxEmail(companyLink?.settings?.invoice_inbox_email ?? '');
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
        invoiceInboxEmail: invoiceInboxEmail.trim(),
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
        <Input
          label="Accounted invoice-inbox e-post (valfritt)"
          type="email"
          value={invoiceInboxEmail}
          onChange={(e) => setInvoiceInboxEmail(e.target.value)}
          placeholder="bolag-xxxx@inbox.accounted.example"
          hint="Bolagets unika inkorgsadress i Accounted (Inställningar > Dokumentinkorg). Krävs för fliken Underlag."
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

const RENT_ITEM_STATUS_LABELS: Record<string, string> = {
  draft: 'Ej fakturerad',
  invoiced: 'Fakturerad',
  skipped: 'Överhoppad',
  cancelled: 'Makulerad',
};

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function RentBillingTab({ companyId, companyLink }: { companyId: string; companyLink: AccountedCompanyLink | null }) {
  const [rentPeriod, setRentPeriod] = useState(currentMonthValue());
  const [run, setRun] = useState<RentBillingRun | null>(null);
  const [items, setItems] = useState<RentBillingItem[]>([]);
  const [itemResults, setItemResults] = useState<Record<string, RentBillingItemResult>>({});
  const [loadingRun, setLoadingRun] = useState(false);
  const [creatingInvoices, setCreatingInvoices] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const loadItems = useCallback(async (runId: string) => {
    const data = await listRentBillingItems(runId);
    setItems(data);
  }, []);

  const handleCreateRun = async () => {
    setLoadingRun(true);
    setMessage('');
    setErrorMessage('');
    setItemResults({});
    try {
      const createdRun = await createOrGetRentBillingRun(companyId, rentPeriod);
      setRun(createdRun);
      await loadItems(createdRun.id);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setLoadingRun(false);
    }
  };

  const handleCreateInvoices = async (dryRun: boolean) => {
    if (!run) return;
    setCreatingInvoices(true);
    setMessage('');
    setErrorMessage('');
    try {
      const outcome = await createRentBillingInvoices({ companyId, runId: run.id, dryRun });
      const byItem: Record<string, RentBillingItemResult> = {};
      outcome.results.forEach((r) => { byItem[r.item_id] = r; });
      setItemResults(byItem);
      if (dryRun) {
        setMessage(`Förhandsgranskning klar: ${outcome.summary.succeeded} av ${outcome.summary.total} rader kan faktureras.`);
      } else {
        setMessage(`${outcome.summary.succeeded} av ${outcome.summary.total} fakturor skapade i Accounted.`);
        await loadItems(run.id);
      }
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setCreatingInvoices(false);
    }
  };

  const invoiceableCount = items.filter((i) => i.status === 'draft' && !i.accounted_invoice_link_id && !i.invoice_id).length;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Hyresperiod"
            type="month"
            value={rentPeriod.slice(0, 7)}
            onChange={(e) => setRentPeriod(`${e.target.value}-01`)}
          />
          <Button onClick={handleCreateRun} loading={loadingRun} disabled={!companyLink}>
            Hämta/skapa körning
          </Button>
          {run && invoiceableCount > 0 && (
            <>
              <Button
                variant="secondary"
                onClick={() => handleCreateInvoices(true)}
                loading={creatingInvoices}
                disabled={!companyLink?.enabled}
              >
                Förhandsgranska mot Accounted (dry-run)
              </Button>
              <Button onClick={() => handleCreateInvoices(false)} loading={creatingInvoices} disabled={!companyLink?.enabled}>
                Skapa fakturor i Accounted
              </Button>
            </>
          )}
        </div>
        {!companyLink && (
          <p className="mt-3 text-sm text-slate-500">Koppla bolaget mot Accounted under Bolagskoppling innan fakturor kan skapas.</p>
        )}
        {companyLink && !companyLink.enabled && (
          <p className="mt-3 text-sm text-amber-700">Accounted-kopplingen är inaktiverad — aktivera den under Bolagskoppling för att kunna skapa fakturor.</p>
        )}
        {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
        {errorMessage && <p className="mt-3 text-sm text-red-700">{errorMessage}</p>}
      </Card>

      {run && (
        <Card>
          {items.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Inga hyresrader" description="Inga aktiva hyresförhållanden matchade perioden, eller alla är redan fakturerade." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                    <th className="py-2 pr-4">Hyresgäst</th>
                    <th className="py-2 pr-4">Grundhyra</th>
                    <th className="py-2 pr-4">Justering</th>
                    <th className="py-2 pr-4">Att fakturera</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Resultat</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const result = itemResults[item.id];
                    return (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="py-2 pr-4">{item.tenant?.name ?? '–'}</td>
                        <td className="py-2 pr-4">{formatCurrency(item.base_rent_amount)}</td>
                        <td className="py-2 pr-4">{item.adjustment_amount !== 0 ? formatCurrency(item.adjustment_amount) : '–'}</td>
                        <td className="py-2 pr-4 font-medium">{formatCurrency(item.total_amount)}</td>
                        <td className="py-2 pr-4">
                          <Badge text={RENT_ITEM_STATUS_LABELS[item.status] ?? item.status} />
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {result?.ok && result.dry_run && <span className="text-blue-700">Kan faktureras</span>}
                          {result?.ok && !result.dry_run && <span className="text-green-700">Skapad</span>}
                          {result && !result.ok && <span className="text-red-700">{result.error?.message}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ProjectBillingTab({ companyId, companyLink }: { companyId: string; companyLink: AccountedCompanyLink | null }) {
  const [bases, setBases] = useState<ProjectInvoiceBasis[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const data = await listInvoiceableProjectBases(companyId);
      setBases(data);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (basisId: string, dryRun: boolean) => {
    setBusyId(basisId);
    setRowMessages((prev) => ({ ...prev, [basisId]: undefined as any }));
    try {
      await createProjectBasisInvoice({ companyId, basisId, dryRun });
      setRowMessages((prev) => ({
        ...prev,
        [basisId]: { ok: true, text: dryRun ? 'Kan faktureras' : 'Faktura skapad i Accounted' },
      }));
      if (!dryRun) await load();
    } catch (err) {
      setRowMessages((prev) => ({ ...prev, [basisId]: { ok: false, text: describeError(err) } }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Fakturaunderlag redo att fakturera</p>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Uppdatera
        </Button>
      </div>
      {!companyLink && <p className="mb-3 text-sm text-slate-500">Koppla bolaget mot Accounted under Bolagskoppling innan fakturor kan skapas.</p>}
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {bases.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="Inga underlag väntar"
          description="Faktureringsunderlag skapas och markeras 'redo att fakturera' i Kundprojekt-sidan; de dyker upp här när de kan skickas till Accounted."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                <th className="py-2 pr-4">Projekt</th>
                <th className="py-2 pr-4">Underlag</th>
                <th className="py-2 pr-4">Belopp</th>
                <th className="py-2 pr-4">Resultat</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {bases.map((basis) => {
                const result = rowMessages[basis.id];
                return (
                  <tr key={basis.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{basis.project?.title || basis.project?.name || '–'}</td>
                    <td className="py-2 pr-4">{basis.title || basis.basis_number || '(utan titel)'}</td>
                    <td className="py-2 pr-4 font-medium">{formatCurrency(basis.total_amount + basis.vat_amount)}</td>
                    <td className="py-2 pr-4 text-xs">
                      {result && <span className={result.ok ? 'text-green-700' : 'text-red-700'}>{result.text}</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleAction(basis.id, true)}
                          loading={busyId === basis.id}
                          disabled={!companyLink?.enabled}
                        >
                          Förhandsgranska
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleAction(basis.id, false)}
                          loading={busyId === basis.id}
                          disabled={!companyLink?.enabled}
                        >
                          Skapa faktura
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type AdjustmentFilter = 'all' | 'active' | 'recurring' | 'upcoming' | 'paused' | 'completed';

const ADJUSTMENT_FILTERS: { key: AdjustmentFilter; label: string }[] = [
  { key: 'all', label: 'Alla' },
  { key: 'active', label: 'Aktiva' },
  { key: 'recurring', label: 'Återkommande' },
  { key: 'upcoming', label: 'Kommande' },
  { key: 'paused', label: 'Pausade' },
  { key: 'completed', label: 'Förbrukade/historik' },
];

function matchesAdjustmentFilter(adjustment: BillingAdjustment, filter: AdjustmentFilter): boolean {
  const today = new Date().toISOString().slice(0, 10);
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return adjustment.status === 'active';
    case 'recurring':
      return adjustment.adjustment_type === 'recurring' && adjustment.status !== 'cancelled';
    case 'upcoming':
      return adjustment.status === 'active' && adjustment.start_period > today;
    case 'paused':
      return adjustment.status === 'paused';
    case 'completed':
      return adjustment.status === 'completed';
    default:
      return true;
  }
}

function AdjustmentsTab({ companyId }: { companyId: string }) {
  const [adjustments, setAdjustments] = useState<BillingAdjustment[]>([]);
  const [applications, setApplications] = useState<BillingAdjustmentApplication[]>([]);
  const [tenancies, setTenancies] = useState<TenancyOption[]>([]);
  const [filter, setFilter] = useState<AdjustmentFilter>('active');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const [adjustmentData, tenancyData] = await Promise.all([
        listBillingAdjustments(companyId),
        listActiveTenancies(companyId),
      ]);
      setAdjustments(adjustmentData);
      setTenancies(tenancyData);
      const applicationData = await listBillingAdjustmentApplications(adjustmentData.map((a) => a.id));
      setApplications(applicationData);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const tenancyLabel = (tenancyId: string) => {
    const t = tenancies.find((x) => x.id === tenancyId);
    if (!t) return tenancyId.slice(0, 8);
    const apt = t.apartment?.apartment_number ? ` (lgh ${t.apartment.apartment_number})` : '';
    return `${t.tenant?.name ?? 'Okänd hyresgäst'}${apt}`;
  };

  const handleSetStatus = async (id: string, status: 'active' | 'paused' | 'cancelled') => {
    setBusyId(id);
    try {
      await updateBillingAdjustmentStatus({ companyId, id, status });
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = adjustments.filter((a) => matchesAdjustmentFilter(a, filter));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {ADJUSTMENT_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={load} loading={loading}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Uppdatera
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={tenancies.length === 0}>
              + Nytt avdrag/tillägg
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </Card>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={MinusCircle}
            title="Inga poster"
            description="Avdrag och tillägg som skapas här inkluderas automatiskt nästa gång hyresgästens hyra faktureras via Accounted."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="py-2 pr-4">Hyresgäst</th>
                  <th className="py-2 pr-4">Beskrivning</th>
                  <th className="py-2 pr-4">Belopp</th>
                  <th className="py-2 pr-4">Typ</th>
                  <th className="py-2 pr-4">Period</th>
                  <th className="py-2 pr-4">Använt</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((adjustment) => (
                  <tr key={adjustment.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{adjustment.target_type === 'tenancy' ? tenancyLabel(adjustment.target_id) : adjustment.target_id.slice(0, 8)}</td>
                    <td className="py-2 pr-4">{adjustment.description || '–'}</td>
                    <td className={`py-2 pr-4 font-medium ${adjustment.amount < 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {adjustment.amount > 0 ? '+' : ''}{formatCurrency(adjustment.amount)}
                    </td>
                    <td className="py-2 pr-4">{adjustment.adjustment_type === 'recurring' ? 'Återkommande' : 'Engångs'}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {formatDate(adjustment.start_period)}
                      {adjustment.end_period ? ` – ${formatDate(adjustment.end_period)}` : adjustment.adjustment_type === 'recurring' ? ' – tills vidare' : ''}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {adjustment.applied_count}{adjustment.max_occurrences ? ` / ${adjustment.max_occurrences}` : ''}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge text={ADJUSTMENT_STATUS_LABELS[adjustment.status] ?? adjustment.status} />
                    </td>
                    <td className="py-2 pr-4">
                      {adjustment.status === 'active' && (
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" loading={busyId === adjustment.id} onClick={() => handleSetStatus(adjustment.id, 'paused')}>
                            Pausa
                          </Button>
                          <Button variant="secondary" size="sm" loading={busyId === adjustment.id} onClick={() => handleSetStatus(adjustment.id, 'cancelled')}>
                            Avbryt
                          </Button>
                        </div>
                      )}
                      {adjustment.status === 'paused' && (
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" loading={busyId === adjustment.id} onClick={() => handleSetStatus(adjustment.id, 'active')}>
                            Aktivera
                          </Button>
                          <Button variant="secondary" size="sm" loading={busyId === adjustment.id} onClick={() => handleSetStatus(adjustment.id, 'cancelled')}>
                            Avbryt
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {filter === 'completed' && applications.length > 0 && (
        <Card>
          <p className="mb-3 text-sm font-medium text-slate-700">Historik: vad som faktiskt skickades till Accounted</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="py-2 pr-4">Period</th>
                  <th className="py-2 pr-4">Belopp</th>
                  <th className="py-2 pr-4">Använt av</th>
                  <th className="py-2 pr-4">Tidpunkt</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{app.billing_period ? formatDate(app.billing_period) : '–'}</td>
                    <td className="py-2 pr-4">{formatCurrency(app.amount)}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">{app.source_type} / {app.source_id.slice(0, 8)}</td>
                    <td className="py-2 pr-4 text-xs text-slate-500">{formatDateTime(app.applied_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateAdjustmentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        companyId={companyId}
        tenancies={tenancies}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
    </div>
  );
}

const ADJUSTMENT_STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  paused: 'Pausad',
  cancelled: 'Avbruten',
  completed: 'Förbrukad',
};

function CreateAdjustmentModal({
  open,
  onClose,
  companyId,
  tenancies,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  tenancies: TenancyOption[];
  onCreated: () => void;
}) {
  const [tenancyId, setTenancyId] = useState('');
  const [kind, setKind] = useState<BillingAdjustmentKind>('one_time');
  const [direction, setDirection] = useState<'deduction' | 'addition'>('deduction');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [startPeriod, setStartPeriod] = useState(new Date().toISOString().slice(0, 10));
  const [endPeriod, setEndPeriod] = useState('');
  const [maxOccurrences, setMaxOccurrences] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && tenancies.length > 0 && !tenancyId) setTenancyId(tenancies[0].id);
  }, [open, tenancies, tenancyId]);

  const handleSave = async () => {
    const parsedAmount = Number(amount.replace(',', '.'));
    if (!tenancyId) { setError('Välj en hyresgäst.'); return; }
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) { setError('Ange ett belopp skilt från 0.'); return; }

    setSaving(true);
    setError('');
    try {
      await createBillingAdjustment({
        companyId,
        targetType: 'tenancy',
        targetId: tenancyId,
        adjustmentType: kind,
        amount: direction === 'deduction' ? -Math.abs(parsedAmount) : Math.abs(parsedAmount),
        description,
        startPeriod,
        endPeriod: kind === 'recurring' && endPeriod ? endPeriod : null,
        maxOccurrences: kind === 'recurring' && maxOccurrences ? Number(maxOccurrences) : null,
      });
      setAmount('');
      setDescription('');
      onCreated();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nytt avdrag/tillägg">
      <div className="space-y-4">
        <Select
          label="Hyresgäst"
          value={tenancyId}
          onChange={(e) => setTenancyId(e.target.value)}
          options={tenancies.map((t) => ({
            value: t.id,
            label: `${t.tenant?.name ?? 'Okänd'}${t.apartment?.apartment_number ? ` (lgh ${t.apartment.apartment_number})` : ''}`,
          }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Typ"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'deduction' | 'addition')}
            options={[
              { value: 'deduction', label: 'Avdrag' },
              { value: 'addition', label: 'Tillägg' },
            ]}
          />
          <Select
            label="Frekvens"
            value={kind}
            onChange={(e) => setKind(e.target.value as BillingAdjustmentKind)}
            options={[
              { value: 'one_time', label: 'Engångs (nästa faktura)' },
              { value: 'recurring', label: 'Återkommande' },
            ]}
          />
        </div>
        <Input label="Belopp (kr)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="600" />
        <Input label="Anledning/beskrivning" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="T.ex. trasig diskmaskin" />
        <Input
          label={kind === 'recurring' ? 'Startperiod' : 'Tidigast (nästa faktura på eller efter detta datum)'}
          type="date"
          value={startPeriod}
          onChange={(e) => setStartPeriod(e.target.value)}
        />
        {kind === 'recurring' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Slutperiod (valfritt)" type="date" value={endPeriod} onChange={(e) => setEndPeriod(e.target.value)} />
            <Input
              label="Max antal tillfällen (valfritt)"
              inputMode="numeric"
              value={maxOccurrences}
              onChange={(e) => setMaxOccurrences(e.target.value)}
              placeholder="Obegränsat"
            />
          </div>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Avbryt</Button>
          <Button onClick={handleSave} loading={saving}>Skapa</Button>
        </div>
      </div>
    </Modal>
  );
}

const SCANNER_STATUS_LABELS: Record<string, string> = {
  queued: 'Skickas…',
  sent: 'Skickat till Accounted',
  failed: 'Misslyckades',
};

function ScannerTab({
  organisationId,
  companyId,
  companyLink,
}: {
  organisationId: string;
  companyId: string;
  companyLink: AccountedCompanyLink | null;
}) {
  const [uploads, setUploads] = useState<AccountedScannerUpload[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const invoiceInboxEmail = companyLink?.settings?.invoice_inbox_email;

  const load = useCallback(async () => {
    if (!companyLink) { setUploads([]); return; }
    setLoading(true);
    try {
      const data = await listScannerUploads(companyLink.id);
      setUploads(data);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [companyLink]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !organisationId) return;
    setSending(true);
    setMessage('');
    setError('');
    try {
      await forwardScannedDocument({ organisationId, companyId, file });
      setMessage(`"${file.name}" skickades till Accounted.`);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-700">Skicka underlag till Accounted</p>
            <p className="mt-1 text-sm text-slate-500">
              Scanna eller ladda upp ett foto/PDF på en leverantörsfaktura eller ett kvitto. Dokumentet mejlas
              vidare till bolagets Accounted-inkorg, som läser av det med AI och lägger det i granskningskön där.
              VI-HEM:s egen scanner/OCR (i Ekonomi legacy) påverkas inte.
            </p>
          </div>
          <ScanLine className="h-8 w-8 shrink-0 text-slate-300" />
        </div>

        {!companyLink && <p className="mt-3 text-sm text-slate-500">Koppla bolaget mot Accounted under Bolagskoppling först.</p>}
        {companyLink && !invoiceInboxEmail && (
          <p className="mt-3 text-sm text-amber-700">
            Ingen Accounted-inkorgsadress är sparad. Ange den under Bolagskoppling innan underlag kan skickas.
          </p>
        )}
        {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

        <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
          <Upload className="h-4 w-4" />
          {sending ? 'Skickar…' : 'Välj fil'}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            disabled={sending || !companyLink || !invoiceInboxEmail}
            onChange={handleFileSelected}
          />
        </label>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Skickade underlag</p>
          <Button variant="secondary" size="sm" onClick={load} loading={loading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Uppdatera
          </Button>
        </div>
        {uploads.length === 0 ? (
          <EmptyState icon={ScanLine} title="Inga underlag skickade än" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="py-2 pr-4">Fil</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Skickat</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((upload) => (
                  <tr key={upload.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{upload.file_name}</td>
                    <td className="py-2 pr-4">
                      <Badge text={SCANNER_STATUS_LABELS[upload.status] ?? upload.status} />
                      {upload.status === 'failed' && upload.error_message && (
                        <p className="mt-1 text-xs text-red-700">{upload.error_message}</p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {upload.sent_at ? formatDateTime(upload.sent_at) : formatDateTime(upload.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
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
        description="Avdrag & tillägg kan kopplas in för fler faktureringskällor än hyra och kundprojekt allteftersom de byggs. Avbetalningsplaner hanteras tills vidare i Ekonomi (legacy)."
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
