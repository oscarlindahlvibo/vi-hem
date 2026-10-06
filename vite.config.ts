import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  root: appRoot,
  plugins: [react(), {
    name: 'vihem-exclude-public-website',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          if (id.replace(/\\/g, '/').includes('/apps/vibofast/')) {
            this.error('The public vibofast.se website must be built separately from VI-HEM.');
          }
        }
      }
    },
  }],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2018',
    cssTarget: 'safari14',
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
