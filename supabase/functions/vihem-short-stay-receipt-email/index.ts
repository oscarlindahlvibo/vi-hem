import {createClient} from 'npm:@supabase/supabase-js@2';
import {sendGmailMessage,verifyGmailSender,googleMailerErrorCode,googleMailerFriendlyMessage} from '../_shared/google-workspace-mailer.ts';
import {receiptSnapshot,snapshotHash,receiptSender,definiteMailFailure,defaultMailTemplate,validateMailContent,renderMailTemplate} from './receipt.ts';
import {receiptPdf} from './pdf.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Metoden stöds inte.'},405);
 const auth=req.headers.get('Authorization');if(!auth)return reply({error:'Logga in först.'},401);
 let jobId:string|undefined;let admin:any;let transportStarted=false;
 try {
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await db.auth.getUser();if(!user)return reply({error:'Ogiltig session.'},401);
  const {data:profile}=await db.from('vihem_profiles').select('role,active,organisation_id').eq('id',user.id).single();
  if(!profile?.active||profile.role!=='admin'||!profile.organisation_id)return reply({error:'Endast aktiv administratör kan skicka kundkvitton.'},403);
  const org=profile.organisation_id;
  const reader=req.body?.getReader();if(!reader)return reply({error:'Begäran saknas.'},400);
  let text='';const decoder=new TextDecoder();let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>30000)return reply({error:'För stor begäran.'},400);text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}
  const body=JSON.parse(text);
  if(!['prepare','send','settings_get','settings_save'].includes(body.action))return reply({error:'Okänd åtgärd.'},400);
  admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:storedSettings,error:settingsError}=await admin.from('vihem_receipt_email_settings').select('subject,message,revision').eq('organisation_id',org).maybeSingle();
  if(settingsError)return reply({error:'Mejlinställningarna är inte tillgängliga. Försök igen senare.'},503);
  const template=storedSettings||{...defaultMailTemplate,revision:0};
  if(body.action==='settings_get')return reply({template});
  if(body.action==='settings_save'){
   const content=validateMailContent(body.subject,body.message);
   if(body.expected_revision!==template.revision)return reply({error:'Standardmeddelandet ändrades av någon annan. Öppna inställningarna igen.'},409);
   const next={...content,revision:template.revision+1,updated_at:new Date().toISOString()};
   const result=storedSettings?await admin.from('vihem_receipt_email_settings').update(next).eq('organisation_id',org).eq('revision',template.revision).select('revision').maybeSingle():await admin.from('vihem_receipt_email_settings').insert({organisation_id:org,...next}).select('revision').maybeSingle();
   if(result.error||!result.data)return reply({error:'Standardmeddelandet kunde inte sparas eller ändrades av någon annan. Dina texter finns kvar.'},409);
   return reply({template:{...next}});
  }
  const {data:booking}=await db.from('vihem_short_stay_bookings').select('*').eq('id',body.booking_id).eq('organisation_id',org).single();
  if(!booking||booking.booking_type!=='booking')return reply({error:'Bokningen kunde inte hittas eller får inte användas.'},404);
  const {data:account}=await admin.from('vihem_mail_accounts').select('id').eq('organisation_id',org).eq('email',receiptSender).eq('active',true).maybeSingle();
  const {data:workspace}=await admin.from('vihem_google_workspace_settings').select('encrypted_service_account_json').eq('organisation_id',org).maybeSingle();
  // Do not use the shared global service-account fallback for a new sender.
  if(!account||!workspace?.encrypted_service_account_json)return reply({configured:false,sender:receiptSender,error:'Lägg till avsändarkontot under E-post & underlag och koppla organisationens Google Workspace-servicekonto.'},409);
  await verifyGmailSender(admin,org,receiptSender);
  const {data:unit}=await db.from('vihem_short_stay_units').select('name').eq('id',booking.unit_id).eq('organisation_id',org).maybeSingle();
  const {data:companies}=await db.from('vihem_companies').select('id,name,legal_name,organisation_number').eq('organisation_id',org).eq('active',true);
  const norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ').replace(/ ab$/,'');
  const company=booking.receipt_company_id?(companies||[]).find(c=>c.id===booking.receipt_company_id):(companies||[]).find(c=>norm(c.name)==='vibogruppen'||norm(c.legal_name||'')==='vibogruppen');
  const snapshot=receiptSnapshot(booking,unit,company),hash=await snapshotHash(snapshot);
  const {data:previous,error:historyError}=await admin.from('vihem_short_stay_receipt_emails').select('id,status').eq('organisation_id',org).eq('booking_id',booking.id).eq('receipt_hash',hash).maybeSingle();
  if(historyError)return reply({configured:false,error:'Sändningshistoriken är inte tillgänglig. Inget mejl skickades.'},503);
  const mail=body.action==='send' && (body.subject!==undefined||body.message!==undefined)?validateMailContent(body.subject,body.message):renderMailTemplate(template,snapshot);
  if(body.action==='prepare')return reply({mail,configured:true,sender:receiptSender,snapshot,hash,previous_status:previous?.status||null});
  if(body.expected_hash!==hash)return reply({error:'Bokningen har ändrats. Stäng förhandsvisningen och öppna kvittot igen.'},409);
  if(typeof body.operation_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operation_id))return reply({error:'Ogiltig sändningsbegäran.'},400);
  const bytes=await receiptPdf(snapshot);
  const {error:reserveError}=await admin.from('vihem_short_stay_receipt_emails').insert({id:body.operation_id,organisation_id:org,booking_id:booking.id,receipt_hash:hash,recipient:snapshot.recipient,sender:receiptSender,status:'processing',email_subject:mail.subject,email_message:mail.message,created_by:user.id});
  if(reserveError){
   if(reserveError.code!=='23505')throw new Error('Sändningshistoriken kunde inte sparas. Inget mejl skickades.');
   const {data:existing}=await admin.from('vihem_short_stay_receipt_emails').select('id,status').eq('organisation_id',org).eq('booking_id',booking.id).eq('receipt_hash',hash).maybeSingle();
   if(existing?.status==='sent')return reply({status:'sent',already_sent:true});
   if(existing?.status!=='failed')return reply({status:'uncertain',error:'Utskicket pågår eller resultatet är okänt. Kontrollera Skickat i Gmail innan nytt utskick.'},409);
   const {data:claimed}=await admin.from('vihem_short_stay_receipt_emails').update({status:'processing',email_subject:mail.subject,email_message:mail.message,updated_at:new Date().toISOString()}).eq('id',existing.id).eq('status','failed').select('id').maybeSingle();
   if(!claimed)return reply({status:'uncertain',error:'En annan sändning pågår. Kontrollera utskicket innan du försöker igen.'},409);
   jobId=claimed.id;
  }else{jobId=body.operation_id;}
  transportStarted=true;
  await sendGmailMessage(admin,org,{fromEmail:receiptSender,fromName:'Ekängens Vandrarhem',toEmail:snapshot.recipient,toName:snapshot.guest,subject:mail.subject,text:mail.message,attachment:{fileName:`Kvitto-${booking.id}.pdf`,contentType:'application/pdf',bytes}});
  const now=new Date().toISOString();const {error:markError}=await admin.from('vihem_short_stay_receipt_emails').update({status:'sent',sent_at:now,updated_at:now}).eq('id',jobId).eq('status','processing').select('id').single();
  if(markError)return reply({status:'uncertain',error:'Google accepterade mejlet men sändningshistoriken kunde inte bekräftas. Skicka inte igen; kontrollera Skickat i Gmail.'},409);
  return reply({status:'sent',recipient:snapshot.recipient});
 }catch(error){
  const failed=!transportStarted||definiteMailFailure(error);
  if(jobId&&admin)await admin.from('vihem_short_stay_receipt_emails').update({status:failed?'failed':'uncertain',updated_at:new Date().toISOString()}).eq('id',jobId).eq('status','processing');
  const code=googleMailerErrorCode(error);const message=String(error).includes('GOOGLE_')?googleMailerFriendlyMessage(code):error instanceof Error?error.message:'Kunde inte skicka kvittot.';
  return reply({status:failed?'failed':'uncertain',error:failed?message:'Sändningsresultatet är okänt. Kontrollera Skickat i Gmail innan du försöker igen.'},failed?400:409);
 }
});
