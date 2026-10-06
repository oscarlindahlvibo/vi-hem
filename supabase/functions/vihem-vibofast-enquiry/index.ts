import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const origins = new Set((Deno.env.get('VIBOFAST_ALLOWED_ORIGINS') ?? 'https://vibofast.se,https://www.vibofast.se').split(',').map(s=>s.trim()));
Deno.serve(async req => {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://vibofast.se', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  const reply = (status: number, message: string) => new Response(JSON.stringify({ message }), { status, headers });
  if (!origins.has(origin)) return reply(403,'Forbidden');
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return reply(405,'Method not allowed');
  try {
    const raw = await req.text();
    if (raw.length > 16000) return reply(413,'Message too large');
    const body = JSON.parse(raw);
    if (!['contact','interest'].includes(body.kind) || !body.payload || typeof body.payload !== 'object') return reply(400,'Invalid request');
    const allowed = body.kind === 'contact' ? ['name','email','phone','subject','message'] : ['name','email','phone','moveInDate','propertyType','rooms','message'];
    const payload: Record<string,string> = {};
    for (const key of allowed) {
      const value = body.payload[key] ?? '';
      if (typeof value !== 'string' || value.length > (key === 'message' ? 4000 : 250)) return reply(400,'Invalid field');
      payload[key] = value.trim();
    }
    if (!payload.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || (body.kind === 'contact' && !payload.message)) return reply(400,'Name, email and message required');
    const secret = Deno.env.get('VIBOFAST_RATE_LIMIT_SECRET');
    const url = Deno.env.get('SUPABASE_URL'); const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret || !url || !serviceKey) return reply(503,'Not configured');
    // Configure the trusted reverse proxy to overwrite x-real-ip.
    // Email is the fallback on hosts that do not provide a trusted client IP.
    const identity = req.headers.get('x-real-ip') || payload.email.toLowerCase();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const hash = await crypto.subtle.sign('HMAC',key,enc.encode(identity));
    const fingerprint = Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    const client = createClient(url,serviceKey,{auth:{persistSession:false}});
    const { error } = await client.rpc('vihem_vibofast_store_enquiry',{p_kind:body.kind,p_payload:payload,p_fingerprint:fingerprint});
    if (error) return reply(error.message.includes('Rate limit') ? 429 : 503,'Could not submit');
    return reply(201,'Received');
  } catch { return reply(400,'Invalid request'); }
});
