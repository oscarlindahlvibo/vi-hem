/*
  # Add Apartment Inspections and Contract Signatures

  1. New Tables
    - `apartment_inspections`
      - `id` (uuid, primary key)
      - `apartment_id` (uuid, FK to apartments)
      - `property_id` (uuid, FK to properties)
      - `tenancy_id` (uuid, nullable FK to tenancies)
      - `inspection_type` (text: move_in | move_out | routine | complaint)
      - `inspection_date` (date)
      - `inspector_id` (uuid, FK to profiles - staff member)
      - `tenant_present` (boolean)
      - `overall_condition` (text: excellent | good | fair | poor)
      - `rooms` (jsonb array of room observations)
      - `notes` (text)
      - `action_required` (text)
      - `document_id` (uuid, nullable FK to documents - the generated PDF)
      - `status` (text: draft | completed)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `contract_signatures`
      - `id` (uuid, primary key)
      - `tenancy_id` (uuid, FK to tenancies)
      - `document_id` (uuid, nullable FK to documents)
      - `created_by` (uuid, FK to profiles - staff who created it)
      - `tenant_id` (uuid, FK to profiles)
      - `contract_content` (text - HTML/text of the contract)
      - `tenant_signed_at` (timestamptz, nullable)
      - `tenant_signature` (text, nullable - drawn signature data URL)
      - `staff_signed_at` (timestamptz, nullable)
      - `staff_signature` (text, nullable)
      - `status` (text: draft | pending_tenant | signed | cancelled)
      - `valid_until` (date, nullable)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Staff/admin/superadmin can insert, update inspections
    - Tenants can view their own inspection reports
    - Staff/admin can view all inspections
    - Tenants can view and sign their own contracts
    - Staff/admin can view and manage all contracts
*/

CREATE TABLE IF NOT EXISTS apartment_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apartment_id uuid NOT NULL REFERENCES apartments(id),
  property_id uuid REFERENCES properties(id),
  tenancy_id uuid REFERENCES tenancies(id),
  inspection_type text NOT NULL DEFAULT 'routine' CHECK (inspection_type = ANY (ARRAY['move_in', 'move_out', 'routine', 'complaint'])),
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  inspector_id uuid NOT NULL REFERENCES profiles(id),
  tenant_present boolean DEFAULT false,
  overall_condition text DEFAULT 'good' CHECK (overall_condition = ANY (ARRAY['excellent', 'good', 'fair', 'poor'])),
  rooms jsonb DEFAULT '[]'::jsonb,
  notes text DEFAULT '',
  action_required text DEFAULT '',
  document_id uuid REFERENCES documents(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft', 'completed'])),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE apartment_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all inspections"
  ON apartment_inspections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
    OR
    EXISTS (
      SELECT 1 FROM tenancies
      WHERE tenancies.id = apartment_inspections.tenancy_id
      AND tenancies.tenant_id = auth.uid()
    )
  );

CREATE POLICY "Staff can insert inspections"
  ON apartment_inspections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

CREATE POLICY "Staff can update inspections"
  ON apartment_inspections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

-- Contract signatures table
CREATE TABLE IF NOT EXISTS contract_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES tenancies(id),
  document_id uuid REFERENCES documents(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  tenant_id uuid NOT NULL REFERENCES profiles(id),
  contract_content text DEFAULT '',
  tenant_signed_at timestamptz,
  tenant_signature text,
  staff_signed_at timestamptz,
  staff_signature text,
  status text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft', 'pending_tenant', 'signed', 'cancelled'])),
  valid_until date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants can view own contracts"
  ON contract_signatures FOR SELECT
  TO authenticated
  USING (
    tenant_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

CREATE POLICY "Staff can insert contracts"
  ON contract_signatures FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

CREATE POLICY "Staff and tenants can update contracts"
  ON contract_signatures FOR UPDATE
  TO authenticated
  USING (
    tenant_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  )
  WITH CHECK (
    tenant_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );
