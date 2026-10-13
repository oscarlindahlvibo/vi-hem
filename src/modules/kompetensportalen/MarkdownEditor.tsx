import { useRef, useState } from 'react';
import { Bold, Heading2, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered } from 'lucide-react';
import { uploadMedia } from './api';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-blue-700 underline">$1</a>');

/** Enkel förhandsvisning som speglar webbplatsens markdown (rubriker, listor, fet/kursiv, länkar, bilder, citat). */
export function renderPreview(src: string): string {
  const out: string[] = []; let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd(); let m: RegExpExecArray | null;
    if (!line.trim()) { close(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { close(); out.push(`<h${m[1].length + 1} class="mt-3 font-semibold">${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if ((m = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/.exec(line.trim()))) { close(); out.push(`<figure class="my-2"><img src="${esc(m[2])}" alt="${esc(m[1])}" class="max-h-64 rounded-lg" /></figure>`); continue; }
    if ((m = /^(\s*)[-*]\s+(.*)$/.exec(line))) { if (list !== 'ul') { close(); out.push('<ul class="list-disc pl-5">'); list = 'ul'; } out.push(`<li style="margin-left:${Math.min(2, Math.floor(m[1].length / 2)) * 18}px">${inline(m[2])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { close(); out.push('<ol class="list-decimal pl-5">'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { close(); out.push(`<blockquote class="border-l-4 border-slate-300 pl-3 text-slate-600">${inline(m[1])}</blockquote>`); continue; }
    close(); out.push(`<p class="my-1">${inline(line)}</p>`);
  }
  close(); return out.join('');
}

/** Textredigerare med verktygsfält. Värdet är markdown; sparas när fältet lämnas (onCommit). */
export function MarkdownEditor({ value, disabled, onCommit, label = 'Text' }: { value: string; disabled?: boolean; onCommit: (v: string) => void; label?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null); const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value); const [preview, setPreview] = useState(false); const [msg, setMsg] = useState('');
  const commit = (v: string) => { if (v !== value) onCommit(v); };
  const edit = (fn: (sel: string, before: string, after: string) => { text: string; select?: [number, number] }) => {
    const el = ref.current; if (!el) return; const a = el.selectionStart, b = el.selectionEnd;
    const r = fn(text.slice(a, b), text.slice(0, a), text.slice(b)); setText(r.text);
    requestAnimationFrame(() => { el.focus(); if (r.select) el.setSelectionRange(r.select[0], r.select[1]); });
  };
  const wrap = (mark: string, ph: string) => edit((sel, before, after) => { const inner = sel || ph; return { text: before + mark + inner + mark + after, select: [before.length + mark.length, before.length + mark.length + inner.length] }; });
  const linePrefix = (prefix: string) => edit((sel, before, after) => { const start = before.lastIndexOf('\n') + 1; const head = before.slice(0, start), cur = before.slice(start) + sel; const lines = (cur || 'Text').split('\n').map(l => (prefix === '1. ' ? '1. ' : prefix) + l.replace(/^(#{1,3}\s+|[-*]\s+|\d+[.)]\s+)/, '')); return { text: head + lines.join('\n') + after }; });
  const link = () => { const url = prompt('Webbadress (https://…)'); if (!url) return; edit((sel, before, after) => ({ text: `${before}[${sel || 'länktext'}](${url})${after}` })); };
  const image = async (f?: File) => {
    if (!f) return; setMsg('Laddar upp bild…');
    try { const a = await uploadMedia(f, 'image', { isPublic: true, alt: f.name.replace(/\.[^.]+$/, '') }); const alt = prompt('Beskriv bilden för den som inte ser den (alternativtext)', f.name.replace(/\.[^.]+$/, '')) ?? ''; edit((_s, before, after) => ({ text: `${before}${before && !before.endsWith('\n') ? '\n\n' : ''}![${alt}](${a.publicUrl})\n\n${after}` })); setMsg('Bilden är infogad. Spara genom att klicka utanför rutan.'); }
    catch (e) { setMsg((e as Error).message); }
  };
  const Btn = ({ title, onClick, children }: any) => <button type="button" title={title} aria-label={title} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick} className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40">{children}</button>;
  return <div className="space-y-1.5"><div className="flex flex-wrap items-center gap-1.5"><span className="mr-2 text-sm font-medium text-slate-700">{label}</span>
    <Btn title="Rubrik" onClick={() => linePrefix('## ')}><Heading2 className="h-4 w-4" /></Btn><Btn title="Fet" onClick={() => wrap('**', 'fet text')}><Bold className="h-4 w-4" /></Btn><Btn title="Kursiv" onClick={() => wrap('*', 'kursiv text')}><Italic className="h-4 w-4" /></Btn>
    <Btn title="Punktlista" onClick={() => linePrefix('- ')}><List className="h-4 w-4" /></Btn><Btn title="Numrerad lista" onClick={() => linePrefix('1. ')}><ListOrdered className="h-4 w-4" /></Btn><Btn title="Länk" onClick={link}><LinkIcon className="h-4 w-4" /></Btn>
    <Btn title="Infoga bild" onClick={() => file.current?.click()}><ImageIcon className="h-4 w-4" /></Btn><input ref={file} type="file" accept="image/*" hidden onChange={e => { void image(e.target.files?.[0]); e.target.value = ''; }} />
    <button type="button" className="ml-auto text-xs text-blue-700 underline" onClick={() => { setPreview(p => !p); commit(text); }}>{preview ? 'Redigera' : 'Förhandsgranska'}</button></div>
    {preview ? <div className="min-h-[8rem] rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" dangerouslySetInnerHTML={{ __html: renderPreview(text) || '<p class="text-slate-400">Inget innehåll ännu.</p>' }} />
      : <textarea ref={ref} rows={10} disabled={disabled} value={text} onChange={e => setText(e.target.value)} onBlur={() => commit(text)} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" aria-label={label} />}
    {msg && <p className="text-xs text-slate-600" role="status">{msg}</p>}</div>;
}
