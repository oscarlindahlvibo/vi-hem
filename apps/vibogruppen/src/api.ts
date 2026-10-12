import {createClient} from '@supabase/supabase-js';
export const client=import.meta.env.VITE_SUPABASE_URL&&import.meta.env.VITE_SUPABASE_ANON_KEY?createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;
export async function sendContact(payload:Record<string,string>,operationId:string){
 if(!client)throw Error('Kontaktformuläret är inte anslutet ännu. Kontakta oss via e-post.');
 const {data,error}=await client.functions.invoke('vihem-vibogruppen-contact',{body:{payload,operation_id:operationId}});
 if(error||!data?.received)throw Error('Meddelandet kunde inte bekräftas. Dina uppgifter finns kvar; försök igen.');
}
