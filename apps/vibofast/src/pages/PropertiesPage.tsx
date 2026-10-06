import { useRouter } from '@/lib/router';
import { ListingState } from '@/components/ListingState';
import { CmsText } from '@/lib/site-content';
import { useState, useMemo } from 'react';
import { SlidersHorizontal, MapPin } from 'lucide-react';
import { PropertyCard } from '@/components/PropertyCard';
import {
  properties,
  listingTypeLabels,
  ListingType,
} from '@/data/properties';

export function PropertiesPage() {
  const { route } = useRouter();
  const [filterType, setFilterType] = useState<ListingType | 'all'>(route.path === '/lediga-lagenheter' ? 'apartment' : 'all');
  const [filterCity, setFilterCity] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'rent-asc' | 'rent-desc' | 'area-desc'>(
    'rent-asc',
  );

  const cities = useMemo(
    () => [...new Set(properties.map((p) => p.city))],
    [properties],
  );

  const filtered = useMemo(() => {
    let result = [...properties];
    if (filterType !== 'all') {
      result = result.filter((p) => p.listingType === filterType);
    }
    if (filterCity !== 'all') {
      result = result.filter((p) => p.city === filterCity);
    }
    result.sort((a, b) => {
      if (sortBy === 'rent-asc') return a.rent - b.rent;
      if (sortBy === 'rent-desc') return b.rent - a.rent;
      return b.area - a.area;
    });
    return result;
  }, [properties, filterType, filterCity, sortBy]);

  const types: (ListingType | 'all')[] = [
    'all',
    'apartment',
    'storage',
    'commercial',
    'office',
    'warehouse',
    'garage',
  ];

  return (
    <div className="animate-fade-in pt-20">
      {/* Page header */}
      <section className="bg-forest-950 py-16">
        <div className="container-page">
          <p className="section-eyebrow text-sand-300"><CmsText id="PropertiesPage.8e1ff837de" fallback="Lediga objekt" /></p>
          <h1 className="mt-2 font-serif text-4xl font-semibold text-sand-50 sm:text-5xl"><CmsText id="PropertiesPage.afb8b334a4" fallback="Hitta ditt drömhem hos oss" /></h1>
          <p className="mt-4 max-w-xl text-sand-200"><CmsText id="PropertiesPage.7bf0f0ade4" fallback="Vi har ett stort utbud av lägenheter, lokaler och förråd. Filtrera och sortera för att hitta det som passar dig bäst." /></p>
        </div>
      </section>

      {/* Filters */}
      <section className="sticky top-16 z-30 border-b border-sand-200 bg-sand-50/95 backdrop-blur-md lg:top-20">
        <div className="container-page py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-forest-700">
              <SlidersHorizontal className="h-4 w-4" /><CmsText id="PropertiesPage.6eab89a6ab" fallback="Filter:" /></div>

            <div className="flex flex-wrap gap-2">
              {types.map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    filterType === type
                      ? 'bg-forest-900 text-sand-50'
                      : 'bg-sand-100 text-forest-700 hover:bg-sand-200'
                  }`}
                >
                  {type === 'all' ? 'Alla' : listingTypeLabels[type]}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <select
                value={filterCity}
                onChange={(e) => setFilterCity(e.target.value)}
                className="rounded-full border border-sand-300 bg-white px-4 py-1.5 text-sm font-medium text-forest-700 focus:border-forest-500 focus:outline-none"
              >
                <option value="all"><CmsText id="PropertiesPage.6eb6f6024e" fallback="Alla orter" /></option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-full border border-sand-300 bg-white px-4 py-1.5 text-sm font-medium text-forest-700 focus:border-forest-500 focus:outline-none"
              >
                <option value="rent-asc"><CmsText id="PropertiesPage.2819160c3a" fallback="Lägst hyra" /></option>
                <option value="rent-desc"><CmsText id="PropertiesPage.f7575e96dd" fallback="Högst hyra" /></option>
                <option value="area-desc"><CmsText id="PropertiesPage.060dfa10ec" fallback="Störst yta" /></option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="container-page py-12"><ListingState />
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MapPin className="h-12 w-12 text-forest-300" />
            <p className="mt-4 text-lg font-medium text-forest-700"><CmsText id="PropertiesPage.61a68e41c6" fallback="Inga objekt matchar dina filter" /></p>
            <p className="mt-1 text-sm text-forest-500"><CmsText id="PropertiesPage.e958f97282" fallback="Prova att ändra eller ta bort några av dina filter." /></p>
          </div>
        ) : (
          <>
            <p className="mb-6 text-sm text-forest-600">
              {filtered.length} {filtered.length === 1 ? 'objekt' : 'objekt'}{' '}<CmsText id="PropertiesPage.9ffe65fcce" fallback="hittades" /></p>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
