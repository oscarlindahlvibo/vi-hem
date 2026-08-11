import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function text(value: unknown, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

async function resolveOrganisation(client: any, request: Request, body: any) {
  const hostname = text(body.hostname || new URL(request.url).searchParams.get('hostname') || request.headers.get('origin')?.replace(/^https?:\/\//, '').split('/')[0]);
  const slug = text(body.organisation_slug || new URL(request.url).searchParams.get('organisation_slug'));
  if (hostname) {
    const { data } = await client.from('vihem_rental_domains').select('organisation_id').eq('hostname', hostname).eq('active', true).maybeSingle();
    if (data?.organisation_id) return data.organisation_id;
  }
  if (slug) {
    const { data } = await client.from('vihem_organisations').select('id').eq('slug', slug).eq('active', true).maybeSingle();
    if (data?.id) return data.id;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const action = text(body.action || url.searchParams.get('action') || url.pathname.split('/').filter(Boolean).pop() || 'products');
    const organisationId = await resolveOrganisation(client, request, body);
    if (!organisationId) return json({ error: 'Kunde inte hitta uthyrningsorganisationen.' }, 400);

    const { data: enabled } = await client.from('vihem_organisation_modules').select('enabled').eq('organisation_id', organisationId).eq('module_key', 'rental_management').maybeSingle();
    if (!enabled?.enabled) return json({ error: 'Uthyrningsmodulen är inte aktiverad.' }, 403);

    if (request.method === 'GET' && (action === 'products' || action === 'product')) {
      let query = client.from('vihem_rental_products').select('id,name,slug,description,short_description,category,images,deposit,vat_rate,minimum_duration,maximum_duration,pickup_instructions,return_instructions,location,seo_title,seo_description').eq('organisation_id', organisationId).eq('active', true).eq('visible_publicly', true).order('sort_order').order('name');
      const slug = text(url.searchParams.get('slug'));
      if (slug) query = query.eq('slug', slug);
      const { data, error } = await query;
      if (error) throw error;
      return json({ products: data || [] });
    }

    if (action === 'availability') {
      const slug = text(body.slug || url.searchParams.get('slug'));
      const startAt = text(body.start_at || url.searchParams.get('start_at'));
      const endAt = text(body.end_at || url.searchParams.get('end_at'));
      if (!slug || !startAt || !endAt) return json({ error: 'slug, start_at och end_at krävs.' }, 400);
      const { data: product, error: productError } = await client.from('vihem_rental_products').select('id,name,slug').eq('organisation_id', organisationId).eq('slug', slug).eq('active', true).eq('visible_publicly', true).maybeSingle();
      if (productError) throw productError;
      if (!product) return json({ error: 'Produkten hittades inte.' }, 404);
      const { data, error } = await client.rpc('vihem_rental_available_assets', { target_product_id: product.id, target_start_at: startAt, target_end_at: endAt });
      if (error) throw error;
      return json({ product, available: (data || []).length > 0, assets: data || [] });
    }

    if (action === 'quote') {
      const slug = text(body.slug);
      const { data: product, error: productError } = await client.from('vihem_rental_products').select('id,name,slug').eq('organisation_id', organisationId).eq('slug', slug).eq('active', true).eq('visible_publicly', true).maybeSingle();
      if (productError) throw productError;
      if (!product) return json({ error: 'Produkten hittades inte.' }, 404);
      const { data, error } = await client.rpc('vihem_rental_quote', { target_product_id: product.id, target_start_at: body.start_at, target_end_at: body.end_at, target_quantity: Math.max(1, Number(body.quantity) || 1) });
      if (error) throw error;
      return json({ product, quote: data });
    }

    if (request.method === 'POST' && action === 'bookings') {
      const slug = text(body.slug);
      const { data: product, error: productError } = await client.from('vihem_rental_products').select('id').eq('organisation_id', organisationId).eq('slug', slug).eq('active', true).eq('visible_publicly', true).maybeSingle();
      if (productError) throw productError;
      if (!product) return json({ error: 'Produkten hittades inte.' }, 404);
      const { data, error } = await client.rpc('vihem_create_rental_booking', { target_product_id: product.id, target_start_at: body.start_at, target_end_at: body.end_at, target_quantity: Math.max(1, Number(body.quantity) || 1), target_customer: body.customer || {}, target_source: 'viborent.se', target_status: 'pending', target_customer_notes: text(body.customer_notes, 2000) });
      if (error) throw error;
      return json({ booking: data }, 201);
    }

    return json({ error: 'Okänd uthyrningsåtgärd.' }, 404);
  } catch (error) {
    console.error('vihem-public-rental error:', error);
    return json({ error: error instanceof Error ? error.message : 'Ett oväntat fel uppstod.' }, 500);
  }
});
