import 'server-only';
import React from 'react';
import { cookies } from 'next/headers';
import {
  decodeVariants,
  decodeOverride,
  LUMITRA_VARIANTS_COOKIE,
  LUMITRA_VARIANT_OVERRIDE_COOKIE,
  type DecodedAssignments,
  type VariantOverride,
} from '@marlinjai/analytics-core';

/**
 * Server-only entry (`@marlinjai/analytics-react/server`).
 *
 * One philosophy: the server decides the variant, a signed cookie carries it,
 * the client never re-decides. These helpers read the signed `lumitra_variants`
 * cookie that the Lumitra middleware set (see ./middleware), verify it with
 * LUMITRA_VARIANTS_SECRET, and render the decided variant in a React Server
 * Component with zero flicker, no client round-trip, no hydration swap.
 *
 * Reading cookies() opts the route into dynamic rendering, which is exactly what
 * we want: the variant is per-visitor, so the response must not be statically
 * cached. The `server-only` import makes importing this from a client bundle a
 * build error, so the secret can never leak into client JS.
 *
 * ## QA / admin forced-variant override (WS-F / D4)
 *
 * `getVariant` is override-aware: it reads the un-signed
 * `lumitra_variant_override` cookie (set by the middleware from
 * `?lumitra_variant=experimentKey:variantKey`) and, when present, returns the
 * forced arm for those experiments. This wins over the signed-cookie assignment
 * so the server renders the forced arm even before the middleware has re-minted
 * the signed cookie (e.g. on the same request the override is first applied,
 * where the middleware forwards the override cookie onto the request headers).
 * Non-overridden experiments keep their real signed-cookie assignment.
 *
 * The override never affects experiment RESULTS, the tracker suppresses
 * attribution for overridden experiments client-side (see the tracker's
 * experiment.ts). Server-side, the override is read-only display state.
 */

/** Read + verify the signed variant cookie, returning the decoded maps or null. */
async function readAssignments(): Promise<DecodedAssignments | null> {
  const secret = process.env.LUMITRA_VARIANTS_SECRET;
  if (!secret) {
    // Fail closed: no secret configured means we cannot trust any cookie.
    return null;
  }
  const cookieStore = await cookies();
  const raw = cookieStore.get(LUMITRA_VARIANTS_COOKIE)?.value;
  return decodeVariants(raw, { secret });
}

/** Read the QA/admin forced-variant override from the un-signed cookie, or null. */
async function readOverride(): Promise<VariantOverride | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LUMITRA_VARIANT_OVERRIDE_COOKIE)?.value;
  return decodeOverride(raw);
}

/**
 * Get the server-decided variant for an experiment, or null when no cookie /
 * no decision / tampered. Use this in a Server Component to branch on the
 * assigned arm before the HTML is sent.
 *
 * A QA/admin forced override (`?lumitra_variant=experimentKey:variantKey`, sticky
 * via the `lumitra_variant_override` cookie) takes precedence and returns the
 * forced arm. Non-overridden experiments resolve to their real signed-cookie
 * assignment. The override is display-only; it never enters experiment results.
 */
export async function getVariant(experimentKey: string): Promise<string | null> {
  const override = await readOverride();
  if (override && Object.prototype.hasOwnProperty.call(override, experimentKey)) {
    return override[experimentKey] as string;
  }
  const decoded = await readAssignments();
  return decoded?.experiments[experimentKey] ?? null;
}

/**
 * Evaluate a boolean feature flag from the server-decided cookie.
 *
 * The signed cookie carries a dedicated flag map produced by the middleware's
 * `assignAllFlags` over the project's running flags (canonical `evaluateFlag`,
 * so the rollout bucketing matches the tracker). Every flag the server saw is
 * stored explicitly, including the false ones, so this returns the server's
 * boolean directly. A flag the server never saw (absent from the map) and a
 * missing/tampered cookie both resolve to false here, a Server Component has no
 * client tracker to fall back to, so an unknown flag is off by definition.
 */
export async function getFlag(flagKey: string): Promise<boolean> {
  const decoded = await readAssignments();
  return decoded?.flags[flagKey] ?? false;
}

interface ServerVariantProps {
  /** Experiment key to branch on. */
  experiment: string;
  /** Map of variant key -> server-rendered node. */
  variants: Record<string, React.ReactNode>;
  /** Rendered when no variant is decided or the decided key is absent from `variants`. */
  fallback?: React.ReactNode;
}

/**
 * Server Component that renders the server-decided variant with zero flicker.
 * Because it awaits the signed cookie, the correct arm is in the initial HTML,
 * there is no client-side decision and no swap on hydration.
 *
 * @example
 * ```tsx
 * import { LumitraVariant } from '@marlinjai/analytics-react/server';
 *
 * export default function Page() {
 *   return (
 *     <LumitraVariant
 *       experiment="hero-cta-test"
 *       variants={{
 *         control: <CtaButton>Join Waitlist</CtaButton>,
 *         'green-cta': <CtaButton color="green">Start Free</CtaButton>,
 *       }}
 *       fallback={<CtaButton>Join Waitlist</CtaButton>}
 *     />
 *   );
 * }
 * ```
 */
export async function LumitraVariant({
  experiment,
  variants,
  fallback = null,
}: ServerVariantProps): Promise<React.ReactElement> {
  const variant = await getVariant(experiment);
  const node = variant !== null ? (variants[variant] ?? fallback) : fallback;
  return React.createElement(React.Fragment, null, node);
}
