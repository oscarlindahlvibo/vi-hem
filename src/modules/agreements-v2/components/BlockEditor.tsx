// The block-list editor. Blocks can be added, removed, duplicated, and
// reordered (up/down buttons -- not drag-and-drop, a deliberate
// simplification: the brief explicitly allows skipping DnD if it can't be
// implemented stably, and up/down arrows are unambiguous on mobile too,
// which full HTML5 drag-and-drop is not).
import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import type { AgreementBlock, BlockType } from '../types';
import { BLOCK_TYPES, blockTypeDef, createBlock, type BlockFieldDef } from '../blocks/blockTypes';

export function BlockEditor({ blocks, onChange }: { blocks: AgreementBlock[]; onChange: (blocks: AgreementBlock[]) => void }) {
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
        />
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600"
        >
          <Plus className="h-4 w-4" /> Lägg till block
        </button>
        {pickerOpen && (
          <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg max-h-80 overflow-y-auto">
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {BLOCK_TYPES.map((def) => (
                <button
                  key={def.type}
                  type="button"
                  onClick={() => addBlock(def.type)}
                  className="rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <p className="font-medium text-slate-800">{def.label}</p>
                  <p className="text-xs text-slate-500">{def.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BlockRow({
  block,
  isFirst,
  isLast,
  onUpdate,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: {
  block: AgreementBlock;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (content: Record<string, any>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const def = blockTypeDef(block.block_type);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{def.label}</span>
        <div className="flex items-center gap-1">
          <IconButton onClick={onMoveUp} disabled={isFirst} title="Flytta upp"><ArrowUp className="h-3.5 w-3.5" /></IconButton>
          <IconButton onClick={onMoveDown} disabled={isLast} title="Flytta ned"><ArrowDown className="h-3.5 w-3.5" /></IconButton>
          <IconButton onClick={onDuplicate} title="Duplicera"><Copy className="h-3.5 w-3.5" /></IconButton>
          <IconButton onClick={onRemove} title="Ta bort" danger><Trash2 className="h-3.5 w-3.5" /></IconButton>
        </div>
      </div>
      <BlockFields def={def.fields} content={block.content} onChange={onUpdate} />
      {def.structural && def.fields.length === 0 && <p className="text-xs italic text-slate-400">Inget att redigera för det här blocket.</p>}
    </div>
  );
}

function IconButton({ onClick, disabled, title, danger, children }: { onClick: () => void; disabled?: boolean; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md p-1.5 disabled:opacity-30 ${danger ? 'text-red-500 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-100'}`}
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
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
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
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
            );
          case 'select':
            return (
              <select
                key={field.key}
                value={content[field.key] || ''}
                onChange={(e) => set(field.key, e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
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
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                    <button type="button" onClick={() => set(field.key, items.filter((_, ii) => ii !== i))} className="rounded-md px-2 text-slate-400 hover:bg-slate-100">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => set(field.key, [...items, ''])} className="text-xs font-medium text-blue-600">+ Lägg till rad</button>
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
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                    />
                    <button type="button" onClick={() => set(field.key, items.filter((_, ii) => ii !== i))} className="rounded-md px-2 text-slate-400 hover:bg-slate-100">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => set(field.key, [...items, { text: '', checked: false }])} className="text-xs font-medium text-blue-600">+ Lägg till punkt</button>
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
                    <input key={ci} value={h} onChange={(e) => setHeaders(headers.map((hh, ii) => (ii === ci ? e.target.value : hh)))} className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium" />
                  ))}
                  <button type="button" onClick={() => { setHeaders([...headers, `Kolumn ${headers.length + 1}`]); setRows(rows.map((r) => [...r, ''])); }} className="rounded-md px-2 text-xs text-blue-600">+ kolumn</button>
                </div>
                {rows.map((row, ri) => (
                  <div key={ri} className="flex gap-1.5">
                    {row.map((cell, ci) => (
                      <input key={ci} value={cell} onChange={(e) => setRows(rows.map((r, rri) => (rri === ri ? r.map((c, cci) => (cci === ci ? e.target.value : c)) : r)))} className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                    ))}
                    <button type="button" onClick={() => setRows(rows.filter((_, rri) => rri !== ri))} className="rounded-md px-2 text-xs text-slate-400">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setRows([...rows, headers.map(() => '')])} className="text-xs font-medium text-blue-600">+ Lägg till rad</button>
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
