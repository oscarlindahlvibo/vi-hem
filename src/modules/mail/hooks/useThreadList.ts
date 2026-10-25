import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mailApi, MailApiError } from '../lib/api';
import type { MailAccount, ThreadSummary } from '../lib/types';

export type Folder = 'inbox' | 'starred' | 'snoozed' | 'sent' | 'drafts' | 'scheduled' | 'archive' | 'all' | 'spam' | 'trash' | 'important' | 'label' | 'search';
export interface ListParams { accounts: MailAccount[]; folder: Folder; labelId?: string; query: string }
export interface ListState { threads: ThreadSummary[]; loading: boolean; loadingMore: boolean; error: string; hasMore: boolean; errors: { account_id: string; error: string }[] }

const cache = new Map<string, { at: number; threads: ThreadSummary[]; tokens: Record<string, string | null>; histories: Record<string, string | null> }>();
const keyOf = (p: ListParams) => `${p.accounts.map((a) => a.id).sort().join(',')}|${p.folder}|${p.labelId ?? ''}|${p.query}`;
const sortThreads = (list: ThreadSummary[]) => [...list].sort((a, b) => b.lastDate - a.lastDate);
export const dedupe = (list: ThreadSummary[]) => { const seen = new Set<string>(); return list.filter((t) => { const k = `${t.account_id}:${t.id}`; if (seen.has(k)) return false; seen.add(k); return true; }); };
export const clearListCache = () => cache.clear();

/** Trådlista för en eller flera brevlådor (samlad inkorg), sidindelad, med stale-while-revalidate-cache och inkrementell uppdatering via Gmail History. */
export function useThreadList(params: ListParams, enabled = true) {
  const { accounts, folder, labelId, query } = params;
  const key = keyOf(params);
  const [state, setState] = useState<ListState>({ threads: [], loading: true, loadingMore: false, error: '', hasMore: false, errors: [] });
  const tokens = useRef<Record<string, string | null>>({});
  const histories = useRef<Record<string, string | null>>({});
  const seq = useRef(0);
  const paramsRef = useRef(params); paramsRef.current = params;

  const fetchPage = useCallback(async (reset: boolean, silent = false) => {
    const p = paramsRef.current; const mySeq = ++seq.current;
    if (!p.accounts.length) { setState({ threads: [], loading: false, loadingMore: false, error: '', hasMore: false, errors: [] }); return; }
    setState((s) => ({ ...s, loading: reset && !silent && !cache.has(keyOf(p)), loadingMore: !reset, error: reset ? '' : s.error }));
    const errors: { account_id: string; error: string }[] = []; let incoming: ThreadSummary[] = [];
    try {
      if (p.folder === 'search' && p.query.trim()) {
        const r = await mailApi<{ threads: ThreadSummary[]; errors: any[]; more: Record<string, string>; denied: string[] }>('search', { account_ids: p.accounts.map((a) => a.id), q: p.query, page_tokens: reset ? undefined : tokens.current });
        incoming = r.threads; tokens.current = reset ? { ...r.more } : { ...tokens.current, ...r.more };
        for (const id of Object.keys(tokens.current)) if (!(id in r.more)) tokens.current[id] = null;
        errors.push(...r.errors.map((e) => ({ account_id: e.account_id, error: e.error })));
      } else {
        const targets = reset ? p.accounts : p.accounts.filter((a) => tokens.current[a.id]);
        const results = await Promise.all(targets.map(async (a) => {
          try {
            const r = await mailApi<{ threads: ThreadSummary[]; next_page_token: string | null; history_id: string | null }>('threads_list', { account_id: a.id, folder: p.folder, label_id: p.labelId, q: p.query || undefined, page_token: reset ? undefined : tokens.current[a.id], max_results: p.accounts.length > 1 ? 25 : 40 });
            tokens.current[a.id] = r.next_page_token; if (reset) histories.current[a.id] = r.history_id;
            return r.threads.map((t) => ({ ...t, account_id: a.id, account_email: a.email }));
          } catch (e) { errors.push({ account_id: a.id, error: e instanceof MailApiError ? e.message : 'Fel' }); tokens.current[a.id] = null; return []; }
        }));
        incoming = results.flat();
      }
    } catch (e) { if (mySeq === seq.current) setState((s) => ({ ...s, loading: false, loadingMore: false, error: e instanceof MailApiError ? e.message : 'Kunde inte hämta mejl.' })); return; }
    if (mySeq !== seq.current) return;
    setState((s) => {
      const merged = sortThreads(dedupe(reset ? incoming : [...s.threads, ...incoming]));
      cache.set(keyOf(p), { at: Date.now(), threads: merged, tokens: { ...tokens.current }, histories: { ...histories.current } });
      return { threads: merged, loading: false, loadingMore: false, error: errors.length && !merged.length ? errors[0].error : '', hasMore: Object.values(tokens.current).some(Boolean), errors };
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const hit = cache.get(key);
    if (hit) { tokens.current = { ...hit.tokens }; histories.current = { ...hit.histories }; setState({ threads: hit.threads, loading: false, loadingMore: false, error: '', hasMore: Object.values(hit.tokens).some(Boolean), errors: [] }); if (Date.now() - hit.at > 20_000) void fetchPage(true, true); }
    else { tokens.current = {}; histories.current = {}; void fetchPage(true); }
  }, [key, enabled, fetchPage]);

  // Inkrementell uppdatering: pollar Gmail History var 30:e sekund medan fliken är synlig
  useEffect(() => {
    if (!enabled || folder === 'search') return;
    let stopped = false;
    const tick = async () => {
      if (stopped || document.visibilityState !== 'visible' || !navigator.onLine) return;
      const p = paramsRef.current; let changed = false;
      await Promise.all(p.accounts.map(async (a) => {
        const h = histories.current[a.id]; if (!h) return;
        try {
          const r = await mailApi<{ changedThreadIds: string[]; historyId: string; expired: boolean }>('changes', { account_id: a.id, history_id: h });
          if (r.expired || r.changedThreadIds.length) changed = true; histories.current[a.id] = r.expired ? null : r.historyId;
        } catch { /* nästa varv */ }
      }));
      if (changed && !stopped) void fetchPage(true, true);
    };
    const id = window.setInterval(tick, 30_000); const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [key, enabled, folder, fetchPage]);

  const patch = useCallback((ids: { account_id?: string; id: string }[], fn: (t: ThreadSummary) => ThreadSummary | null) => {
    const set = new Set(ids.map((i) => `${i.account_id}:${i.id}`));
    setState((s) => { const threads = s.threads.flatMap((t) => (set.has(`${t.account_id}:${t.id}`) ? (fn(t) ? [fn(t)!] : []) : [t])); cache.set(keyOf(paramsRef.current), { at: Date.now(), threads, tokens: { ...tokens.current }, histories: { ...histories.current } }); return { ...s, threads }; });
  }, []);
  const refresh = useCallback(() => fetchPage(true), [fetchPage]);
  const loadMore = useCallback(() => { if (!state.loadingMore && state.hasMore) void fetchPage(false); }, [fetchPage, state.loadingMore, state.hasMore]);
  const unread = useMemo(() => state.threads.filter((t) => t.unread).length, [state.threads]);
  return { ...state, refresh, loadMore, patch, unread };
}
