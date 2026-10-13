import { useEffect, useState } from "react";
import { ApiError, learn } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, money, statusLabel } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useSeo } from "../lib/seo";

const tone = (s: string) => (["completed", "paid", "fulfilled", "valid", "issued"].includes(s) ? "ok" : ["revoked", "expired", "failed", "cancelled"].includes(s) ? "error" : ["awaiting_invoice_approval", "pending_payment", "invoiced"].includes(s) ? "warn" : "");

export function CompanyPortal() {
  const { session, ready } = useAuth(); const [me, setMe] = useState<any>(null); const [cid, setCid] = useState(""); const [data, setData] = useState<any>(null); const [tab, setTab] = useState("seats"); const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  useSeo({ title: "Företagsportal | Kompetensportalen", noindex: true });
  useEffect(() => { if (ready && !session) navigate("/logga-in?next=/foretag/portal"); else if (session) learn("me").then((d) => { setMe(d); const first = d.companies.find((c: any) => c.role === "admin"); if (first) setCid(first.id); }).catch((e) => setError((e as ApiError).message)); }, [ready, session?.user.id]);
  const load = () => cid ? learn("company_overview", { customer_id: cid }).then(setData).catch((e) => setError((e as ApiError).message)) : Promise.resolve();
  useEffect(() => { void load(); }, [cid]);
  if (error) return <section className="section narrow"><p className="notice error" role="alert">{error}</p></section>;
  if (!me) return <section className="section narrow"><p className="muted" role="status">Laddar…</p></section>;
  const admins = me.companies.filter((c: any) => c.role === "admin");
  if (!admins.length) return <CreateCompany onCreated={async (id) => { const d = await learn("me"); setMe(d); setCid(id); }} />;
  const act = async (fn: () => Promise<any>, ok = "Klart.") => { setMsg(""); try { await fn(); setMsg(ok); await load(); } catch (e) { setMsg((e as ApiError).message); } };
  return <section className="section"><p className="eyebrow">Företagsportal</p><div className="row"><h1>{data?.company.name ?? "Företag"}</h1>{admins.length > 1 && <select value={cid} onChange={(e) => setCid(e.target.value)} aria-label="Välj företag" style={{ width: "auto" }}>{admins.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div>
    {msg && <p className="notice" role="status">{msg}</p>}
    {data && <>
      <div className="stats"><div className="stat"><span className="fine">Köpta platser</span><strong>{data.summary.total}</strong></div><div className="stat"><span className="fine">Oanvända</span><strong>{data.summary.unused}</strong></div><div className="stat"><span className="fine">Väntar på betalning</span><strong>{data.summary.locked}</strong></div><div className="stat"><span className="fine">Pågår</span><strong>{data.summary.assigned + data.summary.active}</strong></div><div className="stat"><span className="fine">Genomförda</span><strong>{data.summary.completed}</strong></div></div>
      <div className="row" style={{ marginBottom: 16 }}><Link to="/utbildningar" className="btn primary">Köp fler platser</Link><button className="btn ghost" onClick={async () => { const r = await learn("company_export", { customer_id: cid }); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" })); a.download = r.filename; a.click(); }}>Ladda ner kompetensmatris (CSV)</button></div>
      <div className="tabs" role="tablist">{[["seats", "Platser & medarbetare"], ["orders", "Ordrar"], ["members", "Administratörer"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "seats" && <Seats data={data} cid={cid} act={act} />}
      {tab === "orders" && (data.orders.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Datum</th><th>Status</th><th>Betalsätt</th><th>Betalt</th><th>Totalt</th></tr></thead><tbody>{data.orders.map((o: any) => <tr key={o.id}><td>{o.order_number}</td><td>{dateOnly(o.created_at)}</td><td><span className={`status ${tone(o.status)}`}>{statusLabel[o.status] ?? o.status}</span></td><td>{o.payment_method === "invoice" ? `Faktura${o.invoice_status ? ` (${o.invoice_status})` : ""}` : o.payment_method === "stripe" ? "Kort" : "Gratis"}</td><td>{money(o.amount_paid, 2)}</td><td>{money(o.total, 2)}</td></tr>)}</tbody></table></div> : <div className="card">Inga ordrar ännu.</div>)}
      {tab === "members" && <Members data={data} cid={cid} act={act} />}
      {!data.company.invoice_purchase_allowed && <p className="fine" style={{ marginTop: 24 }}>Fakturaköp är inte aktiverat för företaget. <Link to="/kontakt" className="text-link">Kontakta oss</Link> för att ansöka.</p>}</>}</section>;
}

function Seats({ data, cid, act }: { data: any; cid: string; act: (fn: () => Promise<any>, ok?: string) => Promise<void> }) {
  const [email, setEmail] = useState<Record<string, string>>({});
  const download = async (id: string) => { const r = await learn("certificate_pdf", { certificate_id: id }); window.open(r.url, "_blank", "noopener"); };
  if (!data.seats.length) return <div className="card">Företaget har inga platser ännu. <Link to="/utbildningar" className="text-link">Köp utbildningar →</Link></div>;
  return <div className="table-wrap"><table><thead><tr><th>Utbildning</th><th>Deltagare</th><th>Status</th><th>Framsteg</th><th>Intyg</th><th>Åtgärd</th></tr></thead><tbody>{data.seats.map((s: any) => (
    <tr key={s.seat_id}><td>{s.course}<br /><span className="fine">{s.order_number}</span></td><td>{s.assignee_name || s.assignee_email || <span className="muted">Ledig plats</span>}{s.assignee_name && <><br /><span className="fine">{s.assignee_email}</span></>}</td>
      <td>{!s.access_enabled && s.seat_status !== "revoked" ? <span className="status warn">Väntar på betalning</span> : <span className={`status ${tone(s.enrollment_status || s.seat_status)}`}>{statusLabel[s.enrollment_status || ""] ?? ({ available: "Ledig", assigned: "Tilldelad", active: "Pågår", completed: "Genomförd", revoked: "Återkallad" } as any)[s.seat_status] ?? s.seat_status}</span>}</td>
      <td>{s.progress_percent != null ? `${s.progress_percent} %` : "–"}</td>
      <td>{s.certificate ? <><span className={`status ${tone(s.certificate.status)}`}>{statusLabel[s.certificate.status] ?? s.certificate.status}</span>{s.certificate.valid_until && <><br /><span className="fine">till {dateOnly(s.certificate.valid_until)}</span></>}<br /><button className="text-link" onClick={() => download(s.certificate.id)}>PDF</button></> : "–"}</td>
      <td style={{ minWidth: 230 }}>{s.access_enabled && ["available", "assigned"].includes(s.seat_status) ? <div style={{ display: "grid", gap: 6 }}><input type="email" placeholder="medarbetarens e-post" aria-label="E-postadress för tilldelning" value={email[s.seat_id] ?? ""} onChange={(e) => setEmail({ ...email, [s.seat_id]: e.target.value })} /><div className="row"><button className="btn small primary" disabled={!email[s.seat_id]} onClick={() => act(() => learn("company_assign", { customer_id: cid, seat_id: s.seat_id, email: email[s.seat_id] }), "Platsen är tilldelad.")}>{s.seat_status === "assigned" ? "Tilldela om" : "Tilldela"}</button>{s.seat_status === "assigned" && <button className="btn small danger" onClick={() => confirm("Ta tillbaka platsen? Det går bara om utbildningen inte är påbörjad.") && act(() => learn("company_reclaim", { customer_id: cid, seat_id: s.seat_id }), "Platsen är återtagen.")}>Ta tillbaka</button>}</div></div> : <span className="fine">–</span>}</td></tr>))}</tbody></table></div>;
}

function Members({ data, cid, act }: { data: any; cid: string; act: (fn: () => Promise<any>, ok?: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  return <div className="two-col"><div className="card" style={{ margin: 0 }}><h2>Medlemmar</h2><div className="table-wrap"><table><thead><tr><th>E-post</th><th>Roll</th><th>Status</th><th /></tr></thead><tbody>{data.members.map((m: any) => <tr key={m.id}><td>{m.email}</td><td>{m.role === "admin" ? "Administratör" : "Medarbetare"}</td><td>{m.status === "active" ? "Aktiv" : "Inbjuden"}</td><td><button className="text-link" onClick={() => confirm(`Ta bort ${m.email} från företaget? Personens intyg och utbildningshistorik ligger kvar hos personen.`) && act(() => learn("company_member", { customer_id: cid, op: "remove", email: m.email }), "Medlemmen är borttagen.")}>Ta bort</button></td></tr>)}</tbody></table></div></div>
    <form className="card" style={{ margin: 0, display: "grid", gap: 12 }} onSubmit={(e) => { e.preventDefault(); void act(() => learn("company_member", { customer_id: cid, op: "invite_admin", email }), "Administratören är tillagd.").then(() => setEmail("")); }}><h2>Lägg till administratör</h2><label>E-post<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><p className="fine">Administratörer kan köpa platser, tilldela medarbetare och se genomförande och intyg för utbildningar företaget bekostat.</p><button className="btn primary">Lägg till</button></form></div>;
}

function CreateCompany({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [f, setF] = useState({ name: "", org_number: "", vat_number: "", billing_address: "", billing_postal_code: "", billing_city: "", invoice_email: "" }); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <section className="section narrow"><p className="eyebrow">Företagsportal</p><h1>Skapa företagskonto</h1><p className="lead">Med ett företagskonto kan du köpa flera kursplatser, fördela dem till medarbetare och följa genomförandet.</p>
    <form className="card" style={{ display: "grid", gap: 14 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { const r = await learn("company_create", f); await onCreated(r.customer_id); } catch (err) { setError((err as ApiError).message); } setBusy(false); }}>
      <label>Företagsnamn<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="organization" /></label>
      <div className="grid2"><label>Organisationsnummer<input required placeholder="NNNNNN-NNNN" value={f.org_number} onChange={(e) => setF({ ...f, org_number: e.target.value })} /></label><label>Momsregistreringsnummer (valfritt)<input value={f.vat_number} onChange={(e) => setF({ ...f, vat_number: e.target.value })} placeholder="SE556000000001" /></label></div>
      <label>Fakturaadress<input value={f.billing_address} onChange={(e) => setF({ ...f, billing_address: e.target.value })} autoComplete="street-address" /></label>
      <div className="grid2"><label>Postnummer<input value={f.billing_postal_code} onChange={(e) => setF({ ...f, billing_postal_code: e.target.value })} autoComplete="postal-code" /></label><label>Ort<input value={f.billing_city} onChange={(e) => setF({ ...f, billing_city: e.target.value })} autoComplete="address-level2" /></label></div>
      <label>E-post för faktura<input type="email" value={f.invoice_email} onChange={(e) => setF({ ...f, invoice_email: e.target.value })} /></label>
      <p className="fine">Du blir administratör för företaget. Köp med kort fungerar direkt; fakturaköp aktiveras av oss efter godkännande.</p>{error && <p className="notice error" role="alert">{error}</p>}<button className="btn primary" disabled={busy}>{busy ? "Skapar…" : "Skapa företagskonto"}</button></form></section>;
}
