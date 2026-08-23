// Server-side final PDF generator for a completed (fully signed) Avtal V2
// document. Runs in the edge function, not the browser, so the existing
// canvas-based src/lib/generatedDocuments.ts can't be reused directly --
// this ports the same "hand-rolled minimal PDF, no external library"
// approach (see that file's header for why) to Deno, adding: proper
// multi-page text pagination, embedded handwritten-signature images (via
// _shared/png-decode.ts, since Deno has no <canvas>), and a dedicated
// signatures/verification section covering both signing methods.
//
// Deliberately simple layout, not true typography: line wrapping is by
// character count (same approximation the existing browser-side generator
// already uses), not measured glyph widths -- consistent with this
// codebase's existing PDF output rather than a new, different look.
import type { AgreementBlock } from "./agreement-snapshot.ts";
import { decodePngDataUrl, type DecodedPng } from "./png-decode.ts";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const TOP_Y = PAGE_HEIGHT - MARGIN;
const BOTTOM_Y = MARGIN;

interface TextLine {
  text: string;
  font: "F1" | "F2";
  size: number;
  gapAfter?: number;
}

type Page =
  | { kind: "text"; lines: TextLine[] }
  | { kind: "image"; png: DecodedPng; caption: string };

export interface SignatureForPdf {
  name: string;
  roleTitle: string;
  method: "handwritten" | "bankid";
  signedAt: string;
  signatureImageDataUrl?: string | null;
  bankidPersonalNumber?: string | null;
  bankidReference?: string | null;
}

export interface AgreementPdfInput {
  documentNumber: string;
  title: string;
  organisationName: string;
  organisationLogoDataUrl?: string | null;
  blocks: AgreementBlock[];
  parties: { display_name: string; party_type: string }[];
  signatures: SignatureForPdf[];
  contentHash: string;
  completedAt: string;
  verificationUrl: string | null;
}

const normalize = (value: string) =>
  value.replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[’]/g, "'");

function winAnsiByte(character: string): number {
  const special: Record<string, number> = {
    "€": 0x80, "é": 0xe9, "É": 0xc9, "å": 0xe5, "Å": 0xc5,
    "ä": 0xe4, "Ä": 0xc4, "ö": 0xf6, "Ö": 0xd6, "ü": 0xfc, "Ü": 0xdc,
    "•": 0x95, // WinAnsiEncoding (cp1252) BULLET -- used for list markers and masked digits
  };
  if (special[character] !== undefined) return special[character];
  const code = character.charCodeAt(0);
  // Anything outside 0x20-0xff (Latin-1-ish) has no WinAnsi glyph and would
  // silently render as a literal "?" in a real PDF viewer -- caught by
  // actually rendering a test PDF and pixel/text-checking it with pypdf,
  // not by typecheck. Every character this module ever emits must be
  // either plain ASCII, one of the Swedish/typographic chars above, or the
  // bullet -- see the callers below for what got fixed after finding this.
  return code >= 0x20 && code <= 0xff ? code : 0x3f;
}

function escapePdfText(value: string): string {
  return `<${Array.from(normalize(value), (c) => winAnsiByte(c).toString(16).padStart(2, "0")).join("")}>`;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Wraps by character count, not measured glyph width -- see module header. */
function wrapLine(text: string, maxChars: number): string[] {
  if (text.length === 0) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    while (current.length > maxChars) {
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) lines.push(current);
  return lines;
}

function charsForSize(size: number): number {
  // Helvetica averages roughly 0.5em per character; leave margin for safety.
  return Math.max(20, Math.floor(((PAGE_WIDTH - MARGIN * 2) / (size * 0.52))));
}

function blockToLines(block: AgreementBlock): TextLine[] {
  const c = block.content || {};
  const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  switch (block.block_type) {
    case "heading":
      return wrapLine(text(c.text), charsForSize(18)).map((t) => ({ text: t, font: "F2", size: 18, gapAfter: 6 }));
    case "subheading":
      return wrapLine(text(c.text), charsForSize(13)).map((t) => ({ text: t, font: "F2", size: 13, gapAfter: 4 }));
    case "paragraph":
      return [...wrapLine(text(c.text), charsForSize(10)).map((t) => ({ text: t, font: "F1" as const, size: 10 })), { text: "", font: "F1", size: 10, gapAfter: 4 }];
    case "callout":
      return [...wrapLine(`OBS: ${text(c.text)}`, charsForSize(10)).map((t) => ({ text: t, font: "F1" as const, size: 10 })), { text: "", font: "F1", size: 10, gapAfter: 4 }];
    // "party" is intercepted before this function is called (see
    // buildTextLinesFromBlocks -> partyLine), which needs the agreement's
    // party list that isn't available here.
    case "contact_info":
      return wrapLine(text(c.text), charsForSize(10)).map((t) => ({ text: t, font: "F1", size: 10 }));
    case "date":
      return [{ text: `${text(c.label) || "Datum"}: ${text(c.value)}`, font: "F1", size: 10, gapAfter: 3 }];
    case "dynamic_field":
      return [{ text: `${text(c.label)}: ${text(c.token)}`, font: "F1", size: 10, gapAfter: 3 }];
    case "price":
      return [{ text: `${text(c.label)}  ${text(c.amount)} ${text(c.unit) || "kr"}`, font: "F1", size: 10, gapAfter: 3 }];
    case "price_table": {
      // Mirrors calcPriceTable() in src/modules/agreements-v2/blocks/priceTable.ts
      // -- duplicated rather than shared across the browser/edge-function
      // boundary (see that module's header), so keep the two in sync.
      // Deduction type is PER ITEM (a quote can mix RUT-eligible rows with
      // ROT-eligible rows with plain rows), never a single flag for the
      // whole block.
      // VAT is PER ITEM too (a quote can mix e.g. 25% goods with a 12%
      // catering row) -- each item carries its own vat_rate rather than one
      // rate for the whole block.
      const toNumber = (v: unknown) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
      const items: { description?: string; quantity?: string; unit_price?: string; vat_rate?: number; deduction_type?: string }[] = Array.isArray(c.items) ? c.items : [];
      const lineNetto = (item: { quantity?: string; unit_price?: string }) => toNumber(item.quantity) * toNumber(item.unit_price);
      const itemVatRate = (item: { vat_rate?: number }) => (item.vat_rate === undefined || item.vat_rate === null ? 25 : toNumber(item.vat_rate));
      const lineMoms = (item: { quantity?: string; unit_price?: string; vat_rate?: number }) => lineNetto(item) * (itemVatRate(item) / 100);
      const netto = items.reduce((sum, item) => sum + lineNetto(item), 0);
      const moms = items.reduce((sum, item) => sum + lineMoms(item), 0);
      const total = Math.round(netto + moms);
      const hasRut = items.some((item) => item.deduction_type === "rut");
      const hasRot = items.some((item) => item.deduction_type === "rot");
      const baseFor = (type: string) => items.reduce((sum, item) => sum + (item.deduction_type === type ? lineNetto(item) + lineMoms(item) : 0), 0);
      const rutAmount = baseFor("rut") * (toNumber(c.rut_rate) / 100);
      const rotAmount = baseFor("rot") * (toNumber(c.rot_rate) / 100);
      const amountToPay = total - rutAmount - rotAmount;

      const badges: string[] = [];
      if (hasRut) badges.push(`Rutavdrag ${toNumber(c.rut_rate)}%`);
      if (hasRot) badges.push(`Rotavdrag ${toNumber(c.rot_rate)}%`);
      const lines: TextLine[] = [{
        text: `Prisform: ${c.price_form === "recurring" ? "Löpande räkning" : "Fast pris"}` + (badges.length ? `   ${badges.join("   ")}` : ""),
        font: "F2", size: 10, gapAfter: 3,
      }];
      for (const item of items) {
        const marker = item.deduction_type === "rut" ? " (RUT)" : item.deduction_type === "rot" ? " (ROT)" : "";
        lines.push({ text: `${text(item.description)}${marker}   ${text(item.quantity)} x ${text(item.unit_price)} kr (moms ${itemVatRate(item)}%)`, font: "F1", size: 9 });
      }
      lines.push({ text: `Netto: ${netto.toFixed(2)} kr   Moms: ${moms.toFixed(2)} kr   Total inkl. moms: ${total.toFixed(2)} kr`, font: "F2", size: 9, gapAfter: hasRut || hasRot ? 2 : 4 });
      const pnr = text(c.deduction_personal_number);
      if (hasRut) lines.push({ text: `Rutavdrag${pnr ? ` (${pnr})` : ""}: -${rutAmount.toFixed(2)} kr`, font: "F2", size: 9 });
      if (hasRot) lines.push({ text: `Rotavdrag${pnr ? ` (${pnr})` : ""}: -${rotAmount.toFixed(2)} kr`, font: "F2", size: 9 });
      if (hasRut || hasRot) lines.push({ text: `Att betala: ${amountToPay.toFixed(2)} kr`, font: "F2", size: 9, gapAfter: 4 });
      return lines;
    }
    case "table": {
      const headers: string[] = Array.isArray(c.headers) ? c.headers.map(text) : [];
      const rows: string[][] = Array.isArray(c.rows) ? c.rows : [];
      const lines: TextLine[] = [];
      if (headers.length) lines.push({ text: headers.join("   |   "), font: "F2", size: 9, gapAfter: 2 });
      for (const row of rows) lines.push({ text: (Array.isArray(row) ? row : []).map(text).join("   |   "), font: "F1", size: 9 });
      lines.push({ text: "", font: "F1", size: 9, gapAfter: 4 });
      return lines;
    }
    case "bullet_list": {
      const items: string[] = Array.isArray(c.items) ? c.items.map(text) : [];
      const lines: TextLine[] = items.flatMap((item) => wrapLine(`• ${item}`, charsForSize(10)).map((t) => ({ text: t, font: "F1" as const, size: 10 })));
      lines.push({ text: "", font: "F1", size: 10, gapAfter: 4 });
      return lines;
    }
    case "checklist": {
      const items: { text?: string; checked?: boolean }[] = Array.isArray(c.items) ? c.items : [];
      const lines: TextLine[] = items.flatMap((item) => wrapLine(`${item.checked ? "[x]" : "[ ]"} ${text(item.text)}`, charsForSize(10)).map((t) => ({ text: t, font: "F1" as const, size: 10 })));
      lines.push({ text: "", font: "F1", size: 10, gapAfter: 4 });
      return lines;
    }
    case "divider":
      // A plain hyphen rule, not a Unicode box-drawing character -- the
      // latter has no WinAnsiEncoding glyph and would render as a row of
      // literal "?" in a real PDF viewer (found by actually rendering a
      // test PDF and checking it with pypdf, not by typecheck -- see
      // winAnsiByte's comment).
      return [{ text: "-".repeat(70), font: "F1", size: 8, gapAfter: 6 }];
    case "terms": {
      const lines: TextLine[] = [];
      if (c.title) lines.push({ text: text(c.title), font: "F2", size: 11, gapAfter: 3 });
      lines.push(...wrapLine(text(c.text), charsForSize(10)).map((t) => ({ text: t, font: "F1" as const, size: 10 })));
      lines.push({ text: "", font: "F1", size: 10, gapAfter: 4 });
      return lines;
    }
    case "signature_block":
      // Real signature evidence lives in the dedicated section this
      // module appends at the end (see buildAgreementPdf) -- an inline
      // marker here is just a visual placeholder for where the author put
      // it in the block editor, not a second source of truth.
      return [{ text: "— Signatur (se signatursidan) —", font: "F1", size: 9, gapAfter: 6 }];
    case "attachment_ref":
      return [{ text: `Bilaga: ${text(c.label) || "Se bilaga"}`, font: "F1", size: 10, gapAfter: 3 }];
    case "fillable_text":
      return [{ text: `${text(c.label) || "Fyll i"}: ${text(c.placeholder)}`, font: "F1", size: 10, gapAfter: 3 }];
    case "checkbox_consent":
      return [{ text: `[ ] ${text(c.text)}`, font: "F1", size: 10, gapAfter: 3 }];
    case "page_break":
      return [];
    default:
      return [];
  }
}

function paginateTextLines(lines: TextLine[]): Page[] {
  const pages: Page[] = [];
  let current: TextLine[] = [];
  let y = TOP_Y;
  const lineHeight = (size: number) => size * 1.4;

  const flush = () => {
    if (current.length > 0) pages.push({ kind: "text", lines: current });
    current = [];
    y = TOP_Y;
  };

  for (const line of lines) {
    const h = lineHeight(line.size) + (line.gapAfter || 0);
    if (y - h < BOTTOM_Y) flush();
    current.push(line);
    y -= h;
  }
  flush();
  return pages;
}

function partyLine(parties: { display_name: string; party_type: string }[], index: number): TextLine[] {
  const party = parties[index];
  if (!party) return [{ text: "(part ej vald)", font: "F1", size: 10, gapAfter: 3 }];
  return [{ text: `Part: ${party.display_name}`, font: "F2", size: 10, gapAfter: 3 }];
}

function buildTextLinesFromBlocks(blocks: AgreementBlock[], parties: { display_name: string; party_type: string }[]): TextLine[][] {
  // Returns one text-line-group per "text run" -- split at page_break
  // blocks so those always start a fresh page.
  const groups: TextLine[][] = [[]];
  for (const block of blocks) {
    if (block.block_type === "page_break") {
      groups.push([]);
      continue;
    }
    const lines = block.block_type === "party" ? partyLine(parties, Number((block.content || {}).party_index) || 0) : blockToLines(block);
    groups[groups.length - 1].push(...lines);
  }
  return groups.filter((g) => g.length > 0);
}

function pdfObjectBytes(id: number, body: Uint8Array): Uint8Array {
  return concatBytes([ascii(`${id} 0 obj\n`), body, ascii("\nendobj\n")]);
}

class PdfDocument {
  private objects: Uint8Array[] = [];

  reserve(): number {
    this.objects.push(new Uint8Array());
    return this.objects.length;
  }

  set(id: number, body: Uint8Array) {
    this.objects[id - 1] = pdfObjectBytes(id, body);
  }

  add(body: Uint8Array): number {
    const id = this.reserve();
    this.set(id, body);
    return id;
  }

  finalize(catalogId: number): Uint8Array {
    const chunks: Uint8Array[] = [ascii("%PDF-1.4\n")];
    const offsets: number[] = [0];
    let length = chunks[0].length;
    for (const obj of this.objects) {
      offsets.push(length);
      chunks.push(obj);
      length += obj.length;
    }
    const body = concatBytes(chunks);
    const xrefOffset = body.length;
    const xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n${
      offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
    }trailer\n<< /Size ${this.objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return concatBytes([body, ascii(xref)]);
  }
}

/** Deflate-compresses raw bytes for a PDF FlateDecode stream (Deno's
 * CompressionStream("deflate") produces zlib-wrapped output, exactly what
 * PDF's /Filter /FlateDecode expects). */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const writePromise = writer.write(data).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  // deno-lint-ignore no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  await writePromise;
  return concatBytes(chunks);
}

export async function buildAgreementPdf(input: AgreementPdfInput): Promise<Uint8Array> {
  const doc = new PdfDocument();
  const catalogId = doc.reserve();
  const pagesId = doc.reserve();
  const fontRegularId = doc.add(ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  const fontBoldId = doc.add(ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));

  // ---- Build page plan --------------------------------------------------
  const headerLines: TextLine[] = [
    { text: input.organisationName, font: "F2", size: 11, gapAfter: 2 },
    { text: input.title || input.documentNumber, font: "F2", size: 16, gapAfter: 2 },
    { text: `Dokumentnummer: ${input.documentNumber}`, font: "F1", size: 9, gapAfter: 10 },
  ];

  const contentGroups = buildTextLinesFromBlocks(input.blocks, input.parties);
  const pages: Page[] = [];
  contentGroups.forEach((group, i) => {
    const withHeader = i === 0 ? [...headerLines, ...group] : group;
    pages.push(...paginateTextLines(withHeader));
  });
  if (pages.length === 0) pages.push({ kind: "text", lines: headerLines });

  // ---- Signatures & verification section --------------------------------
  const sigIntro: TextLine[] = [
    { text: "Signaturer och verifiering", font: "F2", size: 15, gapAfter: 8 },
    { text: `Dokumentet slutfördes: ${new Date(input.completedAt).toLocaleString("sv-SE")}`, font: "F1", size: 9, gapAfter: 3 },
    { text: `Innehålls-ID (SHA-256): ${input.contentHash}`, font: "F1", size: 8, gapAfter: 10 },
  ];
  const signatureImagePages: { name: string; roleTitle: string; signedAt: string; png: DecodedPng }[] = [];

  for (const sig of input.signatures) {
    sigIntro.push({ text: `${sig.name}${sig.roleTitle ? ` (${sig.roleTitle})` : ""}`, font: "F2", size: 11, gapAfter: 2 });
    sigIntro.push({ text: `Signerat: ${new Date(sig.signedAt).toLocaleString("sv-SE")}`, font: "F1", size: 9, gapAfter: 2 });
    if (sig.method === "handwritten") {
      sigIntro.push({ text: "Metod: handskriven elektronisk signatur (se signatursida nedan)", font: "F1", size: 9, gapAfter: 8 });
      if (sig.signatureImageDataUrl) {
        try {
          const png = await decodePngDataUrl(sig.signatureImageDataUrl);
          signatureImagePages.push({ name: sig.name, roleTitle: sig.roleTitle, signedAt: sig.signedAt, png });
        } catch (err) {
          sigIntro.push({ text: `(Signaturbilden kunde inte bäddas in: ${err instanceof Error ? err.message : String(err)})`, font: "F1", size: 8, gapAfter: 6 });
        }
      }
    } else {
      const maskedPno = sig.bankidPersonalNumber ? maskPersonalNumber(sig.bankidPersonalNumber) : "";
      sigIntro.push({ text: "Metod: BankID", font: "F1", size: 9, gapAfter: 2 });
      if (maskedPno) sigIntro.push({ text: `Personnummer: ${maskedPno}`, font: "F1", size: 9, gapAfter: 2 });
      if (sig.bankidReference) sigIntro.push({ text: `BankID-referens: ${sig.bankidReference}`, font: "F1", size: 8, gapAfter: 2 });
      if (input.verificationUrl) {
        sigIntro.push({ text: "Verifiera denna signatur:", font: "F1", size: 9, gapAfter: 1 });
        sigIntro.push({ text: input.verificationUrl, font: "F1", size: 8, gapAfter: 8 });
      } else {
        sigIntro.push({ text: "", font: "F1", size: 9, gapAfter: 8 });
      }
    }
  }
  if (input.verificationUrl) {
    sigIntro.push({ text: "Verifiera hela dokumentet:", font: "F1", size: 9, gapAfter: 1 });
    sigIntro.push({ text: input.verificationUrl, font: "F1", size: 8, gapAfter: 4 });
  }
  pages.push(...paginateTextLines(sigIntro));
  for (const s of signatureImagePages) {
    pages.push({ kind: "image", png: s.png, caption: `${s.name}${s.roleTitle ? ` (${s.roleTitle})` : ""} — ${new Date(s.signedAt).toLocaleString("sv-SE")}` });
  }

  // ---- Emit pages ---------------------------------------------------------
  const pageIds: number[] = [];
  for (const page of pages) {
    if (page.kind === "text") {
      let y = TOP_Y;
      const commands: string[] = ["BT"];
      for (const line of page.lines) {
        const h = line.size * 1.4 + (line.gapAfter || 0);
        commands.push(`/${line.font} ${line.size} Tf`, `1 0 0 1 ${MARGIN} ${Math.round(y)} Tm`, `${escapePdfText(line.text)} Tj`);
        y -= h;
      }
      commands.push("ET");
      const stream = commands.join("\n");
      const contentId = doc.add(ascii(`<< /Length ${ascii(stream).length} >>\nstream\n${stream}\nendstream`));
      const pageId = doc.add(ascii(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`));
      pageIds.push(pageId);
    } else {
      const compressed = await deflate(page.png.rgb);
      const maxW = PAGE_WIDTH - MARGIN * 2;
      const maxH = PAGE_HEIGHT - MARGIN * 2 - 30;
      const scale = Math.min(1, maxW / page.png.width, maxH / page.png.height);
      const drawW = Math.max(1, Math.round(page.png.width * scale));
      const drawH = Math.max(1, Math.round(page.png.height * scale));
      const x = Math.round((PAGE_WIDTH - drawW) / 2);
      const y = Math.round((PAGE_HEIGHT - drawH) / 2) + 20;
      const imageId = doc.add(concatBytes([
        ascii(`<< /Type /XObject /Subtype /Image /Width ${page.png.width} /Height ${page.png.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),
        compressed,
        ascii("\nendstream"),
      ]));
      const captionCmd = `BT\n/F1 9 Tf\n1 0 0 1 ${MARGIN} ${y - drawH - 20} Tm\n${escapePdfText(page.caption)} Tj\nET`;
      const stream = `q\n${drawW} 0 0 ${drawH} ${x} ${y} cm\n/Im${imageId} Do\nQ\n${captionCmd}`;
      const contentId = doc.add(ascii(`<< /Length ${ascii(stream).length} >>\nstream\n${stream}\nendstream`));
      const pageId = doc.add(ascii(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R >> /XObject << /Im${imageId} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
      pageIds.push(pageId);
    }
  }

  doc.set(catalogId, ascii(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
  doc.set(pagesId, ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`));

  return doc.finalize(catalogId);
}

function maskPersonalNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "•".repeat(Math.max(0, digits.length));
  return `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
