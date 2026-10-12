import { FormEvent, useEffect, useState } from "react";
import { createClient, Session } from "@supabase/supabase-js";
import { dateTime, money } from "./lib/format";
import { Link } from "./lib/router";
import { useSeo } from "./lib/seo";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vihem-rental-customer-portal`;

type Booking = {
  id: string; public_reference: string; public_lookup_token: string; status: string; payment_status: string; start_at: string; end_at: string; total: number; currency: string;
  deposit: number; can_cancel: boolean; cancel_until: string; short_notice: boolean; hold_expires_at: string | null; refund_status: string; refund_amount: number;
  access: { scheduled_for: string | null; sent: boolean; failed: boolean } | null;
  items: Array<{ quantity: number; product: { name: string; location: string; pickup_instructions: string } }>;
};
type Data = { customer: { first_name: string; email: string }; bookings: Booking[]; requests: Array<{ id: string; request_type: string; message: string; status: string; staff_reply: string | null }> };

async function call<T>(session: Session, body: Record<string, unknown>) {
  const response = await fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Kundportalen kunde inte svara.");
  return data as T;
}
const STATUS: Record<string, string> = { pending: "Väntar", confirmed: "Bekräftad", active: "Pågår", completed: "Genomförd", cancelled: "Avbokad", paid: "Betald", unpaid: "Obetald", refunded: "Återbetald", partially_refunded: "Delvis återbetald", open: "Öppen", in_progress: "Pågår", resolved: "Löst", question: "Fråga", change_booking: "Ändra bokning", cancel_booking: "Avboka bokning", message: "Meddelande" };
const label = (v: string) => STATUS[v] || v;

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  useSeo({ title: `${title} – ViboRent`, noindex: true });
  return <section className="section narrow portal">{children}</section>;
}

function Login() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); const { error } = await supabase.auth.signInWithPassword({ email, password }); setBusy(false); setMessage(error ? "Fel e-post eller lösenord." : ""); }
  async function reset() { if (!email) return setMessage("Ange din e-postadress först."); await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/kundportal/reset-password` }); setMessage("Om adressen finns hos oss har vi skickat en återställningslänk."); }
  return (
    <Frame title="Kundportal">
      <div className="card narrow-card"><p className="eyebrow">ViboRent</p><h1>Kundportal</h1><p className="muted">Se dina bokningar, avboka kostnadsfritt i tid och kontakta oss. Du får inloggningsuppgifter per e-post efter din första betalda bokning.</p>
        <form onSubmit={submit} className="stack"><label>E-post<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Lösenord<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button className="btn primary" disabled={busy}>{busy ? "Loggar in…" : "Logga in"}</button></form>
        <p><button className="text-link" onClick={() => void reset()}>Glömt lösenord?</button></p>{message && <p className="notice" role="status">{message}</p>}</div>
    </Frame>
  );
}

function ResetPassword() {
  const [password, setPassword] = useState(""), [message, setMessage] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); const { error } = await supabase.auth.updateUser({ password }); setMessage(error ? "Länken har gått ut. Begär en ny." : "Lösenordet är uppdaterat."); }
  return <Frame title="Nytt lösenord"><div className="card narrow-card"><h1>Nytt lösenord</h1><form onSubmit={submit} className="stack"><label>Nytt lösenord (minst 8 tecken)<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button className="btn primary">Spara lösenord</button></form>{message && <p className="notice" role="status">{message}</p>}<Link to="/kundportal" className="text-link">Till inloggningen</Link></div></Frame>;
}

function BookingCard({ booking, onCancel }: { booking: Booking; onCancel: (b: Booking) => Promise<string> }) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  return (
    <article className="card portal-booking">
      <div className="row"><strong>{booking.public_reference}</strong><span><span className={`status ${booking.status === "confirmed" || booking.status === "active" ? "ok" : booking.status === "cancelled" ? "error" : "warn"}`}>{label(booking.status)}</span> <span className="status">{label(booking.payment_status)}</span></span></div>
      <ul className="mini-lines">{booking.items.map((it, i) => <li key={i}><strong>{it.quantity} × {it.product.name}</strong>{it.product.location && <span>Hämtas: {it.product.location}</span>}</li>)}</ul>
      <p className="muted">{dateTime(booking.start_at)} → {dateTime(booking.end_at)} · <strong>{money(booking.total, booking.currency)}</strong></p>
      {booking.access && booking.status !== "cancelled" && <p className="fineprint">{booking.access.failed ? "Vi kunde inte skicka låskoden automatiskt – vi kontaktar dig." : booking.access.sent ? "Låskoden har skickats via SMS." : `Låskoden skickas via SMS ${booking.access.scheduled_for && Date.parse(booking.access.scheduled_for) > Date.now() ? `omkring ${dateTime(booking.access.scheduled_for)}` : "inom kort"}.`}</p>}
      {booking.status === "cancelled" && booking.refund_status !== "none" && <p className="fineprint">Återbetalning: {booking.refund_status === "succeeded" ? `${money(booking.refund_amount, booking.currency)} återbetald` : booking.refund_status === "pending" ? "pågår" : "hanteras manuellt av uthyraren"}.</p>}
      <div className="row actions-row">
        <Link className="btn ghost" to={`/bokning/${booking.public_reference}?token=${booking.public_lookup_token}`}>Visa bokning</Link>
        {booking.can_cancel && !confirm && <button className="btn ghost danger" onClick={() => setConfirm(true)}>Avboka</button>}
      </div>
      {booking.can_cancel && <p className="fineprint">Kostnadsfri avbokning till {dateTime(booking.cancel_until)}.</p>}
      {confirm && <div className="confirm"><p><strong>Avboka {booking.public_reference}?</strong> {booking.payment_status === "paid" ? `Hela beloppet ${money(booking.total, booking.currency)} återbetalas.` : ""}</p><button className="btn danger" disabled={busy} onClick={async () => { setBusy(true); setNote(await onCancel(booking)); setBusy(false); setConfirm(false); }}>Ja, avboka</button> <button className="btn ghost" onClick={() => setConfirm(false)}>Behåll</button></div>}
      {note && <p className="notice" role="status">{note}</p>}
    </article>
  );
}

function Dashboard({ session }: { session: Session }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [text, setText] = useState(""), [type, setType] = useState("question"), [busy, setBusy] = useState(false);
  const load = async () => { try { setData(await call<Data>(session, { action: "me" })); } catch (e) { setError(e instanceof Error ? e.message : "Kunde inte hämta portalen."); } };
  useEffect(() => { void load(); }, []);
  async function send(e: FormEvent) { e.preventDefault(); if (!text.trim()) return; setBusy(true); try { await call(session, { action: "request", request_type: type, message: text }); setText(""); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Kunde inte skicka."); } finally { setBusy(false); } }
  const cancel = async (b: Booking) => { try { const r = await call<{ refund_amount: number; refund_status: string }>(session, { action: "cancel_booking", booking_id: b.id }); await load(); return r.refund_amount > 0 ? (r.refund_status === "succeeded" ? `Avbokad. ${money(r.refund_amount, b.currency)} återbetalas till ditt kort.` : "Avbokad. Återbetalningen hanteras manuellt av uthyraren.") : "Bokningen är avbokad."; } catch (e) { return e instanceof Error ? e.message : "Kunde inte avboka."; } };
  if (error) return <Frame title="Kundportal"><div className="card"><h1>Kundportal</h1><p className="notice error">{error}</p><button className="btn ghost" onClick={() => void supabase.auth.signOut()}>Logga ut</button></div></Frame>;
  if (!data) return <Frame title="Kundportal"><p className="muted" role="status">Laddar…</p></Frame>;
  return (
    <Frame title="Kundportal">
      <div className="row"><div><p className="eyebrow">Kundportal</p><h1>Hej {data.customer.first_name || "där"}!</h1></div><button className="btn ghost" onClick={() => void supabase.auth.signOut()}>Logga ut</button></div>
      <h2>Mina bokningar</h2>
      {data.bookings.length === 0 ? <p className="muted">Du har inga bokningar ännu. <Link to="/hyra" className="text-link">Hyr utrustning →</Link></p> : data.bookings.map((b) => <BookingCard key={b.id} booking={b} onCancel={cancel} />)}
      <h2>Kontakta oss</h2>
      <form onSubmit={send} className="card stack"><label>Ärende<select value={type} onChange={(e) => setType(e.target.value)}><option value="question">Fråga</option><option value="change_booking">Ändra bokning</option><option value="cancel_booking">Avboka (efter fri avbokningstid)</option><option value="message">Meddelande</option></select></label><label>Meddelande<textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} required /></label><button className="btn primary" disabled={busy}>{busy ? "Skickar…" : "Skicka"}</button></form>
      {data.requests.map((r) => <article className="card" key={r.id}><div className="row"><strong>{label(r.request_type)}</strong><span className="status">{label(r.status)}</span></div><p>{r.message}</p>{r.staff_reply && <blockquote className="reply">{r.staff_reply}</blockquote>}</article>)}
    </Frame>
  );
}

export function CustomerPortal({ reset = false }: { reset?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (reset) return <ResetPassword />;
  if (!ready) return <Frame title="Kundportal"><p className="muted">Laddar…</p></Frame>;
  return session ? <Dashboard session={session} /> : <Login />;
}
