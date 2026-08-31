// TEMPORARY boot-sequence tracer for the frozen-splash-screen bug: console
// capture over Safari's remote inspector for a capacitor:// page has been
// unreliable to confirm, so this writes each step directly onto the static
// placeholder in index.html (#boot-status) -- whatever step number is last
// visible on a still-frozen screen tells us exactly where execution stops.
// Remove once diagnosed.
function bootStep(n: number, label: string) {
  try {
    console.log(`[BOOT ${n}] ${label}`);
    const el = document.getElementById('boot-status');
    if (el) el.textContent = `boot: ${n}/6 (${label})`;
  } catch {
    // swallow -- this tracer must never itself be why boot fails
  }
}
bootStep(1, 'script started');

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.tsx';
import './index.css';

bootStep(2, 'imports resolved');

// WKWebView's own top-level scroll view rubber-bands past the edges of the
// document and, while it does, visually drags position:fixed elements
// (header, bottom nav) along with it -- a WKWebView-specific rendering
// quirk that doesn't happen in a normal browser tab. Scoped to the native
// app only (see .vihem-native-shell in index.css): pins html/body so
// WKWebView's own scroll view never has anything to bounce, and makes
// #root itself the scrollable container instead.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('vihem-native-shell');
}

bootStep(3, 'capacitor check done');

const rootElement = document.getElementById('root');

bootStep(4, 'root element found: ' + Boolean(rootElement));

function showStartupError(error: unknown) {
  console.error('VI-HEM startup error:', error);
  if (!rootElement) return;

  rootElement.innerHTML = `
    <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f7f9fc;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033">
      <section style="width:100%;max-width:440px;border:1px solid #dbe3ee;border-radius:16px;background:#fff;padding:28px;box-shadow:0 12px 34px rgba(15,23,42,.08);text-align:center">
        <h1 style="margin:0;font-size:20px">VI-HEM kunde inte starta</h1>
        <p style="margin:10px 0 0;color:#667085;font-size:14px;line-height:1.5">Appen verkar ha fått en ofullständig uppdatering. Ladda om sidan för att hämta den senaste versionen.</p>
        <button type="button" onclick="location.reload()" style="margin-top:20px;border:0;border-radius:10px;background:#2f6fed;color:#fff;padding:12px 18px;font-weight:700;cursor:pointer">Ladda om sidan</button>
      </section>
    </main>
  `;
}

if (!rootElement) {
  showStartupError(new Error('Root element was not found'));
} else {
  try {
    bootStep(5, 'about to call render');
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    bootStep(6, 'render() returned without throwing');
  } catch (error) {
    showStartupError(error);
  }
}

// Keep a visible recovery screen if a production chunk fails after React has mounted.
window.addEventListener('error', (event) => {
  if (/Loading chunk|Failed to fetch dynamically imported module/i.test(`${event.message} ${event.filename ?? ''}`)) {
    showStartupError(event.error ?? event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (/Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(event.reason))) {
    showStartupError(event.reason);
  }
});

// Service worker caching is a web/PWA concern -- it exists to avoid
// re-fetching assets over the network. Inside the native app the assets
// are already bundled locally, so it adds nothing there, only risk: the
// registration (and its cache) survives an in-place TestFlight update in
// WKWebView's persistent storage, keyed by the same origin across every
// version. If a prior version's cached index.html/shell ever gets served
// on top of a new build whose content-hashed asset filenames have moved
// on, the app is stuck on this file's static placeholder forever with no
// JS ever running to recover -- that's what happened going from 1.3 to
// 1.4. Only register on the web.
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js?v=2', { updateViaCache: 'none' }).then((registration) => {
      void registration.update();
    });
  });
}

// Belt-and-suspenders cleanup for anyone who already has a stale service
// worker registered from a native build before this fix shipped (it can't
// self-heal from inside the broken state above, but a fresh reinstall
// picks up this code and clears it out for good).
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((key) => void caches.delete(key)));
  }
}
