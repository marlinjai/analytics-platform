import { createAuthBrainClient } from '@marlinjai/auth-brain-sdk';

// This module is evaluated at build time when Next.js collects page data for
// routes that import it (e.g. /api/account/keys/[keyId]). The Docker build has
// no runtime env, so a hard throw here breaks the build. Fall back to the
// public auth-brain host -- the same default used by the middleware, the
// NextAuth route, and the login page. Prod still injects AUTH_BRAIN_URL at
// runtime via Infisical; this only governs build-time evaluation.
const authBrainUrl = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';

export const authBrainClient = createAuthBrainClient({
  baseUrl: authBrainUrl,
  cookieName: 'lumitra_session',
  // 30s cache on session verify: hot path for authenticated API routes.
  // The SDK maps timeouts and 5xx to null (fail-closed).
  cacheTtlMs: 30_000,
  openfgaUrl: process.env.OPENFGA_API_URL,
  openfgaStoreId: process.env.OPENFGA_STORE_ID,
  openfgaModelId: process.env.OPENFGA_AUTHORIZATION_MODEL_ID,
  // This OpenFGA runs with preshared auth: can() must send the bearer token or
  // every check is rejected 401 and fail-closes to false. SDK >=1.1.0 forwards it.
  openfgaToken: process.env.OPENFGA_API_TOKEN,
});
