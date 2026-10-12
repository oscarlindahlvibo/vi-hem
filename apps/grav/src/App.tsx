import { useRouter } from '@/lib/router';
import { Layout } from '@/components/Layout';
import { SiteProvider, useSite } from '@/lib/site-content';
import { configured } from '@/lib/api';
import { HomePage } from '@/pages/HomePage';
import { ServicesPage } from '@/pages/ServicesPage';
import { AboutPage } from '@/pages/AboutPage';
import { QuotePage } from '@/pages/QuotePage';
import { ThanksPage } from '@/pages/ThanksPage';
import { PrivacyPage } from '@/pages/PrivacyPage';

function Routes() {
  const { route } = useRouter();
  const { error } = useSite();
  const first = route.segments[0];
  let page;
  if (!first) page = <HomePage />;
  else if (first === 'tjanster') page = <ServicesPage />;
  else if (first === 'om-oss') page = <AboutPage />;
  else if (first === 'offert') page = <QuotePage />;
  else if (first === 'tack') page = <ThanksPage query={route.query} />;
  else if (first === 'integritet') page = <PrivacyPage />;
  else page = <section className="mx-auto max-w-xl px-4 py-24 text-center"><h1 className="text-5xl">Sidan finns inte</h1><a href="/" className="btn btn-primary mt-6">Till startsidan</a></section>;
  return (
    <Layout path={route.path}>
      {(!configured || error) && <p className="bg-brand-50 px-4 py-2 text-center text-sm font-semibold text-brand-800">{!configured ? 'Hemsidan är inte kopplad till systemet ännu.' : error}</p>}
      {page}
    </Layout>
  );
}

export default function App() { return <SiteProvider><Routes /></SiteProvider>; }
