import { sendGmailMessage } from "./google-workspace-mailer.ts";

const money = (v: number, currency = "SEK") => new Intl.NumberFormat("sv-SE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

export interface NotifyContext { organisation_id: string; settings: Record<string, any>; siteUrl: string; companyName: string }

/** Bekräftelsemejl till gästen. Hoppas över (loggas) om ingen avsändaradress är inställd eller mejlsändningen misslyckas. */
export async function emailGuest(admin: any, ctx: NotifyContext, booking: any, kind: "confirmed" | "refunded") {
  const from = String(ctx.settings.sender_email || "").trim();
  if (!from) { console.warn("ekangen: sender_email saknas, hoppar över gästmejl"); return; }
  const unit = booking.unit_title || booking.unit_name || "ditt rum";
  const link = `${ctx.siteUrl}/bokning/${booking.reference}?token=${booking.access_token}`;
  const lines = kind === "confirmed"
    ? [
        `Hej ${booking.guest_name},`, "",
        `Tack för din bokning hos ${ctx.companyName}! Din betalning är mottagen.`, "",
        `Boende: ${unit}`, `Ankomst: ${booking.start_date} (från ${ctx.settings.check_in_time})`,
        `Avresa: ${booking.end_date} (senast ${ctx.settings.check_out_time})`, `Antal gäster: ${booking.guests}`,
        `Totalt betalt: ${money(Number(booking.total), booking.currency)}`, `Bokningsnummer: ${booking.reference}`, "",
        booking.free_cancel_until ? `Gratis avbokning till och med ${booking.free_cancel_until}.` : "",
        `Se eller avboka din bokning: ${link}`, "", `Varmt välkommen!`, ctx.companyName,
      ]
    : [
        `Hej ${booking.guest_name},`, "",
        `Din bokning ${booking.reference} är avbokad.`,
        Number(booking.retained_fee) > 0
          ? `Vi återbetalar ${money(Number(booking.refunded_amount ?? booking.total), booking.currency)} av ${money(Number(booking.total), booking.currency)}. Resterande ${money(Number(booking.retained_fee), booking.currency)} är den betalningsavgift vi själva debiteras av betalleverantören, enligt bokningsvillkoren.`
          : `Hela beloppet ${money(Number(booking.total), booking.currency)} återbetalas.`,
        `Pengarna går till det kort/den betalmetod du använde och kan ta några bankdagar att synas.`, "", ctx.companyName,
      ];
  try {
    await sendGmailMessage(admin, ctx.organisation_id, {
      fromEmail: from, fromName: ctx.companyName, toEmail: booking.guest_email, toName: booking.guest_name,
      subject: kind === "confirmed" ? `Bokningsbekräftelse ${booking.reference}` : `Avbokning ${booking.reference}`,
      text: lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n"),
    });
  } catch (error) {
    console.error("ekangen: gästmejl misslyckades", error instanceof Error ? error.message : error);
  }
}

/** Notis i VI-HEM till alla admins, plus mejl till notification_email om det är inställt. */
export async function notifyAdmins(admin: any, ctx: NotifyContext, title: string, message: string) {
  const { data: admins } = await admin.from("vihem_profiles").select("id").eq("organisation_id", ctx.organisation_id).in("role", ["admin", "superadmin"]).eq("active", true);
  for (const a of admins ?? []) {
    { const { error: notifyError } = await admin.rpc("create_notification", {
      recipient_id: a.id, org_uuid: ctx.organisation_id, notification_title: title, notification_message: message,
      notification_type: "info", notification_link: "short-stay", setting_key: null,
    }); if (notifyError) console.error("create_notification:", notifyError.message); }
  }
  const to = String(ctx.settings.notification_email || "").trim();
  const from = String(ctx.settings.sender_email || "").trim();
  if (to && from) {
    try { await sendGmailMessage(admin, ctx.organisation_id, { fromEmail: from, fromName: ctx.companyName, toEmail: to, subject: title, text: message }); }
    catch (error) { console.error("ekangen: adminmejl misslyckades", error instanceof Error ? error.message : error); }
  }
}
