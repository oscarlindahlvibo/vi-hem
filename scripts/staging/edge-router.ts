// QA runtime entrypoint, never the production Edge entrypoint.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const allowed: Record<string, string[] | null> = {
  'vihem-public-laundry': null,
  'vihem-access-entries': null,
  'vihem-inspection-archive': null,
  'vihem-chat-upload': null,
  'vihem-chat-to-workorder': null,
  'vihem-profile-photo': null,
  'vihem-routines': ['save', 'archive'],
  'vihem-rent-overview': ['overview'],
  'vihem-agreements-admin': ['list_agreements', 'get_agreement', 'create_agreement', 'update_agreement', 'save_blocks', 'save_parties', 'save_signers', 'save_entity_links', 'get_preview_context', 'list_entity_agreements', 'list_templates', 'get_template'],
};
serve(async (req) => {
  const name = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  const json = (message: string, status = 403) => new Response(JSON.stringify({ error: { code: 'QA_DISABLED', message } }), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  if (!Object.hasOwn(allowed, name)) return json('Extern integration/utskick är avstängd i isolerad staging.');
  if (req.method !== 'OPTIONS' && allowed[name]) {
    let body;
    try { body = await req.clone().json(); } catch { return json('Ogiltig begäran.', 400); }
    if (!allowed[name]!.includes(body.action)) return json('Denna åtgärd är avstängd i staging.');
  }
  try {
    const worker = await EdgeRuntime.userWorkers.create({ servicePath: '/home/deno/functions/' + name, memoryLimitMb: 256, workerTimeoutMs: 60000, noModuleCache: false, envVars: Object.entries(Deno.env.toObject()) });
    return await worker.fetch(req);
  } catch { return json('QA-funktionen kunde inte startas.', 503); }
});
