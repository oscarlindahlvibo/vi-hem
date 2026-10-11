import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchProducts } from './product.ts';
const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'} });
const limits = new Map<string, {start:number; count:number}>();
Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST') return json({error:'Metoden stöds inte.'},405);
  try {
    const auth = req.headers.get('Authorization'); if(!auth) return json({error:'Logga in för att hämta produkter.'},401);
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
    const {data:{user},error}=await db.auth.getUser(); if(error || !user) return json({error:'Logga in för att hämta produkter.'},401);
    const {data:profile}=await db.from('vihem_profiles').select('role,active,organisation_id').eq('id',user.id).maybeSingle();
    if(!profile?.active || !profile.organisation_id || !['staff','admin','superadmin'].includes(profile.role)) return json({error:'Endast aktiv personal kan hämta produkter.'},403);
    const now=Date.now(); for(const [id,v] of limits) if(now-v.start>60000) limits.delete(id);
    const rate=limits.get(user.id)||{start:now,count:0}; if(++rate.count>10) return json({error:'För många försök. Vänta en minut och försök igen.'},429); limits.set(user.id,rate);
    const reader=req.body?.getReader(); if(!reader) return json({error:'Ange en produktlänk.'},400);
    const chunks: Uint8Array[]=[]; let size=0;
    try { while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>3000) return json({error:'För stor begäran.'},400); chunks.push(value); } }
    finally { await reader.cancel(); }
    const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const text=new TextDecoder().decode(bytes);
    const body=JSON.parse(text);
    return json({products:await fetchProducts(body.url)});
  } catch(error) { return json({error:error instanceof Error && ['TimeoutError','AbortError'].includes(error.name) ? 'Butiken svarar inte just nu. Försök igen.' : error instanceof Error?error.message:'Kunde inte hämta produkten. Försök igen.'},400); }
});
