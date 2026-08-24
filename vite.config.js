import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base:'./' isliye GitHub Pages subpath (username.github.io/repo/) pe bhi chalega
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 }
});
