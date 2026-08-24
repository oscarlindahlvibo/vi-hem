// Sidebar groupings for the block-insertion panel in the document builder
// (ContentStep in pages/AgreementsV2Page.tsx) -- categorises BLOCK_TYPES
// into the icon-rail + flyout pattern from the V3 design preview, now
// merged into the main editor. Only built from block types that actually
// exist in blockTypes.ts -- no "Video"/"Custom"/"Presentation" categories
// copied in just to look the part, since those aren't real features here.
import type { BlockType } from '../types';
import { AlignLeft, DollarSign, FileCheck, Image as ImageIconLucide, LayoutList, Paperclip, PackagePlus, PenLine, Type, UserRound } from 'lucide-react';

export interface BlockCategory {
  key: string;
  label: string;
  icon: typeof Type;
  color: string;
  types: BlockType[];
}

export const BLOCK_CATEGORIES: BlockCategory[] = [
  { key: 'header', label: 'Rubrik', icon: Type, color: 'bg-slate-700', types: ['heading', 'subheading', 'date', 'dynamic_field'] },
  { key: 'party', label: 'Part', icon: UserRound, color: 'bg-blue-600', types: ['party'] },
  { key: 'price', label: 'Pris', icon: DollarSign, color: 'bg-green-600', types: ['price', 'price_table'] },
  { key: 'addon', label: 'Tillval', icon: PackagePlus, color: 'bg-orange-600', types: ['package_option'] },
  { key: 'text', label: 'Text', icon: AlignLeft, color: 'bg-indigo-600', types: ['paragraph', 'callout', 'contact_info', 'bullet_list', 'checklist', 'fillable_text', 'checkbox_consent'] },
  { key: 'signature', label: 'Signatur', icon: PenLine, color: 'bg-amber-600', types: ['signature_block'] },
  { key: 'image', label: 'Bild', icon: ImageIconLucide, color: 'bg-pink-600', types: ['image'] },
  { key: 'attachment', label: 'Bilaga', icon: Paperclip, color: 'bg-cyan-600', types: ['attachment_ref'] },
  { key: 'terms', label: 'Villkor', icon: FileCheck, color: 'bg-purple-600', types: ['terms'] },
  { key: 'layout', label: 'Layout', icon: LayoutList, color: 'bg-slate-500', types: ['table', 'divider', 'page_break'] },
];
