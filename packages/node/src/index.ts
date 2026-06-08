import { assign, evaluateFlag } from '@marlinjai/analytics-core';
import type { RemoteConfig } from '@marlinjai/analytics-core';

export type { RemoteConfig, ExperimentDefinition, FlagDefinition, ExperimentVariant } from '@marlinjai/analytics-core';

/** Mirrors the dashboard's remote-config Cache-Control max-age (60s). */
const DEFAULT_CONFIG_TTL_MS = 60_000;

export interface AnalyticsNodeConfig {
  /** Project UUID. */
  projectId: string;
  /** Project API key (ap_live_... or ap_test_...). */
  apiKey: string;
  /** Base URL of the analytics dashboard, e.g. https://analytics.example.com (no trailing slash needed). */
  endpoint: string;
  /** Remote-config in-process cache TTL in ms. Default 60000. */
  configTtlMs?: number;
  /** Override the fetch implementation (tests / custom HTTP agents). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface TrackOptions {
  /** Stable identifier the variant was keyed on (familyId/userId), supplied by the caller. */
  unitId: string;
  /** Experiment UUID to attribute this event to. */
  experimentId?: string;
  /** Variant key the unit was assigned to. */
  variant?: string;
  /** Arbitrary event properties. */
  properties?: Record<string, unknown>;
  /** Event timestamp (Unix ms). Defaults to now. */
  timestamp?: number;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

/**
 * Server SDK for Lumitra experiments. Assignment is computed locally with the
 * shared, deterministic @marlinjai/analytics-core primitive, so a server
 * decision equals the browser tracker's for the same (experimentKey, unitId).
 * No browser APIs, no sessionStorage.
 */
export class AnalyticsNode {
  private readonly projectId: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly ttl: number;
  private readonly fetchImpl: typeof fetch;
  private cache: { config: RemoteConfig; expiresAt: number } | null = null;
  private inflight: Promise<RemoteConfig> | null = null;

  constructor(config: AnalyticsNodeConfig) {
    if (!config.projectId) throw new Error('analytics-node: projectId is required');
    if (!config.apiKey) throw new Error('analytics-node: apiKey is required');
    if (!config.endpoint) throw new Error('analytics-node: endpoint is required');

    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('analytics-node: no fetch implementation available (Node >= 18 or pass config.fetch)');
    }

    this.projectId = config.projectId;
    this.apiKey = config.apiKey;
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.ttl = config.configTtlMs ?? DEFAULT_CONFIG_TTL_MS;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Fetch the project's remote config, cached in-process for the TTL.
   * Defaults to the SDK's own projectId; only that project's config is cached.
   */
  async fetchConfig(projectId: string = this.projectId): Promise<RemoteConfig> {
    const own = projectId === this.projectId;
    const now = Date.now();

    if (own && this.cache && this.cache.expiresAt > now) {
      return this.cache.config;
    }
    if (own && this.inflight) {
      return this.inflight;
    }

    const load = this.loadConfig(projectId);
    if (own) this.inflight = load;

    try {
      const config = await load;
      if (own) {
        this.cache = { config, expiresAt: Date.now() + this.ttl };
      }
      return config;
    } finally {
      if (own) this.inflight = null;
    }
  }

  /** Force the next fetchConfig() to hit the network. */
  clearConfigCache(): void {
    this.cache = null;
  }

  private async loadConfig(projectId: string): Promise<RemoteConfig> {
    const url = `${this.endpoint}/api/projects/${encodeURIComponent(projectId)}/config`;
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: { 'x-api-key': this.apiKey },
    });
    if (!res.ok) {
      throw new Error(`analytics-node: failed to fetch config (HTTP ${res.status})`);
    }
    const data = (await res.json()) as Partial<RemoteConfig>;
    return {
      config: data.config ?? {},
      experiments: data.experiments ?? [],
      flags: data.flags ?? [],
    };
  }

  /** Assign the unit to a variant for the given experiment key, or null if unknown/not running. */
  async getVariant(experimentKey: string, unitId: string): Promise<string | null> {
    const { experiments } = await this.fetchConfig();
    const experiment = experiments.find((e) => e.key === experimentKey);
    if (!experiment) return null;
    return assign(experiment, unitId);
  }

  /** Evaluate a boolean feature flag for the unit. */
  async getFlag(key: string, unitId: string): Promise<boolean> {
    const { flags } = await this.fetchConfig();
    const flag = flags.find((f) => f.key === key);
    if (!flag) return false;
    return evaluateFlag(flag, unitId);
  }

  /** Emit a server event carrying experiment_id + variant to the server-ingest path. */
  async track(eventName: string, options: TrackOptions): Promise<void> {
    if (!eventName) throw new Error('analytics-node: eventName is required');
    if (!options || !options.unitId) throw new Error('analytics-node: track requires a unitId');

    const event = {
      eventName,
      unitId: options.unitId,
      timestamp: options.timestamp ?? Date.now(),
      experimentId: options.experimentId,
      variant: options.variant,
      properties: options.properties,
    };

    const url = `${this.endpoint}/api/ingest`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify([event]),
    });
    if (!res.ok) {
      throw new Error(`analytics-node: failed to track event (HTTP ${res.status})`);
    }
  }
}

// ── Module-level singleton (mirrors the tracker's init() ergonomics) ──────────

let instance: AnalyticsNode | null = null;

/** Initialize the singleton server client. */
export function init(config: AnalyticsNodeConfig): AnalyticsNode {
  instance = new AnalyticsNode(config);
  return instance;
}

/** Get the initialized singleton, or throw if init() has not been called. */
export function getClient(): AnalyticsNode {
  if (!instance) throw new Error('analytics-node: call init() before using the SDK');
  return instance;
}

export function fetchConfig(projectId?: string): Promise<RemoteConfig> {
  return getClient().fetchConfig(projectId);
}

export function getVariant(experimentKey: string, unitId: string): Promise<string | null> {
  return getClient().getVariant(experimentKey, unitId);
}

export function getFlag(key: string, unitId: string): Promise<boolean> {
  return getClient().getFlag(key, unitId);
}

export function track(eventName: string, options: TrackOptions): Promise<void> {
  return getClient().track(eventName, options);
}
