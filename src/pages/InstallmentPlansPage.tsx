// Standalone home for avbetalningsplaner, split out of Ekonomi V2 (beta) --
// that page is framed around the Accounted integration (you need a company
// with an Accounted link before you can see anything there at all), but
// installment plans track payment of already-existing debt and have
// nothing to do with Accounted. Reuses the same InstallmentPlansPanel and
// the same read helpers Ekonomi V2 used, just without the Accounted
// company-link gate around it.
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { InstallmentPlansPanel } from '../components/InstallmentPlansPanel';
import { Card, EmptyState, LoadingPage, PageHeader } from '../components/ui';
import {
  listCompaniesForInstallmentPlans,
  listFinanceCustomersForInstallmentPlans,
  listLegacyInvoicesForInstallmentPlans,
} from '../modules/finance-v2/api';
import type { FinanceCompany, FinanceCustomer, Invoice } from '../types';
import { Landmark, ReceiptText } from 'lucide-react';

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Ett oväntat fel inträffade.';
}

export function InstallmentPlansPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<FinanceCompany[]>([]);
  const [customers, setCustomers] = useState<FinanceCustomer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const organisationId = user?.organisation_id;
    if (!organisationId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      listCompaniesForInstallmentPlans(organisationId),
      listFinanceCustomersForInstallmentPlans(organisationId),
      listLegacyInvoicesForInstallmentPlans(organisationId),
    ])
      .then(([companyData, customerData, invoiceData]) => {
        if (cancelled) return;
        setCompanies(companyData);
        setCustomers(customerData);
        setInvoices(invoiceData);
      })
      .catch((err) => { if (!cancelled) setError(describeError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.organisation_id]);

  if (loading) return <LoadingPage />;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        icon={ReceiptText}
        title="Avbetalningsplaner"
        subtitle="Administrativ uppföljning av skuld, delbetalningar och betalningsplaner."
      />
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {companies.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={Landmark}
            title="Inga bolag ännu"
            description="Skapa ett bolag under Ekonomi innan avbetalningsplaner kan sättas upp."
          />
        </Card>
      ) : (
        <div className="mt-4">
          <InstallmentPlansPanel
            organisationId={user?.organisation_id ?? ''}
            companies={companies}
            customers={customers}
            invoices={invoices}
            userId={user?.id ?? ''}
          />
        </div>
      )}
    </div>
  );
}
