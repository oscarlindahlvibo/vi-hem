export const receiptSender = 'kontakt@ekangensvandrarhem.se';
export const validEmail = (value: unknown): value is string => typeof value==='string' && value.length<=254 && /^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/.test(value);
export function receiptSnapshot(booking: any, unit: any, company: any) {
  if(!validEmail(booking.guest_email))throw new Error('Bokningen saknar en giltig kundadress. Uppdatera gästens e-post först.');
  if(!company)throw new Error('Välj ett utfärdande bolag innan kvittot skickas.');
  const lines=Array.isArray(booking.receipt_lines)&&booking.receipt_lines.length ? booking.receipt_lines : [{description:`Boende · ${unit?.name || 'Korttidsboende'}`,amount:Number(booking.total_price||0)}];
  if(lines.length>200 || lines.some((line:any)=>typeof line.description!=='string'||line.description.length>4000||!Number.isFinite(Number(line.amount))))throw new Error('Kvittoraderna behöver korrigeras innan utskick.');
  const total=lines.reduce((sum:number,line:any)=>sum+Number(line.amount),0);const rate=booking.receipt_vat_exempt?0:Number(booking.receipt_vat_rate??12);
  const paid=Number(booking.paid_amount||0);const due=Number(booking.balance_due??Math.max(total-paid,0));
  if(total<=0 || ![total,rate,paid,due].every(Number.isFinite) || rate<0)throw new Error('Kontrollera kvittots belopp och moms.');
  const net=rate===0?total:Math.round(total/(1+rate/100)*100)/100;
  return {recipient:booking.guest_email,phone:booking.guest_phone||'',guests:booking.guest_count||1,channel:booking.channel_name||'VI-HEM',guest:booking.guest_name||booking.title||'Gäst',title:booking.receipt_title||'Kvitto',issuer:company.legal_name||company.name,companyNumber:company.organisation_number||'',bookingId:booking.beds24_booking_id||booking.external_uid||booking.id,unit:unit?.name||'Enhet',start:booking.start_date,end:booking.end_date,currency:booking.currency||'SEK',lines,total,net,vat:Math.round((total-net)*100)/100,rate,paid,due};
}
export async function snapshotHash(snapshot: unknown) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)))),n=>n.toString(16).padStart(2,'0')).join('');}
export function definiteMailFailure(error: unknown) {
  const text=String(error);
  return /GOOGLE_(CREDENTIALS|PRIVATE_KEY|TOKEN_FAILED)/.test(text) || /GOOGLE_GMAIL_SEND_FAILED:4\d\d:/.test(text);
}
