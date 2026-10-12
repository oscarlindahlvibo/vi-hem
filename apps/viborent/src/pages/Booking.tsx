import { useEffect, useRef, useState } from "react";
import { ApiError, BookingView, rentalApi } from "../api";
import { cartActions } from "../lib/cart";
import { useSite } from "../lib/context";
import { dateTime, money } from "../lib/format";
import { Link, navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";

const STATUS: Record<string, [string, string]> = {
  pending: ["Väntar på betalning", "warn"], confirmed: ["Bekräftad", "ok"], active: ["Pågår", "ok"], completed: ["Genomförd", "muted"], cancelled: ["Avbokad", "error"],
};

export function BookingPage({ reference }: { reference: string }) {
  const { site } = useSite();
  const tz = site.timezone || "Europe/Stockholm";
  const { search } = useLocation();
  const token = search.get("token") || "";
  const returned = search.get("betalning");
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const polls = useRef(0);
  useSeo({ title: `Bokning ${reference} – ViboRent`, noindex: true });

  const load = () => rentalApi.booking(reference, token).then(({ booking }) => { setBooking(booking); if (booking.payment_status === "paid") cartActions.clear(); return booking; }).catch((e: ApiError) => { setError(e.message); return null; });
  useEffect(() => { if (!token) { setError("Länken saknar nyckel. Använd länken från bekräftelsen."); return; } load(); }, [reference, token]);
  // Efter Stripe-återvändning kan webhooken vara några sekunder efter: vänta in bekräftelsen.
  useEffect(() => {
    if (returned !== "klar" || !booking || booking.payment_status === "paid") return;
    const t = setInterval(async () => { polls.current++; const b = await load(); if ((b && b.payment_status === "paid") || polls.current > 20) clearInterval(t); }, 2500);
    return () => clearInterval(t);
  }, [returned, booking?.payment_status]);

  if (error) return <section className="section narrow"><h1>Bokning</h1><p className="notice error">{error}</p><Link to="/kundportal" className="text-link">Gå till kundportalen →</Link></section>;
  if (!booking) return <section className="section narrow"><p className="muted">Hämtar bokning…</p></section>;

  const [label, tone] = STATUS[booking.status] || [booking.status, "muted"];
  const awaiting = booking.status === "pending" && booking.payment_status !== "paid";
  const holdLeft = booking.hold_expires_at ? Math.max(0, Math.round((Date.parse(booking.hold_expires_at) - Date.now()) / 60000)) : null;
  const pay = async () => {
    setWorking(true); setNotice("");
    try { const base = `${window.location.origin}/bokning/${booking.public_reference}?token=${token}`; const { checkout_url } = await rentalApi.startPayment(booking.id, token, `${base}&betalning=klar`, `${base}&betalning=avbruten`); window.location.href = checkout_url; }
    catch (e) { setNotice((e as ApiError).message); setWorking(false); }
  };
  const cancel = async () => {
    setWorking(true); setNotice("");
    try { const r = await rentalApi.cancelBooking(booking.id, token); setNotice(r.refund_amount > 0 ? (r.refund_status === "succeeded" ? `Bokningen är avbokad. ${money(r.refund_amount, booking.currency)} återbetalas till ditt kort.` : "Bokningen är avbokad. Återbetalningen hanteras manuellt av uthyraren – du får besked.") : "Bokningen är avbokad."); setConfirmCancel(false); cartActions.clear(); await load(); }
    catch (e) { setNotice((e as ApiError).message); }
    setWorking(false);
  };

  return (
    <section className="section narrow booking-page">
      <p className="eyebrow">Bokning {booking.public_reference}</p>
      <h1>{booking.status === "confirmed" || booking.status === "active" ? "Tack för din bokning!" : "Din bokning"} <span className={`status ${tone}`}>{label}</span></h1>
      {returned === "klar" && booking.payment_status !== "paid" && booking.status !== "cancelled" && <p className="notice warn" role="status">Vi väntar på bekräftelse från betalningen. Sidan uppdateras automatiskt.</p>}
      {returned === "avbruten" && awaiting && <p className="notice warn">Betalningen avbröts. Din reservation gäller {holdLeft !== null ? `i cirka ${holdLeft} min till` : "en kort stund"}.</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="card">
        <ul className="mini-lines">{booking.items.map((it, i) => <li key={i}><strong>{it.quantity} × {it.product.name}</strong><span>{dateTime(it.start_at, tz)} → {dateTime(it.end_at, tz)}</span>{it.product.location && <span>Hämtas: {it.product.location}</span>}{it.product.pickup_instructions && <span>{it.product.pickup_instructions}</span>}</li>)}</ul>
        <dl><div><dt>Delsumma</dt><dd>{money(booking.subtotal, booking.currency)}</dd></div><div><dt>Moms</dt><dd>{money(booking.vat_amount, booking.currency)}</dd></div><div className="total"><dt>Totalt</dt><dd>{money(booking.total, booking.currency)}</dd></div></dl>
        <p className="fineprint">Betalning: {booking.payment_status === "paid" ? "Betald" : booking.payment_status === "refunded" ? "Återbetald" : booking.payment_status === "partially_refunded" ? "Delvis återbetald" : "Ej betald"}{Number(booking.deposit) > 0 ? ` · Deposition ${money(booking.deposit, booking.currency)} vid hämtning` : ""}</p>
      </div>
      {awaiting && <div className="card"><p>{holdLeft !== null ? `Reservationen gäller i cirka ${holdLeft} min.` : ""}</p><button className="btn primary" onClick={pay} disabled={working || booking.contract_status !== "signed"}>{working ? "Vänta…" : "Betala nu"}</button>{booking.contract_status !== "signed" && <p className="fineprint">Avtalet måste signeras i kassan först.</p>}</div>}
      {site.access_enabled && booking.access && booking.status !== "cancelled" && (
        <div className="card"><h2>Kod till låset</h2>
          {booking.access.failed ? <p className="notice warn">Vi kunde inte skicka koden automatiskt. Vi kontaktar dig – eller ring oss.</p>
            : booking.access.sent ? <p>Koden har skickats via SMS till ditt mobilnummer.</p>
            : <p>Din personliga kod skickas via SMS {booking.access.scheduled_for && Date.parse(booking.access.scheduled_for) > Date.now() ? `omkring ${dateTime(booking.access.scheduled_for, tz)}` : "inom kort"}. Av säkerhetsskäl visas den aldrig här.</p>}
        </div>
      )}
      {booking.status === "cancelled" && booking.refund_status !== "none" && <p className="notice">Återbetalning: {booking.refund_status === "succeeded" ? "genomförd" : booking.refund_status === "pending" ? "pågår" : booking.refund_status === "failed" ? "hanteras manuellt av uthyraren" : booking.refund_status}.</p>}
      {["pending", "confirmed"].includes(booking.status) && (
        <div className="card"><h2>Avboka</h2>
          {booking.can_cancel ? (<>
            <p>Du kan avboka kostnadsfritt till {dateTime(booking.cancel_until, tz)}.</p>
            {!confirmCancel ? <button className="btn ghost danger" onClick={() => setConfirmCancel(true)}>Avboka bokningen</button>
              : <div className="confirm"><p><strong>Är du säker?</strong> {booking.payment_status === "paid" ? `Hela beloppet (${money(booking.total, booking.currency)}) återbetalas.` : "Reservationen släpps."}</p><button className="btn danger" onClick={cancel} disabled={working}>Ja, avboka</button> <button className="btn ghost" onClick={() => setConfirmCancel(false)}>Nej, behåll</button></div>}
          </>) : <p>{booking.short_notice ? "Bokningen gjordes med kort varsel och kan inte avbokas online." : "Tiden för kostnadsfri avbokning har passerat eller koden har redan skickats."} Kontakta {site.customer_support_phone || site.customer_support_email || "oss"} om du behöver hjälp.</p>}
        </div>
      )}
      <p><Link to="/kundportal" className="text-link">Kundportalen →</Link> · <button className="text-link" onClick={() => navigate("/hyra")}>Hyr mer</button></p>
    </section>
  );
}
