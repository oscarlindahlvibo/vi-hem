import { supabase } from '../../../lib/supabase';

export class MailApiError extends Error {
  constructor(message: string, public code = '', public status = 0) { super(message); }
}

/** Anrop mot edge function vihem-mail. Fel returneras som MailApiError med stabil kod (E_FORBIDDEN, SCOPE_NOT_AUTHORIZED, RATE_LIMITED …). */
export async function mailApi<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('vihem-mail', { body: { action, ...body } });
  if (error) {
    const response = (error as { context?: Response }).context;
    const payload = response ? await response.clone().json().catch(() => null) : null;
    if (payload && payload.ok === false) throw new MailApiError(payload.error || 'Något gick fel.', payload.code || '', response?.status ?? 0);
    throw new MailApiError(navigator.onLine ? 'Kunde inte nå e-posttjänsten. Försök igen.' : 'Du är offline.', navigator.onLine ? 'NETWORK' : 'OFFLINE');
  }
  if (data?.ok === false) throw new MailApiError(data.error || 'Något gick fel.', data.code || '');
  return data as T;
}

export const uuid = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

export async function fileToBase64(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer(); const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(binary);
}
export function base64UrlToBlob(data: string, type: string): Blob {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
