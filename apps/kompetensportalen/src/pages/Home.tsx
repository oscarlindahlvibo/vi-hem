import { CourseCard } from "../components/CourseCard";
import { useSite } from "../lib/context";
import { Link } from "../lib/router";
import { useSeo } from "../lib/seo";

const SECTORS = ["Bygg & entreprenad", "Infrastruktur & väg", "Transport & logistik", "Industri & produktion", "Säkerhet & arbetsmiljö"];

export function Home() {
  const { courses, site } = useSite();
  const published = courses.filter((c) => c.product);
  useSeo({ title: "Kompetensportalen – utbildningar för bygg, industri och säkerhet", description: "Digitala och lärarledda utbildningar med examination och verifierbara intyg. Köp som privatperson eller företag, betala med kort eller faktura.",
    jsonLd: { "@context": "https://schema.org", "@type": "EducationalOrganization", name: "Kompetensportalen", legalName: site.seller_name || "WPE Sweden AB", url: window.location.origin, email: site.support_email || undefined, telephone: site.phone || undefined } });
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Kompetensportalen / {site.seller_name || "WPE Sweden AB"}</p>
        <h1>Utbildning som gör jobbet säkrare.</h1>
        <p className="lead">Genomför kursen när det passar, gör provet och få ett verifierbart intyg. För privatpersoner och för företag som vill utbilda hela arbetslaget.</p>
        <div className="hero-actions"><Link to="/utbildningar" className="btn primary large">Se utbildningar →</Link><Link to="/foretag" className="btn ghost large">För företag</Link></div>
        <ul className="trust"><li>Intyg med QR-verifiering</li><li>Betala med kort eller faktura</li><li>Mobil, surfplatta och dator</li></ul>
      </section>
      <section className="id06-band" aria-label="ID06 Kompetensdatabas"><div className="id06-band-inner"><img src="/brand/id06-kompetensdatabas-2026.png" alt="ID06 Kompetensdatabas – ackrediterad kompetensregistrator 2026" width="320" height="84" /><p>Ackrediterad kompetensregistrator i ID06 Kompetensdatabas. För utbildningar som omfattas ingår registreringen utan extra kostnad – den görs som ett separat steg efter godkänt prov och utfärdat intyg.</p></div></section>
      <section className="section">
        <p className="eyebrow">För dig i branschen</p>
        <h2>Anpassat för arbetsplatser där säkerhet och dokumentation spelar roll</h2>
        <div className="sector-grid">{SECTORS.map((s) => <Link key={s} to={`/utbildningar?q=${encodeURIComponent(s.split(" ")[0])}`} className="sector">{s}<small>Se utbildningar →</small></Link>)}</div>
      </section>
      <section className="section tinted">
        <p className="eyebrow">Utbildningar</p><h2>Välj din utbildning</h2>
        {published.length ? <div className="course-grid">{published.slice(0, 6).map((c) => <CourseCard key={c.id} course={c} />)}</div> : <p className="muted">Utbildningarna publiceras inom kort.</p>}
        {published.length > 6 && <p><Link to="/utbildningar" className="text-link">Visa alla utbildningar →</Link></p>}
      </section>
      <section className="section">
        <p className="eyebrow">Så fungerar det</p><h2>Från kurs till dokumenterad kompetens</h2>
        <div className="sector-grid">
          {[["1. Välj och köp", "Betala säkert med kort, eller som företag mot faktura."], ["2. Genomför", "Titta på lektioner, svara på frågor och fortsätt där du slutade – på valfri enhet."], ["3. Examination", "Slutprovet rättas säkert hos oss, med tydliga regler för försök."], ["4. Intyg", "Du får ett personligt PDF-intyg som arbetsgivare och beställare kan verifiera."]].map(([t, d]) => <div className="sector" key={t}><strong>{t}</strong><small>{d}</small></div>)}
        </div>
      </section>
    </>
  );
}
