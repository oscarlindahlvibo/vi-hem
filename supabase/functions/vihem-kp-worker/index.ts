// Schemalagd körning för Kompetensportalen (varje minut via pg_cron -> pg_net, autentiserad med delad hemlighet).
// 1. Skapar certifikat-PDF och köar utskick med bilaga.  2. Köar påminnelser (ej påbörjad, kurstillfälle, utgående intyg, väntelista) idempotent.
// 3. Skickar utgående e-post med återförsök (backoff).  4. ID06-kön: utan verklig API-behörighet markeras ärenden "kräver åtgärd" – inget simuleras.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { queueMail } from "../_shared/kp-common.ts";
import { ensureCertificatePdf } from "../_shared/kp-certificate-render.ts";
import { deliverOutboxRow } from "../_shared/kp-mail.ts";
import { retryPendingReceipts } from "../_shared/kp-receipt.ts";

const sv = (iso: string, tz = "Europe/Stockholm") => new Date(iso).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

Deno.serve(async (request: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: ok } = await admin.rpc("vihem_kp_worker_secret_ok", { p_secret: request.headers.get("x-vihem-kp-worker-secret") || "" });
  if (!ok) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  const summary: Record<string, number> = { pdf: 0, reminders: 0, sent: 0, failed: 0, id06: 0 };
  try {
    const { data: allSettings } = await admin.from("vihem_kp_settings").select("*");
    summary.receipts = await retryPendingReceipts(admin); // kvitton utan PDF eller utskick (t.ex. efter tillfälligt fel)
    for (const settings of allSettings ?? []) {
      const org = settings.organisation_id as string;
      const base = String(settings.public_base_url).replace(/\/$/, "");
      const ctx = { organisationId: org, settings, baseUrl: base };
      const nameOf = (p: any) => [p?.first_name, p?.last_name].filter(Boolean).join(" ");

      // 1. Certifikat utan PDF
      const { data: certs } = await admin.from("vihem_kp_certificates").select("id,user_id,certificate_number,course_title,verification_code,valid_until").eq("organisation_id", org).eq("status", "issued").is("pdf_path", null).limit(5);
      for (const c of certs ?? []) {
        try {
          const path = await ensureCertificatePdf(admin, ctx, c.id); summary.pdf++;
          const { data: p } = await admin.from("vihem_kp_participants").select("email,first_name,last_name").eq("user_id", c.user_id).single();
          await queueMail(admin, org, "certificate_issued", p.email, nameOf(p), { name: p.first_name, course: c.course_title, certificate_number: c.certificate_number, verify_url: `${base}/verifiera?kod=${c.verification_code}` }, `cert-${c.id}-issued`, "certificate", c.id, { bucket: "vihem-kp-private", path, file_name: `intyg-${c.certificate_number}.pdf`, content_type: "application/pdf" });
        } catch (e) { console.error("cert pdf:", e instanceof Error ? e.message : e); }
      }

      // 2a. Påminnelse: ej påbörjad utbildning (efter 3, 10 och 17 dagar)
      const { data: idle } = await admin.from("vihem_kp_enrollments").select("id,user_id,created_at,course:vihem_kp_courses(title)").eq("organisation_id", org).eq("status", "not_started").eq("access_enabled", true).lt("created_at", new Date(Date.now() - 3 * 86400000).toISOString()).limit(200);
      for (const e of idle ?? []) {
        const ageDays = (Date.now() - new Date(e.created_at).getTime()) / 86400000; const step = ageDays >= 17 ? 3 : ageDays >= 10 ? 2 : 1;
        const { data: p } = await admin.from("vihem_kp_participants").select("email,first_name,last_name").eq("user_id", e.user_id).single();
        await queueMail(admin, org, "not_started_reminder", p.email, nameOf(p), { name: p.first_name, course: (e as any).course.title, portal_url: `${base}/mina-sidor` }, `notstarted-${e.id}-${step}`, "enrollment", e.id); summary.reminders++;
      }
      // 2b. Kurstillfälle: bokningsbekräftelse (nya) och påminnelse (inom 48 h)
      const { data: bks } = await admin.from("vihem_kp_session_bookings").select("id,user_id,email,booked_at,seat:vihem_kp_seats(assigned_email,owner_user_id),session:vihem_kp_sessions(starts_at,location_kind,location,meeting_url,free_cancellation_hours,timezone,course:vihem_kp_courses(title))").eq("organisation_id", org).eq("status", "booked").gt("booked_at", new Date(Date.now() - 2 * 86400000).toISOString()).limit(200);
      const { data: soon } = await admin.from("vihem_kp_session_bookings").select("id,user_id,email,seat:vihem_kp_seats(assigned_email,owner_user_id),session:vihem_kp_sessions!inner(starts_at,location_kind,location,meeting_url,free_cancellation_hours,timezone,course:vihem_kp_courses(title))").eq("organisation_id", org).eq("status", "booked").gt("session.starts_at", new Date().toISOString()).lt("session.starts_at", new Date(Date.now() + 48 * 3600000).toISOString()).limit(200);
      const recipient = async (b: any) => { const seat: any = Array.isArray(b.seat) ? b.seat[0] : b.seat; let to = b.email || seat?.assigned_email; let name = ""; const uid = b.user_id || seat?.owner_user_id; if (uid) { const { data: p } = await admin.from("vihem_kp_participants").select("email,first_name,last_name").eq("user_id", uid).maybeSingle(); if (p) { to = to || p.email; name = nameOf(p); } } return { to, name }; };
      for (const [list, key, prefix] of [[bks ?? [], "session_booked", "sessbook"], [soon ?? [], "session_reminder", "sessrem"]] as const) {
        for (const b of list as any[]) {
          const s: any = Array.isArray(b.session) ? b.session[0] : b.session; const course = (Array.isArray(s.course) ? s.course[0] : s.course)?.title; const r = await recipient(b); if (!r.to) continue;
          const loc = s.location_kind === "online" ? `Digitalt${s.meeting_url ? `: ${s.meeting_url}` : ""}` : s.location;
          await queueMail(admin, org, key, r.to, r.name, { name: r.name, course, starts: sv(s.starts_at, s.timezone), location: loc, free_until: sv(new Date(new Date(s.starts_at).getTime() - s.free_cancellation_hours * 3600000).toISOString(), s.timezone) }, `${prefix}-${b.id}`, "session_booking", b.id); summary.reminders++;
        }
      }
      // 2c. Utgående intyg (dagar före utgång enligt kursens förnyelseinställning)
      const { data: expiring } = await admin.from("vihem_kp_certificates").select("id,user_id,certificate_number,course_title,valid_until,renewal_notified,course:vihem_kp_courses(renewal_notice_days)").eq("organisation_id", org).eq("status", "issued").not("valid_until", "is", null).lte("valid_until", new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10)).gte("valid_until", new Date().toISOString().slice(0, 10)).limit(500);
      for (const c of expiring ?? []) {
        const days = Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / 86400000); const notice: number[] = ((Array.isArray(c.course) ? c.course[0] : c.course) as any)?.renewal_notice_days ?? [90, 30]; const done: number[] = c.renewal_notified ?? [];
        const due = notice.filter((d) => days <= d && !done.includes(d)).sort((a, b) => a - b)[0]; if (due === undefined) continue;
        const { data: p } = await admin.from("vihem_kp_participants").select("email,first_name,last_name").eq("user_id", c.user_id).single();
        await queueMail(admin, org, "certificate_expiring", p.email, nameOf(p), { name: p.first_name, course: c.course_title, certificate_number: c.certificate_number, valid_until: c.valid_until, portal_url: `${base}/utbildningar` }, `certexp-${c.id}-${due}`, "certificate", c.id);
        await admin.from("vihem_kp_certificates").update({ renewal_notified: [...done, ...notice.filter((d) => d >= due)] }).eq("id", c.id); summary.reminders++;
      }
      // 2d. Väntelista: meddela när plats blivit ledig
      const { data: wl } = await admin.from("vihem_kp_session_bookings").select("id,email,session_id,session:vihem_kp_sessions(starts_at,capacity,status,timezone,course:vihem_kp_courses(title,slug))").eq("organisation_id", org).eq("status", "waitlisted").is("reminder_sent_at", null).order("created_at").limit(100);
      const freed = new Map<string, number>();
      for (const w of wl ?? []) {
        const s: any = Array.isArray(w.session) ? w.session[0] : w.session; if (!s || s.status !== "open" || new Date(s.starts_at) < new Date()) continue;
        if (!freed.has(w.session_id)) { const { data: taken } = await admin.rpc("vihem_kp_session_taken", { p_session: w.session_id }); freed.set(w.session_id, Math.max(0, s.capacity - (taken ?? 0))); }
        if ((freed.get(w.session_id) ?? 0) <= 0) continue;
        freed.set(w.session_id, (freed.get(w.session_id) ?? 0) - 1);
        const course = Array.isArray(s.course) ? s.course[0] : s.course;
        await queueMail(admin, org, "waitlist_open", w.email, "", { course: course.title, starts: sv(s.starts_at, s.timezone), portal_url: `${base}/utbildningar/${course.slug}` }, `waitlist-${w.id}`, "session_booking", w.id);
        await admin.from("vihem_kp_session_bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", w.id); summary.reminders++;
      }

      // 4. ID06-kön (ingen API-adapter är verifierad/avtalad: ärenden går till manuell hantering och markeras tydligt)
      const { data: claimed } = await admin.rpc("vihem_kp_id06_claim", { p_limit: 10 });
      for (const r of claimed ?? []) {
        await admin.rpc("vihem_kp_id06_result", { p_id: r.id, p_status: "needs_action", p_reference: null, p_error: "Ingen ID06-API-koppling är konfigurerad. Registrera kompetensen manuellt i ID06 och markera ärendet som registrerat med referens.", p_actor: null, p_notes: "" }); summary.id06++;
      }
    }

    // 3. Utgående e-post
    const { data: rows } = await admin.rpc("vihem_kp_outbox_claim", { p_limit: 15 });
    for (const row of rows ?? []) {
      const { data: s } = await admin.from("vihem_kp_settings").select("*").eq("organisation_id", row.organisation_id).single();
      const result = await deliverOutboxRow(admin, s, row);
      await admin.rpc("vihem_kp_outbox_result", { p_id: row.id, p_ok: result.ok, p_error: result.error ?? null });
      result.ok ? summary.sent++ : summary.failed++;
    }
    return new Response(JSON.stringify({ ok: true, ...summary }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("kp worker:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
