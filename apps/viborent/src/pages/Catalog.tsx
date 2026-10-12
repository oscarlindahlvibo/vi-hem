import { useMemo } from "react";
import { ProductCard, priceFrom } from "../components/ProductCard";
import { useSite } from "../lib/context";
import { navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";

type Sort = "namn" | "pris-lagt" | "pris-hogt";

export function Catalog() {
  const { site, products } = useSite();
  const { search } = useLocation();
  // Både ?kategori= (nytt) och ?category= (gamla länkar) fungerar.
  const category = search.get("kategori") || search.get("category") || "";
  const q = search.get("q") || "";
  const sort = (search.get("sortera") as Sort) || "namn";
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products]);
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(search); next.delete("category");
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    navigate(`/hyra${next.toString() ? `?${next}` : ""}`, { replace: true });
  };
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = products.filter((p) => (!category || p.category === category) && (!needle || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(needle)));
    const price = (p: typeof products[number]) => priceFrom(p)?.value ?? Infinity;
    if (sort === "pris-lagt") out.sort((a, b) => price(a) - price(b));
    else if (sort === "pris-hogt") out.sort((a, b) => (price(b) === Infinity ? -1 : price(b)) - (price(a) === Infinity ? -1 : price(a)));
    else out.sort((a, b) => a.name.localeCompare(b.name, "sv"));
    return out;
  }, [products, category, q, sort]);
  useSeo({ title: category ? `Hyr ${category.toLowerCase()} – ViboRent` : "Hyr utrustning – ViboRent", description: "Se all utrustning du kan hyra hos ViboRent. Filtrera på typ, jämför priser och boka online.", noindex: !!q });
  return (
    <section className="section listing">
      <h1>Hyr utrustning</h1>
      <p className="lead">Välj en produkt för att se lediga tider och pris.</p>
      <div className="filters" role="search">
        <input type="search" placeholder="Sök utrustning" aria-label="Sök utrustning" value={q} onChange={(e) => set({ q: e.target.value })} />
        <select aria-label="Kategori" value={category} onChange={(e) => set({ kategori: e.target.value })}>
          <option value="">Alla kategorier</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Sortera" value={sort} onChange={(e) => set({ sortera: e.target.value === "namn" ? "" : e.target.value })}>
          <option value="namn">Namn A–Ö</option><option value="pris-lagt">Lägst pris först</option><option value="pris-hogt">Högst pris först</option>
        </select>
      </div>
      <p className="count" aria-live="polite">{list.length} {list.length === 1 ? "produkt" : "produkter"}{category ? ` i ${category}` : ""}</p>
      {list.length ? <div className="product-grid">{list.map((p) => <ProductCard key={p.id} product={p} currency={site.currency} />)}</div> : <div className="empty">Inga produkter matchar. <button className="text-link" onClick={() => navigate("/hyra")}>Rensa filter</button></div>}
    </section>
  );
}
