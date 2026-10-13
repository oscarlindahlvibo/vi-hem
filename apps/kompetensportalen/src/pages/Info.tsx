import { useEffect, useState } from "react";
import { ApiError, pub } from "../lib/api";
import { useSite } from "../lib/context";
import { Markdown } from "../lib/markdown";
import { Link } from "../lib/router";
import { useSeo } from "../lib/seo";

export function LegalPage({ slug, fallbackTitle }: { slug: string; fallbackTitle: string }) {
  const [page, setPage] = useState<{ title: string; body: string; published_at: string; version: number } | null | undefined>(undefined);
  useEffect(() => { setPage(undefined); pub.page(slug).then(({ page }) => setPage(page)).catch(() => setPage(null)); }, [slug]);
  useSeo({ title: `${page?.title || fallbackTitle} | Kompetensportalen`, description: `${page?.title || fallbackTitle} för Kompetensportalen.se`, noindex: !page });
  return <section className="section narrow"><h1>{page?.title || fallbackTitle}</h1>{page === undefined ? <p className="muted">Laddar…</p> : page ? <><Markdown source={page.body} /><p className="fine">Version {page.version} · publicerad {new Date(page.published_at).toLocaleDateString("sv-SE")}</p></> : <p className="notice warn">Den här sidan är inte publicerad ännu. <Link to="/kontakt" className="text-link">Kontakta oss</Link> om du har frågor.</p>}</section>;
}

export function About() {
  const { site } = useSite();
  const [body, setBody] = useState("");
  useEffect(() => { pub.page("om-oss").then(({ page }) => setBody(page.body)).catch(() => {}); }, []);
  useSeo({ title: "Om Kompetensportalen | WPE Sweden AB", description: "Kompetensportalen drivs av WPE Sweden AB och erbjuder utbildningar med examination och verifierbara intyg." });
  return <section className="section narrow"><p className="eyebrow">Om oss</p><h1>Om Kompetensportalen</h1>{body ? <Markdown source={body} /> : <p className="lead">Kompetensportalen drivs av {site.seller_name || "WPE Sweden AB"} och samlar utbildning, examination och verifierbara intyg på ett ställe.</p>}
    <div className="card"><h2>Företagsuppgifter</h2><dl><div><dt>Bolag</dt><dd>{site.seller_name || "WPE Sweden AB"}</dd></div>{site.seller_org_number && <div><dt>Organisationsnummer</dt><dd>{site.seller_org_number}</dd></div>}{site.seller_vat_number && <div><dt>Momsregistreringsnummer</dt><dd>{site.seller_vat_number}</dd></div>}{site.seller_address && <div><dt>Adress</dt><dd>{site.seller_address}</dd></div>}{site.support_email && <div><dt>E-post</dt><dd><a href={`mailto:${site.support_email}`}>{site.support_email}</a></dd></div>}</dl></div></section>;
}

export function Faq() {
  const [items, setItems] = useState<Array<{ category: string; question: string; answer: string }> | null>(null);
  useEffect(() => { pub.faq().then(({ faq }) => setItems(faq)).catch(() => setItems([])); }, []);
  useSeo({ title: "Frågor och svar | Kompetensportalen", description: "Vanliga frågor om köp, betalning, kursåtkomst, prov, intyg och företagskonton.",
    jsonLd: items?.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.question, acceptedAnswer: { "@type": "Answer", text: i.answer } })) } : undefined });
  const cats = [...new Set((items ?? []).map((i) => i.category))];
  return <section className="section narrow"><p className="eyebrow">Support</p><h1>Frågor och svar</h1>{items === null ? <p className="muted">Laddar…</p> : cats.length ? cats.map((c) => <div key={c}><h2>{c}</h2><div className="outline">{items.filter((i) => i.category === c).map((i, n) => <details key={n}><summary>{i.question}</summary><div style={{ padding: "0 18px 14px" }}><Markdown source={i.answer} /></div></details>)}</div></div>) : <p className="muted">Inga frågor publicerade ännu.</p>}<p>Hittar du inte svaret? <Link to="/kontakt" className="text-link">Kontakta oss →</Link></p></section>;
}

export function Contact() {
  const { site } = useSite();
  const [state, setState] = useState({ name: "", email: "", message: "", website: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle"); const [error, setError] = useState("");
  useSeo({ title: "Kontakta oss | Kompetensportalen", description: "Kontakta Kompetensportalen för frågor om utbildningar, företagsavtal och support." });
  async function submit(e: React.FormEvent) { e.preventDefault(); setStatus("sending"); try { await pub.contact(state); setStatus("done"); } catch (err) { setError((err as ApiError).message); setStatus("error"); } }
  return <section className="section narrow"><p className="eyebrow">Support</p><h1>Kontakta oss</h1><p className="lead">Frågor om utbildningar, företagskonton eller ditt intyg? Skriv till oss så återkommer vi.</p>
    {(site.support_email || site.phone) && <p>{site.phone && <>Telefon <a href={`tel:${site.phone.replace(/\s/g, "")}`}>{site.phone}</a> · </>}{site.support_email && <>E-post <a href={`mailto:${site.support_email}`}>{site.support_email}</a></>}</p>}
    {status === "done" ? <p className="notice ok" role="status">Tack! Vi har tagit emot ditt meddelande och återkommer så snart vi kan.</p> : <form className="card" onSubmit={submit}>
      <div className="grid2"><label>Namn<input required value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} autoComplete="name" /></label><label>E-post<input required type="email" value={state.email} onChange={(e) => setState({ ...state, email: e.target.value })} autoComplete="email" /></label></div>
      <label style={{ marginTop: 12 }}>Meddelande<textarea required rows={6} minLength={10} value={state.message} onChange={(e) => setState({ ...state, message: e.target.value })} /></label>
      <input aria-hidden="true" tabIndex={-1} autoComplete="off" value={state.website} onChange={(e) => setState({ ...state, website: e.target.value })} style={{ position: "absolute", left: "-9999px" }} />
      {status === "error" && <p className="notice error" role="alert">{error}</p>}
      <button className="btn primary" disabled={status === "sending"} style={{ marginTop: 12 }}>{status === "sending" ? "Skickar…" : "Skicka meddelande"}</button><p className="fine">Vi använder dina uppgifter bara för att besvara ditt ärende. Se <Link to="/integritet" className="text-link">integritetspolicyn</Link>.</p></form>}
  </section>;
}

export function Business() {
  const { site } = useSite();
  useSeo({ title: "Utbildning för företag | Kompetensportalen", description: "Köp flera kursplatser, fördela dem till medarbetare och följ genomförande och giltiga intyg. Betala med kort eller faktura." });
  return <><section className="hero"><p className="eyebrow">För företag</p><h1>Kompetens för hela arbetslaget.</h1><p className="lead">Köp kursplatser, bjud in medarbetare och följ vem som har giltig utbildning – på ett ställe.</p><div className="hero-actions"><Link to="/foretag/portal" className="btn primary large">Till företagsportalen</Link><Link to="/utbildningar" className="btn ghost large">Se utbildningar</Link></div></section>
    <section className="section"><div className="sector-grid">
      {[["Köp flera platser", "Beställ ett valfritt antal platser i samma order. Volympriser och avtalspriser tillämpas automatiskt."], ["Fördela själv", "Tilldela platser till medarbetare via e-post. Oanvända platser kan tas tillbaka och tilldelas någon annan."], ["Faktura för godkända företag", site.invoice_enabled ? "Godkända företagskunder kan välja faktura i kassan. Tillgång enligt överenskomna villkor." : "Fakturaköp kan aktiveras efter godkännande. Kontakta oss."], ["Full överblick", "Se pågående och genomförda utbildningar, giltiga och utgående intyg, och ladda ner kompetensmatris."], ["Personliga intyg följer personen", "Medarbetarens intyg tillhör personen och finns kvar även om arbetsgivaren byts."], ["Orderhistorik", "Alla ordrar, fakturor och kvitton samlade för er administratör."]].map(([t, d]) => <div className="sector" key={t}><strong>{t}</strong><small>{d}</small></div>)}
    </div><p style={{ marginTop: 28 }}><Link to="/foretag/portal" className="btn teal">Skapa företagskonto</Link> <Link to="/kontakt" className="btn ghost">Prata med oss</Link></p></section></>;
}
