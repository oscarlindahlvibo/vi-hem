"""Real PostgreSQL role/JWT probes against each isolated current-schema clone.
Run once with --baseline before applying its candidate, then without it after.
Fixtures are transaction-scoped; SQL failures also roll back on disconnect.
"""
from pathlib import Path
import sys,subprocess
part=sys.argv[1];baseline='--baseline' in sys.argv
assert part in ('comments','fleet','inventory')
sql='BEGIN;\n'+Path('scripts/premium/hotfix-stage-fixtures.sql').read_text()
def role(who):
 return "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',md5('p9-%s')::uuid::text,true);\n" % who
def assertq(q,n,label):
 return "DO $$ BEGIN IF (%s) <> %s THEN RAISE EXCEPTION '%s'; END IF; END $$;\n"%(q,n,label)
if part=='comments':
 for who in ('admin','staff','tenant','screen','inactive','foreign','superadmin'):
  sql+=role(who)
  expected=2 if (baseline and who in ('admin','staff','inactive','foreign')) or who=='superadmin' else 1 if who in ('admin','staff','foreign') else 0
  sql+=assertq('SELECT count(*) FROM vihem_work_order_comments',expected,who+' comment visibility')
  if not baseline and who in ('admin','staff'):
   sql+="""DO $$ BEGIN
   BEGIN INSERT INTO vihem_work_order_comments(work_order_id,user_id,comment,internal) VALUES(md5('p9-order-b')::uuid,auth.uid(),'cross-org',true); RAISE EXCEPTION 'Foreign comment accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN INSERT INTO vihem_work_order_comments(work_order_id,user_id,comment) VALUES(md5('p9-order-a')::uuid,md5('p9-tenant')::uuid,'spoof'); RAISE EXCEPTION 'Spoof accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   END $$;
   INSERT INTO vihem_work_order_comments(work_order_id,user_id,comment,internal) VALUES(md5('p9-order-a')::uuid,auth.uid(),'Legacy direct client',true);
   """
   # Undo the just-inserted row as fixture owner, keeping deterministic counts.
   sql+="RESET ROLE; DELETE FROM vihem_work_order_comments WHERE comment='Legacy direct client';\n"
 if not baseline:
  sql+='RESET ROLE; SET LOCAL ROLE anon;'+assertq('SELECT count(*) FROM vihem_work_order_comments',0,'anonymous comments')
elif part=='fleet':
 for who in ('admin','staff','tenant','screen','inactive','foreign','superadmin'):
  sql+=role(who)
  expected=1 if who in ('admin','staff','screen','foreign','superadmin') or baseline else 0
  for table in ('vihem_fleet_vehicles','vihem_inventory_stock_items','vihem_inventory_locations','vihem_inventory_balances'):
   sql+=assertq('SELECT count(*) FROM '+table,expected,who+' '+table)
  if not baseline and who in ('admin','staff','screen'):
   for table in ('vihem_fleet_vehicles','vihem_inventory_stock_items'):
    sql+=assertq("SELECT count(*) FROM %s WHERE organisation_id=md5('p9-org-b')::uuid"%table,0,who+' foreign')
 if not baseline:
  sql+='RESET ROLE;'+assertq("SELECT count(*) FROM pg_tables t WHERE schemaname='public' AND (tablename LIKE 'vihem_fleet_%' OR tablename IN ('vihem_inventory_stock_items','vihem_inventory_locations','vihem_inventory_balances','vihem_inventory_transactions','vihem_inventory_counts','vihem_inventory_count_lines')) AND NOT EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname=t.schemaname AND p.tablename=t.tablename AND p.permissive='RESTRICTIVE' AND p.cmd='SELECT')",0,'guard coverage')
else:
 sql+=role('staff')
 if baseline:
  sql+="SELECT vihem_inventory_apply_transaction(md5('p9-item-a')::uuid,1,'stock_in',NULL,md5('p9-location-b')::uuid);\n"
 else:
  for column,vals in [('source',"md5('p9-location-b')::uuid,NULL,NULL,NULL,'' ,'',NULL"),('destination',"NULL,md5('p9-location-b')::uuid,NULL,NULL,'','',NULL"),('project',"NULL,md5('p9-location-a')::uuid,md5('p9-project-b')::uuid,NULL,'','',NULL"),('workorder',"NULL,md5('p9-location-a')::uuid,NULL,md5('p9-order-b')::uuid,'','',NULL"),('apartment',"NULL,md5('p9-location-a')::uuid,NULL,NULL,'','',md5('p9-apartment-b')::uuid")]:
   sql+="DO $$ BEGIN BEGIN PERFORM vihem_inventory_apply_transaction(md5('p9-item-a')::uuid,1,'stock_in',%s); RAISE EXCEPTION '%s accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;\n"%(vals,column)
  sql+=assertq('SELECT count(*) FROM vihem_inventory_transactions',0,'rejected operations changed ledger')
  sql+="SELECT vihem_inventory_apply_transaction(md5('p9-item-a')::uuid,2,'transfer',md5('p9-location-a')::uuid,md5('p9-location-a')::uuid,NULL,NULL,'old signature','test');\n"
  sql+=assertq("SELECT quantity FROM vihem_inventory_balances WHERE item_id=md5('p9-item-a')::uuid",20,'legacy balance')
  sql+=assertq('SELECT count(*) FROM vihem_inventory_transactions',1,'legacy ledger')
  sql+=role('inactive')+"DO $$ BEGIN BEGIN PERFORM vihem_inventory_apply_transaction(md5('p9-item-a')::uuid,1,'stock_in',NULL,md5('p9-location-a')::uuid); RAISE EXCEPTION 'Inactive accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;\n"
sql+="RESET ROLE; ROLLBACK; SELECT 'PASS isolated %s %s';\n"%(part,'baseline' if baseline else 'candidate')
r=subprocess.run([sys.executable,'scripts/premium/hotfix-stage-sql.py',part],input=sql,text=True,capture_output=True)
print(r.stdout,r.stderr);raise SystemExit(r.returncode)
