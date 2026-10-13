// Certifikat-PDF (A4 liggande) utan externt bibliotek: standardtypsnitt (Helvetica, WinAnsi), JPEG-logotyp (DCT), vektor-QR.
// Layouten styrs av certifikatmallen (titel, brödtext, färg, signatur, sidfot). Inget i dokumentet påstår extern certifiering.
import QRCode from "npm:qrcode@1.5.4";

const W = 842, H = 595;
const HELV: Record<string, number> = {" ":278,"!":278,'"':355,"#":556,"$":556,"%":889,"&":667,"'":191,"(":333,")":333,"*":389,"+":584,",":278,"-":333,".":278,"/":278,":":278,";":278,"<":584,"=":584,">":584,"?":556,"@":1015,
  A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,"[":278,"\\":278,"]":278,_:556,
  a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500};
const BOLD: Record<string, number> = {...HELV, A:722,B:722,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:556,K:722,L:611,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,
  a:556,b:611,c:556,d:611,e:556,f:333,g:611,h:611,i:278,j:278,k:556,l:278,m:889,n:611,o:611,p:611,q:611,r:389,s:556,t:333,u:611,v:556,w:778,x:556,y:556,z:500,":":333};
const CP1252: Record<string, number> = { "–": 0x96, "—": 0x97, "€": 0x80, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85 };
const code = (ch: string) => CP1252[ch] ?? (ch.charCodeAt(0) <= 255 ? ch.charCodeAt(0) : 63);
export const hex = (s: string) => "<" + [...s].map((c) => code(c).toString(16).padStart(2, "0")).join("") + ">";
export const width = (s: string, size: number, bold: boolean) => [...s].reduce((sum, c) => sum + ((bold ? BOLD : HELV)[c] ?? 556), 0) * size / 1000;
export const fmt = (n: number) => n.toFixed(2);
function colour(hexColour: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hexColour || ""); const v = m ? parseInt(m[1], 16) : 0x0b6b4c;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function wrap(textValue: string, size: number, bold: boolean, maxWidth: number): string[] {
  const words = textValue.split(/\s+/).filter(Boolean); const lines: string[] = []; let line = "";
  for (const w of words) { const next = line ? `${line} ${w}` : w; if (width(next, size, bold) > maxWidth && line) { lines.push(line); line = w; } else line = next; }
  if (line) lines.push(line); return lines;
}

export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1]; const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    i += 2 + len;
  }
  return null;
}

export interface CertificatePdfInput {
  title: string; bodyText: string; footerText: string; accent: string; signerName: string; signerTitle: string;
  holderName: string; courseTitle: string; courseCode: string; certificateNumber: string; verificationUrl: string; issuerName: string;
  completedOn: string; validUntil: string | null; issuedAt: string; resultText: string; kind: "training_certificate" | "competence_proof";
  id06Reference?: string | null; logoJpeg?: Uint8Array | null; footerLogos?: Uint8Array[]; statusNote?: string;
}

export async function renderCertificatePdf(c: CertificatePdfInput): Promise<Uint8Array> {
  const [r, g, b] = colour(c.accent);
  const ops: string[] = [];
  const text = (s: string, x: number, y: number, size: number, bold = false, align: "left" | "center" | "right" = "left", rgb?: [number, number, number]) => {
    const w = width(s, size, bold); const px = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${(rgb ?? [0.1, 0.12, 0.14]).map(fmt).join(" ")} rg ${fmt(px)} ${fmt(y)} Td ${hex(s)} Tj ET`);
  };
  // ram
  ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG 3 w 28 28 ${W - 56} ${H - 56} re S`, `${fmt(r)} ${fmt(g)} ${fmt(b)} RG 0.8 w 36 36 ${W - 72} ${H - 72} re S`);
  ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg 28 ${H - 44} ${W - 56} 16 re f`);
  // logotyp
  let imageDims: { w: number; h: number } | null = null;
  if (c.logoJpeg) { const info = jpegInfo(c.logoJpeg); if (info && info.components !== 4) { const hMax = 54; const wMax = 170; const scale = Math.min(wMax / info.width, hMax / info.height); imageDims = { w: info.width * scale, h: info.height * scale }; ops.push(`q ${fmt(imageDims.w)} 0 0 ${fmt(imageDims.h)} 60 ${fmt(H - 70 - imageDims.h)} cm /Im1 Do Q`); } }
  text(c.kind === "competence_proof" ? "KOMPETENSBEVIS" : "UTBILDNINGSINTYG", W - 60, H - 90, 11, true, "right", [r, g, b]);
  text(c.title, W / 2, H - 150, 34, true, "center", [r, g, b]);
  text("Härmed intygas att", W / 2, H - 185, 13, false, "center", [0.35, 0.38, 0.4]);
  text(c.holderName, W / 2, H - 228, 32, true, "center");
  ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG 1 w ${W / 2 - 150} ${H - 238} m ${W / 2 + 150} ${H - 238} l S`);
  let y = H - 268;
  for (const line of wrap(c.bodyText, 13, false, 560)) { text(line, W / 2, y, 13, false, "center", [0.25, 0.28, 0.3]); y -= 18; }
  y -= 8;
  for (const line of wrap(c.courseTitle, 24, true, 640)) { text(line, W / 2, y, 24, true, "center"); y -= 30; }
  text(`Kurskod ${c.courseCode}`, W / 2, y - 2, 11, false, "center", [0.4, 0.43, 0.45]);
  // faktarad
  const baseY = 150;
  const facts: Array<[string, string]> = [["Genomförd", c.completedOn], ["Giltigt till", c.validUntil || "Obegränsat"], ["Resultat", c.resultText || "Godkänd"], ["Intygsnummer", c.certificateNumber]];
  const colW = 150, startX = 60;
  facts.forEach(([k, v], i) => { const x = startX + i * colW; text(k.toUpperCase(), x, baseY + 22, 8, true, "left", [0.45, 0.48, 0.5]); text(v, x, baseY + 6, 11, true); });
  if (c.id06Reference) text(`Registrerad i ID06 Kompetensdatabas (referens ${c.id06Reference})`, startX, baseY - 18, 9, false, "left", [0.25, 0.28, 0.3]);
  if (c.statusNote) text(c.statusNote, startX, baseY - 34, 9, true, "left", [0.7, 0.1, 0.1]);
  // signatur
  ops.push(`0.4 0.4 0.4 RG 0.6 w 60 104 m 260 104 l S`);
  text(c.signerName || c.issuerName, 60, 90, 10, true); if (c.signerTitle) text(c.signerTitle, 60, 77, 9, false, "left", [0.4, 0.43, 0.45]);
  text(`Utfärdat ${c.issuedAt}`, 60, 60, 9, false, "left", [0.4, 0.43, 0.45]);
  // Logotyper i fotraden bredvid varandra (t.ex. Kompetensportalen + ID06), centrerade mellan signatur och QR
  const footerImgs: Array<{ bytes: Uint8Array; info: { width: number; height: number; components: number }; w: number; h: number; x: number }> = [];
  { const list = (c.footerLogos ?? []).map((bytes) => ({ bytes, info: jpegInfo(bytes) })).filter((x): x is { bytes: Uint8Array; info: { width: number; height: number; components: number } } => !!x.info && x.info.components !== 4);
    const hTarget = 40, gap = 26; const sized = list.map((x) => { const sc = Math.min(hTarget / x.info.height, 200 / x.info.width); return { ...x, w: x.info.width * sc, h: x.info.height * sc }; });
    const total = sized.reduce((t, x) => t + x.w, 0) + gap * Math.max(0, sized.length - 1); let cx = W / 2 + 40 - total / 2;
    for (const x of sized) { footerImgs.push({ ...x, x: cx }); cx += x.w + gap; } }
  footerImgs.forEach((im, i) => ops.push(`q ${fmt(im.w)} 0 0 ${fmt(im.h)} ${fmt(im.x)} ${fmt(96 - im.h / 2)} cm /Fl${i + 1} Do Q`));
  // QR (vektor)
  const qr = QRCode.create(c.verificationUrl, { errorCorrectionLevel: "M" }); const n = qr.modules.size; const cell = 3.1; const qrSize = n * cell; const qx = W - 60 - qrSize, qy = 66;
  ops.push("0 0 0 rg");
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (qr.modules.data[row * n + col]) ops.push(`${fmt(qx + col * cell)} ${fmt(qy + (n - 1 - row) * cell)} ${fmt(cell)} ${fmt(cell)} re f`);
  text("Verifiera intyget", qx + qrSize / 2, qy + qrSize + 8, 8, true, "center", [0.3, 0.33, 0.35]);
  text(c.verificationUrl.replace(/^https?:\/\//, ""), qx + qrSize / 2, qy - 10, 6.5, false, "center", [0.4, 0.43, 0.45]);
  const footer = c.footerText || (c.kind === "competence_proof" ? "Kompetensbeviset är inte en myndighetscertifiering." : "");
  let fy = 50; for (const line of wrap(footer, 8, false, 520)) { text(line, W / 2 - 80, fy, 8, false, "center", [0.4, 0.43, 0.45]); fy -= 10; }

  // PDF-objekt
  const objs: Array<string | Uint8Array> = [];
  const add = (o: string | Uint8Array) => { objs.push(o); return objs.length; };
  const content = ops.join("\n");
  const catalog = add(""), pages = add(""), page = add(""), f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let imgObj = 0;
  if (imageDims && c.logoJpeg) {
    const info = jpegInfo(c.logoJpeg)!;
    const head = new TextEncoder().encode(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${c.logoJpeg.length} >>\nstream\n`);
    const tail = new TextEncoder().encode("\nendstream");
    const all = new Uint8Array(head.length + c.logoJpeg.length + tail.length); all.set(head); all.set(c.logoJpeg, head.length); all.set(tail, head.length + c.logoJpeg.length);
    imgObj = add(all);
  }
  const flObjs: number[] = [];
  for (const im of footerImgs) {
    const headF = new TextEncoder().encode(`<< /Type /XObject /Subtype /Image /Width ${im.info.width} /Height ${im.info.height} /ColorSpace /${im.info.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
    const tailF = new TextEncoder().encode("\nendstream");
    const allF = new Uint8Array(headF.length + im.bytes.length + tailF.length); allF.set(headF); allF.set(im.bytes, headF.length); allF.set(tailF, headF.length + im.bytes.length);
    flObjs.push(add(allF));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;
  objs[page - 1] = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${stream} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${imgObj || flObjs.length ? ` /XObject << ${imgObj ? `/Im1 ${imgObj} 0 R ` : ""}${flObjs.map((o, i) => `/Fl${i + 1} ${o} 0 R `).join("")}>>` : ""} >> >>`;
  const chunks: Uint8Array[] = []; const enc = new TextEncoder(); const offsets: number[] = []; let pos = 0;
  const push = (d: Uint8Array) => { chunks.push(d); pos += d.length; };
  push(enc.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  objs.forEach((o, i) => { offsets.push(pos); push(enc.encode(`${i + 1} 0 obj\n`)); push(typeof o === "string" ? enc.encode(o) : o); push(enc.encode("\nendobj\n")); });
  const xref = pos; let xr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; for (const off of offsets) xr += `${String(off).padStart(10, "0")} 00000 n \n`;
  push(enc.encode(`${xr}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`));
  const out = new Uint8Array(pos); let o2 = 0; for (const ch of chunks) { out.set(ch, o2); o2 += ch.length; } return out;
}
