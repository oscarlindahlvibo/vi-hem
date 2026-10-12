import fileConfig from './credentials.json' with {type:'json'};
import {makeReader,type Snapshot} from './monta.ts';
const unavailable:Snapshot={status:'unavailable',checkedAt:null,points:[]};
const config=Deno.env.get('VIHEM_MONTA_CLIENT_ID')?{clientId:Deno.env.get('VIHEM_MONTA_CLIENT_ID')||'',clientSecret:Deno.env.get('VIHEM_MONTA_CLIENT_SECRET')||'',ids:(Deno.env.get('VIHEM_MONTA_CHARGE_POINT_IDS')||'').split(',').map(s=>s.trim()).filter(Boolean)}:fileConfig;
const read=makeReader(config);
async function rpc(name:string,body:unknown){
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const r=await fetch((Deno.env.get('SUPABASE_URL')||'')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('Status cache unavailable');return r.json();
}
async function status():Promise<Snapshot>{
 // Shared database lease coordinates short-lived Edge workers and Monta's rate limit.
 const lease=crypto.randomUUID();
 for(let i=0;i<20;i++){
  const result=await rpc('vihem_vibogruppen_charging_claim',{p_lease:lease});
  if(result.snapshot)return result.snapshot;
  if(result.claimed){const snapshot=await read();return await rpc('vihem_vibogruppen_charging_store',{p_lease:lease,p_snapshot:snapshot})?snapshot:unavailable;}
  await new Promise(r=>setTimeout(r,500));
 }
 return unavailable;
}
const allowed=new Set(['https://vibogruppen.se','https://www.vibogruppen.se']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://vibogruppen.se','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(!allowed.has(origin))return new Response('{}',{status:403,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return new Response('{}',{status:405,headers});
 try{return new Response(JSON.stringify(await status()),{headers});}catch{return new Response(JSON.stringify(unavailable),{headers});}
});
