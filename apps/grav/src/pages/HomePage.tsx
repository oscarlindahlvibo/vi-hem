import { ArrowRight, ClipboardList, FileText, Hammer, Phone } from 'lucide-react';
import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';
import { telHref } from '@/lib/api';
import { iconFor } from '@/lib/icons';

export function HomePage() {
  const { site } = useSite();
  const t = site?.content.text || {}, c = site?.content.company, services = site?.content.services || [];
  const hero = site?.content.images?.hero, gallery = site?.content.images?.gallery || [];
  return (
    <>
      <section className="relative isolate overflow-hidden bg-ink-900">
        {hero && <img src={hero} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-45" />}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950 via-ink-900/85 to-ink-900/30" />
        <img src="/emblem.png" alt="" aria-hidden className="pointer-events-none absolute -bottom-20 -right-16 -z-10 hidden h-[34rem] w-auto opacity-[0.12] md:block" />
        <div className="absolute inset-y-0 left-0 -z-10 w-1.5 bg-gradient-to-b from-brand-500 to-brand-800" />
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <p className="eyebrow !text-brand-400">{c?.city || 'Virserum'}</p>
          <h1 className="mt-3 max-w-3xl text-5xl leading-[1.02] !text-white sm:text-7xl">{t.heroTitle || 'Grävning och allservice'}</h1>
          <p className="mt-5 max-w-xl text-lg text-ink-100">{t.heroText}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/offert" className="btn btn-primary">Begär offert <ArrowRight className="h-5 w-5" /></Link>
            {c?.phone && <a href={telHref(c.phone)} className="btn btn-ghost-light"><Phone className="h-5 w-5" />{c.phone}</a>}
          </div>
        </div>
      </section>

      {services.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="eyebrow">Vad vi gör</p>
          <h2 className="mt-2 text-4xl sm:text-5xl">Våra tjänster</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => {
              const Icon = iconFor(s.icon);
              return (
                <Link key={s.title} to="/tjanster" className="card group border-t-4 border-brand-600 p-6 transition hover:-translate-y-0.5 hover:shadow-lg">
                  <Icon className="h-9 w-9 text-brand-600" />
                  <h3 className="mt-4 text-2xl">{s.title}</h3>
                  <p className="mt-2 text-ink-600">{s.description}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="bg-ink-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="eyebrow">Enkelt att komma igång</p>
          <h2 className="mt-2 text-4xl sm:text-5xl">Så går det till</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              { icon: ClipboardList, title: 'Beskriv jobbet', body: 'Fyll i formuläret och bifoga gärna bilder på platsen.' },
              { icon: FileText, title: 'Vi återkommer', body: 'Du får svar och offert, eller frågor om vi behöver veta mer.' },
              { icon: Hammer, title: 'Vi utför jobbet', body: 'När du godkänt offerten bokar vi in en tid som passar.' },
            ].map((s, i) => (
              <li key={s.title} className="card relative p-6">
                <span className="absolute right-5 top-4 font-display text-5xl font-bold text-ink-100">{i + 1}</span>
                <s.icon className="h-8 w-8 text-brand-600" />
                <h3 className="mt-3 text-2xl">{s.title}</h3>
                <p className="mt-1.5 text-ink-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {gallery.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="eyebrow">Utfört arbete</p>
          <h2 className="mt-2 text-4xl sm:text-5xl">Bilder från våra jobb</h2>
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">
            {gallery.slice(0, 9).map((g) => <img key={g.url} src={g.url} alt={g.alt || 'Bild från ett utfört jobb'} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />)}
          </div>
        </section>
      )}

      <section className="bg-brand-700">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-4xl !text-white">Behöver du hjälp med ett jobb?</h2>
            <p className="mt-2 text-brand-100">Skicka en förfrågan eller ring oss{c?.phone ? ` på ${c.phone}` : ''}.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/offert" className="btn bg-white text-brand-800 hover:bg-brand-50">Begär offert</Link>
            {c?.phone && <a href={telHref(c.phone)} className="btn btn-ghost-light"><Phone className="h-5 w-5" />Ring oss</a>}
          </div>
        </div>
      </section>
    </>
  );
}
