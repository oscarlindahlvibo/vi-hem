import { LESSOR_NAME } from "../lib/siteIdentity";
import React, { useState } from "react";
import type { SiteConfig } from "../api";
import { useCart } from "../lib/cart";
import { Link } from "../lib/router";

export function Shell({ children, site }: { children: React.ReactNode; site: SiteConfig | null }) {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <a className="skip" href="#main">Hoppa till innehållet</a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="ViboRent startsida" onClick={close}>
          <img className="brand-logo" src="/viborent-logo.jpg" alt="ViboRent" width="132" height="62" />
        </Link>
        <button className="menu-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>{open ? "Stäng" : "Meny"}</button>
        <nav id="main-nav" className={open ? "open" : ""} aria-label="Huvudmeny">
          <Link to="/hyra" onClick={close}>Hyr utrustning</Link>
          <Link to="/#sa-funkar-det" onClick={close}>Så fungerar det</Link>
          <Link to="/kundportal" onClick={close}>Kundportal</Link>
          <Link to="/varukorg" className="cart-nav" onClick={close}>Varukorg{cart.count > 0 && <span className="badge" aria-label={`${cart.count} varor`}>{cart.count}</span>}</Link>
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer id="kontakt">
        <div>
          <img className="footer-logo" src="/viborent-logo.jpg" alt="ViboRent" width="132" height="62" />
          <p>Släpvagnar, maskiner, verkstad & event – boka online, hämta när det passar.</p>
        </div>
        <div>
          <strong>{LESSOR_NAME}</strong>
          {site?.customer_support_phone && <p><a href={`tel:${site.customer_support_phone.replace(/\s/g, "")}`}>{site.customer_support_phone}</a></p>}
          {site?.customer_support_email && <p><a href={`mailto:${site.customer_support_email}`}>{site.customer_support_email}</a></p>}
        </div>
        <div>
          <strong>Information</strong>
          {site?.terms_url && <p><a href={site.terms_url} target="_blank" rel="noopener noreferrer">Hyresvillkor</a></p>}
          {site?.privacy_url && <p><a href={site.privacy_url} target="_blank" rel="noopener noreferrer">Integritetspolicy</a></p>}
          <p><Link to="/kundportal">Kundportal</Link></p>
        </div>
      </footer>
    </>
  );
}
