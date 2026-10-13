import { LESSOR_NAME } from "../lib/siteIdentity";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, BookingView, rentalApi } from "../api";
import { SignaturePad } from "../components/SignaturePad";
import { cartActions } from "../lib/cart";
import { useSite } from "../lib/context";
import { dateTime, durationLabel, money } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useSeo } from "../lib/seo";
import { useCartQuote } from "./Cart";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function Checkout() {
  const { site } = useSite();
  const tz = site.timezone || "Europe/Stockholm";
  const { cart, quote, error: quoteError, loading, retry: retryQuote } = useCartQuote();
  const [form, setForm] = useState({ first_name: "", last_name: "", company_name: "", identifier: "", email: "", phone: "", address: "", postal_code: "", city: "", notes: "" });
  const [terms, setTerms] = useState(false);
  const [ack, setAck] = useState(false);
  const [signature, setSignature] = useState("");
  const [contract, setContract] = useState<{ version: number; title: string; body: string } | null>(null);
  const [contractError, setContractError] = useState("");
  const [contractRetry, setContractRetry] = useState(0);
  const submitLock = useRef(false);
  const [showContract, setShowContract] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [paymentOff, setPaymentOff] = useState<{ reference: string; token: string } | null>(null);
  useSeo({ title: "Kassa – ViboRent", noindex: true });
  useEffect(() => {
    let alive = true; setContract(null); setContractError(""); setTerms(false); setSignature("");
    rentalApi.contract().then(({ contract }) => {
      if (!alive) return;
      if (!site.contract_version?.id || !contract.body.trim() || contract.body.trim() === "ViboRent uthyrningsavtal v1" || contract.version !== site.contract_version.version) {
        setContractError("Ett fullständigt hyresavtal behöver aktiveras av uthyraren innan bokningen kan slutföras."); return;
      }
      setContract(contract);
    }).catch(() => { if (alive) setContractError("Hyresavtalet kunde inte hämtas. Försök igen innan du signerar."); });
    return () => { alive = false; };
  }, [contractRetry, site.contract_version?.id, site.contract_version?.version]);

  if (!cart.items.length && !paymentOff) return <section className="section"><h1>Kassa</h1><div className="empty">Varukorgen är tom. <Link to="/hyra" className="text-link">Se utrustning →</Link></div></section>;
  if (paymentOff) return (
    <section className="section narrow"><h1>Bokningen är skapad</h1>
      <p className="notice warn">Kortbetalning är inte aktiverad ännu, så bokningen kan inte slutföras online. Din reservation ligger kvar en kort stund. Kontakta oss med bokningsnummer <strong>{paymentOff.reference}</strong> så hjälper vi dig.</p>
      <Link className="btn primary" to={`/bokning/${paymentOff.reference}?token=${paymentOff.token}`}>Visa bokningen</Link></section>
  );

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });
  const allAvailable = !loading && !quoteError && !!quote && quote.lines.every((l) => l.available);
  const needsAck = !!quote?.short_notice;
  const signer = `${form.first_name} ${form.last_name}`.trim() || form.company_name;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current) return;
    setError("");
    if (!allAvailable || !contract) return setError("Vänta tills pris, tillgänglighet och hyresavtal är kontrollerade.");
    if (!EMAIL.test(form.email)) return setError("Ange en giltig e-postadress.");
    if (!(form.first_name || form.company_name)) return setError("Ange namn eller företagsnamn.");
    if (form.phone.replace(/[^\d]/g, "").length < 7) return setError("Ange ett giltigt telefonnummer – låskoden och bokningsinfo skickas dit.");
    if (!terms) return setError("Du måste godkänna hyresvillkoren.");
    if (needsAck && !ack) return setError("Bekräfta att avbokning inte längre gäller vid kort varsel.");
    if (!signature) return setError("Signera avtalet i rutan ovan.");
    submitLock.current = true; setSubmitting(true);
    try {
      const payload = {
        items: cart.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, start_at: i.startAt, end_at: i.endAt })),
        customer: { first_name: form.first_name, last_name: form.last_name, company_name: form.company_name, identifier: form.identifier, email: form.email, phone: form.phone, address: form.address, postal_code: form.postal_code, city: form.city },
        customer_notes: form.notes, accepted_terms: true, acknowledge_short_notice: ack,
      };
      const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
      const checkoutDigest = Array.from(new Uint8Array(digestBytes), b => b.toString(16).padStart(2, "0")).join("");
      let pending = cart.pending;
      let reserved: BookingView | null = null;
      if (pending) {
        reserved = (await rentalApi.booking(pending.reference, pending.token)).booking;
        if (reserved.status === "cancelled") {
          cartActions.setPending(null);
          throw new Error("Reservationen är avbokad. Du kan försöka igen för att skapa en ny bokning med dina aktuella uppgifter.");
        }
      }
      if (pending && pending.checkoutDigest !== checkoutDigest) {
        throw new Error("Det finns redan en reservation med andra kunduppgifter. Öppna reservationen nedan och avboka den innan du gör en ny bokning, eller återställ uppgifterna för att försöka igen.");
      }
      if (!pending) {
        const { booking } = await rentalApi.createBooking(payload);
        pending = { id: booking.id, reference: booking.public_reference, token: booking.public_lookup_token, createdAt: Date.now(), holdExpiresAt: booking.hold_expires_at, checkoutDigest };
        cartActions.setPending(pending);
      }
      reserved ||= (await rentalApi.booking(pending.reference, pending.token)).booking;
      if (reserved.contract_terms_snapshot !== contract.body) throw new Error("Reservationens avtal skiljer sig från det visade avtalet. Öppna reservationen eller kontakta uthyraren innan du fortsätter.");
      if (reserved.status !== "pending" || reserved.payment_status === "paid") throw new Error("Reservationens status har ändrats. Öppna reservationen för att se aktuell status.");
      if (reserved.contract_status !== "signed") await rentalApi.signContract({ booking_id: pending.id, public_lookup_token: pending.token, signer_name: signer, signature, accepted_terms: true });
      const base = `${window.location.origin}/bokning/${pending.reference}?token=${pending.token}`;
      try {
        const { checkout_url } = await rentalApi.startPayment(pending.id, pending.token, `${base}&betalning=klar`, `${base}&betalning=avbruten`);
        window.location.href = checkout_url;
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) { setPaymentOff({ reference: pending.reference, token: pending.token }); return; }
        throw e;
      }
    } catch (e) {
      const err = e as ApiError;
      setError(err.message || "Något gick fel.");
      // Behåll reservationen vid fel: den kan fortfarande finnas på servern.
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="section checkout">
      <h1>Kassa</h1>
      <form onSubmit={submit} className="checkout-layout" noValidate>
        <div className="checkout-main">
          <fieldset disabled={submitting}><legend>Dina uppgifter</legend>
            <div className="grid2"><label>Förnamn<input autoComplete="given-name" value={form.first_name} onChange={set("first_name")} /></label><label>Efternamn<input autoComplete="family-name" value={form.last_name} onChange={set("last_name")} /></label></div>
            <div className="grid2"><label>E-post<input type="email" autoComplete="email" required value={form.email} onChange={set("email")} /></label><label>Mobilnummer (för låskod)<input type="tel" autoComplete="tel" required value={form.phone} onChange={set("phone")} placeholder="070 123 45 67" /></label></div>
            <details className="optional-details"><summary>Företag, adress eller meddelande (valfritt)</summary><div className="optional-fields">
            <label>Företag (valfritt)<input autoComplete="organization" value={form.company_name} onChange={set("company_name")} /></label>
            <label>Adress<input autoComplete="street-address" value={form.address} onChange={set("address")} /></label>
            <div className="grid2"><label>Postnummer<input autoComplete="postal-code" value={form.postal_code} onChange={set("postal_code")} /></label><label>Ort<input autoComplete="address-level2" value={form.city} onChange={set("city")} /></label></div>
            <label>Meddelande till uthyraren (valfritt)<textarea rows={3} maxLength={2000} value={form.notes} onChange={set("notes")} /></label>
            </div></details>
          </fieldset>
          <fieldset disabled={submitting}><legend>Avtal</legend>
            <p>Hyresavtalet upprättas av {LESSOR_NAME} och kan inte ändras av hyrestagaren. <button type="button" className="text-link" onClick={() => setShowContract(!showContract)}>{showContract ? "Dölj avtalet" : "Läs avtalet"}</button></p>
            {showContract && <pre className="contract-text" tabIndex={0}>{contract ? `${contract.title}\n\n${contract.body}` : "Hämtar…"}</pre>}
            {contractError && <div className="notice error" role="alert">{contractError} <button type="button" className="text-link" onClick={() => setContractRetry(n => n + 1)}>Försök igen</button></div>}
            {!contract && !contractError && <p role="status">Kontrollerar hyresavtalet…</p>}
            {contract && <><p className="label-like">Signera här</p><SignaturePad value={signature} onChange={setSignature} /></>}
            <label className="check"><input type="checkbox" disabled={!contract} checked={terms} onChange={(e) => setTerms(e.target.checked)} /> Jag har läst och godkänner hyresavtalet{site.terms_url && <> och <a href={site.terms_url} target="_blank" rel="noopener noreferrer">hyresvillkoren</a></>}.</label>
            {needsAck && <label className="check warn"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Jag förstår att bokningen startar inom {site.access_dispatch_minutes} minuter, att låskoden skickas direkt efter betalning och att <strong>avbokning enligt ordinarie regler inte gäller</strong>.</label>}
          </fieldset>
        </div>
        <aside className="summary">
          <h2>Din bokning</h2>
          <ul className="mini-lines">{cart.items.map((i) => <li key={i.key}><strong>{i.quantity} × {i.name}</strong><span>{dateTime(i.startAt, tz)} → {dateTime(i.endAt, tz)} ({durationLabel(i.startAt, i.endAt)})</span></li>)}</ul>
          {quoteError && <div className="notice error" role="alert">{quoteError} <button type="button" className="text-link" onClick={retryQuote}>Försök igen</button></div>}
          {loading && <p className="muted">Uppdaterar pris…</p>}
          {quote && !allAvailable && <p className="notice error">Något i varukorgen är inte längre tillgängligt. <Link to="/varukorg" className="text-link">Se varukorgen</Link></p>}
          {quote && <dl><div><dt>Delsumma</dt><dd>{money(quote.subtotal, quote.currency)}</dd></div><div><dt>Moms</dt><dd>{money(quote.vat_amount, quote.currency)}</dd></div><div className="total"><dt>Att betala</dt><dd>{money(quote.total, quote.currency)}</dd></div></dl>}
          {quote && Number(quote.deposit) > 0 && <p className="fineprint">Deposition {money(quote.deposit, quote.currency)} tillkommer vid hämtning.</p>}
          <p className="fineprint">{needsAck ? "Ordinarie avbokning gäller inte för denna bokning." : `Kostnadsfri avbokning fram till ${site.free_cancellation_minutes} min före start.`}</p>
          {error && <p className="notice error" role="alert">{error}</p>}
          {cart.pending && <p className="notice"><Link to={`/bokning/${cart.pending.reference}?token=${cart.pending.token}`}>Öppna befintlig reservation {cart.pending.reference}</Link></p>}
          <button className="btn primary large" type="submit" disabled={submitting || !allAvailable || !contract}>{submitting ? "Vänta…" : "Signera och betala"}</button>
          <p className="fineprint">Du skickas till Stripe för säker kortbetalning. Reservationen gäller i {site.booking_hold_minutes} minuter.</p>
        </aside>
      </form>
    </section>
  );
}
