// Avtalsskapare V3 (förhandsvisning) -- a redesign of the document-BUILDING
// canvas specifically (not the whole Avtal V2 module), matching a reference
// design the user shared: an icon sidebar of block categories with a
// flyout panel instead of a "Lägg till block"-modal, and a top toolbar with
// a Redigera/Förhandsgranska toggle + a primary action button.
//
// Deliberately reuses V2's real API, types, block registry, BlockRow (the
// per-block field editor) and BlockRenderer rather than forking any of that
// logic -- this is a new SHELL around the same document data, not a
// parallel implementation. Editing a document's content here saves to the
// exact same `vihem_agreement_blocks` a document has in Avtal V2, so it's
// safe to open a real document, compare the two editors side by side, and
// switch back to V2 for parties/signing/sending, which V3 doesn't attempt
// to reimplement -- the user's ask was specifically about the content
// creator's look, not the whole module.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  createAgreement,
  getAgreement,
  listAgreements,
  saveBlocks,
  uploadAttachment,
  AgreementApiError,
} from '../../agreements-v2/api';
import type { AgreementBlock, AgreementDetail, AgreementListItem, BlockType } from '../../agreements-v2/types';
import { BLOCK_TYPES, blockTypeDef, createBlock } from '../../agreements-v2/blocks/blockTypes';
import { BlockRow } from '../../agreements-v2/components/BlockEditor';
import { BlockRenderer } from '../../agreements-v2/components/BlockRenderer';
import {
  AlignLeft,
  ArrowLeft,
  DollarSign,
  FileCheck,
  Image as ImageIconLucide,
  LayoutList,
  Paperclip,
  PenLine,
  Plus,
  Save,
  Send,
  Type,
  UserRound,
} from 'lucide-react';

function describeError(err: unknown): string {
  if (err instanceof AgreementApiError) return err.message;
  return err instanceof Error ? err.message : 'Ett okänt fel inträffade.';
}

interface BlockCategory {
  key: string;
  label: string;
  icon: typeof Type;
  color: string;
  types: BlockType[];
}

// Same grouping spirit as the reference (Rubrik/Part/Pris/Text/Signatur/
// Bild/Bilaga/Villkor sidebar items) but built only from block types that
// actually exist in BLOCK_TYPES -- no "Video"/"Custom"/"Presentation"
// entries copied in just to look the part, since those aren't real
// features here.
const CATEGORIES: BlockCategory[] = [
  { key: 'header', label: 'Rubrik', icon: Type, color: 'bg-slate-700', types: ['heading', 'subheading', 'date', 'dynamic_field'] },
  { key: 'party', label: 'Part', icon: UserRound, color: 'bg-blue-600', types: ['party'] },
  { key: 'price', label: 'Pris', icon: DollarSign, color: 'bg-green-600', types: ['price', 'price_table'] },
  { key: 'text', label: 'Text', icon: AlignLeft, color: 'bg-indigo-600', types: ['paragraph', 'callout', 'contact_info', 'bullet_list', 'checklist', 'fillable_text', 'checkbox_consent'] },
  { key: 'signature', label: 'Signatur', icon: PenLine, color: 'bg-amber-600', types: ['signature_block'] },
  { key: 'image', label: 'Bild', icon: ImageIconLucide, color: 'bg-pink-600', types: ['image'] },
  { key: 'attachment', label: 'Bilaga', icon: Paperclip, color: 'bg-cyan-600', types: ['attachment_ref'] },
  { key: 'terms', label: 'Villkor', icon: FileCheck, color: 'bg-purple-600', types: ['terms'] },
  { key: 'layout', label: 'Layout', icon: LayoutList, color: 'bg-slate-500', types: ['table', 'divider', 'page_break'] },
];

export function AgreementsV3Page() {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!user?.organisation_id) return null;

  if (selectedId) {
    return <AgreementV3Builder agreementId={selectedId} organisationId={user.organisation_id} onBack={() => setSelectedId(null)} />;
  }
  return <AgreementV3Picker organisationId={user.organisation_id} onOpen={setSelectedId} />;
}

function AgreementV3Picker({ organisationId, onOpen }: { organisationId: string; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<AgreementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await listAgreements());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const created = await createAgreement({ document_type: 'agreement', title: 'Nytt testdokument (V3)' });
      onOpen(created.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          Avtalsskapare
          <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700">V3 · Förhandsvisning</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          En ny variant av dokumentbyggaren att prova sig fram i innan vi bestämmer om vi byter. Öppna ett befintligt
          dokument eller skapa ett testdokument nedan — samma verkliga data som i Avtal V2, bara en ny yta att bygga
          innehållet på. Parter, signering och utskick hanteras fortfarande i Avtal V2.
        </p>
      </div>

      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> {creating ? 'Skapar...' : 'Nytt testdokument'}
      </button>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Laddar...</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <p className="text-sm text-slate-500">Inga dokument ännu. Skapa ett testdokument för att prova V3.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onOpen(item.id)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{item.title || '(namnlöst dokument)'}</p>
                <p className="text-xs text-slate-400">{item.document_number}</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-blue-600">Öppna i V3 →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgreementV3Builder({ agreementId, organisationId, onBack }: { agreementId: string; organisationId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<AgreementDetail | null>(null);
  const [blocks, setBlocks] = useState<AgreementBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAgreement(agreementId);
      setDetail(data);
      setBlocks(data.blocks);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [agreementId]);

  useEffect(() => { load(); }, [load]);

  // Same "don't clobber unsaved edits" fix already learned the hard way in
  // V2: refreshing after an attachment upload must only touch the
  // read-only attachments list, never the lifted `blocks` state.
  const refreshAttachments = useCallback(async () => {
    try {
      const data = await getAgreement(agreementId);
      setDetail((prev) => (prev ? { ...prev, attachments: data.attachments } : data));
    } catch (err) {
      setError(describeError(err));
    }
  }, [agreementId]);

  if (loading) return <p className="text-sm text-slate-500">Laddar dokument...</p>;
  if (error && !detail) return <p className="text-sm text-red-700">{error}</p>;
  if (!detail) return null;

  const { agreement } = detail;
  const editable = agreement.status === 'draft' || agreement.status === 'ready';
  const dirty = JSON.stringify(blocks) !== JSON.stringify(detail.blocks);

  const persist = async (successMessage: string) => {
    setSaving(true);
    setError('');
    try {
      await saveBlocks(agreement.id, blocks);
      setDetail((prev) => (prev ? { ...prev, blocks } : prev));
      setMessage(successMessage);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => persist('Innehållet sparat.');
  const handleReviewAndSend = () => persist('Innehållet sparat. Öppna dokumentet i Avtal V2 för parter, signering och utskick.');

  const addBlock = (type: BlockType) => {
    setBlocks((prev) => [...prev, createBlock(type)]);
    setActiveCategory(null);
  };
  const updateBlock = (id: string, content: Record<string, any>) => setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, content } : b)));
  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id));
  const duplicateBlock = (id: string) => {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const copy = { ...prev[index], id: crypto.randomUUID() };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });
  };
  const moveBlock = (id: string, direction: -1 | 1) => {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const handleUploadAttachment = async (file: File) => {
    const uploaded = await uploadAttachment({ organisationId, agreementId: agreement.id, file });
    await refreshAttachments();
    return { id: uploaded.id, name: uploaded.name };
  };

  const activeCategoryDef = CATEGORIES.find((c) => c.key === activeCategory) || null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Tillbaka till Avtalsskapare V3
        </button>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700">Förhandsvisning · V3</span>
          <span className="text-xs text-slate-400">{agreement.document_number}</span>
        </div>
      </div>

      <h1 className="text-xl font-bold tracking-tight text-slate-900">{agreement.title || '(namnlöst dokument)'}</h1>

      {!editable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Dokumentet är skickat och kan inte längre redigeras direkt här.
        </p>
      )}
      {message && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setMode('edit')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'edit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Redigera
            </button>
            <button
              onClick={() => { setMode('preview'); setActiveCategory(null); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Förhandsgranska
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!editable || !dirty || saving}
              title="Spara"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Save className="h-4 w-4" />
            </button>
            <button
              onClick={handleReviewAndSend}
              disabled={!editable || saving}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {saving ? 'Sparar...' : 'Granska & spara'}
            </button>
          </div>
        </div>

        <div className="flex" style={{ minHeight: 560 }}>
          {mode === 'edit' && editable && (
            <div className="flex w-20 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-slate-50 py-4">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory((c) => (c === cat.key ? null : cat.key))}
                  className={`flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors ${
                    activeCategory === cat.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:bg-white/60'
                  }`}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${cat.color}`}>
                    <cat.icon className="h-4 w-4" />
                  </span>
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          {activeCategoryDef && (
            <div className="w-60 shrink-0 space-y-1.5 overflow-y-auto border-r border-slate-200 bg-white p-3">
              <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{activeCategoryDef.label}</p>
              {activeCategoryDef.types.map((type) => {
                const def = BLOCK_TYPES.find((b) => b.type === type) || blockTypeDef(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addBlock(type)}
                    className="block w-full rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-blue-200 hover:bg-blue-50"
                  >
                    <p className="text-sm font-medium text-slate-800">{def.label}</p>
                    <p className="text-xs text-slate-500">{def.description}</p>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
            <div className="mx-auto max-w-2xl rounded-xl bg-white p-8 shadow-sm">
              {mode === 'edit' ? (
                blocks.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-slate-300 px-6 py-16 text-center text-sm text-slate-500">
                    {editable ? 'Välj ett block i panelen till vänster för att börja bygga dokumentet.' : 'Dokumentet har inget innehåll.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {blocks.map((block, i) => (
                      editable ? (
                        <BlockRow
                          key={block.id}
                          block={block}
                          isFirst={i === 0}
                          isLast={i === blocks.length - 1}
                          onUpdate={(content) => updateBlock(block.id, content)}
                          onRemove={() => removeBlock(block.id)}
                          onDuplicate={() => duplicateBlock(block.id)}
                          onMoveUp={() => moveBlock(block.id, -1)}
                          onMoveDown={() => moveBlock(block.id, 1)}
                          attachments={detail.attachments.map((a) => ({ id: a.id, name: a.name }))}
                          onUploadAttachment={handleUploadAttachment}
                        />
                      ) : (
                        <BlockRenderer key={block.id} blocks={[block]} parties={detail.parties} signers={detail.signers} />
                      )
                    ))}
                  </div>
                )
              ) : (
                <BlockRenderer blocks={blocks} parties={detail.parties} signers={detail.signers} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
