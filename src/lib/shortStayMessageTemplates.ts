export interface MessageTemplate {
  id: string; unit_id: string; name: string; translations: Record<string, string>; updated_at: string;
}
export const templateLanguages = [
  ['sv', 'Svenska'], ['en', 'English'], ['de', 'Deutsch'], ['da', 'Dansk'],
  ['no', 'Norsk'], ['fi', 'Suomi'], ['fr', 'Français'], ['es', 'Español'], ['pl', 'Polski'],
] as const;
export const languageLabel = (code: string) => templateLanguages.find(([key]) => key === code)?.[1] || code;
export function validateTemplate(name: string, variants: { language: string; text: string }[]) {
  if (!name.trim() || name.trim().length > 120) throw new Error('Ange ett mallnamn på högst 120 tecken.');
  if (!variants.length) throw new Error('Lägg till minst ett språk.');
  const translations: Record<string, string> = {};
  for (const variant of variants) {
    const code = variant.language.trim().toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code)) throw new Error('Ange en språkkod, exempelvis sv, en eller en-gb.');
    if (Object.prototype.hasOwnProperty.call(translations, code)) throw new Error(`Språket ${languageLabel(code)} finns redan i mallen.`);
    if (!variant.text.trim() || variant.text.trim().length > 5000) throw new Error(`Skriv en text på 1–5 000 tecken för ${languageLabel(code)}.`);
    translations[code] = variant.text.trim();
  }
  return translations;
}

/** Bookings currently store a full guest_name. Keep hyphenated names intact. */
export function renderMessageTemplate(text: string, guestName?: string | null): string {
  const name = guestName?.trim() || '';
  const firstName = name.toLocaleLowerCase('sv-SE') === 'beds24-bokning' ? '' : name.split(/\s+/u)[0];
  if (/\[FIRST_NAME\]/i.test(text) && !firstName) {
    throw new Error('Gästens namn saknas i bokningen. Lägg till namnet eller skriv meddelandet manuellt.');
  }
  // A callback keeps characters such as $& in the guest name as literal text.
  const rendered = text.replace(/\[FIRST_NAME\]/gi, () => firstName);
  if (rendered.length > 5000) throw new Error('Meddelandet blir längre än 5 000 tecken med gästens namn. Korta mallen innan du använder den.');
  return rendered;
}
