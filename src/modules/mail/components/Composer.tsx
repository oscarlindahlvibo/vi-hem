import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, ChevronDown, Clock, FileText, Image as ImageIcon, Italic, Link2, List, ListOrdered, Loader2, Maximize2, Minimize2, Paperclip, Quote, Send, Trash2, Underline as UnderlineIcon, X } from 'lucide-react';
import { RecipientField } from './RecipientField';
import { fileToBase64, mailApi, MailApiError, uuid } from '../lib/api';
import { suggestSender, validEmail } from '../lib/compose';
import { findSignatureBlock, hashHtml, stripSignature, wrapSignature } from '../lib/signature';
import { renderTemplate } from '../lib/templates';
import { sanitizeComposerHtml } from '../lib/sanitize';
import { formatBytes, nextMonday, nextMorning, toLocalInput } from '../lib/format';
import { useToasts } from '../hooks/useToasts';
import type { MailAccount, MailAddress, SendAsIdentity } from '../lib/types';

export interface ComposeSeed {
  to?: MailAddress[]; cc?: MailAddress[]; bcc?: MailAddress[]; subject?: string; bodyHtml?: string; quoteHtml?: string; threadId?: string; inReplyTo?: string; references?: string; deliveredTo?: string[];
  attachments?: { name: string; type: string; size: number; base64: string }[]; draftId?: string; senderHint?: { deliveredTo: string[]; to: string[]; cc: string[] } | null; title?: string;
}
export interface TemplateRow { id: string; name: string; subject: string; body: string; shared?: boolean }
interface Att { id: string; name: string; type: string; size: number; base64: string }
const MAX_TOTAL = 20 * 1024 * 1024; // Gmail tillåter 25 MB inklusive MIME-överhead
const UNDO_MS = 8000;

interface Props {
  account: MailAccount; identities: SendAsIdentity[]; seed: ComposeSeed; lastSender?: Record<string, string>; suggestions: MailAddress[]; templates: TemplateRow[];
  templateVars?: Record<string, string | undefined>; onClose: () => void; onSent: (r: { threadId: string | null; status: string }) => void; onSenderUsed?: (email: string) => void; embedded?: boolean;
}

/** Skriv-ruta: Tiptap, avsändarval (alias från Gmail), signaturbyte utan att röra egen text, autosparade utkast i Gmail, bilagor, ångra skicka och schemalagt utskick. */
export function Composer({ account, identities, seed, lastSender, suggestions, templates, templateVars, onClose, onSent, onSenderUsed, embedded }: Props) {
  const toast = useToasts();
  const verified = useMemo(() => identities.filter((i) => i.verified), [identities]);
  const initialFrom = useMemo(() => suggestSender(identities, seed.senderHint ?? null, lastSender, account.id) || account.email, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState<MailAddress[]>(seed.to ?? []); const [cc, setCc] = useState<MailAddress[]>(seed.cc ?? []); const [bcc, setBcc] = useState<MailAddress[]>(seed.bcc ?? []);
  const [showCc, setShowCc] = useState(Boolean(seed.cc?.length)); const [showBcc, setShowBcc] = useState(Boolean(seed.bcc?.length)); const [showReplyTo, setShowReplyTo] = useState(false); const [replyTo, setReplyTo] = useState('');
  const [subject, setSubject] = useState(seed.subject ?? '');
  const [atts, setAtts] = useState<Att[]>(() => (seed.attachments ?? []).map((a) => ({ id: uuid(), ...a }))); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState<'' | 'saving' | 'saved' | 'error'>(''); const [full, setFull] = useState(false);
  const [menu, setMenu] = useState<'' | 'schedule' | 'templates'>(''); const [scheduleAt, setScheduleAt] = useState(toLocalInput(nextMorning(1, 8)));
  const [quote, setQuote] = useState(seed.quoteHtml ?? ''); const [showQuote, setShowQuote] = useState(false);
  const draftId = useRef<string | undefined>(seed.draftId); const dirty = useRef(false); const sentRef = useRef(false); const timer = useRef<number>(); const pendingSend = useRef<number>(); const requestId = useRef(uuid());
  const fileInput = useRef<HTMLInputElement>(null); const imageInput = useRef<HTMLInputElement>(null);

  // Signatur: eget block utanför Tiptap (Tiptap tar bort okända noder). Byte av avsändare byter blocket om användaren inte ändrat det.
  const sigFor = useCallback((email: string) => identities.find((i) => i.email.toLowerCase() === email.toLowerCase())?.signature ?? '', [identities]);
  const initialSig = useMemo(() => { const ex = seed.bodyHtml ? findSignatureBlock(seed.bodyHtml) : null; return ex ? { html: ex.inner, orig: ex.hash } : { html: sigFor(initialFrom), orig: hashHtml(sigFor(initialFrom)) }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [sig, setSig] = useState(initialSig.html); const sigOrig = useRef(initialSig.orig); const sigRef = useRef<HTMLDivElement>(null);
  const sigEdited = hashHtml(sig) !== sigOrig.current;
  useEffect(() => { if (sigRef.current && sigRef.current.innerHTML !== sig) sigRef.current.innerHTML = sanitizeComposerHtml(sig); }, [sig]);

  const startBody = useMemo(() => (seed.bodyHtml ? stripSignature(seed.bodyHtml) : ''), []); // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false }), Underline, Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }), Image.configure({ inline: true, allowBase64: true }), Placeholder.configure({ placeholder: 'Skriv ditt meddelande …' })],
    content: startBody, editorProps: { attributes: { class: 'prose prose-sm max-w-none min-h-[10rem] px-1 py-2 text-[15px] leading-relaxed focus:outline-none', 'aria-label': 'Meddelande' } },
    onUpdate: () => { dirty.current = true; schedule(); },
  });

  const bodyHtml = () => editor?.getHTML() ?? '';
  const empty = () => !editor || (editor.isEmpty && !atts.length && !quote);
  const fullHtml = useCallback(() => {
    const s = sig.trim() ? wrapSignature(sig, from) .replace(/data-vihem-sig-hash="[^"]*"/, `data-vihem-sig-hash="${sigOrig.current}"`) : '';
    return `${bodyHtml()}${s}${quote}`; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sig, from, quote]);
  const payload = useCallback(() => ({ account_id: account.id, from, to, cc, bcc, subject, html: fullHtml(), reply_to: replyTo.trim() || undefined, thread_id: seed.threadId, in_reply_to: seed.inReplyTo, references: seed.references,
    attachments: atts.map((a) => ({ name: a.name, type: a.type, base64: a.base64 })) }), [account.id, from, to, cc, bcc, subject, fullHtml, replyTo, seed, atts]);

  // Autosparar utkast i Gmail (syns i Gmails Utkast). Sparar inte tomma meddelanden.
  const saveDraft = useCallback(async () => {
    if (sentRef.current || !dirty.current || empty()) return;
    dirty.current = false; setSaving('saving');
    try { const r = await mailApi<{ draft_id: string }>('draft_save', { ...payload(), draft_id: draftId.current }); draftId.current = r.draft_id; setSaving('saved'); }
    catch (e) { dirty.current = true; setSaving('error'); if (e instanceof MailApiError && e.code === 'E_FORBIDDEN') toast.show('Du saknar behörighet att spara utkast i den här brevlådan.', { kind: 'error' }); }
  }, [payload]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveRef = useRef(saveDraft); saveRef.current = saveDraft;
  function schedule() { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => saveRef.current(), 3000); }
  useEffect(() => { dirty.current = true; if (!empty()) schedule(); }, [to, cc, bcc, subject, from, sig, atts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.clearTimeout(timer.current); }, []);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (!sentRef.current && dirty.current && !empty()) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }); // eslint-disable-line react-hooks/exhaustive-deps

  function changeFrom(email: string) {
    const prevOrig = sigOrig.current; setFrom(email); dirty.current = true;
    if (hashHtml(sig) === prevOrig || !sig.trim()) { const next = sigFor(email); setSig(next); sigOrig.current = hashHtml(next); } // orörd signatur byts; manuellt ändrad lämnas
    else toast.show('Din ändrade signatur behölls. Ta bort den för att få den nya avsändarens signatur.');
  }

  async function addFiles(files: FileList | File[], inlineImage = false) {
    const list = [...files]; let total = atts.reduce((n, a) => n + a.size, 0);
    for (const f of list) {
      if (inlineImage && f.type.startsWith('image/')) { const b64 = await fileToBase64(f); editor?.chain().focus().setImage({ src: `data:${f.type};base64,${b64}` }).run(); continue; }
      if (total + f.size > MAX_TOTAL) { toast.show(`"${f.name}" ryms inte – bilagor får vara högst ${formatBytes(MAX_TOTAL)} sammanlagt.`, { kind: 'error' }); continue; }
      total += f.size; const id = uuid(); setAtts((a) => [...a, { id, name: f.name, type: f.type || 'application/octet-stream', size: f.size, base64: '' }]);
      const b64 = await fileToBase64(f); setAtts((a) => a.map((x) => (x.id === id ? { ...x, base64: b64 } : x)));
    }
  }

  const problems = (): string => {
    const all = [...to, ...cc, ...bcc]; if (!all.length) return 'Lägg till minst en mottagare.';
    const bad = all.find((a) => !validEmail(a.email)); if (bad) return `Ogiltig adress: ${bad.email}`;
    if (atts.some((a) => !a.base64)) return 'Bilagor laddas fortfarande …';
    if (!subject.trim() && !window.confirm('Skicka utan ämne?')) return 'cancel';
    if (/\b(bifogar|bifogat|bifogade|se bilaga)\b/i.test(bodyHtml().replace(/<[^>]+>/g, ' ')) && !atts.length && !window.confirm('Du nämner en bilaga men har inte bifogat något. Skicka ändå?')) return 'cancel';
    return '';
  };

  async function doSend(at?: Date) {
    const p = problems(); if (p) { if (p !== 'cancel') toast.show(p, { kind: 'error' }); return; }
    window.clearTimeout(timer.current); setMenu(''); setBusy(true); sentRef.current = true; const body = { ...payload(), client_request_id: requestId.current, draft_id: draftId.current, schedule_at: at ? at.toISOString() : undefined };
    const fire = async () => {
      try {
        const r = await mailApi<{ status: string; thread_id: string | null; ledger_id: string }>('send', body);
        onSenderUsed?.(from);
        if (r.status === 'unknown') toast.show('Osäkert om meddelandet skickades. Kontrollera Skickat innan du försöker igen – ett nytt försök kontrollerar först och skickar inte dubbelt.', { kind: 'error', ms: 12000 });
        else if (at) toast.show(`Schemalagt till ${at.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}.`, { kind: 'success', actionLabel: 'Ångra', onAction: () => mailApi('send_cancel', { account_id: account.id, ledger_id: r.ledger_id }).then(() => toast.show('Utskicket avbröts. Meddelandet finns kvar som utkast.')).catch((e) => toast.show(e.message, { kind: 'error' })) });
        else toast.show('Meddelandet skickades.', { kind: 'success' });
        onSent({ threadId: r.thread_id, status: r.status });
      } catch (e) {
        sentRef.current = false; setBusy(false);
        toast.show(e instanceof MailApiError && e.code === 'SCOPE_NOT_AUTHORIZED' ? 'Skicka är inte aktiverat ännu: Google-behörigheten gmail.modify måste godkännas av en administratör.' : (e as Error).message, { kind: 'error', ms: 9000 });
      }
    };
    if (at) { await fire(); return; }
    // Ångra skicka: fördröjer anropet. Samma client_request_id används så att ett nytt klick aldrig kan ge dubbla utskick.
    onClose();
    toast.show('Skickar …', { actionLabel: 'Ångra', ms: UNDO_MS, onAction: () => { window.clearTimeout(pendingSend.current); sentRef.current = false; toast.show('Skickandet ångrades. Utkastet finns kvar.'); window.dispatchEvent(new CustomEvent('vihem-mail-reopen', { detail: { seed: { ...seed, to, cc, bcc, subject, bodyHtml: fullHtml(), quoteHtml: undefined, draftId: draftId.current } } })); } });
    pendingSend.current = window.setTimeout(fire, UNDO_MS);
  }

  async function discard() {
    if (!empty() && !window.confirm('Kasta utkastet?')) return;
    window.clearTimeout(timer.current); sentRef.current = true;
    if (draftId.current) await mailApi('draft_delete', { account_id: account.id, draft_id: draftId.current }).catch(() => {});
    onClose();
  }
  async function closeKeep() { window.clearTimeout(timer.current); await saveDraft(); if (!empty() && draftId.current) toast.show('Utkastet sparades.'); onClose(); }

  function applyTemplate(t: TemplateRow) {
    const vars = { avsandare: identities.find((i) => i.email === from)?.name || '', mottagare: to[0]?.name || to[0]?.email.split('@')[0] || '', ...templateVars };
    const b = renderTemplate(t.body, vars, { html: true }); const s = renderTemplate(t.subject, vars);
    const missing = [...new Set([...b.missing, ...s.missing])];
    if (missing.length && !window.confirm(`Följande värden saknas och lämnas tomma: ${missing.join(', ')}. Infoga ändå?`)) return;
    editor?.chain().focus().insertContent(b.text.replace(/\n/g, '<br>')).run(); if (!subject.trim() && s.text) setSubject(s.text); setMenu(''); dirty.current = true; schedule();
  }
  function setLink() { const prev = editor?.getAttributes('link').href as string | undefined; const url = window.prompt('Länkadress', prev ?? 'https://'); if (url === null) return; if (!url) { editor?.chain().focus().unsetLink().run(); return; } if (!/^(https?:|mailto:)/i.test(url)) { toast.show('Endast http-, https- och mailto-länkar tillåts.', { kind: 'error' }); return; } editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); }

  const tb = (active: boolean) => `rounded-lg p-2 transition ${active ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`;
  const sendDisabled = busy;
  const onKey = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void doSend(); } if (e.key === 'Escape' && !menu) { e.stopPropagation(); void closeKeep(); } };

  return (
    <div role="dialog" aria-label={seed.title || 'Nytt meddelande'} onKeyDown={onKey} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void addFiles(e.dataTransfer.files); } }} onDragOver={(e) => e.preventDefault()}
      className={embedded ? 'flex min-h-0 flex-1 flex-col bg-white' : `fixed z-50 flex flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl ${full ? 'inset-0 sm:inset-6 sm:rounded-2xl' : 'inset-0 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(42rem,calc(100vh-2rem))] sm:w-[40rem] sm:rounded-2xl'}`}>
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 sm:rounded-t-2xl">
        <div className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{seed.title || 'Nytt meddelande'}</div>
        <span className="text-xs text-slate-500" aria-live="polite">{saving === 'saving' ? 'Sparar …' : saving === 'saved' ? 'Utkast sparat' : saving === 'error' ? 'Kunde inte spara' : ''}</span>
        {!embedded && <button type="button" onClick={() => setFull((f) => !f)} className="hidden rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 sm:block" aria-label={full ? 'Förminska' : 'Helskärm'}>{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>}
        <button type="button" onClick={() => void closeKeep()} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200" aria-label="Spara och stäng"><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="flex items-center gap-2 border-b border-slate-200 py-2 text-sm"><span className="w-8 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Från</span>
          {verified.length > 1 ? <select value={from} onChange={(e) => changeFrom(e.target.value)} aria-label="Avsändare" className="min-w-0 flex-1 rounded-lg border-0 bg-transparent py-1 text-sm font-medium focus:ring-0">{verified.map((i) => <option key={i.email} value={i.email}>{i.name ? `${i.name} <${i.email}>` : i.email}</option>)}</select> : <span className="truncate font-medium">{from}</span>}
          <span className="ml-auto flex shrink-0 gap-2 text-xs font-semibold text-blue-700">{!showCc && <button type="button" onClick={() => setShowCc(true)}>Kopia</button>}{!showBcc && <button type="button" onClick={() => setShowBcc(true)}>Hemlig kopia</button>}{!showReplyTo && <button type="button" onClick={() => setShowReplyTo(true)}>Svarsadress</button>}</span></div>
        <RecipientField label="Till" value={to} onChange={setTo} suggestions={suggestions} autoFocus={!to.length} />
        {showCc && <RecipientField label="Kopia" value={cc} onChange={setCc} suggestions={suggestions} />}
        {showBcc && <RecipientField label="Dold" value={bcc} onChange={setBcc} suggestions={suggestions} />}
        {showReplyTo && <div className="flex items-center gap-2 border-b border-slate-200 py-1.5 text-sm"><span className="w-8 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Svar</span><input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} type="email" aria-label="Svarsadress" placeholder="Svar går till …" className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm focus:ring-0" /></div>}
        <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Ämne" placeholder="Ämne" className="w-full border-0 border-b border-slate-200 bg-transparent py-2.5 text-[15px] font-semibold focus:ring-0" />
        <EditorContent editor={editor} />
        <div className="mt-2 border-t border-dashed border-slate-200 pt-2">
          {(sig.trim() || sigEdited) ? <div className="group relative"><div ref={sigRef} contentEditable suppressContentEditableWarning onInput={(e) => { setSig(e.currentTarget.innerHTML); dirty.current = true; schedule(); }} aria-label="Signatur" className="rounded-lg px-1 py-1 text-sm text-slate-600 focus:bg-slate-50 focus:outline-none" />
            <button type="button" onClick={() => { setSig(''); dirty.current = true; schedule(); }} className="absolute right-0 top-0 hidden rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 shadow group-hover:block">Ta bort signatur</button></div>
            : sigFor(from) ? <button type="button" onClick={() => { const s = sigFor(from); setSig(s); sigOrig.current = hashHtml(s); }} className="text-xs font-semibold text-blue-700">Lägg till signatur</button> : null}
        </div>
        {quote && <div className="mt-2"><button type="button" onClick={() => setShowQuote((s) => !s)} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600" aria-expanded={showQuote} aria-label="Visa citerad text">•••</button>{showQuote && <div className="mt-1 max-h-60 overflow-auto text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: sanitizeComposerHtml(quote) }} />}</div>}
        {atts.length > 0 && <ul className="my-3 flex flex-wrap gap-2">{atts.map((a) => <li key={a.id} className="flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1 text-xs"><FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate font-medium">{a.name}</span><span className="shrink-0 text-slate-400">{a.base64 ? formatBytes(a.size) : <Loader2 className="h-3 w-3 animate-spin" />}</span><button type="button" aria-label={`Ta bort ${a.name}`} onClick={() => setAtts((l) => l.filter((x) => x.id !== a.id))} className="rounded p-1 hover:bg-slate-200"><X className="h-3 w-3" /></button></li>)}</ul>}
      </div>
      <footer className="relative flex flex-wrap items-center gap-1 border-t border-slate-200 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="relative flex">
          <button type="button" disabled={sendDisabled} onClick={() => void doSend()} className="inline-flex items-center gap-2 rounded-l-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Skicka</button>
          <button type="button" disabled={sendDisabled} onClick={() => setMenu(menu === 'schedule' ? '' : 'schedule')} aria-label="Schemalägg skickande" aria-expanded={menu === 'schedule'} className="rounded-r-xl border-l border-blue-500 bg-blue-600 px-2 text-white hover:bg-blue-700 disabled:opacity-50"><ChevronDown className="h-4 w-4" /></button>
          {menu === 'schedule' && <div className="absolute bottom-full left-0 z-40 mb-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            <div className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-400">Schemalägg skickande</div>
            {[['Imorgon förmiddag', nextMorning(1, 8)], ['Imorgon eftermiddag', nextMorning(1, 13)], ['Måndag förmiddag', nextMonday(8)]].map(([l, d]) => <button key={String(l)} type="button" onClick={() => void doSend(d as Date)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50"><span>{String(l)}</span><span className="text-xs text-slate-400">{(d as Date).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></button>)}
            <div className="mt-1 flex items-center gap-2 border-t border-slate-100 p-2"><input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} min={toLocalInput(new Date())} className="min-w-0 flex-1 rounded-lg border-slate-300 text-sm" aria-label="Egen tidpunkt" /><button type="button" onClick={() => { const d = new Date(scheduleAt); if (!(d.getTime() > Date.now() + 60000)) { toast.show('Välj en tidpunkt i framtiden.', { kind: 'error' }); return; } void doSend(d); }} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"><Clock className="h-4 w-4" /></button></div></div>}
        </div>
        <div className="ml-1 flex items-center">
          <button type="button" className={tb(!!editor?.isActive('bold'))} onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Fet"><Bold className="h-4 w-4" /></button>
          <button type="button" className={tb(!!editor?.isActive('italic'))} onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Kursiv"><Italic className="h-4 w-4" /></button>
          <button type="button" className={`${tb(!!editor?.isActive('underline'))} hidden sm:block`} onClick={() => editor?.chain().focus().toggleUnderline().run()} aria-label="Understruken"><UnderlineIcon className="h-4 w-4" /></button>
          <button type="button" className={tb(!!editor?.isActive('bulletList'))} onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label="Punktlista"><List className="h-4 w-4" /></button>
          <button type="button" className={`${tb(!!editor?.isActive('orderedList'))} hidden sm:block`} onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-label="Numrerad lista"><ListOrdered className="h-4 w-4" /></button>
          <button type="button" className={`${tb(!!editor?.isActive('blockquote'))} hidden sm:block`} onClick={() => editor?.chain().focus().toggleBlockquote().run()} aria-label="Citat"><Quote className="h-4 w-4" /></button>
          <button type="button" className={tb(!!editor?.isActive('link'))} onClick={setLink} aria-label="Länk"><Link2 className="h-4 w-4" /></button>
          <button type="button" className={tb(false)} onClick={() => fileInput.current?.click()} aria-label="Bifoga fil"><Paperclip className="h-4 w-4" /></button>
          <button type="button" className={`${tb(false)} hidden sm:block`} onClick={() => imageInput.current?.click()} aria-label="Infoga bild"><ImageIcon className="h-4 w-4" /></button>
          {templates.length > 0 && <div className="relative"><button type="button" className={tb(menu === 'templates')} onClick={() => setMenu(menu === 'templates' ? '' : 'templates')} aria-label="Mallar" aria-expanded={menu === 'templates'}><FileText className="h-4 w-4" /></button>
            {menu === 'templates' && <ul className="absolute bottom-full left-0 z-40 mb-2 max-h-64 w-64 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">{templates.map((t) => <li key={t.id}><button type="button" onClick={() => applyTemplate(t)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"><div className="font-semibold">{t.name}</div><div className="truncate text-xs text-slate-500">{t.subject}</div></button></li>)}</ul>}</div>}
        </div>
        <button type="button" onClick={() => void discard()} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Kasta utkast"><Trash2 className="h-4 w-4" /></button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files, true); e.target.value = ''; }} />
      </footer>
    </div>
  );
}
