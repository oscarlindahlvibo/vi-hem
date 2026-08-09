import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("VIHEM_CRON_SECRET") || "";
    if (!cronSecret || req.headers.get("X-Cron-Secret") !== cronSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const organisationId = typeof body.organisation_id === "string" && body.organisation_id
      ? body.organisation_id
      : null;
    const queueReminders = body.queue_reminders === true;

    const { data, error } = await serviceClient.rpc("vihem_refresh_overdue_invoices", {
      target_organisation_id: organisationId,
    });

    if (error) throw error;

    let remindersQueued = 0;
    if (queueReminders) {
      const { data: reminderData, error: reminderError } = await serviceClient.rpc("vihem_queue_overdue_invoice_reminders", {
        target_organisation_id: organisationId,
        target_company_id: null,
      });

      if (reminderError) throw reminderError;
      remindersQueued = Number(reminderData || 0);
    }

    return json({
      ok: true,
      overdue_updated: Number(data || 0),
      reminders_queued: remindersQueued,
      organisation_id: organisationId,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
