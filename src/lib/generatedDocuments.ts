import type { Document } from '../types';

type GeneratedDocumentInput = {
  title: string;
  fileName: string;
  documentType: Document['document_type'];
  description: string;
  body: string;
  organisationId?: string | null;
  tenantId?: string | null;
  propertyId?: string | null;
  apartmentId?: string | null;
  createdBy?: string | null;
};

const normalizePdfText = (value: string) =>
  value
    .replace(/[åÅ]/g, 'a')
    .replace(/[äÄ]/g, 'a')
    .replace(/[öÖ]/g, 'o')
    .replace(/[éÉ]/g, 'e')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

const escapePdfText = (value: string) =>
  normalizePdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function makePdfDataUrl(title: string, body: string) {
  const lines = normalizePdfText(`${title}\n\n${body}`)
    .split(/\r?\n/)
    .flatMap((line) => {
      if (line.length <= 95) return [line];
      const chunks: string[] = [];
      for (let i = 0; i < line.length; i += 95) chunks.push(line.slice(i, i + 95));
      return chunks;
    })
    .slice(0, 90);

  const stream = [
    'BT',
    '/F1 10 Tf',
    '50 790 Td',
    '14 TL',
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    'ET',
  ].join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += object;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return `data:application/pdf;base64,${btoa(pdf)}`;
}

export function buildGeneratedDocument(input: GeneratedDocumentInput) {
  const fileUrl = makePdfDataUrl(input.title, input.body);

  return {
    organisation_id: input.organisationId || null,
    title: input.title,
    file_url: fileUrl,
    file_name: input.fileName,
    file_size: fileUrl.length,
    document_type: input.documentType,
    visibility: 'tenant',
    tenant_id: input.tenantId || null,
    property_id: input.propertyId || null,
    apartment_id: input.apartmentId || null,
    description: input.description,
    created_by: input.createdBy || null,
  };
}
