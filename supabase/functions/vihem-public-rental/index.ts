import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(value: unknown, max = 200) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function wholeHourRange(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return (
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime()) &&
    start.getMinutes() === 0 &&
    start.getSeconds() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end > start
  );
}

function normaliseHostname(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/^www\./, "")
    .split(":")[0];
}

async function resolveOrganisation(client: any, request: Request, body: any) {
  const hostname = normaliseHostname(
    body.hostname ||
      new URL(request.url).searchParams.get("hostname") ||
      request.headers
        .get("origin")
        ?.replace(/^https?:\/\//, "")
        .split("/")[0],
  );
  const slug = text(
    body.organisation_slug ||
      new URL(request.url).searchParams.get("organisation_slug"),
  );
  if (hostname) {
    const { data } = await client
      .from("vihem_rental_domains")
      .select("organisation_id")
      .eq("hostname", hostname)
      .eq("active", true)
      .maybeSingle();
    if (data?.organisation_id) return data.organisation_id;

    // Keep the initial ViboRent deployment usable if the domain seed migration
    // has not reached the shared database yet. Only an active organisation
    // with the rental module enabled is eligible for this fallback.
    if (hostname === "viborent.se") {
      const { data: moduleRows } = await client
        .from("vihem_organisation_modules")
        .select("organisation_id")
        .eq("module_key", "rental_management")
        .eq("enabled", true);
      const organisationIds = [
        ...new Set(
          (moduleRows || [])
            .map((row: any) => row.organisation_id)
            .filter(Boolean),
        ),
      ];
      if (organisationIds.length) {
        const { data: organisations } = await client
          .from("vihem_organisations")
          .select("id")
          .in("id", organisationIds)
          .eq("active", true);
        if ((organisations || []).length === 1) return organisations[0].id;
      }
    }
  }
  if (slug) {
    const { data } = await client
      .from("vihem_organisations")
      .select("id")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const url = new URL(request.url);
    const body =
      request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const action = text(
      body.action ||
        url.searchParams.get("action") ||
        url.pathname.split("/").filter(Boolean).pop() ||
        "products",
    );
    const organisationId = await resolveOrganisation(client, request, body);
    if (!organisationId)
      return json({ error: "Kunde inte hitta uthyrningsorganisationen." }, 400);

    const { data: enabled } = await client
      .from("vihem_organisation_modules")
      .select("enabled")
      .eq("organisation_id", organisationId)
      .eq("module_key", "rental_management")
      .maybeSingle();
    if (!enabled?.enabled)
      return json({ error: "Uthyrningsmodulen är inte aktiverad." }, 403);

    if (
      request.method === "GET" &&
      (action === "products" || action === "product")
    ) {
      let query = client
        .from("vihem_rental_products")
        .select(
          "id,name,slug,description,short_description,category,images,deposit,vat_rate,minimum_duration,maximum_duration,pickup_instructions,return_instructions,location,seo_title,seo_description",
        )
        .eq("organisation_id", organisationId)
        .eq("active", true)
        .eq("visible_publicly", true)
        .order("sort_order")
        .order("name");
      const slug = text(url.searchParams.get("slug"));
      if (slug) query = query.eq("slug", slug);
      const { data, error } = await query;
      if (error) throw error;
      return json({ products: data || [] });
    }

    if (request.method === "GET" && action === "site-config") {
      const [
        { data: organisation, error: organisationError },
        { data: settings, error: settingsError },
      ] = await Promise.all([
        client
          .from("vihem_organisations")
          .select("name,slug")
          .eq("id", organisationId)
          .maybeSingle(),
        client
          .from("vihem_rental_settings")
          .select(
            "currency,customer_support_email,customer_support_phone,terms_url,privacy_url,timezone",
          )
          .eq("organisation_id", organisationId)
          .maybeSingle(),
      ]);
      if (organisationError) throw organisationError;
      if (settingsError) throw settingsError;
      return json({
        site: {
          site_name: "ViboRent",
          organisation_name: organisation?.name || "ViboRent",
          organisation_slug: organisation?.slug || "",
          ...settings,
        },
      });
    }

    if (action === "availability") {
      const slug = text(body.slug || url.searchParams.get("slug"));
      const startAt = text(body.start_at || url.searchParams.get("start_at"));
      const endAt = text(body.end_at || url.searchParams.get("end_at"));
      if (!slug || !startAt || !endAt)
        return json({ error: "slug, start_at och end_at krävs." }, 400);
      if (!wholeHourRange(startAt, endAt))
        return json(
          { error: "Bokningar måste börja och sluta på hela timmar." },
          400,
        );
      const { data: product, error: productError } = await client
        .from("vihem_rental_products")
        .select("id,name,slug")
        .eq("organisation_id", organisationId)
        .eq("slug", slug)
        .eq("active", true)
        .eq("visible_publicly", true)
        .maybeSingle();
      if (productError) throw productError;
      if (!product) return json({ error: "Produkten hittades inte." }, 404);
      const { data, error } = await client.rpc(
        "vihem_rental_available_assets",
        {
          target_product_id: product.id,
          target_start_at: startAt,
          target_end_at: endAt,
        },
      );
      if (error) throw error;
      return json({
        product,
        available: (data || []).length > 0,
        assets: data || [],
      });
    }

    if (request.method === "GET" && action === "availability-calendar") {
      const slug = text(url.searchParams.get("slug"));
      const from = text(url.searchParams.get("from"));
      const to = text(url.searchParams.get("to"));
      if (!slug || !from || !to)
        return json({ error: "slug, from och to krävs." }, 400);
      const { data: product, error: productError } = await client
        .from("vihem_rental_products")
        .select("id,name,slug")
        .eq("organisation_id", organisationId)
        .eq("slug", slug)
        .eq("active", true)
        .eq("visible_publicly", true)
        .maybeSingle();
      if (productError) throw productError;
      if (!product) return json({ error: "Produkten hittades inte." }, 404);

      const { data: items, error: itemsError } = await client
        .from("vihem_rental_booking_items")
        .select("booking_id")
        .eq("organisation_id", organisationId)
        .eq("product_id", product.id);
      if (itemsError) throw itemsError;
      const bookingIds = [
        ...new Set(
          (items || []).map((item: any) => item.booking_id).filter(Boolean),
        ),
      ];
      const [bookingResult, blockResult] = await Promise.all([
        bookingIds.length
          ? client
              .from("vihem_rental_bookings")
              .select("id,start_at,end_at,status")
              .eq("organisation_id", organisationId)
              .in("id", bookingIds)
              .lt("start_at", to)
              .gt("end_at", from)
          : Promise.resolve({ data: [], error: null }),
        client
          .from("vihem_rental_blocks")
          .select("start_at,end_at,block_type,reason")
          .eq("organisation_id", organisationId)
          .eq("product_id", product.id)
          .lt("start_at", to)
          .gt("end_at", from),
      ]);
      if (bookingResult.error) throw bookingResult.error;
      if (blockResult.error) throw blockResult.error;
      const bookings = (bookingResult.data || []).filter(
        (booking: any) => !["cancelled", "completed"].includes(booking.status),
      );
      return json({ product, bookings, blocks: blockResult.data || [] });
    }

    if (action === "quote") {
      const slug = text(body.slug);
      if (!wholeHourRange(text(body.start_at), text(body.end_at)))
        return json(
          { error: "Bokningar måste börja och sluta på hela timmar." },
          400,
        );
      const { data: product, error: productError } = await client
        .from("vihem_rental_products")
        .select("id,name,slug")
        .eq("organisation_id", organisationId)
        .eq("slug", slug)
        .eq("active", true)
        .eq("visible_publicly", true)
        .maybeSingle();
      if (productError) throw productError;
      if (!product) return json({ error: "Produkten hittades inte." }, 404);
      const { data, error } = await client.rpc("vihem_rental_quote", {
        target_product_id: product.id,
        target_start_at: body.start_at,
        target_end_at: body.end_at,
        target_quantity: Math.max(1, Number(body.quantity) || 1),
      });
      if (error) throw error;
      return json({ product, quote: data });
    }

    if (request.method === "POST" && action === "quote-cart") {
      const items = Array.isArray(body.items) ? body.items : [];
      const startAt = text(body.start_at);
      const endAt = text(body.end_at);
      if (!items.length || !wholeHourRange(startAt, endAt))
        return json({ error: "Varukorgen och en giltig heltimmeperiod krävs." }, 400);
      const lines: any[] = [];
      let subtotal = 0;
      let vatAmount = 0;
      let deposit = 0;
      let currency = "SEK";
      for (const item of items) {
        const productId = text(item.product_id, 80);
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const { data: product, error: productError } = await client
          .from("vihem_rental_products")
          .select("id,name,slug")
          .eq("organisation_id", organisationId)
          .eq("id", productId)
          .eq("active", true)
          .eq("visible_publicly", true)
          .maybeSingle();
        if (productError) throw productError;
        if (!product) return json({ error: "En produkt i varukorgen hittades inte." }, 404);
        const { data: quote, error: quoteError } = await client.rpc("vihem_rental_quote", {
          target_product_id: product.id,
          target_start_at: startAt,
          target_end_at: endAt,
          target_quantity: quantity,
        });
        if (quoteError) throw quoteError;
        subtotal += Number(quote.subtotal || 0);
        vatAmount += Number(quote.vat_amount || 0);
        deposit += Number(quote.deposit || 0);
        currency = quote.currency || currency;
        lines.push({ product_id: product.id, product_name: product.name, quantity, quote });
      }
      return json({ quote: { subtotal, vat_amount: vatAmount, deposit, total: subtotal + vatAmount, currency, lines } });
    }

    if (request.method === "POST" && action === "bookings") {
      if (Array.isArray(body.items)) {
        const startAt = text(body.start_at);
        const endAt = text(body.end_at);
        if (!wholeHourRange(startAt, endAt))
          return json({ error: "Bokningar måste börja och sluta på hela timmar." }, 400);
        const items = body.items.map((item: any) => ({
          product_id: text(item.product_id, 80),
          quantity: Math.max(1, Number(item.quantity) || 1),
        }));
        const { data, error } = await client.rpc("vihem_create_rental_booking_multi", {
          target_items: items,
          target_start_at: startAt,
          target_end_at: endAt,
          target_customer: body.customer || {},
          target_source: "viborent.se",
          target_status: "pending",
          target_customer_notes: text(body.customer_notes, 2000),
        });
        if (error) throw error;
        const { data: lookup, error: lookupError } = await client
          .from("vihem_rental_bookings")
          .select("public_lookup_token")
          .eq("id", data?.id)
          .eq("organisation_id", organisationId)
          .maybeSingle();
        if (lookupError) throw lookupError;
        return json({ booking: { ...data, public_lookup_token: lookup?.public_lookup_token || null } }, 201);
      }
      const slug = text(body.slug);
      if (!wholeHourRange(text(body.start_at), text(body.end_at)))
        return json(
          { error: "Bokningar måste börja och sluta på hela timmar." },
          400,
        );
      const { data: product, error: productError } = await client
        .from("vihem_rental_products")
        .select("id")
        .eq("organisation_id", organisationId)
        .eq("slug", slug)
        .eq("active", true)
        .eq("visible_publicly", true)
        .maybeSingle();
      if (productError) throw productError;
      if (!product) return json({ error: "Produkten hittades inte." }, 404);
      const { data, error } = await client.rpc("vihem_create_rental_booking", {
        target_product_id: product.id,
        target_start_at: body.start_at,
        target_end_at: body.end_at,
        target_quantity: Math.max(1, Number(body.quantity) || 1),
        target_customer: body.customer || {},
        target_source: "viborent.se",
        target_status: "pending",
        target_customer_notes: text(body.customer_notes, 2000),
      });
      if (error) throw error;
      const bookingId = data?.id;
      const { data: lookup, error: lookupError } = await client
        .from("vihem_rental_bookings")
        .select("public_lookup_token")
        .eq("id", bookingId)
        .eq("organisation_id", organisationId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      return json(
        {
          booking: {
            ...data,
            public_lookup_token: lookup?.public_lookup_token || null,
          },
        },
        201,
      );
    }

    if (request.method === "POST" && action === "sign-contract") {
      const bookingId = text(body.booking_id, 80);
      const token = text(body.public_lookup_token, 100);
      const signerName = text(body.signer_name, 200);
      const signature = text(body.signature, 500000);
      if (!bookingId || !token || !signerName || !signature || body.accepted_terms !== true)
        return json({ error: "Namn, signatur och godkända villkor krävs." }, 400);
      const { data: booking, error: bookingError } = await client
        .from("vihem_rental_bookings")
        .select("id,public_reference,contract_status")
        .eq("id", bookingId)
        .eq("organisation_id", organisationId)
        .eq("public_lookup_token", token)
        .maybeSingle();
      if (bookingError) throw bookingError;
      if (!booking) return json({ error: "Bokningen hittades inte." }, 404);
      if (booking.contract_status === "signed") return json({ booking });
      const { data: updated, error: updateError } = await client
        .from("vihem_rental_bookings")
        .update({
          contract_status: "signed",
          contract_signed_at: new Date().toISOString(),
          contract_signature: signature,
          contract_signer_name: signerName,
        })
        .eq("id", booking.id)
        .eq("organisation_id", organisationId)
        .eq("contract_status", "pending_signature")
        .select("id,public_reference,contract_status")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return json({ error: "Avtalet kunde inte signeras. Försök igen." }, 409);
      return json({ booking: updated });
    }

    if (request.method === "GET" && action === "booking") {
      const reference = text(url.searchParams.get("reference"));
      const token = text(url.searchParams.get("token"), 100);
      if (!reference || !token)
        return json({ error: "reference och token krävs." }, 400);
      const { data: booking, error: bookingError } = await client
        .from("vihem_rental_bookings")
        .select(
          "id,public_reference,status,payment_status,contract_status,contract_signer_name,contract_signed_at,start_at,end_at,subtotal,vat_amount,deposit,total,currency,customer_notes,customer:vihem_rental_customers(first_name,last_name,email,phone),items:vihem_rental_booking_items(quantity,product:vihem_rental_products(name,slug,pickup_instructions,return_instructions,location))",
        )
        .eq("organisation_id", organisationId)
        .eq("public_reference", reference)
        .eq("public_lookup_token", token)
        .maybeSingle();
      if (bookingError) throw bookingError;
      if (!booking) return json({ error: "Bokningen hittades inte." }, 404);
      return json({ booking });
    }

    return json({ error: "Okänd uthyrningsåtgärd." }, 404);
  } catch (error) {
    console.error("vihem-public-rental error:", error);
    return json(
      {
        error:
          error instanceof Error ? error.message : "Ett oväntat fel uppstod.",
      },
      500,
    );
  }
});
