import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { MRCategory, MRPriority, MRStatus, WOPriority, WOStatus, TimeCategory, TimeEntryType, Role } from '../types';

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

/**
 * Every notification type the app can send, shared between the org-wide
 * defaults (AdminStaffPage.tsx) and each user's own overrides
 * (NotificationSettingsPage.tsx). Keys match the setting_key strings the
 * DB trigger functions pass into create_notification() -- see
 * notification_enabled_for_user() and the per-recipient trigger updates
 * in supabase/migrations/20260831120000_per_recipient_notification_gating.sql.
 */
export type NotificationSettings = {
  work_order_assigned: boolean;
  work_order_unassigned: boolean;
  maintenance_created_staff: boolean;
  maintenance_comment_staff: boolean;
  staff_absence_submitted: boolean;
  chat_message: boolean;
  fleet_damage_reported: boolean;
  jour_swap_available: boolean;
  shift_start_reminder: boolean;
  lunch_start_reminder: boolean;
  lunch_return_reminder: boolean;
  shift_end_reminder: boolean;
  admin_broadcast: boolean;
  default_lunch_return_minutes: number;
};

export const defaultNotificationSettings: NotificationSettings = {
  work_order_assigned: true,
  work_order_unassigned: true,
  maintenance_created_staff: true,
  maintenance_comment_staff: true,
  staff_absence_submitted: true,
  chat_message: true,
  fleet_damage_reported: true,
  jour_swap_available: true,
  shift_start_reminder: true,
  lunch_start_reminder: true,
  lunch_return_reminder: true,
  shift_end_reminder: true,
  admin_broadcast: true,
  default_lunch_return_minutes: 45,
};

export type BooleanNotificationSettingKey = Exclude<keyof NotificationSettings, 'default_lunch_return_minutes'>;

export const NOTIFICATION_SETTING_LABELS: { key: BooleanNotificationSettingKey; label: string; description: string }[] = [
  { key: 'work_order_assigned', label: 'Arbetsorder tilldelad', description: 'Notifiera när en arbetsorder tilldelas användaren.' },
  { key: 'work_order_unassigned', label: 'Otilldelad arbetsorder', description: 'Notifiera personal när en arbetsorder läggs upp utan ansvarig.' },
  { key: 'maintenance_created_staff', label: 'Ny felanmälan', description: 'Notifiera all personal när en felanmälan kommer in.' },
  { key: 'maintenance_comment_staff', label: 'Kommentar på felanmälan', description: 'Notifiera personal när en hyresgäst kommenterar en felanmälan.' },
  { key: 'staff_absence_submitted', label: 'Frånvaro från personal', description: 'Notifiera admin när personal sjukanmäler sig eller ansöker om ledighet.' },
  { key: 'chat_message', label: 'Chattmeddelanden', description: 'Notifiera deltagare när nya chattmeddelanden skickas.' },
  { key: 'fleet_damage_reported', label: 'Fordonsskada', description: 'Notifiera admin vid brådskande fordonsskador.' },
  { key: 'jour_swap_available', label: 'Jourpass ute för byte', description: 'Notifiera behörig personal när ett jourpass läggs ut för byte.' },
  { key: 'shift_start_reminder', label: 'Pass börjar', description: 'Påminn vid schemalagd starttid.' },
  { key: 'lunch_start_reminder', label: 'Lunch börjar', description: 'Påminn vid schemalagd lunchstart.' },
  { key: 'lunch_return_reminder', label: 'Lunch slutar', description: 'Påminn efter organisationens eller personalens lunchlängd.' },
  { key: 'shift_end_reminder', label: 'Pass slutar', description: 'Påminn om att stämpla ut vid schemalagt slut.' },
  { key: 'admin_broadcast', label: 'Meddelande från administrationen', description: 'Notifiera vid utskick som en administratör skickar till dig eller din grupp.' },
];

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

// ─── time tracking: break/lunch shared display logic ──────────────────────
// Shared between TimeTrackingPage.tsx (full stämpelklocka) and
// StaffDashboard.tsx (the compact home-screen widget) so both surfaces
// treat "what counts as away from work" and "when is a lunch running
// long" identically instead of drifting apart.

// 'lunch' is its own entry_type (distinct from generic 'break') so it can
// be reminded about based on when someone actually clocked into it, but
// for every other purpose -- worked-time totals, "is this person
// currently away from work" -- lunch and break behave identically.
export function isBreakLike(kind: TimeEntryType) {
  return kind === 'break' || kind === 'lunch';
}

export function entryKindLabel(kind: TimeEntryType): string | null {
  if (kind === 'lunch') return 'Lunch';
  if (kind === 'break') return 'Rast';
  return null;
}

// Lunch-specific elapsed-time thresholds for the live stämpelklocka
// display -- orange past 45 minutes, red past 50. Generic short breaks
// (fika etc, entry_type 'break') aren't held to a fixed length, so they
// don't get this treatment.
export const LUNCH_WARNING_MINUTES = 45;
export const LUNCH_OVERDUE_MINUTES = 50;

export type ClockTone = 'work' | 'break' | 'lunchWarning' | 'lunchOverdue';

export function clockTone(entryType: TimeEntryType, elapsedSeconds: number): ClockTone {
  if (entryType === 'lunch') {
    const elapsedMinutes = elapsedSeconds / 60;
    if (elapsedMinutes >= LUNCH_OVERDUE_MINUTES) return 'lunchOverdue';
    if (elapsedMinutes >= LUNCH_WARNING_MINUTES) return 'lunchWarning';
  }
  return isBreakLike(entryType) ? 'break' : 'work';
}

export const CLOCK_TONE_STYLES: Record<ClockTone, { card: string; iconBg: string; iconText: string; label: string; mono: string; sub: string }> = {
  work: { card: 'bg-emerald-50 border-emerald-200', iconBg: 'bg-emerald-100', iconText: 'text-emerald-700', label: 'text-emerald-700', mono: 'text-emerald-950', sub: 'text-emerald-700' },
  break: { card: 'bg-amber-50 border-amber-200', iconBg: 'bg-amber-100', iconText: 'text-amber-700', label: 'text-amber-700', mono: 'text-amber-950', sub: 'text-amber-700' },
  lunchWarning: { card: 'bg-orange-50 border-orange-300', iconBg: 'bg-orange-100', iconText: 'text-orange-700', label: 'text-orange-700', mono: 'text-orange-950', sub: 'text-orange-700' },
  lunchOverdue: { card: 'bg-red-50 border-red-300', iconBg: 'bg-red-100', iconText: 'text-red-700', label: 'text-red-700', mono: 'text-red-950', sub: 'text-red-700' },
};
