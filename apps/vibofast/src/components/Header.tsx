import { CmsText, CmsValue, useContent } from '@/lib/site-content';
import { useState, useEffect } from 'react';
import { Menu, X, Phone, ExternalLink } from 'lucide-react';
import { Link, navigate, useRouter } from '@/lib/router';
import { company } from '@/data/company';

const navLinks = [
  { label: 'Hem', to: '/' },
  { label: 'Lediga objekt', to: '/lediga-objekt' },
  { label: 'För hyresgäster', to: '/for-hyresgaster' },
  { label: 'Om oss', to: '/om-oss' },
  { label: 'Kontakt', to: '/kontakt' },
];

const externalLinks = [
  { label: 'Mina sidor', href: 'https://app.vi-hem.se' },
];

export function Header() {
  const content = useContent();
  const { route } = useRouter();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [route.path]);

  const isActive = (to: string) => {
    if (to === '/') return route.path === '/';
    return route.path.startsWith(to);
  };

  const isHome = route.path === '/';
  const isTransparent = isHome && !scrolled;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        isTransparent
          ? 'bg-transparent'
          : 'bg-sand-50/95 backdrop-blur-md shadow-sm'
      }`}
    >
      <div className="container-page">
        <div className="flex h-16 items-center justify-between lg:h-20">
          <Link to="/" className="flex items-center">
            <img
              src={isTransparent ? content['image./Vit_logo_vibofast.png'] ?? '/Vit_logo_vibofast.png' : content['image./logo-svart-vibo.png'] ?? '/logo-svart-vibo.png'}
              alt="Vibo Fastigheter"
              className="h-9 w-auto lg:h-11"
            />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  isActive(link.to)
                    ? isTransparent
                      ? 'bg-sand-50 text-forest-900'
                      : 'bg-forest-900 text-sand-50'
                    : isTransparent
                      ? 'text-sand-50 hover:bg-forest-800/40'
                      : 'text-forest-800 hover:bg-forest-100'
                }`}
              >
                <CmsValue fallback={link.label} />
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {externalLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                  isTransparent ? 'text-sand-50 hover:text-white' : 'text-forest-800 hover:text-forest-950'
                }`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <CmsValue fallback={link.label} />
              </a>
            ))}
            <a
              href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
              className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                isTransparent ? 'text-sand-50 hover:text-white' : 'text-forest-800 hover:text-forest-950'
              }`}
            >
              <Phone className="h-4 w-4" />
              {company.phone}
            </a>
            <button
              onClick={() => navigate('/intresseanmalan')}
              className="btn-accent"
            ><CmsText id="Header.1bfd74a74b" fallback="Intresseanmälan" /></button>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
              isTransparent ? 'text-sand-50' : 'text-forest-900'
            } lg:hidden`}
            aria-label="Meny"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-sand-200 bg-sand-50 lg:hidden">
          <nav className="container-page flex flex-col py-4">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                  isActive(link.to)
                    ? 'bg-forest-900 text-sand-50'
                    : 'text-forest-800 hover:bg-forest-100'
                }`}
              >
                <CmsValue fallback={link.label} />
              </Link>
            ))}
            {externalLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium text-forest-800 hover:bg-forest-100"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <CmsValue fallback={link.label} />
              </a>
            ))}
            <button
              onClick={() => navigate('/intresseanmalan')}
              className="btn-accent mt-3 w-full"
            ><CmsText id="Header.1bfd74a74b" fallback="Intresseanmälan" /></button>
            <a
              href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
              className="mt-2 flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-forest-800"
            >
              <Phone className="h-4 w-4" />
              {company.phone}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
