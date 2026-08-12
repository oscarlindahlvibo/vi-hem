import type { Document } from '../types';

/* eslint-disable no-control-regex -- preserve PDF whitespace during sanitisation. */

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

type EmbeddedImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
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

function pdfObject(id: number, body: string) {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function jpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 7 < bytes.length) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += Math.max(2, length);
  }
  return { width: 1200, height: 1600 };
}

async function loadEmbeddedImage(url: string): Promise<EmbeddedImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const source = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1400 / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function ascii(value: string) {
  return new TextEncoder().encode(value);
}

function makePdfWithImagesDataUrl(title: string, body: string, images: EmbeddedImage[]) {
  const textLines = normalizePdfText(`${title}\n\n${body}`).split(/\r?\n/).flatMap((line) => {
    if (line.length <= 95) return [line];
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += 95) chunks.push(line.slice(i, i + 95));
    return chunks;
  }).slice(0, 90);
  const objects: Uint8Array[] = [];
  const reserveObject = () => {
    objects.push(new Uint8Array());
    return objects.length;
  };
  const addObject = (bodyBytes: Uint8Array) => {
    const id = reserveObject();
    objects[id - 1] = concatBytes([ascii(`${id} 0 obj\n`), bodyBytes, ascii('\nendobj\n')]);
    return id;
  };

  const catalogId = reserveObject();
  const pagesId = reserveObject();
  const fontId = addObject(ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  const text = ['BT', `/F1 10 Tf`, '50 790 Td', '14 TL', ...textLines.map((line) => `(${escapePdfText(line)}) Tj T*`), 'ET'].join('\n');
  const textContentId = addObject(ascii(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`));
  const pageIds: number[] = [addObject(ascii('PLACEHOLDER_TEXT_PAGE'))];
  const imageObjectIds: number[] = [];
  const imageContentIds: number[] = [];
  images.forEach((image) => {
    const imageId = addObject(concatBytes([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
      image.bytes,
      ascii('\nendstream'),
    ]));
    imageObjectIds.push(imageId);
    const content = `q\n${Math.min(520, image.width)} 0 0 ${Math.min(700, image.height)} 38 70 cm\n/Im${imageId} Do\nQ`;
    imageContentIds.push(addObject(ascii(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)));
    pageIds.push(addObject(ascii('PLACEHOLDER_IMAGE_PAGE')));
  });

  objects[pageIds[0] - 1] = ascii(pdfObject(pageIds[0], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${textContentId} 0 R >>`));
  images.forEach((image, index) => {
    const pageId = pageIds[index + 1];
    objects[pageId - 1] = ascii(pdfObject(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${imageObjectIds[index]} ${imageObjectIds[index]} 0 R >> >> /Contents ${imageContentIds[index]} 0 R >>`));
  });
  objects[catalogId - 1] = ascii(pdfObject(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
  objects[pagesId - 1] = ascii(pdfObject(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`));

  const chunks = [ascii('%PDF-1.4\n')];
  const offsets: number[] = [0];
  let currentLength = chunks[0].length;
  objects.forEach((object) => {
    offsets.push(currentLength);
    chunks.push(object);
    currentLength += object.length;
  });
  const current = concatBytes(chunks);
  const xrefOffset = current.length;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const pdfBytes = concatBytes([current, ascii(xref)]);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < pdfBytes.length; i += chunkSize) binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunkSize));
  return `data:application/pdf;base64,${btoa(binary)}`;
}

export async function buildGeneratedDocumentWithImages(input: GeneratedDocumentInput, imageUrls: string[]) {
  const images = (await Promise.all(imageUrls.filter(Boolean).map(loadEmbeddedImage))).filter((image): image is EmbeddedImage => Boolean(image));
  const fileUrl = makePdfWithImagesDataUrl(input.title, input.body, images);
  return { ...buildGeneratedDocument(input), file_url: fileUrl, file_size: fileUrl.length };
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
