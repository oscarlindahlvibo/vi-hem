import type { Product } from "../api";
import { imageFor, money } from "../lib/format";
import { Link } from "../lib/router";

export function priceFrom(product: Product) {
  const d = product.price_hint?.daily, h = product.price_hint?.hourly;
  if (d) return { label: "per dygn", value: d };
  if (h) return { label: "per timme", value: h };
  return null;
}

export function ProductCard({ product, currency = "SEK" }: { product: Product; currency?: string }) {
  const price = priceFrom(product);
  const soldOut = product.stock === 0;
  return (
    <Link to={`/hyra/${product.slug}`} className="product-card" aria-label={product.name}>
      <div className="product-image">
        <img src={imageFor(product.images)} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).src = "/placeholder.svg"; }} />
        {product.category && <span className="chip">{product.category}</span>}
        {soldOut && <span className="chip warn">Ej tillgänglig</span>}
      </div>
      <div className="product-body">
        <h3>{product.name}</h3>
        <p>{product.short_description || product.description?.slice(0, 110)}</p>
        <div className="product-foot">
          {price ? <span className="from">Från <strong>{money(price.value, currency)}</strong> <small>{price.label}</small></span> : <span className="from">Pris vid bokning</span>}
          <span className="more">Se tider →</span>
        </div>
      </div>
    </Link>
  );
}
