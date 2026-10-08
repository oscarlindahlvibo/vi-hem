import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadSite, type PublicSite } from './api';

interface SiteState { site: PublicSite | null; error: string; loading: boolean }
const SiteContext = createContext<SiteState>({ site: null, error: '', loading: true });
export const useSite = () => useContext(SiteContext);

/** Hämtar innehållet från VI-HEM vid start, var minut och när fönstret får fokus igen. */
export function SiteProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SiteState>({ site: null, error: '', loading: true });
  useEffect(() => {
    let alive = true;
    const refresh = () => loadSite()
      .then((site) => alive && setState({ site, error: '', loading: false }))
      .catch((e) => alive && setState((s) => ({ site: s.site, error: s.site ? '' : (e instanceof Error ? e.message : 'Kunde inte hämta innehållet.'), loading: false })));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  return <SiteContext.Provider value={state}>{children}</SiteContext.Provider>;
}
