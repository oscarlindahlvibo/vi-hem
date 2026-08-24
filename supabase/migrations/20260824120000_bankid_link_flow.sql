/*
  # BankID -- self-service "koppla mitt konto till BankID"

  Adds a third vihem_bankid_orders.flow value, 'link', alongside the
  existing 'auth' (unauthenticated login) and 'sign' (contract signing).
  A 'link' order is started by an ALREADY authenticated user (see
  start_link in vihem-bankid/index.ts) purely to get a real,
  BankID-verified personnummer written onto their own profile -- this is
  what makes password-login-then-BankID-login-later possible at all,
  since nothing previously let anyone set
  vihem_profiles.bankid_personal_number themselves.
*/

ALTER TABLE public.vihem_bankid_orders DROP CONSTRAINT IF EXISTS vihem_bankid_orders_flow_check;
ALTER TABLE public.vihem_bankid_orders ADD CONSTRAINT vihem_bankid_orders_flow_check CHECK (flow = ANY (ARRAY['auth'::text, 'sign'::text, 'link'::text]));
