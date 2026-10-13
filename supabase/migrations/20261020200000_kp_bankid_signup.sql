-- BankID-baserad kontoskapande: efter lyckad BankID utan kopplat konto sparas den verifierade identiteten kort på ordern
-- (krypterat personnummer + nyckelad hash), så att personen kan skapa konto med bara en e-postadress. Ordern förbrukas vid kontoskapande.
begin;
alter table public.vihem_kp_bankid_orders add column if not exists pno_hmac text;
alter table public.vihem_kp_bankid_orders add column if not exists pno_enc text;
alter table public.vihem_kp_bankid_orders add column if not exists person_given text;
alter table public.vihem_kp_bankid_orders add column if not exists person_surname text;
alter table public.vihem_kp_bankid_orders add column if not exists completed_at timestamptz;
commit;
