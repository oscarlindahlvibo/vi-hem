// Publikt API för kompetensportalen.se (verify_jwt = false). Organisation avgörs av Origin; inget här ger tillgång till kursinnehåll eller personuppgifter.
// Katalog, kurssidor, informationssidor, certifikatverifiering, pris/rabattberäkning och kontaktformulär.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { bankidCollect, bankidSettings, bankidStart, pnoHmac } from "../_shared/kp-bankid.ts";
import { allow, corsFor, EMAIL, fingerprint, clientIp, isUuid, kpContext, mapKpError, text, userFromRequest } from "../_shared/kp-common.ts";

Deno.serve(async (request: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const url = new URL(request.url);
  const ctx = await kpContext(admin, request, true);
  const base = corsFor(request, ctx);
  const reply = (status: number, body: unknown, cache?: string) => new Response(JSON.stringify(body), { status, headers: { ...base, "Content-Type": "application/json", ...(cache ? { "Cache-Control": cache } : {}) } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  if (!ctx) return reply(404, { error: "Webbplatsen är inte konfigurerad.", code: "E_DOMAIN" });
  const org = ctx.organisationId;
  try {
    let body: any = {};
    if (request.method === "POST") { const raw = await request.text(); if (raw.length > 50_000) return reply(413, { error: "För stor förfrågan." }); body = raw ? JSON.parse(raw) : {}; }
    const action = text(body.action ?? url.searchParams.get("action") ?? "catalog", 40);
    const param = (k: string) => text(body[k] ?? url.searchParams.get(k), 200);

    const courseFields = "id,slug,code,title,subtitle,summary,category,tags,delivery_form,language,estimated_minutes,validity_months,id06_enabled,certificate_kind,requires_identity_verification,image_url,og_image_url,sort_order,published_version_id";
    const withProducts = async (courses: any[]) => {
      const ids = courses.map((c) => c.id);
      const { data: products } = ids.length ? await admin.from("vihem_kp_products").select("id,course_id,price,vat_rate,sku,name").eq("organisation_id", org).eq("active", true).eq("kind", "course").in("course_id", ids) : { data: [] };
      const { data: sessions } = ids.length ? await admin.from("vihem_kp_sessions").select("course_id,starts_at").eq("organisation_id", org).eq("status", "open").gt("starts_at", new Date().toISOString()).in("course_id", ids).order("starts_at") : { data: [] };
      return courses.map((c) => {
        const p = (products ?? []).find((x: any) => x.course_id === c.id && !x.session_id);
        const next = (sessions ?? []).filter((s: any) => s.course_id === c.id);
        return { ...c, product: p ? { id: p.id, price: Number(p.price), vat_rate: Number(p.vat_rate) } : null, next_session_at: next[0]?.starts_at ?? null, session_count: next.length };
      });
    };

    if (request.method === "GET" && action === "catalog") {
      const { data } = await admin.from("vihem_kp_courses").select(courseFields).eq("organisation_id", org).in("status", ["published", "coming_soon"]).order("sort_order").order("title");
      return reply(200, { courses: await withProducts(data ?? []) }, "public, max-age=60");
    }

    if (request.method === "GET" && action === "course") {
      const slug = param("slug");
      const { data: course } = await admin.from("vihem_kp_courses").select(`${courseFields},description,objectives,target_audience,prerequisites,exam_info,seo_title,seo_description,status`).eq("organisation_id", org).eq("slug", slug).in("status", ["published", "coming_soon"]).maybeSingle();
      if (!course) return reply(404, { error: "Utbildningen hittades inte.", code: "E_NOT_FOUND" });
      const [enriched] = await withProducts([course]);
      let outline: any[] = [], exam: any = null;
      if (course.published_version_id) {
        const { data: mods } = await admin.from("vihem_kp_modules").select("id,title,description,sort_order").eq("version_id", course.published_version_id).order("sort_order");
        const { data: lessons } = await admin.from("vihem_kp_lessons").select("module_id,title,kind,estimated_minutes,sort_order,required").eq("version_id", course.published_version_id).order("sort_order");
        outline = (mods ?? []).map((m: any) => ({ title: m.title, description: m.description, lessons: (lessons ?? []).filter((l: any) => l.module_id === m.id).map((l: any) => ({ title: l.title, kind: l.kind, minutes: l.estimated_minutes })) }));
        const { data: e } = await admin.from("vihem_kp_exams").select("title,question_count,pass_percent,time_limit_seconds,max_attempts").eq("version_id", course.published_version_id).eq("kind", "final").maybeSingle();
        exam = e ?? null;
      }
      const { data: sessions } = await admin.rpc("vihem_kp_session_public", { p_org: org, p_course: course.id });
      const { published_version_id: _v, ...pub } = enriched as any;
      return reply(200, { course: { ...pub, outline, exam, sessions: sessions ?? [] } }, "public, max-age=60");
    }

    if (request.method === "GET" && action === "sessions") {
      const { data } = await admin.rpc("vihem_kp_session_public", { p_org: org, p_course: isUuid(param("course_id")) ? param("course_id") : null });
      return reply(200, { sessions: data ?? [] }, "public, max-age=30");
    }

    if (request.method === "GET" && action === "page") {
      const { data } = await admin.from("vihem_kp_site_pages").select("slug,kind,title,version,published_at").eq("organisation_id", org).eq("slug", param("slug")).eq("status", "published").maybeSingle();
      if (!data) return reply(404, { error: "Sidan finns inte.", code: "E_NOT_FOUND" });
      const { data: ver } = await admin.from("vihem_kp_site_page_versions").select("body").eq("organisation_id", org).eq("page_id", (await admin.from("vihem_kp_site_pages").select("id").eq("organisation_id", org).eq("slug", param("slug")).single()).data!.id).eq("version", data.version).maybeSingle();
      return reply(200, { page: { ...data, body: ver?.body ?? "" } }, "public, max-age=120");
    }

    if (request.method === "GET" && action === "faq") {
      const { data } = await admin.from("vihem_kp_faq").select("category,question,answer,sort_order").eq("organisation_id", org).eq("active", true).order("category").order("sort_order");
      return reply(200, { faq: data ?? [] }, "public, max-age=120");
    }

    if (request.method === "GET" && action === "site") {
      const s = ctx.settings;
      const bankid = !!Deno.env.get("VIHEM_KP_SECRET_KEY") && !!(await bankidSettings(admin, org, "link"));
      const bankidLogin = bankid && !!(await bankidSettings(admin, org, "login"));
      return reply(200, { site: { bankid_link: bankid, bankid_login: bankidLogin, seller_name: s.seller_name, seller_org_number: s.seller_org_number, seller_vat_number: s.seller_vat_number, seller_address: s.seller_address, support_email: s.support_email || s.seller_email, phone: s.seller_phone, invoice_enabled: s.invoice_enabled, stripe_enabled: s.stripe_enabled, withdrawal_notice: s.withdrawal_notice } }, "public, max-age=120");
    }

    if (request.method === "GET" && action === "verify") {
      if (!(await allow(admin, request, "kp-verify", 40, 600))) return reply(429, { error: "För många kontroller. Försök igen om en stund." });
      const code = param("code");
      if (code.length < 6) return reply(400, { error: "Ange verifieringskod eller intygsnummer." });
      const { data } = await admin.rpc("vihem_kp_verify_certificate", { p_code: code });
      return reply(200, data ?? { found: false }, "no-store");
    }

    if (request.method === "POST" && action === "quote") {
      if (!(await allow(admin, request, "kp-quote", 120, 60))) return reply(429, { error: "För många förfrågningar.", code: "E_RATE" });
      const user = await userFromRequest(admin, request);
      let customerId: string | null = null;
      if (user && isUuid(body.customer_id)) {
        const { data: m } = await admin.from("vihem_kp_company_members").select("id").eq("customer_id", body.customer_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
        if (m) customerId = body.customer_id;
      }
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30).map((i: any) => ({ product_id: text(i.product_id, 60), quantity: Math.floor(Number(i.quantity) || 0), session_id: isUuid(i.session_id) ? i.session_id : null }));
      const { data, error } = await admin.rpc("vihem_kp_quote", { p_org: org, p_items: items, p_customer: customerId, p_code: text(body.code, 40) || null });
      if (error) { const m = mapKpError(error); return reply(m.status, { error: m.message, code: m.code }); }
      return reply(200, { quote: data });
    }

    if (request.method === "POST" && action === "contact") {
      if (!(await allow(admin, request, "kp-contact", 5, 3600))) return reply(429, { error: "Du har skickat flera meddelanden nyligen. Försök igen senare." });
      if (text(body.website, 100)) return reply(201, { ok: true }); // honeypot
      const email = text(body.email, 200).toLowerCase(), name = text(body.name, 120), message = text(body.message, 4000);
      if (!EMAIL.test(email) || name.length < 2 || message.length < 10) return reply(400, { error: "Fyll i namn, e-post och meddelande.", code: "E_INVALID" });
      const to = String(ctx.settings.support_email || ctx.settings.seller_email || "").trim();
      if (!to) return reply(503, { error: "Kontaktformuläret är inte konfigurerat ännu. Ring eller mejla oss.", code: "E_CONFIG" });
      const key = `contact-${await fingerprint(`${email}:${message}`)}`.slice(0, 60);
      await admin.from("vihem_kp_email_outbox").upsert({ organisation_id: org, template_key: "contact_message", to_email: to, to_name: "Support", subject: `Meddelande via kompetensportalen.se från ${name}`, body: `Från: ${name} <${email}>\n\n${message}`, idempotency_key: key, related_type: "contact" }, { onConflict: "organisation_id,idempotency_key", ignoreDuplicates: true });
      return reply(201, { ok: true });
    }

    // ------------------------------------------------------------ BankID-inloggning (endast konton som själva kopplat BankID via "Verifiera med BankID")
    if (request.method === "POST" && action === "bankid_start") {
      if (!(await allow(admin, request, "kp-bankid-start", 20, 600))) return reply(429, { error: "För många försök. Vänta en stund.", code: "E_RATE" });
      const s = Deno.env.get("VIHEM_KP_SECRET_KEY") ? await bankidSettings(admin, org, "login") : null;
      if (!s) return reply(503, { error: "BankID-inloggning är inte aktiverad.", code: "E_CONFIG" });
      const started = await bankidStart(s, "Logga in på Kompetensportalen", clientIp(request));
      await admin.from("vihem_kp_bankid_orders").insert({ order_ref: started.orderRef, organisation_id: org, flow: "auth" });
      return reply(200, started);
    }
    if (request.method === "POST" && action === "bankid_collect") {
      if (!(await allow(admin, request, "kp-bankid-collect", 240, 600))) return reply(429, { error: "För många förfrågningar.", code: "E_RATE" });
      const ref = text(body.order_ref, 100);
      const { data: order } = await admin.from("vihem_kp_bankid_orders").select("*").eq("order_ref", ref).eq("organisation_id", org).eq("flow", "auth").maybeSingle();
      if (!order || order.consumed_at || new Date(order.expires_at) < new Date()) return reply(410, { error: "BankID-sessionen har gått ut. Starta om.", code: "E_EXPIRED" });
      const s = await bankidSettings(admin, org, "login");
      if (!s) return reply(503, { error: "BankID-inloggning är inte aktiverad.", code: "E_CONFIG" });
      const r = await bankidCollect(s, ref);
      if (r.status === "pending") return reply(200, { status: "pending", hintCode: r.hintCode ?? null });
      // Ordern förbrukas direkt (atomiskt) så att ett lyckat svar bara kan ge en session en gång
      const { data: claimed } = await admin.from("vihem_kp_bankid_orders").update({ status: r.status, consumed_at: new Date().toISOString() }).eq("order_ref", ref).is("consumed_at", null).select("order_ref");
      if (!claimed?.length) return reply(410, { error: "BankID-sessionen har redan använts.", code: "E_EXPIRED" });
      if (r.status !== "complete") return reply(200, { status: "failed", hintCode: r.hintCode ?? null });
      const { data: ident } = await admin.from("vihem_kp_participant_identity").select("user_id").eq("organisation_id", org).eq("pno_hmac", await pnoHmac(r.personalNumber!)).eq("verified_method", "bankid").maybeSingle();
      const { data: found } = ident ? await admin.auth.admin.getUserById(ident.user_id) : { data: null };
      if (!found?.user?.email) return reply(200, { status: "complete", login_ready: false, error: "Inget konto är kopplat till detta BankID. Logga in med e-post och lösenord och välj ”Verifiera med BankID” under Mina sidor." });
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email: found.user.email });
      if (link.error || !link.data?.properties?.hashed_token) { console.error("kp bankid generateLink", link.error?.message); return reply(500, { error: "BankID godkändes men sessionen kunde inte skapas.", code: "E_INTERNAL" }); }
      await admin.rpc("vihem_kp_audit", { p_org: org, p_actor: ident!.user_id, p_kind: "user", p_action: "bankid_login", p_type: "participant", p_id: ident!.user_id, p_detail: {} });
      return reply(200, { status: "complete", login_ready: true, token_hash: link.data.properties.hashed_token });
    }

    // ------------------------------------------------------------ Konto: registrering, e-postbekräftelse, lösenordsåterställning (egna, märkta mejl)
    const sha = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const newToken = async (userId: string, kind: "verify" | "reset", hours: number) => {
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
      await admin.from("vihem_kp_auth_tokens").update({ used_at: new Date().toISOString() }).eq("user_id", userId).eq("kind", kind).is("used_at", null);
      await admin.from("vihem_kp_auth_tokens").insert({ organisation_id: org, user_id: userId, kind, token_hash: await sha(token), expires_at: new Date(Date.now() + hours * 3600_000).toISOString() });
      return token;
    };
    const passwordOk = (p: string) => p.length >= 10 && p.length <= 200 && /[a-zA-Zåäö]/.test(p) && /\d/.test(p);
    const generic = { ok: true, message: "Om adressen kan användas har vi skickat ett mejl med fortsatta instruktioner." };

    if (request.method === "POST" && action === "register") {
      if (!(await allow(admin, request, "kp-register", 6, 3600))) return reply(429, { error: "För många registreringsförsök. Försök igen senare.", code: "E_RATE" });
      const email = text(body.email, 200).toLowerCase(), first = text(body.first_name, 120), last = text(body.last_name, 120), password = String(body.password ?? "");
      if (!EMAIL.test(email) || first.length < 1 || last.length < 1) return reply(400, { error: "Fyll i förnamn, efternamn och en giltig e-postadress.", code: "E_INVALID" });
      if (!passwordOk(password)) return reply(400, { error: "Lösenordet måste vara minst 10 tecken och innehålla både bokstäver och siffror.", code: "E_INVALID" });
      if (body.accepted_privacy !== true) return reply(400, { error: "Du måste ta del av integritetspolicyn.", code: "E_TERMS" });
      const { data: existing } = await admin.rpc("vihem_kp_find_user", { p_email: email });
      if (existing?.length) {
        if (!existing[0].confirmed) { const t = await newToken(existing[0].id, "verify", 48); await admin.rpc("vihem_kp_queue_email", { p_org: org, p_key: "verify_email", p_to: email, p_name: first, p_vars: { name: first, link: `${ctx.baseUrl}/bekrafta?token=${t}` }, p_idem: `verify-${existing[0].id}-${t.slice(0, 8)}`, p_related_type: "user", p_related_id: existing[0].id, p_attachment: null }); }
        return reply(201, generic);
      }
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: false, user_metadata: { first_name: first, last_name: last } });
      if (error || !created?.user) { console.error("kp register:", error?.message); return reply(201, generic); }
      const t = await newToken(created.user.id, "verify", 48);
      await admin.rpc("vihem_kp_queue_email", { p_org: org, p_key: "verify_email", p_to: email, p_name: first, p_vars: { name: first, link: `${ctx.baseUrl}/bekrafta?token=${t}` }, p_idem: `verify-${created.user.id}-${t.slice(0, 8)}`, p_related_type: "user", p_related_id: created.user.id, p_attachment: null });
      return reply(201, generic);
    }
    if (request.method === "POST" && action === "verify_email") {
      if (!(await allow(admin, request, "kp-verify-email", 20, 3600))) return reply(429, { error: "För många försök.", code: "E_RATE" });
      const { data: tok } = await admin.from("vihem_kp_auth_tokens").select("id,user_id,expires_at,used_at").eq("token_hash", await sha(text(body.token, 100))).eq("kind", "verify").maybeSingle();
      if (!tok || tok.used_at || new Date(tok.expires_at) < new Date()) return reply(400, { error: "Länken är ogiltig eller har gått ut. Begär en ny bekräftelselänk.", code: "E_INVALID" });
      const { error } = await admin.auth.admin.updateUserById(tok.user_id, { email_confirm: true });
      if (error) throw error;
      await admin.from("vihem_kp_auth_tokens").update({ used_at: new Date().toISOString() }).eq("id", tok.id);
      return reply(200, { ok: true });
    }
    if (request.method === "POST" && (action === "resend_verification" || action === "request_reset")) {
      if (!(await allow(admin, request, `kp-${action}`, 5, 3600))) return reply(429, { error: "För många försök. Försök igen senare.", code: "E_RATE" });
      const email = text(body.email, 200).toLowerCase();
      if (!EMAIL.test(email)) return reply(400, { error: "Ange en giltig e-postadress.", code: "E_INVALID" });
      const { data: u } = await admin.rpc("vihem_kp_find_user", { p_email: email });
      const user = u?.[0];
      if (user && action === "resend_verification" && !user.confirmed) { const t = await newToken(user.id, "verify", 48); await admin.rpc("vihem_kp_queue_email", { p_org: org, p_key: "verify_email", p_to: email, p_name: user.first_name, p_vars: { name: user.first_name, link: `${ctx.baseUrl}/bekrafta?token=${t}` }, p_idem: `verify-${user.id}-${t.slice(0, 8)}`, p_related_type: "user", p_related_id: user.id, p_attachment: null }); }
      if (user && action === "request_reset" && user.confirmed) { const t = await newToken(user.id, "reset", 2); await admin.rpc("vihem_kp_queue_email", { p_org: org, p_key: "password_reset", p_to: email, p_name: user.first_name, p_vars: { name: user.first_name, link: `${ctx.baseUrl}/nytt-losenord?token=${t}` }, p_idem: `reset-${user.id}-${t.slice(0, 8)}`, p_related_type: "user", p_related_id: user.id, p_attachment: null }); }
      return reply(200, generic);
    }
    if (request.method === "POST" && action === "reset_password") {
      if (!(await allow(admin, request, "kp-reset-password", 10, 3600))) return reply(429, { error: "För många försök.", code: "E_RATE" });
      const password = String(body.password ?? "");
      if (!passwordOk(password)) return reply(400, { error: "Lösenordet måste vara minst 10 tecken och innehålla både bokstäver och siffror.", code: "E_INVALID" });
      const { data: tok } = await admin.from("vihem_kp_auth_tokens").select("id,user_id,expires_at,used_at").eq("token_hash", await sha(text(body.token, 100))).eq("kind", "reset").maybeSingle();
      if (!tok || tok.used_at || new Date(tok.expires_at) < new Date()) return reply(400, { error: "Länken är ogiltig eller har gått ut. Begär en ny.", code: "E_INVALID" });
      const { error } = await admin.auth.admin.updateUserById(tok.user_id, { password });
      if (error) throw error;
      await admin.from("vihem_kp_auth_tokens").update({ used_at: new Date().toISOString() }).eq("user_id", tok.user_id).eq("kind", "reset").is("used_at", null);
      return reply(200, { ok: true });
    }

    return reply(404, { error: "Okänd åtgärd.", code: "E_ACTION" });
  } catch (error) {
    const m = mapKpError(error);
    return reply(m.status, { error: m.message, code: m.code });
  }
});
