export const money = (value: number | string, currency = "SEK") =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0));

export const moneyExact = (value: number | string, currency = "SEK") =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency }).format(Number(value || 0));

export const dateTime = (value: string, timeZone = "Europe/Stockholm") =>
  new Date(value).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short", timeZone });

export const dateOnly = (value: string, timeZone = "Europe/Stockholm") =>
  new Date(value).toLocaleDateString("sv-SE", { dateStyle: "medium", timeZone });

export const FALLBACK_IMAGE = "/placeholder.svg";
export const imageFor = (images?: string[]) => images?.find(Boolean) || FALLBACK_IMAGE;

export function durationLabel(startIso: string, endIso: string) {
  const hours = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 3600000);
  if (hours < 24) return `${hours} tim`;
  const days = Math.floor(hours / 24), rest = hours % 24;
  return rest ? `${days} dygn ${rest} tim` : `${days} dygn`;
}
