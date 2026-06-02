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
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  due_date: string | null;
  checklist: ChecklistItem[];
  materials: MaterialItem[];
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

export interface WorkOrderComment {
  id: string;
  work_order_id: string;
  user_id: string;
  comment: string;
  internal: boolean;
  created_at: string;
  user?: Profile;
}

export type TimeCategory = 'general' | 'work_order' | 'maintenance' | 'customer_project' | 'admin' | 'travel' | 'shopping' | 'standby' | 'other';
export type TimeStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type TimeEntryType = 'work' | 'break';

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
  created_at: string;
  user?: Profile;
  work_order?: WorkOrder;
  property?: Property;
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

export interface CustomerProject {
  id: string;
  name: string;
  customer_name: string;
  description: string;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  created_at: string;
}
