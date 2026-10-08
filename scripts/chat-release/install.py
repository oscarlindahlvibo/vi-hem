#!/usr/bin/env python3
"""Self-hosted VI-HEM chat release. Default: read-only preflight.
--rehearse compiles pending migrations in one rolled-back transaction.
--apply is the operator's explicit manual production deployment.
No credentials in this package; Docker's existing environment is reused.
"""
import argparse, base64, datetime, fcntl, gzip, hashlib, hmac, json, os, re, shutil, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
group = p.add_mutually_exclusive_group()
for mode in ['--check', '--rehearse', '--apply']:
    group.add_argument(mode, dest='mode', action='store_const', const=mode)
p.set_defaults(mode='--check')
import sys
args = p.parse_args()
root = Path(__file__).resolve().parent
manifest = json.loads((root / 'release.json').read_text())
os.environ['DOCKER_HOST'] = 'unix:///run/user/1000/docker.sock'
volume = Path('/home/vibo/atm-personal-supabase/volumes')
ledger = volume / 'deploy-state/applied-migrations.tsv'
web = Path('/var/www/app.vi-hem.se/html')
base = ['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']

def run(command, **kwargs):
    r = subprocess.run(command, capture_output=True, **kwargs)
    if r.returncode:
        raise RuntimeError('Command failed: ' + command[0] + ' (output withheld to protect server credentials)')
    return r.stdout

def sql(query):
    return run(base, input=query, text=True).strip()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def atomic_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.vihem-chat-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(source.read_bytes()); f.flush(); os.fsync(f.fileno())
        os.chmod(name, 0o644)
        os.replace(name, target)
    finally:
        if os.path.exists(name): os.unlink(name)

for name, digest in manifest['files'].items():
    if Path(name).is_absolute() or '..' in Path(name).parts or sha(root / name) != digest:
        raise SystemExit('Package checksum/path mismatch: ' + name)
refs = dict(line.split()[::-1] for line in run(['git', 'ls-remote', 'https://github.com/oscarlindahlvibo/vi-hem.git', 'refs/heads/main', 'refs/heads/codex/chat-modernisation'], text=True).splitlines())
if refs.get('refs/heads/main') != manifest['base_main'] or refs.get('refs/heads/codex/chat-modernisation') != manifest['source_commit']:
    raise SystemExit('GitHub changed since packaging. Reconcile Claude/main and rebuild this package first.')
if not web.is_dir() or web.is_symlink() or sha(web / 'index.html') not in [manifest['previous_index'], manifest['files']['admin/index.html']]:
    raise SystemExit('Live frontend changed; re-review and rebuild.')
for name, before in manifest['server_files'].items():
    target = volume / 'functions' / name
    after = manifest['files'].get('backend/' + name)
    actual = sha(target) if target.exists() else None
    if actual not in [before, after]: raise SystemExit('Server file changed: ' + name)

inspect = json.loads(run(['docker', 'inspect', 'supabase-edge-functions'], text=True))[0]
env = dict(item.split('=', 1) for item in inspect['Config']['Env'] if '=' in item)
if not all(env.get(k) for k in ['APNS_AUTH_KEY', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_TOPIC']):
    raise SystemExit('APNs configuration missing; no deployment performed.')
if env.get('VERIFY_JWT') == 'true':
    raise SystemExit('Global edge JWT gate would block the existing push-secret dispatch.')
if env['APNS_TOPIC'] != 'se.vihem.app' or env.get('APNS_ENVIRONMENT') != 'production':
    raise SystemExit('APNs topic/environment differs from approved iPhone release.')
limits = json.loads(sql("SELECT row_to_json(t) FROM (SELECT external_id,max_events_per_second,max_concurrent_users,max_channels_per_client FROM _realtime.tenants WHERE external_id='realtime-dev') t"))
if limits != manifest['previous_realtime'] and limits != {**manifest['previous_realtime'], 'max_events_per_second': 1000}:
    raise SystemExit('Shared Realtime settings changed; review them first.')
if sql("SELECT EXISTS(SELECT 1 FROM public.vihem_system_settings WHERE key='push_notification_dispatch' AND length(value->>'secret')>0)") != 't':
    raise SystemExit('Push dispatch setting missing.')
print('PASS: checksums, GitHub, frontend/backend baselines, APNs and Realtime settings. Android push remains excluded until Firebase is configured.')

# Use the existing host ledger and a transactional database journal. The latter
# handles a process crash between PostgreSQL COMMIT and the filesystem write.
with ledger.open('r+') as state:
    fcntl.flock(state, fcntl.LOCK_EX)
    old = state.read()
    records = dict(line.split('\t', 1) for line in old.splitlines() if '\t' in line)
    journal_exists = sql("SELECT to_regclass('public.vihem_chat_release_journal') IS NOT NULL") == 't'
    journal = json.loads(sql("SELECT coalesce(json_object_agg(name,sha256),'{}') FROM public.vihem_chat_release_journal")) if journal_exists else {}
    migrations = manifest['migrations']
    for name in migrations:
        digest = manifest['files']['migrations/' + name]
        for known in [records.get('vi-hem/' + name), journal.get(name)]:
            if known is not None and known != digest: raise SystemExit('Migration checksum conflict: ' + name)
        if ('vi-hem/' + name in records) != (name in journal):
            if name not in journal: raise SystemExit('Ledger has migration without transactional journal; manual review required.')
    if len(journal) not in [0, len(migrations)] or any(name not in migrations for name in journal):
        raise SystemExit('Partial/unexpected chat release; manual review required.')
    if not journal and sql("SELECT to_regprocedure('public.vihem_chat_same_org(uuid)') IS NOT NULL") == 't':
        raise SystemExit('Unjournaled chat schema already exists; do not rerun non-idempotent migrations.')
    migration_sql = '''BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(hashtext('vihem-chat-release'));
CREATE TABLE IF NOT EXISTS public.vihem_chat_release_journal(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.vihem_chat_release_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_chat_release_journal FROM PUBLIC,anon,authenticated;
CREATE TEMP TABLE original_chat_history AS SELECT id,thread_id,sender_id,message,created_at,attachment_url FROM public.vihem_chat_messages;
'''
    if not journal:
        for name in migrations:
            source = (root / 'migrations' / name).read_text().strip()
            if not source.startswith('BEGIN;') or not source.endswith('COMMIT;'): raise SystemExit('Unexpected migration transaction boundary.')
            migration_sql += source[len('BEGIN;'):-len('COMMIT;')] + '\n'
            migration_sql += "INSERT INTO public.vihem_chat_release_journal(name,sha256) VALUES ('" + name + "','" + manifest['files']['migrations/' + name] + "');\n"
    migration_sql += '''DO $$ BEGIN
IF EXISTS(SELECT 1 FROM original_chat_history old LEFT JOIN public.vihem_chat_messages current USING(id) WHERE current.id IS NULL OR (old.thread_id,old.sender_id,old.message,old.created_at,old.attachment_url) IS DISTINCT FROM (current.thread_id,current.sender_id,current.message,current.created_at,current.attachment_url)) THEN RAISE EXCEPTION 'Original history changed'; END IF;
IF has_table_privilege('authenticated','public.vihem_chat_messages','INSERT') THEN RAISE EXCEPTION 'Unsafe legacy message writes'; END IF;
IF EXISTS(SELECT 1 FROM (VALUES ('vihem_chat_threads'),('vihem_chat_messages'),('vihem_chat_participants'),('vihem_chat_reactions'),('vihem_chat_activity'),('vihem_notifications')) required(name) WHERE NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=required.name)) THEN RAISE EXCEPTION 'Realtime publication missing'; END IF;
IF EXISTS(SELECT 1 FROM storage.buckets WHERE id IN ('vihem-chat-private','vihem-chat-workorder-private') AND public) THEN RAISE EXCEPTION 'Public private bucket'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
'''
    if args.mode == '--check':
        print('PASS: read-only deployment preflight. Nothing changed.'); sys.exit(0)
    if args.mode == '--rehearse':
        sql(migration_sql + 'ROLLBACK;')
        print('PASS: all pending migrations and history/publication/grants compiled in one ROLLED-BACK transaction.'); sys.exit(0)
    if os.geteuid() != 0: raise SystemExit('Run --apply with sudo for protected backups and web publication.')
    # Every apply has a full DB backup, readable archive inventory, previous web
    # and changed edge files. Do not automatically restore a shared database.
    backup = Path('/var/backups/vi-hem') / ('chat-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + str(os.getpid()))
    backup.mkdir(mode=0o700, parents=True)
    with (backup / 'postgres.dump').open('wb') as f:
        r = subprocess.run(['docker','exec','supabase-db','pg_dump','-U','postgres','-d','postgres','-Fc'],stdout=f,stderr=subprocess.PIPE)
    if r.returncode: raise SystemExit('Database backup failed; nothing deployed.')
    (backup / 'postgres.dump').chmod(0o600)
    run(['docker','exec','-i','supabase-db','pg_restore','--list'],input=(backup / 'postgres.dump').read_bytes())
    shutil.copytree(web, backup / 'html')
    shutil.copyfile(ledger, backup / 'applied-migrations.tsv')
    for name in manifest['server_files']:
        target = volume / 'functions' / name
        if target.exists():
            dest = backup / 'functions' / name; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(target, dest)
    # Storage files are unchanged by this deployment. The separate legacy
    # cutover copies/verifies original bytes and must be run only AFTER rollout.
    sql(migration_sql + 'COMMIT;')
    for name in migrations:
        if 'vi-hem/' + name not in records:
            state.seek(0,2); state.write(('\n' if old and not old.endswith('\n') else '') + 'vi-hem/' + name + '\t' + manifest['files']['migrations/' + name] + '\n'); old += '\n'
    state.flush(); os.fsync(state.fileno())
    for name in manifest['backend_files']:
        atomic_copy(root / 'backend' / name, volume / 'functions' / name)
    # Warm edge workers cache modules; restart only this existing edge service.
    # Other shared files and all databases/Storage/Auth are preserved.
    run(['docker','restart','supabase-edge-functions'])
    # Require new workers to reject unauthenticated requests, not return a
    # missing module or an unprotected success. No user messages are created.
    for function in ['vihem-chat-upload', 'vihem-chat-to-workorder', 'vihem-send-push']:
        accepted = False
        for attempt in range(15):
            try:
                request = urllib.request.Request('https://supabase.asedatruckmeet.se/functions/v1/' + function, data=b'{}',headers={'Content-Type':'application/json'},method='POST')
                urllib.request.urlopen(request,timeout=15).close()
                raise SystemExit('Unauthenticated edge probe unexpectedly succeeded: ' + function)
            except urllib.error.HTTPError as error:
                if error.code == 401: accepted=True; break
            except (urllib.error.URLError, TimeoutError): pass
            time.sleep(1)
        if not accepted: raise SystemExit('New worker failed authentication/startup probe: ' + function + '. Backend remains installed; investigate and rerun.')
    if limits['max_events_per_second'] != 1000:
        rt = json.loads(run(['docker','inspect','realtime-dev.supabase-realtime'],text=True))[0]
        rt_env = dict(x.split('=',1) for x in rt['Config']['Env'] if '=' in x)
        secret = rt_env['API_JWT_SECRET']
        encode = lambda obj: base64.urlsafe_b64encode(json.dumps(obj,separators=(',',':')).encode()).decode().rstrip('=')
        unsigned = encode({'alg':'HS256','typ':'JWT'}) + '.' + encode({'role':'service_role','exp':int(time.time())+60})
        signature = base64.urlsafe_b64encode(hmac.new(secret.encode(),unsigned.encode(),hashlib.sha256).digest()).decode().rstrip('=')
        # Rootless Docker container IPs are not reachable from this host.
        # Run the admin request inside the existing Realtime container. The
        # short-lived JWT is passed on stdin, never in process arguments.
        curl_config = 'header = "Authorization: Bearer ' + unsigned + '.' + signature + '"\n'
        body = json.dumps({'tenant':{'max_events_per_second':1000}})
        result = json.loads(run(['docker','exec','-i','realtime-dev.supabase-realtime','curl','--fail','--silent','--show-error','--max-time','30','--config','-','-H','Content-Type: application/json','-X','PUT','--data',body,'http://127.0.0.1:4000/api/tenants/realtime-dev'],input=curl_config,text=True))
        applied = result.get('data',result)
        if applied.get('max_events_per_second') != 1000:
            raise SystemExit('Realtime API update not confirmed; backend installed, web not yet published. Resolve and re-run.')
        for name in ['max_concurrent_users','max_channels_per_client']:
            if applied.get(name) != limits[name]: raise SystemExit('Realtime API unexpectedly changed another limit.')
    # Publish assets first, index last. Retain old hashes for existing clients.
    for source in (root / 'admin').rglob('*'):
        if source.is_file() and source.name != 'index.html': atomic_copy(source, web / source.relative_to(root / 'admin'))
    atomic_copy(root / 'admin/index.html', web / 'index.html')
    for relative in ['index.html', *re.findall(r'(?:src|href)="(/assets/[^\"]+)"',(root / 'admin/index.html').read_text())]:
        relative = relative.lstrip('/')
        with urllib.request.urlopen('https://app.vi-hem.se/' + relative + '?chat_release=' + manifest['source_commit'],timeout=30) as response: actual = hashlib.sha256(response.read()).hexdigest()
        if actual != manifest['files']['admin/' + relative]: raise SystemExit('HTTP publication verification failed. New backend remains installed; repair the new web release, do not restore an incompatible old client.')
    print('PASS: backend, ledger, Realtime limit and web published. Backup:', backup)
    print('Physical iPhone smoke test and later Android Firebase/device tests still required. No message was sent by this installer.')
