// Shared "create the real invoice in Accounted from a VI-HEM billing source"
// logic. Used by the standalone vihem-accounted-invoices function AND by
// batch callers (rent billing today, customer-project billing later) so the
// idempotency/error-handling/link-write behaviour is identical everywhere an
// invoice gets created, not reimplemented per caller.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createAccountedClient, deriveIdempotencyKey } from "./accounted-rest-client.ts";
import type { CompanyLinkForAccounted } from "./accounted-customer-resolver.ts";

export const ACCOUNTED_INVOICE_SOURCE_TYPES = ["rental_billing", "customer_project", "manual_charge"] as const;
export type AccountedInvoiceSourceType = (typeof ACCOUNTED_INVOICE_SOURCE_TYPES)[number];

export interface AccountedInvoiceItemInput {
  description: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  vat_rate?: number;
}

export interface CreateAccountedInvoiceInput {
  accountedCustomerId: string;
  invoiceDate: string;
  dueDate: string;
  currency?: string;
  items: AccountedInvoiceItemInput[];
  yourReference?: string;
  ourReference?: string;
  notes?: string;
}

export interface InvoiceLinkRow {
  id: string;
  accounted_invoice_id: string;
  accounted_invoice_number: string | null;
  status: string;
  total: number | null;
  remaining_amount: number | null;
  invoice_date: string | null;
  due_date: string | null;
}

export type CreateAccountedInvoiceResult =
  | { already_invoiced: true; link: InvoiceLinkRow }
  | { dry_run: true; preview: unknown }
  | { created: true; link: InvoiceLinkRow };

/**
 * Creates an Accounted invoice for (company_link, source_type, source_id) if
 * one doesn't already exist. Idempotency-Key is derived from that triple, so
 * a retried call after a network failure can never create a duplicate
 * invoice -- either the local link already exists (checked first, no
 * Accounted call needed) or Accounted itself replays its cached response.
 */
export async function createAccountedInvoiceForSource(
  adminClient: SupabaseClient,
  link: CompanyLinkForAccounted,
  apiKey: string,
  params: {
    sourceType: AccountedInvoiceSourceType;
    sourceId: string;
    invoice: CreateAccountedInvoiceInput;
    dryRun?: boolean;
    createdBy: string;
  },
): Promise<CreateAccountedInvoiceResult> {
  const { data: existingLink } = await adminClient
    .from("vihem_accounted_invoice_links")
    .select("id, accounted_invoice_id, accounted_invoice_number, status, total, remaining_amount, invoice_date, due_date")
    .eq("company_link_id", link.id)
    .eq("source_type", params.sourceType)
    .eq("source_id", params.sourceId)
    .maybeSingle();
  if (existingLink && !params.dryRun) {
    return { already_invoiced: true, link: existingLink as InvoiceLinkRow };
  }

  const client = createAccountedClient({ baseUrl: link.accounted_base_url, apiKey });
  const idempotencyKey = await deriveIdempotencyKey(["invoice", link.id, params.sourceType, params.sourceId]);
  const inv = params.invoice;

  const accountedPayload = {
    customer_id: inv.accountedCustomerId,
    invoice_date: inv.invoiceDate,
    due_date: inv.dueDate,
    currency: inv.currency || "SEK",
    your_reference: inv.yourReference || undefined,
    our_reference: inv.ourReference || undefined,
    notes: inv.notes || undefined,
    items: inv.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || "st",
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
    })),
  };

  const result = await client.post<any>(
    `/api/v1/companies/${encodeURIComponent(link.accounted_company_id)}/invoices`,
    accountedPayload,
    { idempotencyKey, dryRun: params.dryRun },
  );

  if (params.dryRun) return { dry_run: true, preview: result };

  const { data: inserted, error: insertErr } = await adminClient
    .from("vihem_accounted_invoice_links")
    .upsert(
      {
        organisation_id: link.organisation_id,
        company_link_id: link.id,
        source_type: params.sourceType,
        source_id: params.sourceId,
        accounted_invoice_id: result.id,
        accounted_invoice_number: result.invoice_number,
        accounted_document_type: result.document_type || "invoice",
        status: result.status || "draft",
        currency: result.currency || "SEK",
        total: result.total,
        remaining_amount: result.remaining_amount,
        invoice_date: result.invoice_date,
        due_date: result.due_date,
        last_sync_source: "create",
        last_synced_at: new Date().toISOString(),
        created_by: params.createdBy,
      },
      { onConflict: "company_link_id,source_type,source_id" },
    )
    .select("id, accounted_invoice_id, accounted_invoice_number, status, total, remaining_amount, invoice_date, due_date")
    .single();
  if (insertErr) {
    // The invoice WAS created in Accounted; a local insert failure must not
    // look like nothing happened. Surface the Accounted id so an operator
    // can reconcile manually instead of silently losing track of it.
    throw new Error(
      `Fakturan skapades i Accounted (id ${result.id}) men kunde inte sparas lokalt: ${insertErr.message}`,
    );
  }

  return { created: true, link: inserted as InvoiceLinkRow };
}
