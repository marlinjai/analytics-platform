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
];

export default eslintConfig;
