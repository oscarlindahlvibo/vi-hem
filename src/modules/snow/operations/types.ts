export interface Person {
  id: string;
  name: string;
}
export interface Resource extends Person {
  vehicle_id: string | null;
  active: boolean;
  method: "machine" | "hand";
}
export interface Assignment extends Person {
  active: boolean;
  revision: number;
  finance_customer_id: string | null;
  company_id: string | null;
  invoice_reference: string;
  cost_center: string;
  rut_requested: boolean;
}
export interface Candidate {
  user_id: string;
  name: string;
  worked_minutes: number;
}
export interface Duty {
  id: string;
  client_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  planned_user: string | null;
  accepted_user: string | null;
  state: "planned" | "calling" | "accepted" | "working" | "done" | "cancelled";
  activity: string;
  message: string;
  revision: number;
  candidates: Candidate[];
  relief_of: string | null;
}
export interface Invitation {
  id: string;
  duty_id: string;
  user_id: string;
  state: string;
  expires_at: string;
  push_status: string;
}
export interface Price {
  id: string;
  client_id: string | null;
  activity: string;
  kind: string;
  label: string;
  mode: string;
  amount: number;
  vat_rate: number;
  valid_from: string;
  valid_until: string | null;
  from_minutes: number;
  to_minutes: number | null;
  rut_eligible: boolean;
}
export interface Entry {
  id: string;
  user_id: string;
  snow_client_id: string;
  snow_resource_id: string | null;
  snow_duty_id: string | null;
  start_time: string;
  end_time: string | null;
  total_minutes: number;
  category: string;
  status: string;
  snow_review_flags: string[];
  reserved: boolean;
  priced: boolean;
  valuation: BillingLine[] | null;
}
export interface BillingLine {
  entry_id?: string;
  date?: string;
  assignment?: string;
  resource?: string;
  driver?: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  net: number;
  vat: number;
  kind: string;
  rut_eligible: boolean;
  rut_requested?: boolean;
  labor_hours: number;
}
export interface Customer {
  id: string;
  name: string;
  customer_type: string;
  email: string;
  phone: string;
  address_line1: string;
  postal_code: string;
  city: string;
  revision: string;
}
export interface Batch {
  id: string;
  company_id: string;
  customer_id: string;
  reference: string;
  state: string;
  accounted_invoice_id: string | null;
  last_error: string | null;
  snapshot: {
    customer: Customer;
    lines: BillingLine[];
    net: number;
    vat: number;
    gross: number;
    rut: number;
    customer_payable: number;
  };
}
export interface Board {
  server_time: string;
  admin: boolean;
  settings: Record<string, number | boolean>;
  settings_revision: number;
  people: Person[];
  resources: Resource[];
  vehicles: Person[];
  companies: Person[];
  clients: Assignment[];
  competencies: { user_id: string; resource_id: string; active: boolean }[];
  pattern_revisions: Record<string, string>;
  patterns: { user_id: string; weekday: number; slots: [number, number][] }[];
  confirmations: {
    user_id: string;
    week_start: string;
    available: boolean;
    current: boolean;
  }[];
  duties: Duty[];
  invitations: Invitation[];
  entries: Entry[];
  prices: Price[];
  batches: Batch[];
}
export const dutyLabels: Record<Duty["state"], string> = {
  planned: "Planerad · ej bekräftad",
  calling: "Utkallning pågår",
  accepted: "Bekräftad förare",
  working: "Arbete pågår",
  done: "Avslutat",
  cancelled: "Avbokat",
};
export const flagLabels: Record<string, string> = {
  assignment_inactive: "Uppdraget är avslutat eller saknas",
  invalid_duration: "Tiden behöver kontrolleras",
  method_missing: "Arbetsmetod saknas",
  machine_missing: "Maskin saknas",
  overlap: "Överlappande arbetstid",
  manual_edit: "Manuellt ändrat pass",
};
export const kindLabels: Record<string, string> = {
  labor: "Arbetskostnad",
  machine: "Maskinkostnad",
  material: "Material",
  travel: "Framkörning / resa",
  start: "Startavgift",
};
