import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Course, Site, pub } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { SiteProvider } from "./lib/context";
import { Link, navigate, useLocation } from "./lib/router";
import { useSeo } from "./lib/seo";
import { Shell } from "./components/Shell";
import { AccountPage } from "./pages/Account";
import { ConfirmEmail, ForgotPassword, Login, Register, ResetPassword } from "./pages/AuthPages";
import { CartPage, CheckoutPage, OrderPage } from "./pages/Checkout";
import { Catalog } from "./pages/Catalog";
import { CompanyPortal } from "./pages/CompanyPortal";
import { CourseDetail } from "./pages/CourseDetail";
import { Home } from "./pages/Home";
import { About, Business, Contact, Faq, LegalPage } from "./pages/Info";
import { PlayerPage } from "./pages/Player";
import { VerifyPage } from "./pages/Verify";
import "./styles.css";
import { startNoticeBanner } from "../../_shared/notice-banner";

startNoticeBanner({ url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY, surface: "kompetensportalen" });

function NotFound() { useSeo({ title: "Sidan finns inte | Kompetensportalen", noindex: true }); return <section className="section narrow"><h1>Sidan finns inte</h1><p><Link to="/utbildningar" className="text-link">Se utbildningar →</Link></p></section>; }

function Routes() {
  const { path } = useLocation();
  // Äldre adresser (t.ex. /faq, /kurser, /login) pekas om
  const legacy: Record<string, string> = { "/kurser": "/utbildningar", "/faq": "/vanliga-fragor", "/login": "/logga-in", "/register": "/skapa-konto", "/foretag/": "/foretag", "/kontakt-oss": "/kontakt", "/terms": "/villkor", "/privacy": "/integritet" };
  useEffect(() => { if (legacy[path]) navigate(legacy[path] + window.location.search, { replace: true }); }, [path]);
  if (legacy[path]) return null;
  let m: RegExpMatchArray | null;
  if (path === "/") return <Home />;
  if (/^\/utbildningar\/?$/.test(path)) return <Catalog />;
  if ((m = path.match(/^\/utbildningar\/([^/]+)\/?$/))) return <CourseDetail slug={decodeURIComponent(m[1])} />;
  if (/^\/foretag\/?$/.test(path)) return <Business />;
  if (/^\/foretag\/portal\/?$/.test(path)) return <CompanyPortal />;
  if (/^\/om-oss\/?$/.test(path)) return <About />;
  if (/^\/vanliga-fragor\/?$/.test(path)) return <Faq />;
  if (/^\/kontakt\/?$/.test(path)) return <Contact />;
  if (/^\/verifiera\/?$/.test(path)) return <VerifyPage />;
  if (/^\/villkor\/?$/.test(path)) return <LegalPage slug="villkor" fallbackTitle="Köpvillkor" />;
  if (/^\/integritet\/?$/.test(path)) return <LegalPage slug="integritet" fallbackTitle="Integritetspolicy" />;
  if (/^\/angerratt\/?$/.test(path)) return <LegalPage slug="angerratt" fallbackTitle="Ångerrätt och digital leverans" />;
  if (/^\/fakturavillkor\/?$/.test(path)) return <LegalPage slug="fakturavillkor" fallbackTitle="Fakturavillkor" />;
  if (/^\/logga-in\/?$/.test(path)) return <Login />;
  if (/^\/skapa-konto\/?$/.test(path)) return <Register />;
  if (/^\/bekrafta\/?$/.test(path)) return <ConfirmEmail />;
  if (/^\/glomt-losenord\/?$/.test(path)) return <ForgotPassword />;
  if (/^\/nytt-losenord\/?$/.test(path)) return <ResetPassword />;
  if (/^\/varukorg\/?$/.test(path)) return <CartPage />;
  if (/^\/kassa\/?$/.test(path)) return <CheckoutPage />;
  if ((m = path.match(/^\/order\/([0-9a-f-]{36})\/?$/i))) return <OrderPage orderId={m[1]} />;
  if (/^\/mina-sidor\/?$/.test(path)) return <AccountPage />;
  if ((m = path.match(/^\/utbildning\/([0-9a-f-]{36})\/?$/i))) return <PlayerPage enrollmentId={m[1]} />;
  return <NotFound />;
}

function App() {
  const [data, setData] = useState<{ site: Site; courses: Course[] } | null>(null); const [error, setError] = useState("");
  const load = () => { setError(""); Promise.all([pub.site(), pub.catalog()]).then(([s, c]) => setData({ site: s.site, courses: c.courses })).catch((e) => setError(e.message)); };
  useEffect(load, []);
  if (error) return <AuthProvider><Shell site={null}><section className="section narrow"><h1>Det går inte att nå Kompetensportalen just nu</h1><p className="notice error">{error}</p><button className="btn primary" onClick={load}>Försök igen</button></section></Shell></AuthProvider>;
  if (!data) return <AuthProvider><Shell site={null}><div className="section center muted" role="status">Laddar…</div></Shell></AuthProvider>;
  return <AuthProvider><SiteProvider value={data}><Shell site={data.site}><Routes /></Shell></SiteProvider></AuthProvider>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
