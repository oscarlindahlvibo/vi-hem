import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const credentials=new URL('../../supabase/functions/vihem-vibogruppen-charging/credentials.json',import.meta.url);
let handler,calls=0,lease=null,snapshot=null,created=false;
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'private-db-key'})[k]},serve:h=>{handler=h;}};
globalThis.fetch=async(url,opts)=>{
 if(url.includes('/rest/v1/rpc/')){
  assert.equal(opts.headers.apikey,'private-db-key');const body=JSON.parse(opts.body);let result;
  if(url.endsWith('_claim')){
   if(snapshot)result={snapshot,claimed:false};else if(lease)result={claimed:false};else{lease=body.p_lease;result={claimed:true};}
  }else{assert.equal(body.p_lease,lease);snapshot=body.p_snapshot;lease=null;result=true;}
  return new Response(JSON.stringify(result));
 }
 calls++;await new Promise(r=>setTimeout(r,20));return new Response(JSON.stringify(url.endsWith('/auth/token')?{accessToken:'secret-token',accessTokenExpirationDate:new Date(Date.now()+3600000).toISOString()}:{id:Number(url.split('/').pop()),visibility:'public',state:'available',maxKw:180,note:'PRIVATE'}));
};
try{
 await fs.writeFile(credentials,JSON.stringify({clientId:'id',clientSecret:'secret',ids:['12','13']}),{flag:'wx',mode:0o600});created=true;
 await import('../../supabase/functions/vihem-vibogruppen-charging/index.ts');
 const request=origin=>new Request('https://test/functions/v1/charging',{method:'POST',headers:{Origin:origin},body:'{}'});
 const results=await Promise.all(Array.from({length:5},()=>handler(request('https://vibogruppen.se'))));
 for(const r of results){assert.equal(r.status,200);const data=await r.json();assert.equal(data.status,'ok');assert.equal(data.points.length,2);assert.ok(!JSON.stringify(data).includes('secret'));assert.ok(!JSON.stringify(data).includes('PRIVATE'));}
 assert.equal(calls,3);await handler(request('https://vibogruppen.se'));assert.equal(calls,3);
 assert.equal((await handler(request('https://evil.invalid'))).status,403);assert.equal(calls,3);
 assert.equal((await handler(new Request('https://test',{method:'GET',headers:{Origin:'https://vibogruppen.se'}}))).status,405);
 assert.equal(lease,null);
 console.log('PASS exact Edge handler: concurrent DB lease/cache, public projection, secret suppression and origin/method denial');
}finally{if(created)await fs.unlink(credentials);}
