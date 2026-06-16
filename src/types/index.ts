export type Role = 'tenant' | 'staff' | 'admin' | 'superadmin';

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
  assigned_to: string | null;
  assigned_to_ids: string[];
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  due_date: string | null;
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
  is_active: boolean;
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
  channel_number: number | null;
  channel_name: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  is_manual: boolean;
  booking_type: ShortStayBookingType;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  guest_count: number;
  payment_status: ShortStayPaymentStatus;
  cleaning_status: ShortStayCleaningStatus;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  unit?: ShortStayUnit;
}

export type TimeCategory = 'general' | 'work_order' | 'maintenance' | 'customer_project' | 'admin' | 'travel' | 'shopping' | 'standby' | 'other';
export type TimeStatus = 'draft' | 'submitted' | 'change_requested' | 'approved' | 'rejected';
export type TimeEntryType = 'work' | 'break';
export type StaffAbsenceType = 'sick' | 'vab' | 'vacation' | 'leave' | 'unpaid_leave';
export type StaffAbsenceStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface TimeEntry {
  id: string;
  user_id: string;
  work_order_id: string | null;
  maintenance_request_id: string | null;
  property_id: string | null;
  customer_project_id: string | null;
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
  tenant_id: string;
  status: 'active' | 'cancelled';
  created_at: string;
  slot?: LaundrySlot;
  tenant?: Profile;
}

export interface Document {
  id: string;
  organisation_id: string | null;
  title: string;
  file_url: string;
  file_name: string;
  file_size: number;
  document_type: 'contract' | 'rules' | 'inspection' | 'invoice' | 'other';
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
