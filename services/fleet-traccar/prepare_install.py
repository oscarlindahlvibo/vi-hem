"""Prepare private config only. Does not change PostgreSQL, firewall, DNS or existing services."""
import argparse,pathlib,secrets,shutil,os,re
from xml.sax.saxutils import escape
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--db-host',default='supabase-db');p.add_argument('--db-port',type=int,default=5432);args=p.parse_args()
assert re.fullmatch(r'[a-zA-Z0-9.-]+',args.db_host)
assert 1 <= args.db_port <= 65535
os.umask(0o077);out=pathlib.Path(args.output);out.mkdir(mode=0o700,parents=True,exist_ok=False)
source=pathlib.Path(__file__).parent
for name in ('compose.yaml','Dockerfile','.dockerignore','relay.py','outbox.sql','pg_hba_gps.conf.example','nginx-stream.conf.example','README.md'):shutil.copy2(source/name,out/name)
owner=secrets.token_hex(32);relay=secrets.token_hex(32);secret=secrets.token_hex(32);admin=secrets.token_hex(32)
xml=(source/'traccar.xml.example').read_text().replace('supabase-db:5432',args.db_host+':'+str(args.db_port)).replace('REPLACE_WITH_DATABASE_PASSWORD',escape(owner));(out/'traccar.xml').write_text(xml)
env=(source/'.env.example').read_text().replace('REPLACE_WITH_RANDOM_64_HEX_SECRET',secret).replace('REPLACE_WITH_RANDOM_LOCAL_ADMIN_PASSWORD',admin).replace('supabase-db:5432',args.db_host+':'+str(args.db_port)).replace('vihem_traccar_relay:REPLACE@','vihem_traccar_relay:'+relay+'@');(out/'.env').write_text(env)
(out/'provision.sql').write_text("CREATE ROLE vihem_traccar LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '"+owner+"';\nCREATE ROLE vihem_traccar_relay LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '"+relay+"';\nCREATE DATABASE vihem_traccar OWNER vihem_traccar;\nREVOKE ALL ON DATABASE vihem_traccar FROM PUBLIC;\nGRANT CONNECT ON DATABASE vihem_traccar TO vihem_traccar,vihem_traccar_relay;\n")
(out/'edge-secret.env').write_text('FLEET_TRACCAR_SECRET='+secret+'\n')
with (out/'provision.sql').open('a') as f:
 f.write("\\connect vihem_traccar\nALTER SCHEMA public OWNER TO vihem_traccar;\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\nGRANT USAGE,CREATE ON SCHEMA public TO vihem_traccar;\nALTER DATABASE vihem_traccar SET timezone='UTC';\n")
 # Existing Supabase cluster backups run as postgres (not a superuser in this image).
 # Read-only access is required for pg_dumpall, including tables created by future upgrades.
 with_backup="GRANT CONNECT ON DATABASE vihem_traccar TO postgres;\nGRANT USAGE ON SCHEMA public TO postgres;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO postgres;\nGRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;\nALTER DEFAULT PRIVILEGES FOR ROLE vihem_traccar IN SCHEMA public GRANT SELECT ON TABLES TO postgres;\nALTER DEFAULT PRIVILEGES FOR ROLE vihem_traccar IN SCHEMA public GRANT SELECT ON SEQUENCES TO postgres;\n"
 f.write(with_backup)
for name in ('traccar.xml','.env','provision.sql','edge-secret.env'):(out/name).chmod(0o600)
print('Prepared private configuration in',out,'; review deployment instructions before applying. No credentials printed.')
