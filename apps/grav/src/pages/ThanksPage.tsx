import { CheckCircle2 } from 'lucide-react';
import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';

export function ThanksPage({ query }: { query: URLSearchParams }) {
  const { site } = useSite();
  const ref = query.get('ref');
  return (
    <section className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
      <CheckCircle2 className="mx-auto h-16 w-16 text-brand-600" />
      <h1 className="mt-4 text-5xl">Tack!</h1>
      <p className="mt-3 text-lg text-ink-700">{site?.content.text.quoteThanks || 'Vi har tagit emot din förfrågan och återkommer så snart vi kan.'}</p>
      {ref && ref !== 'GA-OK' && <p className="mt-3 text-sm text-ink-500">Din referens: <span className="font-mono font-semibold">{ref}</span></p>}
      <Link to="/" className="btn btn-dark mt-8">Till startsidan</Link>
    </section>
  );
}
