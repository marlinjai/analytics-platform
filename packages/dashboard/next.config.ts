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
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  // The self-hosted tracker bundle under /sdk/ is ES-module-imported by customer
  // pages on OTHER origins, so it needs a permissive CORS header. Cache it at the
  // edge/browser but allow background revalidation.
  async headers() {
    return [
      {
        source: '/sdk/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
