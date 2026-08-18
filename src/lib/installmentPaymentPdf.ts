type PaymentPdfInput = {
  organisationName: string;
  planNumber: string;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
  method: string;
  reference: string;
  customerName: string;
};

function safe(value: string) {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^\x20-\xFF]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function text(value: string, x: number, y: number, size = 11, bold = false) {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${safe(value)}) Tj ET`;
}

export function buildInstallmentPaymentPdfBlob(input: PaymentPdfInput) {
  const amount = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(input.amount);
  const commands = [
    '0.12 0.35 0.62 rg 0 790 595 52 re f',
    text(input.organisationName, 44, 810, 16, true),
    text('BETALNINGSUNDERLAG - AVBETALNINGSPLAN', 44, 748, 17, true),
    text('Administrativt underlag - ingen ny faktura eller bokforingspost skapas.', 44, 724, 10),
    text(`Plan: ${input.planNumber}`, 44, 680, 11, true),
    text(`Betalnings-ID: ${input.paymentNumber}`, 44, 656),
    text(`Kund: ${input.customerName || 'Ej angiven'}`, 44, 632),
    text(`Betalningsdatum: ${input.paymentDate}`, 44, 608),
    text(`Betalningsmetod: ${input.method}`, 44, 584),
    text(`Referens: ${input.reference || 'Ej angiven'}`, 44, 560),
    '0.92 g 44 474 507 48 re f 0 g',
    text('Registrerat belopp', 60, 498, 11),
    text(amount, 400, 498, 15, true),
    text('Beloppet har registrerats mot avbetalningsplanen och fordelas mot underlagen enligt aldsta forfallodag forst.', 44, 420, 10),
    text('Detta dokument ar inte en faktura, verifikation eller betalningsinstruktion.', 44, 392, 10, true),
  ];
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach(object => { offsets.push(pdf.length); pdf += `${objects.indexOf(object) + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}
