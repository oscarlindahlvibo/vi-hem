import React, { useState } from "react";
import type { Site } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { Link, useLocation } from "../lib/router";

export function Shell({ children, site }: { children: React.ReactNode; site: Site | null }) {
  const { session, ready, signOut } = useAuth();
  const cart = useCart();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const cur = (p: string) => (path === p || (p !== "/" && path.startsWith(p)) ? "page" : undefined);
  return (
    <>
      <a className="skip" href="#main">Hoppa till innehållet</a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Kompetensportalen startsida" onClick={close}><img src="/brand/kompetensportalen.jpg" alt="Kompetensportalen.se" width="150" height="44" /></Link>
        <button className="menu-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>{open ? "Stäng" : "Meny"}</button>
        <nav id="main-nav" className={open ? "open" : ""} aria-label="Huvudmeny">
          <Link to="/utbildningar" aria-current={cur("/utbildningar")} onClick={close}>Utbildningar</Link>
          <Link to="/foretag" aria-current={cur("/foretag")} onClick={close}>För företag</Link>
          <Link to="/om-oss" aria-current={cur("/om-oss")} onClick={close}>Om oss</Link>
          <Link to="/vanliga-fragor" aria-current={cur("/vanliga-fragor")} onClick={close}>Frågor & svar</Link>
          <Link to="/verifiera" aria-current={cur("/verifiera")} onClick={close}>Verifiera intyg</Link>
          <span className="nav-actions">
            <Link to="/varukorg" className="btn ghost small" onClick={close}>Varukorg{cart.count > 0 && <span className="badge" aria-label={`${cart.count} i varukorgen`}>{cart.count}</span>}</Link>
            {ready && (session ? <><Link to="/mina-sidor" className="btn primary small" onClick={close}>Mina sidor</Link><button className="text-link" onClick={() => { close(); void signOut(); }}>Logga ut</button></> : <Link to="/logga-in" className="btn primary small" onClick={close}>Logga in</Link>)}
          </span>
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div><img className="footer-logo" src="/brand/kompetensportalen.jpg" alt="Kompetensportalen.se" width="150" height="44" /><p>Utbildning och dokumenterad kompetens för ett säkrare arbetsliv.</p></div>
        <div><strong>Utbildning</strong><p><Link to="/utbildningar">Alla utbildningar</Link></p><p><Link to="/foretag">För företag</Link></p><p><Link to="/verifiera">Verifiera intyg</Link></p></div>
        <div><strong>Information</strong><p><Link to="/villkor">Köpvillkor</Link></p><p><Link to="/integritet">Integritetspolicy</Link></p><p><Link to="/angerratt">Ångerrätt</Link></p><p><Link to="/vanliga-fragor">Frågor & svar</Link></p></div>
        <div><strong>{site?.seller_name || "WPE Sweden AB"}</strong>{site?.seller_org_number && <p>Org.nr {site.seller_org_number}</p>}{site?.seller_vat_number && <p>Moms.nr {site.seller_vat_number}</p>}{site?.seller_address && <p>{site.seller_address}</p>}{site?.phone && <p><a href={`tel:${site.phone.replace(/\s/g, "")}`}>{site.phone}</a></p>}{site?.support_email && <p><a href={`mailto:${site.support_email}`}>{site.support_email}</a></p>}<p><Link to="/kontakt">Kontakta oss</Link></p></div>
      </footer>
    </>
  );
}
