import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** `open`: användaren vill titta på filen. `save`: användaren vill ha den med sig. I appen blir båda delningsbladet. */
export type FileMode = 'open' | 'save';

/** Ett pågående leveransförsök. Skapas innan filen hämtas så att webbläsarens popup-spärr tillåter det nya fliken. */
export interface FileDelivery {
  deliver(blob: Blob, filename: string): Promise<void>;
  /** För filer som redan har en adress (signerad länk, Drive): öppnar den i den förbeställda fliken. */
  openUrl(url: string): void;
  cancel(): void;
}

interface PreopenedWindow { opener: unknown; location: { href: string }; close(): void }

/** Allt som skiljer plattformarna. Riktiga adaptern används i appen, en fake i scripts/platform-check.mjs. */
export interface FileEnv {
  isNative(): boolean;
  share(blob: Blob, filename: string): Promise<void>;
  openWindow(): PreopenedWindow | null;
  openUrl(url: string): void;
  download(url: string, filename: string): void;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  later(fn: () => void, ms: number): void;
}

const BLOB_LIFETIME_MS = 120_000;
// Typer som webbläsaren visar i fliken; allt annat laddas ner så att ingen tom flik blir kvar.
const VIEWABLE = /^(application\/pdf|image\/(?!svg)|text\/plain|audio\/|video\/)/i;

export function safeFilename(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[.\s-]+|\s+$/g, '').slice(0, 120) || 'fil';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const browserFileEnv: FileEnv = {
  isNative: () => Capacitor.isNativePlatform(),
  // WKWebView ignorerar <a download> och window.open på blob:-adresser, så i appen skrivs filen till cachen och delas via iOS delningsblad.
  share: async (blob, filename) => {
    const { uri } = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ url: uri, title: filename });
  },
  openWindow: () => { const w = window.open('', '_blank'); if (w) w.opener = null; return w; },
  openUrl: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); },
  download: (url, filename) => { const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); },
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  later: (fn, ms) => { window.setTimeout(fn, ms); },
};

export function createFiles(env: FileEnv) {
  function beginFileDelivery(mode: FileMode): FileDelivery {
    const native = env.isNative();
    const win = !native && mode === 'open' ? env.openWindow() : null;
    let done = false;
    return {
      cancel() { if (!done) { done = true; win?.close(); } },
      openUrl(url) { if (done) return; done = true; if (win) win.location.href = url; else env.openUrl(url); },
      async deliver(blob, rawName) {
        if (done) return; done = true;
        const filename = safeFilename(rawName);
        if (native) { await env.share(blob, filename); return; }
        const url = env.createUrl(blob);
        try {
          if (win && VIEWABLE.test(blob.type)) win.location.href = url;
          else { win?.close(); env.download(url, filename); }
        } finally { env.later(() => env.revokeUrl(url), BLOB_LIFETIME_MS); }
      },
    };
  }
  /** Lämnar en fil som redan finns i minnet. Hämtar du den asynkront efter ett klick: använd beginFileDelivery först. */
  async function deliverFile(blob: Blob, filename: string, opts: { mode?: FileMode } = {}): Promise<void> {
    await beginFileDelivery(opts.mode ?? 'save').deliver(blob, filename);
  }
  return { beginFileDelivery, deliverFile };
}

export const { beginFileDelivery, deliverFile } = createFiles(browserFileEnv);
