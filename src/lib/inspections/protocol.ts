import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export type ProtocolInput = {
  id: string; version: string; organisation: string; address: string; apartment: string;
  type: string; date: string; inspector: string; tenant?: string; tenantPresent: boolean;
  condition: string; notes: string; action: string;
  rooms: { name: string; condition: string; notes: string; reviewed?: boolean; photos: string[] }[];
  photos: string[];
};
// Isolated document layout; no changes to agreements, invoices or signed documents.
export async function inspectionProtocol(input: ProtocolInput, loadImage: (reference: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(.08, .16, .28), muted = rgb(.35, .42, .5), line = rgb(.87, .9, .93);
  const width = 595.28, height = 841.89, margin = 44, contentWidth = width - margin * 2;
  let page = pdf.addPage([width, height]), y = height - 72;
  const pages = [page];
  const next = () => { page = pdf.addPage([width, height]); pages.push(page); y = height - 72; };
  const space = (amount: number) => { if (y - amount < 65) next(); };
  function text(value: string, size = 11, strong = false) {
    const font = strong ? bold : regular;
    // Standard embedded font supports Swedish. Reject unsupported characters rather than losing them.
    try { font.encodeText(value); } catch { throw Error('Protokollet innehåller tecken som PDF-typsnittet inte stöder. Utkastet är sparat; protokollet är inte färdigställt.'); }
    for (const paragraph of value.split('\n')) {
      let current = '';
      const flush = () => { space(size * 1.5); page.drawText(current, { x: margin, y, font, size, color: strong ? navy : muted }); y -= size * 1.5; current = ''; };
      for (const word of paragraph.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= contentWidth) { current = candidate; continue; }
        if (current) flush();
        for (const character of word) {
          if (font.widthOfTextAtSize(current + character, size) > contentWidth) flush();
          current += character;
        }
      }
      space(size * 1.5); page.drawText(current, { x: margin, y, font, size, color: strong ? navy : muted }); y -= size * 1.5;
    }
  }
  function heading(value: string) { space(65); y -= 14; text(value, 16, true); y -= 6; }
  async function photos(references: string[], label: string) {
    for (let i = 0; i < references.length; i++) {
      const bytes = await loadImage(references[i]);
      let image;
      try { image = bytes[0] === 0xff ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes); }
      catch { throw Error('En bild kunde inte tas med i protokollet. Kontrollera bilden och försök igen.'); }
      const ratio = Math.min(contentWidth / image.width, 275 / image.height, 1);
      const imageWidth = image.width * ratio, imageHeight = image.height * ratio;
      space(imageHeight + 48);
      page.drawRectangle({ x: margin, y: y - imageHeight - 8, width: contentWidth, height: imageHeight + 16, color: rgb(.96, .97, .98) });
      page.drawImage(image, { x: margin + (contentWidth - imageWidth) / 2, y: y - imageHeight, width: imageWidth, height: imageHeight });
      y -= imageHeight + 25; text(`${label} · Bild ${i + 1}`, 10); y -= 8;
    }
  }
  text('BESIKTNINGSPROTOKOLL', 23, true); y -= 14;
  text(input.address, 16, true); if (input.apartment) text(`Lägenhet ${input.apartment}`, 12); y -= 12;
  text(`${input.type} · ${input.date}`, 12, true);
  text(`Besiktningsperson: ${input.inspector || 'Ej angiven'}`);
  if (input.tenant) text(`Hyresgäst: ${input.tenant}`);
  text(`Hyresgäst närvarande: ${input.tenantPresent ? 'Ja' : 'Nej'}`);
  heading('Sammanfattning');
  text(`${input.rooms.filter(room => room.reviewed).length} av ${input.rooms.length} rum markerade som genomgångna`);
  text(`Övergripande skick: ${input.condition}`);
  text(`Rum med dåligt skick: ${input.rooms.filter(room => room.condition === 'Dålig').length}`);
  if (input.action) { heading('Åtgärder'); text(input.action); }
  for (const room of input.rooms) {
    heading(room.name || 'Rum'); text(`Skick: ${room.condition}`, 11, true);
    if (!room.reviewed) text('Ej markerat som genomgånget');
    if (room.notes) text(room.notes);
    await photos(room.photos, room.name || 'Rum');
  }
  if (input.notes) { heading('Övriga anteckningar'); text(input.notes); }
  if (input.photos.length) { heading('Allmänna fotografier'); await photos(input.photos, 'Allmän bild'); }
  pages.forEach((sheet, index) => {
    sheet.drawText(input.organisation || 'VI-HEM', { x: margin, y: height - 32, size: 10, font: bold, color: navy });
    sheet.drawLine({ start: { x: margin, y: 48 }, end: { x: width - margin, y: 48 }, thickness: .5, color: line });
    sheet.drawText(`${input.id.slice(0, 8)} · Version ${input.version.slice(0, 8)} · ${input.date}`, { x: margin, y: 32, size: 9, font: regular, color: muted });
    sheet.drawText(`${index + 1} / ${pages.length}`, { x: width - margin - 32, y: 32, size: 9, font: regular, color: muted });
  });
  pdf.setTitle(`Besiktningsprotokoll – ${input.address}`); pdf.setAuthor(input.organisation || 'VI-HEM');
  return pdf.save();
}
