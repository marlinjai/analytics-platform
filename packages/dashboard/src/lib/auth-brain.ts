import { createAuthBrainClient } from '@marlinjai/auth-brain-sdk';

if (!process.env.AUTH_BRAIN_URL) {
  throw new Error('AUTH_BRAIN_URL env var is required');
}

export const authBrainClient = createAuthBrainClient({
  baseUrl: process.env.AUTH_BRAIN_URL,
  cookieName: 'lumitra_session',
  // 30s cache on session verify: hot path for authenticated API routes.
  // The SDK maps timeouts and 5xx to null (fail-closed).
  cacheTtlMs: 30_000,
  openfgaUrl: process.env.OPENFGA_API_URL,
  openfgaStoreId: process.env.OPENFGA_STORE_ID,
});
