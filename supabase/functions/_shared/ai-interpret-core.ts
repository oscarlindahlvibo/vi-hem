// Ren logik för vihem-ai-interpret-document (inga Deno-specifika API:er, så den kan enhetstestas med Node:
// scripts/ai-interpret-check.mjs). Tolkar transportorder (LTC/fraktbeställning/uppdragslista) från sidbilder.

export const MAX_IMAGE_BYTES = 2_500_000;
export const MAX_TOTAL_BYTES = 9_000_000;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type InterpretedItem = {
  quantity: number | null;
  typeName: string | null;
  orderRef: string | null;
  length_m: number | null;
  width_m: number | null;
  height_m: number | null;
  weight_ton: number | null;
  goodsMark: string | null;
  deliveryTermsAddition: string | null;
};

export type InterpretedOrder = {
  documentNumber: string | null;
  senderCompany: string | null;
  senderAddress: string | null;
  senderPostnr: string | null;
  senderCity: string | null;
  senderCountry: string | null;
  loadingCompany: string | null;
  customerContact: string | null;
  customerPhone: string | null;
  loadingDate: string | null;
  deliveryDate: string | null;
  recipientCompany: string | null;
  recipientContact: string | null;
  recipientPhone: string | null;
  recipientMobile: string | null;
  recipientEmail: string | null;
  deliveryCoordinateN: string | null;
  deliveryCoordinateE: string | null;
  deliveryCompany: string | null;
  deliveryAddress: string | null;
  deliveryPostnr: string | null;
  deliveryCity: string | null;
  deliveryCountry: string | null;
  deliveryTerms: string | null;
  items: InterpretedItem[];
};

const STRING_FIELDS: (keyof Omit<InterpretedOrder, "items">)[] = [
  "documentNumber", "senderCompany", "senderAddress", "senderPostnr", "senderCity", "senderCountry", "loadingCompany",
  "customerContact", "customerPhone", "loadingDate", "deliveryDate", "recipientCompany", "recipientContact", "recipientPhone",
  "recipientMobile", "recipientEmail", "deliveryCoordinateN", "deliveryCoordinateE", "deliveryCompany", "deliveryAddress",
  "deliveryPostnr", "deliveryCity", "deliveryCountry", "deliveryTerms",
];
const ITEM_STRING_FIELDS: (keyof InterpretedItem)[] = ["typeName", "orderRef", "goodsMark", "deliveryTermsAddition"];
const ITEM_NUMBER_FIELDS: (keyof InterpretedItem)[] = ["quantity", "length_m", "width_m", "height_m", "weight_ton"];

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

// Strikt JSON-schema (OpenAI structured outputs): alla fält krävs, saknade värden anges som null.
export function transportOrderSchema() {
  const orderProps: Record<string, unknown> = {};
  for (const field of STRING_FIELDS) orderProps[field] = nullableString;
  const itemProps: Record<string, unknown> = {};
  for (const field of ITEM_STRING_FIELDS) itemProps[field] = nullableString;
  for (const field of ITEM_NUMBER_FIELDS) itemProps[field] = nullableNumber;
  orderProps.items = {
    type: "array",
    items: { type: "object", additionalProperties: false, properties: itemProps, required: Object.keys(itemProps) },
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      orders: {
        type: "array",
        items: { type: "object", additionalProperties: false, properties: orderProps, required: Object.keys(orderProps) },
      },
    },
    required: ["orders"],
  };
}

export const SYSTEM_PROMPT =
  "Du läser svenska transportdokument (fraktbeställningar/LTC, uppdragslistor, transportorder) och returnerar bara JSON enligt schemat. " +
  "Du föreslår bara värden som tydligt står i dokumentet. Gissa aldrig: saknas ett värde anges null.";

export function buildTransportOrderPrompt(ocrText: string): string {
  return [
    "Extrahera varje transportorder/leverans i dokumentet till ett objekt i listan 'orders'. Ett dokument kan innehålla flera leveranser (t.ex. en uppdragslista).",
    "Regler:",
    "- Datum anges som YYYY-MM-DD.",
    "- Mått anges i meter och vikt i ton (omvandla kilo till ton; 157 kg = 0,157 ton). Mått som uppenbart är centimeter eller millimeter (t.ex. 395 eller 3400 för en bredd) omvandlas till meter.",
    "- documentNumber är dokumentets eget nummer (t.ex. LTC-nummer). orderRef är kundens ordernummer på godsraden.",
    "- sender* är avsändare/lastplats, recipient* är mottagare/kontakt vid leverans, delivery* är leveransadress (adress, postnummer, ort).",
    "- Kopiera telefonnummer och e-post exakt som de står. Ange null för det som saknas.",
    "- Kontakt vid lossning (recipientContact och recipientPhone/recipientMobile) är den person och det nummer som anges för mottagaren eller leveransen, t.ex. under 'Leveransanvisning', 'Aviseras', 'Kontaktperson' eller bredvid mottagaren. Står det t.ex. 'Ulf 073-0675742 Byggledare' är recipientContact 'Ulf (byggledare)' och recipientPhone '073-0675742'. Anta att namn och nummer i sådana fält är kontakten vid lossning.",
    "- recipientCompany är mottagarens namn eller företag. Anges mottagaren bara med adress (gatuadress, postnummer och ort) sätts recipientCompany till null och adressen läggs i delivery*.",
    "- Samma fraktsedel kan förekomma i flera kopior i dokumentet (t.ex. blad för avsändare, mottagare och transportör) eller på flera sidor. Redovisa varje order och varje godsrad bara en gång.",
    "- Lägg varje godsrad som ett objekt i items. En godsrad är en fysisk rad i tabellen (antal, typ, mått, vikt, godsmärke), inte en tabellrubrik.",
    "- Tabellrubriker (Antal, Typ, Order, Längd, Bredd, Höjd, Vikt, Godsmärke, Koordinat, Mobil nr, Postnr, Adress) är aldrig värden. Texten under 'Tillägg leveransvillkor' är fritext och hör till godsraden i deliveryTermsAddition.",
    "- OCR-texten kan ha kolumnerna i fel ordning. Går texten och bilden inte ihop, lita på bilden.",
    ocrText.trim() ? `\nOCR-text (kan innehålla fel):\n${ocrText.slice(0, 24000)}` : "\nDokumentets sidor bifogas som bilder.",
  ].join("\n");
}

function cleanString(value: unknown, max = 400): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function cleanNumber(value: unknown, max = 1_000_000): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value.replace(/\s/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

function cleanDate(value: unknown): string | null {
  const text = cleanString(value, 40);
  const match = text ? /(\d{4})-(\d{2})-(\d{2})/.exec(text) : null;
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}` ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

export function normalizeOrders(raw: unknown): { orders: InterpretedOrder[]; warnings: string[] } {
  const warnings: string[] = [];
  const list = Array.isArray((raw as { orders?: unknown })?.orders) ? (raw as { orders: unknown[] }).orders : [];
  const orders: InterpretedOrder[] = [];
  for (const entry of list.slice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    const order = {} as InterpretedOrder;
    for (const field of STRING_FIELDS) (order as Record<string, unknown>)[field] = cleanString(source[field]);
    order.loadingDate = cleanDate(source.loadingDate);
    order.deliveryDate = cleanDate(source.deliveryDate);
    const items = Array.isArray(source.items) ? source.items.slice(0, 100) : [];
    order.items = items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const out = {} as InterpretedItem;
        for (const field of ITEM_STRING_FIELDS) (out as Record<string, unknown>)[field] = cleanString(item[field]);
        for (const field of ITEM_NUMBER_FIELDS) (out as Record<string, unknown>)[field] = cleanNumber(item[field], field === "quantity" ? 100000 : 100000);
        for (const dim of ["length_m", "width_m", "height_m"] as const) {
          const value = out[dim];
          // Centimeter eller millimeter som angetts som meter: över 30 m är orimligt för gods på lastbil.
          if (value !== null && value > 30) {
            out[dim] = Math.round((value <= 1000 ? value / 100 : value / 1000) * 100) / 100;
            warnings.push("Ett mått var orimligt stort och tolkades som centimeter eller millimeter.");
          }
        }
        // Vikt i kilo som felaktigt angetts som ton: över 200 ton är orimligt för en godsrad.
        if (out.weight_ton !== null && out.weight_ton > 200) {
          out.weight_ton = Math.round((out.weight_ton / 1000) * 100) / 100;
          warnings.push("En godsvikt var orimligt hög och tolkades som kilo.");
        }
        return out;
      });
    if (isUsableOrder(order)) orders.push(order);
  }
  return { orders: mergeDuplicateOrders(orders), warnings: [...new Set(warnings)] };
}

const isFilled = (value: string | number | null) => value !== null && value !== 0 && value !== "";

// Samma fraktsedel i flera kopior ger flera likadana ordrar: slå ihop ordrar med samma dokumentnummer och leveransadress,
// komplettera tomma fält och slå ihop godsrader med samma typ.
export function mergeDuplicateOrders(orders: InterpretedOrder[]): InterpretedOrder[] {
  const merged: InterpretedOrder[] = [];
  const key = (order: InterpretedOrder) => (order.documentNumber ? `${order.documentNumber.toLowerCase()}|${(order.deliveryAddress ?? "").toLowerCase().replace(/\s+/g, " ").trim()}` : null);
  for (const order of orders) {
    const k = key(order);
    const target = k ? merged.find((m) => key(m) === k) : undefined;
    if (!target) { merged.push({ ...order, items: order.items.map((item) => ({ ...item })) }); continue; }
    for (const field of STRING_FIELDS) if (target[field] === null && order[field] !== null) (target as Record<string, unknown>)[field] = order[field];
    target.loadingDate = target.loadingDate ?? order.loadingDate;
    target.deliveryDate = target.deliveryDate ?? order.deliveryDate;
    for (const item of order.items) {
      const same = target.items.find((t) => t.typeName !== null && item.typeName !== null && t.typeName.toLowerCase() === item.typeName.toLowerCase());
      if (!same) { target.items.push({ ...item }); continue; }
      for (const field of [...ITEM_STRING_FIELDS, ...ITEM_NUMBER_FIELDS]) {
        if (!isFilled(same[field] as string | number | null) && isFilled(item[field] as string | number | null)) (same as Record<string, unknown>)[field] = item[field];
      }
    }
  }
  return merged;
}

// En order räknas som användbar om den innehåller något som identifierar leveransen.
export function isUsableOrder(order: InterpretedOrder): boolean {
  return Boolean(order.documentNumber || order.deliveryCity || order.deliveryAddress || order.recipientCompany || order.items.length > 0);
}

// Hur komplett resultatet är (0–1): används för att avgöra om bildtolkning (dyrare modell) behövs som komplement.
const TABLE_HEADINGS = new Set(["antal", "typ", "order", "längd", "bredd", "höjd", "vikt", "godsmärke", "koordinat", "mobil nr", "postnr", "adress", "nr.", "nr"]);

// Sant om någon godsrad innehåller en tabellrubrik som värde, vilket tyder på att OCR-texten läsmässigt blandat kolumnerna.
export function looksGarbled(orders: InterpretedOrder[]): boolean {
  return orders.some((order) =>
    order.items.some((item) => [item.typeName, item.goodsMark, item.deliveryTermsAddition, item.orderRef].some((value) => value !== null && TABLE_HEADINGS.has(value.trim().toLowerCase()))),
  );
}

export function completeness(orders: InterpretedOrder[]): number {
  if (orders.length === 0) return 0;
  const fields = ["documentNumber", "loadingDate", "deliveryDate", "deliveryAddress", "deliveryCity", "recipientCompany"] as const;
  const scores = orders.map((order) => {
    const filled = fields.filter((field) => order[field]).length;
    return (filled + (order.items.length > 0 ? 1 : 0)) / (fields.length + 1);
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export type PageInput = { content_type: string; base64: string };

export type ValidatedRequest =
  | { ok: true; pages: PageInput[]; requestId: string; fileName: string; fileSha256: string; userRef: string; source: string; accuracy: "standard" | "high" }
  | { ok: false; status: number; error: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const approxBytes = (base64: string) => Math.floor((base64.length * 3) / 4);

export function validateInterpretRequest(body: unknown, maxPages: number): ValidatedRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const requestId = typeof b.request_id === "string" ? b.request_id.trim() : "";
  if (!requestId || requestId.length > 100) return { ok: false, status: 400, error: "request_id saknas eller är för långt." };
  if (!Array.isArray(b.pages) || b.pages.length === 0) return { ok: false, status: 400, error: "Inga sidor bifogades." };
  if (b.pages.length > maxPages) return { ok: false, status: 413, error: `För många sidor (högst ${maxPages} per dokument).` };
  const pages: PageInput[] = [];
  let total = 0;
  for (const page of b.pages as Record<string, unknown>[]) {
    const type = typeof page?.content_type === "string" ? page.content_type.toLowerCase() : "";
    const data = typeof page?.base64 === "string" ? page.base64.replace(/^data:[^;]+;base64,/, "") : "";
    if (!ALLOWED_IMAGE_TYPES.includes(type)) return { ok: false, status: 415, error: "Sidorna måste vara JPEG, PNG eller WebP." };
    if (!data || !BASE64.test(data)) return { ok: false, status: 400, error: "En sida har ogiltig bilddata." };
    const bytes = approxBytes(data);
    if (bytes > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: "En sida är för stor. Minska bildens storlek." };
    total += bytes;
    pages.push({ content_type: type, base64: data });
  }
  if (total > MAX_TOTAL_BYTES) return { ok: false, status: 413, error: "Dokumentet är för stort." };
  const sha = typeof b.file_sha256 === "string" && /^[a-f0-9]{64}$/.test(b.file_sha256) ? b.file_sha256 : "";
  return {
    ok: true, pages, requestId,
    fileName: typeof b.file_name === "string" ? b.file_name.slice(0, 300) : "",
    fileSha256: sha,
    userRef: typeof b.user_ref === "string" ? b.user_ref.slice(0, 200) : "",
    source: typeof b.source === "string" ? b.source.slice(0, 100) : "",
    // "high": läs bilderna direkt med bildmodellen (när användaren själv valt AI eller vill ha en om-tolkning).
    accuracy: b.accuracy === "high" ? "high" : "standard",
  };
}

export function estimateOpenAiCostSek(model: string, inputTokens: number, outputTokens: number): number {
  const lower = model.toLowerCase();
  const usdPerMillionInput = lower.includes("nano") ? 0.05 : lower.includes("mini") ? 0.25 : 1.25;
  const usdPerMillionOutput = lower.includes("nano") ? 0.4 : lower.includes("mini") ? 2.0 : 10.0;
  const usd = (inputTokens / 1_000_000) * usdPerMillionInput + (outputTokens / 1_000_000) * usdPerMillionOutput;
  return Math.round(usd * 10.6 * 10000) / 10000;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Översätter databasfel från vihem_ai_* till HTTP-status.
export function statusForDbError(code: string | undefined): number {
  switch (code) {
    case "28000": return 401;
    case "42501": return 403;
    case "54000": return 413;
    case "53400": return 429;
    case "22023": return 400;
    default: return 500;
  }
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    try {
      return match ? JSON.parse(match[0]) : {};
    } catch {
      return {};
    }
  }
}
