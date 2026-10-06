import { CmsText, CmsValue, useContent } from '@/lib/site-content';
import { Phone, Mail, MapPin, ExternalLink } from 'lucide-react';
import { Link } from '@/lib/router';
import { company } from '@/data/company';

export function Footer() {
  const content = useContent();
  return (
    <footer className="mt-20 bg-forest-950 text-sand-100">
      <div className="container-page py-16">
        <div className="grid gap-12 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <Link to="/" className="flex items-center">
              <img
                src={content['image./Vit_logo_vibofast.png'] ?? '/Vit_logo_vibofast.png'}
                alt="Vibo Fastigheter"
                className="h-9 w-auto"
              />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-sand-200">
              {company.tagline}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-sand-300"><CmsText id="Footer.cf03cf2e9c" fallback="Navigation" /></h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link to="/" className="text-sand-200 hover:text-sand-50"><CmsText id="Footer.bf0ebeea31" fallback="Hem" /></Link>
              </li>
              <li>
                <Link to="/lediga-objekt" className="text-sand-200 hover:text-sand-50"><CmsText id="Footer.8e1ff837de" fallback="Lediga objekt" /></Link>
              </li>
              <li>
                <Link to="/for-hyresgaster" className="text-sand-200 hover:text-sand-50"><CmsText id="Footer.63dc4907b4" fallback="För hyresgäster" /></Link>
              </li>
              <li>
                <Link to="/om-oss" className="text-sand-200 hover:text-sand-50"><CmsText id="Footer.45b9f35e0a" fallback="Om oss" /></Link>
              </li>
              <li>
                <Link to="/kontakt" className="text-sand-200 hover:text-sand-50"><CmsText id="Footer.a92b9bcb16" fallback="Kontakt" /></Link>
              </li>
              <li>
                <Link to="/intresseanmalan" className="text-sand-200 hover:text-sand-50"><CmsText id="Footer.1bfd74a74b" fallback="Intresseanmälan" /></Link>
              </li>
              <li>
                <a
                  href={company.viHemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sand-200 hover:text-sand-50"
                ><CmsText id="Footer.1ef003745f" fallback="Mina sidor" /><ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-sand-300"><CmsText id="Footer.a92b9bcb16" fallback="Kontakt" /></h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a
                  href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
                  className="flex items-center gap-2 text-sand-200 hover:text-sand-50"
                >
                  <Phone className="h-4 w-4 shrink-0" />
                  {company.phone}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${company.email}`}
                  className="flex items-center gap-2 text-sand-200 hover:text-sand-50"
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  {company.email}
                </a>
              </li>
              <li className="flex items-start gap-2 text-sand-200">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {company.address.street}
                  <br />
                  {company.address.postalCode} {company.address.city}
                </span>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-sand-300"><CmsText id="Footer.a09a0b25a0" fallback="Öppettider" /></h3>
            <p className="mt-4 text-sm text-sand-200">{company.officeHours}</p>
            <p className="mt-2 text-sm text-sand-300"><CmsText id="Footer.176aeaea00" fallback="Jour:" />{company.emergencyPhone}
            </p>
          </div>
        </div>

        <div className="mt-12 border-t border-forest-800 pt-8">
          <p className="text-sm text-sand-300">
            © {new Date().getFullYear()} {company.legalName}<CmsText id="Footer.0a56eef0fc" fallback=". Alla rättigheter förbehållna." /></p>
        </div>
      </div>
    </footer>
  );
}
