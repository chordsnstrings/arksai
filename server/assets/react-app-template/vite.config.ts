import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// base: './' → relative asset paths so the built app works when served from a
// subfolder like https://arksai.studio/apps/<slug>/ (the #1 deploy-breakage fix).
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
