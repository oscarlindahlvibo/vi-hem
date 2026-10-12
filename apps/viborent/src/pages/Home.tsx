import { ProductCard } from "../components/ProductCard";
import { useSite } from "../lib/context";
import { Link } from "../lib/router";
import { useSeo } from "../lib/seo";

export function Home() {
  const { site, products } = useSite();
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];
  useSeo({
    title: "ViboRent – hyr släpvagnar, maskiner, verkstad & event",
    description: "Hyr släpvagnar, maskiner, verktyg och eventutrustning online hos ViboRent. Se lediga tider och pris direkt, boka och betala på nätet.",
    jsonLd: { "@context": "https://schema.org", "@type": "LocalBusiness", name: site.organisation_name || "ViboRent", url: window.location.origin, telephone: site.customer_support_phone || undefined, email: site.customer_support_email || undefined },
  });
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <p className="eyebrow">{site.organisation_name || "ViboRent"}</p>
          <h1>Hyr rätt utrustning. <em>Boka på två minuter.</em></h1>
          <p className="lead">Släpvagnar, maskiner, verkstad och event. Välj tid, se priset direkt och hämta när det passar – utan kö och bokningsbesvär.</p>
          <div className="hero-actions">
            <Link to="/hyra" className="btn primary large">Se all utrustning →</Link>
            <Link to="/#sa-funkar-det" className="btn ghost large">Så fungerar det</Link>
          </div>
          <ul className="trust"><li>Tydliga priser</li><li>Bokning dygnet runt</li><li>Kod till låset via SMS</li></ul>
        </div>
      </section>
      {categories.length > 0 && (
        <section className="section">
          <h2>Utforska efter typ</h2>
          <div className="category-grid">
            {categories.map((c) => <Link key={c} to={`/hyra?kategori=${encodeURIComponent(c)}`} className="category"><strong>{c}</strong><small>{products.filter((p) => p.category === c).length} produkter →</small></Link>)}
          </div>
        </section>
      )}
      <section className="section tinted">
        <div className="section-heading"><h2>Populärt just nu</h2><Link to="/hyra" className="text-link">Visa allt →</Link></div>
        <div className="product-grid">{products.slice(0, 3).map((p) => <ProductCard key={p.id} product={p} currency={site.currency} />)}</div>
      </section>
      <section className="section" id="sa-funkar-det">
        <h2>Så fungerar det</h2>
        <ol className="steps">
          <li><span>1</span><strong>Välj utrustning</strong><p>Bläddra bland produkterna och se kalendern för lediga tider.</p></li>
          <li><span>2</span><strong>Välj tid</strong><p>Du ser totalpriset direkt – inga överraskningar.</p></li>
          <li><span>3</span><strong>Boka och betala</strong><p>Signera avtalet digitalt och betala säkert online.</p></li>
          <li><span>4</span><strong>Hämta</strong><p>{site.access_enabled ? `Du får en personlig kod till låset via SMS ca ${site.access_dispatch_minutes} min före start.` : "Du får hämtningsinformation i bekräftelsen."}</p></li>
        </ol>
        <p className="fineprint">Avbokning är kostnadsfri fram till {site.free_cancellation_minutes} minuter före start.</p>
      </section>
    </>
  );
}
