export type ShortStayChannelKey = 'airbnb' | 'booking' | 'expedia' | 'vrbo' | 'manual';

export interface ShortStayChannelMeta {
  key: ShortStayChannelKey;
  label: string;
  shortLabel: string;
  bandClass: string;
  badgeClass: string;
  darkBadgeClass: string;
}

const CHANNELS: Record<ShortStayChannelKey, ShortStayChannelMeta> = {
  airbnb: {
    key: 'airbnb',
    label: 'Airbnb',
    shortLabel: 'A',
    bandClass: 'bg-red-600',
    badgeClass: 'bg-red-100 text-red-700',
    darkBadgeClass: 'bg-red-500/20 text-red-100 ring-red-400/30',
  },
  booking: {
    key: 'booking',
    label: 'Booking',
    shortLabel: 'B',
    bandClass: 'bg-blue-600',
    badgeClass: 'bg-blue-100 text-blue-700',
    darkBadgeClass: 'bg-blue-500/20 text-blue-100 ring-blue-400/30',
  },
  expedia: {
    key: 'expedia',
    label: 'Expedia',
    shortLabel: 'E',
    bandClass: 'bg-emerald-600',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    darkBadgeClass: 'bg-emerald-500/20 text-emerald-100 ring-emerald-400/30',
  },
  vrbo: {
    key: 'vrbo',
    label: 'Vrbo',
    shortLabel: 'V',
    bandClass: 'bg-yellow-500',
    badgeClass: 'bg-yellow-100 text-yellow-800',
    darkBadgeClass: 'bg-yellow-400/20 text-yellow-100 ring-yellow-300/30',
  },
  manual: {
    key: 'manual',
    label: 'VI-HEM',
    shortLabel: 'V',
    bandClass: 'bg-slate-700',
    badgeClass: 'bg-slate-100 text-slate-700',
    darkBadgeClass: 'bg-white/10 text-slate-100 ring-white/10',
  },
};

export function getShortStayChannelMeta(channelName?: string | null): ShortStayChannelMeta {
  const value = (channelName || '').toLowerCase().replace(/[\s._-]+/g, '');
  if (value.includes('airbnb')) return CHANNELS.airbnb;
  if (value.includes('booking')) return CHANNELS.booking;
  if (value.includes('expedia') || value.includes('hotelscom')) return CHANNELS.expedia;
  if (value.includes('vrbo') || value.includes('homeaway') || value.includes('home-away')) return CHANNELS.vrbo;
  return CHANNELS.manual;
}

