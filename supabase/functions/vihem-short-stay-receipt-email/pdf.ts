import {PDFDocument,StandardFonts,rgb} from 'npm:pdf-lib@1.17.1';
export async function receiptPdf(s: any): Promise<Uint8Array> {
 const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);let page=doc.addPage([595,842]),y=785;
 const clean=(v:string)=>Array.from(v.replace(/[–—]/g,'-').replace(/[\u202f\u00a0]/g,' ')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 const write=(value:string,heading=false,width=483)=>{let text=clean(value);const f=heading?bold:font,size=heading?15:11;while(text){let end=text.length;while(end>1&&f.widthOfTextAtSize(text.slice(0,end),size)>width)end--;if(end<text.length){const space=text.lastIndexOf(' ',end);if(space>0)end=space;}if(y<70){page=doc.addPage([595,842]);y=785;}page.drawText(text.slice(0,end),{x:56,y,size,font:f,color:rgb(.08,.15,.28)});y-=heading?24:17;text=text.slice(end).trimStart();}y-=5;};
 const money=(n:number)=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:s.currency}).format(n);
 write(s.title,true);write(s.issuer);write(`Bokning: ${s.bookingId}`);if(s.companyNumber)write(`Org.nr ${s.companyNumber}`);write(`Datum: ${new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Stockholm'})}`);write(`Kund: ${s.guest}`);write(s.recipient);if(s.phone)write(s.phone);write(s.unit);write(`${s.start} - ${s.end}`);write(`${s.guests} gäster · ${s.channel}`);y-=10;
 for(const row of [...s.lines.map((line:any)=>[line.description,Number(line.amount)]),['Totalt',s.total],['Exkl. moms',s.net],[`Moms (${s.rate}%)`,s.vat],['Betalt',s.paid],['Kvar att betala',s.due]]){if(y<90){page=doc.addPage([595,842]);y=785;}const amount=clean(money(row[1]));page.drawText(amount,{x:539-bold.widthOfTextAtSize(amount,11),y,size:11,font:bold});write(row[0],false,330);y-=8;}
 doc.getPages().forEach((p,index)=>p.drawText(`${index+1} / ${doc.getPageCount()}`,{x:520,y:30,size:9,font}));return await doc.save();
}
