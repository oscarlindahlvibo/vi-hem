import { useEffect, useRef, useState } from "react";
import { ApiError, Course, Quote, SessionInfo, learn, pub } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cartActions } from "../lib/cart";
import { CERT_LABEL, FORM_LABEL, dateTime, duration, money, validityLabel } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { Link, navigate } from "../lib/router";
import { useSeo } from "../lib/seo";
import { useSite } from "../lib/context";

export function CourseDetail({ slug }: { slug: string }) {
  const { site } = useSite();
  const { session } = useAuth();
  const [course, setCourse] = useState<Course | null | undefined>(undefined);
  const [qty, setQty] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [message, setMessage] = useState("");
  const seq = useRef(0);
  useEffect(() => { setCourse(undefined); pub.course(slug).then(({ course }) => setCourse(course)).catch(() => setCourse(null)); }, [slug]);

  const needsSession = course && course.delivery_form !== "self_paced";
  const chosen: SessionInfo | undefined = course?.sessions?.find((s) => s.id === sessionId);
  useEffect(() => {
    if (!course?.product) return; const mine = ++seq.current;
    const t = setTimeout(() => { pub.quote([{ product_id: course.product!.id, quantity: qty, session_id: sessionId || null }]).then(({ quote }) => mine === seq.current && setQuote(quote)).catch(() => mine === seq.current && setQuote(null)); }, 200);
    return () => clearTimeout(t);
  }, [course?.product?.id, qty, sessionId, !!session]);

  const seoDesc = course ? (course.seo_description || course.summary || course.subtitle) : undefined;
  useSeo({
    title: course ? course.seo_title || `${course.title} | Kompetensportalen` : "Utbildningen hittades inte | Kompetensportalen", description: seoDesc, image: course?.og_image_url || course?.image_url || undefined, noindex: !course,
    jsonLd: course ? { "@context": "https://schema.org", "@type": "Course", name: course.title, description: course.summary || course.description, courseCode: course.code, inLanguage: course.language, provider: { "@type": "Organization", name: site.seller_name || "WPE Sweden AB", sameAs: window.location.origin },
      timeRequired: `PT${Math.max(1, course.estimated_minutes)}M`, educationalCredentialAwarded: CERT_LABEL[course.certificate_kind],
      offers: course.product ? { "@type": "Offer", priceCurrency: "SEK", price: course.product.price, availability: "https://schema.org/InStock", url: window.location.href } : undefined,
      hasCourseInstance: course.delivery_form === "self_paced" ? { "@type": "CourseInstance", courseMode: "online", courseWorkload: `PT${course.estimated_minutes}M` } : (course.sessions ?? []).slice(0, 5).map((s) => ({ "@type": "CourseInstance", courseMode: s.location_kind === "online" ? "online" : "onsite", startDate: s.starts_at, endDate: s.ends_at, location: s.location_kind === "physical" ? { "@type": "Place", name: s.location } : undefined })) } : undefined,
  });

  if (course === undefined) return <section className="section"><p className="muted" role="status">Laddar utbildning…</p></section>;
  if (!course) return <section className="section narrow"><h1>Utbildningen hittades inte</h1><p><Link to="/utbildningar" className="text-link">Se alla utbildningar →</Link></p></section>;
  const p = course.product; const soon = !p || course.status === "coming_soon";
  const buy = (go: boolean) => {
    if (!p) return; if (needsSession && !sessionId) { setMessage("Välj ett kurstillfälle först."); return; }
    cartActions.add({ product_id: p.id, slug: course.slug, name: course.title, unit_price: p.price, vat_rate: p.vat_rate, quantity: qty, session_id: sessionId || null, session_label: chosen ? dateTime(chosen.starts_at, chosen.timezone) : undefined });
    navigate(go ? "/kassa" : "/varukorg");
  };
  const waitlist = async (s: SessionInfo) => { if (!session) return navigate(`/logga-in?next=${encodeURIComponent(window.location.pathname)}`); try { await learn("waitlist_join", { session_id: s.id }); setMessage("Du står nu på väntelistan och får ett mejl om en plats blir ledig."); } catch (e) { setMessage((e as ApiError).message); } };

  return (
    <>
      <section className="course-hero">
        <p className="crumbs"><Link to="/utbildningar">Utbildningar</Link>{course.category && <> / {course.category}</>}</p>
        <p className="eyebrow">{FORM_LABEL[course.delivery_form]}{course.id06_enabled ? " · ID06" : ""}</p>
        <h1>{course.title}</h1>
        {(course.subtitle || course.summary) && <p className="lead">{course.subtitle || course.summary}</p>}
        <div className="facts">
          <div className="fact"><strong>{duration(course.estimated_minutes)}</strong><span>Uppskattad tid</span></div>
          <div className="fact"><strong>{validityLabel(course.validity_months)}</strong><span>Giltighet</span></div>
          <div className="fact"><strong>{CERT_LABEL[course.certificate_kind]}</strong><span>Efter godkänd utbildning</span></div>
          <div className="fact"><strong>{course.language === "sv" ? "Svenska" : course.language.toUpperCase()}</strong><span>Språk</span></div>
        </div>
      </section>
      <div className="course-layout">
        <div>
          {course.description && <><h2>Om utbildningen</h2><Markdown source={course.description} /></>}
          {course.target_audience && <><h2>Målgrupp</h2><Markdown source={course.target_audience} /></>}
          {!!course.objectives?.length && <><h2>Kursmål</h2><ul className="check-list">{course.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
          {!!course.outline?.length && <><h2>Innehåll</h2><div className="outline">{course.outline.map((m, i) => <details key={i} open={i === 0}><summary>{m.title} <span className="fine">· {m.lessons.length} moment</span></summary>{m.description && <p className="fine" style={{ padding: "0 18px" }}>{m.description}</p>}<ul>{m.lessons.map((l, j) => <li key={j}>{l.title}{l.kind === "video" ? " (video)" : l.kind === "quiz" ? " (kunskapstest)" : ""}</li>)}</ul></details>)}</div></>}
          {(course.exam || course.exam_info) && <><h2>Examination</h2>{course.exam_info && <Markdown source={course.exam_info} />}{course.exam && <ul className="check-list"><li>{course.exam.question_count} frågor, godkänt från {course.exam.pass_percent} %</li>{course.exam.time_limit_seconds && <li>Tidsgräns {Math.round(course.exam.time_limit_seconds / 60)} minuter</li>}{course.exam.max_attempts && <li>Högst {course.exam.max_attempts} försök</li>}</ul>}</>}
          {course.prerequisites && <><h2>Förkunskaper</h2><Markdown source={course.prerequisites} /></>}
          <h2>Intyg och giltighet</h2>
          <p>Efter godkänd utbildning får du ett personligt {CERT_LABEL[course.certificate_kind].toLowerCase()} från {site.seller_name || "WPE Sweden AB"} som kan verifieras online med QR-kod. {course.validity_months ? `Intyget gäller i ${validityLabel(course.validity_months)} och vi påminner dig innan det går ut.` : "Intyget har ingen fastställd utgångstid."} Intyget är ingen myndighetscertifiering.</p>
          {course.requires_identity_verification && <p className="notice">Denna utbildning kräver verifierad identitet innan intyget kan utfärdas.</p>}
          {course.id06_enabled && <div className="id06"><img src="/brand/id06-kompetensdatabas-2026.png" alt="ID06 Kompetensdatabas – ackrediterad kompetensregistrator 2026" width="200" height="53" /><p style={{ margin: 0, flex: 1, minWidth: 220 }}>Utbildningen omfattas av registrering i ID06 Kompetensdatabas. Registreringen görs som ett separat steg efter godkänt prov och utfärdat intyg, och kräver verifierat personnummer. Du får besked om registreringens status.</p></div>}
        </div>
        <aside className="buy-card" aria-label="Köp">
          {soon ? <><h2>Kommer snart</h2><p className="muted">Utbildningen går inte att köpa ännu. <Link to="/kontakt" className="text-link">Kontakta oss</Link> för att bli meddelad.</p></> : <>
            <p className="price">{money(p!.price)} <small>exkl. moms</small></p>
            <p className="fine">{money(p!.price * (1 + p!.vat_rate / 100))} inkl. {p!.vat_rate} % moms{course.delivery_form === "self_paced" ? " · digital leverans" : ""}</p>
            {needsSession && <>
              <h3>Välj tillfälle</h3>
              {course.sessions?.length ? <div className="session-list" role="radiogroup" aria-label="Kurstillfällen">{course.sessions.map((s) => (
                <div key={s.id} className={`session ${sessionId === s.id ? "selected" : ""} ${s.seats_left === 0 ? "full" : ""}`}>
                  <input type="radio" name="session" id={`s-${s.id}`} checked={sessionId === s.id} disabled={s.seats_left === 0} onChange={() => { setSessionId(s.id); setQty((q) => Math.min(q, Math.max(1, s.seats_left))); }} />
                  <label htmlFor={`s-${s.id}`} style={{ fontWeight: 500 }}><strong>{dateTime(s.starts_at, s.timezone)}</strong><br /><span className="fine">{s.location}{s.seats_left === 0 ? " · Fullbokat" : ` · ${s.seats_left} platser kvar`}</span>{s.seats_left === 0 && <><br /><button className="text-link" type="button" onClick={() => waitlist(s)}>Ställ dig på väntelistan</button></>}</label>
                </div>))}</div> : <p className="notice">Inga kommande tillfällen är schemalagda ännu. <Link to="/kontakt" className="text-link">Hör av dig</Link> så meddelar vi när nya datum finns.</p>}
            </>}
            <label>Antal platser<span className="stepper"><button type="button" aria-label="Minska antal" onClick={() => setQty(Math.max(1, qty - 1))}>−</button><output>{qty}</output><button type="button" aria-label="Öka antal" onClick={() => setQty(Math.min(chosen ? chosen.seats_left : 500, qty + 1))}>+</button></span></label>
            {quote && <dl>{quote.lines[0]?.price_label && <div><dt>{quote.lines[0].price_label}</dt><dd>{money(quote.lines[0].unit_price)} / plats</dd></div>}<div><dt>Delsumma</dt><dd>{money(quote.subtotal)}</dd></div><div><dt>Moms</dt><dd>{money(quote.vat_total)}</dd></div><div className="total"><dt>Totalt</dt><dd>{money(quote.total)}</dd></div></dl>}
            {message && <p className="notice warn" role="status">{message}</p>}
            <div style={{ display: "grid", gap: 10 }}><button className="btn primary large" onClick={() => buy(true)}>Köp utbildningen</button><button className="btn ghost" onClick={() => buy(false)}>Lägg i varukorg</button></div>
            <p className="fine">Betalning med kort{site.invoice_enabled ? " eller (för godkända företag) faktura" : ""}. Kursmaterialet öppnas när betalningen är bekräftad. Företag kan köpa flera platser och fördela dem själva.</p>
          </>}
        </aside>
      </div>
    </>
  );
}
