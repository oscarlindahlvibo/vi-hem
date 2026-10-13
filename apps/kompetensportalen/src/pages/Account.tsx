import { useEffect, useState } from "react";
import { ApiError, learn } from "../lib/api";
import { useSite } from "../lib/context";
import { BankIdButton } from "../components/BankId";
import { useAuth } from "../lib/auth";
import { CERT_LABEL, dateOnly, dateTime, money, statusLabel } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useSeo } from "../lib/seo";

const tone = (s: string) => (["completed", "issued", "valid", "paid", "fulfilled"].includes(s) ? "ok" : ["revoked", "failed", "cancelled", "expired", "superseded"].includes(s) ? "error" : ["awaiting_identity", "pending_payment", "awaiting_invoice_approval"].includes(s) ? "warn" : "");

export function AccountPage() {
  const { session, ready } = useAuth(); const [data, setData] = useState<any>(null); const [error, setError] = useState(""); const [tab, setTab] = useState("courses"); const [msg, setMsg] = useState("");
  useSeo({ title: "Mina sidor | Kompetensportalen", noindex: true });
  const load = () => learn("me").then(setData).catch((e) => setError((e as ApiError).message));
  useEffect(() => { if (ready && !session) navigate("/logga-in?next=/mina-sidor"); else if (session) void load(); }, [ready, session?.user.id]);
  if (error) return <section className="section narrow"><p className="notice error">{error}</p></section>;
  if (!data) return <section className="section narrow"><p className="muted" role="status">Laddar…</p></section>;
  const today = new Date().toISOString().slice(0, 10);
  const download = async (id: string) => { try { const r = await learn("certificate_pdf", { certificate_id: id }); window.open(r.url, "_blank", "noopener"); } catch (e) { setMsg((e as ApiError).message); } };
  const tabs: Array<[string, string]> = [["courses", "Mina utbildningar"], ["certs", "Mina intyg"], ["bookings", "Bokningar"], ["orders", "Ordrar"], ["profile", "Profil"]];
  return <section className="section"><p className="eyebrow">Mina sidor</p><h1>Hej {data.participant.first_name || data.participant.email}!</h1>
    {data.companies.some((c: any) => c.role === "admin") && <p className="notice">Du är administratör för {data.companies.filter((c: any) => c.role === "admin").map((c: any) => c.name).join(", ")}. <Link to="/foretag/portal" className="text-link">Öppna företagsportalen →</Link></p>}
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>{msg && <p className="notice warn" role="status">{msg}</p>}
    {tab === "courses" && (data.enrollments.length ? <div className="course-grid">{data.enrollments.map((e: any) => (
      <div className="card" key={e.id} style={{ margin: 0 }}><span className={`status ${tone(e.status)}`}>{statusLabel[e.status] ?? e.status}</span><h3 style={{ marginTop: 10 }}>{e.course.title}</h3>{e.sponsor?.name && <p className="fine">Bekostad av {e.sponsor.name}</p>}
        {e.course.delivery_form !== "instructor_led" && <><div className="progress" aria-label={`${e.progress_percent} % genomfört`}><i style={{ width: `${e.progress_percent}%` }} /></div><p className="fine">{e.progress_percent} % genomfört{e.valid_until ? ` · tillgänglig till ${dateOnly(e.valid_until)}` : ""}</p></>}
        {!e.access_enabled && <p className="notice warn">Tillgången öppnas när betalningen är bekräftad.</p>}
        {e.access_enabled && !["revoked", "cancelled"].includes(e.status) && e.course.delivery_form !== "instructor_led" && <Link to={`/utbildning/${e.id}`} className="btn primary">{e.status === "not_started" ? "Starta utbildningen" : e.status === "completed" ? "Visa utbildningen" : "Fortsätt där du slutade"}</Link>}
        {e.course.delivery_form !== "self_paced" && <p className="fine">Lärarledd del – se Bokningar.</p>}</div>))}</div> : <div className="card">Du har inga utbildningar ännu. <Link to="/utbildningar" className="text-link">Se utbildningar →</Link></div>)}
    {tab === "certs" && (data.certificates.length ? <div className="list">{data.certificates.map((c: any) => (
      <div className="card row" key={c.id} style={{ margin: 0 }}><div><span className={`status ${tone(c.effective_status)}`}>{statusLabel[c.effective_status] ?? c.effective_status}</span><h3 style={{ margin: "8px 0 2px" }}>{c.course_title}</h3><p className="fine" style={{ margin: 0 }}>{CERT_LABEL[c.kind]} · nr {c.certificate_number} · genomförd {dateOnly(c.completed_on)}{c.valid_until ? ` · giltigt till ${dateOnly(c.valid_until)}` : ""}</p></div>
        <div className="row"><button className="btn small" onClick={() => download(c.id)}>Ladda ner PDF</button><Link className="text-link" to={`/verifiera?kod=${c.verification_code}`}>Verifiera</Link></div></div>))}</div> : <div className="card">Du har inga intyg ännu. Intyg utfärdas automatiskt när du är godkänd.</div>)}
    {tab === "bookings" && <Bookings bookings={data.bookings} onChange={load} />}
    {tab === "orders" && (data.orders.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Datum</th><th>Status</th><th>Betalsätt</th><th>Totalt</th><th>Kvitto</th></tr></thead><tbody>{data.orders.map((o: any) => <tr key={o.id}><td><Link to={`/order/${o.id}`} className="text-link">{o.order_number}</Link></td><td>{dateOnly(o.created_at)}</td><td><span className={`status ${tone(o.status)}`}>{statusLabel[o.status] ?? o.status}</span></td><td>{o.payment_method === "stripe" ? "Kort" : o.payment_method === "invoice" ? "Faktura" : "Gratis"}</td><td>{money(o.total, 2)}</td><td><ReceiptLinks receipts={(data.receipts ?? []).filter((r: any) => r.order_id === o.id)} /></td></tr>)}</tbody></table></div> : <div className="card">Inga ordrar ännu.</div>)}
    {tab === "profile" && <Profile participant={data.participant} onSaved={load} />}
    <p className="fine" style={{ marginTop: 28 }}>Dagens datum {dateOnly(today)}.</p></section>;
}

function Bookings({ bookings, onChange }: { bookings: any[]; onChange: () => void }) {
  const [msg, setMsg] = useState("");
  if (!bookings.length) return <div className="card">Du har inga bokade kurstillfällen.</div>;
  return <div className="list">{msg && <p className="notice warn" role="status">{msg}</p>}{bookings.map((b) => { const s = Array.isArray(b.session) ? b.session[0] : b.session; const free = new Date(s.starts_at).getTime() - s.free_cancellation_hours * 3600000 > Date.now();
    return <div className="card row" key={b.id} style={{ margin: 0 }}><div><span className="status ok">{b.status === "booked" ? "Bokad" : b.status}</span><h3 style={{ margin: "8px 0 2px" }}>{s.title || "Kurstillfälle"}</h3><p className="fine" style={{ margin: 0 }}>{dateTime(s.starts_at)} · {s.location_kind === "online" ? `Digitalt${s.meeting_url ? ` – ${s.meeting_url}` : ""}` : s.location}</p><p className="fine" style={{ margin: 0 }}>{free ? `Kostnadsfri avbokning till ${dateTime(new Date(new Date(s.starts_at).getTime() - s.free_cancellation_hours * 3600000).toISOString())}` : "Fristen för kostnadsfri avbokning har passerat"}</p></div>
      {b.status === "booked" && <button className="btn danger small" onClick={async () => { if (!confirm("Avboka platsen? Du behåller din betalda plats och kan boka om den på ett annat tillfälle.")) return; try { await learn("session_cancel", { booking_id: b.id }); onChange(); } catch (e) { setMsg((e as ApiError).message); } }}>Avboka</button>}</div>; })}</div>;
}

function Profile({ participant, onSaved }: { participant: any; onSaved: () => void }) {
  const { site } = useSite();
  const [f, setF] = useState({ first_name: participant.first_name, last_name: participant.last_name, phone: participant.phone }); const [msg, setMsg] = useState(""); const [pn, setPn] = useState(""); const [consent, setConsent] = useState(false); const [pmsg, setPmsg] = useState("");
  return <div className="two-col"><form className="card" style={{ margin: 0 }} onSubmit={async (e) => { e.preventDefault(); try { const r = await learn("profile_update", f); setMsg(r.note || "Sparat."); onSaved(); } catch (err) { setMsg((err as ApiError).message); } }}>
    <h2>Dina uppgifter</h2><div className="grid2"><label>Förnamn<input required value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} autoComplete="given-name" /></label><label>Efternamn<input required value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} autoComplete="family-name" /></label></div>
    <label style={{ marginTop: 12 }}>Telefon<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></label><label style={{ marginTop: 12 }}>E-post<input value={participant.email} disabled /></label>
    <p className="fine">Namnet används på dina intyg. Redan utfärdade intyg ändras inte automatiskt – kontakta oss vid felstavning.</p>{msg && <p className="notice" role="status">{msg}</p>}<button className="btn primary">Spara</button></form>
    <div className="card" style={{ margin: 0 }}><h2>Identitet</h2><p>{participant.identity_verified ? <span className="status ok">Verifierad</span> : participant.identity_submitted ? <span className="status warn">Personnummer sparat (slutar på {participant.identity_last4}) – väntar på verifiering</span> : <span className="status muted">Inte angiven</span>}</p>
      {!participant.identity_verified && site.bankid_link && <div style={{ marginBottom: 14 }}><label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Jag samtycker till att mitt personnummer behandlas för identitetskontroll och eventuell ID06-registrering.</label><BankIdButton intent="link" returnPath="/mina-sidor" label="Verifiera med BankID" className="btn primary" start={() => learn("bankid_link_start", { consent })} collect={(ref) => learn("bankid_link_collect", { order_ref: ref })} onDone={(r) => { setPmsg(r.verified ? "Din identitet är verifierad med BankID. Du kan nu även logga in med BankID." : r.error || ""); onSaved(); }} /></div>}
      <p className="fine">Vissa utbildningar kräver verifierad identitet innan intyg utfärdas, och ID06-registrering kräver ditt personnummer. Det lagras krypterat och används bara för detta ändamål.</p>
      {!participant.identity_verified && <form onSubmit={async (e) => { e.preventDefault(); try { const r = await learn("identity_submit", { personal_number: pn, consent }); setPmsg(r.note); setPn(""); onSaved(); } catch (err) { setPmsg((err as ApiError).message); } }} style={{ display: "grid", gap: 12 }}><label>Personnummer<input value={pn} onChange={(e) => setPn(e.target.value)} placeholder="ÅÅÅÅMMDD-NNNN" autoComplete="off" inputMode="numeric" /></label><label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Jag samtycker till att mitt personnummer behandlas för identitetskontroll och eventuell ID06-registrering.</label>{pmsg && <p className="notice" role="status">{pmsg}</p>}<button className="btn ghost" disabled={!consent || pn.length < 10}>Spara personnummer</button></form>}</div></div>;
}

export function ReceiptLinks({ receipts }: { receipts: Array<{ id: string; kind: string; receipt_number: string }> }) {
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const open = async (id: string) => { setBusy(id); setErr(""); try { const r = await learn("receipt_pdf", { receipt_id: id }); window.open(r.url, "_blank", "noopener"); } catch (e) { setErr((e as ApiError).message); } setBusy(""); };
  if (!receipts.length) return <span className="fine">–</span>;
  return <span style={{ display: "grid", gap: 4 }}>{receipts.map((r) => <button key={r.id} type="button" className="text-link" disabled={busy === r.id} onClick={() => open(r.id)}>{r.kind === "credit_receipt" ? "Kreditkvitto" : "Kvitto"} {r.receipt_number} (PDF)</button>)}{err && <span className="fine" role="alert">{err}</span>}</span>;
}
