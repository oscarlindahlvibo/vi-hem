import { Users } from 'lucide-react';
import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';

export function RoomsPage() {
  const { site, loading } = useSite();
  const units = site?.units || [];
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold text-fjord-900">Rum och boende</h1>
      <p className="mt-2 text-fjord-700">Välj bland våra rum och lägenheter. Datum och pris ser du när du bokar.</p>
      {!loading && units.length === 0 && <p className="mt-8 text-fjord-700">Rummen publiceras snart.</p>}
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {units.map((u) => (
          <Link key={u.id} to={`/rum/${u.slug}`} className="card group overflow-hidden transition hover:shadow-lg">
            {u.images[0] && <img src={u.images[0].url} alt={u.images[0].alt || u.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />}
            <div className="p-5">
              <h2 className="text-xl font-semibold text-fjord-900">{u.title}</h2>
              <p className="mt-1 text-sm text-fjord-700">{u.shortDescription}</p>
              <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-fjord-600"><Users className="h-4 w-4" />Upp till {u.maxGuests} gäster{u.beds ? ` · ${u.beds}` : ''}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
