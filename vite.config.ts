import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2018',
    cssTarget: 'safari14',
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
