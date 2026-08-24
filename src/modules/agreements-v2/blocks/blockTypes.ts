// Block type registry for the Avtal V2 block editor. Each entry describes
// one block type's label, default content shape, and a small set of
// editable fields the generic editor form renders (see
// components/BlockEditor.tsx) -- deliberately NOT a rich per-type React
// component each, to keep this "simple, hard to get wrong" rather than a
// Word clone (per the product brief).
import type { BlockType } from '../types';

export type BlockFieldKind = 'text' | 'textarea' | 'select' | 'rows' | 'checklist_items' | 'table_grid' | 'image_url' | 'signer_ref' | 'attachment_ref';

export interface BlockFieldDef {
  key: string;
  label: string;
  kind: BlockFieldKind;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface BlockTypeDef {
  type: BlockType;
  label: string;
  description: string;
  defaultContent: () => Record<string, any>;
  fields: BlockFieldDef[];
  /** True for blocks that only make sense once (or are structural, not text) -- purely informational for the editor UI, not enforced. */
  structural?: boolean;
}

export const BLOCK_TYPES: BlockTypeDef[] = [
  {
    type: 'heading',
    label: 'Rubrik',
    description: 'Stor dokumentrubrik',
    defaultContent: () => ({ text: 'Ny rubrik' }),
    fields: [{ key: 'text', label: 'Text', kind: 'text' }],
  },
  {
    type: 'subheading',
    label: 'Underrubrik',
    description: 'Mindre rubrik för ett avsnitt',
    defaultContent: () => ({ text: 'Ny underrubrik' }),
    fields: [{ key: 'text', label: 'Text', kind: 'text' }],
  },
  {
    type: 'paragraph',
    label: 'Brödtext',
    description: 'Vanlig text. Stödjer {{dynamiska.fält}}.',
    defaultContent: () => ({ text: '' }),
    fields: [{ key: 'text', label: 'Text', kind: 'textarea', placeholder: 'Skriv text... använd {{tenant.name}} för dynamiska fält' }],
  },
  {
    type: 'callout',
    label: 'Informationsruta',
    description: 'Markerad text för viktig information',
    defaultContent: () => ({ text: '', tone: 'info' }),
    fields: [
      { key: 'text', label: 'Text', kind: 'textarea' },
      { key: 'tone', label: 'Typ', kind: 'select', options: [{ value: 'info', label: 'Information' }, { value: 'warning', label: 'Varning' }, { value: 'success', label: 'Positiv' }] },
    ],
  },
  {
    type: 'party',
    label: 'Avtalspart',
    description: 'Visar en avtalspart (namn, org.nr, adress)',
    defaultContent: () => ({ party_index: 0 }),
    fields: [],
  },
  {
    type: 'contact_info',
    label: 'Kontaktuppgifter',
    description: 'Fritext för kontaktuppgifter',
    defaultContent: () => ({ text: '' }),
    fields: [{ key: 'text', label: 'Text', kind: 'textarea' }],
  },
  {
    type: 'date',
    label: 'Datum',
    description: 'Ett datumfält',
    defaultContent: () => ({ label: 'Datum', value: '' }),
    fields: [
      { key: 'label', label: 'Etikett', kind: 'text' },
      { key: 'value', label: 'Datum (ÅÅÅÅ-MM-DD, valfritt)', kind: 'text' },
    ],
  },
  {
    type: 'dynamic_field',
    label: 'Dynamiskt fält',
    description: 'Ett enskilt {{fält}} med etikett',
    defaultContent: () => ({ label: '', token: '' }),
    fields: [
      { key: 'label', label: 'Etikett', kind: 'text', placeholder: 'T.ex. Hyresgäst' },
      { key: 'token', label: 'Fält', kind: 'text', placeholder: '{{tenant.name}}' },
    ],
  },
  {
    type: 'price',
    label: 'Pris/belopp',
    description: 'En rad med belopp',
    defaultContent: () => ({ label: '', amount: '', unit: 'kr' }),
    fields: [
      { key: 'label', label: 'Beskrivning', kind: 'text' },
      { key: 'amount', label: 'Belopp', kind: 'text' },
      { key: 'unit', label: 'Enhet', kind: 'text' },
    ],
  },
  {
    type: 'price_table',
    label: 'Prisspecifikation',
    description: 'Flera rader med antal/á-pris, moms, totalsumma och valfritt RUT-/ROT-avdrag',
    defaultContent: () => ({
      price_form: 'fixed',
      items: [{ description: '', quantity: '1', unit_price: '', vat_rate: 25, deduction_type: 'none' }],
      rut_rate: 50,
      rot_rate: 30,
      deduction_personal_number: '',
    }),
    // Rendered by the special-cased PriceTableFields in BlockEditor.tsx --
    // the line-item array with a live-computed total needs bespoke UI, same
    // reason attachment_ref has its own component instead of a generic
    // BlockFieldDef entry.
    fields: [],
  },
  {
    type: 'package_option',
    label: 'Valbart tillägg',
    description: 'Ett tillval mottagaren kan bocka för att lägga till (t.ex. tvättmaskin, internet) -- läggs till grundkostnaden i totalsumman längst ner',
    defaultContent: () => ({
      title: 'Nytt tillägg',
      description: '',
      selected_by_default: false,
      price_form: 'fixed',
      items: [{ description: '', quantity: '1', unit_price: '', vat_rate: 25, deduction_type: 'none' }],
      rut_rate: 50,
      rot_rate: 30,
      deduction_personal_number: '',
    }),
    // Same reason as price_table: a title/description plus the exact same
    // line-item editor, special-cased in BlockEditor.tsx as
    // PackageOptionFields (which reuses PriceItemsEditor).
    fields: [],
  },
  {
    type: 'table',
    label: 'Tabell',
    description: 'Enkel tabell med rubrikrad',
    defaultContent: () => ({ headers: ['Beskrivning', 'Antal', 'Á-pris'], rows: [['', '', '']] }),
    fields: [{ key: 'rows', label: 'Innehåll', kind: 'table_grid' }],
  },
  {
    type: 'bullet_list',
    label: 'Punktlista',
    description: 'Lista med punkter',
    defaultContent: () => ({ items: [''] }),
    fields: [{ key: 'items', label: 'Punkter', kind: 'rows' }],
  },
  {
    type: 'checklist',
    label: 'Checklista',
    description: 'Lista med ikryssade/oikryssade punkter',
    defaultContent: () => ({ items: [{ text: '', checked: false }] }),
    fields: [{ key: 'items', label: 'Punkter', kind: 'checklist_items' }],
  },
  {
    type: 'image',
    label: 'Bild/logotyp',
    description: 'En bild inbäddad som base64-data-URL',
    defaultContent: () => ({ url: '', alt: '' }),
    fields: [
      { key: 'url', label: 'Bild', kind: 'image_url' },
      { key: 'alt', label: 'Alt-text', kind: 'text' },
    ],
  },
  {
    type: 'divider',
    label: 'Avdelare',
    description: 'Horisontell linje',
    defaultContent: () => ({}),
    fields: [],
    structural: true,
  },
  {
    type: 'page_break',
    label: 'Sidbrytning',
    description: 'Markerar en ny sida vid PDF-export',
    defaultContent: () => ({}),
    fields: [],
    structural: true,
  },
  {
    type: 'terms',
    label: 'Villkor',
    description: 'Ett numrerat villkorsavsnitt',
    defaultContent: () => ({ title: 'Villkor', text: '' }),
    fields: [
      { key: 'title', label: 'Rubrik', kind: 'text' },
      { key: 'text', label: 'Text', kind: 'textarea' },
    ],
  },
  {
    type: 'signature_block',
    label: 'Signaturblock',
    description: 'Plats för en signatärs namnteckning i det slutliga dokumentet',
    defaultContent: () => ({ signer_index: 0 }),
    fields: [],
  },
  {
    type: 'attachment_ref',
    label: 'Bilaga/PDF',
    description: 'Referens till en uppladdad bilaga',
    defaultContent: () => ({ label: 'Se bilaga' }),
    fields: [{ key: 'label', label: 'Etikett', kind: 'text' }],
  },
  {
    type: 'fillable_text',
    label: 'Fritextfält (mottagaren fyller i)',
    description: 'Mottagaren kan fylla i text vid signering (visas som platshållare i förhandsgranskning)',
    defaultContent: () => ({ label: 'Fyll i', placeholder: '' }),
    fields: [
      { key: 'label', label: 'Etikett', kind: 'text' },
      { key: 'placeholder', label: 'Platshållartext', kind: 'text' },
    ],
  },
  {
    type: 'checkbox_consent',
    label: 'Checkbox (mottagaren måste godkänna)',
    description: 'Ett obligatoriskt godkännande innan signering',
    defaultContent: () => ({ text: 'Jag har läst och godkänner villkoren ovan.' }),
    fields: [{ key: 'text', label: 'Text', kind: 'textarea' }],
  },
];

export function blockTypeDef(type: BlockType): BlockTypeDef {
  return BLOCK_TYPES.find((b) => b.type === type) || BLOCK_TYPES[2];
}

export function createBlock(type: BlockType): { id: string; block_type: BlockType; content: Record<string, any> } {
  return { id: crypto.randomUUID(), block_type: type, content: blockTypeDef(type).defaultContent() };
}
