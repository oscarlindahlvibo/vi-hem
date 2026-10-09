import { supabase, supabaseUrl, supabaseAnonKey } from '../supabase';
import { prepareChatImage } from '../chatMedia';
export const driveReference = (id: string) => `vihem-drive:${id}`;
export async function inspectionFile(reference: string): Promise<Blob> {
  if (!reference.startsWith('vihem-drive:')) {
    const response = await fetch(reference);
    if (!response.ok) throw Error('Bilden kunde inte hämtas.');
    return response.blob();
  }
  return requestArchive(reference.slice(12), 'read');
}
async function requestArchive(id: string, action: string, file?: Blob, progress?: (percent: number) => void): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Error('Logga in igen för att öppna eller spara filen.');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${supabaseUrl}/functions/v1/vihem-inspection-archive?action=${action}&job=${id}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.setRequestHeader('Content-Type', file?.type || 'application/octet-stream');
    xhr.responseType = 'blob'; xhr.timeout = 180000;
    xhr.upload.onprogress = e => { if (e.lengthComputable) progress?.(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.response); return; }
      const payload = await (xhr.response as Blob).text().then(value => JSON.parse(value)).catch(() => null);
      reject(Error(payload?.code === 'DRIVE_DISABLED' ? 'Google Drive är inte anslutet för organisationen. Utkastet är sparat. Be en administratör kontrollera kopplingen.' : 'Filen kunde inte arkiveras. Försök igen.'));
    };
    xhr.onerror = xhr.ontimeout = () => reject(Error('Anslutningen bröts. Filen är kvar för återförsök.'));
    xhr.send(file || null);
  });
}
export async function prepareInspectionPhoto(original: File) {
  if (!original.size || original.size > 10 * 1024 * 1024) throw Error('Välj en bild på högst 10 MB.');
  const source = await prepareChatImage(original);
  const bitmap = await createImageBitmap(source);
  try {
    if (!bitmap.width || !bitmap.height) throw Error('Bilden kunde inte läsas.');
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d'); if (!context) throw Error('Bilden kunde inte förberedas.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
    if (!blob) throw Error('Bilden kunde inte förberedas.');
    const name = Array.from(original.name.replace(/\.[^.]+$/, ''))
      .map(character => character.charCodeAt(0) < 32 || character === '/' || character === '\\' ? '-' : character)
      .join('').slice(0, 160);
    return new File([blob], name + '.jpg', { type: 'image/jpeg' });
  } finally { bitmap.close(); }
}
export async function archiveInspectionFile(id: string, inspection: string, kind: 'photo' | 'protocol', room: string, file: File, progress?: (percent: number) => void) {
  const bytes = await file.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
  const { error } = await supabase.rpc('vihem_begin_inspection_file', { p_id: id, p_inspection: inspection, p_kind: kind, p_room: room, p_filename: file.name, p_mime: file.type, p_size: file.size, p_sha256: hash });
  if (error) throw Error('Uppladdningen kunde inte registreras. Kontrollera Drive-inställningarna och försök igen.');
  await requestArchive(id, 'upload', file, progress);
  return driveReference(id);
}

export async function retryInspectionArchive(id: string) { await requestArchive(id, 'archive'); }
