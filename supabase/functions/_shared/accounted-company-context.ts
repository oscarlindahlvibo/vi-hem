// Shared "load this company's Accounted link + decrypted API key" step.
// Every Accounted-integration function needs this before it can call
// Accounted at all; centralising it means the ACCOUNTED_NOT_LINKED /
// ACCOUNTED_LINK_DISABLED / ACCOUNTED_NO_API_KEY error codes stay consistent
// everywhere instead of being redefined per function.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptAccountedSecret } from "./accounted-crypto.ts";
import type { CompanyLinkForAccounted } from "./accounted-customer-resolver.ts";
import { createAccountedClient } from "./accounted-rest-client.ts";

export class AccountedContextError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountedContextError";
    this.code = code;
  }
}

export interface AccountedCompanyContext {
  link: CompanyLinkForAccounted & { enabled: boolean };
  apiKey: string;
}

/**
 * Loads the Accounted company link and decrypted API key for a VI-HEM
 * company. Throws AccountedContextError (not a Response) so callers in a
 * loop -- e.g. per-item rent billing -- can catch it per item without a
 * function boundary in the way.
 */
export async function loadAccountedCompanyContext(
  adminClient: SupabaseClient,
  companyId: string,
  options: { requireEnabled?: boolean } = { requireEnabled: true },
): Promise<AccountedCompanyContext> {
  const { data: link, error: linkErr } = await adminClient
    .from("vihem_accounted_company_links")
    .select("id, organisation_id, accounted_base_url, accounted_company_id, enabled")
    .eq("company_id", companyId)
    .maybeSingle();
  if (linkErr || !link) {
    throw new AccountedContextError("ACCOUNTED_NOT_LINKED", "Bolaget är inte kopplat till Accounted ännu.");
  }
  if (options.requireEnabled !== false && !link.enabled) {
    throw new AccountedContextError("ACCOUNTED_LINK_DISABLED", "Accounted-kopplingen är inaktiverad för bolaget.");
  }

  const { data: secret, error: secretErr } = await adminClient
    .from("vihem_accounted_secrets")
    .select("encrypted_secret")
    .eq("company_link_id", link.id)
    .eq("secret_type", "api_key")
    .is("webhook_subscription_id", null)
    .maybeSingle();
  if (secretErr || !secret) {
    throw new AccountedContextError("ACCOUNTED_NO_API_KEY", "Ingen Accounted API-nyckel sparad för bolaget.");
  }

  let apiKey: string;
  try {
    apiKey = await decryptAccountedSecret(secret.encrypted_secret);
  } catch (err) {
    throw new AccountedContextError(
      "SECRET_DECRYPTION_FAILED",
      err instanceof Error ? err.message : String(err),
    );
  }

  return { link: link as AccountedCompanyContext["link"], apiKey };
}

/**
 * Runs a connectivity check against Accounted for one company link and
 * persists the result on vihem_accounted_company_links (last_health_status /
 * last_health_check_at / last_health_error) -- the exact same read/update
 * vihem-accounted-admin's "Testa anslutning" button triggers manually.
 * Shared so the manual button and the scheduled healthcheck function
 * (vihem-accounted-healthcheck, run by pg_cron) can never drift apart.
 *
 * Checks a link even if it's disabled or missing its API key -- an operator
 * setting up a new company link benefits from seeing why it's not healthy
 * yet, same as the manual button (requireEnabled: false).
 */
export interface AccountedHealthCheckResult {
  ok: boolean;
  error?: { code: string; message: string; recovery_hint?: string; details?: unknown };
}

export async function runAccountedHealthCheck(
  adminClient: SupabaseClient,
  companyId: string,
): Promise<AccountedHealthCheckResult> {
  let context: AccountedCompanyContext;
  try {
    context = await loadAccountedCompanyContext(adminClient, companyId, { requireEnabled: false });
  } catch (err) {
    if (err instanceof AccountedContextError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    throw err;
  }

  const client = createAccountedClient({ baseUrl: context.link.accounted_base_url, apiKey: context.apiKey });
  const result = await client.healthCheck(context.link.accounted_company_id);

  await adminClient
    .from("vihem_accounted_company_links")
    .update({
      last_health_check_at: new Date().toISOString(),
      last_health_status: result.ok ? "ok" : "error",
      last_health_error: result.ok ? "" : `${result.error?.code}: ${result.error?.message}`,
    })
    .eq("id", context.link.id);

  if (result.ok) return { ok: true };
  return {
    ok: false,
    error: {
      code: result.error!.code,
      message: result.error!.message,
      recovery_hint: result.error!.recovery_hint,
      details: result.error!.details,
    },
  };
}
