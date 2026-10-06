import { useState, useEffect, useCallback } from 'react';
export interface RouteState { path: string; segments: string[]; query: URLSearchParams; }
function parsePath(): RouteState {
  // Keep bookmarked Bolt hash links usable, while new links use normal URLs.
  const legacy = window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : null;
  if (legacy) window.history.replaceState({}, '', legacy);
  const path = window.location.pathname;
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(window.location.search) };
}
export function useRouter() {
  const [route, setRoute] = useState<RouteState>(parsePath);
  useEffect(() => {
    const handler = () => { setRoute(parsePath()); window.scrollTo(0,0); };
    window.addEventListener('popstate', handler); window.addEventListener('hashchange', handler);
    return () => { window.removeEventListener('popstate', handler); window.removeEventListener('hashchange', handler); };
  }, []);
  const go = useCallback((to: string) => navigate(to), []);
  return { route, navigate: go };
}
export function navigate(to: string) {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function Link({to,children,className,onClick}: {to:string;children:React.ReactNode;className?:string;onClick?:()=>void}) {
  return <a href={to} className={className} onClick={e=>{
    if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button!==0) return;
    e.preventDefault();navigate(to);onClick?.();
  }}>{children}</a>;
}
