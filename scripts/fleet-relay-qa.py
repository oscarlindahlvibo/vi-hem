"""Run in isolated QA Docker network only. HTTP adapter below is deliberately test-only;
production relay.deliver enforces HTTPS and rejects redirects.
"""
import json,os,urllib.request,psycopg
import relay
url=os.environ['VIHEM_INGEST_URL'];assert url=='http://vihem-fleet-gps-edge:9000/vihem-fleet-ingest'

def actual(payload):
    req=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['FLEET_TRACCAR_SECRET'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as response:
        result=json.load(response);assert result['status'] in ['stored','historical','duplicate','no_fix']
    return result

with psycopg.connect(os.environ['TRACCAR_RELAY_DSN'],autocommit=True) as db:
    assert db.execute('SELECT count(*) FROM vihem_outbox').fetchone()[0]>=4
    once=[False]
    def lost_ack(payload):
        actual(payload)
        if not once[0]:once[0]=True;raise ConnectionError('Synthetic lost acknowledgement after database commit')
    relay.deliver=lost_ack
    relay.run_once(db)
    assert db.execute('SELECT count(*) FROM vihem_outbox WHERE delivered_at IS NULL').fetchone()[0]==1
    db.execute('UPDATE vihem_outbox SET next_attempt_at=now() WHERE delivered_at IS NULL')
    relay.deliver=actual;relay.run_once(db)
    assert db.execute('SELECT count(*) FROM vihem_outbox WHERE delivered_at IS NULL').fetchone()[0]==0
    first=db.execute('SELECT payload FROM vihem_outbox ORDER BY id LIMIT 1').fetchone()[0]
    first['position']['id']+=1000000
    assert actual(first)['status']=='duplicate','Retransmitted AVL with a new Traccar row id must deduplicate too'
    print('PASS decoded Teltonika → durable PostgreSQL outbox → actual QA Edge → Fleet RPC; lost ACK retries without duplicate data; no production GPS or database used')
