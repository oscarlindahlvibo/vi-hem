import { useRouter } from '@/lib/router';
import { Layout } from '@/components/Layout';
import { SiteProvider, useSite } from '@/lib/site-content';
import { configured } from '@/lib/api';
import { HomePage } from '@/pages/HomePage';
import { RoomsPage } from '@/pages/RoomsPage';
import { RoomDetailPage } from '@/pages/RoomDetailPage';
import { BookingPage } from '@/pages/BookingPage';
import { BookingStatusPage } from '@/pages/BookingStatusPage';
import { FaqPage } from '@/pages/FaqPage';
import { AboutPage } from '@/pages/AboutPage';
import { TermsPage } from '@/pages/TermsPage';

function Routes() {
  const { route } = useRouter();
  const { error } = useSite();
  const [first, second] = route.segments;
  let page;
  if (!first) page = <HomePage />;
  else if (first === 'rum' && second) page = <RoomDetailPage slug={decodeURIComponent(second)} />;
  else if (first === 'rum') page = <RoomsPage />;
  else if (first === 'boka') page = <BookingPage key={route.query.toString()} query={route.query} />;
  else if (first === 'bokning' && second) page = <BookingStatusPage reference={decodeURIComponent(second)} query={route.query} />;
  else if (first === 'vanliga-fragor') page = <FaqPage />;
  else if (first === 'om-oss') page = <AboutPage />;
  else if (first === 'villkor') page = <TermsPage />;
  else page = <section className="mx-auto max-w-xl px-4 py-24 text-center"><h1 className="text-4xl font-semibold">Sidan finns inte</h1><a href="/" className="btn btn-primary mt-6">Till startsidan</a></section>;
  return (
    <Layout path={route.path}>
      {(!configured || error) && <p className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900">{!configured ? 'Hemsidan är inte kopplad till bokningssystemet ännu.' : error}</p>}
      {page}
    </Layout>
  );
}

export default function App() {
  return <SiteProvider><Routes /></SiteProvider>;
}
