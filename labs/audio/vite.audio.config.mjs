// Build only the audio lab, so a check run is not disturbed by other pages being edited:
//   npx vite build --config labs/audio/vite.audio.config.mjs
//   npx vite preview --config labs/audio/vite.audio.config.mjs --port 4191 --strictPort
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  base: '/vesper/',
  build: {
    target: 'es2022',
    outDir: process.env.OUT ?? '/tmp/dist-audio-lab',
    emptyOutDir: true,
    rollupOptions: { input: { 'labs/audio': resolve(root, 'labs/audio/index.html') } },
  },
});
