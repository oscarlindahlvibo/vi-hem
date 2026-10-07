import type { AccountedInvoiceLink } from '../finance-v2/types';
import type { RentTenancy, RentChange, RentItem, RentPreviewRow } from '../../../supabase/functions/_shared/rent-overview';
export type { RentTenancy, RentChange, RentItem, RentPreviewRow };
export type RentTab = 'customers' | 'adjustments' | 'billing';
export interface RentCustomer { id: string; company_id: string | null; customer_type: string; name: string; email: string; phone: string; invoice_email: string; active: boolean; }
export interface RentInvoice { id: string; customer_id: string | null; tenancy_id: string | null; invoice_number: string | null; invoice_date: string; due_date: string; currency: string; status: string; payment_status: string; total_amount: number; paid_amount: number; balance_due: number | null; source_type: string; source_id?: string | null; original_invoice_id?: string | null; }
export interface RentOverview {
  companyId: string; period: string; fetchedAt: string;
  companyLink: { id: string; enabled: boolean } | null;
  tenancies: RentTenancy[]; customers: RentCustomer[]; invoices: RentInvoice[]; items: RentItem[];
  rentChanges: RentChange[]; billingChanges: RentChange[]; preview: RentPreviewRow[];
  accountedInvoices: AccountedInvoiceLink[];
  customerLinks: { source_type: string; source_id: string; accounted_customer_id: string }[];
  runs: { id: string; rent_period: string; status: string; due_date: string }[];
}
