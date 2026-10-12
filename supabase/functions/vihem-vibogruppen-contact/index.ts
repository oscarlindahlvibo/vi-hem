import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
const allowed=new Set(['https://vibogruppen.se','https://www.vibogruppen.se']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://vibogruppen.se','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(status:number,message:string)=>new Response(JSON.stringify({received:status===201,message}),{status,headers});
 if(!allowed.has(origin))return reply(403,'Forbidden');
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,'Method not allowed');
 try{
  const reader=req.body?.getReader();if(!reader)return reply(400,'Missing request');let size=0,text='';const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>30000)return reply(413,'Too large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}
  const body=JSON.parse(text),input=body.payload;
  if(!input||typeof body.operation_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.operation_id))return reply(400,'Invalid request');
  if(input.website)return reply(201,'Received');
  const payload:Record<string,string>={};for(const field of ['name','email','phone','company','subject','message']){if(typeof input[field]!=='string'||input[field].length>(field==='message'?5000:254))return reply(400,'Invalid field');payload[field]=input[field].trim();}
  if(!payload.name||!payload.message||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(payload.email))return reply(400,'Invalid contact');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(Deno.env.get('VIBOFAST_PUBLIC_RATE_SECRET')||service),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('vibogruppen:'+payload.email.toLowerCase()));const fingerprint=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,'0')).join('');
  const db=createClient(Deno.env.get('SUPABASE_URL')!,service,{auth:{persistSession:false}});
  const {error}=await db.rpc('vihem_vibogruppen_store_enquiry',{p_id:body.operation_id,p_payload:payload,p_fingerprint:fingerprint});
  if(error)return reply(error.message.includes('Rate limit')?429:503,'Could not submit');
  return reply(201,'Received');
 }catch{return reply(400,'Invalid request');}
});
