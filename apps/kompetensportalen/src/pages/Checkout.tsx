import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, Quote, checkout, learn, pub } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cartActions, useCart } from "../lib/cart";
import { money } from "../lib/format";
import { Link, navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";
import { useSite } from "../lib/context";

export function CartPage() {
  const cart = useCart(); const [quote, setQuote] = useState<Quote | null>(null); const [error, setError] = useState("");
  useSeo({ title: "Varukorg | Kompetensportalen", noindex: true });
  const sig = JSON.stringify(cart.items.map((i) => [i.product_id, i.quantity, i.session_id]));
  useEffect(() => { setError(""); if (!cart.items.length) { setQuote(null); return; } let alive = true; pub.quote(cart.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, session_id: i.session_id }))).then(({ quote }) => alive && setQuote(quote)).catch((e) => alive && setError((e as ApiError).message)); return () => { alive = false; }; }, [sig]);
  if (!cart.items.length) return <section className="section narrow"><h1>Varukorg</h1><div className="card">Varukorgen är tom. <Link to="/utbildningar" className="text-link">Se utbildningar →</Link></div></section>;
  return <section className="section"><h1>Varukorg</h1><div className="checkout-layout"><div className="list">{cart.items.map((i) => (
    <div className="card" key={i.key} style={{ margin: 0 }}><div className="row"><div><Link to={`/utbildningar/${i.slug}`}><strong>{i.name}</strong></Link>{i.session_label && <p className="fine" style={{ margin: 0 }}>Tillfälle {i.session_label}</p>}</div>
      <div className="row"><span className="stepper"><button aria-label="Minska" onClick={() => cartActions.setQuantity(i.key, i.quantity - 1)}>−</button><output>{i.quantity}</output><button aria-label="Öka" onClick={() => cartActions.setQuantity(i.key, Math.min(500, i.quantity + 1))}>+</button></span><button className="text-link" onClick={() => cartActions.remove(i.key)}>Ta bort</button></div></div></div>))}</div>
    <aside className="summary"><h2>Sammanfattning</h2>{error && <p className="notice error" role="alert">{error}</p>}{quote && <dl><div><dt>Delsumma</dt><dd>{money(quote.subtotal)}</dd></div><div><dt>Moms</dt><dd>{money(quote.vat_total)}</dd></div><div className="total"><dt>Totalt</dt><dd>{money(quote.total)}</dd></div></dl>}<Link className="btn primary large" to="/kassa">Till kassan</Link><p className="fine">Rabattkod och betalsätt väljer du i kassan.</p></aside></div></section>;
}

type Company = { id: string; name: string; org_number: string; invoice_purchase_allowed: boolean; role: string };

export function CheckoutPage() {
  const { site } = useSite(); const { session, ready } = useAuth(); const cart = useCart(); const { search } = useLocation();
  const [me, setMe] = useState<{ companies: Company[]; participant: any } | null>(null);
  const [buyerType, setBuyerType] = useState<"private" | "company">("private"); const [customerId, setCustomerId] = useState(""); const [method, setMethod] = useState<"stripe" | "invoice">("stripe");
  const [code, setCode] = useState(""); const [appliedCode, setAppliedCode] = useState(""); const [quote, setQuote] = useState<Quote | null>(null); const [qError, setQError] = useState("");
  const [terms, setTerms] = useState(false), [withdrawal, setWithdrawal] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const idem = useRef(""); useSeo({ title: "Kassa | Kompetensportalen", noindex: true });
  useEffect(() => { if (ready && !session) navigate(`/logga-in?next=${encodeURIComponent("/kassa")}`); }, [ready, session]);
  useEffect(() => { if (session) learn("me").then((d) => { setMe(d); const adminOf = (d.companies as Company[]).filter((c) => c.role === "admin"); if (adminOf.length) setCustomerId(adminOf[0].id); }).catch(() => setMe({ companies: [], participant: null })); }, [session?.user.id]);
  const companies = (me?.companies ?? []).filter((c) => c.role === "admin"); const cust = companies.find((c) => c.id === customerId);
  const items = cart.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, session_id: i.session_id }));
  const sig = JSON.stringify([items, appliedCode, buyerType === "company" ? customerId : ""]);
  useEffect(() => { if (!items.length || !session) return; setQError(""); let alive = true; pub.quote(items, appliedCode || undefined, buyerType === "company" ? customerId : undefined).then(({ quote }) => alive && setQuote(quote)).catch((e) => { if (alive) { setQuote(null); setQError((e as ApiError).message); if (appliedCode) setAppliedCode(""); } }); return () => { alive = false; }; }, [sig, !!session]);
  useEffect(() => { if (method === "invoice" && !(buyerType === "company" && cust?.invoice_purchase_allowed && site.invoice_enabled)) setMethod("stripe"); }, [buyerType, customerId, me]);
  const key = useMemo(() => { idem.current = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) + "-" + sig.length; return idem.current; }, [sig, method, buyerType, terms]);

  if (!cart.items.length) return <section className="section narrow"><h1>Kassa</h1><div className="card">Varukorgen är tom. <Link to="/utbildningar" className="text-link">Se utbildningar →</Link></div></section>;
  if (!session) return <section className="section narrow"><p className="muted">Skickar dig till inloggningen…</p></section>;
  const canInvoice = buyerType === "company" && !!cust?.invoice_purchase_allowed && site.invoice_enabled;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (buyerType === "company" && !customerId) return setError("Välj eller skapa ett företagskonto.");
    if (!terms) return setError("Du måste godkänna köpvillkoren."); if (buyerType === "private" && !withdrawal) return setError("Du måste samtycka till att den digitala leveransen påbörjas.");
    setBusy(true);
    try {
      const r = await checkout("create_order", { items, code: appliedCode || undefined, buyer_type: buyerType, customer_id: buyerType === "company" ? customerId : undefined, payment_method: quote && quote.total === 0 ? "free" : method, accepted_terms: true, withdrawal_consent: withdrawal, idempotency_key: key, billing: { name: cust?.name ?? "" } });
      if (r.checkout_url) { window.location.href = r.checkout_url; return; }
      cartActions.clear(); navigate(`/order/${r.order_id}`);
    } catch (err) { setError((err as ApiError).message); setBusy(false); }
  }
  return <section className="section"><h1>Kassa</h1>
    <form className="checkout-layout" onSubmit={submit} noValidate><div>
      <fieldset><legend>Köpare</legend><div className="choice" role="radiogroup" aria-label="Köpare"><label className={buyerType === "private" ? "on" : ""}><input type="radio" name="bt" checked={buyerType === "private"} onChange={() => setBuyerType("private")} /> Privatperson</label><label className={buyerType === "company" ? "on" : ""}><input type="radio" name="bt" checked={buyerType === "company"} onChange={() => setBuyerType("company")} /> Företag</label></div>
        {buyerType === "company" && (companies.length ? <label>Företag<select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.org_number})</option>)}</select></label> : <p className="notice">Du är inte administratör för något företagskonto. <Link to="/foretag/portal" className="text-link">Skapa företagskonto</Link></p>)}
        {buyerType === "company" && cust && !cust.invoice_purchase_allowed && site.invoice_enabled && <p className="fine">Fakturaköp kräver godkännande av oss. <Link to="/kontakt" className="text-link">Kontakta oss</Link> för att ansöka.</p>}</fieldset>
      <fieldset><legend>Betalning</legend><div className="choice"><label className={method === "stripe" ? "on" : ""}><input type="radio" name="pm" checked={method === "stripe"} onChange={() => setMethod("stripe")} /> Kort (Stripe)</label><label className={method === "invoice" ? "on" : ""} style={{ opacity: canInvoice ? 1 : .5 }}><input type="radio" name="pm" disabled={!canInvoice} checked={method === "invoice"} onChange={() => setMethod("invoice")} /> Faktura (företag)</label></div>
        {method === "invoice" && <p className="fine">Fakturan skickas efter att ordern godkänts. Kursåtkomst enligt överenskomna villkor (direkt eller först efter betalning).</p>}
        <div className="row" style={{ alignItems: "flex-end" }}><label style={{ flex: 1 }}>Rabattkod<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label><button type="button" className="btn ghost" onClick={() => setAppliedCode(code.trim())}>Använd</button></div>{qError && <p className="notice error" role="alert">{qError}</p>}{quote?.code_applied && <p className="notice ok">Rabattkoden är tillämpad.</p>}</fieldset>
      <fieldset><legend>Villkor</legend><label className="check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> Jag godkänner <Link to="/villkor" className="text-link" target="_blank">köpvillkoren</Link>{buyerType === "company" && method === "invoice" && <> och <Link to="/fakturavillkor" className="text-link" target="_blank">fakturavillkoren</Link></>} och har tagit del av <Link to="/integritet" className="text-link" target="_blank">integritetspolicyn</Link>.</label>
        {buyerType === "private" && <label className="check"><input type="checkbox" checked={withdrawal} onChange={(e) => setWithdrawal(e.target.checked)} /> Jag samtycker till att leveransen av den digitala utbildningen påbörjas direkt efter betalning och förstår att jag därmed kan förlora min ångerrätt när utbildningen har påbörjats. <Link to="/angerratt" className="text-link" target="_blank">Läs mer</Link></label>}</fieldset>
    </div>
    <aside className="summary"><h2>Din beställning</h2><ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "grid", gap: 8 }}>{cart.items.map((i) => <li key={i.key}><strong>{i.quantity} × {i.name}</strong>{i.session_label && <span className="fine"><br />Tillfälle {i.session_label}</span>}</li>)}</ul>
      {quote && <dl>{quote.discount_total > 0 && <div><dt>Rabatt</dt><dd>−{money(quote.discount_total)}</dd></div>}<div><dt>Delsumma</dt><dd>{money(quote.subtotal - quote.discount_total)}</dd></div><div><dt>Moms</dt><dd>{money(quote.vat_total, 2)}</dd></div><div className="total"><dt>Att betala</dt><dd>{money(quote.total, 2)}</dd></div></dl>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="btn primary large" disabled={busy || !quote || (buyerType === "company" && !customerId)}>{busy ? "Vänta…" : method === "invoice" ? "Beställ mot faktura" : quote?.total === 0 ? "Slutför" : "Gå till betalning"}</button>
      <p className="fine">{method === "stripe" ? "Du skickas till Stripe för säker kortbetalning. Tillgång ges när betalningen är bekräftad." : "Ordern bekräftas via e-post."}</p></aside></form></section>;
}

export function OrderPage({ orderId }: { orderId: string }) {
  const { search } = useLocation(); const returned = search.get("betalning"); const [order, setOrder] = useState<any>(null); const [error, setError] = useState(""); const polls = useRef(0);
  useSeo({ title: "Din order | Kompetensportalen", noindex: true });
  const load = () => checkout("order_status", { order_id: orderId }).then((r) => { setOrder(r.order); return r.order; }).catch((e) => { setError((e as ApiError).message); return null; });
  useEffect(() => { void load(); }, [orderId]);
  useEffect(() => { if (!order || !["pending_payment"].includes(order.status) || returned !== "klar") return; const t = setInterval(async () => { polls.current++; const o = await load(); if ((o && o.status !== "pending_payment") || polls.current > 24) clearInterval(t); }, 2500); return () => clearInterval(t); }, [order?.status, returned]);
  useEffect(() => { if (order && ["paid", "fulfilled"].includes(order.status)) cartActions.clear(); }, [order?.status]);
  if (error) return <section className="section narrow"><h1>Din order</h1><p className="notice error">{error}</p></section>;
  if (!order) return <section className="section narrow"><p className="muted">Hämtar order…</p></section>;
  const paid = ["paid", "fulfilled"].includes(order.status);
  return <section className="section narrow"><p className="eyebrow">Order {order.order_number}</p>
    {paid ? <><h1>Tack för din beställning!</h1><p className="notice ok" role="status">Betalningen är bekräftad. Din utbildning finns under Mina sidor.</p><Link to="/mina-sidor" className="btn primary large">Till mina utbildningar</Link></>
      : order.status === "pending_payment" ? <><h1>{returned === "avbruten" ? "Betalningen avbröts" : "Väntar på betalningsbekräftelse"}</h1>{returned === "avbruten" ? <><p className="notice warn">Ingen betalning har genomförts och ingen åtkomst har getts.</p><Link to="/kassa" className="btn primary">Försök igen</Link></> : <p className="notice" role="status">Vi väntar på bekräftelse från betalleverantören. Sidan uppdateras automatiskt. Åtkomst ges först när betalningen är verifierad.</p>}</>
      : ["awaiting_invoice_approval", "invoiced"].includes(order.status) ? <><h1>Din order är mottagen</h1><p className="notice ok">{order.status === "awaiting_invoice_approval" ? "Ordern väntar på godkännande. Du får besked via e-post." : "Ordern är godkänd och faktureras."}{order.access_enabled ? " Platserna är redan tillgängliga." : " Platserna öppnas enligt era fakturavillkor."}</p><Link to="/foretag/portal" className="btn primary">Till företagsportalen</Link></>
      : <><h1>Order {order.status === "expired" ? "förföll" : order.status === "failed" ? "misslyckades" : "avbruten"}</h1><p className="notice warn">Ordern är inte betald och ger ingen åtkomst.</p><Link to="/utbildningar" className="btn primary">Se utbildningar</Link></>}</section>;
}
