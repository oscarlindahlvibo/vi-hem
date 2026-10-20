"""Durable at-least-once queue, idempotent receiver. No high-water cursor or RAM retry queue.
Payload and IMEI never appear in logs. A failed item backs off, allowing other devices through.
"""
import base64
import json
import os
import time
import urllib.error
import urllib.request
import psycopg


def exchange(payload):
    url = os.environ['VIHEM_INGEST_URL']
    if not url.startswith('https://'):
        raise ValueError('HTTPS required for receiver')
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ['FLEET_TRACCAR_SECRET']})
    # Redirects must not forward the integration secret to another origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        body = json.load(response)
        if response.status != 200:
            raise ValueError('Unexpected acknowledgement')
        return body

def deliver(payload):
    body=exchange(payload)
    if body.get('status') not in ('stored','historical','duplicate','no_fix','maintained'):
        raise ValueError('Unexpected acknowledgement')


def sync_registry(devices):
    """Use supported Traccar API so connected-device caches are invalidated too."""
    base=os.environ['TRACCAR_API_URL'].rstrip('/')
    if base not in ('http://traccar:8082','http://vihem-gps-qa:8082'):
        raise ValueError('Registry API must be on the private Docker network')
    auth=base64.b64encode((os.environ['TRACCAR_ADMIN_EMAIL']+':'+os.environ['TRACCAR_ADMIN_PASSWORD']).encode()).decode()
    def request(path,method='GET',data=None):
        req=urllib.request.Request(base+path,method=method,data=json.dumps(data).encode() if data is not None else None,headers={'Authorization':'Basic '+auth,'Content-Type':'application/json'})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):return None
        with urllib.request.build_opener(NoRedirect).open(req,timeout=15) as response:
            raw=response.read();return json.loads(raw) if raw else None
    existing={d['uniqueId']:d for d in request('/api/devices?all=true')}
    desired={d['imei']:d for d in devices}
    for imei,d in desired.items():
        previous=existing.get(imei)
        if previous:
            if previous.get('disabled') or previous.get('model')!=d['model'] or not previous.get('attributes',{}).get('vihemManaged'):
                updated={**previous,'disabled':False,'model':d['model'],'attributes':{**previous.get('attributes',{}),'vihemManaged':True}}
                request('/api/devices/'+str(previous['id']),'PUT',updated)
        else:
            request('/api/devices','POST',{'name':'VI-HEM GPS '+imei[-4:],'uniqueId':imei,'model':d['model'],'disabled':False,'attributes':{'vihemManaged':True}})
    for imei,d in existing.items():
        if d.get('attributes',{}).get('vihemManaged') and imei not in desired and not d.get('disabled'):
            request('/api/devices/'+str(d['id']),'PUT',{**d,'disabled':True})

def run_once(db):
    # One worker; a transaction advisory lock prevents accidentally running two relay replicas.
    with db.transaction():
        if not db.execute('SELECT pg_try_advisory_xact_lock(981245771)').fetchone()[0]:
            return 0
        rows = db.execute('SELECT id,payload,attempts FROM vihem_outbox WHERE delivered_at IS NULL AND next_attempt_at<=now() ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED').fetchall()
        for ident, payload, attempts in rows:
            try:
                deliver(payload)
                db.execute("UPDATE vihem_outbox SET delivered_at=now(),last_error='' WHERE id=%s", (ident,))
            except Exception as error:
                # Only class/status logged. Never raw HTTP bodies, tokens, DSNs, positions or guest data.
                code = 'HTTP_' + str(error.code) if isinstance(error, urllib.error.HTTPError) else type(error).__name__
                db.execute("UPDATE vihem_outbox SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>%s),last_error=%s WHERE id=%s", (min(3600, 10 * 2 ** min(attempts, 9)), code, ident))
                print('delivery deferred:', code, flush=True)
        return len(rows)


def main():
    maintained = 0
    while True:
        try:
            with psycopg.connect(os.environ['TRACCAR_RELAY_DSN'], autocommit=True) as db:
                while True:
                    if time.monotonic() - maintained > 60:
                        registry=exchange({'action':'registry'})
                        if registry.get('status')!='registry' or not isinstance(registry.get('devices'),list):
                            raise ValueError('Invalid registry response')
                        sync_registry(registry['devices'])
                        deliver({'action': 'maintenance'})
                        maintained = time.monotonic()
                        # Only acknowledged entries expire; rejected/deferred payloads survive for operator repair.
                        days = max(7, min(3650, int(os.environ.get('TRACCAR_RETENTION_DAYS', '90'))))
                        db.execute('SELECT vihem_purge_traccar(%s)', (days,))
                        db.execute('DELETE FROM vihem_outbox WHERE delivered_at<now()-make_interval(days=>%s)', (days,))
                    run_once(db)
                    time.sleep(5)
        except Exception as error:
            print('relay unavailable:', type(error).__name__, flush=True)
            time.sleep(10)


if __name__ == '__main__':
    main()
