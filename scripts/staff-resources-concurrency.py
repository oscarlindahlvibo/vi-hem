"""Run only on vihem-chat-qa-db. Creates UUID-scoped synthetic fixtures, then removes them.
Usage: python3 staff-resources-concurrency.py (on QA Docker host).
"""
import concurrent.futures, json, subprocess, time, uuid
CONTAINER='vihem-chat-qa-db'  # deliberately no production target argument

def sql(text, check=True):
    r=subprocess.run(['docker','exec','-i',CONTAINER,'sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U supabase_admin -d postgres -X -Atq -v ON_ERROR_STOP=1'],input=text,text=True,capture_output=True)
    if check and r.returncode: raise RuntimeError(r.stderr)
    return r
org,user,admin,product,asset,item,location,op=[str(uuid.uuid4()) for _ in range(8)]
created_registry=[]
start="now()+interval '20 days'";end="now()+interval '21 days'"
def claims(who,role='authenticated'):
    return f"select set_config('request.jwt.claims','{json.dumps({'sub':who,'role':role})}',true);select set_config('request.jwt.claim.sub','{who}',true);select set_config('request.jwt.claim.role','{role}',true);set local role {role};"
checkout=f"select public.vihem_resource_checkout('{op}','[{{\"item_id\":\"{item}\",\"location_id\":\"{location}\",\"quantity\":2}}]','[{{\"asset_id\":\"{asset}\",\"product_id\":\"{product}\",\"start_at\":\"2030-01-01T08:00:00Z\",\"end_at\":\"2030-01-02T08:00:00Z\"}}]',null,'QA');"
# Use matching absolute timestamps across sessions, without session-time skew.
start="'2030-01-01T08:00:00Z'::timestamptz";end="'2030-01-02T08:00:00Z'::timestamptz"
customer=f"select public.vihem_rental_create_booking_v2(jsonb_build_array(jsonb_build_object('product_id','{product}','start_at',{start},'end_at',{end},'quantity',1)),'{{\"email\":\"synthetic@example.invalid\"}}','QA','confirmed','', '{{\"enforce_rules\":false}}');"
lock=f"select pg_advisory_xact_lock(hashtextextended('vihem_rental:{product}',0));"

def race(first,second,second_ok):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(sql,first)
        time.sleep(.35)
        b=pool.submit(sql,second,False)
        ra,rb=a.result(),b.result()
    assert ra.returncode==0 and (rb.returncode==0)==second_ok, rb.stderr
    return ra,rb
try:
    for key in ['rental_management','inventory_management']:
        if not sql(f"select module_key from public.vihem_module_registry where module_key='{key}';").stdout.strip():created_registry.append(key)
    sql(f"""begin;
    insert into public.vihem_module_registry(module_key,name) values('rental_management','Uthyrning'),('inventory_management','Lager') on conflict do nothing;
    insert into public.vihem_organisations(id,name,slug) values('{org}','QA Resource Race','qa-resource-race-{org}');
    insert into auth.users(id,email) values('{user}','{user}@example.invalid'),('{admin}','{admin}@example.invalid');
    insert into public.vihem_profiles(id,organisation_id,name,email,role,active) values('{user}','{org}','QA Staff','{user}@example.invalid','staff',true),('{admin}','{org}','QA Admin','{admin}@example.invalid','admin',true) on conflict(id) do update set organisation_id=excluded.organisation_id,role=excluded.role,active=true;
    insert into public.vihem_organisation_modules(organisation_id,module_key,enabled) values('{org}','rental_management',true),('{org}','inventory_management',true) on conflict(organisation_id,module_key) do update set enabled=true;
    insert into public.vihem_rental_products(id,organisation_id,name,slug) values('{product}','{org}','QA Race Machine','qa-race-{product}');
    insert into public.vihem_rental_assets(id,organisation_id,product_id,name,internal_identifier) values('{asset}','{org}','{product}','QA Exemplar','{asset}');
    insert into public.vihem_rental_pricing_rules(organisation_id,product_id,rule_type,price) values('{org}','{product}','daily',10);
    insert into public.vihem_inventory_stock_items(id,organisation_id,article_number,name) values('{item}','{org}','QA-RACE','QA Material');
    insert into public.vihem_inventory_locations(id,organisation_id,name) values('{location}','{org}','QA Shelf');
    insert into public.vihem_inventory_balances(organisation_id,item_id,location_id,quantity) values('{org}','{item}','{location}',10);
    commit;""")
    # Lost response / two requests with SAME operation: only one decrement and reservation.
    race('begin;'+claims(user)+lock+checkout+'select pg_sleep(1);commit;', 'begin;'+claims(user)+checkout+'commit;',True)
    assert sql(f"select quantity from public.vihem_inventory_balances where item_id='{item}';").stdout.strip()=='8.000'
    assert sql(f"select count(*) from public.vihem_resource_reservations where organisation_id='{org}';").stdout.strip()=='1'
    print('PASS simultaneous retry: one reservation and one stock-out')
    # Customer waits behind staff, then cannot take the reserved asset.
    _,r=race('begin;'+claims(user)+lock+'select pg_sleep(1);commit;', 'begin;'+claims(admin)+customer+'commit;',False)
    assert 'E_UNAVAILABLE' in r.stderr or 'tillgäng' in r.stderr or 'ledig' in r.stderr, r.stderr
    print('PASS customer cannot double-book staff reservation')
    sql(f"delete from public.vihem_resource_reservations where organisation_id='{org}';delete from public.vihem_rental_blocks where organisation_id='{org}';delete from public.vihem_resource_operations where organisation_id='{org}';")
    # Reverse: customer creation holds canonical product lock, staff must wait and roll back.
    _,r=race('begin;'+claims(admin)+customer+'select pg_sleep(1);commit;', 'begin;'+claims(user)+checkout+'commit;',False)
    assert 'upptagen' in r.stderr, r.stderr
    assert sql(f"select quantity from public.vihem_inventory_balances where item_id='{item}';").stdout.strip()=='8.000'
    print('PASS staff cannot double-book customer; material balance unchanged')
    sql('begin;'+claims(admin,'service_role')+f"select public.vihem_rental_quote('{product}',{start},{end},1);rollback;")
    print('PASS public backend service role retains price access')
finally:
    sql(f"begin;delete from public.vihem_resource_reservations where organisation_id='{org}';delete from public.vihem_resource_operations where organisation_id='{org}';delete from public.vihem_inventory_transactions where organisation_id='{org}';delete from public.vihem_organisations where id='{org}';delete from auth.users where id in ('{user}','{admin}');commit;")
    for key in created_registry:sql(f"delete from public.vihem_module_registry where module_key='{key}' and not exists(select 1 from public.vihem_organisation_modules where module_key='{key}');")
    print('QA synthetic fixture removed')
