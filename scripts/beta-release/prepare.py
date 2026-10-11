"""Prepare checksummed beta artifacts; never installs into the existing beta."""
import argparse, hashlib, json, pathlib, shutil, subprocess
p=argparse.ArgumentParser();p.add_argument('output');p.add_argument('--draft',action='store_true');a=p.parse_args()
repo=pathlib.Path.cwd();out=pathlib.Path(a.output).resolve()
if out.exists():raise SystemExit('Use a new output directory')
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
if git('branch','--show-current')!='codex/vihem-3-premium':raise SystemExit('Premium branch required')
if git('status','--porcelain') and not a.draft:raise SystemExit('Commit reviewed changes first or explicitly request --draft')
main=git('rev-parse','origin/main');base=git('rev-parse','HEAD')
if subprocess.run(['git','merge-base','--is-ancestor',main,base]).returncode:raise SystemExit('Reconcile main before preparing')
migrations=git('diff','--name-only','origin/main...HEAD','--','supabase/migrations').splitlines()
first=['20261009130000_work_order_comment_isolation.sql','20261011103000_fleet_read_role_guard.sql','20261011143000_inventory_reference_isolation.sql']
migrations=sorted(migrations,key=lambda x:(first.index(pathlib.Path(x).name) if pathlib.Path(x).name in first else len(first),x))
backend=git('diff','--name-only','origin/main...HEAD','--','supabase/functions').splitlines()
# Archive guard is required in both draft and committed packages.
if 'supabase/functions/vihem-inspection-archive/index.ts' not in backend:backend.append('supabase/functions/vihem-inspection-archive/index.ts')
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
version=json.loads((repo/'dist-beta/beta-version.json').read_text())
if version.get('revision')!=base or not version.get('restricted') or (version.get('workingTreePending') and not a.draft):raise SystemExit('Rebuild restricted beta from reviewed commit first')
out.mkdir(mode=0o700)
extras=['scripts/beta-release/quarantine-legacy.sql','scripts/migrate-chat-attachments.mjs']
for f in migrations+backend+extras:
 target=out/f;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(repo/f,target)
if not (repo/'dist-beta/index.html').exists():raise SystemExit('Build beta frontend before packaging')
shutil.copytree(repo/'dist-beta',out/'frontend')
manifest={'base_main':main,'source_commit':base,'working_tree_pending':bool(git('status','--porcelain')),'migrations':migrations,'backend':backend,'post_migration_privacy_sql':'scripts/beta-release/quarantine-legacy.sql','required_edge_environment':{'VIHEM_BETA_RESTRICT_EXTERNAL':'true'},'frontend_restrictions':['inspection photo upload/final PDF disabled; draft/read retained','Accounted PDF fetching disabled; cached invoice data retained'],'storage_rule':'Legacy sensitive buckets quarantined after migrations; originals retained, old client reads/writes temporarily denied; intentionally public website buckets unchanged.','approval':'NO APPLY: existing installation requires separate explicit approval.','files':{str(f.relative_to(out)):sha(f) for f in out.rglob('*') if f.is_file()}}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Prepared {len(migrations)} ordered migrations, {len(backend)} backend files and beta frontend. Not installed.')
