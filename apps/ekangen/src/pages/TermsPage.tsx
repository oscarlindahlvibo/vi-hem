import { useSite } from '@/lib/site-content';

export function TermsPage() {
  const { site } = useSite();
  const s = site?.settings;
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold text-fjord-900">Bokningsvillkor</h1>
      <p className="mt-4 whitespace-pre-line text-fjord-800">{site?.content.text.terms}</p>
      {s && (
        <ul className="mt-6 list-disc space-y-1.5 pl-5 text-fjord-800">
          <li>Betalning sker i förskott vid bokning.</li>
          <li>{s.freeCancelDays > 0 ? `Gratis avbokning till och med ${s.freeCancelDays} dagar före ankomstdatum, direkt via din bokningslänk.` : 'Bokningar kan inte avbokas gratis.'}</li>
          <li>Incheckning från {s.checkInTime}, utcheckning senast {s.checkOutTime}.</li>
        </ul>
      )}
    </section>
  );
}
