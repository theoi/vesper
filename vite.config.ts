import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

// Every `index.html` under these folders becomes its own page in the build,
// so preview and lab pages can be added without editing this file.
const PAGE_DIRS = ['previews', 'labs'];

function findIndexPages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const pages: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pages.push(...findIndexPages(full));
    else if (entry.name === 'index.html') pages.push(full);
  }
  return pages;
}

function pageInputs(): Record<string, string> {
  const inputs: Record<string, string> = {
    main: resolve(root, 'index.html'),
    // The asset-cache service worker. It must live at the base path (its scope).
    sw: resolve(root, 'src/app/sw.ts'),
  };
  for (const pageDir of PAGE_DIRS) {
    for (const file of findIndexPages(resolve(root, pageDir))) {
      inputs[relative(root, dirname(file)).split('\\').join('/')] = file;
    }
  }
  return inputs;
}

export default defineConfig({
  base: '/vesper/',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: pageInputs(),
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'previews/**/*.test.ts',
      'relay/src/**/*.test.ts',
    ],
    environment: 'node',
    passWithNoTests: true,
  },
});
