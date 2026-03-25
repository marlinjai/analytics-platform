// Constants
export {
  EVENT_TYPES,
  API_KEY_PREFIX_LIVE,
  API_KEY_PREFIX_TEST,
  API_KEY_PREFIX_ACCOUNT,
  DEVICE_BREAKPOINTS,
  MAX_BATCH_SIZE,
  MAX_EVENT_SIZE_BYTES,
  MAX_REPLAY_CHUNK_BYTES,
  SESSION_TIMEOUT_MS,
  FLUSH_INTERVAL_MS,
  CLICKHOUSE_DATABASE,
  CLICKHOUSE_EVENTS_TABLE,
} from './constants.js';
export type { EventType, DeviceType } from './constants.js';

// Types
export type {
  TrackerEvent,
  ServerEnrichedFields,
  StoredEvent,
  DateRange,
  StatsQuery,
  HeatmapQuery,
  SessionListQuery,
  ReplayQuery,
  StatsOverview,
  TimeseriesPoint,
  TopPage,
  TopSource,
  BreakdownRow,
  CountryRow,
  DashboardFilters,
  HeatmapPoint,
  SelectorHeatmapPoint,
  SessionSummary,
  Project,
  ApiKey,
  User,
  Membership,
  AccountApiKey,
} from './types.js';

// Experiment & Feature Flag Types
export type {
  FeatureFlag,
  FlagVariant,
  Experiment,
  ExperimentVariant,
  ExperimentTargeting,
  ExperimentGoal,
  VariantResult,
  ExperimentResults,
  RemoteConfig,
  RemoteExperiment,
  RemoteFlag,
} from './types/experiments.js';

// Schemas
export {
  eventTypeSchema,
  deviceTypeSchema,
  dateRangeSchema,
  trackerEventSchema,
  eventBatchSchema,
  statsQuerySchema,
  heatmapQuerySchema,
  selectorHeatmapQuerySchema,
  sessionListQuerySchema,
  replayQuerySchema,
  createProjectSchema,
  createApiKeySchema,
} from './schemas.js';

// DDL
export * as clickhouseDDL from './clickhouse-ddl.js';
export * as postgresDDL from './postgres-ddl.js';
