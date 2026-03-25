import type { NextConfig } from 'next';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    root: resolve(__dirname, '../..'),
  },
  // Include postgres in standalone output for the instrumentation migration runner
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/postgres/**'],
  },
};

export default nextConfig;
