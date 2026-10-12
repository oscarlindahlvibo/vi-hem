import {companies as source,type Company} from './bolt-content';
export type Business=Pick<Company,'name'|'tagline'|'description'|'category'|'icon'|'logo'> & {id:string;url:string;visible:boolean};
export interface PortalContent {heroTitle:string;heroText:string;aboutTitle:string;aboutText:string;email:string;phone:string;businesses:Business[];}
export const defaultContent:PortalContent={
 heroTitle:'Flera verksamheter.\nEn gemensam drivkraft.',
 heroText:'Fastigheter, entreprenad, uthyrning, energi och evenemang. Vi bygger långsiktigt, arbetar nära och tar vara på möjligheterna tillsammans.',
 aboutTitle:'Förankrade i Småland.\nMed blicken framåt.',
 aboutText:'Vibogruppen är en entreprenörsdriven grupp med bas i Virserum. Här samlar vi företag, kunskap och resurser som gör nytta tillsammans – från boende och fastigheter till entreprenad, uthyrning och evenemang.',
 email:'kontakt@vibogruppen.se',phone:'',
 businesses:source.filter(c=>c.id!=='vi-hem-app').map(c=>({id:c.id,name:c.name,tagline:c.tagline,description:c.description.replace('förenlar','förenar'),category:c.category,icon:c.icon,logo:c.logo,url:c.id==='ekangens-vandrarhem'?'https://ekangensvandrarhem.se':c.id==='vibo-charge'?'https://chargefinder.com/se/ladda-elbil-virserum-ekangsvagen-1/nwmrg7':c.url,visible:true}))
};
export function safeLink(url:string){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'#kontakt';}catch{return '#kontakt';}}
export function validPortalContent(c:unknown):c is PortalContent {
 if(!c||typeof c!=='object')return false;const o=c as PortalContent;
 return ['heroTitle','heroText','aboutTitle','aboutText','email','phone'].every(k=>typeof o[k as keyof PortalContent]==='string')&&Array.isArray(o.businesses)&&o.businesses.length<=20&&o.businesses.every(b=>b&&typeof b.id==='string'&&typeof b.name==='string'&&typeof b.tagline==='string'&&typeof b.description==='string'&&typeof b.url==='string'&&typeof b.visible==='boolean');
}

export function safeImage(value:unknown){if(typeof value!=='string')return undefined;return /^\/assets\/[a-zA-Z0-9_./-]+$/.test(value)&&!value.includes('..')?value:safeLink(value)!=='#kontakt'?safeLink(value):undefined;}
