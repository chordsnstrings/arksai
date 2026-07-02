import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' → relative asset paths, required for the /apps/<slug>/ path proxy.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
