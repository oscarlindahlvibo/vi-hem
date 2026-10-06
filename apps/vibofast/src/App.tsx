import { useEffect, useState } from 'react';
import { supabase, demoMode } from '@/lib/supabase';
import { demoProperties, setProperties } from '@/data/properties';
import { company, setCompany } from '@/data/company';
import { setFaqCategories } from '@/data/faq';
import { ContentContext } from '@/lib/site-content';
import { ListingContext } from '@/components/ListingState';
import { useRouter } from '@/lib/router';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HomePage } from '@/pages/HomePage';
import { PropertiesPage } from '@/pages/PropertiesPage';
import { PropertyDetailPage } from '@/pages/PropertyDetailPage';
import { FaqPage } from '@/pages/FaqPage';
import { FaqCategoryPage } from '@/pages/FaqCategoryPage';
import { FaqArticlePage } from '@/pages/FaqArticlePage';
import { AboutPage } from '@/pages/AboutPage';
import { ContactPage } from '@/pages/ContactPage';
import { InterestPage } from '@/pages/InterestPage';

function App() {
  const [state, setState] = useState({ loading: true, error: '', demo: demoMode });
  const [content, setContent] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        if (demoMode) { setProperties(demoProperties); }
        else if (!supabase) { throw new Error('Aktuella annonser kan inte visas just nu. Kontakta oss för information om lediga lägenheter.'); }
        else {
          const { data, error } = await supabase.rpc('vihem_vibofast_public_site');
          if (error || !data) throw new Error('Aktuella annonser kunde inte hämtas. Försök igen om en stund eller kontakta oss.');
          if (cancelled) return;
          setProperties(data.listings);
          if (data.content.company) setCompany({ ...data.content.company, viHemUrl: 'https://app.vi-hem.se' });
          if (data.content.faq) setFaqCategories(data.content.faq);
          setContent(data.content.text ?? {});
        }
        if (!cancelled) setState({ loading: false, error: '', demo: demoMode });
      } catch (error) {
        if (!cancelled) { setProperties([]); setState({ loading: false, error: error instanceof Error ? error.message : 'Ett fel uppstod.', demo: demoMode }); }
      } finally { inFlight = false; }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, []);
  const { route } = useRouter();
  useEffect(() => {
    document.title = content['meta.title'] ?? `${company.name} – ${company.tagline}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content',content['meta.description'] ?? company.description);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href','https://vibofast.se' + route.path);
  }, [content, route.path, state]);
  const segs = route.segments;

  let page: React.ReactNode;

  if (segs.length === 0) {
    page = <HomePage />;
  } else if ((segs[0] === 'lediga-objekt' || segs[0] === 'lediga-lagenheter')) {
    page = <PropertiesPage />;
  } else if (segs[0] === 'objekt' && segs[1]) {
    page = <PropertyDetailPage slug={segs[1]} />;
  } else if (segs[0] === 'for-hyresgaster') {
    if (segs.length === 1) {
      page = <FaqPage />;
    } else if (segs.length === 2) {
      page = <FaqCategoryPage slug={segs[1]} />;
    } else if (segs.length === 3) {
      page = <FaqArticlePage categorySlug={segs[1]} articleSlug={segs[2]} />;
    } else {
      page = <FaqPage />;
    }
  } else if (segs[0] === 'om-oss') {
    page = <AboutPage />;
  } else if (segs[0] === 'kontakt') {
    page = <ContactPage />;
  } else if (segs[0] === 'intresseanmalan') {
    page = <InterestPage />;
  } else {
    page = <HomePage />;
  }

  return (
    <ContentContext.Provider value={content}><ListingContext.Provider value={state}><div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{page}</main>
      <Footer />
    </div></ListingContext.Provider></ContentContext.Provider>
  );
}

export default App;
