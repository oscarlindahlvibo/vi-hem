/** Bounds-check JPEG marker headers before storing a small profile image. */
export function validProfileJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    return false;
  let position = 2,
    frame = false;
  while (position < bytes.length - 2) {
    if (bytes[position++] !== 0xff) return false;
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xda) return frame && position + 2 < bytes.length - 2;
    if (marker === 0xd9 || marker === 0 || marker === 0xd8) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (position + 2 > bytes.length - 2) return false;
    const length = bytes[position] * 256 + bytes[position + 1];
    if (length < 2 || position + length > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || bytes[position + 2] !== 8) return false;
      const height = bytes[position + 3] * 256 + bytes[position + 4],
        width = bytes[position + 5] * 256 + bytes[position + 6],
        components = bytes[position + 7];
      if (
        !width ||
        !height ||
        width > 2048 ||
        height > 2048 ||
        ![1, 3].includes(components) ||
        length !== 8 + components * 3
      )
        return false;
      frame = true;
    }
    position += length;
  }
  return false;
}
