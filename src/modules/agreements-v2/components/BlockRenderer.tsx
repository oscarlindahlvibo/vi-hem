// Read-only block renderer -- used by the editor's preview pane AND the
// public signing page. Deliberately the SAME component in both places: what
// a signer sees must be exactly what staff previewed, no second render path
// to drift out of sync.
import { useEffect, useState } from 'react';
import type { AgreementAttachment, AgreementBlock, AgreementParty, AgreementSigner } from '../types';
import { calcPriceTable, formatSek, type DeductionType, type PriceTableContent, type PriceTableItem } from '../blocks/priceTable';

type RendererAttachment = Pick<AgreementAttachment, 'id' | 'name' | 'content_type'>;

function formatCurrency(amount: string, unit: string): string {
  const n = Number(amount.replace(',', '.'));
  if (!Number.isFinite(n)) return `${amount} ${unit}`.trim();
  return `${n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${unit}`.trim();
}

export function BlockRenderer({
  blocks,
  parties = [],
  signers = [],
  attachments = [],
  resolveAttachmentUrl,
}: {
  blocks: AgreementBlock[];
  parties?: Pick<AgreementParty, 'display_name' | 'party_type'>[];
  signers?: Pick<AgreementSigner, 'name' | 'role_title'>[];
  // Both optional -- omitting them (e.g. contexts with no attachment data at
  // hand) just falls back to the plain "📎 label" line an attachment_ref
  // block always used to render, so this can't break any existing caller.
  attachments?: RendererAttachment[];
  resolveAttachmentUrl?: (attachmentId: string) => Promise<string>;
}) {
  return (
    <div className="space-y-3 text-sm text-slate-800">
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} parties={parties} signers={signers} attachments={attachments} resolveAttachmentUrl={resolveAttachmentUrl} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  parties,
  signers,
  attachments,
  resolveAttachmentUrl,
}: {
  block: AgreementBlock;
  parties: Pick<AgreementParty, 'display_name' | 'party_type'>[];
  signers: Pick<AgreementSigner, 'name' | 'role_title'>[];
  attachments: RendererAttachment[];
  resolveAttachmentUrl?: (attachmentId: string) => Promise<string>;
}) {
  const c = block.content || {};
  switch (block.block_type) {
    case 'heading':
      return <h1 className="text-2xl font-bold text-slate-900">{c.text || ''}</h1>;
    case 'subheading':
      return <h2 className="text-lg font-semibold text-slate-900">{c.text || ''}</h2>;
    case 'paragraph':
      return <p className="whitespace-pre-wrap leading-relaxed">{c.text || ''}</p>;
    case 'callout': {
      const toneClass = c.tone === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-900' : c.tone === 'success' ? 'border-green-300 bg-green-50 text-green-900' : 'border-blue-300 bg-blue-50 text-blue-900';
      return <div className={`rounded-lg border px-4 py-3 whitespace-pre-wrap ${toneClass}`}>{c.text || ''}</div>;
    }
    case 'party': {
      const party = parties[c.party_index || 0];
      return (
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs font-medium uppercase text-slate-500">Avtalspart</p>
          <p className="font-semibold text-slate-900">{party?.display_name || '(part ej vald)'}</p>
        </div>
      );
    }
    case 'contact_info':
      return <p className="whitespace-pre-wrap text-slate-600">{c.text || ''}</p>;
    case 'date':
      return (
        <p>
          <span className="font-medium">{c.label || 'Datum'}:</span> {c.value || '—'}
        </p>
      );
    case 'dynamic_field':
      return (
        <p>
          <span className="font-medium">{c.label || ''}:</span> {c.token || ''}
        </p>
      );
    case 'price':
      return (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5">
          <span className="min-w-0 flex-1 break-words">{c.label || ''}</span>
          <span className="shrink-0 whitespace-nowrap font-semibold">{formatCurrency(String(c.amount || ''), String(c.unit || 'kr'))}</span>
        </div>
      );
    case 'price_table': {
      const items: PriceTableItem[] = Array.isArray(c.items) ? c.items : [];
      const totals = calcPriceTable(c as Partial<PriceTableContent>);
      const deductionType: DeductionType = c.deduction_type || 'none';
      return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              Prisform: {c.price_form === 'recurring' ? 'Löpande räkning' : 'Fast pris'}
            </span>
            {deductionType !== 'none' && (
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                {deductionType === 'rut' ? 'Rutavdrag' : 'Rotavdrag'} {c.deduction_rate ?? 0}%
              </span>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 break-words text-slate-700">
                  {item.description || '—'}
                  {deductionType !== 'none' && item.deduction_eligible && <span className="ml-1.5 text-xs text-green-600">(arbete)</span>}
                </span>
                <span className="shrink-0 whitespace-nowrap text-slate-500">{item.quantity} × {item.unit_price} kr</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-500"><span>Netto</span><span>{formatSek(totals.netto)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Moms</span><span>{formatSek(totals.moms)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Öresavrundning</span><span>{formatSek(totals.roundOff)}</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900"><span>Total inkl. moms</span><span>{formatSek(totals.total)}</span></div>
            {deductionType !== 'none' && (
              <>
                <div className="flex justify-between text-green-700">
                  <span>{deductionType === 'rut' ? 'Rutavdrag' : 'Rotavdrag'}{c.deduction_personal_number ? ` (${c.deduction_personal_number})` : ''}</span>
                  <span>-{formatSek(totals.deductionAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900"><span>Att betala</span><span>{formatSek(totals.amountToPay)}</span></div>
              </>
            )}
          </div>
        </div>
      );
    }
    case 'table': {
      const headers: string[] = c.headers || [];
      const rows: string[][] = c.rows || [];
      return (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                {headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 font-medium text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-slate-100 last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'bullet_list': {
      const items: string[] = c.items || [];
      return (
        <ul className="list-disc space-y-1 pl-5">
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      );
    }
    case 'checklist': {
      const items: { text: string; checked?: boolean }[] = c.items || [];
      return (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5">{item.checked ? '☑' : '☐'}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      );
    }
    case 'image':
      return c.url ? <img src={c.url} alt={c.alt || ''} className="max-h-64 rounded-lg border border-slate-200 object-contain" /> : <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-slate-400">Ingen bild vald</div>;
    case 'divider':
      return <hr className="border-slate-200" />;
    case 'page_break':
      return <div className="my-2 border-t-2 border-dashed border-slate-300 pt-2 text-center text-xs text-slate-400">— Sidbrytning —</div>;
    case 'terms':
      return (
        <div>
          {c.title && <h3 className="mb-1 font-semibold text-slate-900">{c.title}</h3>}
          <p className="whitespace-pre-wrap text-slate-700">{c.text || ''}</p>
        </div>
      );
    case 'signature_block': {
      const signer = signers[c.signer_index || 0];
      return (
        <div className="rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-center">
          <p className="text-xs uppercase text-slate-400">Signatur</p>
          <p className="mt-1 font-medium text-slate-700">{signer?.name || '(signatär ej vald)'}</p>
          {signer?.role_title && <p className="text-sm text-slate-500">{signer.role_title}</p>}
        </div>
      );
    }
    case 'attachment_ref': {
      const attachment = attachments.find((a) => a.id === c.attachment_id);
      if (attachment && resolveAttachmentUrl) {
        return <AttachmentEmbed attachment={attachment} label={c.label} resolveUrl={resolveAttachmentUrl} />;
      }
      return <p className="text-blue-700">📎 {c.label || 'Se bilaga'}</p>;
    }
    case 'fillable_text':
      return (
        <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50/50 px-3 py-2">
          <p className="text-xs font-medium text-blue-700">{c.label || 'Fyll i'}</p>
          <p className="text-sm text-blue-400">{c.placeholder || 'Mottagaren fyller i detta fält'}</p>
        </div>
      );
    case 'checkbox_consent':
      return (
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
          <input type="checkbox" disabled className="mt-1 h-4 w-4" />
          <span>{c.text || ''}</span>
        </label>
      );
    default:
      return null;
  }
}

// Fetches its own signed URL (via whichever resolver the caller supplied --
// a public signing token or a staff Supabase session, see the two call
// sites), then downloads the bytes itself and re-embeds them as a `blob:`
// URL rather than pointing the <iframe>/<img> straight at the signed
// storage URL. Storage/CDN backends commonly answer with
// `X-Frame-Options`/`Content-Security-Policy: frame-ancestors` that block
// being framed from a different origin (app.vi-hem.se vs. the storage
// project's own domain) -- that response header makes the iframe render
// silently blank, no console error, nothing for `onError` to catch. A
// `blob:` URL is same-origin by construction, so it sidesteps that
// entirely. The point of the "signature disappears" bug report this
// replaces a bare link for is letting a signer actually read what they're
// about to sign without leaving the page.
function AttachmentEmbed({
  attachment,
  label,
  resolveUrl,
}: {
  attachment: RendererAttachment;
  label?: string;
  resolveUrl: (attachmentId: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    (async () => {
      const signedUrl = await resolveUrl(attachment.id);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setUrl(objectUrl);
    })().catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, resolveUrl]);

  const isPdf = attachment.content_type === 'application/pdf';
  const isImage = attachment.content_type.startsWith('image/');

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">📎 {label || attachment.name}</p>
      {error && <p className="text-xs text-red-600">Kunde inte visa bilagan. Försök igen senare.</p>}
      {!error && !url && <p className="text-xs text-slate-400">Laddar förhandsgranskning...</p>}
      {url && isPdf && (
        <iframe src={url} title={attachment.name} className="h-[70vh] w-full rounded border border-slate-200 bg-white" />
      )}
      {url && isImage && <img src={url} alt={attachment.name} className="w-full rounded border border-slate-200" />}
      {url && !isPdf && !isImage && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline">Öppna {attachment.name}</a>
      )}
    </div>
  );
}
