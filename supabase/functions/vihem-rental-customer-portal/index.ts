import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function authToken(request: Request) {
  return request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
}

async function currentUser(request: Request, supabase: any) {
  const token = authToken(request);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function portalCustomer(supabase: any, userId: string) {
  const { data: portal } = await supabase
    .from("vihem_rental_portal_users")
    .select("organisation_id,customer_id,status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (portal?.status === "disabled") return null;
  if (portal?.status === "active" || portal?.status === "invited") {
    const { data: customer } = await supabase
      .from("vihem_rental_customers")
      .select("*")
      .eq("id", portal.customer_id)
      .eq("organisation_id", portal.organisation_id)
      .maybeSingle();
    if (customer) return { portal, customer };
  }
  const { data: customer } = await supabase
    .from("vihem_rental_customers")
    .select("*")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return customer ? { portal: { organisation_id: customer.organisation_id, customer_id: customer.id, status: "active" }, customer } : null;
}

async function customerData(supabase: any, customer: any) {
  const [bookingsResult, requestsResult, messagesResult] = await Promise.all([
    supabase
      .from("vihem_rental_bookings")
      .select("id,public_reference,status,payment_status,payment_provider,start_at,end_at,subtotal,vat_amount,deposit,total,currency,customer_notes,items:vihem_rental_booking_items(quantity,start_at,end_at,product:vihem_rental_products(name,slug,location,pickup_instructions,return_instructions))")
      .eq("organisation_id", customer.organisation_id)
      .eq("customer_id", customer.id)
      .order("start_at", { ascending: false }),
    supabase
      .from("vihem_rental_customer_requests")
      .select("id,booking_id,request_type,subject,message,status,staff_reply,created_at,updated_at")
      .eq("organisation_id", customer.organisation_id)
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("vihem_rental_customer_messages")
      .select("id,booking_id,request_id,direction,message,created_at,read_at")
      .eq("organisation_id", customer.organisation_id)
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: true }),
  ]);
  if (bookingsResult.error) throw bookingsResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (messagesResult.error) throw messagesResult.error;
  return { bookings: bookingsResult.data || [], requests: requestsResult.data || [], messages: messagesResult.data || [] };
}

async function requireStaff(request: Request, supabase: any) {
  const user = await currentUser(request, supabase);
  if (!user) return null;
  const { data: profile } = await supabase.from("vihem_profiles").select("id,role,organisation_id").eq("id", user.id).maybeSingle();
  if (!profile || !["staff", "admin", "superadmin"].includes(profile.role)) return null;
  return { user, profile };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const url = new URL(request.url);
    const action = text(body.action || url.searchParams.get("action") || "me", 80);

    if (action === "provision") {
      const staff = await requireStaff(request, supabase);
      if (!staff || !["admin", "superadmin"].includes(staff.profile.role)) return json({ error: "Administratörsbehörighet krävs." }, 403);
      const organisationId = text(body.organisation_id, 80);
      const customerId = text(body.customer_id, 80);
      if (!organisationId || !customerId) return json({ error: "organisation_id och customer_id krävs." }, 400);
      if (staff.profile.role !== "superadmin" && staff.profile.organisation_id !== organisationId) return json({ error: "Organisationen kan inte användas här." }, 403);
      const { data: customer, error: customerError } = await supabase.from("vihem_rental_customers").select("id,email,first_name,last_name,organisation_id,auth_user_id").eq("id", customerId).eq("organisation_id", organisationId).maybeSingle();
      if (customerError) throw customerError;
      if (!customer?.email) return json({ error: "Kunden måste ha en e-postadress." }, 400);
      let authUserId = customer.auth_user_id;
      let invited = false;
      if (!authUserId) {
        const { data: invitedUser, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(customer.email, { data: { vihem_portal: true, organisation_id: organisationId, customer_id: customerId }, redirectTo: Deno.env.get("VIBOFAST_PORTAL_URL") || "https://vibofast.se" });
        if (inviteError) {
          const { data: listed } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const existing = listed?.users?.find((candidate: any) => candidate.email?.toLowerCase() === customer.email.toLowerCase());
          if (!existing) throw inviteError;
          authUserId = existing.id;
        } else {
          authUserId = invitedUser.user.id;
          invited = true;
        }
        await supabase.from("vihem_rental_customers").update({ auth_user_id: authUserId, updated_at: new Date().toISOString() }).eq("id", customerId).eq("organisation_id", organisationId);
      }
      const { error: portalError } = await supabase.from("vihem_rental_portal_users").upsert({ organisation_id: organisationId, customer_id: customerId, auth_user_id: authUserId, status: "invited", invited_at: new Date().toISOString() }, { onConflict: "organisation_id,customer_id" });
      if (portalError) throw portalError;
      return json({ ok: true, invited, auth_user_id: authUserId });
    }

    if (action === "staff_message" || action === "resolve_request") {
      const staff = await requireStaff(request, supabase);
      const organisationId = text(body.organisation_id, 80);
      if (!staff || (staff.profile.role !== "superadmin" && staff.profile.organisation_id !== organisationId)) return json({ error: "Personalbehörighet krävs." }, 403);
      const customerId = text(body.customer_id, 80);
      const { data: targetCustomer } = await supabase.from("vihem_rental_customers").select("id,organisation_id").eq("id", customerId).eq("organisation_id", organisationId).maybeSingle();
      if (!targetCustomer) return json({ error: "Kunden hittades inte." }, 404);
      if (action === "staff_message") {
        const message = text(body.message, 4000);
        const bookingId = text(body.booking_id, 80) || null;
        if (!message) return json({ error: "Meddelandet får inte vara tomt." }, 400);
        if (bookingId) {
          const { data: booking } = await supabase.from("vihem_rental_bookings").select("id").eq("id", bookingId).eq("customer_id", customerId).eq("organisation_id", organisationId).maybeSingle();
          if (!booking) return json({ error: "Bokningen hittades inte." }, 404);
        }
        const { data, error } = await supabase.from("vihem_rental_customer_messages").insert({ organisation_id: organisationId, customer_id: customerId, booking_id: bookingId, request_id: text(body.request_id, 80) || null, direction: "staff", message, created_by: staff.user.id }).select("id,booking_id,request_id,message,direction,created_at").single();
        if (error) throw error;
        return json({ message: data }, 201);
      }
      const requestId = text(body.request_id, 80);
      const status = text(body.status, 30);
      if (!requestId || !["open", "in_progress", "resolved", "cancelled"].includes(status)) return json({ error: "request_id och giltig status krävs." }, 400);
      const reply = text(body.staff_reply, 4000);
      const { data: requestRow, error } = await supabase.from("vihem_rental_customer_requests").update({ status, staff_reply: reply || null, handled_by: staff.user.id, resolved_at: status === "resolved" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", requestId).eq("organisation_id", organisationId).eq("customer_id", customerId).select("id,booking_id,status,staff_reply,updated_at").single();
      if (error) throw error;
      if (reply) await supabase.from("vihem_rental_customer_messages").insert({ organisation_id: organisationId, customer_id: customerId, booking_id: requestRow.booking_id, request_id: requestId, direction: "staff", message: reply, created_by: staff.user.id });
      return json({ request: requestRow });
    }

    const user = await currentUser(request, supabase);
    if (!user) return json({ error: "Du måste logga in." }, 401);
    const linked = await portalCustomer(supabase, user.id);
    if (!linked) return json({ error: "Kundkontot är inte kopplat till någon uthyrningskund." }, 403);
    const { customer } = linked;

    if (action === "me") return json({ customer, ...(await customerData(supabase, customer)) });

    if (action === "request") {
      const type = text(body.request_type, 40);
      const message = text(body.message, 4000);
      if (!["change_booking", "cancel_booking", "question", "message"].includes(type) || !message) return json({ error: "Välj ärendetyp och skriv ett meddelande." }, 400);
      const bookingId = text(body.booking_id, 80) || null;
      if (bookingId) {
        const { data: booking } = await supabase.from("vihem_rental_bookings").select("id").eq("id", bookingId).eq("customer_id", customer.id).eq("organisation_id", customer.organisation_id).maybeSingle();
        if (!booking) return json({ error: "Bokningen hittades inte." }, 404);
      }
      const { data: requestRow, error } = await supabase.from("vihem_rental_customer_requests").insert({ organisation_id: customer.organisation_id, customer_id: customer.id, booking_id: bookingId, request_type: type, subject: text(body.subject, 200), message, created_by: user.id }).select("id,booking_id,request_type,subject,message,status,created_at").single();
      if (error) throw error;
      await supabase.from("vihem_rental_customer_messages").insert({ organisation_id: customer.organisation_id, customer_id: customer.id, booking_id: bookingId, request_id: requestRow.id, direction: "customer", message, created_by: user.id });
      return json({ request: requestRow }, 201);
    }

    if (action === "message") {
      const message = text(body.message, 4000);
      const bookingId = text(body.booking_id, 80) || null;
      if (!message) return json({ error: "Meddelandet får inte vara tomt." }, 400);
      if (bookingId) {
        const { data: booking } = await supabase.from("vihem_rental_bookings").select("id").eq("id", bookingId).eq("customer_id", customer.id).eq("organisation_id", customer.organisation_id).maybeSingle();
        if (!booking) return json({ error: "Bokningen hittades inte." }, 404);
      }
      const { data, error } = await supabase.from("vihem_rental_customer_messages").insert({ organisation_id: customer.organisation_id, customer_id: customer.id, booking_id: bookingId, direction: "customer", message, created_by: user.id }).select("id,booking_id,message,direction,created_at").single();
      if (error) throw error;
      return json({ message: data }, 201);
    }

    if (action === "staff_message") {
      const staff = await requireStaff(request, supabase);
      if (!staff || (staff.profile.role !== "superadmin" && staff.profile.organisation_id !== customer.organisation_id)) return json({ error: "Personalbehörighet krävs." }, 403);
      const message = text(body.message, 4000);
      const bookingId = text(body.booking_id, 80) || null;
      if (!message) return json({ error: "Meddelandet får inte vara tomt." }, 400);
      if (bookingId) {
        const { data: booking } = await supabase.from("vihem_rental_bookings").select("id").eq("id", bookingId).eq("customer_id", customer.id).eq("organisation_id", customer.organisation_id).maybeSingle();
        if (!booking) return json({ error: "Bokningen hittades inte." }, 404);
      }
      const { data, error } = await supabase.from("vihem_rental_customer_messages").insert({ organisation_id: customer.organisation_id, customer_id: customer.id, booking_id: bookingId, request_id: text(body.request_id, 80) || null, direction: "staff", message, created_by: staff.user.id }).select("id,booking_id,request_id,message,direction,created_at").single();
      if (error) throw error;
      return json({ message: data }, 201);
    }

    if (action === "resolve_request") {
      const staff = await requireStaff(request, supabase);
      if (!staff || (staff.profile.role !== "superadmin" && staff.profile.organisation_id !== customer.organisation_id)) return json({ error: "Personalbehörighet krävs." }, 403);
      const requestId = text(body.request_id, 80);
      const status = text(body.status, 30);
      if (!requestId || !["open", "in_progress", "resolved", "cancelled"].includes(status)) return json({ error: "request_id och giltig status krävs." }, 400);
      const reply = text(body.staff_reply, 4000);
      const { data: requestRow, error } = await supabase.from("vihem_rental_customer_requests").update({ status, staff_reply: reply || null, handled_by: staff.user.id, resolved_at: status === "resolved" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", requestId).eq("organisation_id", customer.organisation_id).eq("customer_id", customer.id).select("id,booking_id,status,staff_reply,updated_at").single();
      if (error) throw error;
      if (reply) await supabase.from("vihem_rental_customer_messages").insert({ organisation_id: customer.organisation_id, customer_id: customer.id, booking_id: requestRow.booking_id, request_id: requestId, direction: "staff", message: reply, created_by: staff.user.id });
      return json({ request: requestRow });
    }

    return json({ error: "Okänd portalåtgärd." }, 404);
  } catch (error) {
    console.error("vihem-rental-customer-portal error:", error);
    return json({ error: error instanceof Error ? error.message : "Ett oväntat fel uppstod." }, 500);
  }
});
