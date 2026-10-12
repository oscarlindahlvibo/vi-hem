import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';
import { iconFor } from '@/lib/icons';

export function ServicesPage() {
  const { site } = useSite();
  const services = site?.content.services || [], faq = site?.content.faq || [];
  return (
    <section className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <p className="eyebrow">Vad vi gör</p>
      <h1 className="mt-2 text-5xl">Tjänster</h1>
      <div className="mt-8 space-y-4">
        {services.map((s) => {
          const Icon = iconFor(s.icon);
          return (
            <article key={s.title} className="card flex gap-5 border-l-4 border-brand-600 p-6">
              <Icon className="mt-1 h-9 w-9 shrink-0 text-brand-600" />
              <div><h2 className="text-3xl">{s.title}</h2><p className="mt-2 whitespace-pre-line text-ink-600">{s.description}</p></div>
            </article>
          );
        })}
      </div>
      {faq.length > 0 && (
        <div className="mt-14">
          <h2 className="text-3xl">Vanliga frågor</h2>
          <div className="mt-4 divide-y divide-ink-100 overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-ink-100">
            {faq.map((f) => <details key={f.question} className="p-5"><summary className="cursor-pointer font-semibold text-ink-900">{f.question}</summary><p className="mt-3 whitespace-pre-line text-ink-600">{f.answer}</p></details>)}
          </div>
        </div>
      )}
      <div className="mt-12 text-center"><Link to="/offert" className="btn btn-primary">Begär offert</Link></div>
    </section>
  );
}
