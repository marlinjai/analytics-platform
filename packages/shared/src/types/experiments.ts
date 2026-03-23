// ── Feature Flags ────────────────────────────────────────────

export interface FeatureFlag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  variants: FlagVariant[] | null;
  targeting: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FlagVariant {
  key: string;
  weight: number;
}

// ── Experiments ──────────────────────────────────────────────

export interface Experiment {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string;
  hypothesis: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  variants: ExperimentVariant[];
  targeting: ExperimentTargeting;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  winnerVariant: string | null;
}

export interface ExperimentVariant {
  key: string;
  weight: number;
  description?: string;
}

export interface ExperimentTargeting {
  percentage?: number;
  urlMatch?: string;
}

// ── Experiment Goals ─────────────────────────────────────────

export interface ExperimentGoal {
  id: string;
  experimentId: string;
  name: string;
  goalType: 'pageview' | 'custom_event' | 'click';
  target: string;
  isPrimary: boolean;
  createdAt: string;
}

// ── Experiment Results ───────────────────────────────────────

export interface VariantResult {
  key: string;
  sessions: number;
  conversions: number;
  conversionRate: number;
  liftVsControl: number | null;
  probabilityToBeBest: number;
  credibleInterval: [number, number];
}

export interface ExperimentResults {
  experimentId: string;
  status: 'needs_data' | 'not_significant' | 'significant';
  variants: VariantResult[];
  totalSessions: number;
  minimumSampleReached: boolean;
  recommendation: string;
}

// ── Remote Config (extended) ─────────────────────────────────

export interface RemoteConfig {
  config: {
    replay: boolean;
    heatmap: boolean;
    scrollDepth: boolean;
  };
  experiments: RemoteExperiment[];
  flags: RemoteFlag[];
}

export interface RemoteExperiment {
  id: string;
  key: string;
  variants: { key: string; weight: number }[];
}

export interface RemoteFlag {
  key: string;
  enabled: boolean;
  rolloutPercentage: number;
  variants: { key: string; weight: number }[] | null;
}
