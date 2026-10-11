import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { ExternalLink, Search } from 'lucide-react';
import { supplierBrowser, productExtractionScript, validateSupplierProduct, type SupplierProduct } from '../lib/supplierProducts';
import { supabase } from '../lib/supabase';
import { Button, Input } from './ui';

const suppliers = [
  { name: 'Jula', searchUrl: 'https://www.jula.se/search/', parameter: 'query' },
  { name: 'Biltema', searchUrl: 'https://www.biltema.se/soksida/', parameter: 'query' },
  { name: 'Byggmax', searchUrl: 'https://www.byggmax.se/catalogsearch/result/', parameter: 'q' },
  { name: 'BAUHAUS', searchUrl: 'https://www.bauhaus.se/catalogsearch/result/', parameter: 'q' },
  { name: 'jem & fix', searchUrl: 'https://www.jemfix.se/soek/', parameter: 'q' },
];

/** Search the retailer and review product metadata before applying it to a draft. */
export function SupplierProductSearch({ query, disabled = false, onImport }: { query: string; disabled?: boolean; onImport: (product: SupplierProduct) => void }) {
  const [error, setError] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [opening, setOpening] = useState(false);
  const [searched, setSearched] = useState(false);
  const pending = useRef(false);
  const search = query.trim();

  return (
    <section aria-label="Sök hos butik" className="rounded-2xl bg-vihem-canvas p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-vihem-ink">
        <Search className="h-4 w-4" aria-hidden="true" /> Hitta produkten
      </div>
      <p className="mt-1 text-sm text-vihem-muted">
        {search ? 'Byggmax visar träffar här. Övriga butiker öppnas i butiksvyn eller webbläsaren.' : 'Ange produktnamn eller artikelnummer ovan för att söka.'}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {suppliers.map((supplier) => {
          const url = new URL(supplier.searchUrl);
          url.searchParams.set(supplier.parameter, search);
          return (
            <a
              key={supplier.name}
              href={search ? url.href : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Sök hos ${supplier.name}${supplier.name === 'Byggmax' ? ' i VI-HEM' : ' (öppnas i webbläsare)'}`}
              aria-disabled={!search || opening || disabled}
              tabIndex={!search || opening || disabled ? -1 : 0}
              className={`vihem-focus flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[color:var(--vihem-line)] bg-white px-3 py-2 text-sm font-medium text-vihem-ink ${!search || opening || disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-vihem-canvas active:scale-[0.98] motion-reduce:transform-none'}`}
              onClick={async (event) => {
                if (!search || disabled || pending.current) { event.preventDefault(); return; }
                setError('');
                if (supplier.name === 'Byggmax') {
                  event.preventDefault(); pending.current = true; setOpening(true); setError(''); setProducts([]); setSearched(false); setSearched(false);
                  try {
                    const {data,error:requestError} = await supabase.functions.invoke('vihem-supplier-product',{body:{action:'search',supplier:supplier.name,query:search}});
                    if (requestError) {
                      let message='Sökningen misslyckades. Försök igen.';
                      try { message=(await requestError.context.json()).error || message; } catch { /* network error */ }
                      throw new Error(message);
                    }
                    if (!Array.isArray(data?.products)) throw new Error('Sökresultaten kunde inte läsas.');
                    setProducts(data.products.map(validateSupplierProduct)); setSearched(true);
                  } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sökningen misslyckades.'); }
                  finally { pending.current=false; setOpening(false); }
                  return;
                }
                if (!Capacitor.isNativePlatform()) return;
                event.preventDefault();
                pending.current = true;
                setOpening(true);
                try {
                  if (Capacitor.isPluginAvailable('SupplierBrowser')) {
                    const result = await supplierBrowser.open({ url: url.href, script: productExtractionScript });
                    if (result.product) setProducts([validateSupplierProduct(result.product)]);
                  } else { await Browser.open({ url: url.href }); }
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : 'Kunde inte öppna butiken. Försök igen.');
                } finally {
                  pending.current = false;
                  setOpening(false);
                }
              }}
            >
              {supplier.name} {supplier.name === 'Byggmax' ? <Search className="h-4 w-4" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
            </a>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-vihem-muted">
        {Capacitor.isPluginAvailable('SupplierBrowser') ? 'Öppna en produkt och tryck på Välj produkt. Granska uppgifterna här innan du lägger till dem.' : 'Byggmax: välj en artikel direkt i träfflistan. Övriga butiker har produktval i den nya mobilappen; här på webben öppnas deras webbplatser.'}
      </p>
      <details className="mt-3"><summary className="vihem-focus cursor-pointer text-sm text-vihem-muted">Har du redan en produktlänk?</summary><div className="mt-3 space-y-2">
        <Input label="Importera från produktlänk" value={productUrl} onChange={e=>setProductUrl(e.target.value)} placeholder="https://www.biltema.se/..." disabled={disabled || opening} type="url" />
        <Button type="button" variant="secondary" disabled={disabled || !productUrl.trim()} loading={opening} onClick={async () => {
          if (pending.current) return;
          pending.current = true; setOpening(true); setError(''); setProducts([]); setSearched(false);
          try {
            // Validate before sending a URL to the backend; the backend repeats all checks.
            validateSupplierProduct({name:'Produkt',url:productUrl});
            const {data,error:requestError} = await supabase.functions.invoke('vihem-supplier-product',{body:{url:productUrl.trim()}});
            if (requestError) {
              let message='Kunde inte hämta produkten. Försök igen eller fyll i uppgifterna själv.';
              try { message=(await requestError.context.json()).error || message; } catch { /* transport failure */ }
              throw new Error(message);
            }
            if (!Array.isArray(data?.products) || !data.products.length) throw new Error('Inga produktuppgifter hittades.');
            setProducts(data.products.map(validateSupplierProduct));
          } catch (failure) { setError(failure instanceof Error ? failure.message : 'Kunde inte hämta produkten.'); }
          finally { pending.current=false; setOpening(false); }
        }}>Hämta produkt</Button>
      </div>
      </details>
      {searched && !products.length && <p role="status" className="mt-3 text-sm text-vihem-muted">Inga produkter hittades. Prova ett annat namn eller artikelnummer.</p>}
      <div className={searched ? "mt-3 max-h-80 overflow-y-auto overscroll-contain" : ""} aria-label="Produktträffar">
      {products.map(product => <div key={product.url+product.sku} className="mt-3 border-t border-[color:var(--vihem-line)] pt-3">
        <p className="text-sm font-semibold text-vihem-ink">{product.name}</p>
        <p className="mt-1 text-sm text-vihem-muted">{product.supplier}{product.sku ? ` · Artikel ${product.sku}` : ''}</p>
        <Button type="button" className="mt-2" disabled={disabled || opening} onClick={async ()=>{
          if (pending.current) return;
          if (!searched) { onImport(product); setProducts([]); setProductUrl(''); return; }
          pending.current=true;setOpening(true);setError('');
          try {
            const {data,error:requestError}=await supabase.functions.invoke('vihem-supplier-product',{body:{url:product.url}});
            if(requestError || !Array.isArray(data?.products) || !data.products.length) throw new Error('Artikeluppgifterna kunde inte hämtas. Försök igen.');
            const variants=data.products.map(validateSupplierProduct);
            if (variants.length===1) { onImport(variants[0]); setProducts([]);setProductUrl(''); }
            else { setProducts(variants); }
            setSearched(false);
          } catch(failure) { setError(failure instanceof Error?failure.message:'Kunde inte välja artikeln.'); }
          finally {pending.current=false;setOpening(false);}
        }}>{searched ? 'Välj artikel' : 'Använd produkten'}</Button>
      </div>)}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-vihem-danger">{error}</p>}
    </section>
  );
}
