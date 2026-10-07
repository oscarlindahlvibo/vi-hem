/** PostgREST errors are plain objects, rather than instances of Error. */
export function websiteErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === '23505') return 'Annonsens adress (slug) används redan. Välj en annan adress och spara igen.';
  if (code === '23514') return 'Annonsen är inte komplett för publicering. Kontrollera rubrik, annonsens adress och annonsbeskrivning. Du kan spara ett utkast genom att avmarkera publicering.';
  if (code === '42501') return 'Du saknar behörighet att administrera denna annons. Du behöver vara aktiv administratör i Vibogruppen AB.';
  return typeof message === 'string' && message.trim() ? message : fallback;
}
