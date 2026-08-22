// Minimal PNG decoder for Deno (no DOM/canvas available server-side, so
// the browser-only image-loading path in src/lib/generatedDocuments.ts
// can't be reused as-is). Only needs to handle what our own
// SignaturePad component ever actually produces --
// canvas.toDataURL('image/png') -- which is always 8-bit, non-interlaced,
// color type 2 (RGB) or 6 (RGBA). Anything else throws a clear error
// rather than silently producing a corrupt or blank image on a legal
// document; this is deliberately not a general-purpose PNG decoder.
export interface DecodedPng {
  width: number;
  height: number;
  /** Always RGB, 3 bytes/pixel, no alpha -- transparency is flattened onto
   * white here (matching the existing browser-side flatten-to-white
   * behaviour for signatures/logos), since the PDF embedding path below
   * only handles opaque DeviceRGB images. */
  rgb: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
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
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverses PNG's per-scanline filtering in place, turning the raw
 * inflated IDAT stream into plain, unfiltered scanlines. */
function unfilter(data: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let srcOffset = 0;
  let prevRowStart = -1;
  for (let y = 0; y < height; y++) {
    const filterType = data[srcOffset];
    srcOffset += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[srcOffset + x];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = prevRowStart >= 0 ? out[prevRowStart + x] : 0;
      const c = prevRowStart >= 0 && x >= bpp ? out[prevRowStart + x - bpp] : 0;
      let value: number;
      switch (filterType) {
        case 0: value = raw; break;
        case 1: value = raw + a; break;
        case 2: value = raw + b; break;
        case 3: value = raw + Math.floor((a + b) / 2); break;
        case 4: value = raw + paeth(a, b, c); break;
        default: throw new Error(`PNG: okänd filtertyp ${filterType}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    srcOffset += stride;
    prevRowStart = rowStart;
  }
  return out;
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("Inte en giltig PNG-fil.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idatChunks: Uint8Array[] = [];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // skip CRC
  }

  if (width <= 0 || height <= 0) throw new Error("PNG: ogiltiga dimensioner.");
  if (bitDepth !== 8) throw new Error(`PNG: bitdjup ${bitDepth} stöds inte (endast 8-bit).`);
  if (interlace !== 0) throw new Error("PNG: interlace stöds inte.");
  if (colorType !== 2 && colorType !== 6) throw new Error(`PNG: färgtyp ${colorType} stöds inte (endast RGB/RGBA).`);

  const totalIdatLength = idatChunks.reduce((sum, c) => sum + c.length, 0);
  const idat = new Uint8Array(totalIdatLength);
  let idatOffset = 0;
  for (const chunk of idatChunks) {
    idat.set(chunk, idatOffset);
    idatOffset += chunk.length;
  }

  const inflated = await inflateZlib(idat);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = unfilter(inflated, width, height, bpp);

  // Flatten onto white and drop the alpha channel -- the PDF embedding
  // path only supports opaque DeviceRGB images, and every real use here
  // (handwritten signatures, a company logo) is fine losing transparency
  // this way, matching the equivalent flatten-to-white already done in
  // the browser-side generatedDocuments.ts.
  const rgb = new Uint8Array(width * height * 3);
  if (colorType === 2) {
    rgb.set(raw);
  } else {
    for (let p = 0; p < width * height; p++) {
      const r = raw[p * 4];
      const g = raw[p * 4 + 1];
      const b = raw[p * 4 + 2];
      const a = raw[p * 4 + 3] / 255;
      rgb[p * 3] = Math.round(r * a + 255 * (1 - a));
      rgb[p * 3 + 1] = Math.round(g * a + 255 * (1 - a));
      rgb[p * 3 + 2] = Math.round(b * a + 255 * (1 - a));
    }
  }

  return { width, height, rgb };
}

/** Parses a `data:image/png;base64,...` URL straight into decoded pixels. */
export async function decodePngDataUrl(dataUrl: string): Promise<DecodedPng> {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl.trim());
  if (!match) throw new Error("Förväntade en PNG-data-URL (data:image/png;base64,...).");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodePng(bytes);
}
