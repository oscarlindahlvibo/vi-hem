/** Beds24 booking fields; country is a hint, never proof of a guest's language. */
export function chooseGuestMessageLanguage(
  translations: Record<string, string>,
  fallback: string,
  booking: { lang?: unknown; country2?: unknown; country?: unknown },
  mode: "fixed" | "auto" = "fixed",
): {
  language: string;
  source: "fixed" | "guest_language" | "country" | "fallback";
} {
  if (!translations[fallback]?.trim())
    throw Error("Mallens reservspråk saknas.");
  if (mode === "fixed") return { language: fallback, source: "fixed" };
  const normalize = (value: string) =>
    value.trim().toLowerCase().replace(/_/g, "-");
  const explicit =
    typeof booking.lang === "string" ? normalize(booking.lang) : "";
  const countries: Record<string, string> = {
    SE: "sv",
    SWE: "sv",
    SWEDEN: "sv",
    SVERIGE: "sv",
    GB: "en",
    GBR: "en",
    UK: "en",
    US: "en",
    USA: "en",
    AU: "en",
    NZ: "en",
    IE: "en",
    DE: "de",
    DEU: "de",
    GERMANY: "de",
    AT: "de",
    DK: "da",
    DNK: "da",
    DENMARK: "da",
    NO: "no",
    NOR: "no",
    NORWAY: "no",
    FI: "fi",
    FIN: "fi",
    FINLAND: "fi",
    FR: "fr",
    FRA: "fr",
    FRANCE: "fr",
    ES: "es",
    ESP: "es",
    SPAIN: "es",
    PL: "pl",
    POL: "pl",
    POLAND: "pl",
    NL: "nl",
    NLD: "nl",
    IT: "it",
    ITA: "it",
    PT: "pt",
    PRT: "pt",
  };
  const country2 =
    typeof booking.country2 === "string" ? booking.country2.trim() : "";
  const country =
    typeof booking.country === "string" ? booking.country.trim() : "";
  const desired =
    explicit || countries[(country2 || country).toUpperCase()] || "";
  const base = desired.split("-")[0];
  const aliases =
    base === "nb" || base === "nn" ? ["no"] : base === "no" ? ["nb"] : [];
  const candidates = [desired, base, ...aliases].filter(Boolean);
  // Prefer an exact regional translation over the base language, regardless of object order.
  const match = candidates
    .map((candidate) =>
      Object.keys(translations).find(
        (code) => normalize(code) === candidate && translations[code]?.trim(),
      ),
    )
    .find(Boolean);
  return match
    ? { language: match, source: explicit ? "guest_language" : "country" }
    : { language: fallback, source: "fallback" };
}
