import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'dashboard',
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Exclude the e2e test from regular test runs — it requires live databases
    exclude: ['src/__tests__/e2e-pipeline.test.ts'],
  },
});
