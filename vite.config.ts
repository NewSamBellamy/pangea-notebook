import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // Required for project Pages URL: https://newsam bellamy.github.io/pangea-notebook/
  // (actual path uses the repo name without spaces)
  base: process.env.GITHUB_PAGES === '1' ? '/pangea-notebook/' : '/',
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2020', chunkSizeWarningLimit: 4000 },
});
