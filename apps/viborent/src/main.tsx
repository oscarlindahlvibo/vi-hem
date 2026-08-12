import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AvailabilityCalendar as AvailabilityCalendarData,
  Product,
  rentalApi,
  SiteConfig,
} from "./api";
import "./styles.css";

const money = (value: number | string, currency = "SEK") =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency }).format(
    Number(value || 0),
  );
const dateTime = (value: string) =>
  new Date(value).toLocaleString("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const imageFor = (product: Product) =>
  product.images?.[0] ||
  "https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?auto=format&fit=crop&w=900&q=80";

function App() {
  const [site, setSite] = useState<SiteConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [path, setPath] = useState(window.location.pathname);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([rentalApi.siteConfig(), rentalApi.products()])
      .then(([config, list]) => {
        setSite(config.site);
        setProducts(list.products);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  if (loading)
    return (
      <Shell site={site}>
        <div className="loading">Laddar ViboRent...</div>
      </Shell>
    );
  if (error)
    return (
      <Shell site={site}>
        <div className="notice error">
          {error}
          <button onClick={() => window.location.reload()}>Försök igen</button>
        </div>
      </Shell>
    );
  const productMatch = path.match(/^\/hyra\/([^/]+)/);
  const bookingMatch = path.match(/^\/bokning\/([^/]+)/);
  return (
    <Shell site={site} onNavigate={navigate}>
      {path === "/hyra" ? (
        <ProductList products={products} onNavigate={navigate} />
      ) : productMatch ? (
        <ProductPage
          product={products.find(
            (item) => item.slug === decodeURIComponent(productMatch[1]),
          )}
          site={site}
          onNavigate={navigate}
        />
      ) : bookingMatch ? (
        <BookingPage reference={decodeURIComponent(bookingMatch[1])} />
      ) : (
        <Home products={products} site={site} onNavigate={navigate} />
      )}
    </Shell>
  );
}

function Shell({
  children,
  site,
  onNavigate = () => {},
}: {
  children: React.ReactNode;
  site: SiteConfig | null;
  onNavigate?: (to: string) => void;
}) {
  return (
    <>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => onNavigate("/")}
          aria-label="ViboRent startsida"
        >
          <img className="brand-logo" src="/viborent-logo.jpg" alt="ViboRent" />
        </button>
        <nav>
          <button onClick={() => onNavigate("/hyra")}>Hyr</button>
          <a href="#how">Så fungerar det</a>
          <a href="#contact">Kontakt</a>
        </nav>
      </header>
      <main>{children}</main>
      <footer id="contact">
        <div>
          <img
            className="footer-logo"
            src="/viborent-logo.jpg"
            alt="ViboRent"
          />
          <p>Smidig uthyrning av släp, maskiner och utrustning.</p>
        </div>
        <div>
          <strong>{site?.organisation_name || "ViboRent"}</strong>
          <p>
            {site?.customer_support_email ||
              "Kontakta oss för hjälp med din bokning."}
          </p>
        </div>
      </footer>
    </>
  );
}

function Home({
  products,
  site,
  onNavigate,
}: {
  products: Product[];
  site: SiteConfig | null;
  onNavigate: (to: string) => void;
}) {
  const categories = [
    ...new Set(products.map((item) => item.category).filter(Boolean)),
  ];
  return (
    <>
      <section className="hero">
        <div className="eyebrow">{site?.organisation_name || "VIBORENT"}</div>
        <h1>
          Hyr rätt utrustning.
          <br />
          <em>Enkelt från början.</em>
        </h1>
        <p>
          Släp, maskiner och byggutrustning när du behöver det. Välj tid, se
          priset direkt och boka online.
        </p>
        <button className="primary large" onClick={() => onNavigate("/hyra")}>
          Se alla produkter <span>→</span>
        </button>
        <div className="hero-note">
          Tydliga priser · Enkel hämtning · Smidig bokning
        </div>
      </section>
      <section className="section" id="how">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Utforska</div>
            <h2>Utrustning för jobbet</h2>
          </div>
          <button className="text-link" onClick={() => onNavigate("/hyra")}>
            Visa allt →
          </button>
        </div>
        <div className="category-grid">
          {(categories.length
            ? categories
            : ["Släp", "Maskiner", "Verktyg"]
          ).map((category) => (
            <button
              key={category}
              className="category"
              onClick={() =>
                onNavigate(`/hyra?category=${encodeURIComponent(category)}`)
              }
            >
              <span>{category.slice(0, 1)}</span>
              <strong>{category}</strong>
              <small>Se utrustning →</small>
            </button>
          ))}
        </div>
      </section>
      <section className="section tinted">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Populärt just nu</div>
            <h2>Redo när du är</h2>
          </div>
        </div>
        <div className="product-grid">
          {products.slice(0, 3).map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onClick={() => onNavigate(`/hyra/${product.slug}`)}
            />
          ))}
        </div>
      </section>
      <section className="steps section">
        <div>
          <div className="eyebrow">Så fungerar det</div>
          <h2>Från behov till klart på några minuter.</h2>
        </div>
        <div className="step-grid">
          {[
            "Välj utrustning",
            "Välj datum och tid",
            "Boka och betala",
            "Hämta när det passar",
          ].map((step, i) => (
            <div className="step" key={step}>
              <span>0{i + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ProductList({
  products,
  onNavigate,
}: {
  products: Product[];
  onNavigate: (to: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Alla");
  const categories = [
    "Alla",
    ...new Set(products.map((item) => item.category).filter(Boolean)),
  ];
  const filtered = products.filter(
    (item) =>
      (category === "Alla" || item.category === category) &&
      `${item.name} ${item.description} ${item.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="section listing">
      <div className="eyebrow">Våra produkter</div>
      <h1>Hyr det du behöver</h1>
      <p className="lead">
        Bläddra bland vår utrustning och välj en produkt för att se
        tillgänglighet och pris.
      </p>
      <div className="filters">
        <input
          placeholder="Sök utrustning"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {categories.map((item) => (
          <button
            className={category === item ? "filter active" : "filter"}
            key={item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="product-grid">
        {filtered.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onClick={() => onNavigate(`/hyra/${product.slug}`)}
          />
        ))}
      </div>
      {!filtered.length && (
        <div className="empty">Inga produkter matchar din sökning.</div>
      )}
    </section>
  );
}

function ProductCard({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) {
  return (
    <button className="product-card" onClick={onClick}>
      <img src={imageFor(product)} alt="" />
      <div className="card-body">
        <small>{product.category || "Uthyrning"}</small>
        <h3>{product.name}</h3>
        <p>
          {product.short_description ||
            product.description ||
            "Se detaljer och boka."}
        </p>
        <strong>
          Se pris och tillgänglighet <span>→</span>
        </strong>
      </div>
    </button>
  );
}

function ProductPage({
  product,
  site,
  onNavigate,
}: {
  product?: Product;
  site: SiteConfig | null;
  onNavigate: (to: string) => void;
}) {
  if (!product)
    return (
      <div className="section">
        <div className="notice error">Produkten hittades inte.</div>
      </div>
    );
  return (
    <section className="section product-detail">
      <button className="back" onClick={() => onNavigate("/hyra")}>
        ← Till alla produkter
      </button>
      <div className="detail-grid">
        <div>
          <img
            className="detail-image"
            src={imageFor(product)}
            alt={product.name}
          />
        </div>
        <div>
          <div className="eyebrow">{product.category || "Uthyrning"}</div>
          <h1>{product.name}</h1>
          <p className="lead">
            {product.description || product.short_description}
          </p>
          {product.deposit > 0 && (
            <p className="deposit">
              Deposition: {money(product.deposit, site?.currency)}
            </p>
          )}
          <BookingPanel product={product} site={site} />
        </div>
      </div>
    </section>
  );
}

function AvailabilityCalendar({
  product,
  onSelectDate,
}: {
  product: Product;
  onSelectDate: (date: Date) => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<AvailabilityCalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const monthLabel = month.toLocaleDateString("sv-SE", {
    month: "long",
    year: "numeric",
  });
  const days = useMemo(() => {
    const firstDay = (month.getDay() + 6) % 7;
    const count = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstDay + 1;
      return day < 1 || day > count
        ? null
        : new Date(month.getFullYear(), month.getMonth(), day);
    });
  }, [month]);

  useEffect(() => {
    let active = true;
    const from = month.toISOString();
    const to = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      1,
    ).toISOString();
    setLoading(true);
    setError("");
    rentalApi
      .availabilityCalendar(product.slug, from, to)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, product.slug]);

  const overlaps = (date: Date, start: string, end: string) => {
    const dayStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const dayEnd = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    );
    return new Date(start) < dayEnd && new Date(end) > dayStart;
  };
  const past = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1) <=
    new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate(),
    );

  return (
    <div className="availability-calendar">
      <div className="availability-heading">
        <div>
          <h3>Tillgänglighet</h3>
          <p>Se bokade och spärrade dagar innan du väljer tid.</p>
        </div>
        <div className="calendar-nav">
          <button
            type="button"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
            aria-label="Föregående månad"
          >
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button
            type="button"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
            aria-label="Nästa månad"
          >
            ›
          </button>
        </div>
      </div>
      {loading && (
        <div className="calendar-loading">Hämtar bokningskalender…</div>
      )}
      {error && <div className="calendar-error">{error}</div>}
      <div className="calendar-weekdays">
        {["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((date, index) => {
          if (!date)
            return (
              <span className="calendar-day empty" key={`empty-${index}`} />
            );
          const booking = data?.bookings.find((item) =>
            overlaps(date, item.start_at, item.end_at),
          );
          const block = data?.blocks.find((item) =>
            overlaps(date, item.start_at, item.end_at),
          );
          const busyDay = Boolean(booking || block);
          return (
            <button
              type="button"
              key={date.toISOString()}
              className={`calendar-day ${busyDay ? (block ? "blocked" : "booked") : ""} ${past(date) ? "past" : ""}`}
              disabled={busyDay || past(date)}
              onClick={() => onSelectDate(date)}
            >
              <strong>{date.getDate()}</strong>
              {busyDay && <small>{block ? "Spärrad" : "Bokad"}</small>}
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="legend-dot booked-dot" /> Bokad
        </span>
        <span>
          <i className="legend-dot blocked-dot" /> Spärrad
        </span>
        <span>
          <i className="legend-dot free-dot" /> Ledig dag
        </span>
      </div>
      <p className="calendar-note">
        Slutlig tillgänglighet kontrolleras mot vald tid och tillgängligt
        exemplar. Tider bokas på hela timmar.
      </p>
    </div>
  );
}

function BookingPanel({
  product,
  site,
}: {
  product: Product;
  site: SiteConfig | null;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [quote, setQuote] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [customer, setCustomer] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });
  const [checkout, setCheckout] = useState(false);
  const selectDate = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    const value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`;
    if (!start || end) {
      setStart(value);
      setEnd("");
    } else setEnd(value);
    setQuote(undefined);
    setMessage("");
  };
  const loadQuote = async () => {
    if (!start || !end) return;
    setBusy(true);
    setMessage("");
    try {
      const [availability, result] = await Promise.all([
        rentalApi.availability(
          product.slug,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
        ),
        rentalApi.quote(
          product.slug,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
        ),
      ]);
      if (!availability.available)
        throw new Error("Tiden är tyvärr inte ledig. Välj en annan period.");
      setQuote(result.quote);
    } catch (e: any) {
      setQuote(undefined);
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await rentalApi.createBooking({
        slug: product.slug,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        customer,
        customer_notes: "",
      });
      const booking = result.booking;
      const token = booking.public_lookup_token || "";
      const confirmation = `${window.location.origin}/bokning/${booking.public_reference}?token=${encodeURIComponent(token)}`;
      if (window.location.protocol === "https:") {
        const payment = await rentalApi.startPayment(
          booking.id,
          `${confirmation}&paid=1`,
          `${confirmation}&cancelled=1`,
        );
        if (payment.checkout_url) {
          window.location.href = payment.checkout_url;
          return;
        }
      }
      window.location.href = confirmation;
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="booking-panel">
      <div className="booking-head">
        <h2>Boka {product.name}</h2>
        <span>Pris beräknas av ViboRent</span>
      </div>
      <AvailabilityCalendar product={product} onSelectDate={selectDate} />
      <div className="booking-fields">
        <p className="booking-hint">
          Välj en ledig dag i kalendern eller fyll i exakt start och slut nedan.
        </p>
        <div className="date-grid">
          <label>
            Från
            <input
              type="datetime-local"
              step="3600"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Till
            <input
              type="datetime-local"
              step="3600"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <button
          className="secondary full"
          onClick={loadQuote}
          disabled={!start || !end || busy}
        >
          {busy ? "Kontrollerar…" : "Kontrollera pris och tillgänglighet"}
        </button>
        {message && <div className="inline-error">{message}</div>}
        {quote && !checkout && (
          <div className="quote">
            <div>
              <span>Hyra</span>
              <strong>{money(quote.subtotal, site?.currency)}</strong>
            </div>
            <div>
              <span>Moms</span>
              <strong>{money(quote.vat_amount, site?.currency)}</strong>
            </div>
            <div>
              <span>Deposition</span>
              <strong>{money(quote.deposit, site?.currency)}</strong>
            </div>
            <div className="total">
              <span>Totalt</span>
              <strong>{money(quote.total, site?.currency)}</strong>
            </div>
            <button className="primary full" onClick={() => setCheckout(true)}>
              Fortsätt till bokning
            </button>
          </div>
        )}
        {quote && checkout && (
          <form className="checkout" onSubmit={create}>
            <h3>Dina uppgifter</h3>
            {[
              ["first_name", "Förnamn"],
              ["last_name", "Efternamn"],
              ["email", "E-post"],
              ["phone", "Telefon"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required
                  value={customer[key as keyof typeof customer]}
                  onChange={(e) =>
                    setCustomer({ ...customer, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label className="check">
              <input type="checkbox" required /> Jag godkänner
              uthyrningsvillkoren.
            </label>
            <button className="primary full" disabled={busy}>
              {busy ? "Skapar bokning…" : "Skapa bokning"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function BookingPage({ reference }: { reference: string }) {
  const [booking, setBooking] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    const token =
      new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      setError("Bokningen saknar säker åtkomstlänk.");
      return;
    }
    rentalApi
      .booking(reference, token)
      .then((result) => setBooking(result.booking))
      .catch((e) => setError(e.message));
  }, [reference]);
  if (error)
    return (
      <section className="section">
        <div className="notice error">{error}</div>
      </section>
    );
  if (!booking)
    return (
      <section className="section">
        <div className="loading">Hämtar bokning…</div>
      </section>
    );
  const item = booking.items?.[0];
  const product = Array.isArray(item?.product)
    ? item.product[0]
    : item?.product;
  return (
    <section className="section confirmation">
      <div className="success-mark">✓</div>
      <div className="eyebrow">Tack för din bokning</div>
      <h1>{booking.public_reference}</h1>
      <p className="lead">
        Din bokning är registrerad. Status:{" "}
        <strong>
          {booking.payment_status === "paid" ? "Betald" : "Inväntar betalning"}
        </strong>
        .
      </p>
      <div className="summary">
        <p>
          <strong>{product?.name || "Uthyrning"}</strong>
        </p>
        <p>
          {dateTime(booking.start_at)} – {dateTime(booking.end_at)}
        </p>
        <p className="summary-total">
          {money(booking.total, booking.currency)}
        </p>
      </div>
      {product?.location && <p>Hämtning: {product.location}</p>}
      <p>
        Bekräftelsen skickas till{" "}
        {booking.customer?.email || "din e-postadress"}.
      </p>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
