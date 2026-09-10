import { FlatCompat } from '@eslint/eslintrc';

// Flat-config migration of the old `next lint` setup (removed in Next 16).
// next/core-web-vitals + next/typescript are what `next lint --strict` ran.
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // The codebase already uses a leading underscore to mark a
      // deliberately-unused parameter (e.g. a mock's rest args, or a
      // function kept for interface/signature parity). Recognise that
      // convention instead of flagging it.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default eslintConfig;
