import { useState } from 'react';
import { Check, Users, BedDouble } from 'lucide-react';
import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';

export function RoomDetailPage({ slug }: { slug: string }) {
  const { site, loading } = useSite();
  const unit = site?.units.find((u) => u.slug === slug);
  const [active, setActive] = useState(0);
  if (!unit) return <section className="mx-auto max-w-3xl px-4 py-20 text-center">{loading ? 'Laddar...' : <><p className="text-xl font-semibold">Rummet hittades inte.</p><Link to="/rum" className="btn btn-primary mt-6">Se alla rum</Link></>}</section>;
  const img = unit.images[active] || unit.images[0];
  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link to="/rum" className="text-sm font-semibold text-fjord-700 hover:underline">← Alla rum</Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          {img && <img src={img.url} alt={img.alt || unit.title} className="aspect-[4/3] w-full rounded-2xl object-cover shadow-card" />}
          {unit.images.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {unit.images.map((i, n) => (
                <button key={i.url} onClick={() => setActive(n)} aria-label={`Visa bild ${n + 1}`} className={`overflow-hidden rounded-lg ring-2 ${n === active ? 'ring-fjord-600' : 'ring-transparent'}`}>
                  <img src={i.url} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-4xl font-semibold text-fjord-900">{unit.title}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-fjord-700">
            <span className="flex items-center gap-1.5"><Users className="h-4 w-4" />Upp till {unit.maxGuests} gäster</span>
            {unit.beds && <span className="flex items-center gap-1.5"><BedDouble className="h-4 w-4" />{unit.beds}</span>}
          </p>
          <p className="mt-5 whitespace-pre-line text-fjord-800">{unit.description}</p>
          {unit.features.length > 0 && (
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {unit.features.map((f) => <li key={f} className="flex items-start gap-2 text-sm text-fjord-800"><Check className="mt-0.5 h-4 w-4 shrink-0 text-fjord-600" />{f}</li>)}
            </ul>
          )}
          {site?.settings.bookingEnabled && <Link to={`/boka?unit=${unit.id}`} className="btn btn-amber mt-8 w-full sm:w-auto">Kolla datum och boka</Link>}
        </div>
      </div>
    </section>
  );
}
