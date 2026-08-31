import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { MRCategory, MRPriority, MRStatus, WOPriority, WOStatus, TimeCategory, Role } from '../types';

export function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const randomPart = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${randomPart()}${randomPart()}-${randomPart()}-${randomPart()}-${randomPart()}-${randomPart()}${randomPart()}${randomPart()}`;
}

export const MR_CATEGORY_LABELS: Record<MRCategory, string> = {
  water: 'Vatten',
  electricity: 'El',
  heating: 'Värme',
  appliances: 'Vitvaror',
  door_lock: 'Dörr/Lås',
  ventilation: 'Ventilation',
  pests: 'Skadedjur',
  internet: 'Internet',
  other: 'Övrigt',
};

export const MR_PRIORITY_LABELS: Record<MRPriority, string> = {
  low: 'Låg',
  normal: 'Normal',
  urgent: 'Akut',
};

export const MR_STATUS_LABELS: Record<MRStatus, string> = {
  received: 'Mottagen',
  assigned: 'Tilldelad',
  started: 'Påbörjad',
  waiting_material: 'Väntar på material',
  waiting_contractor: 'Väntar på entreprenör',
  done: 'Klar',
  closed: 'Avslutad',
};

export const WO_STATUS_LABELS: Record<WOStatus, string> = {
  new: 'Ny',
  assigned: 'Tilldelad',
  started: 'Påbörjad',
  paused: 'Pausad',
  waiting_material: 'Väntar på material',
  waiting_tenant: 'Väntar på hyresgäst',
  waiting_contractor: 'Väntar på entreprenör',
  ready_for_check: 'Klar för kontroll',
  completed: 'Slutförd',
  cancelled: 'Avbruten',
};

export const WO_PRIORITY_LABELS: Record<WOPriority, string> = {
  low: 'Låg',
  normal: 'Normal',
  high: 'Hög',
  urgent: 'Akut',
};

export const TIME_CATEGORY_LABELS: Record<TimeCategory, string> = {
  general: 'Allmänt fastighetsunderhåll',
  work_order: 'Arbetsorder',
  maintenance: 'Felanmälan',
  customer_project: 'Kundprojekt',
  admin: 'Administration',
  travel: 'Resa/Transport',
  shopping: 'Inköp/Material',
  standby: 'Jour',
  other: 'Annat',
};

export const ROLE_LABELS: Record<Role, string> = {
  tenant: 'Hyresgäst',
  staff: 'Personal',
  admin: 'Admin',
  superadmin: 'Superadmin',
  screen: 'TV-skärm',
};

export const APARTMENT_STATUS_LABELS: Record<string, string> = {
  vacant: 'Ledig',
  rented: 'Uthyrd',
  terminated: 'Uppsagd',
  renovation: 'Renovering',
  blocked: 'Spärrad',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  contract: 'Hyresavtal',
  rules: 'Ordningsregler',
  inspection: 'Besiktningsprotokoll',
  invoice: 'Hyresavi',
  notice: 'Meddelande',
  certificate: 'Intyg',
  template: 'Mall',
  other: 'Övrigt',
};

export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  residential_lease: 'Bostadshyresavtal',
  premises_lease: 'Lokalhyresavtal',
  parking_agreement: 'Parkeringsavtal',
  storage_agreement: 'Förrådsavtal',
  lease_addendum: 'Tilläggsavtal',
  termination: 'Uppsägning',
  inspection_protocol: 'Besiktningsprotokoll',
  house_rules: 'Ordningsregler',
  rent_notice: 'Hyresavi',
  invoice: 'Faktura',
  template: 'Mall',
  other: 'Övrigt',
};

export const DOCUMENT_CONTRACT_STATUS_LABELS: Record<string, string> = {
  not_applicable: 'Ej avtal',
  draft: 'Utkast',
  pending_signature: 'Väntar signering',
  signed: 'Signerat',
  cancelled: 'Avbrutet',
  archived: 'Arkiverat',
};

export const NEWS_TARGET_LABELS: Record<string, string> = {
  all: 'Hela organisationen',
  property: 'Fastighet',
  staircase: 'Trapphus',
  tenant: 'Specifik hyresgäst',
};

export const NEWS_AUDIENCE_LABELS: Record<string, string> = {
  tenants: 'Hyresgäster',
  staff: 'Personal',
  all: 'Personal och hyresgäster',
};

export const NEWS_PRIORITY_LABELS: Record<string, string> = {
  normal: 'Normal',
  important: 'Viktig',
  urgent: 'Akut',
};

export const TERMINATION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Inskickad',
  received: 'Mottagen',
  processing: 'Behandlas',
  approved: 'Godkänd',
  closed: 'Avslutad',
};

export const WO_CATEGORIES = [
  'Fastighetsunderhåll',
  'Felanmälan',
  'El',
  'VVS',
  'Värme',
  'Ventilation',
  'Snickeri',
  'Målning',
  'Städ',
  'Utemiljö',
  'Snöröjning',
  'Kundprojekt',
  'Administration',
  'Besiktning',
  'Akut åtgärd',
  'Förebyggande underhåll',
  'Vitvaror',
  'Övrigt',
];

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '–';
  return new Date(date).toLocaleDateString('sv-SE');
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '–';
  return new Date(date).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export function formatCurrency(amount: number): string {
  return amount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
}

export function getMRPriorityColor(priority: MRPriority): string {
  return { low: 'text-slate-500 bg-slate-100', normal: 'text-blue-600 bg-blue-100', urgent: 'text-red-600 bg-red-100' }[priority];
}

export function getMRStatusColor(status: MRStatus): string {
  const colors: Record<MRStatus, string> = {
    received: 'text-slate-600 bg-slate-100',
    assigned: 'text-blue-600 bg-blue-100',
    started: 'text-amber-600 bg-amber-100',
    waiting_material: 'text-orange-600 bg-orange-100',
    waiting_contractor: 'text-purple-600 bg-purple-100',
    done: 'text-green-600 bg-green-100',
    closed: 'text-slate-500 bg-slate-100',
  };
  return colors[status];
}

export function getWOStatusColor(status: WOStatus): string {
  const colors: Record<WOStatus, string> = {
    new: 'text-slate-600 bg-slate-100',
    assigned: 'text-blue-600 bg-blue-100',
    started: 'text-amber-600 bg-amber-100',
    paused: 'text-orange-600 bg-orange-100',
    waiting_material: 'text-orange-600 bg-orange-100',
    waiting_tenant: 'text-purple-600 bg-purple-50',
    waiting_contractor: 'text-violet-600 bg-violet-100',
    ready_for_check: 'text-teal-600 bg-teal-100',
    completed: 'text-green-600 bg-green-100',
    cancelled: 'text-red-600 bg-red-100',
  };
  return colors[status];
}

export function getWOPriorityColor(priority: WOPriority): string {
  return {
    low: 'text-slate-500 bg-slate-100',
    normal: 'text-blue-600 bg-blue-100',
    high: 'text-orange-600 bg-orange-100',
    urgent: 'text-red-600 bg-red-100',
  }[priority];
}

export function getTimeStatusColor(status: string): string {
  return {
    draft: 'text-slate-600 bg-slate-100',
    submitted: 'text-blue-600 bg-blue-100',
    change_requested: 'text-amber-700 bg-amber-100',
    approved: 'text-green-600 bg-green-100',
    rejected: 'text-red-600 bg-red-100',
  }[status] ?? 'text-slate-600 bg-slate-100';
}

export function getAptStatusColor(status: string): string {
  return {
    vacant: 'text-emerald-600 bg-emerald-100',
    rented: 'text-blue-600 bg-blue-100',
    terminated: 'text-orange-600 bg-orange-100',
    renovation: 'text-amber-600 bg-amber-100',
    blocked: 'text-red-600 bg-red-100',
  }[status] ?? 'text-slate-600 bg-slate-100';
}

/**
 * Scrolls the app's real scroll container to the given position. In the
 * native iOS/Android shell, #root is the scroll container instead of
 * window/body (see .vihem-native-shell in index.css, which pins html/body
 * so WKWebView's own scroll view never bounces past the edges) -- plain
 * window.scrollTo() would silently do nothing there. Scrolling both is
 * harmless: whichever one isn't the real scroll container is already at
 * rest and ignores it.
 */
export function scrollAppTo(top: number, behavior: ScrollBehavior = 'auto') {
  window.scrollTo({ top, left: 0, behavior });
  document.getElementById('root')?.scrollTo({ top, left: 0, behavior });
}

/** Same idea as scrollAppTo, but to the bottom of the real content height. */
export function scrollAppToBottom(behavior: ScrollBehavior = 'smooth') {
  const height = document.getElementById('root')?.scrollHeight ?? document.body.scrollHeight;
  scrollAppTo(height, behavior);
}

/**
 * A `fixed inset-0` overlay (Modal, and the handful of bespoke full-page
 * dialogs that don't go through it) sits visually on top of the page, but
 * nothing stops a wheel/touch scroll started over its backdrop from
 * bubbling up the DOM to whichever ancestor actually scrolls -- body on
 * web, #root inside the native shell (see scrollAppTo above). That's what
 * made scrolling feel like it "only worked in some spots": the gesture was
 * scrolling the page behind the dialog instead of the dialog itself.
 * Call lockBackgroundScroll() when an overlay opens and its returned
 * unlock function when it closes; ref-counted so overlays opened on top of
 * each other don't unlock the background until the last one is gone.
 */
let backgroundScrollLockCount = 0;
let previousBodyOverflow: string | null = null;
let previousRootOverflow: string | null = null;

export function lockBackgroundScroll(): () => void {
  if (backgroundScrollLockCount === 0) {
    const root = document.getElementById('root');
    previousBodyOverflow = document.body.style.overflow;
    previousRootOverflow = root ? root.style.overflow : null;
    document.body.style.overflow = 'hidden';
    if (root) root.style.overflow = 'hidden';
  }
  backgroundScrollLockCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    backgroundScrollLockCount = Math.max(0, backgroundScrollLockCount - 1);
    if (backgroundScrollLockCount === 0) {
      document.body.style.overflow = previousBodyOverflow ?? '';
      const root = document.getElementById('root');
      if (root) root.style.overflow = previousRootOverflow ?? '';
    }
  };
}

/** React hook wrapper around lockBackgroundScroll -- call with the overlay's own open/visible flag. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return lockBackgroundScroll();
  }, [active]);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves/opens a file for the user. On the web this is a normal browser
 * download (a blob: URL + a clicked <a download>). WKWebView doesn't
 * support that -- <a download> on a blob: URL is silently a no-op there,
 * which is why file attachments (e.g. invoices in Epost-underlag) never
 * opened in the native app despite working fine in a browser. On native,
 * writes the file to the Filesystem cache and opens the native Share
 * sheet instead, so the user can save it to Files, open it in another
 * app, print it, etc.
 */
export async function saveOrShareFile(blob: Blob, filename: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const base64 = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
  await Share.share({ url: uri, title: filename });
}
