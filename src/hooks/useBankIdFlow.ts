// Shared BankID order lifecycle (start -> QR/app-redirect -> poll ->
// complete/failed), used by both the login page and the tenant contract
// signing flow so they stop diverging and re-accumulating the same bugs.
//
// Two real bugs this fixes relative to the previous per-page
// implementations:
//  1. The QR code image was fetched once and never refreshed. BankSignering
//     (the BankID reseller VI-HEM integrates through -- see
//     supabase/functions/vihem-bankid/index.ts) documents that a QR image
//     URL is only valid for 10 seconds and must be re-fetched with a fresh
//     cache-busting query param every 5 seconds, or it goes stale before
//     most people have time to scan it.
//  2. `window.open(...)` was called right after an `await` (the order-start
//     network call) -- Safari/WebKit silently treats that as a popup, not a
//     user-gesture-triggered navigation, and blocks it. On mobile this
//     hook instead does a full-page redirect (`window.location.href`),
//     which isn't a popup and can't be blocked; the order ref is stashed in
//     sessionStorage first so that when BankID's app redirects the mobile
//     browser back to this same page, the hook resumes polling
//     automatically instead of leaving the user stuck with no feedback.
import { useCallback, useEffect, useRef, useState } from 'react';
import { bankIDLaunchUrl, BankIDError, collectBankIDOrder, type BankIDAuthOrder, type BankIDCollectResult } from '../lib/bankid';

const STORAGE_PREFIX = 'vihem_bankid_pending_';
const QR_REFRESH_MS = 5000;
const POLL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // ~3 minutes, matching the BankID order's own server-side expiry window
const RESUME_WINDOW_MS = 3 * 60 * 1000;

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export type BankIdFlowStatus = 'idle' | 'starting' | 'redirecting' | 'pending' | 'complete' | 'failed';

export interface BankIdFlowState {
  status: BankIdFlowStatus;
  qrImage: string | null;
  message: string;
  error: string;
  result: BankIDCollectResult | null;
  start: (starter: () => Promise<BankIDAuthOrder>) => Promise<void>;
  reset: () => void;
}

/** `intent` scopes the sessionStorage key and the resume-on-return check --
 * a pending sign order must never get picked up as if it were a login
 * order, or vice versa, if both happen to be mid-flight in the same
 * browser tab lineage. */
export function useBankIdFlow(intent: 'auth' | 'sign'): BankIdFlowState {
  const storageKey = `${STORAGE_PREFIX}${intent}`;
  const [status, setStatus] = useState<BankIdFlowStatus>('idle');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BankIDCollectResult | null>(null);

  const pollTimer = useRef<number | null>(null);
  const qrTimer = useRef<number | null>(null);
  const qrBaseUrl = useRef<string | null>(null);
  const cancelled = useRef(false);

  const stopTimers = useCallback(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    if (qrTimer.current) window.clearInterval(qrTimer.current);
    pollTimer.current = null;
    qrTimer.current = null;
    qrBaseUrl.current = null;
  }, []);

  const clearPending = useCallback(() => {
    try { window.sessionStorage.removeItem(storageKey); } catch { /* private browsing etc. -- best effort only */ }
  }, [storageKey]);

  const finish = useCallback((finalStatus: 'complete' | 'failed', r?: BankIDCollectResult, errMsg?: string) => {
    stopTimers();
    setStatus(finalStatus);
    setQrImage(null);
    if (r) setResult(r);
    if (errMsg) setError(errMsg);
    clearPending();
  }, [stopTimers, clearPending]);

  const poll = useCallback((orderRef: string, attempt: number) => {
    if (cancelled.current) return;
    pollTimer.current = window.setTimeout(async () => {
      if (cancelled.current) return;
      if (attempt >= MAX_POLL_ATTEMPTS) { finish('failed', undefined, 'BankID-sessionen tog för lång tid. Försök igen.'); return; }
      try {
        const r = await collectBankIDOrder({ environment: 'test', edgeFunctionUrl: '' }, orderRef);
        if (cancelled.current) return;
        if (r.status === 'failed') { finish('failed', r, r.error || 'BankID avbröts eller misslyckades.'); return; }
        if (r.status === 'complete') {
          // A completed BankID order can still fail to resolve to a VI-HEM
          // login (login_ready: false, e.g. no profile matches the
          // personnummer) -- that's a failure for this flow even though
          // BankID itself succeeded, so the caller's error banner (not the
          // success path) is what should show r.error.
          if (r.login_ready === false) { finish('failed', r, r.error || 'BankID godkändes, men kunde inte kopplas till ett VI-HEM-konto.'); return; }
          finish('complete', r);
          return;
        }
        setMessage('Väntar på godkännande i BankID-appen...');
        poll(orderRef, attempt + 1);
      } catch (err) {
        if (cancelled.current) return;
        finish('failed', undefined, err instanceof BankIDError ? err.message : (err instanceof Error ? err.message : 'BankID-anropet misslyckades.'));
      }
    }, POLL_MS);
  }, [finish]);

  const beginFromOrder = useCallback((order: BankIDAuthOrder) => {
    setStatus('pending');
    setError('');
    if (isMobileDevice()) {
      const launchUrl = bankIDLaunchUrl(order);
      if (launchUrl) {
        try { window.sessionStorage.setItem(storageKey, JSON.stringify({ orderRef: order.orderRef, startedAt: Date.now() })); } catch { /* best effort */ }
        setStatus('redirecting');
        setMessage('Öppnar BankID-appen...');
        window.location.href = launchUrl;
        return; // page is navigating away -- nothing left to do here
      }
    }
    if (order.qrImage) {
      qrBaseUrl.current = order.qrImage;
      setQrImage(`${order.qrImage}?t=${Date.now()}`);
      qrTimer.current = window.setInterval(() => {
        if (qrBaseUrl.current) setQrImage(`${qrBaseUrl.current}?t=${Date.now()}`);
      }, QR_REFRESH_MS);
      setMessage('Scanna QR-koden med BankID-appen.');
    } else {
      setMessage('Väntar på BankID...');
    }
    poll(order.orderRef, 0);
  }, [poll, storageKey]);

  const start = useCallback(async (starter: () => Promise<BankIDAuthOrder>) => {
    cancelled.current = false;
    stopTimers();
    setStatus('starting');
    setError('');
    setResult(null);
    setQrImage(null);
    try {
      const order = await starter();
      beginFromOrder(order);
    } catch (err) {
      finish('failed', undefined, err instanceof BankIDError ? err.message : (err instanceof Error ? err.message : 'BankID-anropet misslyckades.'));
    }
  }, [beginFromOrder, finish, stopTimers]);

  const reset = useCallback(() => {
    cancelled.current = true;
    stopTimers();
    clearPending();
    setStatus('idle');
    setQrImage(null);
    setMessage('');
    setError('');
    setResult(null);
  }, [stopTimers, clearPending]);

  // Resume a mobile order automatically when BankID's app redirects the
  // browser back to this page -- the full-page navigation above discards
  // all in-memory state, so without this the user would land back on a
  // page that has no idea an order was ever started.
  useEffect(() => {
    let raw: string | null = null;
    try { raw = window.sessionStorage.getItem(storageKey); } catch { raw = null; }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { orderRef: string; startedAt: number };
      if (!saved.orderRef || Date.now() - saved.startedAt > RESUME_WINDOW_MS) { clearPending(); return; }
      cancelled.current = false;
      setStatus('pending');
      setMessage('Slutför BankID-godkännandet...');
      poll(saved.orderRef, 0);
    } catch {
      clearPending();
    }
    // Intentionally runs once on mount only -- this is a one-time
    // "did we come back from the BankID app" check, not something that
    // should re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { cancelled.current = true; stopTimers(); }, [stopTimers]);

  return { status, qrImage, message, error, result, start, reset };
}
