import { CmsText } from '@/lib/site-content';
import { useState } from 'react';
import { MapPin, Bed, Bath, Maximize, ArrowRight } from 'lucide-react';
import { Link } from '@/lib/router';
import { Property, listingTypeLabels, rentTypeLabels } from '@/data/properties';

export function PropertyCard({ property }: { property: Property }) {
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      to={`/objekt/${property.slug}`}
      className="card group flex flex-col overflow-hidden"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-sand-100">
        {imgError ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-forest-100 to-forest-200">
            <span className="font-serif text-4xl font-semibold text-forest-300"><CmsText id="PropertyCard.c9ee5681d3" fallback="V" /></span>
          </div>
        ) : (
          <img
            src={property.images[0]}
            alt={property.title}
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <div className="absolute left-3 top-3 flex gap-2">
          <span className="rounded-full bg-forest-900/90 px-3 py-1 text-xs font-medium text-sand-50 backdrop-blur-sm">
            {listingTypeLabels[property.listingType]}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm ${property.rentType === 'warmhyra' ? 'bg-accent-500/90 text-white' : 'bg-sand-300/90 text-forest-900'}`}>
            {rentTypeLabels[property.rentType]}
          </span>
          {property.status === 'coming' && (
            <span className="rounded-full bg-accent-500/90 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm"><CmsText id="PropertyCard.4c96118800" fallback="Kommer" /></span>
          )}
          {property.status === 'rented' && (
            <span className="rounded-full bg-forest-500/90 px-3 py-1 text-xs font-medium text-sand-50 backdrop-blur-sm"><CmsText id="PropertyCard.c26af33caf" fallback="Uthyrd" /></span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-serif text-lg font-semibold text-forest-900">
          {property.title}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-forest-600">
          <MapPin className="h-4 w-4 shrink-0" />
          {property.city}, {property.region}
        </p>

        <p className="mt-3 text-sm text-forest-700 line-clamp-2">
          {property.shortDescription}
        </p>

        <div className="mt-4 flex items-center gap-4 text-sm text-forest-600">
          {property.bedrooms != null && (
            <span className="flex items-center gap-1.5">
              <Bed className="h-4 w-4" />
              {property.bedrooms}{' '}<CmsText id="PropertyCard.000f1fb16a" fallback="sovrum" /></span>
          )}
          {property.bathrooms != null && (
            <span className="flex items-center gap-1.5">
              <Bath className="h-4 w-4" />
              {property.bathrooms}{' '}<CmsText id="PropertyCard.ad06817718" fallback="badrum" /></span>
          )}
          <span className="flex items-center gap-1.5">
            <Maximize className="h-4 w-4" />
            {property.area} {property.areaLabel}
          </span>
        </div>

        <p className="mt-4 text-sm text-forest-700">Inflyttning: {property.status === 'available' ? 'Ledig nu' : new Date(property.available + 'T12:00:00').toLocaleDateString('sv-SE')}</p>
        <div className="mt-5 flex items-end justify-between border-t border-sand-200 pt-4">
          <div>
            <p className="font-serif text-xl font-semibold text-forest-900">
              {property.rent.toLocaleString('sv-SE')} {property.rentLabel}
            </p>
            <p className="text-xs text-forest-500">
              {property.leaseType === 'tillsvidare' ? 'Tillsvidarehyra' : 'Visstid'}
            </p>
          </div>
          <span className="flex items-center gap-1 text-sm font-medium text-forest-700 transition-colors group-hover:text-accent-600"><CmsText id="PropertyCard.787023d3d3" fallback="Läs mer" /><ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}
