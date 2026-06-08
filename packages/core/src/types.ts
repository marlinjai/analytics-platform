// Canonical experiment + feature-flag config types shared by the browser
// tracker and the Node server SDK. These mirror the shapes returned by the
// remote-config endpoint (GET /api/projects/{id}/config).

/** A single arm of an experiment (or a multi-variant flag). */
export interface ExperimentVariant {
  key: string;
  /** Allocation weight as a percentage (0..100). Weights across arms sum to 100. */
  weight: number;
  description?: string;
}

/** An experiment definition as delivered by remote config. */
export interface ExperimentDefinition {
  id: string;
  key: string;
  variants: ExperimentVariant[];
  /**
   * Lifecycle status. Remote config only ships running experiments, so this is
   * optional: when absent the experiment is treated as assignable.
   */
  status?: 'draft' | 'running' | 'paused' | 'completed';
}

/** A feature flag definition as delivered by remote config. */
export interface FlagDefinition {
  key: string;
  enabled: boolean;
  /** Percentage of units (0..100) the flag is rolled out to. */
  rolloutPercentage: number;
  variants?: ExperimentVariant[] | null;
}

/** The full payload returned by GET /api/projects/{id}/config. */
export interface RemoteConfig {
  config: Record<string, unknown>;
  experiments: ExperimentDefinition[];
  flags: FlagDefinition[];
}
