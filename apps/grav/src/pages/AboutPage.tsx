import { Link } from '@/lib/router';
import { useSite } from '@/lib/site-content';

export function AboutPage() {
  const { site } = useSite();
  const t = site?.content.text || {}, img = site?.content.images?.about;
  return (
    <section className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <p className="eyebrow">Företaget</p>
      <h1 className="mt-2 text-5xl">{t.aboutTitle || 'Om oss'}</h1>
      {img && <img src={img} alt="" className="mt-8 aspect-[16/9] w-full rounded-xl object-cover shadow-card" />}
      <p className="mt-8 whitespace-pre-line text-lg leading-relaxed text-ink-700">{t.aboutText}</p>
      <div className="mt-10"><Link to="/offert" className="btn btn-primary">Begär offert</Link></div>
    </section>
  );
}
