// Shared "resolve or create an Accounted customer" logic. Used by the
// standalone vihem-accounted-customers function AND by batch callers (rent
// billing, future customer-project billing) so both paths share one
// idempotency/error-handling implementation instead of drifting apart.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createAccountedClient, deriveIdempotencyKey } from "./accounted-rest-client.ts";

export const ACCOUNTED_CUSTOMER_SOURCE_TYPES = [
  "tenancy",
  "finance_customer",
  "customer_project_customer",
  "short_stay_guest",
] as const;
export type AccountedCustomerSourceType = (typeof ACCOUNTED_CUSTOMER_SOURCE_TYPES)[number];

export interface VihemCustomerInput {
  name: string;
  customer_type?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  country_code?: string;
  organisation_number?: string;
  personal_number?: string;
  payment_terms_days?: number;
}

export interface CompanyLinkForAccounted {
  id: string;
  organisation_id: string;
  accounted_base_url: string;
  accounted_company_id: string;
}

function mapCustomerType(vihemType: string | undefined): "individual" | "swedish_business" | "eu_business" | "non_eu_business" {
  switch (vihemType) {
    case "private":
      return "individual";
    case "company":
    case "brf":
    case "property_owner":
    case "internal":
    default:
      return "swedish_business";
  }
}

export interface CustomerLinkRow {
  id: string;
  accounted_customer_id: string;
  accounted_customer_number: string;
  sync_status: string;
  last_synced_at: string;
}

/**
 * Returns the existing customer link if one exists (fast path, no Accounted
 * call), otherwise creates the customer in Accounted and stores the mapping.
 * Idempotency-Key is derived from (company_link_id, source_type, source_id),
 * so retrying this after a network failure never risks a duplicate customer.
 */
export async function resolveOrCreateAccountedCustomer(
  adminClient: SupabaseClient,
  link: CompanyLinkForAccounted,
  apiKey: string,
  params: {
    sourceType: AccountedCustomerSourceType;
    sourceId: string;
    customer: VihemCustomerInput;
    dryRun?: boolean;
    createdBy: string;
  },
): Promise<CustomerLinkRow | { dry_run: true; preview: unknown }> {
  const { data: existing } = await adminClient
    .from("vihem_accounted_customer_links")
    .select("id, accounted_customer_id, accounted_customer_number, sync_status, last_synced_at")
    .eq("company_link_id", link.id)
    .eq("source_type", params.sourceType)
    .eq("source_id", params.sourceId)
    .maybeSingle();
  if (existing && !params.dryRun) return existing as CustomerLinkRow;

  const client = createAccountedClient({ baseUrl: link.accounted_base_url, apiKey });
  const idempotencyKey = await deriveIdempotencyKey(["customer", link.id, params.sourceType, params.sourceId]);
  const customer = params.customer;

  const accountedPayload = {
    name: customer.name,
    customer_type: mapCustomerType(customer.customer_type),
    email: customer.email || undefined,
    phone: customer.phone || undefined,
    address_line1: customer.address_line1 || undefined,
    address_line2: customer.address_line2 || undefined,
    postal_code: customer.postal_code || undefined,
    city: customer.city || undefined,
    country: customer.country_code || "SE",
    org_number: customer.customer_type !== "individual" ? (customer.organisation_number || undefined) : undefined,
    personal_number: customer.customer_type === "individual" ? (customer.personal_number || undefined) : undefined,
    default_payment_terms: customer.payment_terms_days || undefined,
  };

  if (params.dryRun) {
    const preview = await client.post(
      `/api/v1/companies/${encodeURIComponent(link.accounted_company_id)}/customers`,
      accountedPayload,
      { idempotencyKey, dryRun: true },
    );
    return { dry_run: true, preview };
  }

  const created = await client.post<{ id: string; customer_number?: string }>(
    `/api/v1/companies/${encodeURIComponent(link.accounted_company_id)}/customers`,
    accountedPayload,
    { idempotencyKey },
  );

  const { data: inserted, error: insertErr } = await adminClient
    .from("vihem_accounted_customer_links")
    .upsert(
      {
        organisation_id: link.organisation_id,
        company_link_id: link.id,
        source_type: params.sourceType,
        source_id: params.sourceId,
        accounted_customer_id: created.id,
        accounted_customer_number: created.customer_number || "",
        sync_status: "linked",
        last_synced_at: new Date().toISOString(),
        created_by: params.createdBy,
      },
      { onConflict: "company_link_id,source_type,source_id" },
    )
    .select("id, accounted_customer_id, accounted_customer_number, sync_status, last_synced_at")
    .single();
  if (insertErr) throw new Error(`Kunde inte spara kundkopplingen: ${insertErr.message}`);

  return inserted as CustomerLinkRow;
}
