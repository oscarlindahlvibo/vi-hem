import { useState, type ReactNode } from 'react';
import { Menu, Phone, Mail, MapPin, X } from 'lucide-react';
import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';

const NAV = [
  { to: '/rum', label: 'Rum' },
  { to: '/vanliga-fragor', label: 'Frågor & svar' },
  { to: '/om-oss', label: 'Om oss' },
];

export function Layout({ children, path }: { children: ReactNode; path: string }) {
  const { site } = useSite();
  const [open, setOpen] = useState(false);
  const c = site?.content.company;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-fjord-100 bg-paper-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            <img src="/favicon.svg" alt="" className="h-9 w-9" />
            <span className="font-serif text-lg font-semibold leading-tight text-fjord-900">{c?.name || 'Ekängens vandrarhem'}</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Huvudmeny">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className={`rounded-lg px-3 py-2 text-sm font-semibold ${path.startsWith(n.to) ? 'bg-fjord-100 text-fjord-900' : 'text-fjord-700 hover:bg-fjord-50'}`}>{n.label}</Link>
            ))}
            <Link to="/boka" className="btn btn-amber ml-2 min-h-10 px-4 text-sm">Boka direkt</Link>
          </nav>
          <button className="rounded-lg p-2 text-fjord-800 md:hidden" aria-label={open ? 'Stäng meny' : 'Öppna meny'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-fjord-100 bg-paper-50 px-4 pb-4 md:hidden" aria-label="Mobilmeny">
            {NAV.map((n) => <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-base font-semibold text-fjord-800">{n.label}</Link>)}
            <Link to="/boka" onClick={() => setOpen(false)} className="btn btn-amber mt-2 w-full">Boka direkt</Link>
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-16 bg-fjord-950 text-fjord-100">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
          <div>
            <p className="font-serif text-lg font-semibold text-white">{c?.name || 'Ekängens vandrarhem'}</p>
            <p className="mt-2 text-sm text-fjord-200">{c?.tagline}</p>
          </div>
          <div className="space-y-2 text-sm">
            {c?.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{c.address}, {c.postalCode} {c.city}</p>}
            {c?.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4" /><a href={`tel:${c.phone.replace(/\s/g, '')}`} className="hover:underline">{c.phone}</a></p>}
            {c?.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4" /><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></p>}
          </div>
          <div className="space-y-2 text-sm">
            <Link to="/boka" className="block hover:underline">Boka direkt</Link>
            <Link to="/vanliga-fragor" className="block hover:underline">Vanliga frågor</Link>
            <Link to="/villkor" className="block hover:underline">Bokningsvillkor</Link>
          </div>
        </div>
        <p className="border-t border-white/10 py-4 text-center text-xs text-fjord-300">© {new Date().getFullYear()} {c?.name || 'Ekängens vandrarhem'}</p>
      </footer>
    </div>
  );
}
