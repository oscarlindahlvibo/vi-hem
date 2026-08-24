// The block-list editor. Blocks can be added, removed, duplicated, and
// reordered (up/down buttons -- not drag-and-drop, a deliberate
// simplification: the brief explicitly allows skipping DnD if it can't be
// implemented stably, and up/down arrows are unambiguous on mobile too,
// which full HTML5 drag-and-drop is not).
import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { Modal } from '../../../components/ui';
import type { AgreementBlock, BlockType } from '../types';
import { BLOCK_TYPES, blockTypeDef, createBlock, type BlockFieldDef } from '../blocks/blockTypes';
import { calcPriceTable, DEFAULT_DEDUCTION_RATE, DEFAULT_VAT_RATE, formatSek, VAT_RATES, type DeductionType, type PriceTableItem } from '../blocks/priceTable';

export interface AttachmentOption {
  id: string;
  name: string;
}

export function BlockEditor({
  blocks,
  onChange,
  attachments,
  onUploadAttachment,
}: {
  blocks: AgreementBlock[];
  onChange: (blocks: AgreementBlock[]) => void;
  /** Only meaningful when editing a concrete agreement's blocks (not a
   * template's) -- lets the "Bilaga/PDF" block pick or upload a real file
   * inline instead of just typing a label. Omitted entirely in the
   * template editor, where there's no document to attach a file to yet. */
  attachments?: AttachmentOption[];
  onUploadAttachment?: (file: File) => Promise<AttachmentOption>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const addBlock = (type: BlockType) => {
    onChange([...blocks, createBlock(type)]);
    setPickerOpen(false);
  };
  const updateBlock = (id: string, content: Record<string, any>) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, content } : b)));
  };
  const removeBlock = (id: string) => onChange(blocks.filter((b) => b.id !== id));
  const duplicateBlock = (id: string) => {
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1) return;
    const copy = { ...blocks[index], id: crypto.randomUUID() };
    onChange([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]);
  };
  const moveBlock = (id: string, direction: -1 | 1) => {
    const index = blocks.findIndex((b) => b.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {blocks.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          Inga block ännu. Lägg till det första blocket för att börja bygga dokumentet.
        </div>
      )}
      {blocks.map((block, i) => (
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
          attachments={attachments}
          onUploadAttachment={onUploadAttachment}
        />
      ))}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-blue-400 hover:text-blue-600"
      >
        <Plus className="h-4 w-4" /> Lägg till block
      </button>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Lägg till block">
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {BLOCK_TYPES.map((def) => (
            <button
              key={def.type}
              type="button"
              onClick={() => addBlock(def.type)}
              className="rounded-lg border border-slate-100 px-3 py-2.5 text-left text-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
            >
              <p className="font-medium text-slate-800">{def.label}</p>
              <p className="text-xs text-slate-500">{def.description}</p>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

export function BlockRow({
  block,
  isFirst,
  isLast,
  onUpdate,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  attachments,
  onUploadAttachment,
}: {
  block: AgreementBlock;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (content: Record<string, any>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  attachments?: AttachmentOption[];
  onUploadAttachment?: (file: File) => Promise<AttachmentOption>;
}) {
  const def = blockTypeDef(block.block_type);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{def.label}</span>
        <div className="flex items-center gap-1">
          <IconButton onClick={onMoveUp} disabled={isFirst} title="Flytta upp"><ArrowUp className="h-3.5 w-3.5" /></IconButton>
          <IconButton onClick={onMoveDown} disabled={isLast} title="Flytta ned"><ArrowDown className="h-3.5 w-3.5" /></IconButton>
          <IconButton onClick={onDuplicate} title="Duplicera"><Copy className="h-3.5 w-3.5" /></IconButton>
          <IconButton onClick={onRemove} title="Ta bort" danger><Trash2 className="h-3.5 w-3.5" /></IconButton>
        </div>
      </div>
      {block.block_type === 'attachment_ref' ? (
        <AttachmentRefFields content={block.content} onChange={onUpdate} attachments={attachments} onUploadAttachment={onUploadAttachment} />
      ) : block.block_type === 'price_table' ? (
        <PriceTableFields content={block.content} onChange={onUpdate} />
      ) : block.block_type === 'package_option' ? (
        <PackageOptionFields content={block.content} onChange={onUpdate} />
      ) : (
        <BlockFields def={def.fields} content={block.content} onChange={onUpdate} />
      )}
      {def.structural && def.fields.length === 0 && <p className="text-xs italic text-slate-400">Inget att redigera för det här blocket.</p>}
    </div>
  );
}

/** Special-cased (not a generic BlockFields entry) because it needs the
 * agreement's real attachment list + an upload callback, which no other
 * block type needs. Falls back to a plain label field when neither prop is
 * supplied (e.g. inside the template editor, which has no concrete
 * document to attach a file to). */
function AttachmentRefFields({
  content,
  onChange,
  attachments,
  onUploadAttachment,
}: {
  content: Record<string, any>;
  onChange: (content: Record<string, any>) => void;
  attachments?: AttachmentOption[];
  onUploadAttachment?: (file: File) => Promise<AttachmentOption>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  if (!onUploadAttachment) {
    return <BlockFields def={[{ key: 'label', label: 'Etikett', kind: 'text' }]} content={content} onChange={onChange} />;
  }

  const selected = (attachments || []).find((a) => a.id === content.attachment_id);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const uploaded = await onUploadAttachment(file);
      onChange({ ...content, attachment_id: uploaded.id, label: uploaded.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uppladdningen misslyckades.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {(attachments && attachments.length > 0) && (
        <select
          value={content.attachment_id || ''}
          onChange={(e) => {
            const chosen = attachments.find((a) => a.id === e.target.value);
            onChange({ ...content, attachment_id: e.target.value, label: chosen?.name || content.label });
          }}
          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="">Välj en redan uppladdad bilaga...</option>
          {attachments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {selected && (
        <p className="flex items-center gap-1.5 text-xs text-green-700"><Paperclip className="h-3 w-3" /> {selected.name}</p>
      )}
      <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-600">
        <Upload className="h-3.5 w-3.5" />
        {uploading ? 'Laddar upp...' : 'Bifoga PDF från telefonen eller datorn'}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          disabled={uploading}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
        />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <input
        type="text"
        value={content.label || ''}
        onChange={(e) => onChange({ ...content, label: e.target.value })}
        placeholder="Etikett i dokumentet"
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  );
}

/** Special-cased for the same reason AttachmentRefFields is: a
 * variable-length line-item array with a live-computed total isn't
 * something the generic BlockFieldDef kinds ('rows', 'table_grid', ...)
 * express. */
const DEDUCTION_BADGE_LABEL: Record<DeductionType, string> = { none: '', rut: 'RUT', rot: 'ROT' };

/** Each item opens its own edit modal (Namn/Antal/Á-pris/Avdrag) rather than
 * cramming every field into the row -- a per-row RUT/ROT choice needs more
 * room than a tiny inline checkbox gave it, and matches how staff already
 * expect this from other quote tools. The row itself stays a compact
 * summary (description, qty × price, a RUT/ROT badge when set) so a
 * multi-line quote is still scannable at a glance. */
function PriceTableFields({ content, onChange }: { content: Record<string, any>; onChange: (content: Record<string, any>) => void }) {
  return (
    <div className="space-y-3">
      <select
        value={content.price_form || 'fixed'}
        onChange={(e) => onChange({ ...content, price_form: e.target.value })}
        className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      >
        <option value="fixed">Fast pris</option>
        <option value="recurring">Löpande räkning</option>
      </select>
      <PriceItemsEditor content={content} onChange={onChange} />
    </div>
  );
}

/** A tillägg (`package_option`) is a price_table wearing a title and
 * description -- same line items, same moms/avdrag/totals, just with a
 * "vad heter det här tillvalet" header and a default-checked toggle for
 * how it should look the first time a signer sees it. */
function PackageOptionFields({ content, onChange }: { content: Record<string, any>; onChange: (content: Record<string, any>) => void }) {
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={content.title || ''}
        onChange={(e) => onChange({ ...content, title: e.target.value })}
        placeholder="Titel, t.ex. Tvättmaskin & torktumlare"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      <textarea
        value={content.description || ''}
        onChange={(e) => onChange({ ...content, description: e.target.value })}
        placeholder="Beskrivning (valfritt)"
        rows={2}
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={Boolean(content.selected_by_default)} onChange={(e) => onChange({ ...content, selected_by_default: e.target.checked })} />
        Förvalt (ikryssat när mottagaren först öppnar dokumentet)
      </label>
      <PriceItemsEditor content={content} onChange={onChange} />
    </div>
  );
}

/** The line-item list + moms/avdrag section + totals, shared verbatim
 * between the plain price_table block and package_option's tillägg --
 * both content shapes are identical price-table data, just with an extra
 * title/description wrapper in the latter's case. */
function PriceItemsEditor({ content, onChange }: { content: Record<string, any>; onChange: (content: Record<string, any>) => void }) {
  const items: PriceTableItem[] = Array.isArray(content.items) && content.items.length > 0 ? content.items : [{ description: '', quantity: '1', unit_price: '', vat_rate: DEFAULT_VAT_RATE, deduction_type: 'none' }];
  const totals = calcPriceTable({ ...content, items });
  const hasRut = items.some((it) => it.deduction_type === 'rut');
  const hasRot = items.some((it) => it.deduction_type === 'rot');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const updateItem = (i: number, patch: Partial<PriceTableItem>) => {
    onChange({ ...content, items: items.map((it, ii) => (ii === i ? { ...it, ...patch } : it)) });
  };
  const addItem = () => {
    // New rows default to the previous row's VAT rate (falling back to the
    // standard 25%) rather than always 25% -- a quote that's already
    // mostly 12%/6% shouldn't make you re-pick the rate on every new row.
    const previousVatRate = items[items.length - 1]?.vat_rate ?? DEFAULT_VAT_RATE;
    const nextItems = [...items, { description: '', quantity: '1', unit_price: '', vat_rate: previousVatRate, deduction_type: 'none' as DeductionType }];
    onChange({ ...content, items: nextItems });
    setEditingIndex(nextItems.length - 1);
  };
  const removeItem = (i: number) => onChange({ ...content, items: items.filter((_, ii) => ii !== i) });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditingIndex(i)}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">{item.description || 'Namnlös rad'}</span>
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  {item.quantity || '0'} × {item.unit_price || '0'} kr
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">moms {item.vat_rate ?? DEFAULT_VAT_RATE}%</span>
                  {item.deduction_type && item.deduction_type !== 'none' && (
                    <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">{DEDUCTION_BADGE_LABEL[item.deduction_type]}</span>
                  )}
                </span>
              </span>
            </button>
            <IconButton onClick={() => removeItem(i)} title="Ta bort rad" danger disabled={items.length <= 1}><Trash2 className="h-3.5 w-3.5" /></IconButton>
          </div>
        ))}
      </div>
      <button type="button" onClick={addItem} className="flex items-center gap-1.5 text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"><Plus className="h-3.5 w-3.5" /> Vara/tjänst</button>

      {(hasRut || hasRot) && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">Avdrag</p>
          <p className="text-xs text-slate-500">Kontrollera aktuell avdragsprocent hos Skatteverket innan dokumentet skickas.</p>
          {hasRut && (
            <div className="flex items-center gap-2">
              <label className="w-28 text-xs text-slate-500">Rutavdrag (%)</label>
              <input
                type="number"
                value={content.rut_rate ?? DEFAULT_DEDUCTION_RATE.rut}
                onChange={(e) => onChange({ ...content, rut_rate: Number(e.target.value) })}
                className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}
          {hasRot && (
            <div className="flex items-center gap-2">
              <label className="w-28 text-xs text-slate-500">Rotavdrag (%)</label>
              <input
                type="number"
                value={content.rot_rate ?? DEFAULT_DEDUCTION_RATE.rot}
                onChange={(e) => onChange({ ...content, rot_rate: Number(e.target.value) })}
                className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}
          <input
            type="text"
            placeholder="Köparens personnummer (ÅÅÅÅMMDD-XXXX)"
            value={content.deduction_personal_number || ''}
            onChange={(e) => onChange({ ...content, deduction_personal_number: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      )}

      <div className="space-y-0.5 border-t border-slate-100 pt-2 text-sm">
        <div className="flex justify-between text-slate-500"><span>Netto</span><span>{formatSek(totals.netto)}</span></div>
        <div className="flex justify-between text-slate-500"><span>Moms</span><span>{formatSek(totals.moms)}</span></div>
        <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{formatSek(totals.total)}</span></div>
        {hasRut && <div className="flex justify-between text-green-700"><span>Rutavdrag</span><span>-{formatSek(totals.rutAmount)}</span></div>}
        {hasRot && <div className="flex justify-between text-green-700"><span>Rotavdrag</span><span>-{formatSek(totals.rotAmount)}</span></div>}
        {(hasRut || hasRot) && (
          <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900"><span>Att betala</span><span>{formatSek(totals.amountToPay)}</span></div>
        )}
      </div>

      {editingIndex !== null && items[editingIndex] && (
        <PriceItemModal
          item={items[editingIndex]}
          onClose={() => setEditingIndex(null)}
          onChange={(patch) => updateItem(editingIndex, patch)}
        />
      )}
    </div>
  );
}

function PriceItemModal({
  item,
  onClose,
  onChange,
}: {
  item: PriceTableItem;
  onClose: () => void;
  onChange: (patch: Partial<PriceTableItem>) => void;
}) {
  return (
    <Modal open onClose={onClose} title="Redigera rad" size="sm">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Namn</label>
          <input
            autoFocus
            value={item.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Vara/tjänst"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Antal</label>
            <input
              value={item.quantity}
              onChange={(e) => onChange({ quantity: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Á-pris (kr)</label>
            <input
              value={item.unit_price}
              onChange={(e) => onChange({ unit_price: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Moms</label>
          <div className="flex gap-1.5">
            {VAT_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => onChange({ vat_rate: rate })}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  (item.vat_rate ?? DEFAULT_VAT_RATE) === rate
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {rate}%
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Avdrag</label>
          <div className="flex gap-1.5">
            {([['none', 'Inget'], ['rut', 'Rutavdrag'], ['rot', 'Rotavdrag']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ deduction_type: value })}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  (item.deduction_type || 'none') === value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Avdrag ges aldrig på material, bara på arbetskostnaden för raden.</p>
        </div>
        <button onClick={onClose} className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700">Klar</button>
      </div>
    </Modal>
  );
}

function IconButton({ onClick, disabled, title, danger, children }: { onClick: () => void; disabled?: boolean; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md p-1.5 transition-colors disabled:opacity-30 ${danger ? 'text-red-500 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

function BlockFields({ def, content, onChange }: { def: BlockFieldDef[]; content: Record<string, any>; onChange: (content: Record<string, any>) => void }) {
  const set = (key: string, value: any) => onChange({ ...content, [key]: value });

  return (
    <div className="space-y-2">
      {def.map((field) => {
        switch (field.kind) {
          case 'text':
            return (
              <input
                key={field.key}
                type="text"
                value={content[field.key] || ''}
                onChange={(e) => set(field.key, e.target.value)}
                placeholder={field.placeholder || field.label}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            );
          case 'textarea':
            return (
              <textarea
                key={field.key}
                value={content[field.key] || ''}
                onChange={(e) => set(field.key, e.target.value)}
                placeholder={field.placeholder || field.label}
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            );
          case 'select':
            return (
              <select
                key={field.key}
                value={content[field.key] || ''}
                onChange={(e) => set(field.key, e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {(field.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
          case 'rows': {
            const items: string[] = content[field.key] || [''];
            return (
              <div key={field.key} className="space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      type="text"
                      value={item}
                      onChange={(e) => set(field.key, items.map((it, ii) => (ii === i ? e.target.value : it)))}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <button type="button" onClick={() => set(field.key, items.filter((_, ii) => ii !== i))} className="rounded-md px-2 text-slate-400 hover:bg-slate-100">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => set(field.key, [...items, ''])} className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700">+ Lägg till rad</button>
              </div>
            );
          }
          case 'checklist_items': {
            const items: { text: string; checked?: boolean }[] = content[field.key] || [{ text: '', checked: false }];
            return (
              <div key={field.key} className="space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={Boolean(item.checked)} onChange={(e) => set(field.key, items.map((it, ii) => (ii === i ? { ...it, checked: e.target.checked } : it)))} />
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => set(field.key, items.map((it, ii) => (ii === i ? { ...it, text: e.target.value } : it)))}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <button type="button" onClick={() => set(field.key, items.filter((_, ii) => ii !== i))} className="rounded-md px-2 text-slate-400 hover:bg-slate-100">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => set(field.key, [...items, { text: '', checked: false }])} className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700">+ Lägg till punkt</button>
              </div>
            );
          }
          case 'table_grid': {
            const headers: string[] = content.headers || ['Kolumn 1', 'Kolumn 2'];
            const rows: string[][] = content.rows || [['', '']];
            const setHeaders = (h: string[]) => onChange({ ...content, headers: h });
            const setRows = (r: string[][]) => onChange({ ...content, rows: r });
            return (
              <div key={field.key} className="space-y-1.5 overflow-x-auto">
                <div className="flex gap-1.5">
                  {headers.map((h, ci) => (
                    <input key={ci} value={h} onChange={(e) => setHeaders(headers.map((hh, ii) => (ii === ci ? e.target.value : hh)))} className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  ))}
                  <button type="button" onClick={() => { setHeaders([...headers, `Kolumn ${headers.length + 1}`]); setRows(rows.map((r) => [...r, ''])); }} className="rounded-md px-2 text-xs text-blue-600 transition-colors hover:text-blue-700">+ kolumn</button>
                </div>
                {rows.map((row, ri) => (
                  <div key={ri} className="flex gap-1.5">
                    {row.map((cell, ci) => (
                      <input key={ci} value={cell} onChange={(e) => setRows(rows.map((r, rri) => (rri === ri ? r.map((c, cci) => (cci === ci ? e.target.value : c)) : r)))} className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    ))}
                    <button type="button" onClick={() => setRows(rows.filter((_, rri) => rri !== ri))} className="rounded-md px-2 text-xs text-slate-400 transition-colors hover:text-red-600">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setRows([...rows, headers.map(() => '')])} className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700">+ Lägg till rad</button>
              </div>
            );
          }
          case 'image_url':
            return <ImagePicker key={field.key} value={content[field.key] || ''} onChange={(v) => set(field.key, v)} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

function ImagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      {value && <img src={value} alt="" className="max-h-32 rounded-lg border border-slate-200 object-contain" />}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result || ''));
          reader.readAsDataURL(file);
        }}
        className="w-full text-sm"
      />
    </div>
  );
}
