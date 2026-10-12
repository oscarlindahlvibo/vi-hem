// Publik ViboRent-API (verify_jwt = false, se config.toml).
// Säkerhetsprinciper:
//  * Organisationen härleds ur Origin-headern via tabellen vihem_rental_domains – aldrig ur klientens body/organisation-id.
//  * CORS släpper bara igenom registrerade, aktiva domäner.
//  * Alla ID:n valideras mot organisationen; databasen kontrollerar dessutom att produkterna tillhör den.
//  * Databasfel läcker aldrig ut: bara kända felkoder ("[E_...]") returneras, allt annat blir ett generellt fel.
//  * Skrivande anrop hastighetsbegränsas per IP-fingeravtryck. Avtalstext kommer alltid från organisationens publicerade avtalsversion.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { allow, clientIp, corsHeaders, EMAIL, fingerprint, hostFromOrigin, mapDbError, normaliseHost, organisationForHost, text, UUID } from "../_shared/rental-common.ts";
import { issueRefund } from "../_shared/rental-stripe.ts";

const PRODUCT_FIELDS = "id,name,slug,description,short_description,category,images,deposit,vat_rate,minimum_duration,maximum_duration,pickup_instructions,return_instructions,location,seo_title,seo_description";
const iso = (value: unknown) => { const d = new Date(String(value ?? "")); return Number.isFinite(d.getTime()) ? d.toISOString() : ""; };

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const url = new URL(request.url);

  // Organisation: Origin är auktoritativ. Utan Origin (server-till-server/curl) tillåts hostname-parametern bara för läsning.
  let host = hostFromOrigin(request);
  if (!host && request.method === "GET") host = normaliseHost(url.searchParams.get("hostname"));
  const organisationId = await organisationForHost(admin, host);
  const headers = { ...corsHeaders(origin, !!organisationId && !!hostFromOrigin(request)), "Content-Type": "application/json" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!organisationId) return reply(404, { error: "Webbplatsen är inte konfigurerad.", code: "E_DOMAIN" });

  try {
    const { data: moduleRow } = await admin.from("vihem_organisation_modules").select("enabled").eq("organisation_id", organisationId).eq("module_key", "rental_management").maybeSingle();
    if (!moduleRow?.enabled) return reply(403, { error: "Uthyrningen är inte aktiverad.", code: "E_DISABLED" });

    let body: any = {};
    if (request.method === "POST") {
      const raw = await request.text();
      if (raw.length > 700_000) return reply(413, { error: "Förfrågan är för stor." });
      body = raw ? JSON.parse(raw) : {};
    }
    const action = text(body.action || url.searchParams.get("action") || "products", 40);
    const param = (name: string) => text(body[name] ?? url.searchParams.get(name), 200);

    const productBySlug = async (slug: string) => {
      const { data } = await admin.from("vihem_rental_products").select("id,name,slug").eq("organisation_id", organisationId).eq("slug", slug).eq("active", true).eq("visible_publicly", true).maybeSingle();
      return data;
    };
    const productById = async (id: string) => {
      if (!UUID.test(id)) return null;
      const { data } = await admin.from("vihem_rental_products").select("id,name,slug").eq("organisation_id", organisationId).eq("id", id).eq("active", true).eq("visible_publicly", true).maybeSingle();
      return data;
    };

    // ---------------------------------------------------------------- Läsning
    if (request.method === "GET" && (action === "products" || action === "product")) {
      let query = admin.from("vihem_rental_products").select(PRODUCT_FIELDS).eq("organisation_id", organisationId).eq("active", true).eq("visible_publicly", true).order("sort_order").order("name");
      const slug = param("slug");
      if (slug) query = query.eq("slug", slug);
      const { data, error } = await query;
      if (error) throw error;
      // Från-pris per produkt (billigaste aktiva enhetsregel) för katalogen.
      const ids = (data || []).map((p: any) => p.id);
      const { data: rules } = ids.length ? await admin.from("vihem_rental_pricing_rules").select("product_id,rule_type,price,duration,priority").eq("organisation_id", organisationId).in("product_id", ids).eq("active", true).is("asset_id", null) : { data: [] };
      const { data: assetRows } = ids.length ? await admin.from("vihem_rental_assets").select("product_id").eq("organisation_id", organisationId).in("product_id", ids).eq("active", true).eq("status", "available") : { data: [] };
      const stock: Record<string, number> = {};
      for (const a of assetRows || []) stock[a.product_id] = (stock[a.product_id] || 0) + 1;
      const products = (data || []).map((p: any) => {
        const own = (rules || []).filter((r: any) => r.product_id === p.id);
        const daily = own.filter((r: any) => r.rule_type === "daily").sort((a: any, b: any) => a.price - b.price)[0];
        const hourly = own.filter((r: any) => r.rule_type === "hourly").sort((a: any, b: any) => a.price - b.price)[0];
        return { ...p, price_hint: { daily: daily ? Number(daily.price) / Math.max(daily.duration || 1, 1) : null, hourly: hourly ? Number(hourly.price) / Math.max(hourly.duration || 1, 1) : null }, stock: stock[p.id] || 0 };
      });
      return reply(200, { products });
    }

    if (request.method === "GET" && action === "site-config") {
      const [{ data: organisation }, { data: settings }] = await Promise.all([
        admin.from("vihem_organisations").select("name,slug").eq("id", organisationId).maybeSingle(),
        admin.from("vihem_rental_settings").select("currency,customer_support_email,customer_support_phone,terms_url,privacy_url,timezone,minimum_advance_hours,maximum_advance_days,free_cancellation_minutes,access_dispatch_minutes,booking_hold_minutes,access_enabled").eq("organisation_id", organisationId).maybeSingle(),
      ]);
      const { data: contract } = await admin.from("vihem_rental_contract_versions").select("id,version,title").eq("organisation_id", organisationId).eq("status", "active").maybeSingle();
      return reply(200, { site: { site_name: "ViboRent", organisation_name: organisation?.name || "ViboRent", organisation_slug: organisation?.slug || "", currency: "SEK", timezone: "Europe/Stockholm", free_cancellation_minutes: 60, access_dispatch_minutes: 60, booking_hold_minutes: 30, ...(settings || {}), contract_version: contract || null } });
    }

    if (request.method === "GET" && action === "contract") {
      const { data } = await admin.from("vihem_rental_contract_versions").select("version,title,body").eq("organisation_id", organisationId).eq("status", "active").maybeSingle();
      return reply(200, { contract: data || { version: 1, title: "Uthyrningsavtal", body: "ViboRent uthyrningsavtal v1" } });
    }

    if (action === "availability" || action === "availability-calendar") {
      const product = await productBySlug(param("slug"));
      if (!product) return reply(404, { error: "Produkten hittades inte.", code: "E_PRODUCT" });
      if (action === "availability") {
        const start = iso(param("start_at")), end = iso(param("end_at"));
        if (!start || !end || end <= start) return reply(400, { error: "Ogiltig period.", code: "E_PERIOD" });
        const { data, error } = await admin.rpc("vihem_rental_free_assets", { p_product: product.id, p_start: start, p_end: end });
        if (error) throw error;
        const free = (data || []).length;
        const periodError = await admin.rpc("vihem_rental_check_period", { p_product: product.id, p_start: start, p_end: end, p_enforce_advance: true });
        return reply(200, { product, available: free > 0 && !periodError.data, free_count: free, period_error: periodError.data || null });
      }
      // Kalender: per objekt upptagna intervall (anonymiserade). Produktövergripande blockeringar gäller alla objekt.
      const from = iso(param("from")), to = iso(param("to"));
      if (!from || !to || to <= from || new Date(to).getTime() - new Date(from).getTime() > 400 * 86400000) return reply(400, { error: "Ogiltigt datumintervall.", code: "E_PERIOD" });
      const { data: assets } = await admin.from("vihem_rental_assets").select("id").eq("organisation_id", organisationId).eq("product_id", product.id).eq("active", true).eq("status", "available");
      const assetIds = (assets || []).map((a: any) => a.id);
      const { data: items } = assetIds.length ? await admin.from("vihem_rental_booking_items").select("asset_id,start_at,end_at,booking:vihem_rental_bookings!inner(status,hold_expires_at)").in("asset_id", assetIds).lt("start_at", to).gt("end_at", from) : { data: [] };
      const now = Date.now();
      const busy: Record<string, Array<[string, string]>> = Object.fromEntries(assetIds.map((id: string) => [id, []]));
      for (const item of items || []) {
        const b: any = Array.isArray(item.booking) ? item.booking[0] : item.booking;
        if (!b || !["pending", "confirmed", "active"].includes(b.status)) continue;
        if (b.status === "pending" && b.hold_expires_at && new Date(b.hold_expires_at).getTime() < now) continue;
        busy[item.asset_id].push([item.start_at, item.end_at]);
      }
      const { data: blocks } = await admin.from("vihem_rental_blocks").select("asset_id,product_id,start_at,end_at").eq("organisation_id", organisationId).lt("start_at", to).gt("end_at", from);
      const wide: Array<[string, string]> = [];
      for (const blk of blocks || []) {
        if (blk.asset_id && busy[blk.asset_id]) busy[blk.asset_id].push([blk.start_at, blk.end_at]);
        else if (!blk.asset_id && (!blk.product_id || blk.product_id === product.id)) wide.push([blk.start_at, blk.end_at]);
      }
      const { data: setting } = await admin.from("vihem_rental_products").select("buffer_minutes").eq("id", product.id).maybeSingle();
      const { data: defaults } = await admin.from("vihem_rental_settings").select("default_return_buffer_minutes").eq("organisation_id", organisationId).maybeSingle();
      return reply(200, { product, capacity: assetIds.length, buffer_minutes: setting?.buffer_minutes ?? defaults?.default_return_buffer_minutes ?? 0, assets: assetIds.map((id: string, index: number) => ({ n: index + 1, busy: busy[id] })), blocked: wide });
    }

    // ---------------------------------------------------------------- Pris
    const checkLine = async (line: any, defaultStart: string, defaultEnd: string) => {
      const product = await productById(text(line.product_id, 80));
      if (!product) return { error: reply(404, { error: "En produkt i varukorgen hittades inte.", code: "E_PRODUCT" }) };
      const start = iso(line.start_at || defaultStart), end = iso(line.end_at || defaultEnd);
      const quantity = Math.min(50, Math.max(1, Math.floor(Number(line.quantity) || 1)));
      if (!start || !end || end <= start) return { error: reply(400, { error: "Ogiltig period.", code: "E_PERIOD" }) };
      return { product, start, end, quantity };
    };

    if (request.method === "POST" && (action === "quote" || action === "quote-cart")) {
      if (!(await allow(admin, request, "quote", 120, 60))) return reply(429, { error: "För många förfrågningar. Försök igen strax.", code: "E_RATE" });
      const rawItems = action === "quote" ? [{ product_id: (await productBySlug(text(body.slug, 200)))?.id, quantity: body.quantity, start_at: body.start_at, end_at: body.end_at }] : (Array.isArray(body.items) ? body.items.slice(0, 20) : []);
      if (!rawItems.length) return reply(400, { error: "Varukorgen är tom.", code: "E_EMPTY" });
      const lines: any[] = [];
      let subtotal = 0, vat = 0, deposit = 0, currency = "SEK", shortNotice = false;
      const { data: settings } = await admin.from("vihem_rental_settings").select("access_enabled,access_dispatch_minutes").eq("organisation_id", organisationId).maybeSingle();
      for (const line of rawItems) {
        const checked: any = await checkLine(line, text(body.start_at, 40), text(body.end_at, 40));
        if (checked.error) return checked.error;
        const periodError = (await admin.rpc("vihem_rental_check_period", { p_product: checked.product.id, p_start: checked.start, p_end: checked.end, p_enforce_advance: true })).data;
        if (periodError) { const m = mapDbError({ message: periodError }); return reply(m.status, { error: m.message, code: m.code }); }
        const { data: quote, error } = await admin.rpc("vihem_rental_quote", { target_product_id: checked.product.id, target_start_at: checked.start, target_end_at: checked.end, target_quantity: checked.quantity });
        if (error) { const m = mapDbError(error); return reply(m.status, { error: m.message, code: m.code }); }
        const { data: free } = await admin.rpc("vihem_rental_free_assets", { p_product: checked.product.id, p_start: checked.start, p_end: checked.end });
        subtotal += Number(quote.subtotal); vat += Number(quote.vat_amount); deposit += Number(quote.deposit); currency = quote.currency || currency;
        if (settings?.access_enabled && new Date(checked.start).getTime() < Date.now() + (settings.access_dispatch_minutes ?? 60) * 60000) shortNotice = true;
        lines.push({ product_id: checked.product.id, product_name: checked.product.name, quantity: checked.quantity, start_at: checked.start, end_at: checked.end, quote, available: (free || []).length >= checked.quantity, free_count: (free || []).length });
      }
      const result = { subtotal, vat_amount: vat, deposit, total: subtotal + vat, currency, lines, short_notice: shortNotice, available: lines.every((l) => l.available) };
      return reply(200, action === "quote" ? { product: { id: lines[0].product_id, name: lines[0].product_name }, quote: { ...lines[0].quote, available: lines[0].available, short_notice: shortNotice } } : { quote: result });
    }

    // ---------------------------------------------------------------- Bokning
    if (request.method === "POST" && action === "bookings") {
      if (!(await allow(admin, request, "booking", 12, 600))) return reply(429, { error: "Du har gjort flera bokningsförsök nyligen. Försök igen om en stund.", code: "E_RATE" });
      const customer = body.customer || {};
      const email = text(customer.email, 200).toLowerCase();
      const firstName = text(customer.first_name, 120), lastName = text(customer.last_name, 120), company = text(customer.company_name, 200);
      const phone = text(customer.phone, 40).replace(/[^\d+]/g, "");
      if (!EMAIL.test(email) || (!firstName && !company) || phone.length < 7) return reply(400, { error: "Fyll i namn, e-post och telefonnummer (för låskod och bokningsinformation).", code: "E_CUSTOMER" });
      if (body.accepted_terms !== true) return reply(400, { error: "Du måste godkänna hyresvillkoren.", code: "E_TERMS" });
      const items: any[] = [];
      for (const line of (Array.isArray(body.items) ? body.items.slice(0, 20) : [])) {
        const checked: any = await checkLine(line, text(body.start_at, 40), text(body.end_at, 40));
        if (checked.error) return checked.error;
        items.push({ product_id: checked.product.id, quantity: checked.quantity, start_at: checked.start, end_at: checked.end });
      }
      if (!items.length) return reply(400, { error: "Varukorgen är tom.", code: "E_EMPTY" });
      const { data, error } = await admin.rpc("vihem_rental_create_booking_v2", {
        target_items: items,
        target_customer: { first_name: firstName, last_name: lastName, company_name: company, email, phone, identifier: text(customer.identifier, 40), address: text(customer.address, 200), postal_code: text(customer.postal_code, 20), city: text(customer.city, 120), country: text(customer.country, 2) || "SE" },
        target_source: "viborent.se", target_status: "pending", target_customer_notes: text(body.customer_notes, 2000),
        target_options: { public: true, hold: true, organisation_id: organisationId, acknowledge_short_notice: body.acknowledge_short_notice === true },
      });
      if (error) { const m = mapDbError(error); return reply(m.status, { error: m.message, code: m.code }); }
      const { data: lookup } = await admin.from("vihem_rental_bookings").select("public_lookup_token").eq("id", data.id).eq("organisation_id", organisationId).maybeSingle();
      return reply(201, { booking: { ...data, public_lookup_token: lookup?.public_lookup_token || null } });
    }

    // Hjälp: hämta bokning med referens + token (båda krävs).
    const loadBooking = async (bookingId: string, reference: string, token: string) => {
      if (!UUID.test(token)) return null;
      let q = admin.from("vihem_rental_bookings").select("id,public_reference,status,payment_status,contract_status,contract_signer_name,contract_signed_at,contract_terms_snapshot,contract_terms_version,start_at,end_at,subtotal,vat_amount,deposit,total,currency,customer_notes,hold_expires_at,short_notice,cancelled_at,refund_status,refund_amount,customer:vihem_rental_customers(first_name,last_name,email,phone),items:vihem_rental_booking_items(quantity,start_at,end_at,product:vihem_rental_products(name,slug,pickup_instructions,return_instructions,location))").eq("organisation_id", organisationId).eq("public_lookup_token", token);
      q = bookingId && UUID.test(bookingId) ? q.eq("id", bookingId) : q.eq("public_reference", reference);
      const { data } = await q.maybeSingle();
      return data;
    };

    if (request.method === "POST" && action === "sign-contract") {
      if (!(await allow(admin, request, "sign", 20, 600))) return reply(429, { error: "För många försök.", code: "E_RATE" });
      const signerName = text(body.signer_name, 200), signature = text(body.signature, 400_000);
      if (!signerName || !signature || body.accepted_terms !== true) return reply(400, { error: "Namn, signatur och godkända villkor krävs.", code: "E_TERMS" });
      const booking = await loadBooking(text(body.booking_id, 80), "", text(body.public_lookup_token, 100));
      if (!booking) return reply(404, { error: "Bokningen hittades inte.", code: "E_NOT_FOUND" });
      if (booking.status === "cancelled") return reply(409, { error: "Bokningen är avbokad.", code: "E_STATE" });
      if (booking.contract_status === "signed") return reply(200, { booking: { id: booking.id, public_reference: booking.public_reference, contract_status: "signed" } });
      const acceptance = { accepted_at: new Date().toISOString(), terms_version: booking.contract_terms_version, user_agent: text(request.headers.get("user-agent"), 300), client_fingerprint: await fingerprint(clientIp(request) || "unknown") };
      const { data: updated, error } = await admin.from("vihem_rental_bookings").update({ contract_status: "signed", contract_signed_at: acceptance.accepted_at, contract_signature: signature, contract_signer_name: signerName, contract_acceptance: acceptance }).eq("id", booking.id).eq("organisation_id", organisationId).eq("contract_status", "pending_signature").select("id,public_reference,contract_status").maybeSingle();
      if (error) throw error;
      if (!updated) return reply(409, { error: "Avtalet kunde inte signeras. Ladda om sidan och försök igen.", code: "E_STATE" });
      return reply(200, { booking: updated });
    }

    if (request.method === "GET" && action === "booking") {
      if (!(await allow(admin, request, "lookup", 60, 600))) return reply(429, { error: "För många försök.", code: "E_RATE" });
      const booking: any = await loadBooking("", param("reference"), text(param("token"), 100));
      if (!booking) return reply(404, { error: "Bokningen hittades inte.", code: "E_NOT_FOUND" });
      const { data: settings } = await admin.from("vihem_rental_settings").select("free_cancellation_minutes,access_dispatch_minutes,access_enabled").eq("organisation_id", organisationId).maybeSingle();
      const cutoffMs = new Date(booking.start_at).getTime() - (settings?.free_cancellation_minutes ?? 60) * 60000;
      const { data: codes } = await admin.from("vihem_rental_access_codes").select("status,scheduled_for,sms_status").eq("booking_id", booking.id);
      const codeIssued = (codes || []).some((c: any) => ["issuing", "issued", "sent"].includes(c.status));
      const canCancel = ["pending", "confirmed"].includes(booking.status) && Date.now() < cutoffMs && !booking.short_notice && !codeIssued;
      const access = settings?.access_enabled && (codes || []).length ? {
        // Aldrig själva koden i publika svar. Kunden får den via SMS.
        scheduled_for: (codes || []).map((c: any) => c.scheduled_for).sort()[0] || null,
        sent: (codes || []).every((c: any) => ["sent", "delivered"].includes(c.sms_status)),
        failed: (codes || []).some((c: any) => c.status === "failed" || c.sms_status === "failed"),
      } : null;
      return reply(200, { booking: { ...booking, can_cancel: canCancel, cancel_until: new Date(cutoffMs).toISOString(), access } });
    }

    if (request.method === "POST" && action === "cancel-booking") {
      if (!(await allow(admin, request, "cancel", 10, 600))) return reply(429, { error: "För många försök.", code: "E_RATE" });
      const booking: any = await loadBooking(text(body.booking_id, 80), text(body.reference, 80), text(body.public_lookup_token, 100));
      if (!booking) return reply(404, { error: "Bokningen hittades inte.", code: "E_NOT_FOUND" });
      const { data: result, error } = await admin.rpc("vihem_rental_cancel_booking", { p_booking: booking.id, p_actor: "customer", p_reason: text(body.reason, 500) || null, p_token: text(body.public_lookup_token, 100) });
      if (error) { const m = mapDbError(error); return reply(m.status, { error: m.message, code: m.code }); }
      let refund = "none";
      if (Number(result.refund_amount) > 0) {
        refund = await issueRefund(admin, booking.id, result);
      }
      return reply(200, { ok: true, cancelled: true, refund_amount: Number(result.refund_amount) || 0, refund_status: refund });
    }

    return reply(404, { error: "Okänd åtgärd.", code: "E_ACTION" });
  } catch (error) {
    const m = mapDbError(error);
    return reply(m.status, { error: m.message, code: m.code });
  }
});
