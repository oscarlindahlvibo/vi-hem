export type ListingType =
  | 'apartment'
  | 'commercial'
  | 'office'
  | 'retail'
  | 'warehouse'
  | 'storage'
  | 'garage';

export type LeaseType = 'tillsvidare' | 'visstid';

export type RentType = 'warmhyra' | 'kallhyra';

export type UtilityStatus = 'included' | 'extra-cost' | 'rentable' | 'not-available';

export interface PropertyUtilities {
  electricity: UtilityStatus;
  water: UtilityStatus;
  heating: UtilityStatus;
  fiber: UtilityStatus;
  washingMachine: UtilityStatus;
  dryer: UtilityStatus;
}

export interface PropertyFeature {
  label: string;
  icon: string;
}

export interface Property {
  id: string;
  slug: string;
  title: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  listingType: ListingType;
  leaseType: LeaseType;
  rentType: RentType;
  rent: number;
  rentLabel: string;
  rooms?: number;
  area: number;
  areaLabel: string;
  bedrooms?: number;
  bathrooms?: number;
  description: string;
  shortDescription: string;
  features: string[];
  utilities: PropertyUtilities;
  images: string[];
  available: string;
  status: 'available' | 'coming' | 'rented';
}

export const listingTypeLabels: Record<ListingType, string> = {
  apartment: 'Lägenhet',
  commercial: 'Lokal',
  office: 'Kontor',
  retail: 'Butik',
  warehouse: 'Lager',
  storage: 'Förråd',
  garage: 'Garage',
};

export const rentTypeLabels: Record<RentType, string> = {
  warmhyra: 'Varmhyra',
  kallhyra: 'Kallhyra',
};

export const utilityStatusLabels: Record<UtilityStatus, string> = {
  included: 'Ingår',
  'extra-cost': 'Tilläggskostnad',
  rentable: 'Kan hyras till',
  'not-available': 'Ej tillgängligt',
};

export const demoProperties: Property[] = [
  {
    id: '1',
    slug: 'ekangsvagen-1-4rok',
    title: 'Ekängsvägen 1 – 4 ROK',
    address: 'Ekängsvägen 1',
    city: 'Virserum',
    region: 'Hultsfreds kommun, Kalmar län',
    postalCode: '577 72',
    listingType: 'apartment',
    leaseType: 'tillsvidare',
    rentType: 'warmhyra',
    rent: 8550,
    rentLabel: 'kr/mån',
    rooms: 4,
    area: 130,
    areaLabel: 'kvm',
    bedrooms: 3,
    bathrooms: 2,
    shortDescription:
      'Fyra rum och kök i markplan med egen uteplats – cirka 130 kvm i lugnt område i Virserum.',
    description:
      'Välkommen till en rymlig och renoverad lägenhet med fyra rum och kök, två badrum och en egen uteplats. Lägenheten ligger i markplan med lättillgänglig entré – perfekt för dig som vill bo bekvämt och naturnära i en lugn del av Virserum.\n\nKort om bostaden:\n• Cirka 130 kvm\n• Fyra rum och kök med smart och rymlig planlösning\n• Markplan med egen uteplats\n• Två badrum\n• Diskmaskin ingår\n• Möjlighet att ha egen tvättmaskin\n• Renoverad och fräsch\n• Varmhyra – el, vatten och värme ingår i hyran\n• Fiber kan tillhandahållas mot tilläggskostnad\n• Tvättmaskin och torktumlare kan hyras till\n\nLugnt område i utkanten av Virserum med närhet till det mesta:\n• Upplyst naturstig: 2 min promenad\n• ICA och Coop: 10 min gång\n• Apotek och vårdcentral: 15 min gång\n• Förskola Evahagen: 5 min gång\n• Grundskola (Prolympia, årskurs 1–9): 15 min gång\n\nSmidiga pendlingsavstånd:\n• Åseda: 24 min\n• Hultsfred och Vetlanda: 30 min\n• Högsby och Vimmerby: 40 min\n• Oskarshamn: 52 min\n• Växjö: 60 min\n• Kalmar: 80 min',
    utilities: {
      electricity: 'included',
      water: 'included',
      heating: 'included',
      fiber: 'extra-cost',
      washingMachine: 'rentable',
      dryer: 'rentable',
    },
    features: [
      'Egen uteplats',
      'Markplan',
      'Diskmaskin',
      'Två badrum',
      'Renoverad',
    ],
    images: [
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_6075-2-1240x720.jpeg',
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_6076-2-1240x720.jpeg',
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_6077-2-1240x720.jpeg',
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_6074-2-1240x720.jpeg',
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_6057-2-1240x720.jpeg',
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_6073-2-1240x720.jpeg',
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_1812-3-1240x720.jpeg',
    ],
    available: '2025-08-20',
    status: 'available',
  },
  {
    id: '2',
    slug: 'ekangsvagen-1-2rok',
    title: 'Ekängsvägen 1 – 2 ROK',
    address: 'Ekängsvägen 1',
    city: 'Virserum',
    region: 'Hultsfreds kommun, Kalmar län',
    postalCode: '577 72',
    listingType: 'apartment',
    leaseType: 'tillsvidare',
    rentType: 'kallhyra',
    rent: 5460,
    rentLabel: 'kr/mån',
    rooms: 2,
    area: 75,
    areaLabel: 'kvm',
    bedrooms: 1,
    bathrooms: 1,
    shortDescription:
      'Två rum och kök i Virserum – perfekt för dig som söker ett bekvämt hem i lugn miljö.',
    description:
      'Välkommen till en trevlig lägenhet med två rum och kök i Ekängsvägen 1. Lägenheten ligger i ett lugnt område i Virserum med närhet till natur och service.\n\nKort om bostaden:\n• Cirka 75 kvm\n• Två rum och kök\n• Diskmaskin ingår\n• Möjlighet att ha egen tvättmaskin\n• Kallhyra – el och värme tillkommer\n• Vatten ingår i hyran\n• Tvättmaskin kan hyras till\n\nLugnt område med närhet till det mesta i Virserum.',
    utilities: {
      electricity: 'not-available',
      water: 'included',
      heating: 'not-available',
      fiber: 'not-available',
      washingMachine: 'rentable',
      dryer: 'not-available',
    },
    features: [
      'Diskmaskin',
    ],
    images: [
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_2142-1240x720.jpeg',
    ],
    available: '2025-08-20',
    status: 'available',
  },
  {
    id: '3',
    slug: 'ekelundsgatan-6-2-5-rok',
    title: 'Ekelundsgatan 6 – 2,5 ROK',
    address: 'Ekelundsgatan 6',
    city: 'Virserum',
    region: 'Hultsfreds kommun, Kalmar län',
    postalCode: '577 72',
    listingType: 'apartment',
    leaseType: 'tillsvidare',
    rentType: 'warmhyra',
    rent: 5560,
    rentLabel: 'kr/mån',
    rooms: 2,
    area: 80,
    areaLabel: 'kvm',
    bedrooms: 1,
    bathrooms: 1,
    shortDescription:
      'Rymlig lägenhet med 2,5 rum och kök på Ekelundsgatan 6 i Virserum.',
    description:
      'Välkommen till en rymlig och trevlig lägenhet med 2,5 rum och kök på Ekelundsgatan 6 i Virserum. Lägenheten erbjuder bekvämt boende i ett lugnt område med närhet till service och natur.\n\nKort om bostaden:\n• Cirka 80 kvm\n• 2,5 rum och kök\n• Diskmaskin ingår\n• Möjlighet att ha egen tvättmaskin\n• Varmhyra – el, vatten och värme ingår i hyran\n• Fiber kan tillhandahållas mot tilläggskostnad\n• Tvättmaskin och torktumlare kan hyras till',
    utilities: {
      electricity: 'included',
      water: 'included',
      heating: 'included',
      fiber: 'extra-cost',
      washingMachine: 'rentable',
      dryer: 'rentable',
    },
    features: [
      'Diskmaskin',
    ],
    images: [
      'https://vibofast.se/wp-content/uploads/2025/08/IMG_2142-1240x720.jpeg',
    ],
    available: '2025-08-29',
    status: 'available',
  },
  {
    id: '4',
    slug: 'forrad-i-olika-storlekar',
    title: 'Förråd i olika storlekar',
    address: 'Ekängsvägen 1',
    city: 'Virserum',
    region: 'Hultsfreds kommun, Kalmar län',
    postalCode: '577 72',
    listingType: 'storage',
    leaseType: 'tillsvidare',
    rentType: 'kallhyra',
    rent: 250,
    rentLabel: 'kr/mån',
    area: 6,
    areaLabel: 'kvm',
    shortDescription:
      'Förråd i olika storlekar – perfekt för förvaring av bohag, cyklar och utrustning.',
    description:
      'Vi erbjuder förråd i olika storlekar för uthyrning. Perfekt för dig som behöver extra förvaringsplats för bohag, cyklar, utrustning eller annat. Förråden ligger i anslutning till våra fastigheter i Virserum.\n\nKontakta oss för mer information om tillgängliga storlekar och platser.',
    utilities: {
      electricity: 'not-available',
      water: 'not-available',
      heating: 'not-available',
      fiber: 'not-available',
      washingMachine: 'not-available',
      dryer: 'not-available',
    },
    features: [
      'Flera storlekar',
      'Säkert och låst',
      'Egen nyckel',
    ],
    images: [
      'https://vibofast.se/wp-content/uploads/2025/08/Unknown-41-1240x720.jpg',
    ],
    available: '2025-08-20',
    status: 'available',
  },
];

export let properties: Property[] = [];
export function setProperties(value: Property[]) { properties = value; }

export function getPropertyBySlug(slug: string): Property | undefined {
  return properties.find((p) => p.slug === slug);
}

export function getFeaturedProperties(): Property[] {
  return properties.filter((p) => p.status !== 'rented').slice(0, 3);
}

export function getPropertiesByType(type: ListingType): Property[] {
  return properties.filter((p) => p.listingType === type);
}
