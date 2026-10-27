// Build only some preview pages, for capture runs that must not be disturbed by dev-server reloads.
//   PAGES=masque,index OUT=/tmp/dist-masque npx vite build --config previews/_tools/vite.only.config.mjs
//   OUT=/tmp/dist-masque npx vite preview --config previews/_tools/vite.only.config.mjs --port 4174
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const pages = (process.env.PAGES ?? 'index').split(',').filter(Boolean);

export default defineConfig({
  root,
  base: '/vesper/',
  build: {
    target: 'es2022',
    outDir: process.env.OUT ?? '/tmp/dist-previews',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((p) => [
          p,
          resolve(root, p === 'index' ? 'previews/index.html' : `previews/${p}/index.html`),
        ]),
      ),
    },
  },
});
