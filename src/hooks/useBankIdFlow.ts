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
//     which isn't a popup and can't be blocked; the order ref is stashed
//     first so that when BankID's app redirects the mobile browser back,
//     the hook resumes polling automatically instead of leaving the user
//     stuck with no feedback. This must be `localStorage`, not
//     `sessionStorage`: when the BankID app hands control back via a
//     universal/app link, iOS Safari and Android Chrome frequently land the
//     return URL in a *new* tab or webview instance rather than reusing the
//     exact one that navigated away, and `sessionStorage` doesn't follow
//     across that boundary even though it's the same origin -- the user
//     just sees a fresh login page with no memory of the pending order.
//     `localStorage` is shared across tabs/instances for the same origin,
//     so it survives the same-device round trip. (This is why cross-device
//     QR login always worked: it never navigates away, so this boundary
//     never comes up.)
//  3. The same-device launch used to fire via `window.location.href =
//     launchUrl` automatically, straight out of the async callback that
//     created the order -- i.e. *not* as the direct result of the user's
//     click, but one network round-trip later. A documented Chrome/Android
//     bug in another BankID integration (ActiveLogin.Authentication#251)
//     shows this exact pattern -- start the order via an async call, then
//     programmatically navigate -- makes Chrome on Android lose the
//     "direct user interaction" context, breaking the app hand-off. Now
//     the order is created ahead of time and `launchUrl` is exposed so the
//     caller can render a real `<a href={launchUrl}>` -- clicking an actual
//     anchor is the most gesture-preserving navigation there is, no JS
//     `location.href` involved in the critical hop at all. (This is web
//     only -- see point 4 for the native app.)
//  4. In the native iOS/Android app, a plain `<a href="https://app.bankid.com/...">`
//     tap relies on iOS treating it as a Universal Link -- which it only
//     does when the tap happens directly in our own WKWebView (same as a
//     regular website). An earlier version of this routed the same-device
//     launch through @capacitor/browser's in-app SFSafariViewController
//     overlay instead, to avoid the app's own webview navigating away with
//     no Associated Domains/App Links to get back -- but iOS never honors
//     a Universal Link on the *first* URL a browser surface is asked to
//     load, only on a tap of a link already on screen, so that overlay
//     just showed BankID's own web fallback page instead of ever launching
//     the app. Fixed by going back to a plain in-webview anchor tap, but
//     to the `bankid:///` custom URL scheme instead of the https Universal
//     Link -- BankID's own RP guidelines document this as the native-app
//     launch form specifically because it has none of the Universal Link
//     tap restrictions, and WKWebView hands off non-http(s) navigations to
//     iOS directly without ever loading a page, so the app's own JS (and
//     its collect() polling) never unloads -- same as tapping a mailto:
//     link. redirect=null (BankID's documented recommendation for a
//     native-app hand-off, "the calling application will be in focus") was
//     tried first, but doesn't actually bring VI-HEM back to the
//     foreground in this webview-launched setup -- the user stayed
//     stranded in the BankID app after completing. iOS/Android don't let
//     any app silently steal focus back; the only reliable way is for
//     BankID's app to itself call a URL scheme VI-HEM owns, which the OS
//     then routes straight to VI-HEM (same mechanism as VI-HEM opening
//     BankID, in reverse). So native redirects to `vihem://bankid-return`
//     instead -- see CFBundleURLTypes in ios/App/App/Info.plist and the
//     `vihem` intent-filter in android/app/src/main/AndroidManifest.xml.
//     Nothing needs to read that URL's contents: the poll below is already
//     running (or resumes the instant the OS un-suspends VI-HEM's JS), so
//     completion is picked up on its own -- the scheme only needs to exist
//     so the OS has somewhere of ours to hand control back to.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { bankIDLaunchUrl, BankIDError, collectBankIDOrder, type BankIDAuthOrder, type BankIDCollectResult } from '../lib/bankid';

const STORAGE_PREFIX = 'vihem_bankid_pending_';
// A URL scheme VI-HEM itself owns (see CFBundleURLTypes in
// ios/App/App/Info.plist and the `vihem` intent-filter in
// android/app/src/main/AndroidManifest.xml) -- passed as BankID's redirect
// for the native same-device flow so the OS brings VI-HEM back to the
// foreground once signing completes, see module header point 4.
const NATIVE_RETURN_URL = 'vihem://bankid-return';
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
  /** Set once a same-device order is ready. Render a real `<a
   * href={launchUrl}>` and let the browser's own anchor navigation open
   * it -- don't `window.location.href = launchUrl` this from JS, see the
   * module header (point 3) for why. */
  launchUrl: string | null;
  /** `sameDevice` defaults to auto-detecting a phone (isMobileDevice()) --
   * pass it explicitly to let a desktop user opt into the same-device
   * app-switch flow too (they may have the BankID security program
   * installed locally), or to force QR on a phone. */
  start: (starter: () => Promise<BankIDAuthOrder>, options?: { sameDevice?: boolean }) => Promise<void>;
  /** Call once the user actually clicks the `<a href={launchUrl}>` -- marks
   * the order pending and starts polling. The anchor's own default
   * behavior handles the navigation; this just starts collect() so the
   * page is already listening when BankID redirects back. */
  confirmLaunched: () => void;
  reset: () => void;
}

/** `intent` scopes the localStorage key and the resume-on-return check --
 * a pending sign order must never get picked up as if it were a login
 * order, or vice versa, if both happen to be mid-flight in the same
 * browser tab lineage. `signingToken` is only relevant for an Avtal V2
 * sign order (PublicAgreementSignPage.tsx) -- there is no VI-HEM session
 * for vihem-bankid to authorize collect() polls against instead, so the
 * same token from the signing link is re-sent on every poll. */
export function useBankIdFlow(intent: 'auth' | 'sign' | 'link', signingToken?: string): BankIdFlowState {
  const storageKey = `${STORAGE_PREFIX}${intent}`;
  const [status, setStatus] = useState<BankIdFlowStatus>('idle');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BankIDCollectResult | null>(null);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);

  const pollTimer = useRef<number | null>(null);
  const qrTimer = useRef<number | null>(null);
  const qrBaseUrl = useRef<string | null>(null);
  const cancelled = useRef(false);
  const pendingOrderRef = useRef<string | null>(null);

  const stopTimers = useCallback(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    if (qrTimer.current) window.clearInterval(qrTimer.current);
    pollTimer.current = null;
    qrTimer.current = null;
    qrBaseUrl.current = null;
  }, []);

  const clearPending = useCallback(() => {
    try { window.localStorage.removeItem(storageKey); } catch { /* private browsing etc. -- best effort only */ }
  }, [storageKey]);

  const finish = useCallback((finalStatus: 'complete' | 'failed', r?: BankIDCollectResult, errMsg?: string) => {
    stopTimers();
    setStatus(finalStatus);
    setQrImage(null);
    setLaunchUrl(null);
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
        const r = await collectBankIDOrder({ environment: 'test', edgeFunctionUrl: '' }, orderRef, signingToken);
        if (cancelled.current) return;
        if (r.status === 'failed') { finish('failed', r, r.error || 'BankID avbröts eller misslyckades.'); return; }
        if (r.status === 'complete') {
          // A completed BankID order can still fail to resolve to a VI-HEM
          // login (login_ready: false, e.g. no profile matches the
          // personnummer) or fail to link (linked: false, e.g. that
          // personnummer already belongs to a different account) -- both
          // are failures for this flow even though BankID itself
          // succeeded, so the caller's error banner (not the success path)
          // is what should show r.error.
          if (r.login_ready === false || r.linked === false) { finish('failed', r, r.error || 'BankID godkändes, men kunde inte kopplas till ett VI-HEM-konto.'); return; }
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
  }, [finish, signingToken]);

  const beginFromOrder = useCallback((order: BankIDAuthOrder, sameDevice: boolean) => {
    setStatus('pending');
    setError('');
    if (sameDevice) {
      // See module header, point 4 for why native uses the bankid:///
      // custom scheme, redirecting to VI-HEM's own URL scheme, instead of
      // the https Universal Link the web flow below uses.
      const native = Capacitor.isNativePlatform();
      const url = native ? bankIDLaunchUrl(order, NATIVE_RETURN_URL, true) : bankIDLaunchUrl(order);
      if (url) {
        if (!native) {
          // Stash the pending order now, before the user has even clicked
          // the link -- if they do click and get redirected away, the
          // resume effect below needs this already in place to pick
          // polling back up. Native never navigates away (the custom
          // scheme hand-off leaves our webview in place), so there's
          // nothing to resume there.
          try { window.localStorage.setItem(storageKey, JSON.stringify({ orderRef: order.orderRef, startedAt: Date.now() })); } catch { /* best effort */ }
        }
        pendingOrderRef.current = order.orderRef;
        setStatus('redirecting');
        setMessage('Tryck på knappen för att öppna BankID-appen.');
        setLaunchUrl(url);
        return; // waiting for confirmLaunched() -- see the anchor click below
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
  }, [poll, storageKey, finish]);

  const start = useCallback(async (starter: () => Promise<BankIDAuthOrder>, options?: { sameDevice?: boolean }) => {
    cancelled.current = false;
    stopTimers();
    setStatus('starting');
    setError('');
    setResult(null);
    setQrImage(null);
    setLaunchUrl(null);
    try {
      const order = await starter();
      beginFromOrder(order, options?.sameDevice ?? isMobileDevice());
    } catch (err) {
      finish('failed', undefined, err instanceof BankIDError ? err.message : (err instanceof Error ? err.message : 'BankID-anropet misslyckades.'));
    }
  }, [beginFromOrder, finish, stopTimers]);

  // Called from the anchor's onClick, right as the browser is about to
  // follow href -- the click itself does the navigation, this just starts
  // polling so the page is already listening for BankID's redirect back.
  const confirmLaunched = useCallback(() => {
    if (!pendingOrderRef.current) return;
    setStatus('pending');
    setMessage('Öppnar BankID-appen...');
    setLaunchUrl(null);
    poll(pendingOrderRef.current, 0);
  }, [poll]);

  const reset = useCallback(() => {
    cancelled.current = true;
    stopTimers();
    clearPending();
    pendingOrderRef.current = null;
    setStatus('idle');
    setQrImage(null);
    setLaunchUrl(null);
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
    try { raw = window.localStorage.getItem(storageKey); } catch { raw = null; }
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

  return { status, qrImage, message, error, result, launchUrl, start, confirmLaunched, reset };
}
