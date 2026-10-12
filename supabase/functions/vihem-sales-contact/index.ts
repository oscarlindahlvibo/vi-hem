import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {handler} from './contact.ts';
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(Deno.env.get('SUPABASE_URL')!,service,{auth:{persistSession:false}});
Deno.serve(handler(async(id,payload,fingerprint)=>{
 const {error}=await db.rpc('vihem_vibogruppen_store_enquiry',{p_id:id,p_payload:payload,p_fingerprint:fingerprint});
 return !error?'ok':error.message.includes('Rate limit')?'limited':'failed';
},Deno.env.get('VIBOFAST_PUBLIC_RATE_SECRET')||service));
