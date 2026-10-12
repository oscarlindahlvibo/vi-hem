import { useMemo } from "react";
import { CourseCard } from "../components/CourseCard";
import { useSite } from "../lib/context";
import { FORM_LABEL } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";

export function Catalog() {
  const { courses } = useSite();
  const { search } = useLocation();
  const q = search.get("q") || "", category = search.get("kategori") || "", form = search.get("form") || "", sort = search.get("sortera") || "namn";
  const categories = useMemo(() => [...new Set(courses.map((c) => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "sv")), [courses]);
  const set = (patch: Record<string, string>) => { const next = new URLSearchParams(search); for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k); navigate(`/utbildningar${next.toString() ? `?${next}` : ""}`, { replace: true }); };
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = courses.filter((c) => (!category || c.category === category) && (!form || c.delivery_form === form) && (!needle || `${c.title} ${c.subtitle} ${c.summary} ${c.category} ${c.tags.join(" ")} ${c.code}`.toLowerCase().includes(needle)));
    if (sort === "pris-lagt") out.sort((a, b) => (a.product?.price ?? 1e9) - (b.product?.price ?? 1e9)); else if (sort === "pris-hogt") out.sort((a, b) => (b.product?.price ?? -1) - (a.product?.price ?? -1)); else out.sort((a, b) => a.title.localeCompare(b.title, "sv"));
    return out;
  }, [courses, q, category, form, sort]);
  useSeo({ title: category ? `${category} – utbildningar | Kompetensportalen` : "Utbildningar | Kompetensportalen", description: "Alla utbildningar hos Kompetensportalen. Filtrera på ämne och utbildningsform, läs om innehåll, giltighet och examination innan köp.", noindex: !!q });
  return (
    <section className="section">
      <h1>Utbildningar</h1><p className="lead">Se innehåll, pris, giltighet och examination innan du köper.</p>
      <div className="filters" role="search">
        <input type="search" aria-label="Sök utbildning" placeholder="Sök utbildning" value={q} onChange={(e) => set({ q: e.target.value })} />
        <select aria-label="Ämne" value={category} onChange={(e) => set({ kategori: e.target.value })}><option value="">Alla ämnen</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Utbildningsform" value={form} onChange={(e) => set({ form: e.target.value })}><option value="">Alla former</option>{Object.entries(FORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div className="row"><p className="fine" aria-live="polite">{list.length} {list.length === 1 ? "utbildning" : "utbildningar"}</p>
        <label className="fine" style={{ display: "flex", gap: 8, alignItems: "center" }}>Sortera<select value={sort} onChange={(e) => set({ sortera: e.target.value === "namn" ? "" : e.target.value })} style={{ width: "auto" }}><option value="namn">Namn A–Ö</option><option value="pris-lagt">Lägst pris först</option><option value="pris-hogt">Högst pris först</option></select></label></div>
      {list.length ? <div className="course-grid">{list.map((c) => <CourseCard key={c.id} course={c} />)}</div> : <div className="card center">Inga utbildningar matchar. <button className="text-link" onClick={() => navigate("/utbildningar")}>Rensa filter</button></div>}
    </section>
  );
}
