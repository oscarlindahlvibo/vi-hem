import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const rootElement = document.getElementById('root');

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
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js?v=2', { updateViaCache: 'none' }).then((registration) => {
      void registration.update();
    });
  });
}
