// Shared ESLint flat-config base for every @kimtos workspace that lints (the
// extension; www uses Nuxt's own tooling). Each app spreads
// `base` into its flat config, then appends its env-specific globals/rules and
// `eslint-config-prettier` LAST. Written as plain ESM so it composes into both a
// `tseslint.config(...)` call and a plain flat-config array.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Shared unused-vars policy: allow _-prefixed args/vars; ignore rest siblings.
export const unusedVars = [
  'error',
  {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
    ignoreRestSiblings: true,
  },
];

export const base = [
  { ignores: ['dist/**', 'node_modules/**', '.nuxt/**', '.output/**'] },
  js.configs.recommended,
  // Scope the TS parser/rules to TS files only, so plain .js/.mjs aren't parsed by it.
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ['**/*.{ts,mts,cts}'],
  })),
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      'no-unused-vars': unusedVars,
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unusedVars,
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
