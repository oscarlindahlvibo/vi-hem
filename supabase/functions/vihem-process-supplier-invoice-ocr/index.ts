import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit || 25), 1), 50);
    const companyId = typeof body.company_id === "string" ? body.company_id : "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await serviceClient
      .from("vihem_profiles")
      .select("id, role, organisation_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) return json({ error: "Kunde inte verifiera användaren." }, 403);

    let allowedCompanyIds: string[] | null = null;
    if (profile.role !== "superadmin" && profile.role !== "admin") {
      const { data: permissions, error: permissionError } = await serviceClient
        .from("vihem_company_user_permissions")
        .select("company_id, role")
        .eq("organisation_id", profile.organisation_id)
        .eq("user_id", user.id)
        .eq("active", true)
        .in("role", ["bookkeeper", "approver", "admin"]);

      if (permissionError) throw permissionError;
      allowedCompanyIds = (permissions || []).map((permission: any) => permission.company_id);
      if (allowedCompanyIds.length === 0) return json({ error: "Saknar bolagsbehörighet för OCR-kön." }, 403);
    }

    let query = serviceClient
      .from("vihem_supplier_invoices")
      .select("*, document:document_id(*)")
      .eq("ocr_status", "queued")
      .not("document_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (profile.role !== "superadmin") query = query.eq("organisation_id", profile.organisation_id);
    if (companyId) query = query.eq("company_id", companyId);
    if (allowedCompanyIds) query = query.in("company_id", allowedCompanyIds);

    const { data: invoices, error: invoiceError } = await query;
    if (invoiceError) throw invoiceError;

    const results = [];
    for (const invoice of invoices || []) {
      const document = invoice.document || {};
      const existingOcrData = typeof invoice.ocr_data === "object" && invoice.ocr_data ? invoice.ocr_data : {};
      const suggested = buildMetadataSuggestion(invoice, document);

      const { error: updateError } = await serviceClient
        .from("vihem_supplier_invoices")
        .update({
          ocr_status: "needs_review",
          ocr_data: {
            ...existingOcrData,
            ...suggested,
            processed_by_function: "vihem-process-supplier-invoice-ocr",
            processed_at: new Date().toISOString(),
            review_required: true,
          },
        })
        .eq("id", invoice.id);

      if (updateError) {
        results.push({ id: invoice.id, status: "failed", error: updateError.message });
      } else {
        results.push({ id: invoice.id, status: "needs_review" });
      }
    }

    return json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Internt serverfel" }, 400);
  }
});

function buildMetadataSuggestion(invoice: any, document: any) {
  const fileName = String(document.file_name || invoice.ocr_data?.file_name || "");
  const dateMatch = fileName.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)/);
  const invoiceNumberMatch = fileName.match(/(?:faktura|invoice|inv)[-_ ]?([a-z0-9-]+)/i);

  return {
    source_file_name: fileName,
    source_storage_path: document.storage_path || invoice.ocr_data?.storage_path || "",
    suggested_invoice_date: dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null,
    suggested_supplier_invoice_number: invoiceNumberMatch ? invoiceNumberMatch[1] : null,
    extraction_method: "metadata",
    extraction_note: "Första OCR-steget använder filmetadata. Koppla in OCR/AI-adapter här för faktisk texttolkning.",
  };
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
