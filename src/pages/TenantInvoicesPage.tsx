// Tenant portal invoice view. Accounted (self-hosted) is the source of
// truth for the real invoice, PDF, and payment status -- this page reads
// VI-HEM's synced local cache (vihem_accounted_invoice_links) for a fast
// list, and proxies the actual PDF through vihem-accounted-tenant-invoices
// (the Accounted API key never reaches the browser). See
// docs/accounted-v2-integration.md.
//
// Only rent invoices created via Finance V2 (src/modules/finance-v2) show
// up here -- there is no fallback to legacy vihem_invoices, since that path
// isn't linked to a tenant the way vihem_accounted_invoice_links is.
import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Badge, Card, EmptyState, LoadingPage, PageHeader } from '../components/ui';
import { formatCurrency, formatDate, saveOrShareFile } from '../lib/utils';
import { fetchMyInvoicePdfBlob, listMyRentInvoices } from '../modules/finance-v2/api';
import type { AccountedInvoiceLink } from '../modules/finance-v2/types';
import { FileText, Receipt } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  paid: 'Betald',
  partially_paid: 'Delvis betald',
  overdue: 'Förfallen',
  cancelled: 'Makulerad',
  credited: 'Krediterad',
};

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  sent: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-slate-100 text-slate-500',
  credited: 'bg-slate-100 text-slate-500',
  draft: 'bg-slate-100 text-slate-500',
};

export function TenantInvoicesPage() {
  const [invoices, setInvoices] = useState<AccountedInvoiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listMyRentInvoices();
      setInvoices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte läsa fakturor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenPdf = async (invoiceId: string, invoiceNumber: string) => {
    setOpeningId(invoiceId);
    setError('');
    try {
      const blob = await fetchMyInvoicePdfBlob(invoiceId);
      if (Capacitor.isNativePlatform()) {
        await saveOrShareFile(blob, `faktura-${invoiceNumber}.pdf`);
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        // Revoke after a delay rather than immediately: the new tab needs
        // the blob: URL to still be valid while it loads the PDF.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte öppna fakturan.');
    } finally {
      setOpeningId(null);
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="p-4 md:p-6">
      <PageHeader icon={Receipt} title="Mina fakturor" subtitle="Fakturor för din hyra, skickade via Accounted." />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {invoices.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="Inga fakturor ännu"
            description="Dina hyresfakturor visas här så snart de har skapats."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map((invoice) => (
            <Card key={invoice.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    {invoice.accounted_invoice_number || 'Faktura under förberedelse'}
                  </p>
                  <p className="text-sm text-slate-500">
                    {invoice.invoice_date ? `Fakturadatum ${formatDate(invoice.invoice_date)}` : ''}
                    {invoice.due_date ? ` · Förfaller ${formatDate(invoice.due_date)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-semibold text-slate-900">
                      {invoice.total !== null ? formatCurrency(invoice.total) : '–'}
                    </p>
                    {invoice.remaining_amount !== null && invoice.remaining_amount > 0 && invoice.status !== 'paid' && (
                      <p className="text-xs text-slate-500">Kvar att betala: {formatCurrency(invoice.remaining_amount)}</p>
                    )}
                  </div>
                  <Badge
                    text={STATUS_LABELS[invoice.status] ?? invoice.status}
                    className={STATUS_COLORS[invoice.status] ?? ''}
                  />
                  <button
                    type="button"
                    onClick={() => handleOpenPdf(invoice.id, invoice.accounted_invoice_number || invoice.id)}
                    disabled={openingId === invoice.id || !invoice.accounted_invoice_number}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    title={invoice.accounted_invoice_number ? 'Öppna PDF' : 'Fakturan är inte klar än'}
                  >
                    <FileText className="h-4 w-4" />
                    {openingId === invoice.id ? 'Öppnar…' : 'PDF'}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
