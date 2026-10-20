"""Server-side, isolated QA database only. Two real sessions ingest the same GPS sample."""
import concurrent.futures,datetime,json,pathlib,subprocess,sys
fixture=pathlib.Path(sys.argv[1]).read_text();db='vihem_chat_qa'
def sql(s):
    r=subprocess.run(['docker','exec','-i','vihem-chat-qa-db','sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U supabase_admin -d '+db+' -X -Atq -v ON_ERROR_STOP=1'],input=s,text=True,capture_output=True)
    if r.returncode:raise RuntimeError(r.stderr[:800])
    return r.stdout.strip()
prefix=fixture[:fixture.index('CREATE FUNCTION pg_temp.point')]
f=json.loads([line for line in sql(prefix+'\nSELECT row_to_json(f) FROM f;COMMIT;').splitlines() if line.startswith('{')][-1])
try:
    p={'imei':'990000000000099','message_id':'concurrent:1','recorded_at':f['stamp'],'received_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'gps_valid':True,'latitude':57.317,'longitude':15.583,'speed_kmh':30,'heading':180,'ignition':True}
    statement="SET ROLE service_role; SELECT public.vihem_fleet_ingest_position('"+json.dumps(p).replace("'","''")+"'::jsonb);"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(sql,[statement,statement]))
    assert sorted(results)==['duplicate','stored'],results
    count=sql("SELECT count(*) FROM public.vihem_fleet_telematics_readings WHERE device_id='"+f['d']+"';")
    assert count=='1',count
    print('PASS concurrent real SQL sessions: one position, one trip, one duplicate ACK; isolated QA only')
finally:
    d=f['d'];v=f['v'];v2=f['v2'];o=f['o'];o2=f['o2']
    sql(f"BEGIN;DELETE FROM public.vihem_fleet_tracking_state WHERE device_id='{d}';DELETE FROM public.vihem_fleet_telematics_readings WHERE device_id='{d}';DELETE FROM public.vihem_fleet_trips WHERE device_id='{d}';DELETE FROM public.vihem_fleet_meter_readings WHERE vehicle_id='{v}';DELETE FROM public.vihem_fleet_events WHERE vehicle_id='{v}';DELETE FROM public.vihem_fleet_telematics_device_assignments WHERE device_id='{d}';DELETE FROM public.vihem_fleet_telematics_devices WHERE id='{d}';DELETE FROM public.vihem_fleet_vehicles WHERE id IN('{v}','{v2}');DELETE FROM public.vihem_organisations WHERE id IN('{o}','{o2}');DELETE FROM auth.users WHERE id IN('{f['a']}','{f['s']}','{f['x']}');COMMIT;")
