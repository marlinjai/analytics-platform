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
  /**
   * QA/admin forced-variant override (WS-F / D4): experiment key -> forced
   * variant key. When a key is present here it is DISPLAY-authoritative
   * (getVariant returns it, over the server decision and the client murmur) AND
   * it is EXCLUDED from getActiveExperiments() so emitted events carry NO
   * experimentId/variant for it. That exclusion is the results-pollution gate: a
   * forced experiment's events never reach heatmap_selectors_by_variant_mv /
   * experiment_conversions_mv, so a QA preview cannot skew live results. Empty
   * when no override cookie/query was seen.
   */
  private forcedOverride: Map<string, string> = new Map();

  constructor(sessionId: string) {
    this.identityId = sessionId;
  }

  /**
   * Seed server-decided assignments (and flag evaluations) from the unsigned
   * `lumitra_variants_pub` mirror cookie the WS-A middleware sets. These are
   * AUTHORITATIVE: getVariant returns them immediately, and a later
   * setDefinitions() from remote config will NOT re-derive them with the
   * client's own murmur hash.
   *
   * When the cookie carries `experimentIds` (key -> id), they are recorded so
   * getActiveExperiments() can tag events with experimentId BEFORE remote config
   * loads, i.e. on the tracker's first constructor-fired event. Absent ids fall
   * back to the remote-config key->id map exactly as before.
   *
   * Call before setDefinitions(). Absent/empty cookie -> no-op (legacy behavior).
   */
  hydrateFromServer(
    experiments: Record<string, string>,
    flags?: Record<string, boolean>,
    experimentIds?: Record<string, string>,
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
    // When the cookie carried the key->id map, seed a minimal experiment
    // definition per hydrated experiment (empty variants: the server already
    // decided, so resolveAssignment short-circuits on serverAssignments and never
    // touches variants). This lets the UNCHANGED getActiveExperiments() map
    // key->id and tag the first constructor-fired event with experimentId+variant
    // BEFORE remote config loads. setDefinitions() later REPLACES this.experiments
    // with the real (same key+id) defs, so the seeds are transparently superseded.
    if (experimentIds) {
      for (const key in experimentIds) {
        this.experiments.push({ id: experimentIds[key]!, key, variants: [] });
      }
    }
  }

  /**
   * Apply (or clear) the QA/admin forced-variant override (WS-F / D4).
   *
   * For every forced (experimentKey -> variantKey) pair, the variant is shown
   * immediately by getVariant() and the key is recorded as suppressed for
   * attribution, so track() emits NO experimentId/variant for that experiment
   * (the results-pollution gate). Non-overridden experiments are untouched and
   * attribute normally.
   *
   * Pass `'clear'` to drop any active override; the next resolve restores the
   * server decision / client self-assignment. Call BEFORE setDefinitions() (the
   * tracker does this in its constructor); calling after also works because the
   * override is re-applied on top of the resolved assignment.
   */
  applyOverride(override: Record<string, string> | 'clear'): void {
    this.forcedOverride.clear();
    if (override === 'clear') {
      // Re-resolve so a previously-forced key falls back to its real assignment.
      this.resolveAllAssignments();
      return;
    }
    for (const key in override) {
      const variant = override[key];
      if (typeof variant === 'string' && variant !== '') {
        this.forcedOverride.set(key, variant);
        // Reflect immediately so getVariant() shows the forced arm before
        // definitions load.
        this.assignments.set(key, variant);
      }
    }
  }

  /** Whether an experiment key is currently force-overridden (attribution suppressed). */
  isOverridden(key: string): boolean {
    return this.forcedOverride.has(key);
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
    // Re-seed the forced override too, identify() must not drop a QA-forced arm.
    for (const [key, variant] of this.forcedOverride) {
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

  /**
   * Return active experiment assignments for EVENT ATTRIBUTION as
   * { experimentId: variantKey }.
   *
   * RESULTS-POLLUTION GATE (WS-F / D4): a force-overridden experiment is OMITTED
   * here even though getVariant() still shows its forced arm. track() tags events
   * from this map, so a forced experiment contributes no experimentId/variant to
   * emitted events and therefore never enters heatmap_selectors_by_variant_mv /
   * experiment_conversions_mv. Non-overridden experiments in the same session
   * still attribute normally.
   *
   * Key->id is read from this.experiments, which holds the remote-config defs once
   * loaded and, BEFORE config loads, the minimal seeds hydrateFromServer pushes
   * from the pub cookie's `i` map. So the tracker's first constructor-fired event
   * is tagged with experimentId+variant even pre-config.
   */
  getActiveExperiments(): Record<string, string> {
    const active: Record<string, string> = {};
    for (const exp of this.experiments) {
      if (this.forcedOverride.has(exp.key)) continue; // forced -> suppress attribution
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
    // QA/admin forced override wins above everything for DISPLAY (getVariant).
    // Attribution is still suppressed separately in getActiveExperiments().
    const forced = this.forcedOverride.get(exp.key);
    if (forced !== undefined) {
      this.assignments.set(exp.key, forced);
      return;
    }

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
