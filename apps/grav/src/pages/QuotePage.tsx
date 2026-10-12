import { Mail, MapPin, Phone } from 'lucide-react';
import { QuoteForm } from '@/components/QuoteForm';
import { useSite } from '@/lib/site-content';
import { telHref } from '@/lib/api';

export function QuotePage() {
  const { site } = useSite();
  const c = site?.content.company;
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <p className="eyebrow">Kontakt</p>
      <h1 className="mt-2 text-5xl">Begär offert</h1>
      <p className="mt-3 max-w-2xl text-ink-600">{site?.content.text.quoteIntro}</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <QuoteForm />
        <aside className="card h-fit space-y-4 p-6 text-sm">
          <h2 className="text-2xl">Hellre ringa?</h2>
          {c?.phone && <a href={telHref(c.phone)} className="flex items-center gap-2 text-lg font-bold text-brand-700"><Phone className="h-5 w-5" />{c.phone}</a>}
          {c?.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-brand-600" /><a href={`mailto:${c.email}`} className="underline">{c.email}</a></p>}
          {(c?.address || c?.city) && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{[c?.address, [c?.postalCode, c?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>}
          {c?.openingHours && <p className="whitespace-pre-line border-t border-ink-100 pt-3 text-ink-600">{c.openingHours}</p>}
          {c?.serviceArea && <p className="border-t border-ink-100 pt-3 text-ink-600">Vi arbetar i: {c.serviceArea}</p>}
        </aside>
      </div>
    </section>
  );
}
