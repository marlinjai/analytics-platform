import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'react',
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
