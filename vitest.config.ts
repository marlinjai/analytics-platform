import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Include shared package tests directly from the root config
    include: ['packages/shared/src/__tests__/**/*.test.ts'],
    projects: [
      // shared package tests (inline)
      {
        test: {
          name: 'shared',
          globals: true,
          environment: 'node',
          include: ['packages/shared/src/__tests__/**/*.test.ts'],
        },
      },
      // dashboard package tests (uses its own config for @/ alias)
      'packages/dashboard/vitest.config.ts',
      // tracker package tests (jsdom environment)
      'packages/tracker/vitest.config.ts',
      // core package tests (deterministic assignment parity)
      'packages/core/vitest.config.ts',
      // node SDK tests
      'packages/node/vitest.config.ts',
    ],
  },
});
