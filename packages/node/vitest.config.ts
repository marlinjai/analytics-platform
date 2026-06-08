import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve analytics-core from source so tests run without a build step.
      '@marlinjai/analytics-core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    name: 'node-sdk',
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
