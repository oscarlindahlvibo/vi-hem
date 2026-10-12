import {makeReader} from './monta.ts';
const read=makeReader({clientId:Deno.env.get('VIHEM_MONTA_CLIENT_ID')||'',clientSecret:Deno.env.get('VIHEM_MONTA_CLIENT_SECRET')||'',ids:(Deno.env.get('VIHEM_MONTA_CHARGE_POINT_IDS')||'').split(',').map(s=>s.trim()).filter(Boolean)});
const allowed=new Set(['https://vibogruppen.se','https://www.vibogruppen.se']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://vibogruppen.se','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(!allowed.has(origin))return new Response('{}',{status:403,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return new Response('{}',{status:405,headers});
 // Fixed server-side allow-list. Visitors cannot select arbitrary stations or API paths.
 return new Response(JSON.stringify(await read()),{headers});
});
