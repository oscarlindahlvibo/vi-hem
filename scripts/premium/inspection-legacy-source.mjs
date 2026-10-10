import {createHash} from 'node:crypto';
// Source inspection only: no URL is fetched until it belongs to the configured QA origin.
export function legacySource(reference, origin, organisation) {
 if(typeof reference!=='string')return {kind:'unsupported'};
 if(reference.startsWith('vihem-drive:'))return {kind:'job',id:reference.slice(12)};
 if(reference.startsWith('data:application/pdf;base64,'))return {kind:'inline-pdf'};
 try {
  const u=new URL(reference),base=new URL(origin),prefix='/storage/v1/object/public/vihem-inspection-photos/';
  if(u.origin!==base.origin||u.username||u.password||u.search||u.hash||!u.pathname.startsWith(prefix))return {kind:'unsupported'};
  const path=decodeURIComponent(u.pathname.slice(prefix.length));
  if(!path.startsWith(organisation+'/')||path.split('/').some(p=>!p||p.includes('%')||p==='.'||p==='..'||Array.from(p).some(c=>c==='\\'||c.charCodeAt(0)<32)))return {kind:'unsupported'};
  return {kind:'storage-photo',path};
 }catch{return {kind:'unsupported'};}
}
export function legacyPdfBytes(reference,max=26214400) {
 const prefix='data:application/pdf;base64,';
 if(typeof reference!=='string'||!reference.startsWith(prefix))throw Error('Unsupported PDF source');
 const text=reference.slice(prefix.length);
 if(text.length>Math.ceil(max/3)*4||!text||text.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error('Invalid PDF encoding');
 const bytes=Buffer.from(text,'base64');
 if(bytes.length>max||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!bytes.subarray(-1024).toString('ascii').trimEnd().endsWith('%%EOF'))throw Error('Invalid PDF content');
 return {bytes,byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
