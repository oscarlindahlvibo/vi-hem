import type { MRCategory, MRPriority, MRStatus, WOPriority, WOStatus, TimeCategory, Role } from '../types';

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
  other: 'Övrigt',
};

export const NEWS_TARGET_LABELS: Record<string, string> = {
  all: 'Alla hyresgäster',
  property: 'Fastighet',
  staircase: 'Trapphus',
  tenant: 'Specifik hyresgäst',
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
