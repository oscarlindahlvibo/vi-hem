// Shared types/labels for Drift & rutiner (Åtkomst, Rutiner, Checklistor,
// Inventarielistor). Kept separate from src/types/index.ts because these
// are feature-local, not core domain types referenced across the app.

export type AccessEntryType =
  | 'portkod' | 'dorrkod' | 'grindkod' | 'nyckelbox' | 'hanglas' | 'nyckelnummer'
  | 'tagg' | 'larmkod' | 'larm_instruktion' | 'teknikrum' | 'elcentral' | 'pannrum'
  | 'forrad' | 'kallare' | 'vind' | 'soprum' | 'tvattstuga' | 'garage' | 'bom_grind' | 'ovrigt';

export const ACCESS_ENTRY_TYPE_LABELS: Record<AccessEntryType, string> = {
  portkod: 'Portkod',
  dorrkod: 'Dörrkod',
  grindkod: 'Grindkod',
  nyckelbox: 'Nyckelbox',
  hanglas: 'Hänglås',
  nyckelnummer: 'Nyckelnummer',
  tagg: 'Tagg/passerkort',
  larmkod: 'Larmkod',
  larm_instruktion: 'Larminstruktion',
  teknikrum: 'Teknikrum',
  elcentral: 'Elcentral',
  pannrum: 'Pannrum',
  forrad: 'Förråd',
  kallare: 'Källare',
  vind: 'Vind',
  soprum: 'Soprum',
  tvattstuga: 'Tvättstuga',
  garage: 'Garage',
  bom_grind: 'Bom/grind',
  ovrigt: 'Övrigt',
};

export interface AccessEntry {
  id: string;
  organisation_id: string;
  property_id: string | null;
  apartment_id: string | null;
  company_id: string | null;
  customer_project_id: string | null;
  name: string;
  entry_type: AccessEntryType;
  location_note: string;
  instructions: string;
  comments: string;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  secret_hint: string;
  requires_step_up: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  property?: { name: string } | null;
  apartment?: { apartment_number: string } | null;
}

export type RoutineStatus = 'draft' | 'published' | 'archived';

export const ROUTINE_CATEGORY_OPTIONS = [
  { value: 'stad', label: 'Städ' },
  { value: 'akut', label: 'Akut / nödläge' },
  { value: 'nyckelhantering', label: 'Nyckelhantering' },
  { value: 'incheckning', label: 'In- och utcheckning' },
  { value: 'besiktning', label: 'Besiktning' },
  { value: 'sakerhet', label: 'Säkerhet' },
  { value: 'ovrigt', label: 'Övrigt' },
];

export interface RoutineChecklistTemplateItem {
  id?: string;
  label: string;
  required: boolean;
  requires_photo: boolean;
}

export interface RoutineVersion {
  id: string;
  routine_id: string;
  version_number: number;
  body: string;
  steps: string[];
  warnings: string;
  tips: string;
  change_comment: string;
  created_at: string;
}

export interface Routine {
  id: string;
  organisation_id: string;
  title: string;
  category: string;
  summary: string;
  status: RoutineStatus;
  is_emergency: boolean;
  applies_to_roles: string[];
  requires_acknowledgement: boolean;
  valid_from: string | null;
  valid_to: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  current_version?: RoutineVersion | null;
}

export interface ChecklistInstanceItem {
  id: string;
  instance_id: string;
  sort_order: number;
  label: string;
  required: boolean;
  requires_photo: boolean;
  completed_by: string | null;
  completed_at: string | null;
  comment: string;
  photo_storage_path: string;
}

export interface ChecklistInstance {
  id: string;
  organisation_id: string;
  source_routine_version_id: string | null;
  work_order_id: string | null;
  title: string;
  status: 'in_progress' | 'completed';
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  items?: ChecklistInstanceItem[];
}

export interface InventoryTemplateItem {
  id: string;
  template_id: string;
  sort_order: number;
  label: string;
  desired_quantity: number;
  unit: string;
  stock_item_id: string | null;
}

export interface InventoryTemplate {
  id: string;
  organisation_id: string;
  name: string;
  qr_token: string;
  created_at: string;
  items?: InventoryTemplateItem[];
}

export interface InventoryCheckItem {
  id: string;
  check_id: string;
  template_item_id: string | null;
  label: string;
  desired_quantity: number;
  unit: string;
  actual_quantity: number | null;
  shortage: number;
  action: 'none' | 'requested_from_stock' | 'added_to_purchase_list';
}

export interface InventoryCheck {
  id: string;
  organisation_id: string;
  template_id: string;
  location_note: string;
  performed_by: string | null;
  performed_at: string;
  items?: InventoryCheckItem[];
}

export function isRoutineCurrentlyValid(routine: Pick<Routine, 'valid_from' | 'valid_to'>): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (routine.valid_from && routine.valid_from > today) return false;
  if (routine.valid_to && routine.valid_to < today) return false;
  return true;
}
