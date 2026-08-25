export type Role = 'tenant' | 'staff' | 'admin' | 'superadmin' | 'screen';

export type ModuleKey =
  | 'properties'
  | 'documents'
  | 'maintenance'
  | 'work_orders'
  | 'time_tracking'
  | 'laundry'
  | 'chat'
  | 'news'
  | 'purchasing'
  | 'customer_projects'
  | 'short_stay'
  | 'rental_management'
  | 'staff_ledger'
  | 'year_planning'
  | 'meetings'
  | 'inspections'
  | 'finance'
  | 'inventory'
  | 'inventory_management'
  | 'crm'
  | 'ai'
  | 'skatteverket'
  | 'jour'
  | 'fleet_management';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  plan: 'trial' | 'starter' | 'professional' | 'enterprise';
  plan_expires_at: string | null;
  max_users: number;
  max_properties: number;
  max_apartments: number;
  customer_projects_enabled: boolean;
  max_customer_projects: number;
  short_stay_enabled: boolean;
  max_short_stay_units: number;
  contact_email: string;
  contact_phone: string;
  logo_url: string;
  settings: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  active: boolean;
  avatar_url: string;
  organisation_id: string | null;
  /** 'password' | 'bankid' | 'both' */
  auth_method: string;
  /** Swedish 12-digit personal number, set when BankID is linked */
  bankid_personal_number: string | null;
  bankid_linked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModuleDefinition {
  module_key: ModuleKey;
  name: string;
  description: string;
  category: string;
  default_enabled: boolean;
  default_limits: Record<string, unknown>;
  default_settings: Record<string, unknown>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface OrganisationModule {
  organisation_id: string;
  module_key: ModuleKey;
  enabled: boolean;
  limits: Record<string, unknown>;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  module?: ModuleDefinition;
}

export type CalendarEventVisibility = 'organisation' | 'selected_users' | 'private';
export type CalendarEventCategory = 'general' | 'operations' | 'staff' | 'maintenance' | 'customer_project' | 'short_stay' | 'meeting' | 'deadline' | 'private';

export interface CalendarEvent {
  id: string;
  organisation_id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  visibility: CalendarEventVisibility;
  participant_ids: string[];
  category: CalendarEventCategory;
  color: string;
  source_type: string;
  source_id: string | null;
  calendar_source_id?: string | null;
  external_uid?: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  creator?: Profile | null;
}

export interface CalendarSource {
  id: string;
  organisation_id: string;
  user_id: string;
  name: string;
  ical_url: string;
  color: string;
  category: CalendarEventCategory;
  active: boolean;
  last_synced_at: string | null;
  sync_error: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  user?: Profile | null;
}

export type PersonType = 'tenant' | 'staff' | 'customer' | 'supplier' | 'contact' | 'guest' | 'contractor' | 'other';

export interface Person {
  id: string;
  organisation_id: string;
  display_name: string;
  email: string;
  phone: string;
  person_type: PersonType;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  creator?: Profile | null;
}

export type MembershipStatus = 'invited' | 'active' | 'paused' | 'ended';

export interface Membership {
  id: string;
  organisation_id: string;
  person_id: string | null;
  profile_id: string | null;
  role_key: string;
  permissions: Record<string, unknown>;
  status: MembershipStatus;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  person?: Person | null;
  profile?: Profile | null;
}

export interface AuditEvent {
  id: string;
  organisation_id: string | null;
  actor_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: Profile | null;
}

export type FileVisibility = 'private' | 'org' | 'tenant' | 'public';

export interface FileRecord {
  id: string;
  organisation_id: string;
  bucket_id: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  owner_type: string;
  owner_id: string | null;
  visibility: FileVisibility;
  uploaded_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
  uploader?: Profile | null;
}

export type PlanningItemType = string;
export type PlanningItemStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';

export interface PlanningCategory {
  id: string;
  organisation_id: string;
  category_key: string;
  label: string;
  fill_color: string;
  stroke_color: string;
  text_color: string;
  sort_order: number;
  active: boolean;
  system_key: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningItem {
  id: string;
  organisation_id: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string | null;
  item_type: PlanningItemType;
  entity_type: string;
  entity_id: string | null;
  responsible_user_id: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: PlanningItemStatus;
  recurrence_rule: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  responsible?: Profile | null;
  creator?: Profile | null;
}

export interface MeetingTemplate {
  id: string;
  organisation_id: string;
  name: string;
  description: string;
  agenda: Array<Record<string, unknown>>;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MeetingStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'locked' | 'cancelled';

export interface Meeting {
  id: string;
  organisation_id: string;
  template_id: string | null;
  title: string;
  description: string;
  meeting_type: string;
  status: MeetingStatus;
  starts_at: string | null;
  ends_at: string | null;
  entity_type: string;
  entity_id: string | null;
  location: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  template?: MeetingTemplate | null;
  agenda_items?: MeetingAgendaItem[];
  notes?: MeetingNote[];
  decisions?: MeetingDecision[];
  action_items?: MeetingActionItem[];
}

export interface MeetingAgendaItem {
  id: string;
  organisation_id: string;
  meeting_id: string;
  title: string;
  notes: string;
  item_type?: string;
  status?: string;
  source_type?: string;
  source_id?: string | null;
  linked_entity_type?: string;
  linked_entity_id?: string | null;
  metadata?: Record<string, unknown>;
  sort_order: number;
  responsible_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingNote {
  id: string;
  organisation_id: string;
  meeting_id: string;
  author_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
  author?: Profile | null;
}

export interface MeetingDecision {
  id: string;
  organisation_id: string;
  meeting_id: string;
  title: string;
  description: string;
  decided_at: string;
  responsible_user_id: string | null;
  due_date: string | null;
  status: 'open' | 'done' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface MeetingActionItem {
  id: string;
  organisation_id: string;
  meeting_id: string;
  title: string;
  description: string;
  responsible_user_id: string | null;
  due_date: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  linked_entity_type: string;
  linked_entity_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  organisation_id: string | null;
  name: string;
  address: string;
  city: string;
  zip: string;
  description: string;
  emergency_info: string;
  contact_info: Record<string, string>;
  image_url: string;
  active: boolean;
  created_at: string;
}

export interface KeyRecord {
  id: string;
  label: string;
  copies: number;
}

export interface NetworkOutlet {
  room: string;
  port_id: string;
  switch?: string;
  vlan?: string;
}

export interface Apartment {
  id: string;
  property_id: string;
  organisation_id: string | null;
  apartment_number: string;
  size: number;
  rooms: number;
  rent: number;
  floor: number;
  storage: string;
  parking: string;
  status: 'vacant' | 'rented' | 'terminated' | 'renovation' | 'blocked';
  notes: string;
  // Technical details
  lock_cylinder_id: string;
  key_ids: KeyRecord[];
  door_code: string;
  mailbox_id: string;
  network_outlet_ids: NetworkOutlet[];
  electricity_fuse_box: string;
  electricity_meter_id: string;
  water_meter_id: string;
  heat_meter_id: string;
  ventilation_unit_id: string;
  balcony: boolean;
  balcony_size: number;
  storage_id: string;
  parking_spot_id: string;
  cellar_id: string;
  technical_notes: string;
  last_renovation_year: number | null;
  entry_code_updated_at: string | null;
  created_at: string;
  property?: Property;
}

export interface Tenancy {
  id: string;
  organisation_id?: string | null;
  company_id?: string | null;
  tenant_id: string;
  apartment_id: string;
  property_id: string;
  start_date: string;
  end_date: string | null;
  monthly_rent: number;
  contract_file_url: string;
  move_in_date: string | null;
  contact_person: string;
  important_info: string;
  status: 'active' | 'terminated' | 'ended';
  created_at: string;
  tenant?: Profile;
  apartment?: Apartment;
  property?: Property;
}

export type MRCategory = 'water' | 'electricity' | 'heating' | 'appliances' | 'door_lock' | 'ventilation' | 'pests' | 'internet' | 'other';
export type MRPriority = 'low' | 'normal' | 'urgent';
export type MRStatus = 'received' | 'assigned' | 'started' | 'waiting_material' | 'waiting_contractor' | 'done' | 'closed';

export interface MaintenanceRequest {
  id: string;
  organisation_id: string | null;
  tenant_id: string;
  property_id: string | null;
  apartment_id: string | null;
  title: string;
  description: string;
  category: MRCategory;
  priority: MRPriority;
  status: MRStatus;
  access_permission: boolean;
  preferred_times: string;
  contact_info: Record<string, string>;
  assigned_to: string | null;
  assigned_to_ids: string[];
  attachments: AttachmentItem[];
  internal_notes: string;
  created_at: string;
  updated_at: string;
  tenant?: Profile;
  property?: Property;
  apartment?: Apartment;
  assigned?: Profile;
}

export interface MaintenanceRequestComment {
  id: string;
  request_id: string;
  user_id: string;
  comment: string;
  internal: boolean;
  created_at: string;
  user?: Profile;
}

export type WOPriority = 'low' | 'normal' | 'high' | 'urgent';
export type WOStatus = 'new' | 'assigned' | 'started' | 'paused' | 'waiting_material' | 'waiting_tenant' | 'waiting_contractor' | 'ready_for_check' | 'completed' | 'cancelled';

export interface WorkOrder {
  id: string;
  organisation_id: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  priority: WOPriority;
  status: WOStatus;
  property_id: string | null;
  apartment_id: string | null;
  tenant_id: string | null;
  customer_project_id: string | null;
  maintenance_request_id: string | null;
  short_stay_booking_id: string | null;
  vehicle_id: string | null;
  assigned_to: string | null;
  assigned_to_ids: string[];
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  due_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  checklist: ChecklistItem[];
  materials: MaterialItem[];
  attachments: AttachmentItem[];
  created_at: string;
  updated_at: string;
  property?: Property;
  apartment?: Apartment;
  tenant?: Profile;
  assigned?: Profile;
  creator?: Profile;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface MaterialItem {
  name: string;
  quantity: number;
  unit: string;
  cost?: number;
}

export interface AttachmentItem {
  id: string;
  name: string;
  url: string;
  path?: string;
  type?: string;
  size?: number;
  uploaded_at: string;
  uploaded_by?: string | null;
}

export interface WorkOrderComment {
  id: string;
  work_order_id: string;
  user_id: string;
  comment: string;
  internal: boolean;
  created_at: string;
  user?: Profile;
}

export type CustomerProjectStatus =
  | 'draft' | 'quote_created' | 'quote_sent' | 'quote_accepted' | 'planned'
  | 'in_progress' | 'paused' | 'waiting_customer' | 'waiting_material'
  | 'ready_for_inspection' | 'inspected_with_remarks' | 'approved'
  | 'invoiced' | 'completed' | 'archived' | 'cancelled';

export interface ProjectCustomer {
  id: string;
  organisation_id: string;
  customer_type: 'private' | 'company' | 'brf' | 'property_owner' | 'internal';
  name: string;
  identity_number: string;
  contact_person: string;
  phone: string;
  email: string;
  invoice_address: string;
  project_address: string;
  reference: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerProject {
  id: string;
  organisation_id: string;
  company_id?: string | null;
  customer_id: string | null;
  name: string;
  customer_name: string;
  title: string;
  description: string;
  status: CustomerProjectStatus;
  project_address: string;
  project_type: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  billing_type: 'fixed_price' | 'hourly' | 'mixed';
  project_manager_id: string | null;
  start_date: string | null;
  planned_end_date: string | null;
  budget_amount: number;
  quoted_amount: number;
  approved_change_order_amount: number;
  estimated_cost: number;
  actual_cost: number;
  invoiceable_amount: number;
  invoiced_amount: number;
  hourly_rate: number;
  internal_reference: string;
  external_reference: string;
  property_id: string | null;
  apartment_id: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: ProjectCustomer;
  project_manager?: Profile;
  assignments?: ProjectAssignment[];
}

export interface ProjectAssignment {
  id: string;
  project_id: string;
  user_id: string;
  role: 'project_manager' | 'staff' | 'viewer';
  created_at: string;
  user?: Profile;
}

export interface ProjectMaterialEntry {
  id: string;
  project_id: string;
  change_order_id: string | null;
  registered_by: string | null;
  material_date: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  purchase_price: number;
  markup_percent: number;
  sale_price: number;
  vat_rate: number;
  supplier: string;
  receipt_url: string;
  included_in_quote: boolean;
  invoice_separately: boolean;
  status: 'registered' | 'approved' | 'invoiced';
  created_at: string;
  updated_at: string;
}

export interface ProjectChangeOrder {
  id: string;
  project_id: string;
  change_order_number: string;
  title: string;
  description: string;
  reason: string;
  requested_by: string;
  status: 'draft' | 'sent_to_customer' | 'approved_by_customer' | 'declined_by_customer' | 'completed' | 'invoiced' | 'written_off';
  billing_mode: 'separate' | 'included' | 'internal_note' | 'deduction';
  estimated_amount: number;
  actual_amount: number;
  schedule_impact: string;
  customer_approved_at: string | null;
  internal_comment: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectQuoteVersion {
  id: string;
  project_id: string;
  version_number: number;
  quote_number: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'replaced';
  valid_until: string | null;
  summary: string;
  terms: string;
  payment_terms: string;
  total_amount: number;
  balance_due?: number;
  vat_amount: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lines?: ProjectQuoteLine[];
}

export interface ProjectQuoteLine {
  id: string;
  quote_version_id: string;
  line_type: 'work' | 'material' | 'equipment' | 'subcontractor' | 'discount' | 'other';
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  sort_order: number;
  created_at: string;
}

export interface ProjectActivityLog {
  id: string;
  project_id: string;
  organisation_id: string;
  user_id: string | null;
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user?: Profile;
}

export interface ProjectSelfCheckTemplate {
  id: string;
  organisation_id: string;
  name: string;
  category: string;
  description: string;
  checklist: ProjectSelfCheckTemplateItem[];
  require_photo: boolean;
  require_comment: boolean;
  require_signature: boolean;
  require_date: boolean;
  require_responsible: boolean;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSelfCheckTemplateItem {
  id?: string;
  text: string;
  require_photo?: boolean;
  require_comment?: boolean;
}

export interface ProjectSelfCheckItem {
  text: string;
  result: 'approved' | 'not_approved' | 'not_applicable';
  comment?: string;
  image_url?: string;
  action_required?: boolean;
}

export interface ProjectSelfCheck {
  id: string;
  project_id: string;
  template_id: string | null;
  name: string;
  category: string;
  status: 'draft' | 'in_progress' | 'completed' | 'signed' | 'requires_action';
  performed_by: string | null;
  performed_at: string | null;
  items: ProjectSelfCheckItem[];
  notes: string;
  signature_name: string;
  signed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectInspectionRemark {
  title: string;
  description: string;
  responsible_id?: string | null;
  deadline?: string;
  status: 'new' | 'assigned' | 'in_progress' | 'fixed' | 'checked' | 'approved';
}

export interface ProjectInspection {
  id: string;
  project_id: string;
  inspection_type: 'internal' | 'customer' | 'final';
  inspection_date: string;
  inspector_id: string | null;
  customer_present: boolean;
  project_status: string;
  result: 'approved_without_remarks' | 'approved_with_minor_remarks' | 'not_approved' | 'requires_action';
  remarks: ProjectInspectionRemark[];
  photos: { url: string; comment?: string }[];
  notes: string;
  signature_name: string;
  signed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDeviation {
  id: string;
  project_id: string;
  title: string;
  description: string;
  deviation_date: string;
  reported_by: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  image_url: string;
  proposed_action: string;
  responsible_id: string | null;
  status: 'new' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
  related_type: string;
  related_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectInvoiceBasis {
  id: string;
  project_id: string;
  basis_number: string;
  invoice_type: 'partial' | 'final' | 'credit' | 'internal';
  status: 'draft' | 'ready_for_invoicing' | 'invoiced' | 'do_not_invoice';
  title: string;
  description: string;
  total_amount: number;
  vat_amount: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lines?: ProjectInvoiceBasisLine[];
}

export interface ProjectInvoiceBasisLine {
  id: string;
  basis_id: string;
  source_type: 'time' | 'material' | 'change_order' | 'equipment' | 'fixed_price' | 'manual';
  source_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  billing_status: 'not_ready' | 'ready' | 'invoiced' | 'do_not_invoice' | 'included_in_quote';
  created_at: string;
}

export type ShortStayBookingType = 'booking' | 'block';
export type ShortStayPaymentStatus = 'unpaid' | 'partial' | 'paid';
export type ShortStayCleaningStatus = 'not_needed' | 'dirty' | 'in_progress' | 'clean';

export interface ShortStayUnit {
  id: string;
  organisation_id: string;
  property_id: string | null;
  apartment_id: string | null;
  name: string;
  description: string;
  max_guests: number;
  receipt_vat_rate?: number;
  receipt_vat_exempt?: boolean;
  is_active: boolean;
  beds24_enabled: boolean;
  beds24_property_id: string;
  beds24_room_id: string;
  ical_url_1: string;
  channel_name_1: string;
  ical_url_2: string;
  channel_name_2: string;
  ical_url_3: string;
  channel_name_3: string;
  ical_token: string;
  last_synced_at: string | null;
  sync_error_1: string | null;
  sync_error_2: string | null;
  sync_error_3: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  property?: Property;
  apartment?: Apartment;
}

export interface ShortStayBooking {
  id: string;
  organisation_id: string;
  unit_id: string;
  external_uid: string | null;
  beds24_booking_id: string;
  beds24_status: string;
  channel_number: number | null;
  channel_name: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  arrival_time: string | null;
  departure_time: string | null;
  is_manual: boolean;
  booking_type: ShortStayBookingType;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  guest_count: number;
  payment_status: ShortStayPaymentStatus;
  cleaning_status: ShortStayCleaningStatus;
  cleaning_work_order_id: string | null;
  finance_invoice_id?: string | null;
  notes: string;
  total_price: number;
  paid_amount: number;
  balance_due: number;
  currency: string;
  price_breakdown: Record<string, unknown>;
  receipt_company_id?: string | null;
  receipt_title?: string;
  receipt_lines?: Array<{ id?: string; description: string; amount: number }>;
  receipt_vat_rate?: number;
  receipt_vat_exempt?: boolean;
  platform_commission_rate?: number;
  platform_commission_amount?: number;
  platform_settlement_amount?: number;
  source_payload: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  unit?: ShortStayUnit;
}

export type TimeCategory = 'general' | 'work_order' | 'maintenance' | 'customer_project' | 'admin' | 'travel' | 'shopping' | 'standby' | 'other';
export type TimeStatus = 'draft' | 'submitted' | 'change_requested' | 'approved' | 'rejected';
export type TimeEntryType = 'work' | 'break';
export type StaffAbsenceType = 'sick' | 'vab' | 'vacation' | 'leave' | 'unpaid_leave' | 'parental_leave';
export type StaffAbsenceStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface TimeEntry {
  id: string;
  organisation_id: string | null;
  user_id: string;
  work_order_id: string | null;
  maintenance_request_id: string | null;
  property_id: string | null;
  customer_project_id: string | null;
  vehicle_id: string | null;
  category: TimeCategory;
  entry_type: TimeEntryType;
  customer_name: string | null;
  start_time: string;
  end_time: string | null;
  break_minutes: number;
  total_minutes: number;
  comment: string;
  status: TimeStatus;
  approved_by: string | null;
  approved_at: string | null;
  project_billable: boolean;
  project_billing_scope: 'included_in_quote' | 'outside_quote' | 'internal';
  project_change_order_id: string | null;
  internal_note: string;
  created_at: string;
  user?: Profile;
  work_order?: WorkOrder;
  customer_project?: CustomerProject;
  property?: Property;
}

export interface StaffAbsenceRequest {
  id: string;
  organisation_id: string | null;
  user_id: string;
  absence_type: StaffAbsenceType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  comment: string;
  status: StaffAbsenceStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  user?: Profile;
}

export interface StaffWorkSchedule {
  id: string;
  organisation_id: string | null;
  user_id: string;
  weekday: number;
  work_start: string;
  work_end: string;
  lunch_start: string | null;
  lunch_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LaundryRoom {
  id: string;
  organisation_id: string | null;
  property_id: string;
  name: string;
  description: string;
  machines: { name: string }[];
  active: boolean;
  max_bookings_per_tenant: number;
  created_at: string;
  property?: Property;
}

export interface LaundrySlot {
  id: string;
  laundry_room_id: string;
  date: string;
  start_time: string;
  end_time: string;
  is_blocked: boolean;
  block_reason: string;
  created_at: string;
  laundry_room?: LaundryRoom;
  booking?: LaundryBooking;
}

export interface LaundryBooking {
  id: string;
  laundry_slot_id: string;
  tenant_id: string | null;
  guest_link_id?: string | null;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  status: 'active' | 'cancelled';
  created_at: string;
  slot?: LaundrySlot;
  tenant?: Profile;
}

export interface LaundryGuestLink {
  id: string;
  organisation_id: string;
  property_id: string;
  apartment_id: string | null;
  short_stay_unit_id: string | null;
  label: string;
  token: string;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  max_bookings: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  property?: Property;
  apartment?: Apartment;
  short_stay_unit?: ShortStayUnit;
}

export interface Document {
  id: string;
  organisation_id: string | null;
  title: string;
  file_url: string;
  file_name: string;
  file_size: number;
  document_type: 'contract' | 'rules' | 'inspection' | 'invoice' | 'notice' | 'certificate' | 'template' | 'other';
  document_category: 'residential_lease' | 'premises_lease' | 'parking_agreement' | 'storage_agreement' | 'lease_addendum' | 'termination' | 'inspection_protocol' | 'house_rules' | 'rent_notice' | 'invoice' | 'template' | 'other';
  contract_status: 'not_applicable' | 'draft' | 'pending_signature' | 'signed' | 'cancelled' | 'archived';
  storage_bucket: string | null;
  storage_path: string | null;
  storage_provider?: 'supabase' | 'google_drive';
  drive_file_id?: string | null;
  drive_web_url?: string | null;
  drive_folder_id?: string | null;
  drive_synced_at?: string | null;
  visibility: 'public' | 'tenant' | 'staff' | 'admin';
  tenant_id: string | null;
  property_id: string | null;
  apartment_id: string | null;
  description: string;
  created_by: string | null;
  created_at: string;
  tenant?: Profile;
  property?: Property;
}

export interface News {
  id: string;
  title: string;
  content: string;
  image_url: string;
  organisation_id: string | null;
  target_type: 'all' | 'property' | 'staircase' | 'tenant';
  target_id: string | null;
  audience: 'tenants' | 'staff' | 'all';
  priority: 'normal' | 'important' | 'urgent';
  published_at: string | null;
  status: 'draft' | 'published' | 'archived';
  created_by: string | null;
  created_at: string;
  creator?: Profile;
}

export interface TerminationRequest {
  id: string;
  organisation_id: string | null;
  tenant_id: string;
  tenancy_id: string | null;
  requested_move_out_date: string;
  new_address: string;
  message: string;
  status: 'submitted' | 'received' | 'processing' | 'approved' | 'closed';
  internal_notes: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  tenant?: Profile;
  tenancy?: Tenancy;
}

export interface ChatThread {
  id: string;
  organisation_id: string | null;
  tenant_id: string | null;
  assigned_to: string | null;
  chat_type: 'tenant_support' | 'direct' | 'group';
  created_by: string | null;
  subject: string;
  status: 'open' | 'closed' | 'archived';
  maintenance_request_id: string | null;
  last_message_at: string;
  created_at: string;
  tenant?: Profile;
  assigned?: Profile;
  participants?: ChatParticipant[];
  messages?: ChatMessage[];
  unread_count?: number;
}

export interface ChatParticipant {
  id: string;
  thread_id: string;
  user_id: string;
  created_at: string;
  user?: Profile;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
  sender?: Profile;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'info' | 'maintenance' | 'work_order' | 'chat' | 'laundry' | 'news' | 'termination' | 'time_entry';
  link: string;
  read_at: string | null;
  created_at: string;
}

export interface PurchaseItem {
  id: string;
  organisation_id: string | null;
  store_name: string;
  item_name: string;
  quantity: string;
  product_url: string;
  notes: string;
  priority: 'low' | 'normal' | 'urgent';
  status: 'open' | 'purchased' | 'cancelled';
  created_by: string | null;
  purchased_by: string | null;
  purchased_at: string | null;
  created_at: string;
  updated_at: string;
  creator?: Profile | null;
  purchaser?: Profile | null;
}

export interface AiInteraction {
  id: string;
  organisation_id: string;
  user_id: string | null;
  feature_key: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  prompt_hash: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user?: Profile | null;
}

export type AiSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'cancelled';

export interface AiSuggestion {
  id: string;
  organisation_id: string;
  created_by: string | null;
  source_type: string;
  source_id: string | null;
  suggestion_type: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  confidence: number;
  status: AiSuggestionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  creator?: Profile | null;
  reviewer?: Profile | null;
}

export type InventoryItemStatus = 'active' | 'service_due' | 'out_of_service' | 'archived';

export interface InventoryItem {
  id: string;
  organisation_id: string;
  property_id: string | null;
  apartment_id: string | null;
  name: string;
  category: string;
  serial_number: string;
  purchase_date: string | null;
  warranty_until: string | null;
  next_service_date: string | null;
  status: InventoryItemStatus;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  property?: Property | null;
  apartment?: Apartment | null;
}

export interface InventoryServiceEvent {
  id: string;
  organisation_id: string;
  inventory_item_id: string;
  service_date: string;
  title: string;
  description: string;
  performed_by: string;
  cost: number;
  next_service_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item?: InventoryItem | null;
}

export type CrmAccountType = 'customer' | 'supplier' | 'partner' | 'prospect' | 'other';
export type CrmAccountStatus = 'active' | 'inactive' | 'archived';

export interface CrmAccount {
  id: string;
  organisation_id: string;
  name: string;
  account_type: CrmAccountType;
  organisation_number: string;
  email: string;
  phone: string;
  address: Record<string, unknown>;
  notes: string;
  status: CrmAccountStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CrmContact {
  id: string;
  organisation_id: string;
  account_id: string | null;
  person_id: string | null;
  name: string;
  role_title: string;
  email: string;
  phone: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  account?: CrmAccount | null;
  person?: Person | null;
}

export interface CrmActivity {
  id: string;
  organisation_id: string;
  account_id: string | null;
  contact_id: string | null;
  activity_type: 'note' | 'call' | 'email' | 'meeting' | 'task' | 'offer' | 'agreement';
  title: string;
  description: string;
  due_at: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  account?: CrmAccount | null;
  contact?: CrmContact | null;
  assignee?: Profile | null;
  creator?: Profile | null;
}

export type CompanyPermissionRole = 'viewer' | 'seller' | 'bookkeeper' | 'approver' | 'admin';
export type FinanceCustomerType = 'private' | 'company' | 'brf' | 'property_owner' | 'internal';
export type InvoiceStatus = 'draft' | 'approved' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'credited' | 'cancelled';
export type InvoicePaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid';
export type InvoiceAccountingStatus = 'not_synced' | 'pending' | 'synced' | 'failed';
export type InvoiceLineType = 'manual' | 'rent' | 'time' | 'material' | 'fee' | 'discount' | 'short_stay' | 'work_order';

export interface FinanceCompany {
  id: string;
  organisation_id: string;
  name: string;
  legal_name: string;
  organisation_number: string;
  vat_number: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country_code: string;
  logo_url: string;
  bankgiro: string;
  plusgiro: string;
  iban: string;
  bic: string;
  swish_number: string;
  default_payment_terms_days: number;
  default_currency: string;
  default_vat_rate: number;
  invoice_prefix: string;
  active: boolean;
  accounting_provider: string;
  accounting_settings: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyUserPermission {
  id: string;
  organisation_id: string;
  company_id: string;
  user_id: string;
  role: CompanyPermissionRole;
  permissions: Record<string, unknown>;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  user?: Profile | null;
  company?: FinanceCompany | null;
}

export interface FinanceCustomer {
  id: string;
  organisation_id: string;
  company_id: string | null;
  customer_type: FinanceCustomerType;
  name: string;
  organisation_number: string;
  personal_number: string;
  vat_number: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country_code: string;
  invoice_email: string;
  payment_terms_days: number;
  notes: string;
  active: boolean;
  external_accounting_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
}

export interface FinanceSupplier {
  id: string;
  organisation_id: string;
  company_id: string | null;
  name: string;
  organisation_number: string;
  vat_number: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country_code: string;
  payment_terms_days: number;
  bankgiro: string;
  plusgiro: string;
  iban: string;
  bic: string;
  bank_account: string;
  payment_reference: string;
  default_account_code: string;
  notes: string;
  active: boolean;
  external_accounting_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
}

export interface FinanceAuditLog {
  id: string;
  organisation_id: string | null;
  company_id: string | null;
  table_name: string;
  record_id: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  created_at: string;
  company?: FinanceCompany | null;
  changed_by_profile?: Profile | null;
}

export interface InvoiceNumberSeries {
  id: string;
  organisation_id: string;
  company_id: string;
  name: string;
  prefix: string;
  next_number: number;
  padding: number;
  fiscal_year: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
}

export interface Invoice {
  id: string;
  organisation_id: string;
  company_id: string;
  customer_id: string | null;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string;
  payment_terms_days: number;
  currency: string;
  status: InvoiceStatus;
  accounting_status: InvoiceAccountingStatus;
  payment_status: InvoicePaymentStatus;
  source_type: string;
  source_id: string | null;
  project_id: string | null;
  work_order_id: string | null;
  tenancy_id: string | null;
  original_invoice_id?: string | null;
  credited_by_invoice_id?: string | null;
  credit_reason?: string;
  subtotal_amount: number;
  vat_amount: number;
  total_amount: number;
  balance_due?: number;
  paid_amount: number;
  sent_at: string | null;
  paid_at: string | null;
  external_accounting_id: string;
  notes: string;
  document_id?: string | null;
  locked_at?: string | null;
  cancelled_by?: string | null;
  cancelled_reason?: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  company?: FinanceCompany | null;
  customer?: FinanceCustomer | null;
  lines?: InvoiceLine[];
}

export type InstallmentPlanStatus = 'draft' | 'pending_approval' | 'active' | 'overdue' | 'completed' | 'paused' | 'cancelled';

export interface InstallmentPlan {
  id: string;
  organisation_id: string;
  company_id: string;
  customer_id: string | null;
  plan_number: string;
  status: InstallmentPlanStatus;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  installment_count: number;
  first_due_date: string;
  interval_months: number;
  day_of_month: number;
  payment_amount: number;
  email_lead_days: number;
  terms: string;
  notes: string;
  pause_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  accounting_exportable: false;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
  customer?: FinanceCustomer | null;
}

export interface InstallmentPlanInvoice {
  id: string;
  organisation_id: string;
  plan_id: string;
  invoice_id: string | null;
  source_type: 'original' | 'external';
  external_invoice_number: string | null;
  external_invoice_date: string | null;
  external_due_date: string | null;
  description: string;
  amount: number;
  balance_remaining: number;
  created_at: string;
  invoice?: Invoice | null;
}

export interface InstallmentSchedule {
  id: string;
  organisation_id: string;
  plan_id: string;
  invoice_id: string | null;
  installment_no: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: 'pending' | 'partially_paid' | 'paid' | 'overdue' | 'paused' | 'cancelled';
  payment_reference: string | null;
  email_send_date: string | null;
  email_status: 'pending' | 'queued' | 'sent' | 'failed' | 'skipped';
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstallmentPayment {
  id: string;
  organisation_id: string;
  plan_id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  payment_method: 'bank_transfer' | 'card' | 'cash' | 'swish' | 'other';
  reference: string;
  notes: string;
  accounting_exportable: false;
  created_by: string | null;
  created_at: string;
}

export interface InstallmentPlanDocument {
  id: string;
  organisation_id: string;
  plan_id: string;
  payment_id: string | null;
  document_type: 'payment_underlay' | 'attachment';
  title: string;
  file_name: string;
  mime_type: string;
  storage_bucket: string;
  storage_path: string;
  size_bytes: number | null;
  drive_file_id: string | null;
  drive_web_url: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceLine {
  id: string;
  organisation_id: string;
  company_id: string;
  invoice_id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  account_code: string;
  line_type: InvoiceLineType;
  project_id: string | null;
  work_order_id: string | null;
  tenancy_id?: string | null;
  time_entry_id: string | null;
  line_total_excl_vat: number;
  vat_amount: number;
  line_total_incl_vat: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  organisation_id: string;
  company_id: string;
  invoice_id: string | null;
  payment_date: string;
  amount: number;
  currency: string;
  source: 'manual' | 'accounting' | 'bank' | 'swish' | 'autogiro';
  reference: string;
  external_payment_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
  invoice?: Invoice | null;
}

export type InvoiceEmailStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'cancelled';

export interface InvoiceEmailOutbox {
  id: string;
  organisation_id: string;
  company_id: string;
  invoice_id: string;
  document_id: string | null;
  recipient_email: string;
  recipient_name: string;
  subject: string;
  message: string;
  status: InvoiceEmailStatus;
  queued_at: string | null;
  sent_at: string | null;
  error_message: string;
  email_kind?: 'invoice' | 'payment_reminder';
  reminder_level?: number;
  reminder_due_date?: string | null;
  reminder_fee_amount?: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
  invoice?: Invoice | null;
}

export interface AccountingIntegration {
  id: string;
  organisation_id: string;
  company_id: string;
  provider: 'none' | 'spiris' | 'accounted' | 'fortnox' | 'sie' | 'manual';
  status: 'not_configured' | 'active' | 'paused' | 'error';
  enabled?: boolean;
  config: Record<string, unknown>;
  last_sync_at: string | null;
  has_secret?: boolean;
  secret_hint?: string;
  secret_rotated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingAccount {
  id: string;
  organisation_id: string;
  company_id: string;
  account_code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'income' | 'expense' | 'vat' | 'bank' | 'receivable' | 'payable' | 'other';
  default_role: '' | 'customer_receivable' | 'supplier_payable' | 'bank' | 'sales' | 'purchase' | 'output_vat' | 'input_vat';
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VatCode {
  id: string;
  organisation_id: string;
  company_id: string;
  code: string;
  name: string;
  rate: number;
  sales_account_code: string;
  purchase_account_code: string;
  output_vat_account_code: string;
  input_vat_account_code: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceReminderSettings {
  id: string;
  organisation_id: string;
  company_id: string;
  enabled: boolean;
  first_after_days: number;
  interval_days: number;
  max_reminders: number;
  reminder_fee: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
}

export interface FinanceAutomationRun {
  id: string;
  organisation_id: string | null;
  job_key: string;
  status: 'success' | 'failed';
  overdue_updated: number;
  reminders_queued: number;
  emails_processed: number;
  details: Record<string, unknown>;
  error_message: string;
  started_at: string;
  finished_at: string;
  created_at: string;
}

export interface FinanceAutomationSettings {
  id: string;
  organisation_id: string;
  finance_cron_enabled: boolean;
  queue_reminders: boolean;
  send_emails: boolean;
  email_limit: number;
  process_accounting_sync: boolean;
  accounting_sync_limit: number;
  create_rent_billing: boolean;
  rent_billing_months_ahead: number;
  auto_generate_rent_invoices: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AccountingSyncQueueStatus = 'queued' | 'processing' | 'synced' | 'failed' | 'cancelled';
export type AccountingSyncQueueEntityType = 'invoice' | 'payment' | 'customer' | 'supplier' | 'supplier_invoice';
export type AccountingSyncQueueAction = 'upsert' | 'delete' | 'void' | 'payment';

export interface AccountingSyncQueueItem {
  id: string;
  organisation_id: string;
  company_id: string;
  integration_id: string | null;
  entity_type: AccountingSyncQueueEntityType;
  entity_id: string;
  action: AccountingSyncQueueAction;
  status: AccountingSyncQueueStatus;
  payload: Record<string, unknown>;
  external_id: string;
  attempts: number;
  last_attempt_at: string | null;
  synced_at: string | null;
  error_message: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
  integration?: AccountingIntegration | null;
}

export type SupplierInvoiceStatus = 'draft' | 'needs_review' | 'approved' | 'scheduled_for_payment' | 'paid' | 'rejected' | 'archived';
export type SupplierInvoiceApprovalStatus = 'not_started' | 'pending' | 'approved' | 'rejected';
export type SupplierInvoicePaymentStatus = 'unpaid' | 'scheduled' | 'paid';
export type SupplierInvoiceOcrStatus = 'not_started' | 'uploaded' | 'queued' | 'extracting_text' | 'ocr_processing' | 'ai_processing' | 'validating' | 'processed' | 'needs_review' | 'completed' | 'failed';
export type SupplierInvoiceDocumentKind = 'supplier_invoice' | 'receipt';

export interface SupplierInvoice {
  id: string;
  organisation_id: string;
  company_id: string;
  supplier_id: string | null;
  supplier_invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  document_kind?: SupplierInvoiceDocumentKind;
  status: SupplierInvoiceStatus;
  accounting_status?: InvoiceAccountingStatus;
  approval_status: SupplierInvoiceApprovalStatus;
  payment_status: SupplierInvoicePaymentStatus;
  subtotal_amount: number;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  payment_reference: string;
  payment_exported_at: string | null;
  payment_export_id: string;
  ocr_status: SupplierInvoiceOcrStatus;
  ocr_data: Record<string, unknown>;
  extracted_text?: string;
  ocr_provider?: string;
  ai_model?: string;
  ai_call_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  ocr_pages?: number;
  estimated_cost_sek?: number;
  processing_attempts?: number;
  processing_started_at?: string | null;
  processing_finished_at?: string | null;
  validation_results?: Record<string, unknown>;
  confidence?: Record<string, unknown>;
  final_data?: Record<string, unknown>;
  duplicate_supplier_invoice_id?: string | null;
  project_id?: string | null;
  work_order_id?: string | null;
  property_id?: string | null;
  vehicle_id?: string | null;
  cost_center?: string;
  document_id: string | null;
  assigned_approver_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string;
  external_accounting_id: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  company?: FinanceCompany | null;
  supplier?: FinanceSupplier | null;
  document?: { id: string; storage_bucket: string | null; storage_path: string | null } | null;
}

export interface OcrUsageLog {
  id: string;
  organisation_id: string;
  company_id: string | null;
  supplier_invoice_id: string | null;
  document_id: string | null;
  document_kind: SupplierInvoiceDocumentKind | 'unknown';
  ocr_provider: string;
  ai_model: string;
  extraction_method: string;
  ai_call_count: number;
  input_tokens: number;
  output_tokens: number;
  ocr_pages: number;
  vision_fallback_used: boolean;
  estimated_cost_sek: number;
  processing_ms: number;
  retries: number;
  status: 'completed' | 'failed' | 'needs_review';
  error_message: string;
  created_at: string;
  company?: FinanceCompany | null;
}

export interface SupplierInvoiceLine {
  id: string;
  organisation_id: string;
  company_id: string;
  supplier_invoice_id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  account_code: string;
  project_id: string | null;
  work_order_id: string | null;
  line_total_excl_vat: number;
  vat_amount: number;
  line_total_incl_vat: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type RentBillingRunStatus = 'draft' | 'generated' | 'approved' | 'sent' | 'cancelled';
export type RentBillingItemStatus = 'draft' | 'invoiced' | 'skipped' | 'cancelled';

export interface RentBillingRun {
  id: string;
  organisation_id: string;
  company_id: string;
  rent_period: string;
  due_date: string;
  status: RentBillingRunStatus;
  invoice_count: number;
  total_amount: number;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
}

export interface RentBillingItem {
  id: string;
  organisation_id: string;
  company_id: string;
  run_id: string;
  tenancy_id: string;
  tenant_id: string;
  property_id: string | null;
  apartment_id: string | null;
  finance_customer_id: string | null;
  invoice_id: string | null;
  rent_period: string;
  due_date: string;
  description: string;
  amount: number;
  base_rent_amount?: number;
  adjustment_amount?: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  status: RentBillingItemStatus;
  skip_reason: string;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
  tenant?: Profile | null;
  property?: Property | null;
  apartment?: Apartment | null;
  invoice?: Invoice | null;
}

export interface RentAdjustment {
  id: string;
  organisation_id: string;
  company_id: string;
  tenancy_id: string;
  rent_period: string;
  adjustment_type: 'one_time' | 'recurring' | 'indexed';
  start_period: string | null;
  end_period: string | null;
  description: string;
  amount: number;
  percentage_rate: number;
  vat_rate: number;
  status: 'active' | 'cancelled' | 'applied';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
  tenancy?: Tenancy | null;
}

export interface DirectDebitMandate {
  id: string;
  organisation_id: string;
  company_id: string;
  tenancy_id: string;
  tenant_id: string | null;
  finance_customer_id: string | null;
  mandate_reference: string;
  bankgiro_number: string;
  payer_number: string;
  account_holder: string;
  account_mask: string;
  status: 'draft' | 'pending_signature' | 'active' | 'paused' | 'cancelled' | 'rejected';
  signed_at: string | null;
  activated_at: string | null;
  cancelled_at: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company?: FinanceCompany | null;
  tenancy?: Tenancy | null;
  tenant?: Profile | null;
  finance_customer?: FinanceCustomer | null;
}

// ── Jour (on-call: fastighetsjour / snöjour) ────────────────────────────
// One data model, duty_type as a field on every row -- a person can hold
// BOTH types at once (two separate rows), never two overlapping shifts of
// the SAME type (enforced by a real Postgres EXCLUDE constraint, see
// migration 20260826100000_jour_module.sql).

export type JourDutyType = 'fastighet' | 'sno' | 'stad';

export interface JourEligibility {
  id: string;
  organisation_id: string;
  user_id: string;
  duty_type: JourDutyType;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A single independent recurring rule: `user_id` has this duty_type
 * every `interval_weeks` weeks, for `duration_weeks` weeks, starting
 * from `start_date`. Multiple rules can target the same person (e.g.
 * "var 3:e vecka" + "var 6:e vecka" as two separate rows) -- when their
 * occurrences land adjacent in time this naturally produces two
 * consecutive weeks for that person, which is the point: this replaces
 * the earlier single-shared-cycle "rotation template" model with
 * independent rules precisely so that kind of pattern is expressible. */
export interface JourRotationRule {
  id: string;
  organisation_id: string;
  duty_type: JourDutyType;
  /** null = obemannad regel -- varje genererat tillfälle blir ett
   * obemannat, plockbart pass (en automatiskt skapad öppen annons)
   * istället för tilldelat till en fast person. */
  user_id: string | null;
  name: string;
  start_date: string;
  interval_weeks: number;
  /** Antal dagar (inte nödvändigtvis hela veckor) varje tillfälle
   * varar, t.ex. 2 för ett helg-mönster (lördag-söndag). */
  duration_days: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JourShift {
  id: string;
  organisation_id: string;
  duty_type: JourDutyType;
  /** null = obemannat (open) -- claimable by anyone eligible, whole or
   * in part, via a swap offer. See vihem_before_jour_swap_offer_update()
   * in the jour migrations for why claiming part of an unassigned shift
   * leaves the remainder(s) unassigned AND re-offered, unlike claiming
   * part of a normally assigned shift (which reverts to the owner). */
  user_id: string | null;
  starts_at: string;
  ends_at: string;
  source: 'manual' | 'template';
  rotation_rule_id: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  user?: Pick<Profile, 'id' | 'name'> | null;
}

export type JourSwapOfferStatus = 'open' | 'claimed' | 'cancelled' | 'expired';

export interface JourSwapOffer {
  id: string;
  organisation_id: string;
  shift_id: string;
  offered_by: string;
  allow_partial: boolean;
  note: string;
  status: JourSwapOfferStatus;
  /** The advertised sub-range of the shift, if the offerer chose to
   * offer less than the whole thing -- null means "the whole shift". */
  offer_start_at: string | null;
  offer_end_at: string | null;
  claimed_by: string | null;
  claim_start_at: string | null;
  claim_end_at: string | null;
  claimed_shift_id: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  shift?: JourShift | null;
  offerer?: Pick<Profile, 'id' | 'name'> | null;
}

// ── Fleet Manager ─────────────────────────────────────────────────────

export type FleetAssetType = 'car' | 'van' | 'truck' | 'trailer' | 'excavator' | 'tractor' | 'implement' | 'other';
export type FleetVehicleStatus = 'in_service' | 'workshop' | 'out_of_service' | 'driving_ban' | 'laid_up' | 'rented_out' | 'sold';
export type FleetFinancingType = 'owned' | 'leasing' | 'loan' | 'rental';
export type FleetFuelType = 'petrol' | 'diesel' | 'electric' | 'hybrid' | 'hvo' | 'other';
export type FleetRegistrationStatus = 'registered' | 'deregistered' | 'not_applicable';
export type FleetDamageSeverity = 'info' | 'should_fix' | 'urgent' | 'no_use';
export type FleetDamageStatus = 'open' | 'converted' | 'resolved' | 'dismissed';
export type FleetMeterReadingType = 'odometer' | 'engine_hours';
export type FleetMeterSource = 'manual' | 'telematics' | 'service' | 'import';
export type FleetTireSeason = 'summer' | 'winter' | 'all_season';
export type FleetTirePosition = 'front_left' | 'front_right' | 'rear_left' | 'rear_right' | 'spare' | 'storage';
export type FleetCostType = 'service' | 'repair' | 'parts' | 'tires' | 'insurance' | 'tax' | 'leasing' | 'inspection' | 'fuel' | 'charging' | 'other';
export type FleetInspectionResult = 'passed' | 'passed_with_remarks' | 'failed';
export type FleetTelematicsProvider = 'teltonika' | 'generic_obd' | 'generic_gps' | 'other';
export type FleetTelematicsStatus = 'online' | 'offline' | 'unknown';

export interface FleetVehicle {
  id: string;
  organisation_id: string;
  company_id: string | null;
  asset_type: FleetAssetType;
  registration_number: string;
  internal_number: string;
  name: string;
  make: string;
  model: string;
  model_year: number | null;
  vin: string;
  serial_number: string;
  responsible_user_id: string | null;
  property_id: string | null;
  inventory_location_id: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  financing_type: FleetFinancingType;
  financing_notes: string;
  current_odometer: number;
  odometer_unit: 'km' | 'mil';
  engine_hours: number;
  fuel_type: FleetFuelType;
  registration_status: FleetRegistrationStatus;
  status: FleetVehicleStatus;
  image_url: string;
  notes: string;
  documents: AttachmentItem[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  responsible?: Pick<Profile, 'id' | 'name'> | null;
  company?: { id: string; name: string } | null;
  property?: Pick<Property, 'id' | 'name'> | null;
}

export interface FleetDamageReport {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  reported_by: string | null;
  description: string;
  severity: FleetDamageSeverity;
  usable: boolean;
  status: FleetDamageStatus;
  work_order_id: string | null;
  photos: string[];
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  reporter?: Pick<Profile, 'id' | 'name'> | null;
  vehicle?: Pick<FleetVehicle, 'id' | 'name' | 'registration_number'> | null;
}

export interface FleetServiceSchedule {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  name: string;
  interval_km: number | null;
  interval_hours: number | null;
  interval_months: number | null;
  last_done_at: string | null;
  last_done_odometer: number | null;
  last_done_hours: number | null;
  next_due_date: string | null;
  next_due_odometer: number | null;
  next_due_hours: number | null;
  active: boolean;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetServiceRecord {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  schedule_id: string | null;
  performed_at: string;
  odometer: number | null;
  engine_hours: number | null;
  performed_by_text: string;
  cost: number | null;
  work_order_id: string | null;
  description: string;
  documents: string[];
  created_by: string | null;
  created_at: string;
}

export interface FleetInspection {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  inspection_type: string;
  interval_months: number | null;
  last_inspection_date: string | null;
  next_inspection_date: string | null;
  result: FleetInspectionResult | null;
  performed_by_text: string;
  cost: number | null;
  document_url: string;
  notes: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetMeterReading {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  reading_type: FleetMeterReadingType;
  value: number;
  source: FleetMeterSource;
  recorded_at: string;
  recorded_by: string | null;
  notes: string;
  created_at: string;
  recorder?: Pick<Profile, 'id' | 'name'> | null;
}

export interface FleetTire {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  season: FleetTireSeason;
  dimension: string;
  brand: string;
  dot: string;
  tread_depth_mm: number | null;
  position: FleetTirePosition | null;
  mounted: boolean;
  storage_location: string;
  mounted_at: string | null;
  mounted_odometer: number | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetCost {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  cost_type: FleetCostType;
  amount: number;
  currency: string;
  cost_date: string;
  description: string;
  work_order_id: string | null;
  supplier_invoice_id: string | null;
  service_record_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface FleetChecklistTemplate {
  id: string;
  organisation_id: string;
  asset_type: FleetAssetType | null;
  name: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetChecklistTemplateItem {
  id: string;
  template_id: string;
  sort_order: number;
  label: string;
  created_at: string;
}

export interface FleetChecklistRun {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  template_id: string | null;
  template_name_snapshot: string;
  performed_by: string | null;
  performed_at: string;
  notes: string;
  created_at: string;
  performer?: Pick<Profile, 'id' | 'name'> | null;
}

export interface FleetChecklistRunItem {
  id: string;
  run_id: string;
  label_snapshot: string;
  ok: boolean;
  damage_report_id: string | null;
  created_at: string;
}

export interface FleetTelematicsDevice {
  id: string;
  organisation_id: string;
  vehicle_id: string | null;
  provider: FleetTelematicsProvider;
  device_model: string;
  imei: string;
  sim_number: string;
  status: FleetTelematicsStatus;
  last_contact_at: string | null;
  api_key: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FleetEvent {
  id: string;
  organisation_id: string;
  vehicle_id: string;
  event_type: string;
  summary: string;
  metadata: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
  actor?: Pick<Profile, 'id' | 'name'> | null;
}
