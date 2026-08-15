import { supabase } from './supabase';

export type DriveUploadResult = {
  id: string;
  name: string;
  webViewLink?: string | null;
  folder_id?: string | null;
};

export type DriveRenameResult = DriveUploadResult;

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export async function uploadFileToGoogleDrive(file: File, folder: string): Promise<DriveUploadResult | null> {
  const { data: settings, error: settingsError } = await supabase.functions.invoke('vihem-google-drive-storage', {
    body: { action: 'settings' },
  });
  if (settingsError || !settings?.enabled) return null;

  const { data, error } = await supabase.functions.invoke('vihem-google-drive-storage', {
    body: {
      action: 'upload',
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      content_base64: await fileToBase64(file),
      folder,
    },
  });
  if (error) throw error;
  if (!data?.ok || !data.id) throw new Error(data?.error || 'Google Drive-uppladdningen misslyckades.');
  return data as DriveUploadResult;
}

export async function registerGoogleDriveFile(input: {
  organisation_id: string;
  source_type: string;
  source_id?: string | null;
  source_key: string;
  filename: string;
  mime_type?: string | null;
  drive_file_id: string;
  drive_web_url?: string | null;
  drive_folder_id?: string | null;
  created_by?: string | null;
}) {
  const { error } = await supabase.from('vihem_google_drive_files').upsert(input, {
    onConflict: 'organisation_id,source_type,source_key',
  });
  if (error) throw error;
}

export async function archiveFileInGoogleDrive(args: {
  file: File;
  folder: string;
  organisation_id: string;
  source_type: string;
  source_id?: string | null;
  source_key: string;
  created_by?: string | null;
}) {
  const uploaded = await uploadFileToGoogleDrive(args.file, args.folder);
  if (!uploaded) return null;
  await registerGoogleDriveFile({
    organisation_id: args.organisation_id,
    source_type: args.source_type,
    source_id: args.source_id,
    source_key: args.source_key,
    filename: args.file.name,
    mime_type: args.file.type || null,
    drive_file_id: uploaded.id,
    drive_web_url: uploaded.webViewLink || null,
    drive_folder_id: uploaded.folder_id || null,
    created_by: args.created_by,
  });
  return uploaded;
}

export async function renameGoogleDriveFile(args: {
  organisation_id: string;
  source_type: string;
  source_key: string;
  drive_file_id: string;
  filename: string;
}) {
  const { data, error } = await supabase.functions.invoke('vihem-google-drive-storage', {
    body: {
      action: 'rename',
      file_id: args.drive_file_id,
      filename: args.filename,
    },
  });
  if (error) throw error;
  if (!data?.ok || !data.id) throw new Error(data?.error || 'Google Drive-filen kunde inte döpas om.');

  const { error: registryError } = await supabase
    .from('vihem_google_drive_files')
    .update({ filename: data.name || args.filename, drive_web_url: data.webViewLink || null })
    .eq('organisation_id', args.organisation_id)
    .eq('source_type', args.source_type)
    .eq('source_key', args.source_key);
  if (registryError) throw registryError;
  return data as DriveRenameResult;
}

export function buildDocumentArchiveFilename(input: {
  date?: string | null;
  company?: string | null;
  amount?: number | string | null;
  originalName?: string | null;
}) {
  const date = String(input.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const company = String(input.company || 'okant-foretag').trim() || 'okant-foretag';
  const amount = Number(input.amount);
  const amountPart = Number.isFinite(amount) ? amount.toFixed(2) : 'belopp-okant';
  const extension = String(input.originalName || '').match(/\.[a-z0-9]{2,5}$/i)?.[0].toLowerCase() || '.pdf';
  return `${date}_${company}_${amountPart}_SEK${extension}`;
}
