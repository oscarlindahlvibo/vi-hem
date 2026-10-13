import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, CalendarData, RentalQuote, rentalApi } from "../api";
import { Range, RangePicker, rangeIsFree } from "../components/RangePicker";
import { cartActions, useCart } from "../lib/cart";
import { useSite } from "../lib/context";
import { FALLBACK_IMAGE, dateTime, durationLabel, imageFor, money } from "../lib/format";
import { Link, navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";
import { addDays, isoToLocalParts, todayLocal, zonedToIso } from "../lib/time";

const RULE_LABEL: Record<string, string> = { hourly: "timme", daily: "dygn", weekly: "vecka", weekend: "helgpaket", fixed_period: "paket", custom: "paket" };

export function ProductPage({ slug }: { slug: string }) {
  const { site, products } = useSite();
  const cart = useCart();
  const { search } = useLocation();
  const editKey = search.get("rad");
  const editLine = cart.items.find(i => i.key === editKey && i.slug === slug);
  const product = products.find((p) => p.slug === slug);
  const tz = site.timezone || "Europe/Stockholm";
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [range, setRange] = useState<Range | null>(() => {
    if (!editLine) return null;
    const start = isoToLocalParts(editLine.startAt, tz), end = isoToLocalParts(editLine.endAt, tz);
    return { startDate: start.date, endDate: end.date, startHour: start.hour, endHour: end.hour };
  });
  const [quantity, setQuantity] = useState(editLine?.quantity || 1);
  const [quote, setQuote] = useState<RentalQuote | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState(0);
  const calendarSeq = useRef(0);
  const [calendarError, setCalendarError] = useState("");
  const [priceRetry, setPriceRetry] = useState(0);
  const [quotedKey, setQuotedKey] = useState("");

  const loadCalendar = useCallback((fromDate: string) => {
    if (!product) return;
    const mine = ++calendarSeq.current; setCalendarError(""); setCalendar(null);
    rentalApi.calendar(product.slug, zonedToIso(fromDate, 0, tz), zonedToIso(addDays(fromDate, 62), 0, tz)).then(data => { if (mine === calendarSeq.current) setCalendar(data); }).catch(() => { if (mine === calendarSeq.current) setCalendarError("Lediga tider kunde inte hämtas."); });
  }, [product, tz]);
  useEffect(() => {
    setImage(0); setQuote(null);
    if (editLine) {
      const start = isoToLocalParts(editLine.startAt, tz), end = isoToLocalParts(editLine.endAt, tz);
      setRange({ startDate: start.date, endDate: end.date, startHour: start.hour, endHour: end.hour }); setQuantity(editLine.quantity);
      loadCalendar(start.date.slice(0, 7) + "-01");
    } else { setRange(null); setQuantity(1); if (product) loadCalendar(todayLocal(tz).slice(0, 7) + "-01"); }
  }, [product, editKey, editLine, tz, loadCalendar]);

  const startIso = range ? zonedToIso(range.startDate, range.startHour, tz) : "";
  const endIso = range ? zonedToIso(range.endDate, range.endHour, tz) : "";
  const validRange = !!range && Date.parse(endIso) > Date.parse(startIso);
  const maxQty = Math.max(1, calendar?.capacity ?? product?.stock ?? 1);

  const requestKey = JSON.stringify([product?.slug, startIso, endIso, quantity]);

  // Live-pris och tillgänglighet, med skydd mot gamla svar som kommer i fel ordning.
  useEffect(() => {
    let active = true;
    setQuote(null); setQuotedKey(""); setMessage(""); setBusy(false);
    if (!product || !range) return;
    if (!validRange) { setMessage("Sluttiden måste vara efter starttiden."); return; }
    if (calendar && !rangeIsFree(calendar, startIso, endIso, quantity)) { setMessage(quantity > 1 ? `Det finns inte ${quantity} lediga under hela perioden.` : "Produkten är upptagen under någon del av perioden."); return; }
    setBusy(true);
    const timer = setTimeout(() => {
      rentalApi.quote(product.slug, startIso, endIso, quantity)
        .then(({ quote }) => { if (active) { setQuote(quote); setQuotedKey(requestKey); if (quote.available === false) setMessage("Ingen ledig enhet under perioden."); } })
        .catch((e: ApiError) => { if (active) setMessage(e.message); })
        .finally(() => { if (active) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); active = false; };
  }, [product, range, validRange, requestKey, startIso, endIso, quantity, calendar, priceRetry]);

  const vatRate = product?.vat_rate ?? site.vat_rate;
  const lowestHint = product?.price_hint?.daily ?? product?.price_hint?.hourly ?? null;
  useSeo({
    title: product ? product.seo_title || `Hyr ${product.name} – ViboRent` : "Produkten hittades inte – ViboRent",
    description: product ? product.seo_description || product.short_description || product.description?.slice(0, 155) : undefined,
    image: product ? imageFor(product.images) : undefined,
    noindex: !product,
    jsonLd: product ? {
      "@context": "https://schema.org", "@type": "Product", name: product.name, description: product.short_description || product.description,
      image: (product.images || []).filter(Boolean), category: product.category || undefined,
      offers: lowestHint ? { "@type": "Offer", priceCurrency: site.currency || "SEK", price: lowestHint, availability: product.stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock", url: window.location.href } : undefined,
    } : undefined,
  });

  const canBook = validRange && quotedKey === requestKey && quote && quote.available !== false && !message && !busy;
  const add = (go: boolean) => {
    if (!product || !canBook) return;
    const line = { productId: product.id, slug: product.slug, name: product.name, image: imageFor(product.images), quantity, startAt: startIso, endAt: endIso };
    if (editKey) {
      if (!cartActions.replace(editKey, line)) { setMessage("Raden har ändrats eller samma period finns redan i varukorgen. Kontrollera varukorgen."); return; }
    } else cartActions.add(line);
    navigate(go ? "/kassa" : "/varukorg");
  };

  if (!product) return <section className="section"><h1>Produkten hittades inte</h1><p>Den kan ha tagits bort. <Link to="/hyra" className="text-link">Se all utrustning →</Link></p></section>;
  const gallery = (product.images || []).filter(Boolean);
  return (
    <section className="section product-page">
      <nav className="crumbs" aria-label="Brödsmulor"><Link to="/hyra">Hyr utrustning</Link>{product.category && <> / <Link to={`/hyra?kategori=${encodeURIComponent(product.category)}`}>{product.category}</Link></>} / <span>{product.name}</span></nav>
      <div className="product-layout">
        <div className="product-media">
          <img className="hero-img" src={gallery[image] || FALLBACK_IMAGE} alt={product.name} onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE; }} />
          {gallery.length > 1 && <div className="thumbs">{gallery.map((src, i) => <button key={src + i} className={i === image ? "active" : ""} onClick={() => setImage(i)} aria-label={`Bild ${i + 1}`}><img src={src} alt="" loading="lazy" /></button>)}</div>}
        </div>
        <aside className="booking-panel" aria-label="Boka">
          <h1>{product.name}</h1>
          {product.category && <p className="muted">{product.category}</p>}
          {lowestHint && <p className="price-from">Från <strong>{money(vatRate != null ? lowestHint * (1 + Number(vatRate) / 100) : lowestHint, site.currency)}</strong> <small>{product.price_hint?.daily ? "per dygn" : "per timme"} {vatRate != null ? "inkl. moms" : "exkl. moms"}</small></p>}
          {calendarError && <p className="notice warn" role="alert">{calendarError} <button type="button" className="text-link" onClick={() => loadCalendar((range?.startDate || todayLocal(tz)).slice(0, 7) + "-01")}>Försök igen</button></p>}
          <RangePicker key={product.slug + (editKey || "")} calendar={calendar} timeZone={tz} quantity={quantity} value={range} onChange={setRange} minAdvanceHours={site.minimum_advance_hours || 0} maxAdvanceDays={site.maximum_advance_days || 730} onMonthChange={loadCalendar} />
          {maxQty > 1 && (
            <label className="qty">Antal
              <span className="stepper"><button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Minska antal">−</button><output>{quantity}</output><button type="button" onClick={() => setQuantity(Math.min(maxQty, quantity + 1))} aria-label="Öka antal">+</button></span>
            </label>
          )}
          <div className="quote-card" aria-live="polite">
            {!range && <p className="muted">Välj datum för att se pris.</p>}
            {busy && <p className="muted">Räknar ut pris…</p>}
            {message && <div className="notice error" role="alert">{message} <button type="button" className="text-link" onClick={() => setPriceRetry(n => n + 1)}>Försök igen</button></div>}
            {quote && quotedKey === requestKey && !message && (
              <>
                <p className="when">{dateTime(startIso, tz)} → {dateTime(endIso, tz)} <span>({durationLabel(startIso, endIso)})</span></p>
                {quote.rules?.length ? <ul className="breakdown">{quote.rules.map((r, i) => <li key={i}><span>{r.count} × {RULE_LABEL[r.rule_type] || r.rule_type}{quantity > 1 ? ` × ${quantity}` : ""}</span><span>{money(r.line_total * quantity, quote.currency)}</span></li>)}</ul> : null}
                <dl><div><dt>Delsumma</dt><dd>{money(quote.subtotal, quote.currency)}</dd></div><div><dt>Moms ({quote.vat_rate ?? 25} %)</dt><dd>{money(quote.vat_amount, quote.currency)}</dd></div><div className="total"><dt>Att betala</dt><dd>{money(quote.total, quote.currency)}</dd></div></dl>
                {Number(quote.deposit) > 0 && <p className="fineprint">Deposition {money(quote.deposit, quote.currency)} tillkommer vid hämtning.</p>}
                {quote.short_notice && <p className="notice warn">Bokningen startar snart. Låskoden skickas direkt efter betalning och <strong>avbokning enligt ordinarie regler gäller inte</strong>.</p>}
              </>
            )}
          </div>
          <div className="actions">
            <button className="btn primary large" disabled={!canBook} onClick={() => add(true)}>{editKey ? "Spara och gå till kassan" : "Boka nu"}</button>
            <button className="btn ghost" disabled={!canBook} onClick={() => add(false)}>{editKey ? "Spara ändringar" : "Lägg i varukorg"}</button>
          </div>
          <p className="fineprint">Kostnadsfri avbokning fram till {site.free_cancellation_minutes} min före start.</p>
        </aside>
        <div className="prose product-description">
            <h2>Om produkten</h2>
            <p>{product.description || product.short_description}</p>
            {product.location && <p><strong>Hämtas:</strong> {product.location}</p>}
            {product.pickup_instructions && <><h3>Hämtning</h3><p>{product.pickup_instructions}</p></>}
            {product.return_instructions && <><h3>Återlämning</h3><p>{product.return_instructions}</p></>}
            {Number(product.deposit) > 0 && <p><strong>Deposition:</strong> {money(product.deposit, site.currency)} (ingår inte i priset ovan)</p>}
        </div>
      </div>
    </section>
  );
}
