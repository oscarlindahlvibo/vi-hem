export async function createFixture(db) {
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.vihem_organisations(id uuid primary key);
create table public.vihem_profiles(id uuid primary key,organisation_id uuid,role text,active boolean);
create table public.vihem_properties(id uuid primary key,organisation_id uuid,address text,city text,zip text,active boolean);
create table public.vihem_apartments(id uuid primary key,property_id uuid,organisation_id uuid,status text,rent numeric,size numeric,rooms numeric,apartment_number text,unit_type text);
create table public.vihem_tenancies(id uuid primary key,apartment_id uuid,organisation_id uuid,start_date date,end_date date,status text);
create table public.vihem_termination_requests(id uuid primary key,tenancy_id uuid,organisation_id uuid,status text,requested_move_out_date date);
create table public.vihem_agreements(id uuid primary key,organisation_id uuid,status text,document_type text);
create table public.vihem_agreement_entity_links(agreement_id uuid,entity_type text,entity_id uuid);
create table public.vihem_agreement_versions(agreement_id uuid,version_number integer,blocks jsonb);
create table public.other_app_data(id integer primary key,value text); insert into other_app_data values(1,'untouched');
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid,bucket_id text); alter table storage.objects enable row level security;
`);
}
