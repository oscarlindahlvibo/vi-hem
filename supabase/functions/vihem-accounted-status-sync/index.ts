// Polls Accounted for the current state of every not-yet-final invoice link
// (status sync without webhooks -- see migration 20260927100000). Run hourly
// by pg_cron with a shared secret header, or on demand by a superadmin.
// verify_jwt must be OFF (supabase/config.toml).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AccountedContextError, loadAccountedCompanyContext } from "../_shared/accounted-company-context.ts";
import { AccountedApiError, createAccountedClient } from "../_shared/accounted-rest-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const SETTINGS_KEY = "accounted_status_sync";
const SECRET_HEADER = "x-vihem-accounted-status-sync-secret";
const KNOWN_STATUSES = ["draft", "sent", "paid", "partially_paid", "overdue", "cancelled", "credited"];
const FINAL_STATUSES = ["paid", "cancelled", "credited"];
const MAX_INVOICES_PER_COMPANY = 150;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let authorized = false;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader) {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      const { data: profile } = await adminClient.from("vihem_profiles").select("role").eq("id", user.id).maybeSingle();
      if (profile?.role === "superadmin") authorized = true;
    }
  }
  if (!authorized) {
    const provided = req.headers.get(SECRET_HEADER) || "";
    const { data: row } = await adminClient.from("vihem_system_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    const expected = row?.value && typeof row.value === "object" ? String((row.value as any).secret || "") : "";
    if (provided && expected && provided === expected) authorized = true;
  }
  if (!authorized) return json({ error: { code: "UNAUTHORIZED", message: "Saknar behörighet." } }, 401);

  const { data: links, error: linksErr } = await adminClient
    .from("vihem_accounted_company_links")
    .select("id, company_id")
    .eq("enabled", true);
  if (linksErr) return json({ error: { code: "INTERNAL_ERROR", message: linksErr.message } }, 500);

  const summary: { company_id: string; checked: number; updated: number; failed: number; error?: string }[] = [];

  for (const link of (links ?? []) as { id: string; company_id: string }[]) {
    const entry = { company_id: link.company_id, checked: 0, updated: 0, failed: 0 } as (typeof summary)[number];
    summary.push(entry);
    try {
      const context = await loadAccountedCompanyContext(adminClient, link.company_id);
      const client = createAccountedClient({ baseUrl: context.link.accounted_base_url, apiKey: context.apiKey });

      const { data: open } = await adminClient
        .from("vihem_accounted_invoice_links")
        .select("accounted_invoice_id, status")
        .eq("company_link_id", link.id)
        .not("status", "in", `(${FINAL_STATUSES.join(",")})`)
        .order("last_synced_at", { ascending: true })
        .limit(MAX_INVOICES_PER_COMPANY * 3);
      const invoiceIds = [...new Set((open ?? []).map((r: any) => r.accounted_invoice_id as string))].slice(0, MAX_INVOICES_PER_COMPANY);

      for (const invoiceId of invoiceIds) {
        entry.checked++;
        try {
          const inv = await client.get<any>(
            `/api/v1/companies/${encodeURIComponent(context.link.accounted_company_id)}/invoices/${encodeURIComponent(invoiceId)}`,
          );
          const status = KNOWN_STATUSES.includes(inv?.status) ? inv.status : undefined;
          const { error } = await adminClient
            .from("vihem_accounted_invoice_links")
            .update({
              accounted_invoice_number: inv.invoice_number ?? undefined,
              status,
              total: inv.total ?? undefined,
              remaining_amount: inv.remaining_amount ?? undefined,
              invoice_date: inv.invoice_date ?? undefined,
              due_date: inv.due_date ?? undefined,
              paid_at: inv.paid_at ?? undefined,
              last_sync_source: "poll",
              last_synced_at: new Date().toISOString(),
            })
            .eq("company_link_id", link.id)
            .eq("accounted_invoice_id", invoiceId);
          if (error) throw new Error(error.message);
          entry.updated++;
        } catch (err) {
          entry.failed++;
          console.error("status-sync invoice failed", invoiceId, err instanceof AccountedApiError ? `${err.code}: ${err.message}` : String(err));
        }
      }
    } catch (err) {
      entry.error = err instanceof AccountedContextError || err instanceof Error ? err.message : String(err);
    }
  }

  return json({ data: { companies: summary } });
});
