export const BUCKET = 'vihem-vibofast-drive-images';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const folderLabel = (name: string, id: string) => `${name.replace(/[\/\\\u0000-\u001f]/g,' ').trim().slice(0,120)} – ${id.slice(0,8)}`;
export function folderId(input: string): string {
 const match=input.trim().match(/(?:\/folders\/|\/drives\/)([\w-]+)/);
 const value=match?.[1] || input.trim();
 if(!/^[\w-]+$/.test(value))throw new Error('Ange en giltig Drive-mapplänk eller ett mapp-ID.');
 return value;
}
export function imageExtension(bytes: Uint8Array,mime: string): string {
 if(mime==='image/jpeg' && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'jpg';
 if(mime==='image/png' && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'png';
 if(mime==='image/webp' && new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'webp';
 throw new Error('Bilden är inte en giltig JPG, PNG eller WebP.');
}
export const sortImages = <T extends {name:string;id:string}>(files: T[]) => files.sort((a,b)=>a.name.localeCompare(b.name,'sv',{numeric:true}) || a.id.localeCompare(b.id));
export async function imageKey(kind: string,entity: string,file: {id:string;md5Checksum?:string;version?:string;modifiedTime:string},extension: string) {
 if(!['property','apartment'].includes(kind) || !/^[\w-]+$/.test(file.id) || !/^[0-9a-f-]{36}$/.test(entity))throw new Error('Ogiltig bildkälla.');
 const revision=file.md5Checksum || `${file.version}:${file.modifiedTime}`;
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(revision)));
 return `${kind}/${entity}/${file.id}-${Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')}.${extension}`;
}
