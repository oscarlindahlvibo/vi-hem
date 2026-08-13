import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AvailabilityCalendar as AvailabilityCalendarData,
  Product,
  rentalApi,
  RentalCartLine,
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

type RentalPeriod = {
  startDate: string;
  endDate: string;
  startHour: string;
  endHour: string;
};
type CartItem = { product: Product; quantity: number; period: RentalPeriod };
type CartState = { period?: RentalPeriod | null; items: CartItem[] };
const emptyCart: CartState = { period: null, items: [] };

const cartLineKey = (item: CartItem) =>
  `${item.product.id}:${item.period.startDate}:${item.period.startHour}:${item.period.endDate}:${item.period.endHour}`;

function loadCart(): CartState {
  try {
    const stored = JSON.parse(localStorage.getItem("viborent-cart") || "null");
    if (!stored || !Array.isArray(stored.items)) return emptyCart;
    const legacyPeriod = stored.period || null;
    const items = stored.items
      .map((item: any) => ({ ...item, period: item.period || legacyPeriod }))
      .filter((item: any) => item.period?.startDate && item.period?.endDate);
    return { items };
  } catch {
    return emptyCart;
  }
}

function App() {
  const [site, setSite] = useState<SiteConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [path, setPath] = useState(window.location.pathname);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<CartState>(loadCart);
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
    localStorage.setItem("viborent-cart", JSON.stringify(cart));
  }, [cart]);
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
  const addToCart = (product: Product, period: RentalPeriod, quantity = 1) => {
    setCart((current) => {
      const existing = current.items.find(
        (item) => item.product.id === product.id && JSON.stringify(item.period) === JSON.stringify(period),
      );
      return {
        items: existing
          ? current.items.map((item) => cartLineKey(item) === cartLineKey(existing) ? { ...item, quantity: item.quantity + quantity } : item)
          : [...current.items, { product, quantity, period }],
      };
    });
  };
  const updateQuantity = (lineKey: string, quantity: number) =>
    setCart((current) => ({
      ...current,
      items: current.items
        .map((item) => cartLineKey(item) === lineKey ? { ...item, quantity: Math.max(0, quantity) } : item)
        .filter((item) => item.quantity > 0),
    }));
  const clearCart = () => setCart(emptyCart);
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
    <Shell site={site} onNavigate={navigate} cartCount={cart.items.reduce((sum, item) => sum + item.quantity, 0)}>
      {path === "/hyra" ? (
        <ProductList products={products} onNavigate={navigate} />
      ) : path === "/varukorg" ? (
        <CartPage cart={cart} site={site} onNavigate={navigate} onUpdateQuantity={updateQuantity} />
      ) : path === "/kassa" ? (
        <CheckoutPage cart={cart} site={site} onNavigate={navigate} onClearCart={clearCart} />
      ) : productMatch ? (
        <ProductPage
          product={products.find(
            (item) => item.slug === decodeURIComponent(productMatch[1]),
          )}
          site={site}
          onNavigate={navigate}
          onAddToCart={addToCart}
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
  cartCount = 0,
}: {
  children: React.ReactNode;
  site: SiteConfig | null;
  onNavigate?: (to: string) => void;
  cartCount?: number;
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
          <button className="cart-nav" onClick={() => onNavigate("/varukorg")}>
            Varukorg {cartCount > 0 ? `(${cartCount})` : ""}
          </button>
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
  onAddToCart,
}: {
  product?: Product;
  site: SiteConfig | null;
  onNavigate: (to: string) => void;
  onAddToCart: (product: Product, period: RentalPeriod, quantity?: number) => void;
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
          <BookingPanel product={product} site={site} onAddToCart={onAddToCart} />
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
  onAddToCart,
}: {
  product: Product;
  site: SiteConfig | null;
  onAddToCart: (product: Product, period: RentalPeriod, quantity?: number) => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startHour, setStartHour] = useState("09");
  const [endHour, setEndHour] = useState("17");
  const start = startDate ? `${startDate}T${startHour}:00` : "";
  const end = endDate ? `${endDate}T${endHour}:00` : "";
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
  const [quantity, setQuantity] = useState(1);
  const selectDate = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    const value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (!start || end) {
      setStartDate(value);
      setEndDate("");
    } else setEndDate(value);
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
            Startdatum
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setQuote(undefined);
              }}
            />
          </label>
          <label>
            Slutdatum
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setQuote(undefined);
              }}
            />
          </label>
        </div>
        <div className="date-grid hour-grid">
          <label>
            Starttid
            <select
              value={startHour}
              onChange={(e) => {
                setStartHour(e.target.value);
                setQuote(undefined);
              }}
            >
              {Array.from({ length: 24 }, (_, hour) =>
                String(hour).padStart(2, "0"),
              ).map((hour) => (
                <option key={hour} value={hour}>
                  {hour}:00
                </option>
              ))}
            </select>
          </label>
          <label>
            Sluttid
            <select
              value={endHour}
              onChange={(e) => {
                setEndHour(e.target.value);
                setQuote(undefined);
              }}
            >
              {Array.from({ length: 24 }, (_, hour) =>
                String(hour).padStart(2, "0"),
              ).map((hour) => (
                <option key={hour} value={hour}>
                  {hour}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="secondary full"
          onClick={loadQuote}
          disabled={!start || !end || busy}
        >
          {busy ? "Kontrollerar…" : "Kontrollera pris och tillgänglighet"}
        </button>
        <label className="quantity-field">
          Antal
          <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
        </label>
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
            <button
              className="primary full"
              onClick={() => {
                try {
                  onAddToCart(product, { startDate, endDate, startHour, endHour }, quantity);
                  setMessage("Produkten ligger i varukorgen.");
                } catch (e: any) {
                  setMessage(e.message);
                }
              }}
            >
              Lägg i varukorg
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function periodLabel(period: RentalPeriod | null) {
  if (!period) return "Ingen period vald";
  return `${period.startDate} ${period.startHour}:00 – ${period.endDate} ${period.endHour}:00`;
}

function CartPage({
  cart,
  site,
  onNavigate,
  onUpdateQuantity,
}: {
  cart: CartState;
  site: SiteConfig | null;
  onNavigate: (to: string) => void;
  onUpdateQuantity: (lineKey: string, quantity: number) => void;
}) {
  if (!cart.items.length)
    return (
      <section className="section cart-page">
        <div className="eyebrow">Din bokning</div>
        <h1>Varukorgen är tom</h1>
        <p className="lead">Lägg till flera produkter, även med olika uthyrningsperioder.</p>
        <button className="primary" onClick={() => onNavigate("/hyra")}>Se produkter</button>
      </section>
    );
  return (
    <section className="section cart-page">
      <div className="eyebrow">Din bokning</div>
      <h1>Varukorg</h1>
      <p className="lead">Varje produkt kan ha sin egen period. Pris och tillgänglighet kontrolleras i kassan.</p>
      <div className="cart-layout">
        <div className="cart-lines">
          {cart.items.map(({ product, quantity, period }) => (
            <div className="cart-line" key={cartLineKey({ product, quantity, period })}>
              <img src={imageFor(product)} alt="" />
              <div><strong>{product.name}</strong><small>{product.category || "Uthyrning"}</small><small>{periodLabel(period)}</small></div>
              <label>Antal<input type="number" min="0" value={quantity} onChange={(e) => onUpdateQuantity(cartLineKey({ product, quantity, period }), Number(e.target.value) || 0)} /></label>
            </div>
          ))}
        </div>
        <div className="cart-next">
          <h2>Redo för kassan?</h2>
          <p>Pris och tillgänglighet kontrolleras igen innan bokningen skapas.</p>
          <button className="primary full" onClick={() => onNavigate("/kassa")}>Gå till kassan →</button>
        </div>
      </div>
    </section>
  );
}

function SignaturePad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(event); if (!p) return;
    const canvas = canvasRef.current!; const ctx = canvas.getContext("2d")!;
    drawing.current = true; canvas.setPointerCapture(event.pointerId);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.strokeStyle = "#17333d"; ctx.lineWidth = 3; ctx.lineCap = "round";
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return; const p = point(event); if (!p) return;
    const ctx = canvasRef.current!.getContext("2d")!; ctx.lineTo(p.x, p.y); ctx.stroke();
    onChange(canvasRef.current!.toDataURL("image/png"));
  };
  return (
    <div className="signature-wrap">
      <canvas ref={canvasRef} width={700} height={190} onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} aria-label="Rita din signatur" />
      <button type="button" className="text-link" onClick={() => { const canvas = canvasRef.current; if (!canvas) return; canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height); onChange(""); }}>Rensa signatur</button>
    </div>
  );
}

function CheckoutPage({
  cart,
  site,
  onNavigate,
  onClearCart,
}: {
  cart: CartState;
  site: SiteConfig | null;
  onNavigate: (to: string) => void;
  onClearCart: () => void;
}) {
  const [quote, setQuote] = useState<any>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState("");
  const [signerName, setSignerName] = useState("");
  const [additionalTerms, setAdditionalTerms] = useState("");
  const [customer, setCustomer] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  useEffect(() => {
    if (!cart.items.length) return;
    rentalApi.quoteCart(
      cart.items.map((item): RentalCartLine => ({
        product_id: item.product.id,
        quantity: item.quantity,
        start_at: new Date(`${item.period.startDate}T${item.period.startHour}:00`).toISOString(),
        end_at: new Date(`${item.period.endDate}T${item.period.endHour}:00`).toISOString(),
      })),
    ).then((result) => setQuote(result.quote)).catch((e) => setMessage(e.message));
  }, [cart]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quote || !accepted || !signature) { setMessage("Fyll i uppgifter, godkänn villkoren och rita din signatur."); return; }
    setBusy(true); setMessage("");
    try {
      const items = cart.items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        start_at: new Date(`${item.period.startDate}T${item.period.startHour}:00`).toISOString(),
        end_at: new Date(`${item.period.endDate}T${item.period.endHour}:00`).toISOString(),
      }));
      const result = await rentalApi.createBooking({ items, customer, customer_notes: "", additional_terms: additionalTerms });
      const booking = result.booking;
      await rentalApi.signContract({ booking_id: booking.id, public_lookup_token: booking.public_lookup_token, signer_name: signerName, signature, accepted_terms: true, additional_terms: additionalTerms });
      const token = booking.public_lookup_token || "";
      const confirmation = `${window.location.origin}/bokning/${booking.public_reference}?token=${encodeURIComponent(token)}`;
      onClearCart();
      if (window.location.protocol === "https:") {
        const payment = await rentalApi.startPayment(booking.id, `${confirmation}&paid=1`, `${confirmation}&cancelled=1`);
        if (payment.checkout_url) { window.location.href = payment.checkout_url; return; }
      }
      window.location.href = confirmation;
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  };
  if (!cart.items.length) return <section className="section"><div className="notice error">Varukorgen är tom.</div><button className="primary" onClick={() => onNavigate("/hyra")}>Till produkter</button></section>;
  return (
    <section className="section checkout-page">
      <div className="eyebrow">Sista steget</div><h1>Kassa och avtal</h1>
      <p className="lead">Kontrollera bokningen, fyll i dina uppgifter och signera uthyrningsavtalet med ditt finger eller mus.</p>
      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={submit}>
          <h2>Kunduppgifter</h2>
          <div className="date-grid">{[["first_name", "Förnamn"], ["last_name", "Efternamn"], ["email", "E-post"], ["phone", "Telefon"]].map(([key, label]) => <label key={key}>{label}<input required value={customer[key as keyof typeof customer]} onChange={(e) => setCustomer({ ...customer, [key]: e.target.value })} /></label>)}</div>
          <h2>Signera uthyrningsavtal</h2>
          <p className="booking-hint">Genom signeringen godkänner du uthyrningsvillkoren och bokningsuppgifterna.</p>
          <label>Avtalskomplettering (valfritt)<textarea value={additionalTerms} onChange={(e) => setAdditionalTerms(e.target.value)} placeholder="Skriv eventuell extra text som ska ingå i avtalet…" /></label>
          <label>Namnförtydligande<input required value={signerName} onChange={(e) => setSignerName(e.target.value)} /></label>
          <SignaturePad value={signature} onChange={setSignature} />
          <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> Jag godkänner uthyrningsvillkoren.</label>
          {message && <div className="inline-error">{message}</div>}
          <button className="primary full" disabled={busy || !quote}>{busy ? "Skapar avtal…" : "Signera och gå till betalning"}</button>
        </form>
        <aside className="checkout-summary"><h2>Din bokning</h2>{cart.items.map((item, index) => { const line = quote?.lines?.[index]; return <div className="summary-row" key={cartLineKey(item)}><span>{item.product.name} × {item.quantity}<small>{periodLabel(item.period)}</small></span><strong>{line?.quote?.subtotal != null ? money(line.quote.subtotal, site?.currency) : "…"}</strong></div>; })}{quote && <><div className="summary-row"><span>Moms</span><strong>{money(quote.vat_amount, site?.currency)}</strong></div><div className="summary-total">{money(quote.total, site?.currency)}</div></>}</aside>
      </div>
    </section>
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
  const items = booking.items || [];
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
        {items.map((item: any, index: number) => {
          const product = Array.isArray(item?.product) ? item.product[0] : item?.product;
          return <p key={`${product?.slug || "item"}-${index}`}><strong>{product?.name || "Uthyrning"}</strong> × {item.quantity || 1}{item.start_at && item.end_at ? <><br /><small>{dateTime(item.start_at)} – {dateTime(item.end_at)}</small></> : null}</p>;
        })}
        {booking.contract_terms_snapshot && <p><strong>Avtalsvillkor</strong><br /><small>{booking.contract_terms_snapshot}</small></p>}
        <p className="summary-total">
          {money(booking.total, booking.currency)}
        </p>
      </div>
      {items[0]?.product?.location && <p>Hämtning: {items[0].product.location}</p>}
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
