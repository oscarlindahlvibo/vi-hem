import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendGmailMessage, googleMailerErrorCode, googleMailerFriendlyMessage } from "../_shared/google-workspace-mailer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Designated sender for system-generated invoice emails -- chosen so these
// don't appear to come from any one person's personal Workspace mailbox.
// Sent via the Gmail API (Domain-Wide Delegation impersonates this address),
// not SMTP -- the edge-function container has no SMTP relay configured.
const SENDER_EMAIL = "faktura@vibogruppen.se";
const SENDER_NAME = "VI-HEM";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const body = await req.json().catch(() => ({}));
    const organisationId = typeof body.organisation_id === "string" ? body.organisation_id : "";
    const planId = typeof body.plan_id === "string" ? body.plan_id : "";
    const scheduleId = typeof body.schedule_id === "string" ? body.schedule_id : "";
    if (!organisationId || !planId) return json({ error: "Organisation och plan saknas." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await serviceClient.from("vihem_profiles").select("role, organisation_id").eq("id", user.id).maybeSingle();
    if (!profile || !["admin", "superadmin"].includes(profile.role)) return json({ error: "Saknar behörighet." }, 403);
    if (profile.role !== "superadmin" && profile.organisation_id !== organisationId) return json({ error: "Fel organisation." }, 403);

    const { data: plan, error: planError } = await serviceClient.from("vihem_installment_plans").select("*").eq("id", planId).eq("organisation_id", organisationId).single();
    if (planError || !plan) return json({ error: "Avbetalningsplanen hittades inte." }, 404);
    if (!plan.customer_id) return json({ error: "Planen saknar kopplad kund." }, 400);
    const { data: customer } = await serviceClient.from("vihem_finance_customers").select("name,email,invoice_email").eq("id", plan.customer_id).eq("organisation_id", organisationId).maybeSingle();
    const recipient = customer?.invoice_email || customer?.email || "";
    if (!recipient) return json({ error: "Kunden saknar e-postadress." }, 400);
    const { data: company } = await serviceClient.from("vihem_companies").select("name").eq("id", plan.company_id).eq("organisation_id", organisationId).maybeSingle();
    let scheduleQuery = serviceClient.from("vihem_installment_schedule").select("id,installment_no,due_date,amount").eq("plan_id", plan.id).order("installment_no");
    if (scheduleId) scheduleQuery = scheduleQuery.eq("id", scheduleId);
    const { data: schedule, error: scheduleError } = await scheduleQuery;
    if (scheduleError) throw scheduleError;
    if (scheduleId && (!schedule || schedule.length === 0)) return json({ error: "Delbetalningen hittades inte." }, 404);

    const lines = (schedule || []).map((row) => `${row.installment_no}. ${formatDate(row.due_date)} - ${money(row.amount)}`).join("\n");
    const text = [
      `Hej ${customer?.name || ""},`,
      "",
      scheduleId ? `Här kommer fakturan för delbetalning ${schedule?.[0]?.installment_no} i avbetalningsplan ${plan.plan_number}.` : `Här kommer din avbetalningsplan ${plan.plan_number}.`,
      company?.name ? `Avsändare: ${company.name}` : "",
      `Totalt belopp: ${money(plan.total_amount)}`,
      `Antal delbetalningar: ${plan.installment_count}`,
      "",
      "Betalningstillfällen:",
      lines || "Inga betalningstillfällen registrerade.",
      plan.terms ? `\nVillkor:\n${plan.terms}` : "",
      "",
      "Vänliga hälsningar,",
      "VI-HEM",
    ].filter(Boolean).join("\n");

    try {
      await sendGmailMessage(serviceClient, organisationId, {
        fromEmail: SENDER_EMAIL,
        fromName: SENDER_NAME,
        toEmail: recipient,
        toName: customer?.name || "",
        subject: `Avbetalningsplan ${plan.plan_number}`,
        text,
      });
    } catch (sendErr) {
      const code = googleMailerErrorCode(sendErr);
      let statusUpdate = serviceClient.from("vihem_installment_schedule").update({ email_status: "failed", email_error: googleMailerFriendlyMessage(code) }).eq("plan_id", plan.id);
      if (scheduleId) statusUpdate = statusUpdate.eq("id", scheduleId);
      await statusUpdate;
      return json({ error: googleMailerFriendlyMessage(code) }, 502);
    }
    let statusUpdate = serviceClient.from("vihem_installment_schedule").update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null }).eq("plan_id", plan.id);
    if (scheduleId) statusUpdate = statusUpdate.eq("id", scheduleId);
    const { error: statusError } = await statusUpdate;
    if (statusError) throw statusError;
    await serviceClient.from("vihem_installment_audit_log").insert({ organisation_id: organisationId, plan_id: plan.id, action: "email_sent", metadata: { recipient, schedule_id: scheduleId || null }, created_by: user.id });
    return json({ ok: true, sent_to: recipient, plan_number: plan.plan_number, schedule_id: scheduleId || null });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Kunde inte skicka e-post." }, 400);
  }
});

function money(value: number) { return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(Number(value || 0)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("sv-SE").format(new Date(`${value}T12:00:00`)); }
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
