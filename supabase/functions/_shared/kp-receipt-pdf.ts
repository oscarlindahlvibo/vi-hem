// Kvitto / kreditkvitto som PDF (A4 stående) utan externt bibliotek – samma teknik som certifikat-PDF:en.
import { fmt, hex, jpegInfo, width, wrap } from "./kp-certificate-pdf.ts";

export interface ReceiptPdfInput {
  kind: "receipt" | "credit_receipt"; receiptNumber: string; issuedAt: string; orderNumber: string; currency: string;
  seller: { name?: string; org_number?: string; vat_number?: string; address?: string; email?: string; phone?: string };
  buyerName: string; buyerEmail: string; buyerOrgNumber?: string; billingAddress?: string;
  lines: Array<{ description: string; quantity: number; unit_price: number; discount?: number; net_total: number; vat_rate: number; vat_amount: number; line_total: number }>;
  netTotal: number; vatTotal: number; total: number; paymentMethod: string; paymentReference?: string | null; logoJpeg?: Uint8Array | null;
}
const W = 595, H = 842;
const kr = (n: number) => new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/ /g, " ").replace(/−/g, "-");

export function renderReceiptPdf(r: ReceiptPdfInput): Uint8Array {
  const ops: string[] = []; const sign = r.kind === "credit_receipt" ? -1 : 1;
  const text = (s: string, x: number, y: number, size: number, bold = false, align: "left" | "right" = "left", rgb: [number, number, number] = [0.1, 0.12, 0.14]) => {
    const w = width(s, size, bold); const px = align === "right" ? x - w : x;
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb.map(fmt).join(" ")} rg ${fmt(px)} ${fmt(y)} Td ${hex(s)} Tj ET`);
  };
  const line = (x1: number, y: number, x2: number, g = 0.8) => ops.push(`${g} ${g} ${g} RG 0.6 w ${fmt(x1)} ${fmt(y)} m ${fmt(x2)} ${fmt(y)} l S`);
  const grey: [number, number, number] = [0.4, 0.43, 0.45];
  let imgDims: { w: number; h: number } | null = null;
  if (r.logoJpeg) { const info = jpegInfo(r.logoJpeg); if (info && info.components !== 4) { const sc = Math.min(150 / info.width, 46 / info.height); imgDims = { w: info.width * sc, h: info.height * sc }; ops.push(`q ${fmt(imgDims.w)} 0 0 ${fmt(imgDims.h)} 48 ${fmt(H - 48 - imgDims.h)} cm /Im1 Do Q`); } }
  text(r.kind === "credit_receipt" ? "KREDITKVITTO" : "KVITTO", W - 48, H - 62, 20, true, "right", [0.18, 0.36, 0.48]);
  text(`Nr ${r.receiptNumber}`, W - 48, H - 80, 10, true, "right"); text(`Datum ${r.issuedAt}`, W - 48, H - 94, 10, false, "right", grey); text(`Order ${r.orderNumber}`, W - 48, H - 108, 10, false, "right", grey);
  // parter
  let y = H - 150;
  text("SÄLJARE", 48, y, 8, true, "left", grey); text("KÖPARE", 320, y, 8, true, "left", grey); y -= 14;
  const seller = [r.seller.name, r.seller.address, r.seller.org_number ? `Org.nr ${r.seller.org_number}` : "", r.seller.vat_number ? `Momsreg.nr ${r.seller.vat_number}` : "", r.seller.email, r.seller.phone].filter(Boolean) as string[];
  const buyer = [r.buyerName, r.buyerOrgNumber ? `Org.nr ${r.buyerOrgNumber}` : "", r.billingAddress, r.buyerEmail].filter(Boolean) as string[];
  const rows = Math.max(seller.length, buyer.length);
  for (let i = 0; i < rows; i++) { if (seller[i]) text(seller[i], 48, y - i * 13, 10, i === 0); if (buyer[i]) text(buyer[i], 320, y - i * 13, 10, i === 0); }
  y -= rows * 13 + 22;
  // rader
  const cols = { desc: 48, qty: 330, unit: 395, vat: 440, total: W - 48 };
  text("BESKRIVNING", cols.desc, y, 8, true, "left", grey); text("ANTAL", cols.qty, y, 8, true, "right", grey); text("À-PRIS", cols.unit + 30, y, 8, true, "right", grey); text("MOMS", cols.vat + 25, y, 8, true, "right", grey); text("BELOPP", cols.total, y, 8, true, "right", grey);
  y -= 6; line(48, y, W - 48, 0.6); y -= 14;
  for (const l of r.lines) {
    const desc = wrap(l.description, 10, false, 270);
    text(desc[0] ?? "", cols.desc, y, 10); text(String(l.quantity), cols.qty, y, 10, false, "right"); text(kr(sign * l.unit_price), cols.unit + 30, y, 10, false, "right"); text(`${Number(l.vat_rate)} %`, cols.vat + 25, y, 10, false, "right"); text(kr(sign * l.net_total), cols.total, y, 10, false, "right");
    for (const extra of desc.slice(1)) { y -= 12; text(extra, cols.desc, y, 10); }
    if (l.discount && Number(l.discount) > 0) { y -= 12; text(`Rabatt ${kr(l.discount)}`, cols.desc, y, 8, false, "left", grey); }
    y -= 18;
  }
  line(48, y + 6, W - 48, 0.6); y -= 10;
  const sum = (label: string, value: string, bold = false) => { text(label, 380, y, bold ? 11 : 10, bold, "right"); text(value, W - 48, y, bold ? 11 : 10, bold, "right"); y -= bold ? 18 : 14; };
  sum("Summa exkl. moms", `${kr(sign * r.netTotal)} ${r.currency}`); sum("Moms", `${kr(sign * r.vatTotal)} ${r.currency}`); line(300, y + 8, W - 48, 0.5); y -= 4; sum(r.kind === "credit_receipt" ? "Återbetalat" : "Betalt", `${kr(sign * r.total)} ${r.currency}`, true);
  y -= 14;
  const method = r.paymentMethod === "stripe" ? "Kortbetalning (Stripe)" : r.paymentMethod;
  text(`Betalningssätt: ${method}`, 48, y, 9, false, "left", grey); y -= 12;
  if (r.paymentReference) { text(`Betalningsreferens: ${r.paymentReference}`, 48, y, 9, false, "left", grey); y -= 12; }
  text(r.kind === "credit_receipt" ? "Beloppet har återbetalats till det kort som användes vid köpet." : "Betalningen är genomförd. Detta kvitto är ett bevis på köpet.", 48, y, 9, false, "left", grey);
  text(`${r.seller.name ?? ""}${r.seller.org_number ? ` · Org.nr ${r.seller.org_number}` : ""}${r.seller.vat_number ? ` · ${r.seller.vat_number}` : ""}`, W / 2 + 0, 36, 8, false, "right", [0.5, 0.52, 0.54]);

  const objs: Array<string | Uint8Array> = []; const add = (o: string | Uint8Array) => { objs.push(o); return objs.length; };
  const catalog = add(""), pages = add(""), page = add(""), f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const content = ops.join("\n"); const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let img = 0;
  if (imgDims && r.logoJpeg) { const info = jpegInfo(r.logoJpeg)!; const head = new TextEncoder().encode(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${r.logoJpeg.length} >>\nstream\n`); const tail = new TextEncoder().encode("\nendstream"); const all = new Uint8Array(head.length + r.logoJpeg.length + tail.length); all.set(head); all.set(r.logoJpeg, head.length); all.set(tail, head.length + r.logoJpeg.length); img = add(all); }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`; objs[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;
  objs[page - 1] = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${stream} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${img ? ` /XObject << /Im1 ${img} 0 R >>` : ""} >> >>`;
  const chunks: Uint8Array[] = []; const enc = new TextEncoder(); const offsets: number[] = []; let pos = 0; const push = (d: Uint8Array) => { chunks.push(d); pos += d.length; };
  push(enc.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  objs.forEach((o, i) => { offsets.push(pos); push(enc.encode(`${i + 1} 0 obj\n`)); push(typeof o === "string" ? enc.encode(o) : o); push(enc.encode("\nendobj\n")); });
  const xref = pos; let xr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; for (const off of offsets) xr += `${String(off).padStart(10, "0")} 00000 n \n`;
  push(enc.encode(`${xr}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`));
  const out = new Uint8Array(pos); let o2 = 0; for (const ch of chunks) { out.set(ch, o2); o2 += ch.length; } return out;
}
