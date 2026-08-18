import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const startedAt = new Date().toISOString();
  let serviceClient: any = null;
  let organisationId: string | null = null;

  try {
    const cronSecret = Deno.env.get("VIHEM_CRON_SECRET") || "";
    if (!cronSecret || req.headers.get("X-Cron-Secret") !== cronSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    organisationId = typeof body.organisation_id === "string" && body.organisation_id
      ? body.organisation_id
      : null;
    const settings = organisationId ? await loadAutomationSettings(serviceClient, organisationId) : null;
    const requestedEnabled = body.finance_cron_enabled ?? body.enabled;
    const financeCronEnabled = requestedEnabled !== undefined
      ? requestedEnabled === true
      : settings?.finance_cron_enabled !== false;
    const queueReminders = body.queue_reminders !== undefined
      ? body.queue_reminders === true
      : settings?.queue_reminders === true;
    const sendEmails = body.send_emails !== undefined
      ? body.send_emails === true
      : settings?.send_emails === true;
    const emailLimit = Math.min(Math.max(Number(body.email_limit || settings?.email_limit || 20), 1), 50);
    const processAccountingSync = body.process_accounting_sync !== undefined
      ? body.process_accounting_sync === true
      : settings?.process_accounting_sync === true;
    const accountingSyncLimit = Math.min(Math.max(Number(body.accounting_sync_limit || settings?.accounting_sync_limit || 50), 1), 200);
    const createRentBilling = body.create_rent_billing !== undefined
      ? body.create_rent_billing === true
      : settings?.create_rent_billing === true;
    const rentBillingMonthsAhead = Math.min(Math.max(Number(body.rent_billing_months_ahead ?? settings?.rent_billing_months_ahead ?? 1), 0), 12);
    const autoGenerateRentInvoices = body.auto_generate_rent_invoices !== undefined
      ? body.auto_generate_rent_invoices === true
      : settings?.auto_generate_rent_invoices === true;

    if (!financeCronEnabled) {
      await recordAutomationRun(serviceClient, {
        organisationId,
        status: "success",
        startedAt,
        details: {
          skipped: true,
          reason: "finance_cron_disabled",
          queue_reminders: queueReminders,
          send_emails: sendEmails,
          email_limit: emailLimit,
          process_accounting_sync: processAccountingSync,
          accounting_sync_limit: accountingSyncLimit,
          create_rent_billing: createRentBilling,
          rent_billing_months_ahead: rentBillingMonthsAhead,
          auto_generate_rent_invoices: autoGenerateRentInvoices,
        },
      });

      return json({
        ok: true,
        skipped: true,
        reason: "finance_cron_disabled",
        overdue_updated: 0,
        reminders_queued: 0,
        emails_processed: 0,
        accounting_sync_processed: 0,
        rent_billing: null,
        email_results: [],
        accounting_sync_results: [],
        organisation_id: organisationId,
      });
    }

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

      const { data: installmentReminderData, error: installmentReminderError } = await serviceClient.rpc("vihem_queue_installment_reminders", {
        target_organisation_id: organisationId,
        target_before_days: 3,
      });
      if (installmentReminderError) throw installmentReminderError;
      remindersQueued += Number(installmentReminderData || 0);
    }

    let rentBillingResult: Record<string, unknown> | null = null;
    if (createRentBilling) {
      if (!organisationId) {
        throw new Error("organisation_id krävs för automatisk hyreskörning.");
      }

      const { data: rentData, error: rentError } = await serviceClient.rpc("vihem_run_rent_billing_automation", {
        target_organisation_id: organisationId,
        target_months_ahead: rentBillingMonthsAhead,
        generate_invoice_drafts: autoGenerateRentInvoices,
      });

      if (rentError) throw rentError;
      rentBillingResult = (rentData || null) as Record<string, unknown> | null;
    }

    let emailsProcessed = 0;
    let emailResults: unknown[] = [];
    if (sendEmails) {
      const sendResponse = await fetch(`${supabaseUrl}/functions/v1/vihem-send-invoice-emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cron-Secret": cronSecret,
        },
        body: JSON.stringify({
          organisation_id: organisationId,
          limit: emailLimit,
        }),
      });
      const sendPayload = await sendResponse.json().catch(() => ({}));

      if (!sendResponse.ok || sendPayload.error) {
        throw new Error(sendPayload.error || "Kunde inte skicka köade fakturamejl.");
      }

      emailsProcessed = Number(sendPayload.processed || 0);
      emailResults = Array.isArray(sendPayload.results) ? sendPayload.results : [];

      const installmentSendResponse = await fetch(`${supabaseUrl}/functions/v1/vihem-send-installment-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Cron-Secret": cronSecret },
        body: JSON.stringify({ organisation_id: organisationId, limit: emailLimit }),
      });
      const installmentSendPayload = await installmentSendResponse.json().catch(() => ({}));
      if (!installmentSendResponse.ok || installmentSendPayload.error) {
        throw new Error(installmentSendPayload.error || "Kunde inte skicka avbetalningspåminnelser.");
      }
      emailsProcessed += Number(installmentSendPayload.processed || 0);
      if (Array.isArray(installmentSendPayload.results)) emailResults.push(...installmentSendPayload.results);
    }

    let accountingSyncProcessed = 0;
    let accountingSyncResults: unknown[] = [];
    if (processAccountingSync) {
      const syncResponse = await fetch(`${supabaseUrl}/functions/v1/vihem-process-accounting-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cron-Secret": cronSecret,
        },
        body: JSON.stringify({
          organisation_id: organisationId,
          limit: accountingSyncLimit,
        }),
      });
      const syncPayload = await syncResponse.json().catch(() => ({}));

      if (!syncResponse.ok || syncPayload.error) {
        throw new Error(syncPayload.error || "Kunde inte behandla bokföringskön.");
      }

      accountingSyncProcessed = Number(syncPayload.processed || 0);
      accountingSyncResults = Array.isArray(syncPayload.results) ? syncPayload.results : [];
    }

    const payload = {
      ok: true,
      overdue_updated: Number(data || 0),
      reminders_queued: remindersQueued,
      emails_processed: emailsProcessed,
      accounting_sync_processed: accountingSyncProcessed,
      rent_billing: rentBillingResult,
      email_results: emailResults,
      accounting_sync_results: accountingSyncResults,
      organisation_id: organisationId,
    };

    await recordAutomationRun(serviceClient, {
      organisationId,
      status: "success",
      startedAt,
      overdueUpdated: Number(data || 0),
      remindersQueued,
      emailsProcessed,
      details: {
        queue_reminders: queueReminders,
        send_emails: sendEmails,
        email_limit: emailLimit,
        process_accounting_sync: processAccountingSync,
        accounting_sync_limit: accountingSyncLimit,
        create_rent_billing: createRentBilling,
        rent_billing_months_ahead: rentBillingMonthsAhead,
        auto_generate_rent_invoices: autoGenerateRentInvoices,
        rent_billing: rentBillingResult,
        email_results: emailResults,
        accounting_sync_results: accountingSyncResults,
      },
    });

    return json(payload);
  } catch (error) {
    console.error(error);
    if (serviceClient) {
      await recordAutomationRun(serviceClient, {
        organisationId,
        status: "failed",
        startedAt,
        errorMessage: error instanceof Error ? error.message : "Internt serverfel",
      });
    }
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function recordAutomationRun(serviceClient: any, input: {
  organisationId: string | null;
  status: "success" | "failed";
  startedAt: string;
  overdueUpdated?: number;
  remindersQueued?: number;
  emailsProcessed?: number;
  details?: Record<string, unknown>;
  errorMessage?: string;
}) {
  const { error } = await serviceClient
    .from("vihem_finance_automation_runs")
    .insert({
      organisation_id: input.organisationId,
      job_key: "finance_cron",
      status: input.status,
      overdue_updated: input.overdueUpdated || 0,
      reminders_queued: input.remindersQueued || 0,
      emails_processed: input.emailsProcessed || 0,
      details: input.details || {},
      error_message: input.errorMessage || "",
      started_at: input.startedAt,
      finished_at: new Date().toISOString(),
    });

  if (error) console.error("Could not record finance automation run", error);
}

async function loadAutomationSettings(serviceClient: any, organisationId: string) {
  const { data, error } = await serviceClient
    .from("vihem_finance_automation_settings")
    .select("finance_cron_enabled, queue_reminders, send_emails, email_limit, process_accounting_sync, accounting_sync_limit, create_rent_billing, rent_billing_months_ahead, auto_generate_rent_invoices")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (error) {
    console.error("Could not load finance automation settings", error);
    return null;
  }

  return data as {
    finance_cron_enabled: boolean;
    queue_reminders: boolean;
    send_emails: boolean;
    email_limit: number;
    process_accounting_sync: boolean;
    accounting_sync_limit: number;
    create_rent_billing: boolean;
    rent_billing_months_ahead: number;
    auto_generate_rent_invoices: boolean;
  } | null;
}
