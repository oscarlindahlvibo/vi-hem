import { createContext, useContext } from 'react';
export const ContentContext = createContext<Record<string, string>>({});
export function CmsText({ id, fallback }: { id: string; fallback: string }) {
  const content = useContext(ContentContext);
  return <>{content[id] ?? fallback}</>;
}
export function useContent() { return useContext(ContentContext); }

export function CmsValue({ fallback }: { fallback: string }) { return <CmsText id={'copy.' + fallback} fallback={fallback} />; }
