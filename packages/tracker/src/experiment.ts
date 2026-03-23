import { murmurhash3 } from './hash.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExperimentVariant {
  key: string;
  weight: number;
}

export interface ExperimentDefinition {
  id: string;
  key: string;
  variants: ExperimentVariant[];
}

export interface FlagDefinition {
  key: string;
  enabled: boolean;
  rolloutPercentage: number;
  variants: ExperimentVariant[] | null;
}

export interface RemoteConfig {
  config: Record<string, unknown>;
  experiments: ExperimentDefinition[];
  flags: FlagDefinition[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EXP_STORAGE_PREFIX = 'ap_exp_';

function assignVariant(
  experimentKey: string,
  userId: string,
  variants: ExperimentVariant[],
): string {
  const hash = murmurhash3(`${experimentKey}:${userId}`);
  const bucket = hash % 10000; // 0.01% granularity
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight * 100; // weight 50 -> 5000
    if (bucket < cumulative) return variant.key;
  }
  return variants[0]?.key ?? 'control';
}

function readStoredAssignment(key: string): string | null {
  try {
    return sessionStorage.getItem(`${EXP_STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}

function storeAssignment(key: string, variant: string): void {
  try {
    sessionStorage.setItem(`${EXP_STORAGE_PREFIX}${key}`, variant);
  } catch {
    // sessionStorage unavailable (e.g. incognito quota exceeded)
  }
}

// ── ExperimentManager ────────────────────────────────────────────────────────

export class ExperimentManager {
  private experiments: ExperimentDefinition[] = [];
  private flags: FlagDefinition[] = [];
  private identityId: string;
  private assignments: Map<string, string> = new Map();

  constructor(sessionId: string) {
    this.identityId = sessionId;
  }

  /** Load experiment & flag definitions from remote config. */
  setDefinitions(experiments: ExperimentDefinition[], flags: FlagDefinition[]): void {
    this.experiments = experiments;
    this.flags = flags;
    this.resolveAllAssignments();
  }

  /** Switch from session-based to user-based assignment. Re-resolves all variants. */
  identify(userId: string): void {
    if (userId === this.identityId) return;
    this.identityId = userId;
    this.assignments.clear();
    this.resolveAllAssignments();
  }

  /** Get the assigned variant for an experiment, or null if experiment not found. */
  getVariant(key: string): string | null {
    return this.assignments.get(key) ?? null;
  }

  /** Evaluate a feature flag. Returns false if flag not found or disabled. */
  getFlag(key: string): boolean {
    const flag = this.flags.find((f) => f.key === key);
    if (!flag || !flag.enabled) return false;

    // Deterministic rollout check
    if (flag.rolloutPercentage < 100) {
      const hash = murmurhash3(`${key}:${this.identityId}`);
      const bucket = hash % 10000;
      if (bucket >= flag.rolloutPercentage * 100) return false;
    }

    return true;
  }

  /** Return all active experiment assignments as { experimentId: variantKey }. */
  getActiveExperiments(): Record<string, string> {
    const active: Record<string, string> = {};
    for (const exp of this.experiments) {
      const variant = this.assignments.get(exp.key);
      if (variant) active[exp.id] = variant;
    }
    return active;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private resolveAllAssignments(): void {
    for (const exp of this.experiments) {
      this.resolveAssignment(exp);
    }
  }

  private resolveAssignment(exp: ExperimentDefinition): void {
    // Check sessionStorage for a sticky assignment
    const stored = readStoredAssignment(exp.key);
    if (stored && exp.variants.some((v) => v.key === stored)) {
      this.assignments.set(exp.key, stored);
      return;
    }

    // Deterministic assignment
    const variant = assignVariant(exp.key, this.identityId, exp.variants);
    this.assignments.set(exp.key, variant);
    storeAssignment(exp.key, variant);
  }
}
