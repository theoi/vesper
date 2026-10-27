import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'playwright-report/', 'test-results/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The engine and bots stay pure: no DOM, networking, UI, or audio.
    files: ['src/engine/**/*.ts', 'src/bots/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/net/**', '**/ui/**', '**/audio/**', '**/app/**'],
              message: 'src/engine and src/bots must stay free of DOM, networking, UI, and audio.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
