import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // shadcn/ui components are generated and kept as they come. Worktrees of work
  // packages built side by side are checkouts of their own and lint themselves.
  globalIgnores([
    'dist',
    'src-tauri/target',
    'src-tauri/gen',
    'src/components/ui',
    '.claude/worktrees',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
]);
