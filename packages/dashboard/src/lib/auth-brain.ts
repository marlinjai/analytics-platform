import { createAuthBrainClient } from '@marlinjai/auth-brain-sdk';

// This module is evaluated at build time when Next.js collects page data for
// routes that import it (e.g. /api/account/keys/[keyId]). The Docker build has
// no runtime env, so a hard throw here breaks the build. Fall back to the
// public auth-brain host -- the same default used by the middleware, the
// NextAuth route, and the login page. Prod still injects AUTH_BRAIN_URL at
// runtime via Infisical; this only governs build-time evaluation.
const authBrainUrl = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';

/**
 * The resolved auth-brain base URL. Exported so the server-side scope-switch
 * proxy (/api/scope) can make a same-origin-forbidden call server-to-server to
 * `POST /api/sessions/active-context`, forwarding the shared lumitra_session
 * cookie. The SDK exposes no active-context method, so the proxy uses fetch.
 */
export const AUTH_BRAIN_URL = authBrainUrl;

export const authBrainClient = createAuthBrainClient({
  baseUrl: authBrainUrl,
  cookieName: 'lumitra_session',
  // 30s cache on session verify: hot path for authenticated API routes. A single
  // dashboard view fans out to a dozen stats/heatmap calls, and each uncached
  // verify costs auth-brain ~11 OpenFGA round trips to compute effective roles,
  // so caching here is load-bearing for the identity service, not a micro-opt.
  // The SDK maps timeouts and 5xx to null (fail-closed).
  //
  // ACCEPTED TRADE, stated explicitly because it qualifies a guarantee written
  // elsewhere: decision 2 says a revoked role "fails closed immediately, it does
  // not wait for a new session". With this cache, analytics honours a revoked
  // role for AT MOST 30 seconds. auth-brain re-validates per request and clears a
  // revoked active scope the moment it sees one; the bounded lag is purely this
  // consumer-side cache. Judged acceptable: 30s of stale read access, never stale
  // WRITE authority beyond the same window, in exchange for not multiplying load
  // on the identity service by an order of magnitude. Revisit if analytics ever
  // serves genuinely adversarial multi-tenant users rather than a handful of
  // known companies.
  //
  // A caller that MUTATES session state must invalidate rather than wait it out:
  // see `invalidateSession` in app/api/scope/route.ts (sdk >= 1.6.1).
  cacheTtlMs: 30_000,
  // OpenFGA config is retained for ONE reason only: the named account-key
  // survivor in auth-check.ts (checkAccountKeyProjectAccess) still resolves
  // machine-principal access via can(), because local analytics account keys
  // produce no verify payload. All SESSION (human) authorization now comes from
  // the verify payload's effective_roles — no can() on that path. Remove this
  // block once account keys are issued as auth-brain service accounts.
  openfgaUrl: process.env.OPENFGA_API_URL,
  openfgaStoreId: process.env.OPENFGA_STORE_ID,
  openfgaModelId: process.env.OPENFGA_AUTHORIZATION_MODEL_ID,
  // This OpenFGA runs with preshared auth: can() must send the bearer token or
  // every check is rejected 401 and fail-closes to false. SDK >=1.1.0 forwards it.
  openfgaToken: process.env.OPENFGA_API_TOKEN,
});
