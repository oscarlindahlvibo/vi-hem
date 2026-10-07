import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = { ...loadEnv(mode, appRoot, 'VITE_'), ...process.env };
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
      throw new Error('VI-HEM build requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Configure the production environment before building.');
    }
  }
  return {
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
  };
});
