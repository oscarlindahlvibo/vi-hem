import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// Lokal utveckling mot riktig backend: KP_DEV_PROXY=https://<supabase> proxar anrop och skriver om Origin till webbplatsens riktiga domän
// (backend härleder organisation ur Origin). Används bara av `npm run dev`; påverkar inte bygget.
const target = process.env.KP_DEV_PROXY;
const proxyOptions = target ? { target, changeOrigin: true, secure: true, configure: (proxy: any) => proxy.on('proxyReq', (req: any) => req.setHeader('origin', process.env.KP_DEV_ORIGIN || 'https://kompetensportalen.se')) } : undefined;

export default defineConfig({
  root: appRoot,
  plugins: [react()],
  server: target ? { port: 5210, proxy: { '/functions': proxyOptions!, '/auth': proxyOptions!, '/rest': proxyOptions!, '/storage': proxyOptions! } } : undefined,
  build: { outDir: path.join(appRoot, 'dist'), emptyOutDir: true, sourcemap: false },
});
