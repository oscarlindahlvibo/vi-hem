import { useContext } from 'react';
import { createContext } from 'react';
export const ListingContext = createContext({ loading: true, error: '', demo: false });
export function ListingState() {
  const { loading, error, demo } = useContext(ListingContext);
  if (!loading && !error && !demo) return null;
  return <p role="status" className="my-6 rounded-xl bg-sand-100 p-4 text-sm text-forest-800">{loading ? 'Hämtar aktuella annonser…' : error || 'Förhandsvisning med exempelannonser. Tillgänglighet och priser är inte verifierade.'}</p>;
}
