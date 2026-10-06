import { ListingContext, ListingState } from '@/components/ListingState';
import { CmsText } from '@/lib/site-content';
import { useState, useContext } from 'react';
import {
  ArrowLeft,
  MapPin,
  Bed,
  Bath,
  Maximize,
  Check,
  X,
  Plus,
  Phone,
  Mail,
  Calendar,
  Home as HomeIcon,
} from 'lucide-react';
import { Link, navigate } from '@/lib/router';
import { PropertyImage } from '@/components/PropertyImage';
import { PropertyCard } from '@/components/PropertyCard';
import {
  getPropertyBySlug,
  listingTypeLabels,
  rentTypeLabels,
  utilityStatusLabels,
  UtilityStatus,
  properties,
} from '@/data/properties';
import { company } from '@/data/company';

export function PropertyDetailPage({ slug }: { slug: string }) {
  const listingState = useContext(ListingContext);
  const property = getPropertyBySlug(slug);
  const [activeImage, setActiveImage] = useState(0);

  if (listingState.loading || listingState.error) return <div className="container-page pt-32"><ListingState /></div>;

  if (!property) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center pt-20">
        <p className="font-serif text-2xl font-semibold text-forest-900"><CmsText id="PropertyDetailPage.fbabf2e2a3" fallback="Objektet hittades inte" /></p>
        <button onClick={() => navigate('/lediga-objekt')} className="btn-primary mt-6"><CmsText id="PropertyDetailPage.eb06ee99ed" fallback="Tillbaka till lediga objekt" /></button>
      </div>
    );
  }

  const similar = properties
    .filter(
      (p) =>
        p.id !== property.id &&
        (p.listingType === property.listingType || p.city === property.city),
    )
    .slice(0, 3);

  const utilityItems: { label: string; status: UtilityStatus }[] = [
    { label: 'El', status: property.utilities.electricity },
    { label: 'Vatten', status: property.utilities.water },
    { label: 'Värme', status: property.utilities.heating },
    { label: 'Fiber', status: property.utilities.fiber },
    { label: 'Tvättmaskin', status: property.utilities.washingMachine },
    { label: 'Torktumlare', status: property.utilities.dryer },
  ];

  return (
    <div className="animate-fade-in pt-20">
      <div className="container-page"><ListingState /></div>
      {/* Breadcrumb */}
      <div className="container-page py-6">
        <button
          onClick={() => navigate('/lediga-objekt')}
          className="flex items-center gap-2 text-sm font-medium text-forest-600 hover:text-forest-900"
        >
          <ArrowLeft className="h-4 w-4" /><CmsText id="PropertyDetailPage.eb06ee99ed" fallback="Tillbaka till lediga objekt" /></button>
      </div>

      {/* Gallery */}
      <section className="container-page">
        <div className="overflow-hidden rounded-2xl bg-sand-100">
          <div className="aspect-[16/10] w-full overflow-hidden bg-sand-100">
            <PropertyImage
              src={property.images[Math.min(activeImage, property.images.length - 1)]}
              alt={property.title}
              className="h-full w-full object-cover"
            />
          </div>
        </div>
        {property.images.length > 1 && (
          <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
            {property.images.map((img, i) => (
              <button
                key={i}
                onClick={() => setActiveImage(i)}
                className={`aspect-[4/3] overflow-hidden rounded-lg transition-all ${
                  activeImage === i
                    ? 'ring-2 ring-forest-700 ring-offset-2'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <PropertyImage
                  src={img}
                  alt={`${property.title} bild ${i + 1}`}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Content */}
      <section className="container-page py-12">
        <div className="grid gap-10 lg:grid-cols-3">
          {/* Main */}
          <div className="lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-forest-100 px-3 py-1 text-xs font-medium text-forest-700">
                {listingTypeLabels[property.listingType]}
              </span>
              <span className="rounded-full bg-sand-100 px-3 py-1 text-xs font-medium text-forest-700">
                {property.leaseType === 'tillsvidare'
                  ? 'Tillsvidarehyra'
                  : 'Visstid'}
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${property.rentType === 'warmhyra' ? 'bg-accent-500/10 text-accent-700' : 'bg-sand-200 text-forest-700'}`}>
                {rentTypeLabels[property.rentType]}
              </span>
              {property.status === 'available' && (
                <span className="rounded-full bg-success-500/10 px-3 py-1 text-xs font-medium text-success-600"><CmsText id="PropertyDetailPage.26d52d204a" fallback="Ledig" /></span>
              )}
            </div>

            <h1 className="mt-4 font-serif text-3xl font-semibold text-forest-900 sm:text-4xl">
              {property.title}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-forest-600">
              <MapPin className="h-4 w-4" />
              {property.address}, {property.postalCode} {property.city},{' '}
              {property.region}
            </p>

            {/* Quick facts */}
            <div className="mt-6 grid grid-cols-2 gap-4 rounded-2xl bg-sand-100 p-6 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-forest-500"><CmsText id="PropertyDetailPage.a7b2a71ff0" fallback="Hyra" /></p>
                <p className="mt-1 font-serif text-xl font-semibold text-forest-900">
                  {property.rent.toLocaleString('sv-SE')}
                </p>
                <p className="text-xs text-forest-500">{property.rentLabel}</p>
                <p className="text-xs text-forest-400">{rentTypeLabels[property.rentType]}</p>
              </div>
              {property.rooms !== undefined && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-forest-500"><CmsText id="PropertyDetailPage.04e81b9faa" fallback="Rum" /></p>
                  <p className="mt-1 font-serif text-xl font-semibold text-forest-900">
                    {property.rooms}{' '}<CmsText id="PropertyDetailPage.5338136fc1" fallback="ROK" /></p>
                </div>
              )}
              <div>
                <p className="text-xs uppercase tracking-wide text-forest-500"><CmsText id="PropertyDetailPage.3f9d17ed39" fallback="Yta" /></p>
                <p className="mt-1 font-serif text-xl font-semibold text-forest-900">
                  {property.area}
                </p>
                <p className="text-xs text-forest-500">{property.areaLabel}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-forest-500"><CmsText id="PropertyDetailPage.84935ca0ca" fallback="Tillgänglig" /></p>
                <p className="mt-1 font-serif text-xl font-semibold text-forest-900">
                  {new Date(property.available + 'T12:00:00').toLocaleDateString('sv-SE', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {/* Description */}
            <div className="mt-8">
              <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="PropertyDetailPage.7061f719f1" fallback="Beskrivning" /></h2>
              <div className="mt-4 space-y-4">
                {property.description.split('\n\n').map((para, i) => (
                  <p
                    key={i}
                    className="whitespace-pre-line leading-relaxed text-forest-700"
                  >
                    {para}
                  </p>
                ))}
              </div>
            </div>

            {/* Features */}
            {property.features.length > 0 && (
              <div className="mt-8">
                <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="PropertyDetailPage.53008966a6" fallback="Egenskaper" /></h2>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {property.features.map((feature, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm text-forest-700"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success-500/10">
                        <Check className="h-3 w-3 text-success-600" />
                      </span>
                      {feature}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Utilities */}
            <div className="mt-8">
              <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="PropertyDetailPage.f6c6dbd443" fallback="Vad ingår i hyran" /></h2>
              <p className="mt-2 text-sm text-forest-600">
                {property.rentType === 'warmhyra'
                  ? 'Varmhyra – el, vatten och värme ingår i hyran. Övriga tjänster kan tillkomma.'
                  : 'Kallhyra – se vad som ingår respektive tillkommer nedan.'}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {utilityItems.map((item, i) => {
                  const isIncluded = item.status === 'included';
                  const isRentable = item.status === 'rentable';
                  const isExtra = item.status === 'extra-cost';
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm text-forest-700"
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full ${
                          isIncluded
                            ? 'bg-success-500/10'
                            : isRentable
                              ? 'bg-accent-500/10'
                              : isExtra
                                ? 'bg-warning-500/10'
                                : 'bg-sand-200'
                        }`}
                      >
                        {isIncluded ? (
                          <Check className="h-3 w-3 text-success-600" />
                        ) : isRentable ? (
                          <Plus className="h-3 w-3 text-accent-600" />
                        ) : isExtra ? (
                          <Plus className="h-3 w-3 text-warning-600" />
                        ) : (
                          <X className="h-3 w-3 text-forest-400" />
                        )}
                      </span>
                      <span className="font-medium">{item.label}</span>
                      <span className="text-forest-500">
                        {utilityStatusLabels[item.status]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Details */}
            <div className="mt-8">
              <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="PropertyDetailPage.0f59266b8e" fallback="Allmän information" /></h2>
              <div className="mt-4 space-y-3">
                <div className="flex items-start gap-3 rounded-xl bg-sand-50 p-4">
                  <HomeIcon className="mt-0.5 h-5 w-5 shrink-0 text-forest-600" />
                  <div>
                    <p className="text-sm font-semibold text-forest-900"><CmsText id="PropertyDetailPage.047e5dc7c4" fallback="Uthyrningspolicy" /></p>
                    <p className="text-sm text-forest-600">
                      {company.policies.rental}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl bg-sand-50 p-4">
                  <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-forest-600" />
                  <div>
                    <p className="text-sm font-semibold text-forest-900"><CmsText id="PropertyDetailPage.13dbb1a495" fallback="Ungdomsrabatt" /></p>
                    <p className="text-sm text-forest-600">
                      {company.policies.youthDiscount}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl bg-sand-50 p-4">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-forest-600" />
                  <div>
                    <p className="text-sm font-semibold text-forest-900"><CmsText id="PropertyDetailPage.5151c4d3ac" fallback="Rökförbud" /></p>
                    <p className="text-sm text-forest-600">
                      {company.policies.smoking}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sand-200">
              <h3 className="font-serif text-lg font-semibold text-forest-900"><CmsText id="PropertyDetailPage.27190da607" fallback="Intresserad?" /></h3>
              <p className="mt-2 text-sm text-forest-600"><CmsText id="PropertyDetailPage.dcb2d512f7" fallback="Kontakta oss för visning eller mer information om detta objekt." /></p>

              <div className="mt-6 space-y-3">
                <a
                  href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
                  className="btn-primary w-full"
                >
                  <Phone className="h-4 w-4" /><CmsText id="PropertyDetailPage.96ddaccf58" fallback="Ring" />{' '}{company.phone}
                </a>
                <a
                  href={`mailto:${company.email}?subject=Intresseanmälan: ${property.title}`}
                  className="btn-secondary w-full"
                >
                  <Mail className="h-4 w-4" /><CmsText id="PropertyDetailPage.5487b2f699" fallback="Skicka mejl" /></a>
                <button
                  onClick={() => navigate('/intresseanmalan')}
                  className="btn-accent w-full"
                ><CmsText id="PropertyDetailPage.1bfd74a74b" fallback="Intresseanmälan" /></button>
              </div>

              <div className="mt-6 border-t border-sand-200 pt-6">
                <p className="text-sm font-semibold text-forest-900"><CmsText id="PropertyDetailPage.dff2ebf8bf" fallback="Kontaktperson" /></p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-forest-100 font-serif text-sm font-semibold text-forest-700">
                    {company.contactPerson.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-forest-900">
                      {company.contactPerson.name}
                    </p>
                    <a
                      href={`mailto:${company.contactPerson.email}`}
                      className="text-xs text-forest-600 hover:text-accent-600"
                    >
                      {company.contactPerson.email}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Similar */}
      {similar.length > 0 && (
        <section className="bg-sand-100 py-16">
          <div className="container-page">
            <h2 className="font-serif text-2xl font-semibold text-forest-900"><CmsText id="PropertyDetailPage.d0a758d706" fallback="Liknande objekt" /></h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {similar.map((p) => (
                <PropertyCard key={p.id} property={p} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
