import { useSite } from '@/lib/site-content';

export function PrivacyPage() {
  const { site } = useSite();
  const c = site?.content.company;
  return (
    <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-5xl">Integritetspolicy</h1>
      <p className="mt-6 whitespace-pre-line text-lg leading-relaxed text-ink-700">{site?.content.text.privacy}</p>
      {c && <p className="mt-8 text-sm text-ink-500">Personuppgiftsansvarig: {c.name}{c.orgNumber ? ` (org.nr ${c.orgNumber})` : ''}. Kontakt: {c.email}{c.phone ? `, ${c.phone}` : ''}.</p>}
    </section>
  );
}
