// Client-side twin of resolveTokensInText/resolveBlocks in
// supabase/functions/_shared/agreement-snapshot.ts -- same regex, same
// "unknown token resolves to empty" rule -- so the editor's preview shows
// exactly the text the send action will freeze for the signer. The VALUES
// still come from the server (getPreviewContext), built by the very same
// code the send action uses; only the substitution is repeated here.
import type { DynamicFieldContext } from '../api';

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\}\}/g;

export function resolveTokensInText(text: string, context: DynamicFieldContext): string {
  return text.replace(TOKEN_RE, (_match, ns: string, field: string) => {
    const value = context[ns]?.[field];
    return value !== undefined && value !== null ? String(value) : '';
  });
}

function resolveValue(value: unknown, context: DynamicFieldContext): unknown {
  if (typeof value === 'string') return resolveTokensInText(value, context);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, context));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveValue(v, context);
    return out;
  }
  return value;
}

export function resolveBlocksForPreview<T extends { content: Record<string, unknown> }>(blocks: T[], context: DynamicFieldContext): T[] {
  return blocks.map((b) => ({ ...b, content: resolveValue(b.content, context) as Record<string, unknown> }));
}
