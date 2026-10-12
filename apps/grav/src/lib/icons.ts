import { Hammer, Mountain, Wrench, Truck, TreePine, Droplets, Snowflake, HardHat, Shovel, Construction, Trees, Waves, type LucideIcon } from 'lucide-react';

// Namnen som kan väljas i VI-HEM (Hemsida → Tjänster). Okänt namn faller tillbaka på en hjälm.
const ICONS: Record<string, LucideIcon> = {
  shovel: Shovel, mountain: Mountain, wrench: Wrench, truck: Truck, tree: TreePine, trees: Trees, water: Droplets, snow: Snowflake,
  hammer: Hammer, construction: Construction, hardhat: HardHat, waves: Waves,
};
export const ICON_NAMES = Object.keys(ICONS);
export const iconFor = (name?: string): LucideIcon => ICONS[name || ''] || HardHat;
