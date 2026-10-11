// Build the explicitly restricted beta. No network deployment or DB operation.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const git=(...args)=>spawnSync('git',args,{encoding:'utf8'}).stdout.trim();
if(git('branch','--show-current')!=='codex/vihem-3-premium')throw Error('Premium branch required');
const build=spawnSync('npm',['run','build','--','--outDir','dist-beta'],{stdio:'inherit',env:{...process.env,VITE_VIHEM_BETA_RESTRICT_EXTERNAL:'true',VITE_SUPABASE_USE_SAME_ORIGIN:'false'}});
if(build.status)process.exit(build.status);
fs.writeFileSync('dist-beta/beta-version.json',JSON.stringify({revision:git('rev-parse','HEAD'),restricted:true,workingTreePending:!!git('status','--porcelain'),builtAt:new Date().toISOString()})+'\n');
