import { BadgePercent, CalendarCheck2, ShieldCheck } from 'lucide-react';
import { Link, navigate } from '@/lib/router';
import { useSite } from '@/lib/site-content';
import { StayPicker } from '@/components/StayPicker';

export function HomePage() {
  const { site } = useSite();
  const text = site?.content.text || {};
  const hero = site?.content.images?.hero;
  const units = site?.units || [];
  const bookingEnabled = site?.settings.bookingEnabled;
  return (
    <>
      <section className="relative isolate overflow-hidden bg-fjord-900">
        {hero && <img src={hero} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-40" />}
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl">{text.heroTitle || 'Välkommen till Ekängens vandrarhem'}</h1>
          <p className="mt-4 max-w-2xl text-lg text-fjord-100">{text.heroText}</p>
          {bookingEnabled ? (
            <div className="card mt-8 p-5 sm:p-6">
              <StayPicker onSubmit={(s) => navigate(`/boka?start=${s.start}&end=${s.end}&guests=${s.guests}`)} />
              {site && site.settings.discountPercent > 0 && <p className="mt-3 text-sm font-semibold text-fjord-700">Direktbokning ger {site.settings.discountPercent} % lägre pris än på bokningssajterna.</p>}
            </div>
          ) : (
            <Link to="/rum" className="btn btn-amber mt-8">Se våra rum</Link>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: BadgePercent, title: 'Lägre pris direkt', body: 'Vi slipper provisionen till bokningssajterna – du får mellanskillnaden som rabatt.' },
            { icon: ShieldCheck, title: 'Säker betalning', body: 'Du betalar säkert online med kort. Bokningsbekräftelsen kommer direkt.' },
            { icon: CalendarCheck2, title: 'Tydlig avbokning', body: site ? `Gratis avbokning upp till ${site.settings.freeCancelDays} dagar före ankomst, direkt på hemsidan.` : 'Tydliga avbokningsregler.' },
          ].map((f) => (
            <div key={f.title} className="card p-6">
              <f.icon className="h-7 w-7 text-fjord-600" />
              <h2 className="mt-3 text-xl font-semibold text-fjord-900">{f.title}</h2>
              <p className="mt-1.5 text-fjord-700">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {units.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
          <div className="flex items-end justify-between">
            <h2 className="text-3xl font-semibold text-fjord-900">Våra rum</h2>
            <Link to="/rum" className="text-sm font-semibold text-fjord-700 hover:underline">Se alla →</Link>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {units.slice(0, 3).map((u) => (
              <Link key={u.id} to={`/rum/${u.slug}`} className="card group overflow-hidden transition hover:shadow-lg">
                {u.images[0] && <img src={u.images[0].url} alt={u.images[0].alt || u.title} loading="lazy" className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" />}
                <div className="p-5">
                  <h3 className="text-xl font-semibold text-fjord-900">{u.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-fjord-700">{u.shortDescription}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-fjord-500">Upp till {u.maxGuests} gäster</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
