import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tracker',
    globals: true,
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
