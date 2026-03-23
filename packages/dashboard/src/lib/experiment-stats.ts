/**
 * Bayesian Statistics Engine for A/B Testing
 *
 * Pure TypeScript implementation with ZERO external dependencies.
 * Uses Monte Carlo sampling from Beta posteriors to compute:
 * - Probability to be best (per variant)
 * - Expected lift vs control
 * - 95% credible intervals
 *
 * The Beta distribution is sampled via the Gamma distribution
 * (Marsaglia-Tsang method), which in turn uses the Box-Muller
 * transform for normal random variates.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariantData {
  key: string;
  sessions: number;
  conversions: number;
}

export interface VariantResult {
  key: string;
  sessions: number;
  conversions: number;
  conversionRate: number;
  liftVsControl: number | null; // percentage lift
  probabilityToBeBest: number; // 0-1
  credibleInterval: [number, number]; // 95% CI for conversion rate
}

export interface ExperimentResults {
  experimentId: string;
  status: 'needs_data' | 'not_significant' | 'significant';
  variants: VariantResult[];
  totalSessions: number;
  minimumSampleReached: boolean; // > 100 sessions per variant
  recommendation: string; // human-readable recommendation
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_SAMPLES = 10_000;
const SIGNIFICANCE_THRESHOLD = 0.95;
const MIN_SESSIONS_PER_VARIANT = 100;

// ---------------------------------------------------------------------------
// Random sampling (zero dependencies)
// ---------------------------------------------------------------------------

/**
 * Standard normal random variate via Box-Muller transform.
 */
function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Sample from Gamma(shape, 1) using Marsaglia and Tsang's method.
 * For shape < 1, uses the identity: Gamma(a) = Gamma(a+1) * U^(1/a).
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Sample from Beta(alpha, beta) using the Gamma distribution method:
 * If X ~ Gamma(alpha) and Y ~ Gamma(beta), then X/(X+Y) ~ Beta(alpha, beta).
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export function analyzeExperiment(
  experimentId: string,
  variants: VariantData[],
): ExperimentResults {
  if (variants.length === 0) {
    return {
      experimentId,
      status: 'needs_data',
      variants: [],
      totalSessions: 0,
      minimumSampleReached: false,
      recommendation: 'No variant data available.',
    };
  }

  // Generate Monte Carlo samples for each variant from its Beta posterior
  const samples: Record<string, number[]> = {};
  for (const v of variants) {
    const alpha = 1 + v.conversions; // Beta prior: uniform Beta(1,1)
    const beta = 1 + (v.sessions - v.conversions);
    samples[v.key] = Array.from({ length: NUM_SAMPLES }, () =>
      sampleBeta(alpha, beta),
    );
  }

  // Count how often each variant is best across all samples
  const winCounts: Record<string, number> = {};
  for (const v of variants) winCounts[v.key] = 0;

  for (let i = 0; i < NUM_SAMPLES; i++) {
    let bestKey = variants[0]!.key;
    let bestVal = samples[variants[0]!.key]![i]!;
    for (let j = 1; j < variants.length; j++) {
      const vKey = variants[j]!.key;
      const vVal = samples[vKey]![i]!;
      if (vVal > bestVal) {
        bestKey = vKey;
        bestVal = vVal;
      }
    }
    winCounts[bestKey]!++;
  }

  const controlVariant = variants[0]!; // first variant is always control
  const controlRate =
    controlVariant.sessions > 0
      ? controlVariant.conversions / controlVariant.sessions
      : 0;

  const minimumSampleReached = variants.every(
    (v) => v.sessions >= MIN_SESSIONS_PER_VARIANT,
  );

  const results: VariantResult[] = variants.map((v) => {
    const rate = v.sessions > 0 ? v.conversions / v.sessions : 0;
    const sortedSamples = [...(samples[v.key] ?? [])].sort((a, b) => a - b);
    return {
      key: v.key,
      sessions: v.sessions,
      conversions: v.conversions,
      conversionRate: rate,
      liftVsControl:
        v.key === controlVariant.key
          ? null
          : controlRate > 0
            ? ((rate - controlRate) / controlRate) * 100
            : 0,
      probabilityToBeBest: (winCounts[v.key] ?? 0) / NUM_SAMPLES,
      credibleInterval: [
        sortedSamples[Math.floor(NUM_SAMPLES * 0.025)] ?? 0,
        sortedSamples[Math.floor(NUM_SAMPLES * 0.975)] ?? 0,
      ],
    };
  });

  const bestVariant = results.reduce((a, b) =>
    a.probabilityToBeBest > b.probabilityToBeBest ? a : b,
  );

  let status: ExperimentResults['status'];
  let recommendation: string;

  if (!minimumSampleReached) {
    status = 'needs_data';
    recommendation = `Need at least ${MIN_SESSIONS_PER_VARIANT} sessions per variant. Continue running.`;
  } else if (bestVariant.probabilityToBeBest >= SIGNIFICANCE_THRESHOLD) {
    status = 'significant';
    recommendation = `"${bestVariant.key}" is the winner with ${(bestVariant.probabilityToBeBest * 100).toFixed(1)}% probability. Consider stopping the experiment.`;
  } else {
    status = 'not_significant';
    recommendation = `No clear winner yet. Highest probability: "${bestVariant.key}" at ${(bestVariant.probabilityToBeBest * 100).toFixed(1)}%. Continue running.`;
  }

  return {
    experimentId,
    status,
    variants: results,
    totalSessions: variants.reduce((sum, v) => sum + v.sessions, 0),
    minimumSampleReached,
    recommendation,
  };
}
