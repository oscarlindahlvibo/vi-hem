import { ChevronDown } from 'lucide-react';
import { useSite } from '@/lib/site-content';

export function FaqPage() {
  const { site } = useSite();
  const faq = site?.content.faq || [];
  const categories = [...new Set(faq.map((f) => f.category || 'Allmänt'))];
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold text-fjord-900">Vanliga frågor</h1>
      {categories.map((cat) => (
        <div key={cat} className="mt-8">
          <h2 className="text-xl font-semibold text-fjord-800">{cat}</h2>
          <div className="mt-3 divide-y divide-fjord-100 overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-fjord-100">
            {faq.filter((f) => (f.category || 'Allmänt') === cat).map((f) => (
              <details key={f.question} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-fjord-900">
                  {f.question}<ChevronDown className="h-5 w-5 shrink-0 text-fjord-500 transition group-open:rotate-180" />
                </summary>
                <p className="mt-3 whitespace-pre-line text-fjord-700">{f.answer}</p>
              </details>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
