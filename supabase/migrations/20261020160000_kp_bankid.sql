-- Kompetensportalen: BankID (samma leverantör och inställningar som VI-HEM, vihem_bankid_settings).
-- Används för (1) inloggning för konton som kopplat BankID och (2) verifierad identitet (länkning). Personnummer lagras krypterat som tidigare;
-- pno_hmac är en nyckelad hash (HMAC-SHA256) enbart för uppslag vid inloggning och unikhet per organisation.
begin;

alter table public.vihem_kp_participant_identity add column if not exists pno_hmac text;
alter table public.vihem_kp_participant_identity add column if not exists verified_name text;
create unique index if not exists vihem_kp_identity_pno_hmac_uniq on public.vihem_kp_participant_identity (organisation_id, pno_hmac) where pno_hmac is not null;

create table if not exists public.vihem_kp_bankid_orders (
  order_ref text primary key,
  organisation_id uuid not null,
  flow text not null check (flow in ('auth', 'link')),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed', 'cancelled')),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.vihem_kp_bankid_orders enable row level security;
revoke all on public.vihem_kp_bankid_orders from anon, authenticated;

-- Koppla ett BankID-verifierat personnummer till en deltagare. Atomiskt: avvisar om numret redan tillhör en annan person.
create or replace function public.vihem_kp_bankid_link(p_user uuid, p_org uuid, p_pno_enc text, p_last4 text, p_hmac text, p_name text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_other uuid; v_n integer;
begin
  select user_id into v_other from public.vihem_kp_participant_identity where organisation_id = p_org and pno_hmac = p_hmac and user_id <> p_user;
  if v_other is not null then raise exception '[E_CONFLICT] Detta BankID är redan kopplat till ett annat konto.'; end if;
  if not exists (select 1 from public.vihem_kp_participants where user_id = p_user and organisation_id = p_org) then raise exception '[E_NOT_FOUND] Deltagaren finns inte.'; end if;
  insert into public.vihem_kp_participant_identity (user_id, organisation_id, personal_number_enc, last4, pno_hmac, verified_name, legal_basis)
    values (p_user, p_org, p_pno_enc, p_last4, p_hmac, p_name, 'samtycke (BankID-verifiering)')
    on conflict (user_id) do update set personal_number_enc = excluded.personal_number_enc, last4 = excluded.last4, pno_hmac = excluded.pno_hmac, verified_name = excluded.verified_name;
  v_n := public.vihem_kp_verify_identity(p_user, 'bankid', p_user, 'BankID');
  return v_n;
end;
$$;
revoke all on function public.vihem_kp_bankid_link(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.vihem_kp_bankid_link(uuid, uuid, text, text, text, text) to service_role;

commit;
