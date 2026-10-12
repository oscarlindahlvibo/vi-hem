// Deltagar- och företags-API (kräver inloggad användare). Alla beslut om framsteg, prov och behörighet tas av databasfunktioner;
// här kontrolleras ägarskap/företagsadministration och privata filer signeras med korta URL:er. Svar innehåller aldrig facit.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { allow, corsFor, encryptPii, ensureParticipant, EMAIL, isTestEmail, isUuid, kpContext, mapKpError, normalisePersonalNumber, queueMail, text, userFromRequest, notifyStaff as notifyStaffReal } from "../_shared/kp-common.ts";
import { ensureCertificatePdf } from "../_shared/kp-certificate-render.ts";
import { buildLessonBlocks, makeSigner, SIGN_TTL } from "../_shared/kp-lesson.ts";


Deno.serve(async (request: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const ctx = await kpContext(admin, request);
  const base = corsFor(request, ctx);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...base, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  if (!ctx || request.method !== "POST") return reply(404, { error: "Webbplatsen är inte konfigurerad.", code: "E_DOMAIN" });
  const org = ctx.organisationId;
  try {
    const user = await userFromRequest(admin, request);
    if (!user) return reply(401, { error: "Logga in för att fortsätta.", code: "E_AUTH" });
    if (!(await allow(admin, request, `kp-learn-${user.id}`, 400, 60))) return reply(429, { error: "För många anrop.", code: "E_RATE" });
    const body = JSON.parse((await request.text()) || "{}");
    const action = text(body.action, 40);
    const participant = await ensureParticipant(admin, ctx, user);
    const notifyStaff = (...args: Parameters<typeof notifyStaffReal>) => (isTestEmail(user.email) ? Promise.resolve() : notifyStaffReal(...args));
    const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await admin.rpc(fn, args); if (error) throw error; return data; };
    const sign = makeSigner(admin);
    const requireCompanyAdmin = async (customerId: unknown) => {
      if (!isUuid(customerId)) throw new Error("[E_FORBIDDEN] Välj företag.");
      const { data: m } = await admin.from("vihem_kp_company_members").select("id,role").eq("customer_id", customerId).eq("user_id", user.id).eq("status", "active").eq("role", "admin").maybeSingle();
      const { data: c } = await admin.from("vihem_kp_customers").select("*").eq("id", customerId).eq("organisation_id", org).maybeSingle();
      if (!m || !c) throw new Error("[E_FORBIDDEN] Du är inte administratör för företaget.");
      return c;
    };

    // ------------------------------------------------------------------ Översikt
    if (action === "me") {
      const [{ data: enrollments }, { data: certs }, { data: memberships }, { data: bookings }, { data: orders }] = await Promise.all([
        admin.from("vihem_kp_enrollments").select("id,status,progress_percent,access_enabled,started_at,completed_at,valid_until,last_lesson_id,course:vihem_kp_courses(id,slug,title,delivery_form,image_url,estimated_minutes),sponsor:vihem_kp_customers(name)").eq("user_id", user.id).not("status", "in", "(cancelled)").order("created_at", { ascending: false }),
        admin.from("vihem_kp_certificates").select("id,certificate_number,verification_code,status,course_title,kind,completed_on,valid_until,issued_at,pdf_path").eq("user_id", user.id).order("issued_at", { ascending: false }),
        admin.from("vihem_kp_company_members").select("role,customer:vihem_kp_customers(id,name,org_number,invoice_purchase_allowed)").eq("user_id", user.id).eq("status", "active"),
        admin.from("vihem_kp_session_bookings").select("id,status,session:vihem_kp_sessions(id,title,starts_at,ends_at,location_kind,location,meeting_url,free_cancellation_hours,course_id),seat_id").eq("user_id", user.id).in("status", ["booked", "attended", "passed", "failed", "no_show"]).order("created_at", { ascending: false }),
        admin.from("vihem_kp_orders").select("id,order_number,status,total,payment_method,created_at,invoice_status").eq("buyer_user_id", user.id).order("created_at", { ascending: false }).limit(20),
      ]);
      const identity = await admin.from("vihem_kp_participant_identity").select("last4,verified_at").eq("user_id", user.id).maybeSingle();
      return reply(200, {
        participant: { email: user.email, first_name: participant?.first_name ?? "", last_name: participant?.last_name ?? "", phone: participant?.phone ?? "", identity_verified: !!participant?.identity_verified_at, identity_submitted: !!identity.data, identity_last4: identity.data?.last4 ?? null },
        enrollments: enrollments ?? [], certificates: (certs ?? []).map(({ pdf_path, ...c }: any) => ({ ...c, has_pdf: !!pdf_path, effective_status: c.status === "issued" && c.valid_until && c.valid_until < new Date().toISOString().slice(0, 10) ? "expired" : c.status })),
        companies: (memberships ?? []).map((m: any) => ({ role: m.role, ...m.customer })), bookings: bookings ?? [], orders: orders ?? [],
      });
    }

    if (action === "profile_update") {
      const first = text(body.first_name, 120), last = text(body.last_name, 120), phone = text(body.phone, 40);
      if (!first || !last) return reply(400, { error: "Ange för- och efternamn.", code: "E_INVALID" });
      const { data: certs } = await admin.from("vihem_kp_certificates").select("id").eq("user_id", user.id).eq("status", "issued").limit(1);
      await admin.from("vihem_kp_participants").update({ first_name: first, last_name: last, phone }).eq("user_id", user.id);
      return reply(200, { ok: true, note: certs?.length ? "Redan utfärdade certifikat behåller namnet från utfärdandet. Kontakta oss om det behöver korrigeras." : null });
    }

    if (action === "identity_submit") {
      const pn = normalisePersonalNumber(text(body.personal_number, 20));
      if (!pn) return reply(400, { error: "Ogiltigt personnummer.", code: "E_INVALID" });
      if (body.consent !== true) return reply(400, { error: "Du måste lämna samtycke till behandlingen av personnummer.", code: "E_TERMS" });
      if (!Deno.env.get("VIHEM_KP_SECRET_KEY")) return reply(503, { error: "Personnummer kan inte sparas ännu (krypteringsnyckel saknas på servern).", code: "E_CONFIG" });
      const enc = await encryptPii(pn, `kp-identity:${user.id}`);
      await admin.from("vihem_kp_participant_identity").upsert({ user_id: user.id, organisation_id: org, personal_number_enc: enc, last4: pn.slice(-4), legal_basis: "samtycke (identitetskontroll/ID06)" }, { onConflict: "user_id" });
      await admin.rpc("vihem_kp_audit", { p_org: org, p_actor: user.id, p_kind: "user", p_action: "identity_submitted", p_type: "participant", p_id: user.id, p_detail: {} });
      return reply(200, { ok: true, verified: false, note: "Personnumret är sparat krypterat men inte verifierat. Verifiering görs av personal eller via BankID när det är tillgängligt." });
    }

    // ------------------------------------------------------------------ Kursspelare
    if (action === "course_player") {
      const e = await rpc("vihem_kp_enrollment_for_user", { p_enrollment: body.enrollment_id, p_user: user.id, p_require_active: false });
      const accessOk = e.access_enabled && !["revoked", "cancelled"].includes(e.status) && !(e.valid_until && e.valid_until < new Date().toISOString());
      const { data: course } = await admin.from("vihem_kp_courses").select("id,slug,title,delivery_form,requires_identity_verification,certificate_kind,validity_months,image_url").eq("id", e.course_id).single();
      const { data: version } = await admin.from("vihem_kp_course_versions").select("id,version,sequential").eq("id", e.course_version_id).single();
      const { data: mods } = await admin.from("vihem_kp_modules").select("id,title,description,sort_order").eq("version_id", e.course_version_id).order("sort_order");
      const { data: lessons } = await admin.from("vihem_kp_lessons").select("id,module_id,title,kind,required,estimated_minutes,sort_order").eq("version_id", e.course_version_id).order("sort_order");
      const { data: prog } = await admin.from("vihem_kp_lesson_progress").select("lesson_id,status,watched_seconds,resume_position").eq("enrollment_id", e.id);
      const progMap = new Map((prog ?? []).map((p: any) => [p.lesson_id, p]));
      const out: any[] = [];
      for (const m of mods ?? []) {
        const ls: any[] = [];
        for (const l of (lessons ?? []).filter((x: any) => x.module_id === m.id)) {
          const p: any = progMap.get(l.id);
          const unlocked = accessOk ? await rpc("vihem_kp_lesson_unlocked", { p_enrollment: e.id, p_lesson: l.id }) : false;
          ls.push({ id: l.id, title: l.title, kind: l.kind, required: l.required, minutes: l.estimated_minutes, status: p?.status ?? "not_started", locked: !unlocked, resume_position: p?.resume_position ?? 0 });
        }
        out.push({ id: m.id, title: m.title, description: m.description, lessons: ls });
      }
      const { data: exams } = await admin.from("vihem_kp_exams").select("id,kind,title,question_count,pass_percent,time_limit_seconds,max_attempts,cooldown_seconds,require_identity,lesson_id").eq("version_id", e.course_version_id);
      const examInfo: any[] = [];
      for (const x of exams ?? []) {
        const { data: atts } = await admin.from("vihem_kp_exam_attempts").select("id,attempt_no,status,percent,passed,submitted_at,expires_at").eq("enrollment_id", e.id).eq("exam_id", x.id).order("attempt_no");
        const used = (atts ?? []).filter((a: any) => a.status !== "in_progress").length;
        const last = (atts ?? []).filter((a: any) => a.submitted_at).at(-1);
        const wait = last && x.cooldown_seconds ? Math.max(0, Math.ceil((new Date(last.submitted_at).getTime() + x.cooldown_seconds * 1000 - Date.now()) / 1000)) : 0;
        examInfo.push({ ...x, attempts_used: used, attempts_left: x.max_attempts == null ? null : Math.max(0, x.max_attempts - used), cooldown_seconds_left: wait, in_progress_attempt: (atts ?? []).find((a: any) => a.status === "in_progress")?.id ?? null, passed: (atts ?? []).some((a: any) => a.passed), best_percent: Math.max(0, ...(atts ?? []).map((a: any) => Number(a.percent ?? 0))) });
      }
      const requirements = await rpc("vihem_kp_enrollment_requirements", { p_enrollment: e.id });
      const { data: cert } = await admin.from("vihem_kp_certificates").select("id,certificate_number,verification_code,status,valid_until,issued_at").eq("enrollment_id", e.id).eq("status", "issued").maybeSingle();
      return reply(200, { enrollment: { id: e.id, status: e.status, progress_percent: e.progress_percent, access_enabled: accessOk, valid_until: e.valid_until, last_lesson_id: e.last_lesson_id }, course, version: version?.version, sequential: version?.sequential, modules: out, exams: examInfo, requirements, certificate: cert });
    }

    if (action === "lesson") {
      const e = await rpc("vihem_kp_enrollment_for_user", { p_enrollment: body.enrollment_id, p_user: user.id });
      const progress = await rpc("vihem_kp_open_lesson", { p_enrollment: e.id, p_user: user.id, p_lesson: body.lesson_id });
      const built = await buildLessonBlocks(admin, org, e.course_version_id, body.lesson_id);
      return reply(200, { ...built, progress });
    }

    if (action === "knowledge_check_answer") {
      // Formativ fråga: rättas på servern och påverkar inte godkännande
      const e = await rpc("vihem_kp_enrollment_for_user", { p_enrollment: body.enrollment_id, p_user: user.id });
      const { data: block } = await admin.from("vihem_kp_lesson_blocks").select("content").eq("id", body.block_id).eq("version_id", e.course_version_id).eq("kind", "knowledge_check").maybeSingle();
      if (!block || !(block.content?.question_ids ?? []).includes(body.question_id)) return reply(404, { error: "Frågan hittades inte.", code: "E_NOT_FOUND" });
      const { data: opts } = await admin.from("vihem_kp_question_options").select("id,is_correct,feedback").eq("question_id", body.question_id);
      const { data: q } = await admin.from("vihem_kp_questions").select("explanation").eq("id", body.question_id).single();
      const chosen: string[] = (Array.isArray(body.option_ids) ? body.option_ids : []).filter(isUuid);
      const correctIds = (opts ?? []).filter((o: any) => o.is_correct).map((o: any) => o.id).sort();
      const ok = chosen.length > 0 && JSON.stringify([...chosen].sort()) === JSON.stringify(correctIds);
      return reply(200, { correct: ok, explanation: q?.explanation ?? "", correct_option_ids: correctIds });
    }

    if (action === "complete_view") return reply(200, await rpc("vihem_kp_complete_view_lesson", { p_enrollment: body.enrollment_id, p_user: user.id, p_lesson: body.lesson_id }));

    if (action === "video_start") {
      const started = await rpc("vihem_kp_video_start", { p_enrollment: body.enrollment_id, p_user: user.id, p_lesson: body.lesson_id, p_asset: body.asset_id });
      const { data: a } = await admin.from("vihem_kp_media_assets").select("bucket,storage_path").eq("id", body.asset_id).eq("organisation_id", org).single();
      return reply(200, { ...started, url: await sign(a.bucket, a.storage_path, SIGN_TTL) });
    }
    if (action === "video_heartbeat") return reply(200, await rpc("vihem_kp_video_heartbeat", { p_session: body.session_id, p_user: user.id, p_position: Number(body.position), p_playing: body.playing === true }));

    // ------------------------------------------------------------------ Prov
    if (action === "exam_start") {
      const id = await rpc("vihem_kp_exam_start", { p_enrollment: body.enrollment_id, p_user: user.id, p_exam: body.exam_id });
      return reply(200, await rpc("vihem_kp_attempt_view", { p_attempt: id, p_user: user.id }));
    }
    if (action === "exam_view") return reply(200, await rpc("vihem_kp_attempt_view", { p_attempt: body.attempt_id, p_user: user.id }));
    if (action === "exam_answer") return reply(200, await rpc("vihem_kp_exam_answer", { p_attempt: body.attempt_id, p_user: user.id, p_question: body.question_id, p_options: (Array.isArray(body.option_ids) ? body.option_ids : []).filter(isUuid) }));
    if (action === "exam_submit") {
      const result = await rpc("vihem_kp_exam_submit", { p_attempt: body.attempt_id, p_user: user.id });
      if (result.passed) {
        const { data: att } = await admin.from("vihem_kp_exam_attempts").select("enrollment_id").eq("id", body.attempt_id).single();
        const { data: en } = await admin.from("vihem_kp_enrollments").select("course:vihem_kp_courses(title)").eq("id", att.enrollment_id).single();
        const name = [participant?.first_name, participant?.last_name].filter(Boolean).join(" ") || user.email;
        await queueMail(admin, org, "exam_passed", user.email, name, { name, course: (en as any).course.title }, `exam-passed-${body.attempt_id}`, "exam_attempt", body.attempt_id);
      }
      return reply(200, result);
    }

    if (action === "exam_image") {
      // Bild till en provfråga: bara om bilden ingår i en fråga i ditt pågående försök
      const { data: att } = await admin.from("vihem_kp_exam_attempts").select("snapshot,status,enrollment_id").eq("id", body.attempt_id).maybeSingle();
      const { data: en } = att ? await admin.from("vihem_kp_enrollments").select("user_id").eq("id", att.enrollment_id).maybeSingle() : { data: null };
      if (!att || att.status !== "in_progress" || en?.user_id !== user.id || !(att.snapshot as any[]).some((q) => q.image_asset_id === body.asset_id)) return reply(404, { error: "Bilden hittades inte.", code: "E_NOT_FOUND" });
      const { data: a } = await admin.from("vihem_kp_media_assets").select("bucket,storage_path").eq("id", body.asset_id).eq("organisation_id", org).maybeSingle();
      return reply(200, { url: await sign(a!.bucket, a!.storage_path, 3600) });
    }

    // ------------------------------------------------------------------ Certifikat
    if (action === "certificate_pdf") {
      const { data: c } = await admin.from("vihem_kp_certificates").select("id,user_id,enrollment_id,status").eq("id", body.certificate_id).maybeSingle();
      if (!c) return reply(404, { error: "Certifikatet hittades inte.", code: "E_NOT_FOUND" });
      let allowed = c.user_id === user.id;
      if (!allowed) { // företagsadministratör för den som bekostat utbildningen
        const { data: enr } = await admin.from("vihem_kp_enrollments").select("sponsor_customer_id").eq("id", c.enrollment_id).single();
        if (enr?.sponsor_customer_id) { const { data: m } = await admin.from("vihem_kp_company_members").select("id").eq("customer_id", enr.sponsor_customer_id).eq("user_id", user.id).eq("status", "active").eq("role", "admin").maybeSingle(); allowed = !!m; }
      }
      if (!allowed) return reply(404, { error: "Certifikatet hittades inte.", code: "E_NOT_FOUND" });
      const path = await ensureCertificatePdf(admin, ctx, c.id);
      return reply(200, { url: await sign("vihem-kp-private", path, 600, "intyg.pdf") });
    }

    // ------------------------------------------------------------------ Företag
    if (action === "company_create") {
      const orgNo = text(body.org_number, 20).replace(/\s/g, "");
      if (!/^\d{6}-?\d{4}$/.test(orgNo) || text(body.name, 200).length < 2) return reply(400, { error: "Ange företagsnamn och organisationsnummer (NNNNNN-NNNN).", code: "E_INVALID" });
      const normalized = orgNo.includes("-") ? orgNo : `${orgNo.slice(0, 6)}-${orgNo.slice(6)}`;
      const { data: existing } = await admin.from("vihem_kp_customers").select("id").eq("organisation_id", org).eq("org_number", normalized).maybeSingle();
      if (existing) return reply(409, { error: "Företaget finns redan. Be en befintlig administratör bjuda in dig.", code: "E_STATE" });
      const { data: c, error } = await admin.from("vihem_kp_customers").insert({ organisation_id: org, name: text(body.name, 200), org_number: normalized, vat_number: text(body.vat_number, 30), billing_address: text(body.billing_address, 200), billing_postal_code: text(body.billing_postal_code, 20), billing_city: text(body.billing_city, 120), invoice_email: text(body.invoice_email, 200).toLowerCase(), contact_name: `${participant?.first_name ?? ""} ${participant?.last_name ?? ""}`.trim(), contact_email: user.email, created_by: user.id }).select("id").single();
      if (error) throw error;
      await admin.from("vihem_kp_company_members").insert({ organisation_id: org, customer_id: c.id, user_id: user.id, email: user.email, role: "admin", status: "active", joined_at: new Date().toISOString(), invited_by: user.id });
      await notifyStaff(admin, org, "Nytt företagskonto", `${text(body.name, 200)} (${normalized}) har skapat ett företagskonto. Fakturaköp är avstängt tills det godkänns.`);
      return reply(201, { customer_id: c.id });
    }

    if (action === "company_overview") {
      const c = await requireCompanyAdmin(body.customer_id);
      const [{ data: seats }, { data: members }, { data: orders }] = await Promise.all([
        admin.from("vihem_kp_seats").select("id,status,access_enabled,assigned_email,assigned_to_user_id,assigned_at,activated_at,course:vihem_kp_courses(id,title,delivery_form),order:vihem_kp_orders(order_number,status),enrollment:vihem_kp_enrollments(id,status,progress_percent,user_id,completed_at,valid_until)").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(2000),
        admin.from("vihem_kp_company_members").select("id,email,role,status,user_id,joined_at").eq("customer_id", c.id).neq("status", "removed").order("email"),
        admin.from("vihem_kp_orders").select("id,order_number,status,total,payment_method,invoice_status,amount_paid,created_at").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(100),
      ]);
      const userIds = [...new Set((seats ?? []).map((s: any) => s.assigned_to_user_id).filter(Boolean))];
      const { data: people } = userIds.length ? await admin.from("vihem_kp_participants").select("user_id,first_name,last_name,email").in("user_id", userIds) : { data: [] };
      const pm = new Map((people ?? []).map((p: any) => [p.user_id, p]));
      // Intyg för deltagare vars utbildning företaget bekostat (inga andra personuppgifter eller andra utbildningar)
      const enrollIds = (seats ?? []).map((s: any) => (Array.isArray(s.enrollment) ? s.enrollment[0] : s.enrollment)?.id).filter(Boolean);
      const { data: certs } = enrollIds.length ? await admin.from("vihem_kp_certificates").select("id,enrollment_id,certificate_number,status,valid_until,course_title").in("enrollment_id", enrollIds).in("status", ["issued", "revoked"]) : { data: [] };
      const rows = (seats ?? []).map((s: any) => { const en = Array.isArray(s.enrollment) ? s.enrollment[0] : s.enrollment; const p: any = pm.get(s.assigned_to_user_id); const cert = (certs ?? []).find((x: any) => x.enrollment_id === en?.id);
        return { seat_id: s.id, course: s.course?.title, course_id: s.course?.id, seat_status: s.status, access_enabled: s.access_enabled, order_number: (Array.isArray(s.order) ? s.order[0] : s.order)?.order_number, assignee_email: s.assigned_email, assignee_name: p ? `${p.first_name} ${p.last_name}`.trim() : null,
          progress_percent: en?.progress_percent ?? null, enrollment_status: en?.status ?? null, completed_at: en?.completed_at ?? null, certificate: cert ? { id: cert.id, number: cert.certificate_number, status: cert.status === "issued" && cert.valid_until && cert.valid_until < new Date().toISOString().slice(0, 10) ? "expired" : cert.status, valid_until: cert.valid_until } : null }; });
      const summary = { total: rows.length, unused: rows.filter((r: any) => r.seat_status === "available" && r.access_enabled).length, locked: rows.filter((r: any) => !r.access_enabled && !["revoked", "expired"].includes(r.seat_status)).length, assigned: rows.filter((r: any) => r.seat_status === "assigned").length, active: rows.filter((r: any) => r.seat_status === "active").length, completed: rows.filter((r: any) => r.seat_status === "completed").length };
      return reply(200, { company: { id: c.id, name: c.name, org_number: c.org_number, invoice_purchase_allowed: c.invoice_purchase_allowed, status: c.status, invoice_email: c.invoice_email }, summary, seats: rows, members: members ?? [], orders: orders ?? [] });
    }

    if (action === "company_assign") {
      const c = await requireCompanyAdmin(body.customer_id);
      const email = text(body.email, 200).toLowerCase();
      if (!EMAIL.test(email) || !isUuid(body.seat_id)) return reply(400, { error: "Ange en giltig e-postadress.", code: "E_INVALID" });
      const { data: seat } = await admin.from("vihem_kp_seats").select("*, course:vihem_kp_courses(title)").eq("id", body.seat_id).eq("customer_id", c.id).maybeSingle();
      if (!seat) return reply(404, { error: "Platsen hittades inte.", code: "E_NOT_FOUND" });
      if (!seat.access_enabled) return reply(409, { error: "Platsen är inte aktiverad ännu (väntar på betalning).", code: "E_ACCESS" });
      if (seat.status === "assigned") await rpc("vihem_kp_reclaim_seat", { p_seat: seat.id, p_actor: user.id });
      const { data: target } = await admin.from("vihem_kp_participants").select("user_id,first_name,last_name").eq("organisation_id", org).ilike("email", email).maybeSingle();
      await rpc("vihem_kp_assign_seat_internal", { p_seat: seat.id, p_user: target?.user_id ?? null, p_email: email, p_actor: user.id });
      const { data: existingMember } = await admin.from("vihem_kp_company_members").select("id,status").eq("customer_id", c.id).ilike("email", email).neq("status", "removed").maybeSingle();
      if (existingMember) { if (existingMember.status === "invited" && target) await admin.from("vihem_kp_company_members").update({ user_id: target.user_id, status: "active", joined_at: new Date().toISOString() }).eq("id", existingMember.id); }
      else { const { error: memberError } = await admin.from("vihem_kp_company_members").insert({ organisation_id: org, customer_id: c.id, user_id: target?.user_id ?? null, email, role: "employee", status: target ? "active" : "invited", invited_by: user.id, joined_at: target ? new Date().toISOString() : null }); if (memberError) console.error("company member insert:", memberError.message); }
      const inviter = `${participant?.first_name ?? ""} ${participant?.last_name ?? ""}`.trim() || c.name;
      await queueMail(admin, org, target ? "seat_assigned" : "participant_invite", email, target ? `${target.first_name} ${target.last_name}`.trim() : "", { name: target ? target.first_name : "", course: seat.course.title, inviter, portal_url: `${ctx.baseUrl}/mina-sidor` }, `seat-${seat.id}-${email}`, "seat", seat.id);
      return reply(200, { ok: true, invited: !target });
    }

    if (action === "company_reclaim") {
      const c = await requireCompanyAdmin(body.customer_id);
      const { data: seat } = await admin.from("vihem_kp_seats").select("id").eq("id", body.seat_id).eq("customer_id", c.id).maybeSingle();
      if (!seat) return reply(404, { error: "Platsen hittades inte.", code: "E_NOT_FOUND" });
      await rpc("vihem_kp_reclaim_seat", { p_seat: seat.id, p_actor: user.id });
      return reply(200, { ok: true });
    }

    if (action === "company_member") {
      const c = await requireCompanyAdmin(body.customer_id);
      const email = text(body.email, 200).toLowerCase();
      if (!EMAIL.test(email)) return reply(400, { error: "Ogiltig e-postadress.", code: "E_INVALID" });
      const op = text(body.op, 20);
      const { data: member } = await admin.from("vihem_kp_company_members").select("id,role,status,user_id").eq("customer_id", c.id).ilike("email", email).neq("status", "removed").maybeSingle();
      if (op === "invite_admin" || op === "invite") {
        const { data: target } = await admin.from("vihem_kp_participants").select("user_id").eq("organisation_id", org).ilike("email", email).maybeSingle();
        if (member) await admin.from("vihem_kp_company_members").update({ role: op === "invite_admin" ? "admin" : member.role }).eq("id", member.id);
        else await admin.from("vihem_kp_company_members").insert({ organisation_id: org, customer_id: c.id, user_id: target?.user_id ?? null, email, role: op === "invite_admin" ? "admin" : "employee", status: target ? "active" : "invited", invited_by: user.id, joined_at: target ? new Date().toISOString() : null });
        return reply(200, { ok: true });
      }
      if (op === "remove") {
        if (!member) return reply(404, { error: "Medlemmen hittades inte.", code: "E_NOT_FOUND" });
        if (member.role === "admin") { const { count } = await admin.from("vihem_kp_company_members").select("id", { count: "exact", head: true }).eq("customer_id", c.id).eq("role", "admin").eq("status", "active"); if ((count ?? 0) <= 1) return reply(409, { error: "Företaget måste ha minst en administratör.", code: "E_STATE" }); }
        await admin.from("vihem_kp_company_members").update({ status: "removed", left_at: new Date().toISOString() }).eq("id", member.id);
        return reply(200, { ok: true });
      }
      return reply(400, { error: "Okänd åtgärd.", code: "E_INVALID" });
    }

    if (action === "company_export") {
      const c = await requireCompanyAdmin(body.customer_id);
      const { data: seats } = await admin.from("vihem_kp_seats").select("assigned_to_user_id,assigned_email,status,course:vihem_kp_courses(title),enrollment:vihem_kp_enrollments(status,progress_percent,completed_at)").eq("customer_id", c.id).limit(5000);
      const ids = [...new Set((seats ?? []).map((s: any) => s.assigned_to_user_id).filter(Boolean))];
      const { data: people } = ids.length ? await admin.from("vihem_kp_participants").select("user_id,first_name,last_name").in("user_id", ids) : { data: [] };
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = ["Namn;E-post;Utbildning;Platsstatus;Framsteg %;Genomförd"];
      for (const s of seats ?? []) { const p: any = (people ?? []).find((x: any) => x.user_id === s.assigned_to_user_id); const en: any = Array.isArray(s.enrollment) ? s.enrollment[0] : s.enrollment; lines.push([`${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim(), s.assigned_email, (s.course as any)?.title, s.status, en?.progress_percent ?? "", en?.completed_at?.slice(0, 10) ?? ""].map(esc).join(";")); }
      return reply(200, { csv: "﻿" + lines.join("\n"), filename: `kompetensmatris-${c.org_number}.csv` });
    }

    // ------------------------------------------------------------------ Kurstillfällen
    if (action === "session_book_seat") {
      const { data: seat } = await admin.from("vihem_kp_seats").select("id,customer_id,owner_user_id,assigned_to_user_id").eq("id", body.seat_id).maybeSingle();
      if (!seat) return reply(404, { error: "Platsen hittades inte.", code: "E_NOT_FOUND" });
      let ok = seat.owner_user_id === user.id || seat.assigned_to_user_id === user.id;
      if (!ok && seat.customer_id) { const { data: m } = await admin.from("vihem_kp_company_members").select("id").eq("customer_id", seat.customer_id).eq("user_id", user.id).eq("status", "active").eq("role", "admin").maybeSingle(); ok = !!m; }
      if (!ok) return reply(404, { error: "Platsen hittades inte.", code: "E_NOT_FOUND" });
      return reply(200, { booking_id: await rpc("vihem_kp_session_book_seat", { p_seat: seat.id, p_session: body.session_id, p_actor: user.id }) });
    }
    if (action === "session_cancel" || action === "session_rebook") {
      const { data: b } = await admin.from("vihem_kp_session_bookings").select("id,user_id,seat_id,seat:vihem_kp_seats(customer_id,owner_user_id,assigned_to_user_id)").eq("id", body.booking_id).maybeSingle();
      if (!b) return reply(404, { error: "Bokningen hittades inte.", code: "E_NOT_FOUND" });
      const seat: any = Array.isArray(b.seat) ? b.seat[0] : b.seat;
      let ok = b.user_id === user.id || seat?.owner_user_id === user.id || seat?.assigned_to_user_id === user.id;
      if (!ok && seat?.customer_id) { const { data: m } = await admin.from("vihem_kp_company_members").select("id").eq("customer_id", seat.customer_id).eq("user_id", user.id).eq("status", "active").eq("role", "admin").maybeSingle(); ok = !!m; }
      if (!ok) return reply(404, { error: "Bokningen hittades inte.", code: "E_NOT_FOUND" });
      if (action === "session_cancel") return reply(200, await rpc("vihem_kp_session_cancel_booking", { p_booking: b.id, p_actor: user.id, p_by_staff: false }));
      return reply(200, { booking_id: await rpc("vihem_kp_session_rebook", { p_booking: b.id, p_new_session: body.session_id, p_actor: user.id, p_by_staff: false }) });
    }
    if (action === "waitlist_join") return reply(201, { id: await rpc("vihem_kp_waitlist_join", { p_session: body.session_id, p_email: user.email, p_user: user.id }) });

    return reply(404, { error: "Okänd åtgärd.", code: "E_ACTION" });
  } catch (error) {
    const m = mapKpError(error);
    return reply(m.status, { error: m.message, code: m.code });
  }
});
