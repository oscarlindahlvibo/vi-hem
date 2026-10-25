// E-postmallar med variabler: {{mottagare}}, {{fastighet}}, {{lagenhet}}, {{arendenummer}}, {{avsandare}}, {{foretag}}. Värden hämtas bara där de faktiskt finns och användaren har behörighet –
// saknade värden redovisas för användaren i förhandsgranskningen i stället för att hittas på. Mallar skickar aldrig något automatiskt.
export const TEMPLATE_VARIABLES = [['mottagare', 'Mottagarens namn'], ['fastighet', 'Fastighet'], ['lagenhet', 'Lägenhet'], ['arendenummer', 'Ärendenummer'], ['avsandare', 'Avsändarens namn'], ['foretag', 'Företagsnamn']] as const;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderTemplate(source: string, vars: Record<string, string | undefined>, opts: { html?: boolean } = {}): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) => {
    if (!(key in vars)) { missing.add(key); return whole; }
    const value = vars[key]; if (!value) { missing.add(key); return ''; }
    return opts.html ? esc(value) : value;
  });
  return { text, missing: [...missing] };
}
