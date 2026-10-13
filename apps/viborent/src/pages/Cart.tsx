import { useEffect, useState } from "react";
import { ApiError, CartQuote, rentalApi } from "../api";
import { cartActions, useCart } from "../lib/cart";
import { useSite } from "../lib/context";
import { dateTime, durationLabel, imageFor, money } from "../lib/format";
import { Link } from "../lib/router";
import { useSeo } from "../lib/seo";

export function useCartQuote() {
  const cart = useCart();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resolvedSignature, setResolvedSignature] = useState("");
  const [retry, setRetry] = useState(0);
  const signature = JSON.stringify(cart.items.map((i) => [i.productId, i.quantity, i.startAt, i.endAt]));
  useEffect(() => {
    setError(""); setQuote(null); setResolvedSignature(""); if (!cart.items.length) { setQuote(null); return; }
    let alive = true; setLoading(true);
    rentalApi.quoteCart(cart.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, start_at: i.startAt, end_at: i.endAt })))
      .then(({ quote }) => { if (alive) { setQuote(quote); setResolvedSignature(signature); } }).catch((e: ApiError) => alive && (setQuote(null), setError(e.message))).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [cart.items, signature, retry]);
  return { cart, quote: resolvedSignature === signature ? quote : null, error, loading: loading || (!!cart.items.length && resolvedSignature !== signature && !error), retry: () => setRetry(n => n + 1) };
}

export function Cart() {
  const { site } = useSite();
  const tz = site.timezone || "Europe/Stockholm";
  const { cart, quote, error, loading, retry } = useCartQuote();
  useSeo({ title: "Varukorg – ViboRent", noindex: true });
  if (!cart.items.length) return <section className="section"><h1>Varukorg</h1><div className="empty">Varukorgen är tom. <Link to="/hyra" className="text-link">Se utrustning →</Link></div></section>;
  const lineInfo = (key: string) => quote?.lines.find((l) => l.product_id === cart.items.find((i) => i.key === key)?.productId && l.start_at === cart.items.find((i) => i.key === key)?.startAt && l.end_at === cart.items.find((i) => i.key === key)?.endAt);
  const allAvailable = !loading && !error && !!quote && quote.lines.every((l) => l.available);
  return (
    <section className="section cart-page">
      <h1>Varukorg</h1>
      <div className="cart-layout">
        <ul className="cart-lines">
          {cart.items.map((item) => {
            const info = lineInfo(item.key);
            return (
              <li key={item.key}>
                <img src={item.image || imageFor()} alt="" loading="lazy" />
                <div>
                  <Link to={`/hyra/${item.slug}`}><strong>{item.name}</strong></Link>
                  <p className="muted">{dateTime(item.startAt, tz)} → {dateTime(item.endAt, tz)} ({durationLabel(item.startAt, item.endAt)})</p>
                  {info && !info.available && <p className="notice error">Inte längre tillgänglig i önskat antal. Ändra antal eller tid.</p>}
                  <div className="line-actions">
                    <span className="stepper"><button onClick={() => cartActions.setQuantity(item.key, item.quantity - 1)} aria-label="Minska">−</button><output>{item.quantity}</output><button onClick={() => cartActions.setQuantity(item.key, item.quantity + 1)} aria-label="Öka">+</button></span>
                    <Link className="text-link" to={`/hyra/${item.slug}?rad=${encodeURIComponent(item.key)}`}>Ändra datum</Link><button className="text-link" onClick={() => cartActions.remove(item.key)}>Ta bort</button>
                  </div>
                </div>
                <strong className="line-price">{info ? money(info.quote.total, info.quote.currency) : "…"}</strong>
              </li>
            );
          })}
        </ul>
        <aside className="summary">
          <h2>Sammanfattning</h2>
          {error && <div className="notice error" role="alert">{error} <button type="button" className="text-link" onClick={retry}>Försök igen</button></div>}
          {loading && <p className="muted">Uppdaterar pris…</p>}
          {quote && <dl><div><dt>Delsumma</dt><dd>{money(quote.subtotal, quote.currency)}</dd></div><div><dt>Moms</dt><dd>{money(quote.vat_amount, quote.currency)}</dd></div><div className="total"><dt>Totalt</dt><dd>{money(quote.total, quote.currency)}</dd></div></dl>}
          {quote && Number(quote.deposit) > 0 && <p className="fineprint">Deposition {money(quote.deposit, quote.currency)} tillkommer vid hämtning.</p>}
          <Link to="/kassa" className={`btn primary large ${allAvailable ? "" : "disabled"}`} aria-disabled={!allAvailable} tabIndex={allAvailable ? 0 : -1} onClick={e => { if (!allAvailable) e.preventDefault(); }}>Till kassan</Link>
        </aside>
      </div>
    </section>
  );
}
