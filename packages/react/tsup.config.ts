import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2020',
  dts: true,
  clean: true,
  minify: true,
  sourcemap: true,
  treeshake: true,
  external: ['react', '@marlinjai/analytics-tracker'],
});
