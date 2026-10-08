export const allowedChatMime = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
];
export function validateChatBytes(bytes: Uint8Array, mime: string) {
  if (
    bytes.length < 1 ||
    bytes.length > 52428800 ||
    !allowedChatMime.includes(mime)
  )
    throw new Error("Otillåten filtyp eller filstorlek.");
  const starts = (values: number[]) => values.every((v, i) => bytes[i] === v);
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  let valid = false;
  if (mime === "image/jpeg") valid = starts([255, 216, 255]);
  else if (mime === "image/png")
    valid = starts([137, 80, 78, 71, 13, 10, 26, 10]);
  else if (mime === "image/gif")
    valid = ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  else if (mime === "image/webp")
    valid = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  else if (["image/heic", "image/heif"].includes(mime))
    valid =
      ascii(4, 8) === "ftyp" &&
      /heic|heix|hevc|hevx|mif1|msf1/.test(ascii(8, 64));
  else if (mime === "application/pdf") valid = ascii(0, 5) === "%PDF-";
  else if (["application/msword", "application/vnd.ms-excel"].includes(mime))
    valid = starts([208, 207, 17, 224, 161, 177, 26, 225]);
  else if (mime.includes("openxmlformats")) {
    const directory = ascii(Math.max(0, bytes.length - 1048576), bytes.length);
    valid =
      starts([80, 75, 3, 4]) &&
      directory.includes("[Content_Types].xml") &&
      directory.includes(
        mime.includes("wordprocessing")
          ? "word/document.xml"
          : "xl/workbook.xml",
      );
  } else if (mime === "text/plain") {
    const text = ascii(0, Math.min(bytes.length, 8192));
    valid =
      !bytes.slice(0, 8192).includes(0) &&
      !/<\s*(?:html|script|svg|iframe|!doctype)/i.test(text);
  } else if (["video/mp4", "video/quicktime", "audio/mp4"].includes(mime))
    valid = ascii(4, 8) === "ftyp";
  else if (["video/webm", "audio/webm"].includes(mime))
    valid = starts([26, 69, 223, 163]);
  else if (mime === "audio/ogg") valid = ascii(0, 4) === "OggS";
  else if (mime === "audio/wav")
    valid = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  else if (mime === "audio/mpeg")
    valid =
      ascii(0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (!valid) throw new Error("Filens innehåll stämmer inte med filtypen.");
}
