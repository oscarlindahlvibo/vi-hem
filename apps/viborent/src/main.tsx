import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Product, SiteConfig, rentalApi } from "./api";
import { Shell } from "./components/Shell";
import { CustomerPortal } from "./customerPortal";
import { SiteProvider } from "./lib/context";
import { Link, navigate, useLocation } from "./lib/router";
import { useSeo } from "./lib/seo";
import { BookingPage } from "./pages/Booking";
import { Cart } from "./pages/Cart";
import { Catalog } from "./pages/Catalog";
import { Checkout } from "./pages/Checkout";
import { Home } from "./pages/Home";
import { ProductPage } from "./pages/ProductPage";
import "./styles.css";
import { startNoticeBanner } from "../../_shared/notice-banner";

startNoticeBanner({ url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY, surface: "viborent" });

// Äldre adresser från tidigare versioner (/shop, /produkt/…) pekas om till nya.
const LEGACY: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^\/(?:shop|produkter|products|butik)\/?$/i, () => "/hyra"],
  [/^\/(?:shop|produkt|product|products|butik)\/([^/]+)\/?$/i, (m) => `/hyra/${m[1]}`],
  [/^\/(?:cart|kundvagn)\/?$/i, () => "/varukorg"],
  [/^\/(?:checkout|kassa\/)\/?$/i, () => "/kassa"],
];

function NotFound() {
  useSeo({ title: "Sidan finns inte – ViboRent", noindex: true });
  return <section className="section narrow"><h1>Sidan finns inte</h1><p>Adressen kan ha ändrats. <Link to="/hyra" className="text-link">Se all utrustning →</Link></p></section>;
}

function Routes() {
  const { path } = useLocation();
  const legacy = LEGACY.map(([re, to]) => { const m = path.match(re); return m ? to(m) : null; }).find(Boolean);
  useEffect(() => { if (legacy) navigate(legacy + window.location.search, { replace: true }); }, [legacy]);
  useEffect(() => {
    if (path === "/" && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [path]);
  if (legacy) return null;
  const product = path.match(/^\/hyra\/([^/]+)\/?$/), booking = path.match(/^\/bokning\/([^/]+)\/?$/);
  if (path === "/") return <Home />;
  if (/^\/hyra\/?$/.test(path)) return <Catalog />;
  if (product) return <ProductPage slug={decodeURIComponent(product[1])} />;
  if (/^\/varukorg\/?$/.test(path)) return <Cart />;
  if (/^\/kassa\/?$/.test(path)) return <Checkout />;
  if (booking) return <BookingPage reference={decodeURIComponent(booking[1])} />;
  if (/^\/kundportal/.test(path)) return <CustomerPortal reset={path.includes("reset-password")} />;
  return <NotFound />;
}

function App() {
  const [data, setData] = useState<{ site: SiteConfig; products: Product[] } | null>(null);
  const [error, setError] = useState("");
  const load = () => { setError(""); Promise.all([rentalApi.siteConfig(), rentalApi.products()]).then(([c, p]) => setData({ site: c.site, products: p.products })).catch((e) => setError(e.message)); };
  useEffect(load, []);
  if (error) return <Shell site={null}><section className="section narrow"><h1>Det går inte att nå ViboRent just nu</h1><p className="notice error">{error}</p><button className="btn primary" onClick={load}>Försök igen</button></section></Shell>;
  if (!data) return <Shell site={null}><div className="loading" role="status">Laddar ViboRent…</div></Shell>;
  return <SiteProvider value={data}><Shell site={data.site}><Routes /></Shell></SiteProvider>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
