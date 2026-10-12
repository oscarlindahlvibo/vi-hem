import { useState, type ReactNode } from 'react';
import { Menu, Phone, Mail, MapPin, X } from 'lucide-react';
import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';
import { telHref } from '@/lib/api';

const NAV = [
  { to: '/tjanster', label: 'Tjänster' },
  { to: '/om-oss', label: 'Om oss' },
  { to: '/offert', label: 'Kontakt' },
];

export function Layout({ children, path }: { children: ReactNode; path: string }) {
  const { site } = useSite();
  const [open, setOpen] = useState(false);
  const c = site?.content.company;
  return (
    <div className="flex min-h-screen flex-col">
      <div className="hidden bg-ink-900 text-sm text-ink-100 md:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2">
          <span>{c?.serviceArea || 'Virserum med omnejd'}</span>
          <span className="flex items-center gap-5">
            {c?.phone && <a href={telHref(c.phone)} className="flex items-center gap-1.5 font-semibold hover:text-white"><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
            {c?.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 hover:text-white"><Mail className="h-3.5 w-3.5" />{c.email}</a>}
          </span>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2 sm:px-6">
          <Link to="/" onClick={() => setOpen(false)}><img src="/logo.png" alt={c?.name || 'Gräv & Allservice i Virserum AB'} className="h-12 w-auto sm:h-14" /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Huvudmeny">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className={`rounded-md px-3 py-2 font-display text-lg font-semibold uppercase tracking-wide ${path.startsWith(n.to) ? 'text-brand-600' : 'text-ink-700 hover:text-brand-600'}`}>{n.label}</Link>
            ))}
            <Link to="/offert" className="btn btn-primary ml-3 min-h-10 px-5 text-sm">Begär offert</Link>
          </nav>
          <button className="rounded-md p-2 text-ink-800 md:hidden" aria-label={open ? 'Stäng meny' : 'Öppna meny'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X className="h-7 w-7" /> : <Menu className="h-7 w-7" />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-ink-100 bg-white px-4 pb-4 md:hidden" aria-label="Mobilmeny">
            {NAV.map((n) => <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="block rounded-md px-3 py-3 font-display text-xl font-semibold uppercase tracking-wide text-ink-800">{n.label}</Link>)}
            <Link to="/offert" onClick={() => setOpen(false)} className="btn btn-primary mt-2 w-full">Begär offert</Link>
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-ink-900 text-ink-200">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <div className="inline-block rounded-lg bg-white p-3"><img src="/logo.png" alt={c?.name || 'Gräv & Allservice i Virserum AB'} className="h-12 w-auto" /></div>
            <p className="mt-4 text-sm">{c?.tagline}</p>
          </div>
          <div className="space-y-2.5 text-sm">
            <p className="font-display text-lg font-semibold uppercase tracking-wide text-white">Kontakt</p>
            {c?.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-brand-400" /><a href={telHref(c.phone)} className="font-semibold hover:text-white">{c.phone}</a></p>}
            {c?.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-brand-400" /><a href={`mailto:${c.email}`} className="hover:text-white">{c.email}</a></p>}
            {(c?.address || c?.city) && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />{[c?.address, [c?.postalCode, c?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>}
            {c?.openingHours && <p className="whitespace-pre-line text-ink-300">{c.openingHours}</p>}
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-display text-lg font-semibold uppercase tracking-wide text-white">Snabblänkar</p>
            <Link to="/offert" className="block hover:text-white">Begär offert</Link>
            <Link to="/tjanster" className="block hover:text-white">Tjänster</Link>
            <Link to="/integritet" className="block hover:text-white">Integritetspolicy</Link>
          </div>
        </div>
        <p className="border-t border-white/10 px-4 py-4 text-center text-xs text-ink-400">© {new Date().getFullYear()} {c?.name || 'Gräv & Allservice i Virserum AB'}{c?.orgNumber ? ` · Org.nr ${c.orgNumber}` : ''}</p>
      </footer>
    </div>
  );
}
