import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { ExternalLink, Search } from 'lucide-react';

const suppliers = [
  { name: 'Jula', searchUrl: 'https://www.jula.se/search/' },
  { name: 'Biltema', searchUrl: 'https://www.biltema.se/soksida/' },
];

/** Opens the retailer's own search; no product data is imported or purchased. */
export function SupplierProductSearch({ query, disabled = false }: { query: string; disabled?: boolean }) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  const search = query.trim();

  return (
    <section aria-label="Sök hos butik" className="rounded-2xl bg-vihem-canvas p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-vihem-ink">
        <Search className="h-4 w-4" aria-hidden="true" /> Hitta produkten
      </div>
      <p className="mt-1 text-sm text-vihem-muted">
        {search ? 'Sök efter produkten hos en butik.' : 'Ange produktnamn eller artikelnummer ovan för att söka.'}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {suppliers.map((supplier) => {
          const url = new URL(supplier.searchUrl);
          url.searchParams.set('query', search);
          return (
            <a
              key={supplier.name}
              href={search ? url.href : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Sök hos ${supplier.name} (öppnas i webbläsare)`}
              aria-disabled={!search || opening || disabled}
              tabIndex={!search || opening || disabled ? -1 : 0}
              className={`vihem-focus flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[color:var(--vihem-line)] bg-white px-3 py-2 text-sm font-medium text-vihem-ink ${!search || opening || disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-vihem-canvas active:scale-[0.98] motion-reduce:transform-none'}`}
              onClick={async (event) => {
                if (!search || disabled || pending.current) { event.preventDefault(); return; }
                setError('');
                if (!Capacitor.isNativePlatform()) return;
                event.preventDefault();
                pending.current = true;
                setOpening(true);
                try {
                  await Browser.open({ url: url.href });
                } catch {
                  setError('Kunde inte öppna butiken. Försök igen.');
                } finally {
                  pending.current = false;
                  setOpening(false);
                }
              }}
            >
              {supplier.name} <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-vihem-muted">
        Resultaten öppnas hos butiken. Kopiera produktens länk och klistra in den nedan när du kommer tillbaka. Inköpet sparas först när du trycker på spara.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-vihem-danger">{error}</p>}
    </section>
  );
}
