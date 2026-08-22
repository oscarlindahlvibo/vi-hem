// Public document verification -- the link printed on the final PDF
// (see _shared/agreement-completion.ts). Deliberately much LESS powerful
// than a signing token: given a document_number + verification_code, it
// only ever returns a signature SUMMARY (status, signer names, method,
// signed_at, content_hash) -- never the document's actual content or
// attachments. The point is letting a third party (a bank, a court,
// another company) independently confirm "yes, VI-HEM's records agree
// this was signed by these people on this date", not re-serving the
// document itself. Public/no JWT, same pattern as vihem-agreements-public
// and vihem-accounted-webhook -- must be deployed with verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function errorJson(code: string, message: string, status = 400) {
  return json({ error: { code, message } }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return errorJson("METHOD_NOT_ALLOWED", "Endast POST stöds.", 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson("VALIDATION_ERROR", "Ogiltig JSON.", 400);
  }
  const documentNumber = String(body?.document_number || "").trim();
  const code = String(body?.code || "").trim();
  if (!documentNumber || !code) return errorJson("VALIDATION_ERROR", "document_number och code krävs.", 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: agreement } = await db
    .from("vihem_agreements")
    .select("id, document_number, title, document_type, status, completed_at, current_version_id, verification_code")
    .eq("document_number", documentNumber)
    .maybeSingle();
  // Same response shape whether the document doesn't exist or the code is
  // wrong -- never confirm/deny "this document number exists" to someone
  // without the matching code.
  if (!agreement || !agreement.verification_code || agreement.verification_code !== code) {
    return errorJson("NOT_VERIFIED", "Kunde inte verifiera dokumentet. Kontrollera länken.", 404);
  }

  const [{ data: version }, { data: signers }] = await Promise.all([
    agreement.current_version_id
      ? db.from("vihem_agreement_versions").select("content_hash, frozen_at, version_number").eq("id", agreement.current_version_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("vihem_agreement_signers").select("id, name, role_title, signing_method, signing_required, status").eq("agreement_id", agreement.id),
  ]);

  const signerIds = (signers || []).map((s: any) => s.id);
  const { data: signatures } = signerIds.length
    ? await db.from("vihem_agreement_signatures").select("signer_id, method, signed_at").in("signer_id", signerIds)
    : { data: [] };
  const signedAtBySigner = new Map<string, { method: string; signed_at: string }>((signatures || []).map((s: any) => [s.signer_id, s]));

  return json({
    data: {
      document_number: agreement.document_number,
      title: agreement.title,
      document_type: agreement.document_type,
      status: agreement.status,
      completed_at: agreement.completed_at,
      content_hash: version?.content_hash || null,
      signers: (signers || []).filter((s: any) => s.signing_required).map((s: any) => {
        const sig = signedAtBySigner.get(s.id);
        return {
          name: s.name,
          role_title: s.role_title,
          method: sig?.method || s.signing_method,
          status: s.status,
          signed_at: sig?.signed_at || null,
        };
      }),
    },
  });
});
