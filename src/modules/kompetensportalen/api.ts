import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export const db: SupabaseClient = supabase;
export async function kpAdmin<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('vihem-kp-admin', { body: { action, ...body } });
  if (error) {
    let message = error.message;
    try { const parsed = await (error as any).context?.json?.(); if (parsed?.error) message = parsed.error; } catch { /* behåll */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
export const clean = (m: string) => m.replace(/^\[E_[A-Z_]+\]\s*/, '');
export const money = (v: number | string | null | undefined, d = 0) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v || 0));
export const dt = (v?: string | null) => (v ? new Date(v).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
export const dOnly = (v?: string | null) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('sv-SE') : '–');
export function downloadCsv(csv: string, filename: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export function rowsToCsv(headers: string[], rows: unknown[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\n');
}
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Utkast', coming_soon: 'Kommer snart', published: 'Publicerad', archived: 'Arkiverad', retired: 'Ersatt',
  pending_payment: 'Väntar på betalning', awaiting_invoice_approval: 'Väntar på godkännande', invoiced: 'Fakturerad', paid: 'Betald', fulfilled: 'Levererad', cancelled: 'Avbruten', expired: 'Förfallen', failed: 'Misslyckad', refunded: 'Återbetald', partially_refunded: 'Delvis återbetald',
  not_started: 'Ej påbörjad', in_progress: 'Pågår', awaiting_identity: 'Väntar på identitet', completed: 'Genomförd', revoked: 'Återkallad', issued: 'Utfärdat', superseded: 'Ersatt',
  pending: 'Väntar', processing: 'Behandlas', registered: 'Registrerad', needs_action: 'Kräver åtgärd', open: 'Öppen', closed: 'Stängd', booked: 'Bokad', held: 'Reserverad', waitlisted: 'Väntelista', attended: 'Närvarande', no_show: 'Uteblev', passed: 'Godkänd', failed_exam: 'Underkänd',
  available: 'Ledig', assigned: 'Tilldelad', active: 'Pågår', queued: 'Köad', sending: 'Skickas', sent: 'Skickat', blocked: 'Spärrad', succeeded: 'Genomförd',
};
export const tone = (s: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' =>
  ['published', 'paid', 'fulfilled', 'completed', 'issued', 'registered', 'passed', 'sent', 'succeeded', 'active', 'booked'].includes(s) ? 'success'
  : ['revoked', 'failed', 'cancelled', 'expired', 'refunded', 'no_show', 'superseded'].includes(s) ? 'danger'
  : ['needs_action', 'awaiting_invoice_approval', 'pending_payment', 'awaiting_identity', 'partially_refunded', 'coming_soon', 'processing', 'held'].includes(s) ? 'warning'
  : ['draft', 'pending', 'invoiced', 'queued', 'open'].includes(s) ? 'info' : 'neutral';

/** Laddar upp en fil via signerad uppladdnings-URL (privat bucket om inte publik bild). Returnerar asset-id och ev. publik URL. */
export async function uploadMedia(file: File, kind: 'video' | 'audio' | 'image' | 'document', opts: { isPublic?: boolean; alt?: string; onProgress?: (s: string) => void } = {}) {
  opts.onProgress?.('Förbereder uppladdning…');
  const up = await kpAdmin<{ asset_id: string; bucket: string; path: string; token: string }>('media_upload_url', { kind, filename: file.name, mime_type: file.type, size_bytes: file.size, public: !!opts.isPublic, alt_text: opts.alt ?? '' });
  opts.onProgress?.('Laddar upp…');
  const { error } = await db.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, file, { contentType: file.type });
  if (error) throw new Error(`Uppladdningen misslyckades: ${error.message}`);
  let duration: number | undefined;
  if (kind === 'video' || kind === 'audio') duration = await new Promise<number | undefined>(res => { const el = document.createElement(kind === 'video' ? 'video' : 'audio'); el.preload = 'metadata'; el.onloadedmetadata = () => { res(Number.isFinite(el.duration) ? Math.round(el.duration) : undefined); URL.revokeObjectURL(el.src); }; el.onerror = () => res(undefined); el.src = URL.createObjectURL(file); });
  await kpAdmin('media_complete', { asset_id: up.asset_id, duration_seconds: duration, alt_text: opts.alt });
  opts.onProgress?.('Klart');
  return { asset_id: up.asset_id, bucket: up.bucket, path: up.path, publicUrl: opts.isPublic ? db.storage.from(up.bucket).getPublicUrl(up.path).data.publicUrl : null, duration };
}
