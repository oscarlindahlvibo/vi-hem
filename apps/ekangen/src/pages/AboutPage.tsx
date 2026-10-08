import { Mail, MapPin, Phone } from 'lucide-react';
import { useSite } from '@/lib/site-content';

export function AboutPage() {
  const { site } = useSite();
  const c = site?.content.company, t = site?.content.text || {};
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold text-fjord-900">{t.aboutTitle || 'Om oss'}</h1>
      <p className="mt-4 whitespace-pre-line text-lg text-fjord-800">{t.aboutText}</p>
      {c && (
        <div className="card mt-10 space-y-3 p-6">
          <h2 className="text-2xl font-semibold text-fjord-900">Hitta hit och kontakta oss</h2>
          {c.address && <p className="flex items-start gap-2"><MapPin className="mt-1 h-4 w-4 shrink-0 text-fjord-600" />{c.address}, {c.postalCode} {c.city}</p>}
          {c.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-fjord-600" /><a className="font-semibold underline" href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a></p>}
          {c.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-fjord-600" /><a className="font-semibold underline" href={`mailto:${c.email}`}>{c.email}</a></p>}
          {c.checkInInfo && <p className="border-t border-fjord-100 pt-3 text-fjord-700">{c.checkInInfo}</p>}
        </div>
      )}
    </section>
  );
}
