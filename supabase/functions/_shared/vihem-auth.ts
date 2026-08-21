// Shared auth/role-check helper for the new Accounted V2 edge functions.
//
// Existing VI-HEM edge functions each reimplement "verify JWT -> load caller
// profile -> compare role" inline (confirmed across vihem-create-user,
// vihem-admin-reset-password, vihem-admin-update-user, etc.). That's left
// untouched here — retrofitting 30+ existing functions is out of scope for
// this change. New Accounted-integration functions use this shared helper
// instead, so the auth/company-access logic for the new surface has one
// source of truth from the start.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

/** Structured error body matching how Accounted itself reports errors, so the
 * frontend can render `code` + `recovery_hint` consistently for both local
 * and upstream failures (see docs/accounted-v2-integration.md "Felhantering"). */
export function errorJson(
  code: string,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
) {
  return json({ error: { code, message, ...extra } }, status);
}

export interface AuthContext {
  callerId: string;
  callerProfile: { role: string; organisation_id: string };
  /** Client authenticated AS the caller (anon key + their JWT). RLS-bound
   * database functions like vihem_user_has_company_access read auth.uid()
   * from the session, so company-access checks MUST run through this
   * client, never through adminClient (service role has no auth.uid()). */
  userClient: SupabaseClient;
  /** Service-role client. All Accounted-integration table writes need to
   * bypass RLS deliberately (the tables are `USING (false)` for
   * authenticated by design), so every write goes through this client
   * after the access check above has already run on userClient. */
  adminClient: SupabaseClient;
}

/**
 * Verifies the caller's JWT and loads their profile. Returns an error
 * Response on failure (401), otherwise the resolved context.
 */
export async function authenticate(req: Request): Promise<AuthContext | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorJson("UNAUTHORIZED", "Saknar Authorization-header.", 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller) return errorJson("UNAUTHORIZED", "Ogiltig session.", 401);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: callerProfile, error: profileError } = await adminClient
    .from("vihem_profiles")
    .select("role, organisation_id")
    .eq("id", caller.id)
    .maybeSingle();

  if (profileError || !callerProfile) return errorJson("UNAUTHORIZED", "Ingen profil hittades.", 401);

  return { callerId: caller.id, callerProfile, userClient, adminClient };
}

export function isAuthContext(value: AuthContext | Response): value is AuthContext {
  return "callerId" in value;
}

/**
 * Company-access check delegated to the DB function
 * `vihem_user_has_company_access(company_id, required_role)` — the same
 * function the RLS policies on vihem_companies / vihem_finance_* use, so
 * "can this edge function act on this company" always agrees with "could
 * the same user do it directly via RLS".
 */
export async function requireCompanyAccess(
  ctx: AuthContext,
  companyId: string,
  minRole: "viewer" | "seller" | "bookkeeper" | "approver" | "admin",
): Promise<Response | null> {
  // Must run through userClient (caller's JWT): the RLS-bound SQL function
  // reads auth.uid()/auth.jwt(), which is unset when called via the
  // service-role client, so adminClient.rpc() here would silently deny.
  const { data, error } = await ctx.userClient.rpc("vihem_user_has_company_access", {
    target_company_id: companyId,
    required_role: minRole,
  });
  if (error) return errorJson("INTERNAL_ERROR", "Kunde inte verifiera bolagsbehörighet.", 500);
  if (!data) return errorJson("FORBIDDEN", "Du saknar behörighet för detta bolag.", 403);
  return null;
}
