import type { FinanceCompany } from '../types';

export function defaultShortStayCompany(companies: FinanceCompany[]): FinanceCompany | undefined {
  const normalise = (name: string) => name.trim().toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ').replace(/ ab$/, '');
  return companies.find(company => normalise(company.name) === 'vibogruppen' || normalise(company.legal_name || '') === 'vibogruppen');
}

export type ReceiptPdfInput = { title: string; issuer: string; bookingId: string; details: string[]; rows: { label: string; amount: string }[] };

/** Local PDF: no public upload, financial writes or mail transport. */
export async function makeShortStayReceiptPdf(input: ReceiptPdfInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const printable = (text: string) => Array.from(text.replace(/[–—]/g, '-').replace(/[\u202f\u00a0]/g, ' ')).map(char => {
    try { font.encodeText(char); return char; } catch { return '?'; }
  }).join('');
  let page = pdf.addPage([595,842]); let y = 785;
  const newPage = () => { page = pdf.addPage([595,842]); y = 785; };
  const line = (text: string, heading = false, width = 483) => {
    const size = heading ? 15 : 11; const currentFont = heading ? bold : font;
    let remaining = printable(text);
    while (remaining.length) {
      let end = remaining.length;
      while (end > 1 && currentFont.widthOfTextAtSize(remaining.slice(0,end),size) > width) end--;
      if (end < remaining.length) { const space=remaining.lastIndexOf(' ',end); if(space>0) end=space; }
      if(y<70) newPage();
      page.drawText(remaining.slice(0,end),{x:56,y,size,font:currentFont,color:rgb(.08,.15,.28)});
      remaining=remaining.slice(end).trimStart();y-=heading?24:17;
    }
    y-=5;
  };
  line(input.title,true); line(input.issuer);line(`Bokning: ${input.bookingId}`);
  y-=10;for(const detail of input.details) line(detail);
  y-=10;for(const row of input.rows) {
    if(y<90) newPage();
    const amount=printable(row.amount);const size=11;
    page.drawText(amount,{x:539-bold.widthOfTextAtSize(amount,size),y,size,font:bold,color:rgb(.08,.15,.28)});
    line(row.label,false,330);y-=8;
  }
  line('Skapat från bokningsuppgifter i VI-HEM.');
  pdf.getPages().forEach((p,index)=>p.drawText(`${index+1} / ${pdf.getPageCount()}`,{x:520,y:30,size:9,font}));
  return new Blob([new Uint8Array(await pdf.save()).buffer],{type:'application/pdf'});
}
