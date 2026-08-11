import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function text(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function stripeRequestBody(values: Record<string, string>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return body;
}

async function stripeFetch(path: string, options: RequestInit = {}) {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Stripe är inte konfigurerat på servern.');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Stripe-anropet misslyckades.');
  return data;
}

async function verifyStripeSignature(rawBody: string, signature: string | null) {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret || !signature) return false;
  const timestamp = signature.match(/(?:^|,)t=(\d+)/)?.[1];
  const signed = signature.match(/(?:^|,)v1=([^,]+)/)?.[1];
  if (!timestamp || !signed || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return expected === signed;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const rawBody = await request.text();
    const body = JSON.parse(rawBody || '{}');
    const action = text(body.action || (request.headers.get('stripe-signature') ? 'webhook' : 'create_checkout'));

    if (action === 'webhook') {
      if (!(await verifyStripeSignature(rawBody, request.headers.get('stripe-signature')))) return json({ error: 'Ogiltig Stripe-webhooksignatur.' }, 401);
      const event = body.event || body;
      const session = event.data?.object;
      const bookingId = text(session?.metadata?.vihem_booking_id, 100);
      if (!bookingId) return json({ received: true });
      const nextStatus = event.type === 'checkout.session.completed' ? 'paid' : event.type === 'charge.refunded' ? 'refunded' : null;
      if (nextStatus) {
        const { error } = await supabase.from('vihem_rental_bookings').update({ payment_status: nextStatus, external_payment_id: text(session?.payment_intent || session?.id, 200), stripe_payment_intent_id: text(session?.payment_intent, 200), updated_at: new Date().toISOString() }).eq('id', bookingId);
        if (error) throw error;
      }
      return json({ received: true });
    }

    const bookingId = text(body.booking_id, 100);
    const successUrl = text(body.success_url, 1000);
    const cancelUrl = text(body.cancel_url, 1000);
    if (!bookingId || !/^https:\/\//.test(successUrl) || !/^https:\/\//.test(cancelUrl)) return json({ error: 'booking_id, https success_url och https cancel_url krävs.' }, 400);

    const { data: booking, error: bookingError } = await supabase.from('vihem_rental_bookings').select('id,organisation_id,public_reference,status,payment_status,total,currency,customer:vihem_rental_customers(email,first_name,last_name)').eq('id', bookingId).maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return json({ error: 'Bokningen hittades inte.' }, 404);
    if (['cancelled', 'completed'].includes(booking.status)) return json({ error: 'Bokningen kan inte betalas.' }, 409);
    if (booking.payment_status === 'paid') return json({ error: 'Bokningen är redan betald.' }, 409);

    const currency = String(booking.currency || 'SEK').toLowerCase();
    const amount = Math.round(Number(booking.total || 0) * 100);
    if (amount <= 0) return json({ error: 'Bokningen saknar ett giltigt totalbelopp.' }, 400);
    const customer = Array.isArray(booking.customer) ? booking.customer[0] : booking.customer;
    const session = await stripeFetch('checkout/sessions', { method: 'POST', body: stripeRequestBody({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][product_data][name]': `ViboRent ${booking.public_reference}`,
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][quantity]': '1',
      ...(customer?.email ? { customer_email: customer.email } : {}),
      'metadata[vihem_booking_id]': booking.id,
      'metadata[vihem_organisation_id]': booking.organisation_id,
      'metadata[vihem_public_reference]': booking.public_reference,
    }) });

    const { error: updateError } = await supabase.from('vihem_rental_bookings').update({ payment_provider: 'stripe', payment_status: 'pending', stripe_checkout_session_id: session.id, external_payment_id: session.id, updated_at: new Date().toISOString() }).eq('id', booking.id);
    if (updateError) throw updateError;
    return json({ checkout_url: session.url, session_id: session.id, booking_reference: booking.public_reference });
  } catch (error) {
    console.error('vihem-rental-stripe error:', error);
    return json({ error: error instanceof Error ? error.message : 'Ett oväntat betalningsfel uppstod.' }, 500);
  }
});
