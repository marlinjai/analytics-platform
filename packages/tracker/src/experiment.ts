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
  /**
   * Server-decided assignments from the `lumitra_variants_pub` cookie. When a
   * key is present here, the server decision is AUTHORITATIVE: it is returned
   * immediately (before remote config loads) and is never overridden by the
   * client's own deterministic murmur assignment when config arrives. Empty
   * when no pub cookie was seen, in which case the client self-assigns as before.
   */
  private serverAssignments: Map<string, string> = new Map();
  /** Server-decided flag evaluations from the pub cookie (authoritative when present). */
  private serverFlags: Map<string, boolean> = new Map();

  constructor(sessionId: string) {
    this.identityId = sessionId;
  }

  /**
   * Seed server-decided assignments (and flag evaluations) from the unsigned
   * `lumitra_variants_pub` mirror cookie the WS-A middleware sets. These are
   * AUTHORITATIVE: getVariant returns them immediately, and a later
   * setDefinitions() from remote config will NOT re-derive them with the
   * client's own murmur hash. Experiment definitions are still loaded so
   * getActiveExperiments() can map experiment-key -> id for event tagging.
   *
   * Call before setDefinitions(). Absent/empty cookie -> no-op (legacy behavior).
   */
  hydrateFromServer(
    experiments: Record<string, string>,
    flags?: Record<string, boolean>,
  ): void {
    for (const key in experiments) {
      const variant = experiments[key];
      if (typeof variant === 'string') {
        this.serverAssignments.set(key, variant);
        // Reflect immediately so getVariant() returns the server value before
        // remote config arrives.
        this.assignments.set(key, variant);
      }
    }
    if (flags) {
      for (const key in flags) {
        const value = flags[key];
        if (typeof value === 'boolean') this.serverFlags.set(key, value);
      }
    }
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
    // Re-seed server-authoritative assignments so identify() can't drop the
    // server decision back to a client murmur. The server keyed on the
    // lumitra_uid cookie, which identify() does not change.
    for (const [key, variant] of this.serverAssignments) {
      this.assignments.set(key, variant);
    }
    this.resolveAllAssignments();
  }

  /** Get the assigned variant for an experiment, or null if experiment not found. */
  getVariant(key: string): string | null {
    return this.assignments.get(key) ?? null;
  }

  /** Evaluate a feature flag. Returns false if flag not found or disabled. */
  getFlag(key: string): boolean {
    // Server decision is authoritative when the pub cookie carried this flag.
    const serverFlag = this.serverFlags.get(key);
    if (serverFlag !== undefined) return serverFlag;

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

  /** Return all assignments as { experimentKey: variantKey }. */
  getAllAssignments(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, variant] of this.assignments) {
      result[key] = variant;
    }
    return result;
  }

  /** Return all flag evaluations as { flagKey: boolean }. */
  getAllFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    // Server-decided flags first (present even before remote config loads).
    for (const [key, value] of this.serverFlags) {
      result[key] = value;
    }
    for (const flag of this.flags) {
      result[flag.key] = this.getFlag(flag.key);
    }
    return result;
  }

  /** Override the variant for an experiment. Persists to sessionStorage. */
  setVariant(key: string, variant: string): void {
    this.assignments.set(key, variant);
    storeAssignment(key, variant);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private resolveAllAssignments(): void {
    for (const exp of this.experiments) {
      this.resolveAssignment(exp);
    }
  }

  private resolveAssignment(exp: ExperimentDefinition): void {
    // Server decision wins: if the pub cookie assigned this experiment, honor it
    // and never re-derive a (possibly different) client murmur assignment.
    const serverVariant = this.serverAssignments.get(exp.key);
    if (serverVariant !== undefined) {
      this.assignments.set(exp.key, serverVariant);
      return;
    }

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
