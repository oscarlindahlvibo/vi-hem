// Personal-API för Kompetensportalen (kräver inloggad VI-HEM-användare i rätt organisation med aktiv modul).
// Här ligger det som behöver serverns hemligheter eller flera systems samspel: uppladdning av privat media, återbetalning via Stripe,
// fakturering i Accounted, certifikat, ID06-ärenden, identitetsverifiering, kurstillfällen och export. Allt viktigt skrivs i revisionsloggen.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isUuid, mapKpError, money, queueMail, text } from "../_shared/kp-common.ts";
import { stripeConfigured, stripePost } from "../_shared/kp-stripe.ts";
import { createInvoiceForOrder } from "../_shared/kp-accounted.ts";
import { ensureCertificatePdf } from "../_shared/kp-certificate-render.ts";
import { buildLessonBlocks, makeSigner, publicize } from "../_shared/kp-lesson.ts";
import { ensureReceiptPdf, processReceipt } from "../_shared/kp-receipt.ts";
import { deliverOutboxRow } from "../_shared/kp-mail.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const MIME: Record<string, string[]> = { video: ["video/mp4", "video/webm", "video/quicktime"], audio: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"], document: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain"], image: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"] };
const LIMIT: Record<string, number> = { video: 2 * 1024 ** 3, audio: 200 * 1024 ** 2, document: 50 * 1024 ** 2, image: 8 * 1024 ** 2 };
const csvEsc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    const { data: auth } = token ? await admin.auth.getUser(token) : ({ data: { user: null } } as any);
    if (!auth?.user) return json({ error: "Du måste logga in." }, 401);
    const { data: profile } = await admin.from("vihem_profiles").select("id,role,organisation_id,active").eq("id", auth.user.id).maybeSingle();
    if (!profile?.active || !["staff", "admin", "superadmin"].includes(profile.role)) return json({ error: "Personalbehörighet krävs." }, 403);
    const org = profile.organisation_id as string;
    const isAdmin = ["admin", "superadmin"].includes(profile.role);
    const { data: mod } = await admin.from("vihem_organisation_modules").select("enabled").eq("organisation_id", org).eq("module_key", "kompetensportalen").maybeSingle();
    if (!mod?.enabled) return json({ error: "Modulen är inte aktiverad." }, 403);
    const { data: settings } = await admin.from("vihem_kp_settings").select("*").eq("organisation_id", org).maybeSingle();
    if (!settings) return json({ error: "Kompetensportalen är inte konfigurerad." }, 503);
    const body = JSON.parse((await request.text()) || "{}");
    const action = text(body.action, 50);
    const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await admin.rpc(fn, args); if (error) throw error; return data; };
    const needAdmin = () => { if (!isAdmin) throw new Error("[E_FORBIDDEN] Administratörsbehörighet krävs."); };
    const sign = makeSigner(admin);
    const ctx = { organisationId: org, settings, baseUrl: String(settings.public_base_url).replace(/\/$/, "") };
    const order = async () => { if (!isUuid(body.order_id)) throw new Error("[E_NOT_FOUND] Ordern finns inte."); const { data } = await admin.from("vihem_kp_orders").select("*").eq("id", body.order_id).eq("organisation_id", org).maybeSingle(); if (!data) throw new Error("[E_NOT_FOUND] Ordern finns inte."); return data; };
    const audit = (act: string, type: string, id: string, detail: Record<string, unknown> = {}) => admin.rpc("vihem_kp_audit", { p_org: org, p_actor: profile.id, p_kind: "staff", p_action: act, p_type: type, p_id: id, p_detail: detail });

    // ---------------------------------------------------------------- Media (privat lagring, signerade uppladdningar)
    if (action === "media_upload_url") {
      needAdmin();
      const kind = text(body.kind, 20); const mime = text(body.mime_type, 100).toLowerCase(); const size = Number(body.size_bytes) || 0;
      if (!MIME[kind]?.includes(mime)) return json({ error: `Filtypen ${mime || "okänd"} är inte tillåten för ${kind}.` }, 400);
      if (size <= 0 || size > LIMIT[kind]) return json({ error: `Filen är för stor (högst ${Math.round(LIMIT[kind] / 1024 ** 2)} MB).` }, 400);
      const isPublic = kind === "image" && body.public === true;
      const safe = text(body.filename, 120).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "fil";
      const bucket = isPublic ? "vihem-kp-public" : "vihem-kp-private";
      const path = `${org}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}-${safe}`;
      const { data: up, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
      if (error) throw error;
      const { data: asset } = await admin.from("vihem_kp_media_assets").insert({ organisation_id: org, kind, bucket, storage_path: path, original_name: text(body.filename, 200), mime_type: mime, size_bytes: size, status: "uploading", alt_text: text(body.alt_text, 300), created_by: profile.id }).select("id").single();
      return json({ asset_id: asset.id, bucket, path, token: up.token, signed_url: up.signedUrl });
    }
    if (action === "media_complete") {
      needAdmin();
      const { data: a } = await admin.from("vihem_kp_media_assets").select("*").eq("id", body.asset_id).eq("organisation_id", org).maybeSingle();
      if (!a) return json({ error: "Mediet finns inte." }, 404);
      const folder = a.storage_path.split("/").slice(0, -1).join("/"); const name = a.storage_path.split("/").at(-1);
      const { data: list } = await admin.storage.from(a.bucket).list(folder, { search: name });
      if (!(list ?? []).some((o: any) => o.name === name)) { await admin.from("vihem_kp_media_assets").update({ status: "failed" }).eq("id", a.id); return json({ error: "Uppladdningen hittades inte i lagringen." }, 409); }
      const duration = body.duration_seconds ? Math.max(1, Math.round(Number(body.duration_seconds))) : null;
      await admin.from("vihem_kp_media_assets").update({ status: "ready", duration_seconds: duration, alt_text: body.alt_text !== undefined ? text(body.alt_text, 300) : a.alt_text }).eq("id", a.id);
      return json({ ok: true });
    }
    if (action === "media_url") {
      const { data: a } = await admin.from("vihem_kp_media_assets").select("bucket,storage_path").eq("id", body.asset_id).eq("organisation_id", org).maybeSingle();
      if (!a) return json({ error: "Mediet finns inte." }, 404);
      return json({ url: await sign(a.bucket, a.storage_path, 900) });
    }
    if (action === "media_captions") {
      needAdmin();
      const { data: a } = await admin.from("vihem_kp_media_assets").select("id,captions,bucket,storage_path").eq("id", body.asset_id).eq("organisation_id", org).maybeSingle();
      if (!a) return json({ error: "Mediet finns inte." }, 404);
      const vtt = String(body.vtt ?? ""); if (!vtt.startsWith("WEBVTT") || vtt.length > 500_000) return json({ error: "Textningen måste vara en giltig WebVTT-fil." }, 400);
      const lang = text(body.lang, 8) || "sv"; const path = `${a.storage_path}.${lang}.vtt`;
      const { error } = await admin.storage.from(a.bucket).upload(path, new TextEncoder().encode(vtt), { contentType: "text/vtt", upsert: true }); if (error) throw error;
      const captions = [...(a.captions ?? []).filter((c: any) => c.lang !== lang), { lang, label: text(body.label, 40) || lang, path }];
      await admin.from("vihem_kp_media_assets").update({ captions }).eq("id", a.id);
      return json({ ok: true });
    }
    if (action === "preview_lesson") {
      const { data: v } = await admin.from("vihem_kp_course_versions").select("id").eq("id", body.version_id).eq("organisation_id", org).maybeSingle();
      if (!v) return json({ error: "Versionen finns inte." }, 404);
      return json(await buildLessonBlocks(admin, org, v.id, body.lesson_id));
    }

    // ---------------------------------------------------------------- Order, betalning, faktura
    if (action === "order_detail") {
      const o = await order();
      const [{ data: items }, { data: payments }, { data: refunds }, { data: seats }, { data: audits }] = await Promise.all([
        admin.from("vihem_kp_order_items").select("*").eq("order_id", o.id), admin.from("vihem_kp_payments").select("*").eq("order_id", o.id).order("created_at"),
        admin.from("vihem_kp_refunds").select("*").eq("order_id", o.id).order("created_at"), admin.from("vihem_kp_seats").select("id,status,access_enabled,assigned_email,course_id").eq("order_id", o.id),
        admin.from("vihem_kp_audit_log").select("action,actor_kind,detail,created_at").eq("entity_type", "order").eq("entity_id", o.id).order("created_at", { ascending: false }).limit(30),
      ]);
      return json({ order: o, items, payments, refunds, seats, audit: audits });
    }
    if (action === "refund_order") {
      needAdmin();
      const o = await order(); const amount = Math.round(Number(body.amount) * 100) / 100; const reason = text(body.reason, 300);
      if (!(amount > 0) || reason.length < 3) return json({ error: "Ange belopp och orsak." }, 400);
      if (amount > Number(o.amount_paid) - Number(o.amount_refunded) + 0.001) return json({ error: "Beloppet överstiger det som kan återbetalas." }, 400);
      let ref: string | null = null;
      if (o.payment_method === "stripe") {
        if (!stripeConfigured() || !o.stripe_payment_intent_id) return json({ error: "Stripe-återbetalning är inte möjlig (nycklar eller betalningsreferens saknas)." }, 409);
        const n = (await admin.from("vihem_kp_refunds").select("id", { count: "exact", head: true }).eq("order_id", o.id)).count ?? 0;
        const r = await stripePost("refunds", { payment_intent: o.stripe_payment_intent_id, amount: String(Math.round(amount * 100)), "metadata[kp_order_id]": o.id }, `kp-refund-${o.id}-${Math.round(amount * 100)}-${n}`);
        ref = r.id;
      } else ref = `manual:${crypto.randomUUID()}`; // faktura/manuell: kreditering sker i Accounted, här registreras den
      const res = await rpc("vihem_kp_record_refund", { p_order: o.id, p_amount: amount, p_ref: ref, p_reason: reason, p_kind: o.payment_method === "stripe" ? "refund" : "credit_note", p_actor: profile.id, p_revoke: body.revoke_access === true });
      if (o.payment_method === "stripe") { const { data: rf } = await admin.from("vihem_kp_refunds").select("id").eq("order_id", o.id).eq("provider_ref", ref).maybeSingle(); if (rf?.id) await processReceipt(admin, o.id, { refundId: rf.id }); }
      return json({ ok: true, reference: ref, ...res });
    }
    if (action === "receipt_pdf") {
      const { data: r } = await admin.from("vihem_kp_receipts").select("id,pdf_path,organisation_id,receipt_number").eq("id", body.receipt_id).eq("organisation_id", org).maybeSingle();
      if (!r) return json({ error: "Kvittot hittades inte." }, 404);
      const path = r.pdf_path ?? await ensureReceiptPdf(admin, r.id);
      const { data: signed, error } = await admin.storage.from("vihem-kp-private").createSignedUrl(path, 600, { download: `${r.receipt_number}.pdf` });
      if (error) throw error;
      return json({ url: publicize(signed.signedUrl) });
    }
    if (action === "approve_invoice_order") {
      needAdmin();
      const o = await order();
      const approved = await rpc("vihem_kp_approve_invoice_order", { p_order: o.id, p_actor: profile.id });
      const inv = await createInvoiceForOrder(admin, o.id, profile.id);
      if (!inv.ok) { await admin.from("vihem_kp_orders").update({ invoice_status: "needs_action" }).eq("id", o.id); return json({ ok: true, approved, invoice: { created: false, reason: inv.message, code: inv.code } }); }
      const { data: part } = o.buyer_user_id ? await admin.from("vihem_kp_participants").select("first_name,last_name").eq("user_id", o.buyer_user_id).maybeSingle() : { data: null };
      const name = [part?.first_name, part?.last_name].filter(Boolean).join(" ") || o.contact_email;
      await queueMail(admin, org, "invoice_info", o.contact_email, name, { name, order_number: o.order_number, due_date: inv.dueDate ?? "", access_note: approved.access_mode === "immediate" ? "Du har tillgång direkt." : "Tillgång öppnas när fakturan är betald." }, `order-${o.id}-invoice`, "order", o.id);
      return json({ ok: true, approved, invoice: { created: true, number: inv.number, due_date: inv.dueDate } });
    }
    if (action === "retry_invoice") { needAdmin(); const o = await order(); const inv = await createInvoiceForOrder(admin, o.id, profile.id); return json(inv.ok ? { ok: true, number: inv.number } : { ok: false, error: inv.message, code: inv.code }); }
    if (action === "mark_invoice_paid") {
      needAdmin();
      const o = await order(); const reference = text(body.reference, 80); if (reference.length < 3) return json({ error: "Ange en betalningsreferens (t.ex. bankens verifikationsnummer)." }, 400);
      if (o.payment_method !== "invoice") return json({ error: "Bara fakturaordrar kan markeras betalda manuellt." }, 409);
      const res = await rpc("vihem_kp_apply_payment", { p_order: o.id, p_provider: "manual", p_ref: `manual:${reference}`, p_amount: Number(body.amount) || Number(o.total) - Number(o.amount_paid), p_detail: { by: profile.id } });
      await audit("invoice_marked_paid", "order", o.id, { reference });
      return json({ ok: true, ...res });
    }
    if (action === "cancel_order") {
      needAdmin();
      const o = await order();
      if (Number(o.amount_paid) - Number(o.amount_refunded) > 0.001) return json({ error: "Ordern har mottagna betalningar. Återbetala/kreditera först." }, 409);
      await rpc("vihem_kp_revoke_order_access", { p_order: o.id, p_reason: text(body.reason, 300) || "Avbruten av personal", p_actor: profile.id });
      await admin.from("vihem_kp_orders").update({ status: "cancelled" }).eq("id", o.id);
      await audit("order_cancelled", "order", o.id, { reason: body.reason });
      return json({ ok: true });
    }
    if (action === "grant_free") {
      needAdmin();
      const { data: target } = await admin.from("vihem_kp_participants").select("user_id").eq("organisation_id", org).ilike("email", text(body.email, 200).toLowerCase()).maybeSingle();
      if (!target) return json({ error: "Deltagaren har inget konto än. Be personen registrera sig först." }, 404);
      return json({ order_id: await rpc("vihem_kp_grant_free", { p_org: org, p_user: target.user_id, p_customer: isUuid(body.customer_id) ? body.customer_id : null, p_product: body.product_id, p_qty: Number(body.quantity) || 1, p_note: text(body.note, 300), p_actor: profile.id }) });
    }

    // ---------------------------------------------------------------- Identitet
    if (action === "verify_identity") {
      needAdmin();
      const n = await rpc("vihem_kp_verify_identity", { p_user: body.user_id, p_method: text(body.method, 60) || "manuell kontroll av id-handling", p_actor: profile.id, p_note: text(body.note, 300) });
      return json({ ok: true, completed_enrollments: n });
    }

    // ---------------------------------------------------------------- Provresultat
    if (action === "exam_override") {
      needAdmin();
      const { data: a } = await admin.from("vihem_kp_exam_attempts").select("id").eq("id", body.attempt_id).eq("organisation_id", org).maybeSingle(); if (!a) return json({ error: "Försöket finns inte." }, 404);
      await rpc("vihem_kp_exam_override", { p_attempt: a.id, p_passed: body.passed === true, p_reason: text(body.reason, 300), p_actor: profile.id });
      return json({ ok: true });
    }
    if (action === "attempt_review") {
      const { data: a } = await admin.from("vihem_kp_exam_attempts").select("id,attempt_no,status,percent,passed,started_at,submitted_at,snapshot").eq("id", body.attempt_id).eq("organisation_id", org).maybeSingle(); if (!a) return json({ error: "Försöket finns inte." }, 404);
      const { data: answers } = await admin.from("vihem_kp_attempt_answers").select("question_id,option_ids,correct,points").eq("attempt_id", a.id);
      const { data: events } = await admin.from("vihem_kp_attempt_events").select("event_type,detail,created_at").eq("attempt_id", a.id).order("created_at");
      await audit("attempt_reviewed", "exam_attempt", a.id);
      return json({ attempt: { ...a, snapshot: undefined }, questions: (a.snapshot as any[]).map((q) => ({ question_id: q.question_id, prompt: q.prompt, points: q.points, options: q.options.map((o: any) => ({ id: o.id, label: o.label, is_correct: o.is_correct })), answer: (answers ?? []).find((x: any) => x.question_id === q.question_id) ?? null })), events });
    }
    if (action === "image_url") { const { data: a } = await admin.from("vihem_kp_media_assets").select("bucket,storage_path").eq("id", body.asset_id).eq("organisation_id", org).maybeSingle(); return a ? json({ url: await sign(a.bucket, a.storage_path, 900) }) : json({ error: "Finns inte." }, 404); }

    // ---------------------------------------------------------------- Certifikat
    if (action === "certificate_issue") { needAdmin(); const id = await rpc("vihem_kp_issue_certificate", { p_enrollment: body.enrollment_id, p_actor: profile.id }); await ensureCertificatePdf(admin, ctx, id); return json({ certificate_id: id }); }
    if (action === "certificate_pdf") {
      const { data: c } = await admin.from("vihem_kp_certificates").select("id").eq("id", body.certificate_id).eq("organisation_id", org).maybeSingle();
      if (!c) return json({ error: "Certifikatet finns inte." }, 404);
      const path = await ensureCertificatePdf(admin, ctx, c.id, body.regenerate === true && isAdmin);
      return json({ url: await sign("vihem-kp-private", path, 600, "intyg.pdf") });
    }
    if (action === "certificate_revoke") { needAdmin(); const { data: c } = await admin.from("vihem_kp_certificates").select("id").eq("id", body.certificate_id).eq("organisation_id", org).maybeSingle(); if (!c) return json({ error: "Certifikatet finns inte." }, 404); await rpc("vihem_kp_revoke_certificate", { p_cert: c.id, p_reason: text(body.reason, 300), p_actor: profile.id }); await ensureCertificatePdf(admin, ctx, c.id, true); return json({ ok: true }); }
    if (action === "certificate_reissue") {
      needAdmin();
      const { data: c } = await admin.from("vihem_kp_certificates").select("id").eq("id", body.certificate_id).eq("organisation_id", org).maybeSingle(); if (!c) return json({ error: "Certifikatet finns inte." }, 404);
      const nid = await rpc("vihem_kp_reissue_certificate", { p_cert: c.id, p_reason: text(body.reason, 300), p_actor: profile.id });
      await ensureCertificatePdf(admin, ctx, c.id, true); await ensureCertificatePdf(admin, ctx, nid);
      return json({ certificate_id: nid });
    }

    // ---------------------------------------------------------------- ID06
    if (action === "id06_set") {
      needAdmin();
      await rpc("vihem_kp_id06_result", { p_id: body.registration_id, p_status: text(body.status, 20), p_reference: text(body.reference, 100), p_error: text(body.error, 300), p_actor: profile.id, p_notes: text(body.notes, 500) });
      if (body.status === "registered") { const { data: r } = await admin.from("vihem_kp_external_registrations").select("certificate_id").eq("id", body.registration_id).single(); await ensureCertificatePdf(admin, ctx, r.certificate_id, true); }
      return json({ ok: true });
    }

    // ---------------------------------------------------------------- Kurstillfällen
    if (action === "session_result") { return json(await rpc("vihem_kp_session_set_result", { p_booking: body.booking_id, p_status: text(body.status, 20), p_actor: profile.id, p_note: text(body.note, 300) })); }
    if (action === "session_cancel_booking") { return json(await rpc("vihem_kp_session_cancel_booking", { p_booking: body.booking_id, p_actor: profile.id, p_by_staff: true })); }
    if (action === "session_rebook") { return json({ booking_id: await rpc("vihem_kp_session_rebook", { p_booking: body.booking_id, p_new_session: body.session_id, p_actor: profile.id, p_by_staff: true }) }); }
    if (action === "session_cancel") {
      needAdmin();
      const { data: s } = await admin.from("vihem_kp_sessions").select("*, course:vihem_kp_courses(title)").eq("id", body.session_id).eq("organisation_id", org).maybeSingle(); if (!s) return json({ error: "Tillfället finns inte." }, 404);
      await admin.from("vihem_kp_sessions").update({ status: "cancelled" }).eq("id", s.id);
      const { data: bks } = await admin.from("vihem_kp_session_bookings").select("id,email,user_id,seat:vihem_kp_seats(assigned_email,owner_user_id)").eq("session_id", s.id).in("status", ["booked", "held", "waitlisted"]);
      for (const b of bks ?? []) {
        await admin.from("vihem_kp_session_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", b.id);
        const seat: any = Array.isArray(b.seat) ? b.seat[0] : b.seat;
        let to = b.email || seat?.assigned_email;
        if (!to && (b.user_id || seat?.owner_user_id)) to = (await admin.from("vihem_kp_participants").select("email").eq("user_id", b.user_id || seat.owner_user_id).maybeSingle()).data?.email;
        if (to) await queueMail(admin, org, "session_changed", to, "", { name: "", course: s.course.title, note: `Tillfället ${new Date(s.starts_at).toLocaleDateString("sv-SE")} är inställt${body.note ? `: ${text(body.note, 200)}` : ""}. Du kan boka om platsen på ett annat datum under Mina sidor.` }, `sess-cancel-${s.id}-${b.id}`, "session", s.id);
      }
      await audit("session_cancelled", "session", s.id, { note: body.note, bookings: bks?.length ?? 0 });
      return json({ ok: true, affected: bks?.length ?? 0 });
    }

    // ---------------------------------------------------------------- Export (CSV för Excel) och övrigt
    if (action === "export") {
      const kind = text(body.kind, 20); const from = text(body.from, 10) || "1970-01-01"; const to = text(body.to, 10) || "2999-12-31"; let lines: string[] = [];
      if (kind === "orders") {
        const { data } = await admin.from("vihem_kp_orders").select("order_number,created_at,status,payment_method,buyer_type,subtotal,discount_total,vat_total,total,amount_paid,amount_refunded,invoice_status,contact_email,customer:vihem_kp_customers(name,org_number)").eq("organisation_id", org).gte("created_at", from).lte("created_at", `${to}T23:59:59`).order("created_at", { ascending: false }).limit(20000);
        lines = ["Ordernummer;Datum;Status;Betalsätt;Köpartyp;Företag;Orgnr;Delsumma;Rabatt;Moms;Totalt;Mottaget;Återbetalt;Fakturastatus;E-post", ...(data ?? []).map((o: any) => { const c = Array.isArray(o.customer) ? o.customer[0] : o.customer; return [o.order_number, o.created_at.slice(0, 10), o.status, o.payment_method, o.buyer_type, c?.name, c?.org_number, o.subtotal, o.discount_total, o.vat_total, o.total, o.amount_paid, o.amount_refunded, o.invoice_status, o.contact_email].map(csvEsc).join(";"); })];
      } else if (kind === "participants") {
        const { data } = await admin.from("vihem_kp_participants").select("email,first_name,last_name,phone,identity_verified_at,created_at").eq("organisation_id", org).order("created_at", { ascending: false }).limit(20000);
        lines = ["E-post;Förnamn;Efternamn;Telefon;Identitet verifierad;Skapad", ...(data ?? []).map((p: any) => [p.email, p.first_name, p.last_name, p.phone, p.identity_verified_at?.slice(0, 10), p.created_at.slice(0, 10)].map(csvEsc).join(";"))];
      } else if (kind === "certificates") {
        const { data } = await admin.from("vihem_kp_certificates").select("certificate_number,holder_name,course_title,status,completed_on,valid_until,issued_at").eq("organisation_id", org).gte("issued_at", from).lte("issued_at", `${to}T23:59:59`).order("issued_at", { ascending: false }).limit(20000);
        lines = ["Intygsnummer;Namn;Utbildning;Status;Genomförd;Giltigt till;Utfärdat", ...(data ?? []).map((c: any) => [c.certificate_number, c.holder_name, c.course_title, c.status, c.completed_on, c.valid_until, c.issued_at.slice(0, 10)].map(csvEsc).join(";"))];
      } else if (kind === "enrollments") {
        const { data } = await admin.from("vihem_kp_enrollments").select("user_id,status,progress_percent,started_at,completed_at,course:vihem_kp_courses(title),sponsor:vihem_kp_customers(name)").eq("organisation_id", org).limit(20000);
        const { data: people } = await admin.from("vihem_kp_participants").select("user_id,email,first_name,last_name").eq("organisation_id", org).limit(50000);
        const pm = new Map((people ?? []).map((p: any) => [p.user_id, p]));
        lines = ["Deltagare;E-post;Utbildning;Företag;Status;Framsteg %;Påbörjad;Genomförd", ...(data ?? []).map((e: any) => { const u: any = pm.get(e.user_id); const c = Array.isArray(e.course) ? e.course[0] : e.course; const s = Array.isArray(e.sponsor) ? e.sponsor[0] : e.sponsor; return [`${u?.first_name ?? ""} ${u?.last_name ?? ""}`.trim(), u?.email, c?.title, s?.name, e.status, e.progress_percent, e.started_at?.slice(0, 10), e.completed_at?.slice(0, 10)].map(csvEsc).join(";"); })];
      } else return json({ error: "Okänd exporttyp." }, 400);
      await audit("export", kind, kind, { rows: lines.length - 1 });
      return json({ csv: "﻿" + lines.join("\n"), filename: `kompetensportalen-${kind}-${new Date().toISOString().slice(0, 10)}.csv` });
    }
    if (action === "send_test_email") {
      needAdmin();
      const to = text(body.to, 200).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return json({ error: "Ogiltig adress." }, 400);
      const r = await deliverOutboxRow(admin, settings, { id: "test", organisation_id: org, to_email: to, to_name: "", subject: "Testmejl från Kompetensportalen", body: "Detta är ett testmejl. Om du ser det fungerar utskicken.", attachment: null });
      return json(r);
    }
    if (action === "seed_defaults") { needAdmin(); await rpc("vihem_kp_seed_defaults", { p_org: org }); return json({ ok: true }); }
    if (action === "capabilities") {
      return json({ stripe: stripeConfigured() && settings.stripe_enabled, stripe_key_present: stripeConfigured(), pii_key_present: !!Deno.env.get("VIHEM_KP_SECRET_KEY"), mail_sender: !!settings.sender_email, smtp_available: !!Deno.env.get("SMTP_HOST"), accounted_company: !!settings.finance_company_id,
        accounted_linked: settings.finance_company_id ? !!(await admin.from("vihem_accounted_company_links").select("id").eq("company_id", settings.finance_company_id).eq("enabled", true).maybeSingle()).data : false, id06_mode: settings.id06_mode });
    }
    return json({ error: "Okänd åtgärd." }, 404);
  } catch (error) {
    const m = mapKpError(error);
    return json({ error: m.message, code: m.code }, m.status);
  }
});
