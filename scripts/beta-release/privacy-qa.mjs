// Real Storage transport check, isolated QA only; synthetic bytes, no live files.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG,'utf8'));
const url='http://127.0.0.1:18880';
const service=createClient(url,c.service,{auth:{persistSession:false}});
const user=createClient(url,c.anon,{auth:{persistSession:false}});
assert.equal((await service.from('vihem_organisations').select('name').eq('id',c.org).single()).data?.name,'VI-HEM Chat QA');
assert.equal((await user.auth.signInWithPassword({email:c.users.oscar.email,password:c.user_password})).error,null);
const buckets=['vihem-chat-attachments','vihem-inspection-photos','vihem-work-order-attachments','vihem-fleet-images','vihem-fleet-documents'];
const path=`${c.org}/beta-privacy-${randomUUID()}.png`;
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
const created=[];
try {
 const existing=(await service.storage.listBuckets()).data||[];
 for(const bucket of buckets){if(!existing.some(b=>b.id===bucket))assert.equal((await service.storage.createBucket(bucket,{public:true})).error,null);assert.equal((await service.storage.from(bucket).upload(path,bytes,{contentType:'image/png',upsert:false})).error,null);created.push(bucket);}
 const sql=fs.readFileSync('scripts/beta-release/quarantine-legacy.sql','utf8');
 const python=`import json,os,subprocess,sys\nos.environ['DOCKER_HOST']='unix:///run/user/1000/docker.sock'\nc=json.load(open('/var/tmp/vihem-chat-qa-20261008/credentials.json'))\nr=subprocess.run(['docker','exec','-i','-e','PGPASSWORD='+c['password'],'vihem-chat-qa-db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','vihem_chat_qa'],input=${JSON.stringify(sql)},text=True,capture_output=True)\nif r.returncode:raise SystemExit('QA privacy SQL failed; inspect privately')\n`;
 const apply=spawnSync('ssh',['vibo-server','python3 -'],{input:python,encoding:'utf8'});assert.equal(apply.status,0,apply.stderr);
 for(const bucket of buckets){
  const publicRead=await fetch(`${url}/storage/v1/object/public/${bucket}/${path}`);assert.ok(!publicRead.ok,`${bucket} public read unexpectedly succeeded`);
  assert.ok((await user.storage.from(bucket).download(path)).error,`${bucket} authenticated read unexpectedly succeeded`);
  assert.ok((await user.storage.from(bucket).createSignedUrl(path,60)).error,`${bucket} signed URL unexpectedly succeeded`);
  const recovery=await service.storage.from(bucket).download(path);assert.equal(recovery.error,null);assert.equal(hash(Buffer.from(await recovery.data.arrayBuffer())),hash(bytes));
 }
 const jobsBefore=await service.from('vihem_inspection_file_jobs').select('id',{head:true,count:'exact'});
 const blocked=await user.functions.invoke('vihem-inspection-archive',{body:{action:'begin',inspection_id:randomUUID()}});
 assert.ok(blocked.error);assert.equal(blocked.error.context.status,503);
 assert.equal((await service.from('vihem_inspection_file_jobs').select('id',{head:true,count:'exact'})).count,jobsBefore.count);
 console.log('PASS: five legacy buckets deny public/authenticated/signed reads; service recovery retains identical bytes. Archive write blocked (503), no file job created.');
} finally {
 for(const bucket of created) assert.equal((await service.storage.from(bucket).remove([path])).error,null);
 await user.auth.signOut();
}
