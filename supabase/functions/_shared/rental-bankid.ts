// ViboRent använder VI-HEM:s befintliga BankSignering-koppling och krypterade organisationsinställningar.
import { bankidCollect, bankidSettings, bankidStart } from './kp-bankid.ts';
import { allow, clientIp, encryptSecret, mapDbError, text } from './rental-common.ts';

export function hasSigningEvidence(r: { status: string; name?: string; personalNumber?: string; signature?: string; ocspResponse?: string }) {
  return r.status === 'complete' && !!r.name?.trim() && /^\d{12}$/.test(r.personalNumber || '') && !!r.signature && !!r.ocspResponse;
}
export async function rentalBankid(admin: any, request: Request, org: string, action: string, body: any, booking: any) {
  const fail = (status: number, error: string) => ({ status, body: { error } });
  if (!booking) return fail(404,'Bokningen hittades inte.');
  if (body.accepted_terms !== true) return fail(400,'Godkänn hyresavtalet innan du signerar.');
  if (!(await allow(admin,request,`rental-${action}`,action==='bankid-start'?10:180,600))) return fail(429,'För många försök. Vänta en stund.');
  const settings = await bankidSettings(admin,org,'sign');
  if (!settings) return fail(503,'BankID-signering är inte aktiverad.');
  if (action === 'bankid-start') {
    if (booking.status!=='pending' || booking.contract_status!=='pending_signature' || (booking.hold_expires_at && Date.parse(booking.hold_expires_at)<Date.now())) return fail(409,'Reservationen kan inte längre signeras.');
    if (!booking.contract_terms_snapshot || booking.contract_terms_snapshot.trim()==='ViboRent uthyrningsavtal v1') return fail(409,'Ett fullständigt hyresavtal saknas.');
    const {data:snapshot,error} = await admin.rpc('vihem_rental_signing_snapshot',{p_booking:booking.id,p_org:org});
    if(error || !snapshot) return fail(503,'Signeringen kunde inte förberedas. Försök igen.');
    const equipment = (booking.items || []).map((i: any) => `${i.quantity} × ${i.product?.name || 'Utrustning'}: ${i.start_at} – ${i.end_at}`).join('\n');
    const visible = `ViboRent – WPE Sweden AB\nBokning ${booking.public_reference}\nAtt betala: ${booking.total} ${booking.currency} inklusive moms\nDeposition: ${booking.deposit} ${booking.currency}\n${equipment}\n\n${booking.contract_terms_snapshot}`;
    const started = await bankidStart(settings,visible,clientIp(request),snapshot);
    const {error:insertError} = await admin.from('vihem_rental_bankid_orders').insert({order_ref:started.orderRef,organisation_id:org,booking_id:booking.id,environment:settings.environment,booking_snapshot:snapshot});
    if(insertError) return fail(503,'BankID-sessionen kunde inte sparas. Ingen signering registrerades.');
    return {status:200,body:{order_ref:started.orderRef,auto_start_url:started.autoStartUrl,qr_image:started.qrImage}};
  }
  const ref=text(body.order_ref,150);
  const {data:order} = await admin.from('vihem_rental_bankid_orders').select('order_ref,booking_id,status,consumed_at,expires_at,environment').eq('order_ref',ref).eq('organisation_id',org).eq('booking_id',booking.id).maybeSingle();
  if(!order) return fail(404,'Signeringen hittades inte.');
  if(order.consumed_at && order.status==='complete') return {status:200,body:{status:'complete',signed:true}};
  if(order.status!=='pending' || Date.parse(order.expires_at)<Date.now() || order.environment!==settings.environment) return fail(410,'BankID-sessionen har gått ut. Starta om.');
  const result = await bankidCollect(settings,ref);
  if(result.status==='pending') return {status:200,body:{status:'pending'}};
  if(result.status==='failed' || !hasSigningEvidence(result)) {
    await admin.from('vihem_rental_bankid_orders').update({status:'failed'}).eq('order_ref',ref).eq('status','pending');
    return {status:200,body:{status:'failed',error:'BankID-signeringen avbröts eller kunde inte verifieras. Försök igen.'}};
  }
  // Personnummer och kryptografiska signeringsbevis lämnar aldrig servern i publika svar.
  const evidence=await encryptSecret(JSON.stringify(result),`rental-bankid:${ref}`);
  const {error} = await admin.rpc('vihem_rental_complete_bankid',{p_ref:ref,p_org:org,p_booking:booking.id,p_name:result.name,p_evidence:evidence});
  if(error) { const e=mapDbError(error); return fail(e.status,e.message); }
  return {status:200,body:{status:'complete',signed:true}};
}
