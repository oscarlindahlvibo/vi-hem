/**
 * Centralized site configuration for the Vibogruppen umbrella brand.
 *
 * All company data, contact details, navigation and content lives here so it can
 * later be connected to an admin interface or the VI-HEM internal system without
 * touching component code. Keep this file the single source of truth.
 */

export type CompanyId =
  | 'vibo-fastigheter'
  | 'vibo-charge'
  | 'viborent'
  | 'grav-allservice'
  | 'aseda-truckmeet'
  | 'ekangens-vandrarhem'
  | 'kunskapsportalen'
  | 'vi-hem'
  | 'vi-hem-app';

export type CompanyCategory =
  | 'property'
  | 'energy'
  | 'rental'
  | 'construction'
  | 'events'
  | 'accommodation'
  | 'education'
  | 'tech';

export interface Company {
  id: CompanyId;
  name: string;
  shortName?: string;
  tagline: string;
  description: string;
  category: CompanyCategory;
  url: string;
  /** Internal route if the company is part of this project, otherwise external link. */
  internal?: boolean;
  /** Lucide icon name used in selectors and cards. */
  icon: string;
  /** Background image for the selector card. */
  image: string;
  imageAlt: string;
  /** Optional brand logo shown in the business selector. */
  logo?: string;
  cta: string;
  /** Accent tint applied to the card and icon (tailwind signal/ink shade key). */
  accent: 'signal' | 'ink' | 'amber' | 'blue' | 'violet' | 'cyan';
  /** Whether the card should show a live status indicator (only Vibo Charge today). */
  liveStatus?: boolean;
  /** Optional note about the legal entity if different from Vibogruppen. */
  legalEntity?: string;
}

export const companies: Company[] = [
  {
    id: 'vibo-fastigheter',
    name: 'Vibo Fastigheter',
    shortName: 'Fastigheter',
    tagline: 'Förvaltning och uthyrning av fastigheter',
    description:
      'Förvaltning och uthyrning av bostäder och lokaler med bas i Virserum. Långsiktigt ägande och skötsel av fastigheter i Småland.',
    category: 'property',
    url: 'https://vibofast.se',
    icon: 'Building2',
    image:
      'https://images.pexels.com/photos/4788301/pexels-photo-4788301.jpeg?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Modern fasad med symmetrisk arkitektur i vinterlandskap',
    logo: '/assets/logos/vibo-fastigheter/logo-svart-vibo.png',
    cta: 'Till Vibo Fastigheter',
    accent: 'ink',
  },
  {
    id: 'vibo-charge',
    name: 'Vibo Charge',
    shortName: 'Charge',
    tagline: 'Snabbladdning för elbil i Virserum',
    description:
      'Publik snabbladdning för elbil i Virserum. Ladda och betala smidigt — se tillgänglighet och pris i realtid.',
    category: 'energy',
    url: 'https://charge.vibogruppen.bolt.host',
    internal: true,
    icon: 'Zap',
    image:
      'https://images.pexels.com/photos/4678065/pexels-photo-4678065.jpeg?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Publik laddstation för elbil med grön design',
    logo: '/assets/logos/vibo-charge/Vibo-charge-logo-1400x700.png',
    cta: 'Till Vibo Charge',
    accent: 'signal',
    liveStatus: true,
  },
  {
    id: 'viborent',
    name: 'ViboRent',
    shortName: 'ViboRent',
    tagline: 'Uthyrning av maskiner, verktyg och utrustning',
    description:
      'Hyra av maskiner, verktyg, släp, evenemangsutrustning och annan utrustning. Det du behöver för jobbet — utan att äga.',
    category: 'rental',
    url: 'https://viborent.se',
    icon: 'Truck',
    image:
      'https://images.pexels.com/photos/16105409/pexels-photo-16105409.jpeg?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Blå arbetsplattformar och maskiner utomhus i solljus',
    logo: '/assets/logos/vibo-rent/Vibo_rent_Logo.png',
    cta: 'Till ViboRent',
    accent: 'amber',
  },
  {
    id: 'grav-allservice',
    name: 'Gräv & Allservice',
    shortName: 'Gräv & Allservice',
    tagline: 'Entreprenad, schakt och fastighetsservice',
    description:
      'Mark- och anläggningsarbete, schakt, entreprenad och fastighetsservice i Virserum och omnejd. Vi tar hand om jobbet från grund till färdig mark.',
    category: 'construction',
    url: 'https://gavirserum.se',
    legalEntity: 'Gräv & Allservice i Virserum AB',
    icon: 'Construction',
    logo: '/assets/logos/grav-allservice/logo.png',
    image:
      'https://images.pexels.com/photos/15071423/pexels-photo-15071423.jpeg?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Gul grävmaskin i arbete i ett stenbrott under klarblå himmel',
    cta: 'Till Gräv & Allservice',
    accent: 'amber',
  },
  {
    id: 'aseda-truckmeet',
    name: 'Åseda Truckmeet',
    shortName: 'Truckmeet',
    tagline: 'Truckträff och evenemang i Småland',
    description:
      'En truckträff och ett evenemang vi arrangerar. En helg fylld av fordon, gemenskap och Småländsk stämning.',
    category: 'events',
    url: 'https://asedatruckmeet.se',
    legalEntity: 'Åseda Truckmeet (egen juridisk person)',
    icon: 'Flame',
    image:
      'https://images.pexels.com/photos/17720190/pexels-photo-17720190.png?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Två ljusöverspjällda lastbilar parkerade i en stadsmiljö på natten',
    logo: '/assets/logos/aseda-truckmeet/aseda-truckmeet-logo.png',
    cta: 'Till Åseda Truckmeet',
    accent: 'violet',
  },
  {
    id: 'ekangens-vandrarhem',
    name: 'Ekängens Vandrarhem',
    shortName: 'Vandrarhem',
    tagline: 'Övernattning i Virserum',
    description:
      'Bo över i Virserum. Boka direkt hos oss eller via Booking.com, Expedia och Airbnb.',
    category: 'accommodation',
    url: 'https://hostel.vibogruppen.se',
    internal: true,
    icon: 'BedDouble',
    logo: '/assets/logos/ekangens-vandrarhem/logo.png',
    image:
      'https://images.pexels.com/photos/36234126/pexels-photo-36234126.jpeg?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Varmt upplyst gatukafé i en stad på kvällen',
    cta: 'Till Ekängens Vandrarhem',
    accent: 'cyan',
  },
  {
    id: 'kunskapsportalen',
    name: 'Kunskapsportalen',
    shortName: 'Utbildning',
    tagline: 'Onlineutbildningar och kurser',
    description:
      'Webbaserade utbildningar — till exempel Arbete på väg 1.1–1.3. Studera i din egen takt, när och var du vill.',
    category: 'education',
    url: 'https://kunskapsportalen.se',
    icon: 'GraduationCap',
    image:
      'https://images.pexels.com/photos/5905700/pexels-photo-5905700.jpeg?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Böcker och studiematerial på ett skrivbord',
    cta: 'Till Kunskapsportalen',
    accent: 'blue',
  },
  {
    id: 'vi-hem',
    name: 'VI-HEM',
    shortName: 'VI-HEM',
    tagline: 'Fastighetssystem för hyresgäster och personal',
    description:
      'Ett fastighetssystem som förenlar hyresgäster och personal. Hantera ärenden, information och kommunikation på ett ställe.',
    category: 'tech',
    url: 'https://vi-hem.se',
    icon: 'Home',
    logo: '/assets/logos/vi-hem/logo.svg',
    image:
      'https://images.pexels.com/photos/4488301/pexels-photo-4488301.jpeg?auto=compress&cs=tinysrgb&w=1600',
    imageAlt: 'Modern lägenhet med rent och ljust interiör',
    cta: 'Till Vi-Hem',
    accent: 'ink',
  },
  {
    id: 'vi-hem-app',
    name: 'Vi-Hem App',
    shortName: 'Appen',
    tagline: 'Logga in i fastighetssystemet',
    description:
      'Direktlänk till appen för hyresgäster och personal. Hantera dina ärenden och din information direkt i mobilen.',
    category: 'tech',
    url: 'https://app.vi-hem.se',
    icon: 'LayoutDashboard',
    image: '',
    imageAlt: '',
    cta: 'Öppna Vi-Hem App',
    accent: 'ink',
  },
];

