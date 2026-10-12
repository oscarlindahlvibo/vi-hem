const origins=new Set(['https://vi-hem.se','https://www.vi-hem.se']);
const kinds:Record<string,string>={demo:'Demoförfrågan',account:'Begäran om demokonto',contact:'Kontaktförfrågan'};
const plans:Record<string,string>={unsure:'Hjälp att välja',starter:'Starter',professional:'Professional',enterprise:'Enterprise'};
export function prepare(input:Record<string,unknown>):Record<string,string>{
 const payload:Record<string,string>={};
 for(const k of ['name','email','phone','company','message','preferredTime','kind','plan']){
  const max=k==='message'?4000:k==='email'?254:k==='preferredTime'?200:150;
  if(typeof input[k]!=='string'||input[k].length>max)throw Error('Invalid field');payload[k]=input[k].trim();
 }
 if(!payload.name||!payload.company||!payload.message||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(payload.email)||!kinds[payload.kind]||!plans[payload.plan])throw Error('Invalid enquiry');
 return {name:payload.name,email:payload.email,phone:payload.phone,company:payload.company,subject:'vi-hem',message:`VI-HEM.se · ${kinds[payload.kind]}\nNivå: ${plans[payload.plan]}${payload.kind==='demo'&&payload.preferredTime?'\nÖnskad tid: '+payload.preferredTime:''}\n\n${payload.message}`};
}
export function handler(store:(id:string,payload:Record<string,string>,fingerprint:string)=>Promise<'ok'|'limited'|'failed'>,secret:string){
 return async(req:Request)=>{
  const origin=req.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://vi-hem.se','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  const reply=(status:number)=>new Response(JSON.stringify({received:status===201}),{status,headers});
  if(!origins.has(origin))return reply(403);if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply(405);
  let id:string,payload:Record<string,string>;
  try{
   const reader=req.body?.getReader();if(!reader)return reply(400);let size=0,text='';const decoder=new TextDecoder();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20000)return reply(413);text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}
   const body=JSON.parse(text);id=body.operation_id;
   if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||!body.payload||typeof body.payload!=='object')return reply(400);
   if(body.payload.website)return reply(201);payload=prepare(body.payload);
  }catch{return reply(400);}
  try{
   if(!secret)return reply(503);
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('vihem-sales:'+payload.email.toLowerCase()));
   const fingerprint=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
   const result=await store(id,payload,fingerprint);return reply(result==='ok'?201:result==='limited'?429:503);
  }catch{return reply(503);}
 };
}
